using CodeWalker.GameFiles;

namespace GtaSoundpack.Core.Gta;

/// <summary>
/// Hilfsfunktionen für RPF-Archive. Virtuelle Pfade sind relativ zum GTA-Ordner und laufen durch Archive hindurch,
/// z. B. "x64\audio\sfx\RESIDENT.rpf\weapons.awc" oder
/// "update\x64\dlcpacks\mpgunrunning\dlc.rpf\x64\audio\sfx\dlc_gunrunning.rpf\weapons.awc".
/// </summary>
public static class RpfAccess
{
    /// <summary>Teilt einen virtuellen Pfad in die physische Top-Level-RPF (relativ) und den inneren Pfad.</summary>
    public static (string TopLevelRpf, string Inner) Split(string virtualPath)
    {
        var p = NormalizeVirtual(virtualPath);
        var idx = p.IndexOf(".rpf\\", StringComparison.OrdinalIgnoreCase);
        if (idx < 0) throw new ArgumentException($"'{virtualPath}' liegt in keinem RPF-Archiv.", nameof(virtualPath));
        return (p[..(idx + 4)], p[(idx + 5)..]);
    }

    public static string NormalizeVirtual(string p) => p.Replace('/', '\\').Trim('\\');

    public static RpfFile OpenRoot(string physicalPath, string relativePath)
    {
        if (!File.Exists(physicalPath)) throw new GtaException($"Archiv nicht gefunden: {physicalPath}");
        var errors = new List<string>();
        var rpf = new RpfFile(physicalPath, NormalizeVirtual(relativePath));
        rpf.ScanStructure(null, e => errors.Add(e));
        if (rpf.LastException != null || rpf.AllEntries == null)
        {
            var reason = rpf.LastException?.Message ?? string.Join("; ", errors);
            throw new GtaException($"Archiv '{relativePath}' konnte nicht gelesen werden ({reason}). Sind die Keys korrekt geladen?", rpf.LastException);
        }
        return rpf;
    }

    public static IEnumerable<RpfFile> AllArchives(RpfFile root)
    {
        var stack = new Stack<RpfFile>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            var f = stack.Pop();
            yield return f;
            if (f.Children != null)
                foreach (var c in f.Children) stack.Push(c);
        }
    }

    public static IEnumerable<RpfFileEntry> AllFiles(RpfFile root) =>
        AllArchives(root).SelectMany(a => a.AllEntries ?? new List<RpfEntry>()).OfType<RpfFileEntry>();

    public static RpfFileEntry? FindFile(RpfFile root, string virtualPath)
    {
        var target = NormalizeVirtual(virtualPath).ToLowerInvariant();
        return AllFiles(root).FirstOrDefault(e => e.Path.Equals(target, StringComparison.OrdinalIgnoreCase));
    }

    public static byte[] Extract(RpfFileEntry entry) =>
        entry.File.ExtractFile(entry) ?? throw new GtaException($"Eintrag '{entry.Path}' konnte nicht extrahiert werden.");

    /// <summary>Kette vom Archiv des Eintrags bis zur Wurzel.</summary>
    public static IEnumerable<RpfFile> ArchiveChain(RpfFileEntry entry)
    {
        for (var f = entry.File; f != null; f = f.Parent) yield return f;
    }
}
