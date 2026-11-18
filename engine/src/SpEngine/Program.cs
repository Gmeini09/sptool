// spengine – Brücke zwischen SP Tool (SPTool.exe / Go) und der C#-Soundpack-Engine.
//
//   spengine plan  <request.json>   → welche AWC-Einträge pro Waffe/Slot ersetzt bzw. stummgeschaltet würden
//   spengine build <request.json>   → baut die RPFs in request.workDir, prüft sie und meldet die Ausgabedateien
//
// Fortschritt: Zeilen "PROGRESS <text>" auf stderr. Ergebnis: genau ein JSON-Objekt auf stdout (immer, auch bei Fehlern).
// Der GTA-Ordner wird nur gelesen; geschrieben wird ausschließlich in workDir.
using System.Text.Json;
using System.Text.Json.Serialization;
using CodeWalker.GameFiles;
using GtaSoundpack.Core.Audio;
using GtaSoundpack.Core.Build;
using GtaSoundpack.Core.Gta;
using GtaSoundpack.Core.Mapping;
using GtaSoundpack.Core.Project;
using GtaSoundpack.Core.Util;

namespace SpEngine;

public sealed class SoundRequest
{
    /// <summary>WEAPON_PISTOL, WEAPON_PISTOL_MK2, WEAPON_PISTOL50 …</summary>
    public string Weapon { get; set; } = "";
    /// <summary>fire | suppressed_fire | reload</summary>
    public string Slot { get; set; } = "";
    /// <summary>WAV-Datei (absolut oder relativ zu workDir).</summary>
    public string File { get; set; } = "";
}

