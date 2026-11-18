using System.Security.Cryptography;
using CodeWalker.GameFiles;
using GtaSoundpack.Core.Gta;

namespace GtaSoundpack.Tests;

/// <summary>
/// „Egal was in sfx liegt, gebaut wird mit den Originalen“: mit selbst gebauten Archiven statt Rockstars Dateien
/// (OPEN statt NG, damit keine GTA-Keys nötig sind).
/// </summary>
public class OriginalArchivesTests
{
    private static readonly string[] Names = { "ptl_50cal.awc", "ptl_pistol.awc", "smg_smg.awc" };

    private static byte[] Bytes(int seed, int len)
    {
        var b = new byte[len];
        new Random(seed).NextBytes(b);
        b[0] = 0x11; // kein "ADAT": wie Rockstars verschlüsselte AWCs
        return b;
    }

    /// <summary>Baut ein „Original“-Archiv und beschreibt es wie OriginalArchives.Legacy (Positionen + Prüfsummen).</summary>
    private static (string Path, KnownArchive Known, byte[][] Data) MakeOriginal(TempDir dir, string sub)
    {
        var folder = dir.File(sub);
        Directory.CreateDirectory(folder);
        var data = Names.Select((n, i) => Bytes(i + 1, 3000 + i * 1500)).ToArray();
        var rpf = RpfFile.CreateNew(folder, "WEAPONS_PLAYER.rpf", RpfEncryption.OPEN);
        for (var i = 0; i < Names.Length; i++) RpfFile.CreateFile(rpf.Root, Names[i], data[i], overwrite: false);
        var path = Path.Combine(folder, "WEAPONS_PLAYER.rpf");

        var root = RpfAccess.OpenRoot(path, "x64\\audio\\sfx\\WEAPONS_PLAYER.rpf");
        var files = Names.Select((n, i) =>
        {
            var e = root.AllEntries.OfType<RpfFileEntry>().Single(x => x.NameLower == n);
            return new OriginalFile(n, (long)e.FileOffset * 512, data[i].Length, Sha(data[i]));
        }).ToArray();
        return (path, new KnownArchive("WEAPONS_PLAYER.rpf", new FileInfo(path).Length, ShaFile(path), files), data);
    }

    /// <summary>Wie OpenIV: ersetzte Datei ans Ende, Original-Bytes bleiben an ihrer Stelle.</summary>
    private static void ReplaceLikeOpenIv(string path, int index, byte[] replacement)
    {
        var root = RpfAccess.OpenRoot(path, "x64\\audio\\sfx\\WEAPONS_PLAYER.rpf");
        var e = root.AllEntries.OfType<RpfFileEntry>().Single(x => x.NameLower == Names[index]);
        var end = new FileInfo(path).Length;
        using (var fs = new FileStream(path, FileMode.Open, FileAccess.ReadWrite))
        {
            fs.Position = end;
            fs.Write(replacement);
            fs.Write(new byte[(512 - replacement.Length % 512) % 512]);
        }
        ((RpfBinaryFileEntry)e).FileOffset = (uint)(end / 512);
        ((RpfBinaryFileEntry)e).FileUncompressedSize = (uint)replacement.Length;
        root.FileSize = new FileInfo(path).Length;
        RpfFile.SetEncryptionType(root, root.Encryption); // schreibt den Header mit dem verschobenen Eintrag neu
    }

    private static GtaInstallation FakeGta(TempDir dir, string sfxArchive)
    {
        var gta = dir.File("gta");
        Directory.CreateDirectory(Path.Combine(gta, "x64", "audio", "sfx"));
        File.WriteAllBytes(Path.Combine(gta, "GTA5.exe"), new byte[] { 0x4D, 0x5A });
        File.Copy(sfxArchive, Path.Combine(gta, "x64", "audio", "sfx", "WEAPONS_PLAYER.rpf"), true);
        return GtaInstallation.Open(gta);
    }

    private static byte[] Extract(string path, string name)
    {
        var root = RpfAccess.OpenRoot(path, "x64\\audio\\sfx\\WEAPONS_PLAYER.rpf");
        return RpfAccess.Extract(root.AllEntries.OfType<RpfFileEntry>().Single(x => x.NameLower == name));
    }

