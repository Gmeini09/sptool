namespace GtaSoundpack.Core.Audio;

/// <summary>
/// Unkomprimiertes Audio im Speicher: ein float-Array pro Kanal, Werte im Bereich [-1, 1].
/// </summary>
public sealed class AudioBuffer
{
    public AudioBuffer(int sampleRate, float[][] channels)
    {
        if (sampleRate <= 0) throw new ArgumentOutOfRangeException(nameof(sampleRate));
        if (channels.Length == 0) throw new ArgumentException("Mindestens ein Kanal erforderlich.", nameof(channels));
        var len = channels[0].Length;
        if (channels.Any(c => c.Length != len)) throw new ArgumentException("Alle Kanäle müssen gleich lang sein.", nameof(channels));
        SampleRate = sampleRate;
        Channels = channels;
    }

    public int SampleRate { get; }
    public float[][] Channels { get; }
    public int ChannelCount => Channels.Length;
    public int FrameCount => Channels[0].Length;
    public double DurationSeconds => (double)FrameCount / SampleRate;

    public AudioBuffer Clone() => new(SampleRate, Channels.Select(c => (float[])c.Clone()).ToArray());

    public static AudioBuffer Silence(int sampleRate, int channels, int frames) =>
        new(sampleRate, Enumerable.Range(0, channels).Select(_ => new float[frames]).ToArray());

    public static AudioBuffer FromPcm16Mono(byte[] pcm, int sampleRate)
    {
        var n = pcm.Length / 2;
        var data = new float[n];
        for (var i = 0; i < n; i++)
        {
            data[i] = BitConverter.ToInt16(pcm, i * 2) / 32768f;
        }
        return new AudioBuffer(sampleRate, new[] { data });
    }

    /// <summary>Konvertiert einen Kanal in 16-Bit-PCM (little endian) mit Clipping.</summary>
    public byte[] ToPcm16(int channel = 0)
    {
        var src = Channels[channel];
        var bytes = new byte[src.Length * 2];
        for (var i = 0; i < src.Length; i++)
        {
            var v = (int)Math.Round(src[i] * 32767.0);
            v = Math.Clamp(v, short.MinValue, short.MaxValue);
            bytes[i * 2] = (byte)(v & 0xFF);
            bytes[i * 2 + 1] = (byte)((v >> 8) & 0xFF);
        }
        return bytes;
    }

    public AudioStats GetStats() => AudioStats.From(this);
}

public sealed record AudioStats(double DurationSeconds, double PeakDbfs, double RmsDbfs, int SampleRate, int Channels)
{
    public const double SilenceDb = -120.0;

    public static AudioStats From(AudioBuffer b)
    {
        double peak = 0, sumSq = 0;
        long n = 0;
        foreach (var ch in b.Channels)
        {
            foreach (var s in ch)
            {
                var a = Math.Abs(s);
                if (a > peak) peak = a;
                sumSq += (double)s * s;
                n++;
            }
        }
        var rms = n > 0 ? Math.Sqrt(sumSq / n) : 0;
        return new AudioStats(b.DurationSeconds, ToDb(peak), ToDb(rms), b.SampleRate, b.ChannelCount);
    }

    public static double ToDb(double linear) => linear <= 1e-6 ? SilenceDb : 20.0 * Math.Log10(linear);
    public static double FromDb(double db) => Math.Pow(10.0, db / 20.0);
}