public sealed class EngineRequest
{
    public string GtaFolder { get; set; } = "";
    public string WorkDir { get; set; } = "";
    public string PackName { get; set; } = "Soundpack";
    /// <summary>ng (Standard, wie Community-Packs) oder open (OpenIV-Format).</summary>
    public string Encryption { get; set; } = "ng";
    /// <summary>Archive, die immer in der Ausgabe liegen sollen (unverändert kopiert, wenn nichts darin ersetzt wird).</summary>
    public List<string> IncludeArchives { get; set; } = new();
    public List<SoundRequest> Sounds { get; set; } = new();
    /// <summary>
    /// Ohne GTA-Ordner: welche Stream-IDs je "WAFFE/slot" ersetzt werden (aus SP Tools mitgelieferter Zuordnung).
    /// Mit GTA-Ordner wird das aus den Spieldaten ermittelt und diese Liste ignoriert.
    /// </summary>
    public Dictionary<string, List<uint>> Streams { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    /// <summary>import: Dateien/Ordner mit GTA5.exe und/oder Original-Archiven (auch ZIPs).</summary>
    public List<string> Files { get; set; } = new();
}

public sealed class PlanEntryDto
{
    public string AwcPath { get; set; } = "";
    public string Stream { get; set; } = "";
    public string Name { get; set; } = "";
    public bool Primary { get; set; }
    public double Seconds { get; set; }
    public int SampleRate { get; set; }
    public string Codec { get; set; } = "";
}

public sealed class OutputDto
{
    public string Name { get; set; } = "";
    public string RelativePath { get; set; } = "";
    public string Path { get; set; } = "";
    public long Size { get; set; }
    public bool Changed { get; set; }
}

public sealed class EngineResult
{
    public bool Ok { get; set; }
    public string? Error { get; set; }
    public string GameVersion { get; set; } = "";
    public List<string> Notes { get; set; } = new();
    public List<string> Warnings { get; set; } = new();
    public Dictionary<string, List<PlanEntryDto>> Plan { get; set; } = new();
    public List<OutputDto> Outputs { get; set; } = new();
    public int ReplacedStreams { get; set; }
    public int MutedStreams { get; set; }
    public string Report { get; set; } = "";
    /// <summary>Ohne GTA bauen möglich: Schlüssel gespeichert bzw. alle Original-Archive importiert.</summary>
    public bool HaveKeys { get; set; }
    public bool HaveOriginals { get; set; }
    /// <summary>import: was in den gewählten Dateien gefunden wurde.</summary>
    public List<string> Imported { get; set; } = new();
}

public static class Program
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
        Converters = { new JsonStringEnumConverter() },
        PropertyNameCaseInsensitive = true,
    };

    private static readonly Dictionary<string, SlotKind> Slots = new(StringComparer.OrdinalIgnoreCase)
    {
        ["fire"] = SlotKind.Fire,
        ["suppressed_fire"] = SlotKind.SuppressedFire,
        ["reload"] = SlotKind.Reload,
    };

    public static int Main(string[] args)
    {
        var result = new EngineResult();
        try
        {
            if (args.Length >= 1 && args[0] == "status")
            {
                Status(result);
            }
            else if (args.Length >= 4 && args[0] == "extract")
            {
                // Fehlersuche: spengine extract <archiv.rpf> <datei.awc> <ziel> – eine Datei roh (entschlüsselt) auspacken
                KeyManager.LoadStoredKeys(Progress);
                var root = RpfAccess.OpenRoot(args[1], Path.GetFileName(args[1]));
                var e = RpfAccess.AllFiles(root).FirstOrDefault(x => x.NameLower == args[2].ToLowerInvariant())
                        ?? throw new FileNotFoundException(args[2]);
                var bytes = RpfAccess.Extract(e);
                // Rockstars AWCs sind als Ganzes verschlüsselt – zum Vergleichen entschlüsselt ausgeben
                if (e.NameLower.EndsWith(".awc") && bytes.Length % 4 == 0 && BitConverter.ToUInt32(bytes, 0) is not (0x54414441 or 0x41444154))
                    AwcFile.Decrypt_RSXXTEA(bytes);
                File.WriteAllBytes(args[3], bytes);
                result.Ok = true;
            }
            else if (args.Length >= 4 && args[0] == "wavcheck")
            {
                // Fehlersuche: spengine wavcheck <archiv.rpf> <datei.awc> <wav> … – steckt genau diese WAV im Archiv?
                // Vergleicht Samplerate, Länge und die Samples (Mono, 16 Bit) jedes Eintrags der AWC mit jeder WAV.
                KeyManager.LoadStoredKeys(Progress);
                var root = RpfAccess.OpenRoot(args[1], Path.GetFileName(args[1]));
                var e = RpfAccess.AllFiles(root).First(x => x.NameLower == args[2].ToLowerInvariant());
                var awc = GtaSoundpack.Core.Awc.AwcPatcher.Load(RpfAccess.Extract(e), e.Name);
                var sb = new System.Text.StringBuilder();
                foreach (var s in awc.Streams)
                {
                    var pcm = s.GetPcmData().AsSpan(0, s.SampleCount * 2).ToArray();
                    sb.Append($"{Path.GetFileName(args[1])}\\{e.Name} 0x{(uint)s.Hash:X8}: {s.SamplesPerSecond} Hz, {s.SampleCount} Samples ({(double)s.SampleCount / s.SamplesPerSecond:0.000}s)");
                    foreach (var wav in args.Skip(3))
                    {
                        var w = AudioProcessor.ConvertChannels(AudioDecoder.Load(wav), 1);
                        var wp = w.ToPcm16();
                        var same = w.SampleRate == s.SamplesPerSecond && wp.Length <= pcm.Length && pcm.AsSpan(0, wp.Length).SequenceEqual(wp);
                        sb.Append($" | {Path.GetFileName(wav)}: {(same ? "GLEICH" : "anders")}");
                    }
                    sb.AppendLine();
                }
                result.Report = sb.ToString();
                result.Ok = true;
            }
            else if (args.Length >= 2 && args[0] == "ngcheck")
            {
                // Fehlersuche: entschlüsselt das Inhaltsverzeichnis eines NG-Archivs, verschlüsselt es mit den berechneten
                // Tabellen neu und vergleicht mit den Original-Bytes (gleich = unsere NG-Verschlüsselung ist exakt Rockstars)
                KeyManager.LoadStoredKeys(Progress);
                KeyManager.EnsureEncryptionTables(Progress);
                var sb = new System.Text.StringBuilder();
                foreach (var file in args.Skip(1))
                {
                    var all = File.ReadAllBytes(file);
                    var count = BitConverter.ToUInt32(all, 4);
                    var namesLen = BitConverter.ToUInt32(all, 8);
                    var enc = all.AsSpan(16, (int)(count * 16 + namesLen)).ToArray();
                    var plain = GTACrypto.DecryptNG((byte[])enc.Clone(), Path.GetFileName(file), (uint)all.Length);
                    var again = GTACrypto.EncryptNG((byte[])plain.Clone(), Path.GetFileName(file), (uint)all.Length);
                    var same = again.AsSpan().SequenceEqual(enc);
                    var firstDiff = same ? -1 : again.AsSpan().CommonPrefixLength(enc);
                    sb.AppendLine($"{file}: {enc.Length} Bytes Inhaltsverzeichnis – neu verschlüsselt {(same ? "IDENTISCH" : $"ABWEICHEND ab Byte {firstDiff}")}");
                }
                result.Report = sb.ToString();
                result.Ok = true;
            }
            else if (args.Length >= 2 && args[0] == "toc")
            {
                // Fehlersuche: spengine toc <archiv.rpf> – entschlüsseltes Inhaltsverzeichnis Eintrag für Eintrag (roh)
                KeyManager.LoadStoredKeys(Progress);
                var sb = new System.Text.StringBuilder();
                foreach (var file in args.Skip(1))
                {
                    var all = File.ReadAllBytes(file);
                    var count = BitConverter.ToUInt32(all, 4);
                    var namesLen = BitConverter.ToUInt32(all, 8);
                    var enc = BitConverter.ToUInt32(all, 12);
                    var toc = all.AsSpan(16, (int)(count * 16 + namesLen)).ToArray();
                    if (enc == 0x0FEFFFFF) toc = GTACrypto.DecryptNG(toc, Path.GetFileName(file), (uint)all.Length);
                    sb.AppendLine($"== {Path.GetFileName(file)} len={all.Length} count={count} namesLen={namesLen} enc=0x{enc:X8}");
                    var names = toc.AsSpan((int)(count * 16));
                    for (var i = 0; i < count; i++)
                    {
                        var en = toc.AsSpan(i * 16, 16);
                        var nameOff = BitConverter.ToUInt16(en);
                        var end = names[nameOff..].IndexOf((byte)0);
                        var nm = System.Text.Encoding.ASCII.GetString(names.Slice(nameOff, end < 0 ? 0 : end));
                        sb.AppendLine($"  [{i,2}] {Convert.ToHexString(en)}  {nm}");
                    }
                    sb.AppendLine("  names: " + Convert.ToHexString(names).TrimEnd('0'));
                }
                result.Report = sb.ToString();
                result.Ok = true;
            }
            else if (args.Length >= 2 && args[0] == "inspect")
            {
                Inspect(args.Skip(1).ToList(), result);
            }
            else
            {
                if (args.Length < 2 || args[0] is not ("plan" or "build" or "import"))
                    throw new ArgumentException("Aufruf: spengine status | plan|build|import <request.json>");
                var req = JsonSerializer.Deserialize<EngineRequest>(File.ReadAllText(args[1]), JsonOpts)
                          ?? throw new InvalidDataException("Leere Anfrage.");
                if (args[0] == "import") Import(req, result);
                else Run(args[0], req, result);
            }
        }
        catch (Exception ex)
        {
            result.Ok = false;
            result.Error = ex is GtaException or ArgumentException or InvalidDataException or InvalidOperationException
                ? ex.Message
                : $"{ex.GetType().Name}: {ex.Message}";
        }
        Console.Out.Write(JsonSerializer.Serialize(result, JsonOpts));
        Console.Out.Flush();
        return result.Ok ? 0 : 1;
    }

    private static void Progress(string s)
    {
        Console.Error.WriteLine("PROGRESS " + s.Replace('\n', ' '));
        Console.Error.Flush();
    }

    private static readonly Dictionary<SlotKind, string> SlotNames = new()
    {
        [SlotKind.Fire] = "fire",
        [SlotKind.SuppressedFire] = "suppressed_fire",
        [SlotKind.Reload] = "reload",
    };

    /// <summary>
    /// Fehlersuche: öffnet fertige Archive (WEAPONS_PLAYER.rpf / RESIDENT.rpf) und vergleicht jede AWC mit Rockstars Original:
    /// Verschlüsselung, Flags, geänderte Sounds samt Format. Ergebnis als Text in result.report.
    /// </summary>
    public static void Inspect(List<string> files, EngineResult result)
    {
        KeyManager.LoadStoredKeys(Progress);
        var sb = new System.Text.StringBuilder();
        foreach (var file in files)
        {
            var name = Path.GetFileName(file);
            var k = OriginalArchives.Legacy.FirstOrDefault(a => a.Name.Equals(name, StringComparison.OrdinalIgnoreCase));
            var hdr = new byte[16];
            using (var fs = File.OpenRead(file)) fs.ReadExactly(hdr);
            sb.AppendLine($"== {file} ({new FileInfo(file).Length} Bytes, Einträge {BitConverter.ToUInt32(hdr, 4)}, Verschlüsselung 0x{BitConverter.ToUInt32(hdr, 12):X8})");
            var root = RpfAccess.OpenRoot(file, k?.Relative ?? name);
            RpfFile? orig = null;
            if (k != null && OriginalArchives.HaveAll()) orig = RpfAccess.OpenRoot(Path.Combine(OriginalArchives.DefaultCacheDir, k.Name), k.Relative);
            foreach (var e in RpfAccess.AllFiles(root).OrderBy(x => x.NameLower))
            {
                var raw = RpfAccess.Extract(e);
                var bin = e as RpfBinaryFileEntry;
                var line = $"  {e.Name,-26} {raw.Length,10} B  offset {(bin?.FileOffset ?? 0) * 512,10}  enc={bin?.IsEncrypted} size={bin?.FileSize}";
                var oe = orig?.AllEntries.OfType<RpfFileEntry>().FirstOrDefault(x => x.NameLower == e.NameLower);
                var oraw = oe != null ? RpfAccess.Extract(oe) : null;
                if (oraw != null && raw.AsSpan().SequenceEqual(oraw)) { sb.AppendLine(line + "  = Original"); continue; }
                sb.AppendLine(line + (oraw == null ? "  (kein Original)" : "  GEÄNDERT"));
                if (!e.NameLower.EndsWith(".awc")) continue;
                try
                {
                    var magic = BitConverter.ToUInt32(raw, 0);
                    var awc = GtaSoundpack.Core.Awc.AwcPatcher.Load(raw, e.Name);
                    sb.AppendLine($"    AWC: offen={(magic == 0x54414441)} Flags=0x{awc.Flags:X4} Streams={awc.StreamCount} WholeFileEnc={awc.WholeFileEncrypted}");
                    var oawc = oraw != null ? GtaSoundpack.Core.Awc.AwcPatcher.Load(oraw, e.Name) : null;
                    foreach (var s in awc.Streams)
                    {
                        if (awc.MultiChannelFlag && s == awc.MultiChannelSource) continue;
                        var os = oawc?.Streams.FirstOrDefault(x => (uint)x.Hash == (uint)s.Hash);
                        var a = s.GetPcmData();
                        var b = os?.GetPcmData();
                        if (b != null && a.AsSpan().SequenceEqual(b)) continue;
                        var fc = s.FormatChunk;
                        var peak = GtaSoundpack.Core.Awc.AwcPatcher.Decode(s).GetStats();
                        sb.AppendLine($"    Stream 0x{(uint)s.Hash:X8}: {fc?.Codec} {s.SamplesPerSecond} Hz {s.SampleCount} Samples, Headroom {fc?.Headroom}, Loop {fc?.LoopPoint}/{fc?.LoopBegin}/{fc?.LoopEnd}, PlayEnd {fc?.PlayEnd}, Peak {peak.PeakDbfs:0.0} dB, RMS {peak.RmsDbfs:0.0} dB"
                                      + (os != null ? $"  | Original: {os.FormatChunk?.Codec} {os.SamplesPerSecond} Hz {os.SampleCount} Samples, Headroom {os.FormatChunk?.Headroom}, Loop {os.FormatChunk?.LoopPoint}/{os.FormatChunk?.LoopBegin}/{os.FormatChunk?.LoopEnd}, PlayEnd {os.FormatChunk?.PlayEnd}" : "  | neu"));
                    }
                }
                catch (Exception ex)
                {
                    sb.AppendLine("    AWC nicht lesbar: " + ex.Message);
                }
            }
        }
        result.Report = sb.ToString();
        result.Ok = true;
    }

    /// <summary>Kann ohne GTA gebaut werden? (Schlüssel + Original-Archive einmal importiert)</summary>
    public static void Status(EngineResult result)
    {
        result.HaveKeys = KeyManager.HasStoredKeys;
        result.HaveOriginals = OriginalArchives.HaveAll();
        result.Ok = true;
    }

    /// <summary>Einmal-Import für den Betrieb ohne GTA: GTA5.exe → Schlüssel, Original-Archive (auch in ZIPs/Ordnern) → Sicherung.</summary>
    public static void Import(EngineRequest req, EngineResult result)
    {
        foreach (var f in req.Files)
        {
            if (!File.Exists(f) && !Directory.Exists(f)) throw new FileNotFoundException($"Nicht gefunden: {f}");
            if (File.Exists(f) && Path.GetFileName(f).Equals("GTA5_Enhanced.exe", StringComparison.OrdinalIgnoreCase))
                throw new GtaException("Das ist die GTA5_Enhanced.exe – SP Tool braucht die GTA5.exe von GTA V Legacy.");
            if (File.Exists(f) && Path.GetExtension(f).Equals(".exe", StringComparison.OrdinalIgnoreCase))
            {
                KeyManager.ImportFromExe(f, Progress);
                result.Imported.Add("GTA-Schlüssel");
                continue;
            }
            result.Imported.AddRange(OriginalArchives.Import(f, Progress));
        }
        result.Imported = result.Imported.Distinct().ToList();
        Status(result);
        if (result.Imported.Count == 0)
            result.Notes.Add("In den gewählten Dateien war weder eine GTA5.exe (Legacy) noch eine unveränderte Original-Datei (WEAPONS_PLAYER.rpf / RESIDENT.rpf).");
    }

    public static void Run(string command, EngineRequest req, EngineResult result)
    {
        var offline = string.IsNullOrWhiteSpace(req.GtaFolder);
        GtaInstallation gta;
        Func<WeaponDefinition, SlotKind, List<SlotResolver.PlannedEntry>> planWhole;
        var weapons = WeaponsConfig.LoadOrDefault(null);
        if (offline)
        {
            // Ohne GTA: importierte Originale + gespeicherte Schlüssel, Zuordnung aus SP Tools Liste (Stream-IDs)
            if (!OriginalArchives.HaveAll())
                throw new GtaException("Kein GTA-Ordner und noch keine Original-Dateien importiert. Bitte einmal die Original-Dateien " +
                                       "(WEAPONS_PLAYER.rpf und RESIDENT.rpf, z. B. „Original GTA V Soundpack“) und eine GTA5.exe (Legacy) importieren.");
            gta = GtaInstallation.Offline(OriginalArchives.DefaultCacheDir);
            result.GameVersion = gta.GameVersion;
            KeyManager.LoadKeys(gta, Progress);
            var index = StreamIndex(gta);
            planWhole = (def, kind) =>
            {
                var key = $"{def.Name}/{SlotNames[kind]}";
                if (!req.Streams.TryGetValue(key, out var ids) || ids.Count == 0) return new();
                var list = new List<SlotResolver.PlannedEntry>();
                foreach (var id in ids.Distinct())
                {
                    if (index.TryGetValue(id & 0x1FFFFFFF, out var refs)) list.AddRange(refs.Select(r => new SlotResolver.PlannedEntry(r, true, "Zuordnung SP Tool")));
                    else result.Notes.Add($"{key}: Sound 0x{id:X8} ist in den Original-Dateien nicht enthalten.");
                }
                return list;
            };
        }
        else
        {
            gta = GtaInstallation.Open(req.GtaFolder);
            result.GameVersion = gta.GameVersion;
            KeyManager.LoadKeys(gta, Progress);
            // Immer Rockstars Originale als Grundlage – auch wenn in x64\audio\sfx schon ein Soundpack liegt.
            OriginalArchives.Ensure(gta, result.Notes, Progress);
            var catalog = ArchiveCatalog.Build(gta, Progress);
            var resolver = new SlotResolver(catalog);
            planWhole = (def, kind) => resolver.PlanWholeSound(def, kind, result.Notes);
        }

        // 1) planen: je (Waffe, Slot) die Einträge, die den Sound bekommen bzw. stumm werden
        var wanted = new Dictionary<(string Weapon, SlotKind Kind), string>();
        foreach (var s in req.Sounds)
        {
            if (!Slots.TryGetValue(s.Slot, out var kind)) throw new ArgumentException($"Unbekannter Slot '{s.Slot}' (erlaubt: fire, suppressed_fire, reload).");
            wanted[(s.Weapon.ToUpperInvariant(), kind)] = ResolveFile(req, s.File);
        }
        if (command == "plan" && wanted.Count == 0)
        {
            foreach (var w in weapons.Weapons)
                foreach (var k in Slots.Values) wanted[(w.Name.ToUpperInvariant(), k)] = "";
        }

        var primary = new Dictionary<string, (AwcEntryRef Entry, string File, string Owner)>(StringComparer.OrdinalIgnoreCase);
        var muted = new Dictionary<string, AwcEntryRef>(StringComparer.OrdinalIgnoreCase);
        foreach (var ((weaponName, kind), file) in wanted)
        {
            Progress($"Plane {weaponName} · {kind} …");
            var def = weapons.Weapons.FirstOrDefault(w => w.Name.Equals(weaponName, StringComparison.OrdinalIgnoreCase))
                      ?? new WeaponDefinition { Name = weaponName };
            var plan = planWhole(def, kind);
            var owner = $"{weaponName}/{kind}";
            result.Plan[owner] = plan.Select(p => new PlanEntryDto
            {
                AwcPath = p.Entry.AwcPath, Stream = p.Entry.StreamHashHex, Name = p.Entry.StreamName, Primary = p.Primary,
                Seconds = Math.Round(p.Entry.DurationSeconds, 3), SampleRate = p.Entry.SampleRate, Codec = p.Entry.Codec,
            }).ToList();

            foreach (var p in plan)
            {
                var key = p.Entry.AwcPath + "|" + p.Entry.StreamHash;
                if (p.Primary)
                {
                    if (primary.TryGetValue(key, out var other) && !SameFile(other.File, file))
                        throw new InvalidOperationException(
                            $"{other.Owner} und {owner} benutzen in GTA denselben Sound ({p.Entry.StreamName}) – im Spiel kann nur einer davon kommen. Wähl bei beiden denselben Sound oder bei einer der beiden „Original behalten“.");
                    primary[key] = (p.Entry, file, owner);
                    muted.Remove(key);
                }
                else if (!primary.ContainsKey(key))
                {
                    muted[key] = p.Entry;
                }
            }
        }

        if (command == "plan")
        {
            result.Ok = true;
            return;
        }
        if (primary.Count == 0) throw new InvalidOperationException("Für deine Auswahl wurde in den Spieldaten kein ersetzbarer Sound gefunden." +
                                                                   (result.Notes.Count > 0 ? " " + string.Join(" ", result.Notes) : ""));

        // 2) Mapping + Projekt im Speicher aufbauen und mit dem PackBuilder bauen
        Directory.CreateDirectory(req.WorkDir);
        var silence = Path.Combine(req.WorkDir, "silence.wav");
        File.WriteAllBytes(silence, WavFile.Write16(AudioBuffer.Silence(32000, 1, 320)));

        var mapping = new SlotMapping { GameVersion = gta.GameVersion, GameExe = Path.GetFileName(gta.ExePath) };
        var project = new SoundpackProject
        {
            PackName = req.PackName,
            Encryption = req.Encryption.Equals("open", StringComparison.OrdinalIgnoreCase) ? OutputEncryption.Open : OutputEncryption.Ng,
        };
        var edit = new EditSettings(); // 1 : 1 wie OpenIV – Pegel und Samplerate bleiben wie die Datei, nur Mono
        foreach (var group in primary.Values.GroupBy(p => p.File, StringComparer.OrdinalIgnoreCase))
        {
            var slot = new SoundSlot { Id = "sound/" + mapping.Slots.Count, Name = string.Join(", ", group.Select(g => g.Owner).Distinct()), Source = "auto" };
            slot.Entries.AddRange(group.Select(g => g.Entry));
            mapping.Slots.Add(slot);
            project.Assignments.Add(new SlotAssignment { SlotId = slot.Id, SourceFile = group.Key, Edit = edit });
        }
        if (muted.Count > 0)
        {
            var slot = new SoundSlot { Id = "mute", Name = "stumm", Source = "auto" };
            slot.Entries.AddRange(muted.Values);
            mapping.Slots.Add(slot);
            project.Assignments.Add(new SlotAssignment { SlotId = "mute", SourceFile = silence, Edit = edit });
        }
        foreach (var top in mapping.TopLevelArchives())
        {
            Progress($"Prüfsumme {top} …");
            mapping.Archives[top] = Hashing.Fingerprint(gta.GetAbsolute(top));
        }

        var outRoot = Path.Combine(req.WorkDir, "out");
        var report = new PackBuilder(gta).Build(project, mapping, outRoot, new BuildOptions { CreateZip = false, Status = Progress });
        result.Report = report.ToText();
        result.Warnings.AddRange(FriendlyWarnings(report.Warnings.Select(w => w.Message), mapping, weapons));
        result.ReplacedStreams = primary.Count;
        result.MutedStreams = muted.Count;
        if (!report.Success)
        {
            result.Ok = false;
            result.Error = report.Errors.Count > 0 ? string.Join(" ", report.Errors) : "Die Prüfung nach dem Bauen ist fehlgeschlagen – siehe Bericht.";
            return;
        }

        // 3) Ausgabe: geänderte Archive + gewünschte unveränderte Originale
        var packDir = report.PackFolder!;
        foreach (var f in report.OutputFiles)
        {
            var rel = Path.GetRelativePath(packDir, f);
            result.Outputs.Add(new OutputDto { Name = Path.GetFileName(f), RelativePath = rel, Path = f, Size = new FileInfo(f).Length, Changed = true });
        }
        foreach (var inc in req.IncludeArchives)
        {
            if (result.Outputs.Any(o => o.RelativePath.Equals(inc, StringComparison.OrdinalIgnoreCase))) continue;
            var src = gta.GetAbsolute(inc);
            if (!File.Exists(src)) continue;
            var dest = Path.Combine(packDir, inc);
            PathSafety.EnsureOutsideGameFolder(gta.Folder, dest);
            Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
            Progress($"Kopiere unverändertes {inc} …");
            File.Copy(src, dest, true);
            result.Outputs.Add(new OutputDto { Name = Path.GetFileName(dest), RelativePath = inc, Path = dest, Size = new FileInfo(dest).Length, Changed = false });
        }

        // 4) Wie die Community-Packs: geänderte Waffen-Dateien aus WEAPONS_PLAYER.rpf zusätzlich in RESIDENT.rpf
        //    (26 von 40 Packs haben ptl_50cal.awc, 21 ptl_pistol.awc dort) – FiveM lädt die Schüsse auch von dort.
        var wp = result.Outputs.FirstOrDefault(o => o.Name.Equals("WEAPONS_PLAYER.rpf", StringComparison.OrdinalIgnoreCase));
        var res = result.Outputs.FirstOrDefault(o => o.Name.Equals("RESIDENT.rpf", StringComparison.OrdinalIgnoreCase));
        var changedWp = primary.Values.Concat(muted.Values.Select(m => (Entry: m, File: "", Owner: "")))
            .Select(p => p.Entry.AwcPath)
            .Where(p => p.StartsWith(@"x64\audio\sfx\WEAPONS_PLAYER.rpf\", StringComparison.OrdinalIgnoreCase))
            .Select(p => p[(p.LastIndexOf('\\') + 1)..])
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (wp != null && res != null && changedWp.Count > 0)
        {
            var copied = CopyIntoResident(wp.Path, res.Path, changedWp);
            res.Size = new FileInfo(res.Path).Length;
            res.Changed = true;
            if (copied.Count > 0) result.Notes.Add($"Wie in Community-Packs zusätzlich in RESIDENT.rpf: {string.Join(", ", copied)}.");
        }
        result.Ok = true;
    }

    /// <summary>
    /// Hinweise für die App in verständlichen Worten (der technische Bericht bleibt vollständig):
    /// "sound/1 [0x0976F783]: Länge weicht stark ab …" → je Sound höchstens ein Satz, ohne Hashes.
    /// Beim ganzen Reload ist die Länge immer anders als das kurze Original-Teil – das ist gewollt und wird nicht gemeldet.
    /// </summary>
    public static List<string> FriendlyWarnings(IEnumerable<string> technical, SlotMapping mapping, WeaponsConfig weapons)
    {
        var rx = new System.Text.RegularExpressions.Regex(@"^(?<slot>\S+) \[[^\]]*\]: (?<msg>.*)$");
        var outList = new List<string>();
        foreach (var t in technical)
        {
            var m = rx.Match(t);
            if (!m.Success) { outList.Add(t); continue; }
            var slotId = m.Groups["slot"].Value;
            if (slotId == "mute") continue; // Stille in den übrigen Teilen – immer gewollt
            var msg = m.Groups["msg"].Value;
            var owners = (mapping.FindSlot(slotId)?.Name ?? "").Split(", ", StringSplitOptions.RemoveEmptyEntries);
            var reload = owners.Length > 0 && owners.All(o => o.EndsWith("/Reload", StringComparison.OrdinalIgnoreCase));
            var what = reload ? "Reload" : "Schuss";
            var names = owners.Select(o => o.Split('/')[0])
                .Select(n => weapons.Weapons.FirstOrDefault(w => w.Name.Equals(n, StringComparison.OrdinalIgnoreCase))?.DisplayName is { Length: > 0 } d ? d : n)
                .Distinct().ToList();
            var who = names.Count > 0 ? $"Dein {what} ({string.Join(", ", names)})" : $"Dein {what}";

            string? text;
            if (msg.StartsWith("Länge weicht", StringComparison.Ordinal))
                text = reload ? null : $"{who} ist deutlich länger oder kürzer als der Original-Schuss – meistens kein Problem, hör im Spiel kurz hin.";
            else if (msg.StartsWith("Spitzenpegel", StringComparison.Ordinal))
                text = $"{who} ist sehr laut – falls es im Spiel knackt, im Editor etwas leiser machen.";
            else if (msg.StartsWith("Lautstärke weicht", StringComparison.Ordinal))
                // lauter als GTA ist bei Soundpacks normal (und beim Reload wird mit einem kurzen Klick verglichen) – nur "leiser" melden
                text = msg.Contains("+") || reload ? null : $"{who} ist deutlich leiser als der Original-Schuss – im Spiel evtl. kaum zu hören.";
            else if (msg.Contains("stumm", StringComparison.Ordinal))
                text = $"{who} ist (fast) stumm – bitte einen anderen Sound wählen.";
            else
                text = $"{who}: {msg}";
            if (text != null && !outList.Contains(text)) outList.Add(text);
        }
        return outList;
    }

    /// <summary>
    /// Legt die angegebenen AWC-Dateien aus dem fertigen WEAPONS_PLAYER.rpf Byte für Byte auch in RESIDENT.rpf ab
    /// (neuer Eintrag bzw. ersetzt eine frühere Kopie) und prüft das Ergebnis durch erneutes Lesen.
    /// </summary>
    public static List<string> CopyIntoResident(string weaponsPlayerPath, string residentPath, List<string> awcNames)
    {
        Progress("Lege die Schüsse zusätzlich in RESIDENT.rpf ab …");
        var wpRoot = RpfAccess.OpenRoot(weaponsPlayerPath, @"x64\audio\sfx\WEAPONS_PLAYER.rpf");
        var data = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        foreach (var n in awcNames)
        {
            var e = wpRoot.AllEntries.OfType<RpfFileEntry>().FirstOrDefault(x => x.NameLower == n.ToLowerInvariant());
            if (e != null) data[e.Name] = RpfAccess.Extract(e);
        }
        if (data.Count == 0) return new();

        var resRoot = RpfAccess.OpenRoot(residentPath, @"x64\audio\sfx\RESIDENT.rpf");
        foreach (var (name, bytes) in data) RpfFile.CreateFile(resRoot.Root, name, (byte[])bytes.Clone(), overwrite: true);
        RpfPatcher.FixRootSize(resRoot, residentPath, Progress);

        // Gegenprobe
        var check = RpfAccess.OpenRoot(residentPath, @"x64\audio\sfx\RESIDENT.rpf");
        foreach (var (name, bytes) in data)
        {
            var e = check.AllEntries.OfType<RpfFileEntry>().FirstOrDefault(x => x.NameLower == name.ToLowerInvariant())
                    ?? throw new InvalidOperationException($"{name} fehlt nach dem Ablegen in RESIDENT.rpf.");
            if (!RpfAccess.Extract(e).AsSpan().SequenceEqual(bytes))
                throw new InvalidOperationException($"{name} in RESIDENT.rpf weicht nach dem Ablegen ab.");
        }
        return data.Keys.ToList();
    }

    /// <summary>Alle Streams der Original-Archive: Stream-ID → jede Stelle (AWC in WEAPONS_PLAYER.rpf und RESIDENT.rpf).</summary>
    private static Dictionary<uint, List<AwcEntryRef>> StreamIndex(GtaInstallation gta)
    {
        var index = new Dictionary<uint, List<AwcEntryRef>>();
        foreach (var k in OriginalArchives.Legacy)
        {
            Progress($"Lese Original {k.Name} …");
            var root = RpfAccess.OpenRoot(gta.GetAbsolute(k.Relative), k.Relative);
            foreach (var e in RpfAccess.AllFiles(root).Where(x => x.NameLower.EndsWith(".awc")))
            {
                CodeWalker.GameFiles.AwcFile awc;
                try { awc = GtaSoundpack.Core.Awc.AwcPatcher.Load(RpfAccess.Extract(e), e.Name); }
                catch { continue; } // z. B. low_latency.awc – kein Sound-Container
                foreach (var info in GtaSoundpack.Core.Awc.AwcPatcher.ListEntries(awc))
                {
                    if (info.IsMidi) continue;
                    if (!index.TryGetValue(info.Hash, out var list)) index[info.Hash] = list = new();
                    list.Add(new AwcEntryRef
                    {
                        // Archivname wie im Spiel (WEAPONS_PLAYER.rpf), nicht in Kleinbuchstaben
                        AwcPath = k.Relative + "\\" + e.Name, StreamHash = info.Hash, StreamName = info.Name, Role = ChannelRole.Mono,
                        Codec = info.Codec, SampleRate = info.SampleRate, Samples = info.Samples, Channels = 1,
                    });
                }
            }
        }
        return index;
    }

    private static string ResolveFile(EngineRequest req, string file)
    {
        if (string.IsNullOrWhiteSpace(file)) throw new ArgumentException("Sound ohne Datei.");
        var p = Path.IsPathRooted(file) ? file : Path.Combine(req.WorkDir, file);
        if (!File.Exists(p)) throw new FileNotFoundException($"Sounddatei fehlt: {p}");
        return Path.GetFullPath(p);
    }

    private static bool SameFile(string a, string b)
    {
        if (string.Equals(a, b, StringComparison.OrdinalIgnoreCase)) return true;
        try
        {
            return new FileInfo(a).Length == new FileInfo(b).Length && Hashing.Sha256File(a) == Hashing.Sha256File(b);
        }
        catch
        {
            return false;
        }
    }
}
