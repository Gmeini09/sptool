using CodeWalker.GameFiles;
using GtaSoundpack.Core.Audio;
using GtaSoundpack.Core.Awc;
using GtaSoundpack.Core.Gta;
using GtaSoundpack.Core.Project;

namespace GtaSoundpack.Core.Build;

/// <summary>Ein zu ersetzender AWC-Eintrag mit bereits fertig konvertiertem Mono-Audio (Ziel-Samplerate).</summary>
public sealed record StreamReplacement(
    string SlotId,
    string AwcPath,
    uint StreamHash,
    AudioBuffer MonoAudio,
    string ExpectedCodec,
    double OriginalDuration);

/// <summary>Patcht eine (bereits kopierte!) Top-Level-RPF-Datei: AWC extrahieren â†’ EintrÃ¤ge ersetzen â†’ zurÃ¼ckschreiben.</summary>
public static class RpfPatcher
{
    /// <summary>
    /// Ablauf wie von Hand mit OpenIV: AWC aus dem Archiv holen â†’ als offenes Format (PCM, unverschlÃ¼sselt) neu aufbauen â†’
    /// eigene WAVs unter dem Original-Eintrag einsetzen â†’ zurÃ¼ck ins Archiv. Liefert die Ersetzungen so,
    /// wie sie tatsÃ¤chlich geschrieben wurden (Samplerate/Codec) â€“ Grundlage fÃ¼r die PrÃ¼fung.
    /// </summary>
    /// <summary>
    /// Samplerates, auf die eigene Sounds stufenweise heruntergerechnet werden, wenn eine AWC in RESIDENT.rpf sonst grÃ¶ÃŸer
    /// als das Original wÃ¼rde (null = so wie geliefert).
    /// </summary>
    private static readonly int?[] ResidentRates = { null, 32000, 24000, 22050, 16000 };

    /// <summary>
    /// true fÃ¼r Archive, deren AWCs GTA komplett in einen festen Speicherbereich lÃ¤dt (RESIDENT.rpf). Wird eine davon
    /// grÃ¶ÃŸer als Rockstars Original, lÃ¤dt die ganze Bank nicht â€“ im Spiel sind dann ALLE Waffen stumm. Bei 119 geprÃ¼ften
    /// Community-Packs ist weapons.awc nie grÃ¶ÃŸer als das Original (19 466 072 Bytes).
    /// </summary>
    public static bool IsResidentArchive(string topLevelRelative) =>
        Path.GetFileName(topLevelRelative).Equals("RESIDENT.rpf", StringComparison.OrdinalIgnoreCase);

