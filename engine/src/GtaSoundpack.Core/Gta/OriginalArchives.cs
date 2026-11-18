using System.Security.Cryptography;
using CodeWalker.GameFiles;
using GtaSoundpack.Core.Build;

namespace GtaSoundpack.Core.Gta;

/// <summary>Eine Datei in einem Original-Archiv: Name, Position, Länge und SHA-256 ihres Inhalts.</summary>
public sealed record OriginalFile(string Name, long Offset, long Length, string Sha256);

/// <summary>Ein Original-Archiv von Rockstar (x64\audio\sfx), beschrieben nur durch Größe und Prüfsummen.</summary>
public sealed record KnownArchive(string Name, long Size, string Sha256, OriginalFile[] Files)
{
    public string Relative => Path.Combine("x64", "audio", "sfx", Name);
}

/// <summary>
/// Sorgt dafür, dass immer mit Rockstars Original-Archiven gebaut wird – egal, welcher Soundpack schon in
/// x64\audio\sfx liegt. Reihenfolge:
/// 1. Die Datei im GTA-Ordner ist exakt das Original → wird benutzt und einmal lokal gesichert.
/// 2. Eine früher gesicherte bzw. wiederhergestellte Original-Kopie liegt vor → die wird benutzt.
/// 2b. Der Nutzer hat Original-Dateien selbst in den Sicherungsordner gelegt → nur bei exakter Prüfsumme.
/// 3. Wiederherstellen: jede Datei wird an ihrer Original-Position bzw. unter ihrem Namen gesucht und nur übernommen,
///    wenn ihre SHA-256 stimmt. Klappt nur, wenn der Pack die Original-Bytes nicht überschrieben hat – bei 123 von 125
///    geprüften Community-Packs (OpenIV) ist das nicht der Fall, deshalb ist die Sicherung (1/2) der eigentliche Weg.
/// 4. Sonst: klare Fehlermeldung mit Anleitung (Spieldateien überprüfen) – nie mit einem fremden Pack als Grundlage bauen.
/// Im GTA-Ordner wird dabei nie geschrieben. Mitgeliefert werden nur Prüfsummen und Positionen, keine Rockstar-Daten.
/// </summary>
public static class OriginalArchives
{
    /// <summary>GTA V Legacy (GTA5.exe). Prüfsummen der unveränderten Archive und jeder darin enthaltenen Datei.</summary>
    public static readonly KnownArchive[] Legacy =
    {
        new("WEAPONS_PLAYER.rpf", 3883008, "e1b45a90ca538e0dc540aedbc174fc8a9e9faafb24ed56e4d01eccefcfbd9916", new OriginalFile[]
        {
            new("lmg_combat.awc", 1024, 55496, "cb398c150ad36580af237d2c54b83a8cbaafe863a8b2857cd35cd2ae684eaec4"),
            new("lmg_mg_player.awc", 56832, 140960, "3d576dee4518975ef9d2f538dccb31afe0813d6cadc090e61b5437eb8eedb273"),
            new("mgn_sml_am83_vera.awc", 198144, 359092, "d8e89b236bdaea383a0f4862897935ccf2e36332295a162cb13e8d44efa484f9"),
            new("mgn_sml_am83_verb.awc", 557568, 243812, "5863287ab853b822e39f5955771f4de7bb97c41a3a957223564e144b07080cf9"),
            new("mgn_sml_sc__l.awc", 801792, 54256, "010bfb2fe6b273abce2676cd9c93b55bfdaa9e82ee45611799e1eddfffa0c901"),
            new("ptl_50cal.awc", 856064, 46320, "276a7baeb63cde15d0d7f19effe4986aa0683fc9dbb7dc613d6370865275e63f"),
            new("ptl_combat.awc", 902656, 56744, "684b1d4eafd8e3a9f52c1b0fdcbb5a035d54aaad29806898f36dabbefe4375cc"),
            new("ptl_pistol.awc", 959488, 64352, "7e8ee32f7f61d943e16f35d6b67aa811f2cc6e489c6d5c67dfa039f261626386"),
            new("ptl_px4.awc", 1024000, 112636, "7f1e6a0c36a1f55d6e404efd98fd83b595ba9ae820fff8793da127143fb97879"),
            new("ptl_rubber.awc", 1136640, 64504, "f807a9a4ada309a65b393ed7df86ea7fa55880c3b426bacb0057ac65eb050629"),
            new("sht_bullpup.awc", 1201152, 219816, "5b14b6b818d3b5f2d8741cab8e373c854f76a6b814beca2017703de2a4f1b3fe"),
            new("sht_pump.awc", 1421312, 230244, "54c7def9f078e051e6024fad5a380a2126c9dc03b6de34ae4a2b618884afc4e2"),
            new("smg_micro.awc", 1651712, 193048, "b94a77ca447d580e97266a5fb9319ecd64206d29d6f120b40a3000b4aab4fbe9"),
            new("smg_smg.awc", 1845248, 277764, "0ee88db47231dbf19680ebdc6f269a631a5cab55dec935061a1f6c63e9a8567e"),
            new("snp_heavy.awc", 2123264, 43280, "91eac2be806579703136176d2d1c0851553c7eee0f6b8778337f5eedecf80eff"),
            new("snp_rifle.awc", 2166784, 172960, "b1605a184d26d2214fd70152047a36270efc7ac141c224fa94857ee12538abe9"),
            new("spl_grenade_player.awc", 2339840, 125328, "c7d9e57c34d9054aa76db7f2229d430f24b47c3955005a5fe5e4f88c552a8d9e"),
            new("spl_minigun_player.awc", 2465280, 383588, "4c2a8708b2787a11c4245670166fa618c1a2e07c9b5987dbf7bd544e11ee8116"),
            new("spl_prog_ar_player.awc", 2849280, 314896, "28194a972e9b3f5c3f838ed189e9c276fce3ff98aa47390472d1de66104f1153"),
            new("spl_railgun.awc", 3164672, 220160, "ad1e06d504e3ce6d8b3b3838184a1c61e960af226f2b84886502604a24bc2fbd"),
            new("spl_rpg_player.awc", 3384832, 144012, "13ab5e9dd899c6db2298a7b44c89ff92254936f02a1660df61e4decbab4ab503"),
            new("spl_tank_player.awc", 3529216, 353196, "40a3223dbf11035b7e1aad5629bb88e09d6c23040018aa27df50ac00b1a0948f"),
        }),
        new("RESIDENT.rpf", 112785408, "5b3313e01f71bca0d1f5258ab1a95899752e54a996e5d11676fc38f0159e785e", new OriginalFile[]
        {
            new("ambience.awc", 1024, 4503900, "45f169e1540b1c9558d18413691acc4ba0b7fce895d9211e866ec434a47dff40"),
            new("animals_footsteps.awc", 4505088, 1365200, "6094dd6a5e45287abdeae8b938e196fd54365157ee58c282f8d3b3a080e0bec9"),
            new("collision.awc", 5870592, 17635320, "940977e6fab379f08271a024d3b1c141b344e38964e2b0f9b93278917957c0c7"),
            new("collisions.awc", 23505920, 9001844, "85dad32502a05548b6f3f75a8fd9bbe97e41f4a0d20bf1259e97ca5c078f85bb"),
            new("doors.awc", 32507904, 1143248, "27a834edb2f3d5276ab14de8028fd538efe9e9b1569d022a204f6bc6553f1d87"),
            new("explosions.awc", 33651200, 19805816, "a7e2caa23bb5628971b5686a23be52408c567e77d06bf11f0d855b7c4aac7f58"),
            new("feet_materials.awc", 53457408, 7251360, "ee69b7fa02693b9bd36a59018a1a0447fb419c8ad730823b4458635c0a14611e"),
            new("feet_resident.awc", 60708864, 1159136, "7f9d975b1a2a7b70dd0f929444f6c4ad6f00d128b13a0edb6d1ec333de7af866"),
            new("frontend.awc", 61868032, 6060128, "b63bd50174b1ab4cc6a90df009f08f94aa92cdd5847e84c9844f57f71a70c802"),
            new("low_latency.awc", 67928576, 15496, "4fca4fc7d5d4679808e3ebf29cbfd506a9f7f5709980b4bd487a3a7d55e5910a"),
            new("melee.awc", 67944448, 1784684, "24fb566c2be9e224edb5bc8a3f4b2ec4266c41bfe86d02ce4f6dc88a2f2fcc8c"),
            new("movement.awc", 69729280, 2616864, "7c0c865576fd8a686f08e882da7df342df659250bc167ed637dfcdf60f6f35ba"),
            new("player_switch.awc", 72346624, 371636, "adbf787f90ac61d79593ee8fe4ba4453eb166f3c20f84ca85f5c682084ab477c"),
            new("vehicles.awc", 72718336, 16519400, "9006522a35458c749425e875f82b8821c2dd83b87c3acc48ececf2d8aa9f6ed3"),
            new("weapons.awc", 89238016, 19466072, "c39ba0b7848f4b98aa328c7c7a66549b7219911f9c406b7d6dbb588de770802f"),
            new("weather.awc", 108704256, 4079904, "278e16f93b436a3ad63d2284d53072cc26a4e4b020aba3b515d86f7a5d09427d"),
        }),
    };

