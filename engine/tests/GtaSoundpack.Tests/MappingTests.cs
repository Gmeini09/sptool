using GtaSoundpack.Core.Gta;
using GtaSoundpack.Core.Mapping;
using GtaSoundpack.Core.Project;

namespace GtaSoundpack.Tests;

public class MappingTests
{
    private static SlotMapping Sample()
    {
        var m = new SlotMapping { GameVersion = "1.0.3407.0", GameExe = "GTA5.exe" };
        m.Archives["x64\\audio\\sfx\\RESIDENT.rpf"] = new ArchiveFingerprint { Size = 1234, Sha256 = "ABCD" };
        m.Slots.Add(new SoundSlot
        {
            Weapon = "WEAPON_PISTOL",
            Kind = SlotKind.Reload,
            Name = "mag_out",
            Id = SoundSlot.MakeId("WEAPON_PISTOL", SlotKind.Reload, "mag_out"),
            Entries =
            {
                new AwcEntryRef
                {
                    AwcPath = "x64\\audio\\sfx\\RESIDENT.rpf\\weapons.awc", StreamHash = 0x1ABCDEF0, StreamName = "pistol_mag_out",
                    Codec = "ADPCM", SampleRate = 32000, Samples = 16000, Role = ChannelRole.Mono,
                },
            },
        });
        return m;
    }

    [Fact]
    public void Mapping_Json_Roundtrip()
    {
        using var dir = new TempDir();
        var path = dir.File("mapping.json");
        Sample().Save(path);
        var json = File.ReadAllText(path);
        Assert.Contains("\"kind\": \"Reload\"", json);

        var back = SlotMapping.Load(path);
        var slot = Assert.Single(back.Slots);
        Assert.Equal("WEAPON_PISTOL/Reload/mag_out", slot.Id);
        var e = Assert.Single(slot.Entries);
        Assert.Equal(0x1ABCDEF0u, e.StreamHash);
        Assert.Equal(0.5, e.DurationSeconds, 3);
        Assert.Equal("x64\\audio\\sfx\\RESIDENT.rpf", e.TopLevelRpf);
        Assert.True(back.Archives.ContainsKey("X64\\AUDIO\\SFX\\resident.rpf")); // Pfadvergleich ohne Groß/Klein
    }

    [Fact]
    public void Manual_Assignment_Replaces_And_Survives_Reanalysis()
    {
        var m = Sample();
        var entry = new AwcEntryRef { AwcPath = "x64\\audio\\sfx\\RESIDENT.rpf\\weapons.awc", StreamHash = 0x0000BEEF, Codec = "PCM", SampleRate = 22050, Samples = 100 };
        var slot = m.Assign("WEAPON_PISTOL50", SlotKind.Reload, "slide", entry);
        Assert.Equal("manual", slot.Source);
        m.Assign("WEAPON_PISTOL50", SlotKind.Reload, "slide", entry, append: true); // keine Duplikate
        Assert.Single(m.FindSlot("WEAPON_PISTOL50/Reload/slide")!.Entries);

        var fresh = new SlotMapping();
        fresh.Slots.Add(new SoundSlot { Id = "WEAPON_PISTOL50/Reload/slide", Source = "auto" });
        fresh.MergeManual(m);
        Assert.Equal("manual", fresh.FindSlot("WEAPON_PISTOL50/Reload/slide")!.Source);
        Assert.True(fresh.Archives.ContainsKey("x64\\audio\\sfx\\RESIDENT.rpf"));
    }

    [Fact]
    public void WeaponsConfig_Default_And_Extendable()
    {
        using var dir = new TempDir();
        var cfg = WeaponsConfig.Default();
        Assert.Equal(new[] { "WEAPON_PISTOL", "WEAPON_PISTOL_MK2", "WEAPON_PISTOL50" }, cfg.Weapons.Select(w => w.Name));
        cfg.Weapons.Add(new WeaponDefinition { Name = "WEAPON_COMBATPISTOL", Kinds = { SlotKind.Fire } });
        var path = dir.File("weapons.json");
        cfg.Save(path);
        var back = WeaponsConfig.LoadOrDefault(path);
        Assert.Equal(4, back.Weapons.Count);
        Assert.Contains(SlotKind.Fire, back.Weapons[3].Kinds);
    }

    [Theory]
    [InlineData("x64\\audio\\sfx\\RESIDENT.rpf\\weapons.awc", "x64\\audio\\sfx\\RESIDENT.rpf", "weapons.awc")]
    [InlineData("update/x64/dlcpacks/mpgunrunning/dlc.rpf/x64/audio/sfx/dlc_gr.rpf/w.awc", "update\\x64\\dlcpacks\\mpgunrunning\\dlc.rpf", "x64\\audio\\sfx\\dlc_gr.rpf\\w.awc")]
    public void VirtualPath_Split(string vpath, string top, string inner)
    {
        var (t, i) = RpfAccess.Split(vpath);
        Assert.Equal(top, t);
        Assert.Equal(inner, i);
    }

    [Fact]
    public void ContainerNames_Match_Game_Convention()
    {
        Assert.Contains("resident/weapons", ArchiveCatalog.ContainerNames("x64\\audio\\sfx\\RESIDENT.rpf\\weapons.awc"));
        var dlc = ArchiveCatalog.ContainerNames("update\\x64\\dlcpacks\\mpgunrunning\\dlc.rpf\\x64\\audio\\sfx\\dlc_gunrunning\\weapons_player.awc").ToList();
        Assert.Contains("dlc_gunrunning/weapons_player", dlc);
    }

    [Fact]
    public void Project_Relative_Paths_And_SafeName()
    {
        using var dir = new TempDir();
        var p = new SoundpackProject { PackName = "My:Pack?" };
        var path = dir.File("mypack.json");
        p.Save(path);
        p.SetSource("WEAPON_PISTOL/Reload/mag_out", dir.File("sounds\\reload.wav"));
        p.Save(path);
        var back = SoundpackProject.Load(path);
        Assert.Equal("sounds\\reload.wav", back.Assignments[0].SourceFile);
        Assert.Equal(dir.File("sounds\\reload.wav"), back.Resolve(back.Assignments[0].SourceFile));
        Assert.Equal("My_Pack_", back.SafePackName);
    }

    [Fact]
    public void Output_Inside_GameFolder_Is_Rejected()
    {
        using var dir = new TempDir();
        Assert.Throws<GtaException>(() => PathSafety.EnsureOutsideGameFolder(dir.Path, Path.Combine(dir.Path, "mods")));
        PathSafety.EnsureOutsideGameFolder(dir.Path, dir.Path + "_out"); // Präfix, aber anderer Ordner → erlaubt
    }
}