    public static List<StreamReplacement> PatchInPlace(string rpfFile, string topLevelRelative, IReadOnlyList<StreamReplacement> replacements,
        OutputEncryption encryption, Action<string>? log = null, Action<string>? notice = null)
    {
        var written = new List<StreamReplacement>();
        var root = RpfAccess.OpenRoot(rpfFile, topLevelRelative);

        if (encryption == OutputEncryption.Ng)
        {
            var needsNg = RpfAccess.AllArchives(root).Any(a => a.Encryption == RpfEncryption.NG);
            if (needsNg && !KeyManager.EncryptionTablesReady)
                throw new GtaException("FÃ¼r NG-VerschlÃ¼sselung mÃ¼ssen die Encrypt-Tabellen geladen sein (KeyManager.EnsureEncryptionTables).");
        }

        foreach (var group in replacements.GroupBy(r => RpfAccess.NormalizeVirtual(r.AwcPath), StringComparer.OrdinalIgnoreCase))
        {
            var entry = RpfAccess.FindFile(root, group.Key)
                        ?? throw new GtaException($"Eintrag '{group.Key}' nicht im Archiv gefunden.");
            log?.Invoke($"Bearbeite {group.Key} â€¦");

            var original = RpfAccess.Extract(entry);
            long? limit = IsResidentArchive(topLevelRelative) ? original.Length : null;
            byte[]? bytes = null;
            List<StreamReplacement>? groupWritten = null;
            int? usedRate = null;
            foreach (var maxRate in limit == null ? new int?[] { null } : ResidentRates)
            {
                var awc = AwcPatcher.Load(original, entry.Name);
                var conv = AwcPatcher.ConvertToOpenFormat(awc);
                if (conv > 0 && maxRate == null) log?.Invoke($"  {entry.Name}: {conv} EintrÃ¤ge als offenes Format (PCM) neu aufgebaut");
                groupWritten = new List<StreamReplacement>();
                foreach (var r in group)
                {
                    var (audio, codec) = AwcPatcher.Fit(awc, r.StreamHash, r.MonoAudio);
                    if (maxRate is int mr && audio.SampleRate > mr && !awc.MultiChannelFlag) audio = AudioProcessor.Resample(audio, mr);
                    AwcPatcher.ReplaceStream(awc, r.StreamHash, audio);
                    groupWritten.Add(r with { MonoAudio = audio, ExpectedCodec = codec.ToString() });
                }
                bytes = AwcPatcher.SaveAndDispose(awc);
                // gleiche Audiodaten (z. B. derselbe ganze Reload in allen Varianten) nur einmal ablegen
                var shared = AwcDedupe.ShareIdenticalData(bytes);
                if (shared.Length < bytes.Length) log?.Invoke($"  {entry.Name}: gleiche Sounds nur einmal abgelegt ({bytes.Length:N0} → {shared.Length:N0} Bytes)");
                bytes = shared;
                usedRate = maxRate;
                if (limit == null || bytes.Length <= limit) break;
                log?.Invoke($"  {entry.Name} wÃ¤re {bytes.Length:N0} Bytes groÃŸ (Original {limit:N0}) â€“ zu groÃŸ fÃ¼r GTAs Speicher, rechne kleiner â€¦");
            }
            if (limit != null && bytes!.Length > limit)
                throw new GtaException(
                    $"Deine Sounds sind zusammen zu lang fÃ¼r {entry.Name}: GTA lÃ¤dt diese Datei komplett in einen festen Speicher, sie darf nicht grÃ¶ÃŸer " +
                    $"als das Original werden ({limit:N0} Bytes) â€“ sonst sind im Spiel alle Waffen stumm. Mach den Reload bzw. die SchÃ¼sse kÃ¼rzer.");
            if (usedRate is int ur)
                notice?.Invoke($"Damit {entry.Name} in GTAs Speicher passt (nicht grÃ¶ÃŸer als das Original), wurden deine Sounds darin auf {ur / 1000.0:0.##} kHz gerechnet.");
            foreach (var w in groupWritten!)
            {
                written.Add(w);
                log?.Invoke($"  ersetzt 0x{w.StreamHash:X8} ({w.SlotId}), {w.MonoAudio.DurationSeconds:0.000}s, {w.MonoAudio.SampleRate} Hz {w.ExpectedCodec}");
            }

            if (encryption == OutputEncryption.Open)
            {
                // Archivkette (Kind â†’ Wurzel) auf OpenIV-Format umstellen, wie CodeWalker es beim Bearbeiten tut.
                RpfFile.EnsureValidEncryption(entry.File, _ => true, false);
            }
            var dir = entry.Parent ?? throw new GtaException($"Eintrag '{entry.Path}' hat keinen Elternordner.");
            RpfFile.CreateFile(dir, entry.Name, bytes, overwrite: true);
        }

        FixRootSize(root, rpfFile, log);
        return written;
    }

    /// <summary>
    /// Der NG-SchlÃ¼ssel hÃ¤ngt von Dateiname und -grÃ¶ÃŸe ab. CodeWalker fÃ¼hrt FileSize beim Wachsen nach;
    /// hier wird sichergestellt, dass die physische GrÃ¶ÃŸe exakt dem Wert entspricht, mit dem der Header verschlÃ¼sselt wurde.
    /// </summary>
    public static void FixRootSize(RpfFile root, string path, Action<string>? log)
    {
        var physical = new FileInfo(path).Length;
        if (physical == root.FileSize) return;
        if (physical < root.FileSize)
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Write);
            fs.SetLength(root.FileSize);
            log?.Invoke($"ArchivgrÃ¶ÃŸe auf {root.FileSize} Bytes aufgefÃ¼llt.");
        }
        else
        {
            root.FileSize = physical;
            RpfFile.SetEncryptionType(root, root.Encryption); // Header mit korrekter GrÃ¶ÃŸe neu schreiben
            log?.Invoke($"Header fÃ¼r ArchivgrÃ¶ÃŸe {physical} neu geschrieben.");
        }
    }
}