    public static string DefaultCacheDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GtaSoundpack", "originals");

    public const string RepairHint =
        "Bitte die Original-Spieldateien zurückholen: Steam → Rechtsklick auf GTA V → Eigenschaften → Installierte Dateien → " +
        "„Dateien auf Fehler überprüfen“ (Epic: Bibliothek → GTA V → … → Verwalten → Überprüfen; Rockstar Launcher: Einstellungen → GTA V → Integrität überprüfen). " +
        "Danach erneut erstellen – SP Tool sichert sich die Originale dann einmal und braucht sie danach nicht mehr aus dem GTA-Ordner " +
        "(du kannst also wieder Soundpacks in sfx legen).";

    /// <summary>Stellt für jedes bekannte Archiv eine Original-Quelle bereit (<see cref="GtaInstallation.UseSource"/>).</summary>
    /// <param name="encryption">Verschlüsselung eines wiederhergestellten Archivs (NG wie Rockstar; OPEN nur für Tests).</param>
    public static void Ensure(GtaInstallation gta, List<string> notes, Action<string>? log = null, string? cacheDir = null,
        IReadOnlyList<KnownArchive>? known = null, RpfEncryption encryption = RpfEncryption.NG)
    {
        if (gta.IsGen9 && known == null)
        {
            // Für GTA V Enhanced sind keine Original-Prüfsummen hinterlegt: nur prüfen, ob dort offensichtlich schon ein Pack liegt.
            foreach (var k in Legacy) CheckUnknown(gta, k.Relative, notes);
            return;
        }
        cacheDir ??= DefaultCacheDir;
        known ??= Legacy;

        foreach (var k in known)
        {
            var rel = k.Relative;
            var path = gta.GetAbsolute(rel);
            var cache = Path.Combine(cacheDir, k.Name);
            log?.Invoke($"Prüfe Original {k.Name} …");

            if (File.Exists(path) && IsExact(path, k))
            {
                SaveCache(path, cache);
                continue;
            }
            if (CacheValid(cache) || AcceptDropped(cache, k))
            {
                gta.UseSource(rel, cache);
                notes.Add($"{k.Name} in deinem GTA-Ordner ist verändert (z. B. ein Soundpack) – gebaut wird mit der gesicherten Original-Datei.");
                continue;
            }
            if (!File.Exists(path))
                throw new GtaException($"{k.Name} fehlt in '{Path.GetDirectoryName(path)}'. {RepairHint}");

            log?.Invoke($"{k.Name} ist verändert – stelle die Original-Dateien wieder her …");
            if (encryption == RpfEncryption.NG) KeyManager.EnsureEncryptionTables(log);
            if (TryRecover(path, rel, k, cache, encryption, out var problem))
            {
                gta.UseSource(rel, cache);
                notes.Add($"{k.Name} in deinem GTA-Ordner enthält schon einen Soundpack – SP Tool hat Rockstars Original-Dateien daraus wiederhergestellt und baut damit.");
                continue;
            }
            throw new GtaException(
                $"In deinem GTA-Ordner liegt statt der Original-{k.Name} schon ein Soundpack ({problem}). Damit dein neuer Pack sauber wird, baut SP Tool nur auf Rockstars Originalen auf. " +
                $"{RepairHint} Hast du die Original-Dateien gesichert, kannst du sie stattdessen in diesen Ordner legen: {Path.GetFullPath(cacheDir)}");
        }
    }

