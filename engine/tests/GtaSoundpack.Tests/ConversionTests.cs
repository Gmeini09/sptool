using CodeWalker.GameFiles;
using GtaSoundpack.Core.Audio;
using GtaSoundpack.Core.Awc;

namespace GtaSoundpack.Tests;

public class ConversionTests
{
    [Fact]
    public void Wav_Roundtrip_16Bit_Stereo()
    {
        var src = TestAudio.Sine(440, 0.25, 44100, channels: 2);
        var back = WavFile.Read(WavFile.Write16(src));
        Assert.Equal(44100, back.SampleRate);
        Assert.Equal(2, back.ChannelCount);
        Assert.Equal(src.FrameCount, back.FrameCount);
        for (var i = 0; i < src.FrameCount; i += 97)
            Assert.InRange(back.Channels[1][i] - src.Channels[1][i], -1e-4f, 1e-4f);
    }

    [Theory]
    [InlineData(44100, 32000)]
    [InlineData(48000, 24000)]
    [InlineData(22050, 32000)]
    public void Resample_KeepsDurationAndFrequency(int from, int to)
    {
        var src = TestAudio.Sine(1000, 0.5, from);
        var r = AudioProcessor.Resample(src, to);
        Assert.Equal(to, r.SampleRate);
        Assert.InRange(r.DurationSeconds, 0.499, 0.501);
        // Nulldurchgänge zählen → Frequenz bleibt ~1 kHz
        var zc = 0;
        var c = r.Channels[0];
        for (var i = 1; i < c.Length; i++) if (c[i - 1] < 0 && c[i] >= 0) zc++;
        Assert.InRange(zc, 495, 505);
        // Amplitude bleibt erhalten (Mitte des Signals, ohne Randeffekte)
        var peak = c.Skip(c.Length / 4).Take(c.Length / 2).Max(Math.Abs);
        Assert.InRange(peak, 0.47f, 0.53f);
    }

    [Fact]
    public void ConvertChannels_StereoToMono_Averages()
    {
        var b = new AudioBuffer(8000, new[] { new[] { 1f, 0.5f }, new[] { 0f, -0.5f } });
        var m = AudioProcessor.ConvertChannels(b, 1);
        Assert.Single(m.Channels);
        Assert.Equal(0.5f, m.Channels[0][0]);
        Assert.Equal(0f, m.Channels[0][1]);
    }

    [Fact]
    public void Normalize_HitsTargetPeak()
    {
        var src = TestAudio.Sine(200, 0.1, 32000, amp: 0.1f);
        var n = AudioProcessor.NormalizePeak(src, -1.0);
        Assert.InRange(n.GetStats().PeakDbfs, -1.01, -0.99);
    }

    [Fact]
    public void Trim_And_Fades()
    {
        var src = TestAudio.Sine(100, 1.0, 10000, amp: 1f);
        var s = new EditSettings { TrimStartSeconds = 0.25, TrimEndSeconds = 0.75, FadeInMs = 50, FadeOutMs = 50 };
        var r = AudioProcessor.Apply(src, s);
        Assert.Equal(5000, r.FrameCount);
        Assert.Equal(0f, r.Channels[0][0]);
        Assert.Equal(0f, r.Channels[0][^1]);
        Assert.True(Math.Abs(r.Channels[0][2500]) <= 1f);
    }

    [Fact]
    public void Prepare_ProducesTargetFormat()
    {
        var src = TestAudio.Sine(440, 0.3, 48000, channels: 2);
        var r = AudioProcessor.Prepare(src, new EditSettings { Normalize = true }, new TargetFormat(32000, 1));
        Assert.Equal(32000, r.SampleRate);
        Assert.Equal(1, r.ChannelCount);
        Assert.InRange(r.FrameCount, 9599, 9601);
    }

    [Fact]
    public void Pcm16_Clips_Instead_Of_Wrapping()
    {
        var b = new AudioBuffer(8000, new[] { new[] { 2f, -2f } });
        var pcm = b.ToPcm16();
        Assert.Equal(short.MaxValue, BitConverter.ToInt16(pcm, 0));
        Assert.Equal(short.MinValue, BitConverter.ToInt16(pcm, 2));
    }

    [Fact]
    public void Adpcm_Encode_Decodes_With_CodeWalker_And_Keeps_All_Samples()
    {
        var src = TestAudio.Sine(500, 0.6, 32000, amp: 0.6f); // 19200 Samples, > 4 Blöcke
        src = AudioProcessor.PadToMultiple(src, 8);
        var pcm = src.ToPcm16();
        var enc = ImaAdpcm.Encode(pcm, src.FrameCount);
        Assert.Equal(0, enc.Length % 4);
        var dec = ADPCMCodec.DecodeADPCM(enc, src.FrameCount);
        var back = AudioBuffer.FromPcm16Mono(dec.AsSpan(0, src.FrameCount * 2).ToArray(), 32000);

        double err = 0, sig = 0;
        for (var i = 0; i < src.FrameCount; i++)
        {
            var d = back.Channels[0][i] - src.Channels[0][i];
            err += d * d;
            sig += src.Channels[0][i] * src.Channels[0][i];
        }
        var snr = 10 * Math.Log10(sig / err);
        Assert.True(snr > 20, $"SNR zu niedrig: {snr:0.0} dB");
        // letzter Block enthält noch Signal (keine abgeschnittenen Samples)
        Assert.True(back.Channels[0].Skip(src.FrameCount - 200).Max(Math.Abs) > 0.3f);
    }

    [Fact]
    public void Comparison_Warns_On_Length_And_Loudness()
    {
        var orig = TestAudio.Sine(300, 0.5, 32000, amp: 0.5f).GetStats();
        var repl = TestAudio.Sine(300, 1.5, 32000, amp: 0.05f).GetStats();
        var cmp = AudioComparison.Compare(orig, repl);
        Assert.Contains(cmp.Warnings, w => w.Message.Contains("Länge"));
        Assert.Contains(cmp.Warnings, w => w.Message.Contains("Lautstärke"));

        var ok = AudioComparison.Compare(orig, TestAudio.Sine(300, 0.55, 32000, amp: 0.45f).GetStats());
        Assert.DoesNotContain(ok.Warnings, w => w.Level == WarningLevel.Warning);
    }
}
