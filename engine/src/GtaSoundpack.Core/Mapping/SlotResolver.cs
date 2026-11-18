using CodeWalker.GameFiles;
using GtaSoundpack.Core.Awc;
using GtaSoundpack.Core.Gta;
using GtaSoundpack.Core.Util;

namespace GtaSoundpack.Core.Mapping;

/// <summary>
/// Löst Waffe → Audio-Item (weapons.meta) → ItemAudioSettings → WeaponSettings (game.dat151)
/// → ReloadSounds/FireSound → Sound-Baum (sounds.dat54) → SimpleSound → Container/Wave → AWC-Eintrag auf.
/// </summary>
public sealed class SlotResolver
{
    private readonly ArchiveCatalog _catalog;
    private readonly Dictionary<string, AwcFile> _awcCache = new(StringComparer.OrdinalIgnoreCase);
    private const int MaxDepth = 24;

    public SlotResolver(ArchiveCatalog catalog) => _catalog = catalog;

    public SlotMapping Analyze(WeaponsConfig config, Action<string>? status = null)
    {
        var mapping = new SlotMapping
        {
            GameExe = Path.GetFileName(_catalog.Gta.ExePath),
            GameVersion = _catalog.Gta.GameVersion,
        };
        foreach (var weapon in config.Weapons)
        {
            NameHints.AddWeapon(weapon.Name);
            foreach (var kind in weapon.Kinds.Distinct())
            {
                status?.Invoke($"Analysiere {weapon.Name} / {kind} …");
                try
                {
                    var slots = ResolveWeapon(weapon, kind, mapping.Notes);
                    if (slots.Count == 0)
                        mapping.Notes.Add($"{weapon.Name}/{kind}: keine Einträge gefunden – bitte im AWC-Explorer manuell zuordnen.");
                    mapping.Slots.AddRange(slots);
                }
                catch (Exception ex)
                {
                    mapping.Notes.Add($"{weapon.Name}/{kind}: {ex.Message}");
                }
            }
        }
        foreach (var top in mapping.TopLevelArchives())
        {
            status?.Invoke($"Berechne Prüfsumme {top} …");
            mapping.Archives[top] = Hashing.Fingerprint(_catalog.Gta.GetAbsolute(top));
        }
        return mapping;
    }

    public List<SoundSlot> ResolveWeapon(WeaponDefinition weapon, SlotKind kind, List<string> notes)
    {
        var audioItem = weapon.AudioItem;
        if (string.IsNullOrWhiteSpace(audioItem) && !_catalog.WeaponAudioItems.TryGetValue(weapon.Name, out audioItem))
        {
            var guess = "AUDIO_ITEM_" + (weapon.Name.StartsWith("WEAPON_", StringComparison.OrdinalIgnoreCase) ? weapon.Name[7..] : weapon.Name);
            notes.Add($"{weapon.Name}: Audio-Item nicht in weapons*.meta gefunden, versuche '{guess}'.");
            audioItem = guess;
        }
        var itemHash = Hashing.Joaat(audioItem!);
        JenkIndex.Ensure(audioItem!.ToLowerInvariant());

        var settings = FindWeaponSettings(itemHash).ToList();
        if (settings.Count == 0)
            throw new InvalidOperationException($"Für Audio-Item '{audioItem}' wurden keine WeaponSettings in game.dat151 gefunden.");

        // Spieler-Kontext bevorzugen: das Settings-Objekt mit Reload-/Fire-Sound, das als erstes kommt.
        var slots = new List<SoundSlot>();
        var seenRoots = new HashSet<uint>();
        foreach (var (category, ws) in settings)
        {
            var root = RootFor(ws, kind);
            if (root == 0 || !seenRoots.Add(root)) continue;
            var prefix = settings.Count > 1 && seenRoots.Count > 1 ? $"{NameHints.Name(category)}:" : "";
            slots.AddRange(BuildSlots(weapon.Name, kind, root, prefix));
        }
        return slots;
    }

    private IEnumerable<(uint Category, Dat151WeaponSettings Settings)> FindWeaponSettings(uint itemHash)
    {
        if (!_catalog.RelData.TryGetValue(itemHash, out var rd)) yield break;
        switch (rd)
        {
            case Dat151WeaponSettings ws:
                yield return (0, ws);
                break;
            case Dat151ItemAudioSettings item:
                foreach (var w in item.Weapons ?? Array.Empty<Dat151ItemAudioSettingsItem>())
                {
                    if (_catalog.RelData.TryGetValue(w.Weapon, out var target) && target is Dat151WeaponSettings ws2)
                        yield return (w.Category, ws2);
                }
                if (_catalog.RelData.TryGetValue(item.FallBackWeapon, out var fb) && fb is Dat151WeaponSettings ws3)
                    yield return (0, ws3);
                break;
        }
    }

