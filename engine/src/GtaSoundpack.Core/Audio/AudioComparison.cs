namespace GtaSoundpack.Core.Audio;

public enum WarningLevel { Info, Warning, Error }

public sealed record AudioWarning(WarningLevel Level, string Message);

/// <summary>Vergleicht den neuen Sound mit dem Original und erzeugt Warnungen bei starken Abweichungen.</summary>
public sealed record AudioComparison(AudioStats Original, AudioStats Replacement, IReadOnlyList<AudioWarning> Warnings)
{
    /// <summary>Faktor, ab dem eine Längenabweichung gewarnt wird (z. B. 1.5 = 50 % länger/kürzer).</summary>
    public static double LengthWarnFactor { get; set; } = 1.5;
    /// <summary>Lautheitsdifferenz (RMS, dB), ab der gewarnt wird.</summary>
    public static double LoudnessWarnDb { get; set; } = 6.0;

    public double LengthRatio => Original.DurationSeconds > 0 ? Replacement.DurationSeconds / Original.DurationSeconds : double.PositiveInfinity;
    public double RmsDifferenceDb => Replacement.RmsDbfs - Original.RmsDbfs;

    public static AudioComparison Compare(AudioStats original, AudioStats replacement)
    {
        var w = new List<AudioWarning>();
        if (original.DurationSeconds > 0)
        {
            var ratio = replacement.DurationSeconds / original.DurationSeconds;
            if (ratio > LengthWarnFactor || ratio < 1.0 / LengthWarnFactor)
            {
                w.Add(new AudioWarning(WarningLevel.Warning,
                    $"Länge weicht stark ab: {replacement.DurationSeconds:0.000}s statt {original.DurationSeconds:0.000}s (Faktor {ratio:0.00}). Animationen/Timing im Spiel können dann nicht mehr passen."));
            }
        }
        var diff = replacement.RmsDbfs - original.RmsDbfs;
        if (original.RmsDbfs > AudioStats.SilenceDb && Math.Abs(diff) > LoudnessWarnDb)
        {
            w.Add(new AudioWarning(WarningLevel.Warning,
                $"Lautstärke weicht um {diff:+0.0;-0.0} dB (RMS) vom Original ab."));
        }
        if (replacement.PeakDbfs > -0.1)
        {
            w.Add(new AudioWarning(WarningLevel.Info, "Spitzenpegel nahe 0 dBFS – mögliches Clipping. Normalisieren auf -1 dB empfohlen."));
        }
        if (replacement.RmsDbfs <= AudioStats.SilenceDb + 1)
        {
            w.Add(new AudioWarning(WarningLevel.Error, "Der neue Sound ist (fast) stumm."));
        }
        return new AudioComparison(original, replacement, w);
    }
}
