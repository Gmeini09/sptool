using GtaSoundpack.Core.Build;
using GtaSoundpack.Core.Gta;
using GtaSoundpack.Core.Mapping;
using GtaSoundpack.Core.Project;
using GtaSoundpack.Core.Audio;

namespace GtaSoundpack.Tests;

/// <summary>
/// Läuft nur, wenn die Umgebungsvariable GTA5_PATH auf eine lokale GTA-V-Installation zeigt.
/// Liest ausschließlich aus dem Spielordner; alles wird in einen Temp-Ordner gebaut.
/// </summary>
public class GameIntegrationTests
{
    private static string? GtaPath => Environment.GetEnvironmentVariable("GTA5_PATH");

    [Fact]
    public void Prototype_PistolReload_In_Resident_Builds_And_Verifies()
    {
        if (string.IsNullOrEmpty(GtaPath)) return; // ohne Spiel übersprungen

        var gta = GtaInstallation.Open(GtaPath);
        KeyManager.LoadKeys(gta);
        var catalog = ArchiveCatalog.Build(gta);
        var mapping = new SlotResolver(catalog).Analyze(new WeaponsConfig { Weapons = { new WeaponDefinition { Name = "WEAPON_PISTOL" } } });
        var slot = mapping.Slots.FirstOrDefault(s => s.Entries.Any(e => e.AwcPath.Contains("RESIDENT.rpf", StringComparison.OrdinalIgnoreCase)));
        Assert.True(slot != null, "Kein Pistolen-Reload-Slot in RESIDENT.rpf gefunden. Hinweise: " + string.Join("; ", mapping.Notes));

        using var dir = new TempDir();
        var wav = dir.File("reload.wav");
        File.WriteAllBytes(wav, WavFile.Write16(TestAudio.Sine(800, 0.4, 44100, 2)));
        var project = new SoundpackProject { PackName = "IntegrationTest", Encryption = OutputEncryption.Open };
        project.Save(dir.File("p.json"));
        mapping.Save(dir.File("mapping.json"));
        project.SetSource(slot!.Id, wav);

        var report = new PackBuilder(gta).Build(project, mapping, dir.File("dist"), new BuildOptions { CreateZip = false });
        Assert.True(report.Success, report.ToText());
    }
}
