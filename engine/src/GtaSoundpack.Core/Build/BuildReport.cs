using System.Text;
using GtaSoundpack.Core.Audio;

namespace GtaSoundpack.Core.Build;

public sealed class VerifyItem
{
    public string SlotId { get; set; } = "";
    public string AwcPath { get; set; } = "";
    public string StreamHash { get; set; } = "";
    public string ExpectedCodec { get; set; } = "";
    public string ActualCodec { get; set; } = "";
    public int ExpectedSampleRate { get; set; }
    public int ActualSampleRate { get; set; }
    public int ExpectedSamples { get; set; }
    public int ActualSamples { get; set; }
    public double OriginalDuration { get; set; }
    public double ActualDuration { get; set; }
    public bool DataMatches { get; set; }
    public bool Ok { get; set; }
    public string? Problem { get; set; }
}

public sealed class BuildReport
{
    public bool Success => Errors.Count == 0 && Items.All(i => i.Ok);
    public List<string> Errors { get; } = new();
    public List<AudioWarning> Warnings { get; } = new();
    public List<string> Log { get; } = new();
    public List<VerifyItem> Items { get; } = new();
    public List<string> OutputFiles { get; } = new();
    public string? PackFolder { get; set; }
    public string? ZipPath { get; set; }
    public TimeSpan Elapsed { get; set; }

    public string ToText()
    {
        var sb = new StringBuilder();
        sb.AppendLine(Success ? "BUILD ERFOLGREICH" : "BUILD FEHLGESCHLAGEN");
        sb.AppendLine($"Dauer: {Elapsed.TotalSeconds:0.0}s");
        if (PackFolder != null) sb.AppendLine($"Pack-Ordner: {PackFolder}");
        if (ZipPath != null) sb.AppendLine($"ZIP: {ZipPath}");
        foreach (var f in OutputFiles) sb.AppendLine($"  Datei: {f}");
        if (Errors.Count > 0)
        {
            sb.AppendLine().AppendLine("Fehler:");
            foreach (var e in Errors) sb.AppendLine("  - " + e);
        }
        if (Warnings.Count > 0)
        {
            sb.AppendLine().AppendLine("Warnungen:");
            foreach (var w in Warnings) sb.AppendLine($"  [{w.Level}] {w.Message}");
        }
        if (Items.Count > 0)
        {
            sb.AppendLine().AppendLine("Prüfung (zurückgelesen aus dem erzeugten RPF):");
            foreach (var i in Items)
            {
                sb.AppendLine($"  {(i.Ok ? "OK  " : "FEHL")} {i.SlotId}  {i.AwcPath} [{i.StreamHash}]");
                sb.AppendLine($"       Codec {i.ActualCodec} (erw. {i.ExpectedCodec}), {i.ActualSampleRate} Hz (erw. {i.ExpectedSampleRate}), " +
                              $"{i.ActualSamples} Samples (erw. {i.ExpectedSamples}), Dauer {i.ActualDuration:0.000}s (Original {i.OriginalDuration:0.000}s), Daten {(i.DataMatches ? "identisch" : "ABWEICHEND")}");
                if (i.Problem != null) sb.AppendLine("       Problem: " + i.Problem);
            }
        }
        return sb.ToString();
    }
}
