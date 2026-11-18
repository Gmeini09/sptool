using System.Diagnostics;

namespace GtaSoundpack.Core.Gta;

public sealed class GtaException : Exception
{
    public GtaException(string message, Exception? inner = null) : base(message, inner) { }
}

/// <summary>Beschreibt eine lokale GTA-V-Installation. Wird ausschließlich lesend verwendet.</summary>
public sealed class GtaInstallation
{
    private GtaInstallation(string folder, string exePath, bool isGen9)
    {
        Folder = folder;
        ExePath = exePath;
        IsGen9 = isGen9;
    }

    public string Folder { get; }
    public string ExePath { get; }
    /// <summary>true für "GTA V Enhanced" (GTA5_Enhanced.exe).</summary>
    public bool IsGen9 { get; }

    /// <summary>true, wenn kein GTA-Ordner da ist und mit importierten Originalen gebaut wird.</summary>
    public bool IsOffline { get; private init; }

    /// <summary>
    /// Ohne GTA auf dem PC: die importierten Original-Archive (geprüft per Prüfsumme) stehen für x64\audio\sfx.
    /// Spieldaten für die Zuordnung gibt es dann nicht – die kommt aus der mitgelieferten Liste.
    /// </summary>
    public static GtaInstallation Offline(string originalsDir)
    {
        var inst = new GtaInstallation(Path.GetFullPath(originalsDir), "", false) { IsOffline = true };
        foreach (var k in OriginalArchives.Legacy) inst.UseSource(k.Relative, Path.Combine(originalsDir, k.Name));
        return inst;
    }

    public string GameVersion
    {
        get
        {
            if (IsOffline) return "GTA V Legacy (importierte Originale)";
            try
            {
                var v = FileVersionInfo.GetVersionInfo(ExePath);
                return v.FileVersion ?? v.ProductVersion ?? "unbekannt";
            }
            catch
            {
                return "unbekannt";
            }
        }
    }

    public string SfxFolder => Path.Combine(Folder, "x64", "audio", "sfx");

    public static GtaInstallation Open(string folder, bool? preferGen9 = null)
    {
        if (string.IsNullOrWhiteSpace(folder)) throw new GtaException("Kein GTA-V-Ordner angegeben.");
        folder = Path.GetFullPath(folder.Trim().Trim('"'));
        if (!Directory.Exists(folder)) throw new GtaException($"Der Ordner '{folder}' existiert nicht.");

        var legacy = Path.Combine(folder, "GTA5.exe");
        var enhanced = Path.Combine(folder, "GTA5_Enhanced.exe");
        string exe;
        bool gen9;
        if (preferGen9 == true && File.Exists(enhanced)) { exe = enhanced; gen9 = true; }
        else if (File.Exists(legacy)) { exe = legacy; gen9 = false; }
        else if (File.Exists(enhanced)) { exe = enhanced; gen9 = true; }
        else throw new GtaException($"In '{folder}' wurde weder GTA5.exe noch GTA5_Enhanced.exe gefunden. Bitte den GTA-V-Installationsordner wählen.");

        var inst = new GtaInstallation(folder, exe, gen9);
        if (!Directory.Exists(inst.SfxFolder))
            throw new GtaException($"Der Ordner '{inst.SfxFolder}' fehlt – ist die Installation vollständig?");
        return inst;
    }

    private readonly Dictionary<string, string> _sources = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Absoluter Pfad zu einer Datei relativ zum GTA-Ordner (z. B. "x64\audio\sfx\RESIDENT.rpf").
    /// Für Archive, deren Original anderswo liegt (<see cref="UseSource"/>), ist das die Original-Kopie.
    /// </summary>
    public string GetAbsolute(string relativePath) =>
        _sources.TryGetValue(Key(relativePath), out var p) ? p : Path.Combine(Folder, relativePath);

    /// <summary>Liest <paramref name="relativePath"/> ab jetzt aus <paramref name="physicalPath"/> (z. B. wiederhergestelltes Original).</summary>
    public void UseSource(string relativePath, string physicalPath) => _sources[Key(relativePath)] = Path.GetFullPath(physicalPath);

    private static string Key(string rel) => rel.Replace('/', '\\').Trim('\\');
}

public static class PathSafety
{
    /// <summary>Wirft, wenn <paramref name="target"/> innerhalb des GTA-Ordners liegt. Das Tool schreibt niemals dorthin.</summary>
    public static void EnsureOutsideGameFolder(string gtaFolder, string target)
    {
        var g = Normalize(gtaFolder);
        var t = Normalize(target);
        if (t.Equals(g, StringComparison.OrdinalIgnoreCase) || t.StartsWith(g + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
        {
            throw new GtaException($"Sicherheitsregel: '{target}' liegt im GTA-Installationsordner. Das Tool schreibt nur in einen separaten Ausgabeordner.");
        }
    }

    private static string Normalize(string p) => Path.GetFullPath(p).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
}
