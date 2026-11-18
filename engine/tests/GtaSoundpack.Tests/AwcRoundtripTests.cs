using CodeWalker.GameFiles;
using GtaSoundpack.Core.Audio;
using GtaSoundpack.Core.Awc;
using GtaSoundpack.Core.Build;
using GtaSoundpack.Core.Gta;
using GtaSoundpack.Core.Project;

namespace GtaSoundpack.Tests;

public class AwcRoundtripTests
{
    private static readonly TestAwcFactory.StreamSpec[] Specs =
    {
        new("pistol_mag_out", "ADPCM", 32000, 0.4, 600),
        new("pistol_mag_in", "PCM", 22050, 0.3, 900),
        new("pistol_slide", "ADPCM", 32000, 0.2, 1200, WithPeak: false),
    };

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Read_Replace_Write_Read(bool encrypted)
    {
        using var dir = new TempDir();
        var original = TestAwcFactory.Create(dir, encrypted, Specs);

        // 1) lesen
        var awc = AwcPatcher.Load(original, "weapons.awc");
        Assert.Equal(encrypted, awc.SingleChannelEncryptFlag);
        var entries = AwcPatcher.ListEntries(awc).ToList();
        Assert.Equal(3, entries.Count);
        var magOut = entries.Single(e => e.Hash == TestAwcFactory.Hash("pistol_mag_out"));
        Assert.Equal("ADPCM", magOut.Codec);
        Assert.Equal(32000, magOut.SampleRate);
        var untouchedBefore = AwcPatcher.FindStream(awc, TestAwcFactory.Hash("pistol_mag_in")).GetRawData().ToArray();
        var headroomBefore = AwcPatcher.FindStream(awc, TestAwcFactory.Hash("pistol_mag_out")).FormatChunk.Headroom;

        // 2) ersetzen (länger als das Original, andere Frequenz)
        var replacement = TestAudio.Sine(220, 0.75, 32000, amp: 0.7f);
        AwcPatcher.ReplaceStream(awc, TestAwcFactory.Hash("pistol_mag_out"), replacement);
        var pcmReplacement = AudioProcessor.Resample(TestAudio.Sine(300, 0.1, 22050), 22050);
        AwcPatcher.ReplaceStream(awc, TestAwcFactory.Hash("pistol_mag_in"), pcmReplacement);

        // 3) schreiben
        var written = AwcPatcher.SaveAndDispose(awc);

        // 4) wieder lesen und prüfen
        var back = AwcPatcher.Load(written, "weapons.awc");
        var s = AwcPatcher.FindStream(back, TestAwcFactory.Hash("pistol_mag_out"));
        var info = AwcPatcher.Describe(s);
        Assert.Equal("ADPCM", info.Codec);
        Assert.Equal(32000, info.SampleRate);
        Assert.Equal(24000, info.Samples);
        Assert.Equal(0.75, info.DurationSeconds, 3);
        var (_, expectedData, _) = AwcPatcher.Encode(replacement, AwcCodecType.ADPCM);
        Assert.Equal(expectedData, s.GetRawData().Take(expectedData.Length).ToArray());
        Assert.Equal(headroomBefore, s.FormatChunk.Headroom); // wie OpenIV: Headroom des Originals bleibt
        Assert.NotNull(s.PeakChunk); // 24000 Samples → Peak-Chunk mit 4 Werten
        Assert.Equal(4, s.PeakChunk.Data.Length);

        var decoded = AwcPatcher.Decode(s);
        Assert.InRange(decoded.GetStats().PeakDbfs, -4.5, -2.0); // 0.7 ≈ -3.1 dBFS

        var pcm = AwcPatcher.FindStream(back, TestAwcFactory.Hash("pistol_mag_in"));
        Assert.Equal("PCM", AwcPatcher.Describe(pcm).Codec);
        Assert.Equal(AwcPatcher.Encode(pcmReplacement, AwcCodecType.PCM).Data, pcm.GetRawData());
        Assert.Equal(2206, AwcPatcher.Describe(pcm).Samples); // 2205 → auf gerade Anzahl aufgefüllt
        Assert.NotEqual(untouchedBefore.Length, pcm.GetRawData().Length);

        // unveränderter Eintrag bleibt bitgenau erhalten
        var slideOrig = AwcPatcher.FindStream(AwcPatcher.Load(original, "weapons.awc"), TestAwcFactory.Hash("pistol_slide")).GetRawData();
        var slideNew = AwcPatcher.FindStream(back, TestAwcFactory.Hash("pistol_slide")).GetRawData();
        Assert.Equal(slideOrig, slideNew);
    }