    // ── Ohne GTA: Originale einmal importieren ─────────────────────────────────────────────────────────────────

    /// <summary>true, wenn alle Original-Archive geprüft im Sicherungsordner liegen (Bauen ohne GTA möglich).</summary>
    public static bool HaveAll(string? cacheDir = null)
    {
        cacheDir ??= DefaultCacheDir;
        return Legacy.All(k => { var c = Path.Combine(cacheDir, k.Name); return CacheValid(c) || AcceptDropped(c, k); });
    }

    /// <summary>
    /// Sucht in einer Datei bzw. einem Ordner (auch in ZIPs) Rockstars Original-Archive – erkannt nur an Größe und
    /// SHA-256, egal wie die Datei heißt – und legt sie in den Sicherungsordner. Liefert die gefundenen Archivnamen.
    /// </summary>
    public static List<string> Import(string path, Action<string>? log = null, string? cacheDir = null)
    {
        cacheDir ??= DefaultCacheDir;
        var found = new List<string>();
        IEnumerable<string> files = Directory.Exists(path)
            ? Directory.EnumerateFiles(path, "*", new EnumerationOptions { RecurseSubdirectories = true, MaxRecursionDepth = 6, IgnoreInaccessible = true })
            : new[] { path };
        foreach (var f in files)
        {
            var ext = Path.GetExtension(f).ToLowerInvariant();
            if (ext == ".zip") { found.AddRange(ImportZip(f, log, cacheDir)); continue; }
            long len;
            try { len = new FileInfo(f).Length; } catch { continue; }
            var k = Legacy.FirstOrDefault(a => a.Size == len);
            if (k == null) continue;
            log?.Invoke($"Prüfe {Path.GetFileName(f)} …");
            if (!IsExact(f, k)) continue;
            var cache = Path.Combine(cacheDir, k.Name);
            if (!CacheValid(cache)) SaveCache(f, cache);
            if (CacheValid(cache)) found.Add(k.Name);
        }
        return found.Distinct().ToList();
    }

