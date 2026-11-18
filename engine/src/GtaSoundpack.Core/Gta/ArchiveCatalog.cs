using System.Text;
using System.Text.RegularExpressions;
using CodeWalker.GameFiles;
using GtaSoundpack.Core.Util;

namespace GtaSoundpack.Core.Gta;

/// <summary>Fundort einer AWC (virtueller Pfad) mit Priorität (höher = wird vom Spiel bevorzugt).</summary>
public sealed record AwcLocation(string VirtualPath, int Priority, string ContainerName);

/// <summary>
/// Durchsucht die für Audio relevanten Archive einer GTA-Installation (nur lesend):
/// Basis-Audio, update.rpf und alle DLC-Packs. Indiziert AWCs nach Container-Hash,
/// lädt die Audio-Metadaten (*.dat151.rel / *.dat54.rel) und liest Waffen-→Audio-Zuordnungen aus weapons*.meta.
/// </summary>
public sealed class ArchiveCatalog
{
    private readonly Dictionary<uint, List<AwcLocation>> _containers = new();
    private readonly Dictionary<uint, RelData> _relData = new();
    private readonly Dictionary<string, string> _weaponAudio = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, RpfFile> _roots = new(StringComparer.OrdinalIgnoreCase);
    private readonly List<string> _awcPaths = new();

    private ArchiveCatalog(GtaInstallation gta) => Gta = gta;

    public GtaInstallation Gta { get; }
    public IReadOnlyList<string> Errors => _errors;
    private readonly List<string> _errors = new();
    public IReadOnlyDictionary<uint, RelData> RelData => _relData;
    public IReadOnlyDictionary<string, string> WeaponAudioItems => _weaponAudio;
    public IReadOnlyList<string> AllAwcPaths => _awcPaths;
    public IEnumerable<string> RootArchives => _roots.Keys;

    public static ArchiveCatalog Build(GtaInstallation gta, Action<string>? status = null, bool loadMetadata = true)
    {
        if (!KeyManager.KeysLoaded) throw new GtaException("Bitte zuerst die Keys laden.");
        var cat = new ArchiveCatalog(gta);
        NameHints.EnsureLoaded();
        var roots = EnumerateRoots(gta).ToList();
        for (var i = 0; i < roots.Count; i++)
        {
            var rel = roots[i];
            status?.Invoke($"Scanne {rel} ({i + 1}/{roots.Count}) …");
            RpfFile rpf;
            try
            {
                rpf = RpfAccess.OpenRoot(gta.GetAbsolute(rel), rel);
            }
            catch (Exception ex)
            {
                cat._errors.Add(ex.Message);
                continue;
            }
            cat._roots[rel] = rpf;
            cat.Index(rpf, i, loadMetadata);
        }
        return cat;
    }

    /// <summary>Reihenfolge = Priorität: Basis < update.rpf < DLC-Packs (alphabetisch, Patchdays zuletzt).</summary>
    internal static IEnumerable<string> EnumerateRoots(GtaInstallation gta)
    {
        string Rel(string abs) => Path.GetRelativePath(gta.Folder, abs);
        var audio = Path.Combine(gta.Folder, "x64", "audio");
        if (Directory.Exists(audio))
            foreach (var f in Directory.GetFiles(audio, "*.rpf").OrderBy(x => x, StringComparer.OrdinalIgnoreCase)) yield return Rel(f);
        if (Directory.Exists(gta.SfxFolder))
            foreach (var f in Directory.GetFiles(gta.SfxFolder, "*.rpf").OrderBy(x => x, StringComparer.OrdinalIgnoreCase)) yield return Rel(f);
        foreach (var u in new[] { "update.rpf", "update2.rpf" })
        {
            var p = Path.Combine(gta.Folder, "update", u);
            if (File.Exists(p)) yield return Rel(p);
        }
        var dlc = Path.Combine(gta.Folder, "update", "x64", "dlcpacks");
        if (Directory.Exists(dlc))
        {
            var packs = Directory.GetDirectories(dlc)
                .Select(d => Path.Combine(d, "dlc.rpf"))
                .Where(File.Exists)
                .OrderBy(p => p.Contains("patchday", StringComparison.OrdinalIgnoreCase) ? 1 : 0)
                .ThenBy(p => p, StringComparer.OrdinalIgnoreCase);
            foreach (var p in packs) yield return Rel(p);
        }
    }

    private void Index(RpfFile root, int priority, bool loadMetadata)
    {
        foreach (var e in RpfAccess.AllFiles(root))
        {
            var name = e.NameLower;
            try
            {
                if (name.EndsWith(".awc"))
                {
                    var vpath = e.Path;
                    _awcPaths.Add(vpath);
                    foreach (var container in ContainerNames(vpath))
                    {
                        var h = Hashing.Joaat(container);
                        if (!_containers.TryGetValue(h, out var list)) _containers[h] = list = new List<AwcLocation>();
                        list.Add(new AwcLocation(vpath, priority, container));
                        JenkIndex.Ensure(container);
                    }
                }
                else if (loadMetadata && name.EndsWith(".rel") && (name.Contains(".dat151") || name.Contains(".dat54")))
                {
                    var data = RpfAccess.Extract(e);
                    var rel = new RelFile();
                    rel.Load(data, e);
                    foreach (var rd in rel.RelDatas ?? Array.Empty<RelData>())
                    {
                        _relData[rd.NameHash] = rd; // spätere Archive (Updates/DLCs) überschreiben
                    }
                }
                else if (loadMetadata && name.StartsWith("weapon") && name.EndsWith(".meta"))
                {
                    var data = RpfAccess.Extract(e);
                    ParseWeaponsMeta(data);
                }
            }
            catch (Exception ex)
            {
                _errors.Add($"{e.Path}: {ex.Message}");
            }
        }
    }