    [Fact]
    public void Modified_Archive_Is_Recovered_And_Used_Instead()
    {
        using var dir = new TempDir();
        var (orig, known, data) = MakeOriginal(dir, "orig");
        var modded = dir.File("modded.rpf");
        File.Copy(orig, modded);
        ReplaceLikeOpenIv(modded, 1, Bytes(99, 5000)); // ein „Soundpack“ hat ptl_pistol.awc ersetzt
        Assert.NotEqual(data[1], Extract(modded, "ptl_pistol.awc"));

        var gta = FakeGta(dir, modded);
        var notes = new List<string>();
        var cache = dir.File("cache");
        OriginalArchives.Ensure(gta, notes, null, cache, new[] { known }, RpfEncryption.OPEN);

        var used = gta.GetAbsolute(known.Relative);
        Assert.StartsWith(cache, used);
        for (var i = 0; i < Names.Length; i++) Assert.Equal(data[i], Extract(used, Names[i])); // genau Rockstars Dateien
        Assert.Contains(notes, n => n.Contains("wiederhergestellt"));
        // der GTA-Ordner bleibt unangetastet
        Assert.Equal(ShaFile(modded), ShaFile(Path.Combine(gta.Folder, known.Relative)));

        // nächster Lauf: gesicherte Kopie, ohne neu wiederherzustellen
        var gta2 = FakeGta(dir, modded);
        var notes2 = new List<string>();
        OriginalArchives.Ensure(gta2, notes2, null, cache, new[] { known }, RpfEncryption.OPEN);
        Assert.Equal(used, gta2.GetAbsolute(known.Relative));
        Assert.Contains(notes2, n => n.Contains("gesicherten Original"));
    }

    [Fact]
    public void Exact_Original_Is_Used_Directly_And_Saved()
    {
        using var dir = new TempDir();
        var (orig, known, _) = MakeOriginal(dir, "orig");
        var gta = FakeGta(dir, orig);
        var notes = new List<string>();
        var cache = dir.File("cache");
        OriginalArchives.Ensure(gta, notes, null, cache, new[] { known }, RpfEncryption.OPEN);

        Assert.Equal(Path.Combine(gta.Folder, known.Relative), gta.GetAbsolute(known.Relative));
        Assert.Empty(notes);
        Assert.Equal(known.Sha256, ShaFile(Path.Combine(cache, "WEAPONS_PLAYER.rpf")));

        // später liegt ein Soundpack in sfx, das die Original-Bytes überschrieben hat → die Sicherung rettet es
        var broken = dir.File("broken.rpf");
        File.Copy(orig, broken);
        using (var fs = new FileStream(broken, FileMode.Open, FileAccess.Write)) { fs.Position = known.Files[0].Offset; fs.Write(new byte[100]); }
        var gta2 = FakeGta(dir, broken);
        OriginalArchives.Ensure(gta2, new List<string>(), null, cache, new[] { known }, RpfEncryption.OPEN);
        Assert.Equal(Path.Combine(cache, "WEAPONS_PLAYER.rpf"), gta2.GetAbsolute(known.Relative));
    }

    [Fact]
    public void Overwritten_Original_Without_Backup_Gives_Clear_Error()
    {
        using var dir = new TempDir();
        var (orig, known, _) = MakeOriginal(dir, "orig");
        var broken = dir.File("broken.rpf");
        File.Copy(orig, broken);
        using (var fs = new FileStream(broken, FileMode.Open, FileAccess.Write)) { fs.Position = known.Files[2].Offset; fs.Write(new byte[100]); }

        var gta = FakeGta(dir, broken);
        var ex = Assert.Throws<GtaException>(() =>
            OriginalArchives.Ensure(gta, new List<string>(), null, dir.File("cache"), new[] { known }, RpfEncryption.OPEN));
        Assert.Contains("smg_smg.awc", ex.Message);
        Assert.Contains("Dateien auf Fehler überprüfen", ex.Message);
    }