    /// <summary>Ein Slot je direktem Kind des Wurzel-Sounds (bei SoundSets: je ScriptName).</summary>
    private IEnumerable<SoundSlot> BuildSlots(string weapon, SlotKind kind, uint rootHash, string prefix)
    {
        if (!_catalog.RelData.TryGetValue(rootHash, out var root))
            throw new InvalidOperationException($"Sound {NameHints.Name(rootHash)} nicht in den Audio-Metadaten gefunden.");

        var children = new List<(string Name, uint Hash)>();
        if (root is Dat54SoundSet set)
        {
            foreach (var item in set.SoundSets ?? Array.Empty<Dat54SoundSetItem>())
                children.Add((NameHints.Name(item.ScriptName), item.ChildSound));
        }
        else if (root is Dat54SimpleSound)
        {
            children.Add((NameHints.Name(rootHash), rootHash));
        }
        else
        {
            var hashes = ChildHashes(root);
            for (var i = 0; i < hashes.Length; i++)
                children.Add((hashes.Length == 1 ? NameHints.Name(rootHash) : $"{NameHints.Name(hashes[i])}", hashes[i]));
        }

        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (name, hash) in children)
        {
            var leaves = new List<(Dat54SimpleSound Leaf, ChannelRole Role, string Path)>();
            Collect(hash, ChannelRole.Mono, NameHints.Name(rootHash) + " > " + name, 0, new HashSet<uint>(), leaves);
            if (leaves.Count == 0) continue;

            var slotName = prefix + name;
            var n = 2;
            while (!used.Add(slotName)) slotName = $"{prefix}{name}_{n++}";

            var slot = new SoundSlot
            {
                Weapon = weapon,
                Kind = kind,
                Name = slotName,
                Id = SoundSlot.MakeId(weapon, kind, slotName),
                Source = "auto",
                SoundPath = leaves[0].Path,
            };
            foreach (var (leaf, role, _) in leaves)
            {
                var entries = ToEntryRefs(leaf, role, out var problem);
                foreach (var entry in entries)
                {
                    if (!slot.Entries.Any(e => e.AwcPath == entry.AwcPath && e.StreamHash == entry.StreamHash)) slot.Entries.Add(entry);
                }
                if (entries.Count == 0 && problem != null)
                {
                    slot.SoundPath += $" | {problem}";
                }
            }
            if (slot.Entries.Count > 0) yield return slot;
        }
    }

    private static MetaHash[] ChildHashes(RelData rd)
    {
        try
        {
            return rd.GetSoundHashes() ?? (rd as RelSound)?.ChildSoundsHashes ?? Array.Empty<MetaHash>();
        }
        catch
        {
            return Array.Empty<MetaHash>();
        }
    }

    private void Collect(uint hash, ChannelRole role, string path, int depth, HashSet<uint> visited,
        List<(Dat54SimpleSound, ChannelRole, string)> leaves)
    {
        if (hash == 0 || depth > MaxDepth || !visited.Add(hash)) return;
        if (!_catalog.RelData.TryGetValue(hash, out var rd)) return;
        if (rd is Dat54SimpleSound simple)
        {
            leaves.Add((simple, role, path));
            return;
        }
        if (rd is Dat54CollapsingStereoSound stereo)
        {
            Collect(stereo.LeftSound, ChannelRole.Left, path + " > L", depth + 1, visited, leaves);
            Collect(stereo.RightSound, ChannelRole.Right, path + " > R", depth + 1, visited, leaves);
            return;
        }
        foreach (var child in ChildHashes(rd))
            Collect(child, role, path + " > " + NameHints.Name(child), depth + 1, visited, leaves);
    }

    /// <summary>
    /// Alle Fundorte eines SimpleSounds: die vom Spiel bevorzugte AWC plus jede weitere Kopie desselben Containers
    /// im Ordner x64\audio\sfx (z. B. WEAPONS_PLAYER.rpf und RESIDENT.rpf). Alle Kopien werden gleich ersetzt,
    /// damit das Spiel nie auf eine alte Kopie zurückfällt.
    /// </summary>
    public List<AwcEntryRef> ToEntryRefs(Dat54SimpleSound leaf, ChannelRole role, out string? problem)
    {
        problem = null;
        var result = new List<AwcEntryRef>();
        var best = _catalog.ResolveContainer(leaf.ContainerName, out var all);
        if (best == null)
        {
            problem = $"Container {NameHints.Name(leaf.ContainerName)} nicht gefunden";
            return result;
        }
        var locations = new List<AwcLocation> { best };
        locations.AddRange(all.Where(l => l != best && IsSfxArchive(l.VirtualPath)));
        foreach (var loc in locations.DistinctBy(l => l.VirtualPath.ToLowerInvariant()))
        {
            AwcStream stream;
            try
            {
                stream = AwcPatcher.FindStream(LoadAwc(loc.VirtualPath), leaf.FileName);
            }
            catch (AwcException)
            {
                problem ??= $"Wave {NameHints.Name(leaf.FileName)} fehlt in {loc.VirtualPath}";
                continue;
            }
            var info = AwcPatcher.Describe(stream);
            result.Add(new AwcEntryRef
            {
                AwcPath = loc.VirtualPath,
                StreamHash = info.Hash,
                StreamName = info.Name,
                Role = role,
                Codec = info.Codec,
                SampleRate = info.SampleRate,
                Samples = info.Samples,
                Channels = info.Channels,
            });
        }
        return result;
    }

    private static bool IsSfxArchive(string virtualPath) =>
        RpfAccess.Split(virtualPath).TopLevelRpf.StartsWith("x64\\audio\\sfx\\", StringComparison.OrdinalIgnoreCase);

    public static uint RootFor(Dat151WeaponSettings ws, SlotKind kind) => kind switch
    {
        SlotKind.Reload => ws.ReloadSounds,
        SlotKind.Fire => ws.FireSound,
        SlotKind.SuppressedFire => ws.SuppressedFireSound,
        _ => 0,
    };

    // ------------------------------------------------------------------ "ganzer Sound"-Planung

    /// <summary>Ein AWC-Eintrag im Plan: Primary = bekommt den Sound, sonst wird er stummgeschaltet.</summary>
    public sealed record PlannedEntry(AwcEntryRef Entry, bool Primary, string Path);

    /// <summary>Bevorzugte Teile eines Reload-SoundSets für den ganzen Reload (dort beginnt die Animation).</summary>
    public static readonly string[] ReloadStartNames = { "mag_out", "magazine_out", "clip_out", "reload", "reload_start", "start" };

    /// <summary>
    /// Plant, wie EIN ganzer Sound (ganzer Schuss, ganzer Reload) in den Sound-Baum einer Waffe kommt:
    /// Varianten (Randomized) bekommen ihn alle, von gleichzeitig gespielten Ebenen (Multitrack) nur die längste,
    /// von nacheinander gespielten Teilen (Sequential, SoundSet-Teile eines Reloads) nur der erste – die übrigen
    /// werden stumm, damit nichts doppelt oder über den eigenen Sound spielt.
    /// </summary>
    public List<PlannedEntry> PlanWholeSound(WeaponDefinition weapon, SlotKind kind, List<string> notes)
    {
        var audioItem = weapon.AudioItem;
        if (string.IsNullOrWhiteSpace(audioItem) && !_catalog.WeaponAudioItems.TryGetValue(weapon.Name, out audioItem))
            audioItem = "AUDIO_ITEM_" + (weapon.Name.StartsWith("WEAPON_", StringComparison.OrdinalIgnoreCase) ? weapon.Name[7..] : weapon.Name);
        NameHints.AddWeapon(weapon.Name);
        var leaves = new Dictionary<string, PlannedEntry>(StringComparer.OrdinalIgnoreCase);
        var roots = FindWeaponSettings(Hashing.Joaat(audioItem!)).Select(x => RootFor(x.Settings, kind)).Where(h => h != 0).Distinct().ToList();
        if (roots.Count == 0)
        {
            notes.Add($"{weapon.Name}/{kind}: kein Sound in den Audio-Metadaten (Audio-Item '{audioItem}').");
            return new List<PlannedEntry>();
        }
        foreach (var root in roots)
            Plan(root, true, ChannelRole.Mono, NameHints.Name(root), 0, new HashSet<uint>(), kind, leaves);
        if (!leaves.Values.Any(l => l.Primary))
            notes.Add($"{weapon.Name}/{kind}: Sound-Baum gefunden, aber kein ersetzbarer Eintrag.");
        return leaves.Values.ToList();
    }

    private void Plan(uint hash, bool primary, ChannelRole role, string path, int depth, HashSet<uint> visited, SlotKind kind,
        Dictionary<string, PlannedEntry> leaves)
    {
        if (hash == 0 || depth > MaxDepth || !visited.Add(hash)) return;
        if (!_catalog.RelData.TryGetValue(hash, out var rd)) return;
        try
        {
            switch (rd)
            {
                case Dat54SimpleSound simple:
                    foreach (var e in ToEntryRefs(simple, role, out _))
                    {
                        var key = e.AwcPath + "|" + e.StreamHash;
                        // ein Eintrag, der irgendwo den Sound bekommt, wird nie stummgeschaltet
                        if (!leaves.TryGetValue(key, out var old) || (!old.Primary && primary))
                            leaves[key] = new PlannedEntry(e, primary, path);
                    }
                    return;
                case Dat54CollapsingStereoSound stereo:
                    Plan(stereo.LeftSound, primary, ChannelRole.Left, path + " > L", depth + 1, visited, kind, leaves);
                    Plan(stereo.RightSound, primary, ChannelRole.Right, path + " > R", depth + 1, visited, kind, leaves);
                    return;
                case Dat54SoundSet set:
                {
                    var items = set.SoundSets ?? Array.Empty<Dat54SoundSetItem>();
                    var chosen = ChooseSetItem(items, kind);
                    foreach (var it in items)
                        Plan(it.ChildSound, primary && it.ChildSound == chosen, role, path + " > " + NameHints.Name(it.ScriptName), depth + 1, visited, kind, leaves);
                    return;
                }
                case Dat54MultitrackSound:
                {
                    var children = ChildHashes(rd);
                    var longest = children.OrderByDescending(c => Duration(c, 0, new HashSet<uint>())).FirstOrDefault();
                    foreach (var c in children)
                        Plan(c, primary && c == longest, role, path + " > " + NameHints.Name(c), depth + 1, visited, kind, leaves);
                    return;
                }
                case Dat54SequentialSound:
                case Dat54SequentialOverlapSound:
                {
                    var children = ChildHashes(rd);
                    for (var i = 0; i < children.Length; i++)
                        Plan(children[i], primary && i == 0, role, path + " > " + NameHints.Name(children[i]), depth + 1, visited, kind, leaves);
                    return;
                }
                default:
                    foreach (var c in ChildHashes(rd))
                        Plan(c, primary, role, path + " > " + NameHints.Name(c), depth + 1, visited, kind, leaves);
                    return;
            }
        }
        finally
        {
            visited.Remove(hash); // derselbe Sound darf in anderem Zweig erneut geplant werden (z. B. als primär)
        }
    }

    private uint ChooseSetItem(Dat54SoundSetItem[] items, SlotKind kind)
    {
        if (items.Length == 0) return 0;
        if (kind == SlotKind.Reload)
        {
            foreach (var want in ReloadStartNames)
            {
                var hit = items.FirstOrDefault(i => NameHints.Name(i.ScriptName).EndsWith(want, StringComparison.OrdinalIgnoreCase));
                if (hit != null) return hit.ChildSound;
            }
        }
        // sonst: der Teil mit dem längsten Sound (bei Reload-Sets meist der eigentliche Nachladevorgang)
        return items.OrderByDescending(i => Duration(i.ChildSound, 0, new HashSet<uint>())).First().ChildSound;
    }

    /// <summary>Längste Dauer eines Teilbaums in Sekunden (über alle Einträge).</summary>
    private double Duration(uint hash, int depth, HashSet<uint> visited)
    {
        if (hash == 0 || depth > MaxDepth || !visited.Add(hash) || !_catalog.RelData.TryGetValue(hash, out var rd)) return 0;
        if (rd is Dat54SimpleSound s)
            return ToEntryRefs(s, ChannelRole.Mono, out _).Select(e => e.DurationSeconds).DefaultIfEmpty(0).Max();
        return ChildHashes(rd).Select(c => Duration(c, depth + 1, visited)).DefaultIfEmpty(0).Max();
    }

    public AwcFile LoadAwc(string virtualPath)
    {
        if (_awcCache.TryGetValue(virtualPath, out var a)) return a;
        var data = _catalog.ExtractFile(virtualPath);
        a = AwcPatcher.Load(data, Path.GetFileName(virtualPath));
        _awcCache[virtualPath] = a;
        return a;
    }
}