    /// <summary>Wie OpenIV: die WAV behält ihre Samplerate; nur was das Format nicht fassen kann, wird umgerechnet.</summary>
    [Fact]
    public void Replace_Keeps_Source_SampleRate()
    {
        using var dir = new TempDir();
        var awc = AwcPatcher.Load(TestAwcFactory.Create(dir, false, Specs), "weapons.awc");
        var hash = TestAwcFactory.Hash("pistol_mag_out");

        var (fit44, _) = AwcPatcher.Fit(awc, hash, TestAudio.Sine(100, 0.5, 44100));
        Assert.Equal(44100, fit44.SampleRate);
        AwcPatcher.ReplaceStream(awc, hash, fit44);
        var back = AwcPatcher.Load(AwcPatcher.SaveAndDispose(awc), "weapons.awc");
        var info = AwcPatcher.Describe(AwcPatcher.FindStream(back, hash));
        Assert.Equal(44100, info.SampleRate);
        Assert.Equal(0.5, info.DurationSeconds, 3);

        var (fit96, _) = AwcPatcher.Fit(back, hash, TestAudio.Sine(100, 0.1, 96000));
        Assert.Equal(48000, fit96.SampleRate);
        Assert.Throws<AwcException>(() => AwcPatcher.ReplaceStream(back, hash, TestAudio.Sine(100, 0.1, 96000)));
        Assert.Throws<AwcException>(() => AwcPatcher.FindStream(back, 0x0BADBEEF));
    }

    /// <summary>„Export to open format“ + Re-Import: alles PCM, unverschlüsselt, Klang und Headroom unverändert.</summary>
    [Fact]
    public void ConvertToOpenFormat_Like_OpenIV()
    {
        using var dir = new TempDir();
        var original = TestAwcFactory.Create(dir, true, Specs);
        var before = AwcPatcher.Load(original, "weapons.awc");
        var awc = AwcPatcher.Load(original, "weapons.awc");
        awc.MultiChannelEncryptFlag = true; // wie Rockstars Originale (Flags 0xFF09)

        Assert.Equal(2, AwcPatcher.ConvertToOpenFormat(awc)); // zwei ADPCM-Einträge
        var back = AwcPatcher.Load(AwcPatcher.SaveAndDispose(awc), "weapons.awc");
        Assert.False(back.SingleChannelEncryptFlag);
        Assert.False(back.WholeFileEncrypted);
        Assert.False(back.MultiChannelEncryptFlag);
        Assert.Equal(0xFF01, back.Flags & 0xFF0F); // wie in allen handgemachten Packs
        foreach (var spec in Specs)
        {
            var h = TestAwcFactory.Hash(spec.Name);
            var a = AwcPatcher.FindStream(before, h);
            var b = AwcPatcher.FindStream(back, h);
            Assert.Equal("PCM", AwcPatcher.Describe(b).Codec);
            Assert.Equal(a.SamplesPerSecond, b.SamplesPerSecond);
            Assert.Equal(a.SampleCount, b.SampleCount);
            Assert.Equal(a.FormatChunk.Headroom, b.FormatChunk.Headroom);
            Assert.Equal(AwcPatcher.Decode(a).ToPcm16(), AwcPatcher.Decode(b).ToPcm16());
        }
    }