    /// <summary>
    /// Mit echten Dateien (nur lokal, nie im Repo): SPTOOL_ORIGINAL_DIR = Ordner mit Rockstars WEAPONS_PLAYER.rpf/RESIDENT.rpf,
    /// SPTOOL_MODDED_DIR = Ordner mit einem Community-Pack. Ohne die Variablen passiert nichts.
    /// </summary>
    [Fact]
    public void Real_Originals_Recognised_And_Real_Pack_Refused()
    {
        var origDir = Environment.GetEnvironmentVariable("SPTOOL_ORIGINAL_DIR");
        var modDir = Environment.GetEnvironmentVariable("SPTOOL_MODDED_DIR");
        if (string.IsNullOrEmpty(origDir) || string.IsNullOrEmpty(modDir)) return;
        using var dir = new TempDir();
        var gtaDir = dir.File("gta");
        var sfx = Path.Combine(gtaDir, "x64", "audio", "sfx");
        Directory.CreateDirectory(sfx);
        File.WriteAllBytes(Path.Combine(gtaDir, "GTA5.exe"), new byte[] { 0x4D, 0x5A });
        var cache = dir.File("cache");

        // 1) echte Originale: erkannt, direkt benutzt und gesichert
        foreach (var a in OriginalArchives.Legacy) File.Copy(Path.Combine(origDir, a.Name), Path.Combine(sfx, a.Name), true);
        var gta = GtaInstallation.Open(gtaDir);
        var notes = new List<string>();
        OriginalArchives.Ensure(gta, notes, null, cache, OriginalArchives.Legacy, RpfEncryption.OPEN);
        Assert.Empty(notes);
        foreach (var a in OriginalArchives.Legacy) Assert.True(OriginalArchives.IsExact(Path.Combine(cache, a.Name), a));

        // 2) danach ein Community-Pack in sfx → es wird mit der Sicherung gebaut, nicht mit dem Pack
        foreach (var a in OriginalArchives.Legacy) File.Copy(Path.Combine(modDir, a.Name), Path.Combine(sfx, a.Name), true);
        var gta2 = GtaInstallation.Open(gtaDir);
        OriginalArchives.Ensure(gta2, new List<string>(), null, cache, OriginalArchives.Legacy, RpfEncryption.OPEN);
        foreach (var a in OriginalArchives.Legacy) Assert.True(OriginalArchives.IsExact(gta2.GetAbsolute(a.Relative), a));

        // 3) Community-Pack ohne Sicherung → klare Meldung statt eines kaputten Packs
        var ex = Assert.Throws<GtaException>(() =>
            OriginalArchives.Ensure(GtaInstallation.Open(gtaDir), new List<string>(), null, dir.File("empty"), OriginalArchives.Legacy, RpfEncryption.OPEN));
        Assert.Contains("schon ein Soundpack", ex.Message);
    }

    /// <summary>Einmal-Import ohne GTA: Originale werden in Ordnern und ZIPs an der Prüfsumme erkannt, egal wie sie heißen; Packs nicht.</summary>
    [Fact]
    public void Import_Finds_Real_Originals_In_Folder_And_Zip()
    {
        var origDir = Environment.GetEnvironmentVariable("SPTOOL_ORIGINAL_DIR");
        var modDir = Environment.GetEnvironmentVariable("SPTOOL_MODDED_DIR");
        if (string.IsNullOrEmpty(origDir) || string.IsNullOrEmpty(modDir)) return;
        using var dir = new TempDir();

        // ein Community-Pack ist kein Original
        var cache0 = dir.File("c0");
        Assert.Empty(OriginalArchives.Import(modDir, null, cache0));
        Assert.False(OriginalArchives.HaveAll(cache0));

        // Ordner mit umbenannter Datei
        var folder = dir.File("Original GTA V Soundpack");
        Directory.CreateDirectory(folder);
        File.Copy(Path.Combine(origDir, "WEAPONS_PLAYER.rpf"), Path.Combine(folder, "WEAPONS_PLAYER_2.rpf"));
        File.Copy(Path.Combine(origDir, "RESIDENT.rpf"), Path.Combine(folder, "RESIDENT.rpf"));
        var cache1 = dir.File("c1");
        Assert.Equal(2, OriginalArchives.Import(folder, null, cache1).Count);
        Assert.True(OriginalArchives.HaveAll(cache1));

        // dieselben Dateien in einer ZIP
        var zip = dir.File("pack.zip");
        System.IO.Compression.ZipFile.CreateFromDirectory(folder, zip, System.IO.Compression.CompressionLevel.Fastest, true);
        var cache2 = dir.File("c2");
        Assert.Equal(2, OriginalArchives.Import(zip, null, cache2).Count);
        Assert.True(OriginalArchives.HaveAll(cache2));

        // ohne GTA-Ordner: Offline-Installation zeigt auf die importierten Originale
        var gta = GtaInstallation.Offline(cache2);
        foreach (var a in OriginalArchives.Legacy) Assert.True(OriginalArchives.IsExact(gta.GetAbsolute(a.Relative), a));
    }

    [Fact]
    public void Legacy_Table_Is_Consistent()
    {
        Assert.Equal(2, OriginalArchives.Legacy.Length);
        foreach (var a in OriginalArchives.Legacy)
        {
            Assert.Equal(64, a.Sha256.Length);
            long end = 0;
            foreach (var f in a.Files)
            {
                Assert.True(f.Offset >= end && f.Offset % 512 == 0, $"{a.Name}/{f.Name}");
                Assert.Equal(64, f.Sha256.Length);
                end = f.Offset + f.Length;
            }
            Assert.True(end <= a.Size);
        }
    }

    private static string Sha(byte[] b) => Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant();
    private static string ShaFile(string p) => Sha(File.ReadAllBytes(p));
}
