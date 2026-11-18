using System.Security.Cryptography;
using CodeWalker.GameFiles;

namespace GtaSoundpack.Core.Gta;

/// <summary>
/// Lädt die Verschlüsselungs-Keys wie CodeWalker aus der lokalen GTA5.exe (GTA5Keys).
/// Es werden keine Keys mitgeliefert. Für das Schreiben NG-verschlüsselter RPFs werden zusätzlich
/// die Encrypt-Tabellen aus den Decrypt-Tabellen berechnet und lokal im Benutzerprofil zwischengespeichert.
/// </summary>
public static class KeyManager
{
    private static readonly object Sync = new();
    public static bool KeysLoaded { get; private set; }
    public static string? LoadedFrom { get; private set; }

    public static void LoadKeys(GtaInstallation gta, Action<string>? status = null)
    {
        if (gta.IsOffline)
        {
            LoadStoredKeys(status);
            return;
        }
        lock (Sync)
        {
            if (KeysLoaded && string.Equals(LoadedFrom, gta.ExePath, StringComparison.OrdinalIgnoreCase)) return;
            status?.Invoke($"Lade Keys aus {Path.GetFileName(gta.ExePath)} …");
            try
            {
                GTA5Keys.LoadFromPath(gta.Folder, gta.IsGen9, null);
            }
            catch (Exception ex)
            {
                KeysLoaded = false;
                throw new GtaException(
                    $"Die Verschlüsselungs-Keys konnten nicht aus '{gta.ExePath}' geladen werden. " +
                    "Mögliche Ursachen: unbekannte/zu neue Spielversion, beschädigte oder gepackte EXE, fehlende Leserechte. " +
                    $"Details: {ex.Message}", ex);
            }
            if (GTA5Keys.PC_AES_KEY == null || GTA5Keys.PC_NG_KEYS == null || GTA5Keys.PC_NG_DECRYPT_TABLES == null || GTA5Keys.PC_AWC_KEY == null)
            {
                KeysLoaded = false;
                throw new GtaException($"In '{gta.ExePath}' wurde der AES-Key nicht gefunden. Die Spielversion wird von CodeWalker.Core evtl. nicht unterstützt.");
            }
            KeysLoaded = true;
            LoadedFrom = gta.ExePath;
            if (!gta.IsGen9) StoreAesKey(GTA5Keys.PC_AES_KEY); // danach geht es auch ohne GTA auf dem PC
            status?.Invoke("Keys geladen.");
        }
    }

    // ── Ohne GTA: Schlüssel einmal aus einer GTA5.exe holen und lokal merken ─────────────────────────────────

    /// <summary>Ablage des AES-Schlüssels (nur auf diesem PC, aus der GTA5.exe des Nutzers).</summary>
    public static string KeyStoreDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GtaSoundpack", "keys");

    private static string AesFile => Path.Combine(KeyStoreDir, "gta5_legacy_aes.key");

    public static bool HasStoredKeys => File.Exists(AesFile);

    /// <summary>Lädt die Keys aus dem lokalen Speicher (vorher einmal <see cref="ImportFromExe"/> oder ein Lauf mit GTA-Ordner).</summary>
    public static void LoadStoredKeys(Action<string>? status = null)
    {
        lock (Sync)
        {
            if (KeysLoaded) return;
            if (!HasStoredKeys)
                throw new GtaException("Die GTA-Schlüssel fehlen. Bitte einmal eine GTA5.exe (GTA V Legacy) importieren – sie wird nur gelesen, " +
                                       "SP Tool merkt sich daraus den Schlüssel auf diesem PC.");
            status?.Invoke("Lade gespeicherte GTA-Schlüssel …");
            UseAesKey(Convert.FromBase64String(File.ReadAllText(AesFile).Trim()), "gespeicherter Schlüssel");
        }
    }

    /// <summary>Holt den AES-Schlüssel aus einer GTA5.exe (Legacy), prüft ihn und merkt ihn sich lokal.</summary>
    public static void ImportFromExe(string exePath, Action<string>? status = null)
    {
        lock (Sync)
        {
            status?.Invoke($"Suche den Schlüssel in {Path.GetFileName(exePath)} …");
            byte[] exe;
            try { exe = File.ReadAllBytes(exePath); }
            catch (Exception ex) { throw new GtaException($"{Path.GetFileName(exePath)} konnte nicht gelesen werden: {ex.Message}", ex); }
            GTA5Keys.PC_AES_KEY = null;
            GTA5Keys.GenerateV2(exe, null);
            var aes = GTA5Keys.PC_AES_KEY;
            if (aes == null || aes.Length != 32)
                throw new GtaException("In dieser Datei steckt kein GTA-V-Legacy-Schlüssel. Bitte die GTA5.exe aus dem Ordner von GTA V Legacy nehmen (nicht GTA5_Enhanced.exe, nicht den Launcher).");
            KeysLoaded = false;
            UseAesKey(aes, Path.GetFileName(exePath));
            StoreAesKey(aes);
        }
    }

    private static void UseAesKey(byte[] aes, string source)
    {
        try
        {
            GTA5Keys.LoadFromPath(".", false, Convert.ToBase64String(aes));
        }
        catch (Exception ex)
        {
            throw new GtaException($"Die GTA-Schlüssel ({source}) passen nicht: {ex.Message}", ex);
        }
        if (GTA5Keys.PC_NG_KEYS == null || GTA5Keys.PC_NG_DECRYPT_TABLES == null || GTA5Keys.PC_AWC_KEY == null)
            throw new GtaException($"Die GTA-Schlüssel ({source}) sind unvollständig.");
        KeysLoaded = true;
        LoadedFrom = source;
    }

