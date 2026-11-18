using System.Diagnostics;
using System.IO.Compression;
using GtaSoundpack.Core.Audio;
using GtaSoundpack.Core.Awc;
using GtaSoundpack.Core.Gta;
using GtaSoundpack.Core.Mapping;
using GtaSoundpack.Core.Project;
using GtaSoundpack.Core.Util;

namespace GtaSoundpack.Core.Build;

public sealed class BuildOptions
{
    /// <summary>Trotz abweichender Spielversion/Prüfsummen bauen.</summary>
    public bool Force { get; set; }
    public bool CreateZip { get; set; } = true;
    public Action<string>? Status { get; set; }
}

/// <summary>Im Pack abgelegtes Manifest – Grundlage für "Wiederherstellen".</summary>
public sealed class PackManifest
{
    public string PackName { get; set; } = "";
    public DateTime BuiltUtc { get; set; } = DateTime.UtcNow;
    public string GameVersion { get; set; } = "";
    public OutputEncryption Encryption { get; set; }
    public Dictionary<string, ArchiveFingerprint> OriginalArchives { get => _orig; set => _orig = Json.IgnoreCase(value); }
    public Dictionary<string, ArchiveFingerprint> OutputArchives { get => _out; set => _out = Json.IgnoreCase(value); }
    private Dictionary<string, ArchiveFingerprint> _orig = new(StringComparer.OrdinalIgnoreCase);
    private Dictionary<string, ArchiveFingerprint> _out = new(StringComparer.OrdinalIgnoreCase);
    public List<string> Slots { get; set; } = new();

    public const string FileName = "soundpack-manifest.json";
}

/// <summary>Vorbereiteter Slot (für Vorschau und Build): Original vs. neu, inkl. Warnungen.</summary>
public sealed record PreparedEntry(SoundSlot Slot, AwcEntryRef Entry, AudioBuffer Converted, AudioStats OriginalStats, AudioComparison Comparison);

public sealed class PackBuilder
{
    private readonly GtaInstallation _gta;

    public PackBuilder(GtaInstallation gta) => _gta = gta;

