namespace GtaSoundpack.Core.Audio;

/// <summary>Bearbeitungsparameter für einen importierten Sound (wird im Projekt gespeichert).</summary>
public sealed class EditSettings
{
    /// <summary>Startpunkt in Sekunden (0 = Anfang).</summary>
    public double TrimStartSeconds { get; set; }
    /// <summary>Endpunkt in Sekunden (null = bis zum Ende).</summary>
    public double? TrimEndSeconds { get; set; }
    public bool Normalize { get; set; }
    /// <summary>Zielpegel für die Spitzenwert-Normalisierung in dBFS.</summary>
    public double NormalizePeakDb { get; set; } = -1.0;
    public double GainDb { get; set; }
    public double FadeInMs { get; set; }
    public double FadeOutMs { get; set; }

    public EditSettings Clone() => (EditSettings)MemberwiseClone();
}

/// <summary>Zielformat, abgeleitet aus dem Original-AWC-Eintrag.</summary>
public sealed record TargetFormat(int SampleRate, int Channels);

public static class AudioProcessor
{
    public static AudioBuffer Apply(AudioBuffer input, EditSettings s)
    {
        var b = Trim(input, s.TrimStartSeconds, s.TrimEndSeconds);
        if (Math.Abs(s.GainDb) > 1e-9) b = Gain(b, s.GainDb);
        if (s.Normalize) b = NormalizePeak(b, s.NormalizePeakDb);
        if (s.FadeInMs > 0 || s.FadeOutMs > 0) b = Fade(b, s.FadeInMs, s.FadeOutMs);
        return b;
    }

    /// <summary>Komplette Pipeline: Bearbeitung → Kanalanpassung → Resampling.</summary>
    public static AudioBuffer Prepare(AudioBuffer input, EditSettings s, TargetFormat target)
    {
        var b = Apply(input, s);
        b = ConvertChannels(b, target.Channels);
        b = Resample(b, target.SampleRate);
        return b;
    }

    public static AudioBuffer Trim(AudioBuffer b, double startSec, double? endSec)
    {
        var start = (int)Math.Clamp(Math.Round(startSec * b.SampleRate), 0, b.FrameCount);
        var end = endSec.HasValue ? (int)Math.Clamp(Math.Round(endSec.Value * b.SampleRate), start, b.FrameCount) : b.FrameCount;
        if (start == 0 && end == b.FrameCount) return b.Clone();
        var len = end - start;
        return new AudioBuffer(b.SampleRate, b.Channels.Select(c => c.AsSpan(start, len).ToArray()).ToArray());
    }

    public static AudioBuffer Gain(AudioBuffer b, double db)
    {
        var g = (float)AudioStats.FromDb(db);
        return new AudioBuffer(b.SampleRate, b.Channels.Select(c => c.Select(x => x * g).ToArray()).ToArray());
    }

    public static AudioBuffer NormalizePeak(AudioBuffer b, double targetDb)
    {
        var peak = b.Channels.SelectMany(c => c).Select(Math.Abs).DefaultIfEmpty(0f).Max();
        if (peak < 1e-6f) return b.Clone();
        var g = (float)(AudioStats.FromDb(targetDb) / peak);
        return new AudioBuffer(b.SampleRate, b.Channels.Select(c => c.Select(x => x * g).ToArray()).ToArray());
    }

    public static AudioBuffer Fade(AudioBuffer b, double fadeInMs, double fadeOutMs)
    {
        var r = b.Clone();
        var n = r.FrameCount;
        var fin = Math.Min(n, (int)Math.Round(fadeInMs / 1000.0 * r.SampleRate));
        var fout = Math.Min(n, (int)Math.Round(fadeOutMs / 1000.0 * r.SampleRate));
        foreach (var c in r.Channels)
        {
            for (var i = 0; i < fin; i++) c[i] *= (float)i / fin;
            for (var i = 0; i < fout; i++) c[n - 1 - i] *= (float)i / fout;
        }
        return r;
    }

    /// <summary>Mono ← Mittelwert aller Kanäle; mehr Kanäle ← Mono wird dupliziert bzw. vorhandene Kanäle zyklisch verteilt.</summary>
    public static AudioBuffer ConvertChannels(AudioBuffer b, int channels)
    {
        if (channels <= 0) throw new ArgumentOutOfRangeException(nameof(channels));
        if (b.ChannelCount == channels) return b.Clone();
        var n = b.FrameCount;
        if (channels == 1)
        {
            var mono = new float[n];
            foreach (var c in b.Channels)
                for (var i = 0; i < n; i++) mono[i] += c[i];
            var inv = 1f / b.ChannelCount;
            for (var i = 0; i < n; i++) mono[i] *= inv;
            return new AudioBuffer(b.SampleRate, new[] { mono });
        }
        var outCh = new float[channels][];
        for (var c = 0; c < channels; c++) outCh[c] = (float[])b.Channels[c % b.ChannelCount].Clone();
        return new AudioBuffer(b.SampleRate, outCh);
    }

    /// <summary>Hochwertiges Resampling über gefensterten Sinc-Interpolator (Blackman, 32 Taps je Seite).</summary>
    public static AudioBuffer Resample(AudioBuffer b, int targetRate)
    {
        if (targetRate <= 0) throw new ArgumentOutOfRangeException(nameof(targetRate));
        if (b.SampleRate == targetRate) return b.Clone();
        var ratio = (double)targetRate / b.SampleRate;
        var outLen = (int)Math.Round(b.FrameCount * ratio);
        const int halfTaps = 32;
        var cutoff = Math.Min(1.0, ratio); // Tiefpass bei Downsampling
        var outCh = new float[b.ChannelCount][];
        for (var c = 0; c < b.ChannelCount; c++)
        {
            var src = b.Channels[c];
            var dst = new float[outLen];
            for (var i = 0; i < outLen; i++)
            {
                var pos = i / ratio;
                var center = (int)Math.Floor(pos);
                double acc = 0, wsum = 0;
                for (var k = center - halfTaps + 1; k <= center + halfTaps; k++)
                {
                    var x = pos - k;
                    var w = Blackman(x, halfTaps) * Sinc(x * cutoff) * cutoff;
                    wsum += w;
                    if (k >= 0 && k < src.Length) acc += src[k] * w;
                }
                dst[i] = (float)(wsum > 1e-9 ? acc / wsum : acc);
            }
            outCh[c] = dst;
        }
        return new AudioBuffer(targetRate, outCh);
    }

    private static double Sinc(double x) => Math.Abs(x) < 1e-9 ? 1.0 : Math.Sin(Math.PI * x) / (Math.PI * x);

    private static double Blackman(double x, int half)
    {
        var t = (x + half) / (2.0 * half);
        if (t < 0 || t > 1) return 0;
        return 0.42 - 0.5 * Math.Cos(2 * Math.PI * t) + 0.08 * Math.Cos(4 * Math.PI * t);
    }

    /// <summary>Verlängert auf ein Vielfaches von <paramref name="multiple"/> Samples (mit Stille).</summary>
    public static AudioBuffer PadToMultiple(AudioBuffer b, int multiple)
    {
        var rem = b.FrameCount % multiple;
        if (rem == 0 && b.FrameCount > 0) return b;
        var newLen = b.FrameCount == 0 ? multiple : b.FrameCount + (multiple - rem);
        return new AudioBuffer(b.SampleRate, b.Channels.Select(c =>
        {
            var a = new float[newLen];
            Array.Copy(c, a, c.Length);
            return a;
        }).ToArray());
    }
}