    private static IEnumerable<string> ImportZip(string zipPath, Action<string>? log, string cacheDir)
    {
        var found = new List<string>();
        try
        {
            using var zip = System.IO.Compression.ZipFile.OpenRead(zipPath);
            foreach (var e in zip.Entries)
            {
                var k = Legacy.FirstOrDefault(a => a.Size == e.Length);
                if (k == null) continue;
                log?.Invoke($"Prüfe {e.FullName} in {Path.GetFileName(zipPath)} …");
                var cache = Path.Combine(cacheDir, k.Name);
                if (CacheValid(cache)) { found.Add(k.Name); continue; }
                Directory.CreateDirectory(cacheDir);
                var tmp = cache + ".zip-tmp";
                System.IO.Compression.ZipFileExtensions.ExtractToFile(e, tmp, true);
                if (IsExact(tmp, k))
                {
                    if (File.Exists(cache)) File.Delete(cache);
                    File.Move(tmp, cache);
                    File.WriteAllText(cache + ".sha256", k.Sha256);
                    found.Add(k.Name);
                }
                else File.Delete(tmp);
            }
        }
        catch (InvalidDataException)
        {
            // keine gültige ZIP – überspringen
        }
        return found;
    }

    /// <summary>Vom Nutzer in den Sicherungsordner gelegte Original-Datei: nur exakt Rockstars Datei wird angenommen.</summary>
    private static bool AcceptDropped(string cache, KnownArchive k)
    {
        try
        {
            if (!File.Exists(cache) || !IsExact(cache, k)) return false;
            File.WriteAllText(cache + ".sha256", k.Sha256);
            return true;
        }
        catch
        {
            return false;
        }
    }