    public BuildReport Build(SoundpackProject project, SlotMapping mapping, string outputRoot, BuildOptions? options = null)
    {
        options ??= new BuildOptions();
        var report = new BuildReport();
        var sw = Stopwatch.StartNew();
        void Log(string s)
        {
            report.Log.Add(s);
            options.Status?.Invoke(s);
        }

        try
        {
            outputRoot = Path.GetFullPath(outputRoot);
            PathSafety.EnsureOutsideGameFolder(_gta.Folder, outputRoot);

            KeyManager.LoadKeys(_gta, Log);
            if (project.Encryption == OutputEncryption.Ng) KeyManager.EnsureEncryptionTables(Log);

            var assignments = project.Assignments.Where(a => !string.IsNullOrWhiteSpace(a.SourceFile)).ToList();
            if (assignments.Count == 0) throw new InvalidOperationException("Keinem Slot ist eine Sounddatei zugewiesen.");

            // 1) Audio vorbereiten (inkl. Vergleich mit Original)
            var originals = new OriginalAudioSource(_gta);
            var prepared = new List<PreparedEntry>();
            foreach (var a in assignments)
            {
                var slot = mapping.FindSlot(a.SlotId) ?? throw new InvalidOperationException($"Slot '{a.SlotId}' ist nicht im Mapping enthalten.");
                Log($"Konvertiere {Path.GetFileName(a.SourceFile)} → {slot.Id}");
                prepared.AddRange(Prepare(slot, project.Resolve(a.SourceFile), a.Edit, originals));
            }
            foreach (var p in prepared)
                foreach (var w in p.Comparison.Warnings)
                    report.Warnings.Add(w with { Message = $"{p.Slot.Id} [{p.Entry.StreamName}]: {w.Message}" });

            var archives = prepared.Select(p => p.Entry.TopLevelRpf).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

            // 2) Sicherheitsprüfung: passen Spielversion und Original-Prüfsummen zum Mapping?
            ValidateAgainstMapping(mapping, archives, report, options, Log);
            if (report.Errors.Count > 0) return report;

            // 3) Kopieren (nur lesen aus GTA) und patchen
            var packDir = Path.Combine(outputRoot, project.SafePackName);
            Directory.CreateDirectory(packDir);
            var manifest = new PackManifest
            {
                PackName = project.PackName,
                GameVersion = _gta.GameVersion,
                Encryption = project.Encryption,
                Slots = prepared.Select(p => p.Slot.Id).Distinct().ToList(),
            };

            foreach (var top in archives)
            {
                var src = _gta.GetAbsolute(top);
                var dest = Path.Combine(packDir, top);
                PathSafety.EnsureOutsideGameFolder(_gta.Folder, dest);
                Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
                // Arbeitskopie unter dem ECHTEN Dateinamen: der NG-Schlüssel eines Archivs hängt von Name und Größe ab –
                // "WEAPONS_PLAYER.rpf.tmp" ließe sich nicht mehr entschlüsseln ("Error in RPF7 file entry").
                var workDir = Path.Combine(packDir, ".arbeit");
                Directory.CreateDirectory(workDir);
                var tmp = Path.Combine(workDir, Path.GetFileName(top));
                Log($"Kopiere {top} in den Arbeitsordner …");
                File.Copy(src, tmp, true);
                File.SetAttributes(tmp, FileAttributes.Normal);
                manifest.OriginalArchives[top] = mapping.Archives.TryGetValue(top, out var fp) ? fp : Hashing.Fingerprint(src);

                var reps = prepared.Where(p => p.Entry.TopLevelRpf.Equals(top, StringComparison.OrdinalIgnoreCase))
                    .Select(p => new StreamReplacement(p.Slot.Id, p.Entry.AwcPath, p.Entry.StreamHash, p.Converted, p.Entry.Codec, p.OriginalStats.DurationSeconds))
                    .ToList();
                try
                {
                    reps = RpfPatcher.PatchInPlace(tmp, top, reps, project.Encryption, Log,
                        n => report.Warnings.Add(new AudioWarning(WarningLevel.Info, n)));
                }
                catch
                {
                    TryDelete(tmp);
                    throw;
                }
                if (File.Exists(dest)) File.Delete(dest);
                File.Move(tmp, dest);

                // 4) Prüfung
                Log($"Prüfe {top} …");
                report.Items.AddRange(PackVerifier.Verify(dest, top, reps));
                manifest.OutputArchives[top] = Hashing.Fingerprint(dest);
                report.OutputFiles.Add(dest);
            }
            try { Directory.Delete(Path.Combine(packDir, ".arbeit"), true); } catch { /* leer oder schon weg */ }

            // 5) README, Manifest, ZIP
            Json.Save(Path.Combine(packDir, PackManifest.FileName), manifest);
            File.WriteAllText(Path.Combine(packDir, "README.txt"), ReadmeTemplate.ForPack(project, manifest, archives));
            report.PackFolder = packDir;
            if (options.CreateZip)
            {
                var zip = Path.Combine(outputRoot, project.SafePackName + ".zip");
                if (File.Exists(zip)) File.Delete(zip);
                Log("Erzeuge ZIP …");
                ZipFile.CreateFromDirectory(packDir, zip, CompressionLevel.Optimal, includeBaseDirectory: true);
                report.ZipPath = zip;
            }
            Log(report.Success ? "Fertig." : "Fertig – mit Fehlern in der Prüfung.");
        }
        catch (Exception ex)
        {
            report.Errors.Add(ex.Message);
            options.Status?.Invoke("Fehler: " + ex.Message);
        }
        finally
        {
            report.Elapsed = sw.Elapsed;
        }
        return report;
    }