    /// <summary>
    /// Mögliche Container-Namen einer AWC, wie sie in SimpleSound.ContainerName referenziert werden,
    /// z. B. "resident/weapons" für x64\audio\sfx\RESIDENT.rpf\weapons.awc.
    /// </summary>
    public static IEnumerable<string> ContainerNames(string virtualPath)
    {
        var parts = RpfAccess.NormalizeVirtual(virtualPath).ToLowerInvariant().Split('\\');
        var file = Path.GetFileNameWithoutExtension(parts[^1]);
        var result = new List<string>();
        if (parts.Length >= 2)
        {
            var parent = parts[^2];
            if (parent.EndsWith(".rpf")) parent = parent[..^4];
            result.Add(parent + "/" + file);
        }
        var sfx = Array.LastIndexOf(parts, "sfx");
        if (sfx >= 0 && sfx < parts.Length - 2)
        {
            var rel = string.Join("/", parts.Skip(sfx + 1).Select(p => p.EndsWith(".rpf") ? p[..^4] : p));
            rel = rel[..^4]; // ".awc"
            if (!result.Contains(rel)) result.Add(rel);
        }
        return result;
    }

    private static readonly Regex WeaponBlock = new(@"<Name>\s*(WEAPON_[A-Z0-9_]+)\s*</Name>.*?<Audio>\s*([A-Za-z0-9_]+)\s*</Audio>",
        RegexOptions.Singleline | RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private void ParseWeaponsMeta(byte[] data)
    {
        if (data.Length < 8 || (data[0] != '<' && data[0] != 0xEF)) return; // nur XML-Metas
        var text = Encoding.UTF8.GetString(data);
        foreach (var block in text.Split("CWeaponInfo\"", StringSplitOptions.None).Skip(1))
        {
            var m = WeaponBlock.Match(block);
            if (!m.Success) continue;
            _weaponAudio[m.Groups[1].Value.ToUpperInvariant()] = m.Groups[2].Value;
            JenkIndex.Ensure(m.Groups[2].Value.ToLowerInvariant());
        }
    }

    /// <summary>Löst einen Container-Hash auf die vom Spiel bevorzugte AWC auf.</summary>
    public AwcLocation? ResolveContainer(uint containerHash, out IReadOnlyList<AwcLocation> alternatives)
    {
        if (_containers.TryGetValue(containerHash, out var list) && list.Count > 0)
        {
            alternatives = list;
            return list.OrderByDescending(l => l.Priority).First();
        }
        alternatives = Array.Empty<AwcLocation>();
        return null;
    }

    public RpfFile GetRoot(string topLevelRelative) =>
        _roots.TryGetValue(topLevelRelative, out var r) ? r : throw new GtaException($"Archiv '{topLevelRelative}' ist nicht im Katalog.");

    public byte[] ExtractFile(string virtualPath)
    {
        var (top, _) = RpfAccess.Split(virtualPath);
        var root = _roots.TryGetValue(top, out var r) ? r : RpfAccess.OpenRoot(Gta.GetAbsolute(top), top);
        _roots[top] = root;
        var entry = RpfAccess.FindFile(root, virtualPath) ?? throw new GtaException($"Datei '{virtualPath}' nicht gefunden.");
        return RpfAccess.Extract(entry);
    }
}

/// <summary>Bekannte Klartextnamen, damit Hashes in der Oberfläche lesbar werden (rein kosmetisch).</summary>
public static class NameHints
{
    private static bool _loaded;

    public static readonly string[] SlotWords =
    {
        "reload", "mag_out", "mag_in", "magazine_out", "magazine_in", "clip_out", "clip_in", "slide", "slide_back",
        "slide_forward", "slide_release", "slide_pull", "bolt", "bolt_back", "bolt_forward", "cock", "hammer",
        "safety", "shell_in", "pump", "draw", "holster", "tap", "rack", "mag_drop", "mag_tap", "empty",
        "fire", "fire_player", "report", "tail", "echo", "mech", "body", "single_shot",
    };

    public static void EnsureLoaded()
    {
        if (_loaded) return;
        _loaded = true;
        var strings = Path.Combine(AppContext.BaseDirectory, "strings.txt");
        if (File.Exists(strings))
            foreach (var l in File.ReadLines(strings)) JenkIndex.Ensure(l.Trim());
        foreach (var w in SlotWords) JenkIndex.Ensure(w);
        foreach (var w in new[] { "resident/weapons", "weapons_player/ptl_pistol", "weapons_player/ptl_pistol50" }) JenkIndex.Ensure(w);
    }

    public static void AddWeapon(string weaponName)
    {
        var w = weaponName.ToLowerInvariant();
        JenkIndex.Ensure(w);
        var bare = w.StartsWith("weapon_") ? w[7..] : w;
        foreach (var prefix in new[] { "audio_item_", "" })
            JenkIndex.Ensure(prefix + bare);
        foreach (var word in SlotWords)
        {
            JenkIndex.Ensure($"{bare}_{word}");
            JenkIndex.Ensure($"{word}_{bare}");
            JenkIndex.Ensure($"weapons_{bare}_{word}");
        }
    }

    public static string Name(uint hash)
    {
        if (hash == 0) return "0";
        var s = JenkIndex.TryGetString(hash);
        return string.IsNullOrEmpty(s) ? "0x" + hash.ToString("X8") : s;
    }
}