public static class PackVerifier
{
    /// <summary>Ã–ffnet das erzeugte RPF neu, liest alle ersetzten EintrÃ¤ge zurÃ¼ck und vergleicht sie mit der Erwartung.</summary>
    public static List<VerifyItem> Verify(string rpfFile, string topLevelRelative, IReadOnlyList<StreamReplacement> replacements)
    {
        var items = new List<VerifyItem>();
        RpfFile root;
        try
        {
            root = RpfAccess.OpenRoot(rpfFile, topLevelRelative);
        }
        catch (Exception ex)
        {
            items.AddRange(replacements.Select(r => new VerifyItem
            {
                SlotId = r.SlotId, AwcPath = r.AwcPath, StreamHash = $"0x{r.StreamHash:X8}", Ok = false,
                Problem = "Archiv lÃ¤sst sich nicht Ã¶ffnen: " + ex.Message,
            }));
            return items;
        }

        foreach (var group in replacements.GroupBy(r => RpfAccess.NormalizeVirtual(r.AwcPath), StringComparer.OrdinalIgnoreCase))
        {
            AwcFile? awc = null;
            string? groupError = null;
            try
            {
                var entry = RpfAccess.FindFile(root, group.Key) ?? throw new GtaException("Eintrag fehlt im erzeugten Archiv.");
                awc = AwcPatcher.Load(RpfAccess.Extract(entry), entry.Name);
            }
            catch (Exception ex)
            {
                groupError = ex.Message;
            }

            foreach (var r in group)
            {
                var item = new VerifyItem
                {
                    SlotId = r.SlotId,
                    AwcPath = r.AwcPath,
                    StreamHash = $"0x{r.StreamHash:X8}",
                    ExpectedCodec = r.ExpectedCodec,
                    ExpectedSampleRate = r.MonoAudio.SampleRate,
                    OriginalDuration = r.OriginalDuration,
                };
                items.Add(item);
                if (awc == null)
                {
                    item.Problem = groupError;
                    continue;
                }
                try
                {
                    var s = AwcPatcher.FindStream(awc, r.StreamHash);
                    var info = AwcPatcher.Describe(s);
                    var codec = AwcPatcher.ParseCodec(r.ExpectedCodec);
                    var (samples, expectedData, _) = AwcPatcher.Encode(r.MonoAudio, codec);
                    item.ExpectedSamples = samples;
                    item.ActualCodec = info.Codec;
                    item.ActualSampleRate = info.SampleRate;
                    item.ActualSamples = info.Samples;
                    item.ActualDuration = info.DurationSeconds;

                    var raw = s.GetRawData() ?? Array.Empty<byte>();
                    item.DataMatches = raw.Length >= expectedData.Length
                                       && raw.AsSpan(0, expectedData.Length).SequenceEqual(expectedData)
                                       && raw.AsSpan(expectedData.Length).IndexOfAnyExcept((byte)0) < 0;

                    var problems = new List<string>();
                    if (!info.Codec.Equals(r.ExpectedCodec, StringComparison.OrdinalIgnoreCase)) problems.Add("Codec");
                    if (info.SampleRate != r.MonoAudio.SampleRate) problems.Add("Samplerate");
                    if (info.Samples != samples) problems.Add("Sampleanzahl");
                    if (!item.DataMatches) problems.Add("Audiodaten");
                    item.Ok = problems.Count == 0;
                    if (!item.Ok) item.Problem = "Abweichung: " + string.Join(", ", problems);
                }
                catch (Exception ex)
                {
                    item.Problem = ex.Message;
                }
            }
        }
        return items;
    }
}