    public static bool IsExact(string path, KnownArchive k) =>
        new FileInfo(path).Length == k.Size && Sha256File(path).Equals(k.Sha256, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Baut aus einem veränderten Archiv ein Archiv mit genau Rockstars Dateien (Prüfsumme je Datei).
    /// Schreibt nach <paramref name="destPath"/> (+ Prüfsummen-Datei), nie in die Quelle.
    /// </summary>
    public static bool TryRecover(string sourcePath, string rel, KnownArchive k, string destPath, RpfEncryption encryption, out string problem)
    {
        problem = "";
        var data = new byte[k.Files.Length][];
        RpfFile? root = null;
        var rootTried = false;
        using (var fs = new FileStream(sourcePath, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            for (var i = 0; i < k.Files.Length; i++)
            {
                var f = k.Files[i];
                // a) noch an der Original-Position (OpenIV hängt Ersetztes nur ans Ende)
                if (fs.Length >= f.Offset + f.Length)
                {
                    var buf = new byte[f.Length];
                    fs.Position = f.Offset;
                    fs.ReadExactly(buf);
                    if (Sha256(buf) == f.Sha256) { data[i] = buf; continue; }
                }
                // b) unter seinem Namen an anderer Stelle (Archiv neu aufgebaut, Datei aber nicht ersetzt)
                if (!rootTried)
                {
                    rootTried = true;
                    try { root = RpfAccess.OpenRoot(sourcePath, rel); } catch { root = null; }
                }
                var entry = root?.AllEntries?.OfType<RpfFileEntry>()
                    .FirstOrDefault(e => e.Parent == root.Root && e.NameLower == f.Name.ToLowerInvariant());
                if (entry != null)
                {
                    try
                    {
                        var bytes = RpfAccess.Extract(entry);
                        if (bytes.Length == f.Length && Sha256(bytes) == f.Sha256) { data[i] = bytes; continue; }
                    }
                    catch { /* nicht lesbar → zählt als ersetzt */ }
                }
                problem = $"{f.Name} wurde ersetzt";
                return false;
            }
        }

        var dir = Path.GetDirectoryName(Path.GetFullPath(destPath))!;
        var workDir = Path.Combine(dir, "tmp-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(workDir);
        try
        {
            var built = RpfFile.CreateNew(workDir, k.Name, encryption);
            for (var i = 0; i < k.Files.Length; i++)
                RpfFile.CreateFile(built.Root, k.Files[i].Name, data[i], overwrite: false);
            var tmp = Path.Combine(workDir, k.Name);
            RpfPatcher.FixRootSize(built, tmp, null);

            // Gegenprobe: neu öffnen, jede Datei muss Rockstars Inhalt haben
            var check = RpfAccess.OpenRoot(tmp, rel);
            foreach (var f in k.Files)
            {
                var e = check.AllEntries.OfType<RpfFileEntry>().FirstOrDefault(x => x.NameLower == f.Name.ToLowerInvariant());
                if (e == null || Sha256(RpfAccess.Extract(e)) != f.Sha256)
                {
                    problem = $"Gegenprobe für {f.Name} fehlgeschlagen";
                    return false;
                }
            }
            if (File.Exists(destPath)) File.Delete(destPath);
            File.Move(tmp, destPath);
            File.WriteAllText(destPath + ".sha256", Sha256File(destPath));
            return true;
        }
        finally
        {
            try { Directory.Delete(workDir, true); } catch { /* egal */ }
        }
    }

    /// <summary>Unbekannte Archiv-Version: Rockstar verschlüsselt jede AWC einzeln – eine offene AWC stammt von einem Mod-Werkzeug.</summary>
    public static bool LooksModified(string path, string rel)
    {
        RpfFile root;
        try { root = RpfAccess.OpenRoot(path, rel); } catch { return true; }
        foreach (var e in root.AllEntries.OfType<RpfFileEntry>().Where(x => x.NameLower.EndsWith(".awc")))
        {
            byte[] b;
            try { b = RpfAccess.Extract(e); } catch { return true; }
            if (b.Length >= 4)
            {
                var magic = BitConverter.ToUInt32(b, 0);
                if (magic == 0x54414441 || magic == 0x41444154) return true; // "ADAT" offen
            }
        }
        return false;
    }

    private static void CheckUnknown(GtaInstallation gta, string rel, List<string> notes)
    {
        var path = gta.GetAbsolute(rel);
        if (File.Exists(path) && LooksModified(path, rel))
            notes.Add($"{Path.GetFileName(rel)} in deinem GTA-Ordner enthält vermutlich schon einen Soundpack. Für GTA V Enhanced kann SP Tool das Original nicht wiederherstellen – Sounds, die du nicht ersetzt, kommen dann aus diesem Pack. {RepairHint}");
    }

    private static void SaveCache(string original, string cache)
    {
        try
        {
            if (CacheValid(cache)) return;
            Directory.CreateDirectory(Path.GetDirectoryName(cache)!);
            var tmp = cache + ".tmp";
            File.Copy(original, tmp, true);
            File.SetAttributes(tmp, FileAttributes.Normal);
            if (File.Exists(cache)) File.Delete(cache);
            File.Move(tmp, cache);
            File.WriteAllText(cache + ".sha256", Sha256File(cache));
        }
        catch
        {
            // Sicherung ist nur ein Komfort – der Build läuft auch ohne.
        }
    }

    private static bool CacheValid(string cache)
    {
        try
        {
            var side = cache + ".sha256";
            return File.Exists(cache) && File.Exists(side)
                   && File.ReadAllText(side).Trim().Equals(Sha256File(cache), StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private static string Sha256(byte[] b) => Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant();

    private static string Sha256File(string path)
    {
        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 20);
        return Convert.ToHexString(SHA256.HashData(fs)).ToLowerInvariant();
    }
}