    /// <summary>Derselbe Sound in mehreren Einträgen (ganzer Reload in allen Varianten) wird nur einmal abgelegt – alle Einträge bleiben lesbar.</summary>
    [Fact]
    public void Identical_Sounds_Are_Stored_Once()
    {
        using var dir = new TempDir();
        var specs = new TestAwcFactory.StreamSpec[]
        {
            new("rel_a", "PCM", 32000, 0.1, 300), new("rel_b", "PCM", 32000, 0.1, 500), new("rel_c", "PCM", 32000, 0.1, 700), new("other", "PCM", 32000, 0.2, 900),
        };
        var awc = AwcPatcher.Load(TestAwcFactory.Create(dir, false, specs), "weapons.awc");
        AwcPatcher.ConvertToOpenFormat(awc);
        var reload = TestAudio.Sine(440, 1.0, 44100);
        foreach (var n in new[] { "rel_a", "rel_b", "rel_c" }) AwcPatcher.ReplaceStream(awc, TestAwcFactory.Hash(n), reload);
        var full = AwcPatcher.SaveAndDispose(awc);

        var shared = AwcDedupe.ShareIdenticalData(full);
        Assert.True(shared.Length < full.Length - 2 * 88000, $"{full.Length} → {shared.Length}"); // zwei Kopien à 88 200 Bytes gespart

        var back = AwcPatcher.Load(shared, "weapons.awc");
        var expected = AwcPatcher.Encode(reload, AwcCodecType.PCM).Data;
        foreach (var n in new[] { "rel_a", "rel_b", "rel_c" })
            Assert.Equal(expected, AwcPatcher.FindStream(back, TestAwcFactory.Hash(n)).GetRawData());
        var other = AwcPatcher.FindStream(back, TestAwcFactory.Hash("other"));
        Assert.Equal(AwcPatcher.FindStream(AwcPatcher.Load(full, "weapons.awc"), TestAwcFactory.Hash("other")).GetRawData(), other.GetRawData());

        // nichts zu teilen → unverändert
        Assert.Same(shared, AwcDedupe.ShareIdenticalData(shared));
    }

    /// <summary>
    /// RESIDENT.rpf lädt GTA komplett in einen festen Speicher: eine AWC darin darf nie größer als das Original werden
    /// (sonst sind im Spiel alle Waffen stumm). Knapp zu groß → eigene Sounds werden kleiner gerechnet; viel zu groß → klare Meldung.
    /// </summary>
    [Fact]
    public void Resident_Awc_Never_Grows()
    {
        using var dir = new TempDir();
        var specs = new TestAwcFactory.StreamSpec[]
        {
            new("weapons_shot", "PCM", 32000, 1.0, 300),
            new("weapons_click", "PCM", 32000, 0.1, 900),
        };
        var awcBytes = TestAwcFactory.Create(dir, false, specs);
        const string rel = "x64\\audio\\sfx\\RESIDENT.rpf";
        Directory.CreateDirectory(Path.GetDirectoryName(dir.File(rel))!);
        var rpf = RpfFile.CreateNew(dir.Path, rel, RpfEncryption.OPEN);
        RpfFile.CreateFile(rpf.Root, "weapons.awc", awcBytes);
        var awcPath = rel + "\\weapons.awc";
        var hash = TestAwcFactory.Hash("weapons_click");

        // 0.15 s bei 48 kHz statt 0.1 s Klick bei 32 kHz: so passt es nicht – bei 16 kHz schon (Datei bleibt ≤ Original)
        var ok = dir.File("ok.rpf");
        File.Copy(dir.File(rel), ok);
        var notes = new List<string>();
        var written = RpfPatcher.PatchInPlace(ok, rel,
            new List<StreamReplacement> { new("reload", awcPath, hash, TestAudio.Sine(440, 0.15, 48000), "PCM", 0.1) },
            OutputEncryption.Open, null, notes.Add);
        var newSize = RpfAccess.Extract(RpfAccess.FindFile(RpfAccess.OpenRoot(ok, rel), awcPath)!).Length;
        Assert.True(newSize <= awcBytes.Length, $"{newSize} > {awcBytes.Length}");
        Assert.True(written[0].MonoAudio.SampleRate < 48000);
        Assert.Contains(notes, n => n.Contains("kHz"));
        Assert.All(PackVerifier.Verify(ok, rel, written), i => Assert.True(i.Ok, i.Problem));

        // viel zu lang → Fehlermeldung statt eines Packs, in dem alle Waffen stumm sind
        var bad = dir.File("bad.rpf");
        File.Copy(dir.File(rel), bad);
        var ex = Assert.Throws<GtaException>(() => RpfPatcher.PatchInPlace(bad, rel,
            new List<StreamReplacement> { new("reload", awcPath, hash, TestAudio.Sine(440, 5.0, 48000), "PCM", 0.1) },
            OutputEncryption.Open));
        Assert.Contains("zu lang", ex.Message);
    }