    private void ValidateAgainstMapping(SlotMapping mapping, IEnumerable<string> archives, BuildReport report, BuildOptions options, Action<string> log)
    {
        var problems = new List<string>();
        if (!string.IsNullOrEmpty(mapping.GameVersion) && mapping.GameVersion != _gta.GameVersion)
            problems.Add($"Spielversion hat sich geändert: Mapping für {mapping.GameVersion}, installiert ist {_gta.GameVersion}.");
        foreach (var top in archives)
        {
            log($"Prüfe Original-Prüfsumme {top} …");
            var abs = _gta.GetAbsolute(top);
            if (!File.Exists(abs))
            {
                report.Errors.Add($"Original-Archiv fehlt: {abs}");
                continue;
            }
            if (!mapping.Archives.TryGetValue(top, out var expected))
            {
                problems.Add($"Für {top} ist im Mapping keine Prüfsumme gespeichert (Mapping neu analysieren empfohlen).");
                continue;
            }
            var actual = Hashing.Fingerprint(abs);
            if (!actual.Sha256.Equals(expected.Sha256, StringComparison.OrdinalIgnoreCase))
                problems.Add($"{top} unterscheidet sich vom Stand des Mappings (Spielupdate oder bereits modifiziert?).");
        }
        foreach (var p in problems)
        {
            if (options.Force) report.Warnings.Add(new AudioWarning(WarningLevel.Warning, p + " (--force: wird trotzdem gebaut)"));
            else report.Errors.Add(p + " Abbruch – erneut analysieren oder mit --force bauen.");
        }
    }

    /// <summary>Konvertiert eine Quelldatei für alle Einträge eines Slots (Kanalrolle, Samplerate) und vergleicht mit dem Original.</summary>
    public IEnumerable<PreparedEntry> Prepare(SoundSlot slot, string sourceFile, EditSettings edit, OriginalAudioSource originals)
    {
        var source = AudioDecoder.Load(sourceFile);
        var edited = AudioProcessor.Apply(source, edit);
        foreach (var entry in slot.Entries)
        {
            var channel = entry.Role switch
            {
                ChannelRole.Left => new AudioBuffer(edited.SampleRate, new[] { edited.Channels[0] }),
                ChannelRole.Right => new AudioBuffer(edited.SampleRate, new[] { edited.Channels[Math.Min(1, edited.ChannelCount - 1)] }),
                _ => AudioProcessor.ConvertChannels(edited, 1),
            };
            // Wie OpenIV: deine WAV behält ihre Samplerate (nur Mehrkanal-AWCs werden beim Schreiben angepasst, siehe AwcPatcher.Fit).
            var converted = channel;
            var origStats = originals.GetStats(entry);
            var cmp = AudioComparison.Compare(origStats, converted.GetStats());
            yield return new PreparedEntry(slot, entry, converted, origStats, cmp);
        }
    }

    private static void TryDelete(string path)
    {
        try { File.Delete(path); } catch { /* ignorieren */ }
    }
}

/// <summary>Liest Original-Einträge aus dem GTA-Ordner (nur lesend, mit Cache) – für Vorschau und Vergleich.</summary>
public sealed class OriginalAudioSource
{
    private readonly GtaInstallation _gta;
    private readonly Dictionary<string, CodeWalker.GameFiles.RpfFile> _roots = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, CodeWalker.GameFiles.AwcFile> _awcs = new(StringComparer.OrdinalIgnoreCase);

    public OriginalAudioSource(GtaInstallation gta) => _gta = gta;

    public CodeWalker.GameFiles.AwcFile GetAwc(string awcPath)
    {
        if (_awcs.TryGetValue(awcPath, out var a)) return a;
        var (top, _) = RpfAccess.Split(awcPath);
        if (!_roots.TryGetValue(top, out var root))
            _roots[top] = root = RpfAccess.OpenRoot(_gta.GetAbsolute(top), top);
        var entry = RpfAccess.FindFile(root, awcPath) ?? throw new GtaException($"Eintrag '{awcPath}' nicht gefunden.");
        a = AwcPatcher.Load(RpfAccess.Extract(entry), entry.Name);
        _awcs[awcPath] = a;
        return a;
    }

    public AudioBuffer Decode(AwcEntryRef entry) => AwcPatcher.Decode(AwcPatcher.FindStream(GetAwc(entry.AwcPath), entry.StreamHash));

    public AudioStats GetStats(AwcEntryRef entry)
    {
        try
        {
            return Decode(entry).GetStats();
        }
        catch
        {
            return new AudioStats(entry.DurationSeconds, AudioStats.SilenceDb, AudioStats.SilenceDb, entry.SampleRate, 1);
        }
    }
}