    private static void StoreAesKey(byte[] aes)
    {
        try
        {
            Directory.CreateDirectory(KeyStoreDir);
            File.WriteAllText(AesFile, Convert.ToBase64String(aes));
        }
        catch
        {
            // nur Komfort – mit GTA-Ordner geht es auch ohne gespeicherten Schlüssel
        }
    }

    /// <summary>Für Tests ohne Spiel: nur der AWC-Key wird gesetzt (z. B. Dummy) – RPF-Verschlüsselung bleibt aus.</summary>
    public static void UseAwcKeyForTests(uint[] awcKey) => GTA5Keys.PC_AWC_KEY = awcKey;

    public static bool EncryptionTablesReady => GTA5Keys.PC_NG_ENCRYPT_TABLES != null && GTA5Keys.PC_NG_ENCRYPT_LUTs != null;

    /// <summary>Stellt sicher, dass NG-Encrypt-Tabellen vorhanden sind (Cache oder Neuberechnung, kann einige Minuten dauern).</summary>
    public static void EnsureEncryptionTables(Action<string>? status = null)
    {
        lock (Sync)
        {
            if (EncryptionTablesReady) return;
            if (!KeysLoaded) throw new GtaException("Keys sind nicht geladen.");

            var cacheDir = GetCacheDir();
            var tablesFile = Path.Combine(cacheDir, "ng_encrypt_tables.dat");
            var lutsFile = Path.Combine(cacheDir, "ng_encrypt_luts.dat");
            if (File.Exists(tablesFile) && File.Exists(lutsFile))
            {
                try
                {
                    status?.Invoke("Lade NG-Encrypt-Tabellen aus dem lokalen Cache …");
                    GTA5Keys.PC_NG_ENCRYPT_TABLES = CryptoIO.ReadNgTables(tablesFile);
                    GTA5Keys.PC_NG_ENCRYPT_LUTs = CryptoIO.ReadNgLuts(lutsFile);
                    if (SelfTest()) return;
                }
                catch { /* Cache defekt → neu berechnen */ }
                GTA5Keys.PC_NG_ENCRYPT_TABLES = null;
                GTA5Keys.PC_NG_ENCRYPT_LUTs = null;
            }

            var dec = GTA5Keys.PC_NG_DECRYPT_TABLES;
            var tables = new uint[17][][];
            var luts = new GTA5NGLUT[17][];
            for (var i = 0; i < 17; i++)
            {
                tables[i] = new uint[16][];
                for (var j = 0; j < 16; j++) tables[i][j] = new uint[256];
                luts[i] = new GTA5NGLUT[16];
                for (var j = 0; j < 16; j++) luts[i][j] = new GTA5NGLUT();
            }
            status?.Invoke("Berechne NG-Encrypt-Tabellen (1/17) …");
            tables[0] = RandomGauss.Solve(dec[0]);
            status?.Invoke("Berechne NG-Encrypt-Tabellen (2/17) …");
            tables[1] = RandomGauss.Solve(dec[1]);
            for (var k = 2; k <= 15; k++)
            {
                status?.Invoke($"Berechne NG-Encrypt-Tabellen ({k + 1}/17) …");
                luts[k] = LookUpTableGenerator.BuildLUTs2(dec[k]);
            }
            status?.Invoke("Berechne NG-Encrypt-Tabellen (17/17) …");
            tables[16] = RandomGauss.Solve(dec[16]);

            GTA5Keys.PC_NG_ENCRYPT_TABLES = tables;
            GTA5Keys.PC_NG_ENCRYPT_LUTs = luts;
            if (!SelfTest())
            {
                GTA5Keys.PC_NG_ENCRYPT_TABLES = null;
                GTA5Keys.PC_NG_ENCRYPT_LUTs = null;
                throw new GtaException("Die berechneten NG-Encrypt-Tabellen bestehen den Selbsttest nicht. Bitte Verschlüsselung 'OPEN' verwenden.");
            }
            try
            {
                Directory.CreateDirectory(cacheDir);
                CryptoIO.WriteNgTables(tablesFile, tables);
                CryptoIO.WriteLuts(lutsFile, luts);
            }
            catch (Exception ex)
            {
                status?.Invoke($"Hinweis: Cache konnte nicht geschrieben werden ({ex.Message}).");
            }
        }
    }

    /// <summary>Verschlüsselt und entschlüsselt einen Testblock – stellt sicher, dass Encrypt ∘ Decrypt = Identität.</summary>
    private static bool SelfTest()
    {
        var data = new byte[64];
        new Random(1234).NextBytes(data);
        var enc = GTACrypto.EncryptNG(data, "selftest.rpf", 123456);
        var dec = GTACrypto.DecryptNG(enc, "selftest.rpf", 123456);
        return data.AsSpan().SequenceEqual(dec);
    }

    private static string GetCacheDir()
    {
        var id = Convert.ToHexString(SHA256.HashData(GTA5Keys.PC_AES_KEY))[..16];
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GtaSoundpack", "keycache", id);
    }
}