    /// <summary>Kompletter Weg ohne Spiel: AWC in ein (OPEN-)RPF packen → patchen → RPF neu öffnen → prüfen.</summary>
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Rpf_Patch_And_Verify(bool nested)
    {
        using var dir = new TempDir();
        var awcBytes = TestAwcFactory.Create(dir, true, Specs);

        var rel = nested ? "update\\x64\\dlcpacks\\test\\dlc.rpf" : "x64\\audio\\sfx\\WEAPONS_PLAYER.rpf";
        Directory.CreateDirectory(Path.GetDirectoryName(dir.File(rel))!);
        var rpf = RpfFile.CreateNew(dir.Path, rel, RpfEncryption.OPEN);
        string awcVirtual;
        if (nested)
        {
            var x64 = RpfFile.CreateDirectory(rpf.Root, "x64");
            var audio = RpfFile.CreateDirectory(x64, "audio");
            var sfx = RpfFile.CreateDirectory(audio, "sfx");
            var child = RpfFile.CreateNew(sfx, "dlc_test.rpf", RpfEncryption.OPEN);
            RpfFile.CreateFile(child.Root, "other.awc", TestAwcFactory.Create(dir, false, new TestAwcFactory.StreamSpec("other", "PCM", 22050, 0.1, 100)));
            RpfFile.CreateFile(child.Root, "weapons.awc", awcBytes);
            awcVirtual = rel + "\\x64\\audio\\sfx\\dlc_test.rpf\\weapons.awc";
        }
        else
        {
            RpfFile.CreateFile(rpf.Root, "weapons.awc", awcBytes);
            awcVirtual = rel + "\\weapons.awc";
        }

        var copy = dir.File("work.rpf");
        File.Copy(dir.File(rel), copy);
        var reps = new List<StreamReplacement>
        {
            new("WEAPON_PISTOL/Reload/mag_out", awcVirtual, TestAwcFactory.Hash("pistol_mag_out"), TestAudio.Sine(330, 1.2, 32000), "ADPCM", 0.4),
            new("WEAPON_PISTOL/Reload/mag_in", awcVirtual, TestAwcFactory.Hash("pistol_mag_in"), TestAudio.Sine(440, 0.2, 22050), "PCM", 0.3),
        };
        var written = RpfPatcher.PatchInPlace(copy, rel, reps, OutputEncryption.Open);

        var items = PackVerifier.Verify(copy, rel, written);
        Assert.All(items, i => Assert.True(i.Ok, i.Problem));
        Assert.Equal(38400, items[0].ActualSamples);
        Assert.All(items, i => Assert.Equal("PCM", i.ActualCodec)); // wie OpenIV: offenes Format
        Assert.Equal(22050, items[1].ActualSampleRate);

        // Original unverändert, andere Dateien im Archiv weiterhin lesbar
        Assert.True(new FileInfo(dir.File(rel)).Length < new FileInfo(copy).Length);
        if (nested)
        {
            var root = RpfAccess.OpenRoot(copy, rel);
            var other = RpfAccess.FindFile(root, rel + "\\x64\\audio\\sfx\\dlc_test.rpf\\other.awc");
            Assert.NotNull(other);
            Assert.Single(AwcPatcher.ListEntries(AwcPatcher.Load(RpfAccess.Extract(other!), "other.awc")));
        }
    }
}
