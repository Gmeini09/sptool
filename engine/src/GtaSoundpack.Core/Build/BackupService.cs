using GtaSoundpack.Core.Gta;
using GtaSoundpack.Core.Mapping;
using GtaSoundpack.Core.Util;

namespace GtaSoundpack.Core.Build;

public sealed class BackupManifest
{
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
    public string GameVersion { get; set; } = "";
    public string GtaFolder { get; set; } = "";
    public Dictionary<string, ArchiveFingerprint> Archives { get => _a; set => _a = Json.IgnoreCase(value); }
    private Dictionary<string, ArchiveFingerprint> _a = new(StringComparer.OrdinalIgnoreCase);
    public const string FileName = "backup-manifest.json";
}

/// <summary>Backup der Original-RPFs und Wiederherstellung eines Packs auf Vanilla – ohne je in den GTA-Ordner zu schreiben.</summary>
public static class BackupService
{
    public static string DefaultBackupRoot =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "GtaSoundpack", "Backups");

    /// <summary>Kopiert die angegebenen Original-Archive (relativ zum GTA-Ordner) in einen neuen Zeitstempel-Ordner.</summary>
    public static string Backup(GtaInstallation gta, IEnumerable<string> archives, string? backupRoot = null, Action<string>? status = null)
    {
        backupRoot = Path.GetFullPath(backupRoot ?? DefaultBackupRoot);
        PathSafety.EnsureOutsideGameFolder(gta.Folder, backupRoot);
        var dir = Path.Combine(backupRoot, DateTime.Now.ToString("yyyyMMdd_HHmmss"));
        Directory.CreateDirectory(dir);
        var manifest = new BackupManifest { GameVersion = gta.GameVersion, GtaFolder = gta.Folder };
        foreach (var rel in archives.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var src = gta.GetAbsolute(rel);
            if (!File.Exists(src)) throw new GtaException($"Archiv nicht gefunden: {src}");
            var dest = Path.Combine(dir, rel);
            Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
            status?.Invoke($"Sichere {rel} …");
            File.Copy(src, dest, false);
            var fpSrc = Hashing.Fingerprint(src);
            var fpDst = Hashing.Fingerprint(dest);
            if (fpSrc.Sha256 != fpDst.Sha256) throw new IOException($"Backup von {rel} ist fehlerhaft (Prüfsumme weicht ab).");
            manifest.Archives[rel] = fpSrc;
        }
        Json.Save(Path.Combine(dir, BackupManifest.FileName), manifest);
        status?.Invoke($"Backup erstellt: {dir}");
        return dir;
    }

    /// <summary>
    /// Erzeugt "&lt;Pack&gt;_Vanilla" mit den unveränderten Originalarchiven für alle Archive eines Packs.
    /// Quelle ist ein passendes Backup (bevorzugt) oder – falls dort unverändert – der GTA-Ordner.
    /// </summary>
    public static string CreateVanillaPack(GtaInstallation gta, string packFolder, string outputRoot, string? backupFolder = null, Action<string>? status = null)
    {
        var manifestPath = Path.Combine(packFolder, PackManifest.FileName);
        if (!File.Exists(manifestPath)) throw new FileNotFoundException("Im Pack-Ordner fehlt das Manifest.", manifestPath);
        var manifest = Json.Load<PackManifest>(manifestPath);

        outputRoot = Path.GetFullPath(outputRoot);
        PathSafety.EnsureOutsideGameFolder(gta.Folder, outputRoot);
        var dest = Path.Combine(outputRoot, Path.GetFileName(packFolder.TrimEnd('\\', '/')) + "_Vanilla");
        Directory.CreateDirectory(dest);

        foreach (var (rel, original) in manifest.OriginalArchives)
        {
            string? source = null;
            var candidates = new List<string>();
            if (backupFolder != null) candidates.Add(Path.Combine(backupFolder, rel));
            if (Directory.Exists(DefaultBackupRoot))
                candidates.AddRange(Directory.GetDirectories(DefaultBackupRoot).OrderByDescending(d => d).Select(d => Path.Combine(d, rel)));
            candidates.Add(gta.GetAbsolute(rel));

            foreach (var c in candidates.Where(File.Exists))
            {
                status?.Invoke($"Prüfe {c} …");
                if (new FileInfo(c).Length == original.Size && Hashing.Sha256File(c).Equals(original.Sha256, StringComparison.OrdinalIgnoreCase))
                {
                    source = c;
                    break;
                }
            }
            if (source == null)
                throw new GtaException($"Kein unverändertes Original für {rel} gefunden (weder im Backup noch im GTA-Ordner). " +
                                       "Bitte im Launcher die Spieldateien überprüfen lassen.");
            var target = Path.Combine(dest, rel);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            status?.Invoke($"Kopiere Original {rel} …");
            File.Copy(source, target, true);
        }

        File.WriteAllText(Path.Combine(dest, "README.txt"),
            $"Vanilla-Wiederherstellung für \"{manifest.PackName}\"\r\n\r\n" +
            "Diese Dateien sind die unveränderten Originalarchive.\r\n" +
            "- mods-Ordner-Installation: einfach die Pack-Dateien aus \"Grand Theft Auto V\\mods\\\" löschen (diese Dateien sind dann nicht nötig).\r\n" +
            "- Direkt-Installation: diese Dateien an dieselbe Stelle unter \"Grand Theft Auto V\\\" kopieren und überschreiben.\r\n" +
            "Alternativ im Launcher \"Dateien überprüfen\" ausführen.\r\n");
        status?.Invoke($"Vanilla-Pack erstellt: {dest}");
        return dest;
    }
}
