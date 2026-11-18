using System.Globalization;
using System.Text;
using CodeWalker.GameFiles;
using GtaSoundpack.Core.Audio;
using GtaSoundpack.Core.Gta;

namespace GtaSoundpack.Tests;

internal sealed class TempDir : IDisposable
{
    public TempDir()
    {
        Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "gsp_" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(Path);
    }

    public string Path { get; }
    public string File(string name) => System.IO.Path.Combine(Path, name);

    public void Dispose()
    {
        try { Directory.Delete(Path, true); } catch { /* egal */ }
    }
}

internal static class TestAudio
{
    public static AudioBuffer Sine(double freq, double seconds, int rate, int channels = 1, float amp = 0.5f)
    {
        var n = (int)Math.Round(seconds * rate);
        var ch = new float[channels][];
        for (var c = 0; c < channels; c++)
        {
            ch[c] = new float[n];
            for (var i = 0; i < n; i++) ch[c][i] = amp * (float)Math.Sin(2 * Math.PI * freq * (c + 1) * i / rate);
        }
        return new AudioBuffer(rate, ch);
    }
}

/// <summary>Erzeugt eine synthetische AWC über CodeWalkers XML-Import – ganz ohne Spieldateien.</summary>
internal static class TestAwcFactory
{
    public static readonly uint[] DummyAwcKey = { 0x11111111, 0x22222222, 0x33333333, 0x44444444 };

    public sealed record StreamSpec(string Name, string Codec, int SampleRate, double Seconds, double Freq, bool WithPeak = true);

    public static byte[] Create(TempDir dir, bool encrypted, params StreamSpec[] streams)
    {
        KeyManager.UseAwcKeyForTests(DummyAwcKey);
        var wavDir = Path.Combine(dir.Path, "wav_" + Guid.NewGuid().ToString("N")[..6]);
        Directory.CreateDirectory(wavDir);
        var sb = new StringBuilder();
        sb.AppendLine("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
        sb.AppendLine("<AudioWaveContainer>");
        sb.AppendLine(" <Version value=\"1\" />");
        sb.AppendLine(" <ChunkIndices value=\"True\" />");
        if (encrypted) sb.AppendLine(" <SingleChannelEncrypt value=\"True\" />");
        sb.AppendLine(" <Streams>");
        foreach (var s in streams)
        {
            var audio = TestAudio.Sine(s.Freq, s.Seconds, s.SampleRate);
            var samples = audio.FrameCount;
            if (s.Codec == "ADPCM" && samples % 8 != 0) samples += 8 - samples % 8;
            audio = AudioProcessor.PadToMultiple(audio, s.Codec == "ADPCM" ? 8 : 2);
            File.WriteAllBytes(Path.Combine(wavDir, s.Name + ".wav"), WavFile.Write16(audio));
            sb.AppendLine("  <Item>");
            sb.AppendLine($"   <Name>{s.Name}</Name>");
            sb.AppendLine($"   <FileName>{s.Name}.wav</FileName>");
            sb.AppendLine("   <Chunks>");
            sb.AppendLine("    <Item><Type>data</Type></Item>");
            sb.AppendLine("    <Item>");
            sb.AppendLine("     <Type>format</Type>");
            sb.AppendLine($"     <Codec>{s.Codec}</Codec>");
            sb.AppendLine($"     <Samples value=\"{samples.ToString(CultureInfo.InvariantCulture)}\" />");
            sb.AppendLine($"     <SampleRate value=\"{s.SampleRate}\" />");
            sb.AppendLine("     <Headroom value=\"200\" />");
            sb.AppendLine("     <PlayBegin value=\"0\" />");
            sb.AppendLine("     <PlayEnd value=\"0\" />");
            sb.AppendLine("     <LoopBegin value=\"0\" />");
            sb.AppendLine("     <LoopEnd value=\"0\" />");
            sb.AppendLine("     <LoopPoint value=\"-1\" />");
            if (s.WithPeak) sb.AppendLine("     <Peak unk=\"0\" />");
            sb.AppendLine("    </Item>");
            sb.AppendLine("   </Chunks>");
            sb.AppendLine("  </Item>");
        }
        sb.AppendLine(" </Streams>");
        sb.AppendLine("</AudioWaveContainer>");
        var awc = XmlAwc.AwcYft(sb.ToString(), wavDir);
        return awc.Save();
    }

    public static uint Hash(string name) => JenkHash.GenHash(name.ToLowerInvariant()) & 0x1FFFFFFF;
}
