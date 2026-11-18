using CodeWalker.GameFiles;
using GtaSoundpack.Core.Audio;

namespace GtaSoundpack.Core.Awc;

/// <summary>Beschreibung eines Wave-Eintrags (Stream) in einer AWC.</summary>
public sealed record AwcEntryInfo(
    uint Hash,
    string Name,
    string Codec,
    int SampleRate,
    int Samples,
    int Channels,
    bool IsMultiChannel,
    bool IsMidi,
    short Headroom)
{
    public double DurationSeconds => SampleRate > 0 ? (double)Samples / SampleRate : 0;
    public string HashHex => "0x" + Hash.ToString("X8");
    public override string ToString() => $"{Name} ({Codec}, {SampleRate} Hz, {DurationSeconds:0.000}s)";
}

public sealed class AwcException : Exception
{
    public AwcException(string message, Exception? inner = null) : base(message, inner) { }
}

/// <summary>Lesen, Ersetzen und Schreiben von AWC-Einträgen auf Basis von CodeWalker.Core.</summary>
public static class AwcPatcher
{
    public static AwcFile Load(byte[] data, string name)
    {
        var copy = (byte[])data.Clone(); // AwcFile.Load entschlüsselt in-place
        var entry = new RpfBinaryFileEntry { Name = name, NameLower = name.ToLowerInvariant() };
        var awc = new AwcFile();
        try
        {
            awc.Load(copy, entry);
        }
        catch (Exception ex)
        {
            throw new AwcException($"AWC '{name}' konnte nicht gelesen werden: {ex.Message}", ex);
        }
        if (!string.IsNullOrEmpty(awc.ErrorMessage))
            throw new AwcException($"AWC '{name}' konnte nicht gelesen werden: {awc.ErrorMessage}");
        if (awc.Streams == null) throw new AwcException($"AWC '{name}' enthält keine Streams.");
        return awc;
    }

    public static uint NormalizeHash(uint hash) => hash & 0x1FFFFFFF;

    public static IEnumerable<AwcEntryInfo> ListEntries(AwcFile awc) =>
        awc.Streams.Where(s => s.Hash != 0 || !awc.MultiChannelFlag).Select(Describe);

    public static AwcStream FindStream(AwcFile awc, uint hash)
    {
        var h = NormalizeHash(hash);
        var s = awc.Streams.FirstOrDefault(x => (uint)x.Hash == h && !(awc.MultiChannelFlag && x == awc.MultiChannelSource));
        return s ?? throw new AwcException($"Eintrag 0x{hash:X8} wurde in der AWC '{awc.Name}' nicht gefunden.");
    }

    public static AwcEntryInfo Describe(AwcStream s)
    {
        var codec = s.MidiChunk != null ? "MIDI" : (s.StreamFormat?.Codec ?? s.FormatChunk?.Codec ?? AwcCodecType.PCM).ToString();
        return new AwcEntryInfo(
            (uint)s.Hash,
            s.Name,
            codec,
            s.SamplesPerSecond,
            s.SampleCount,
            1, // jeder AWC-Stream ist mono; Stereo = zwei Streams (_left/_right)
            s.Awc.MultiChannelFlag,
            s.MidiChunk != null,
            s.FormatChunk?.Headroom ?? s.StreamFormat?.Headroom ?? 0);
    }

    /// <summary>Dekodiert einen Eintrag zu 16-Bit-Mono-PCM.</summary>
    public static AudioBuffer Decode(AwcStream s)
    {
        if (s.MidiChunk != null) throw new AwcException("MIDI-Einträge können nicht als Audio dekodiert werden.");
        var pcm = s.GetPcmData();
        var len = Math.Min(pcm.Length, s.SampleCount * 2);
        if (len < pcm.Length) Array.Resize(ref pcm, len);
        return AudioBuffer.FromPcm16Mono(pcm, Math.Max(1, s.SamplesPerSecond));
    }

    public static byte[] ExportWav(AwcStream s) => WavFile.Write16(Decode(s));

    /// <summary>Höchste Samplerate, die das Format-Chunk (u16) aufnehmen kann.</summary>
    public const int MaxSampleRate = 65535;

    /// <summary>
    /// Wie OpenIV „Export to open format“ + Re-Import: alle Streams einer einkanaligen AWC werden zu
    /// unkomprimiertem 16-Bit-PCM, die AWC wird unverschlüsselt geschrieben (Flags 0xFF01 wie in handgemachten Packs).
    /// Headroom, Loop-Punkte, Marker und Peaks bleiben, der Klang der übrigen Streams ändert sich nicht.
    /// Mehrkanal-AWCs (verschränkte Blöcke) bleiben unverändert im Original-Codec.
    /// </summary>
    public static int ConvertToOpenFormat(AwcFile awc)
    {
        if (awc.MultiChannelFlag) return 0;
        var converted = 0;
        foreach (var s in awc.Streams)
        {
            var fc = s.FormatChunk;
            if (fc == null || s.DataChunk == null || s.MidiChunk != null || fc.Codec == AwcCodecType.PCM) continue;
            if (fc.Codec != AwcCodecType.ADPCM) continue; // unbekannte Codecs nicht anfassen
            var pcm = s.GetPcmData();
            var want = (int)fc.Samples * 2;
            if (pcm.Length != want) Array.Resize(ref pcm, want);
            fc.Codec = AwcCodecType.PCM;
            s.DataChunk.Data = pcm;
            converted++;
        }
        awc.WholeFileEncrypted = false;
        awc.SingleChannelEncryptFlag = false;
        // Rockstars Originale tragen zusätzlich das Flag "Mehrkanal-Daten verschlüsselt" (0x08, Flags 0xFF09). Bleibt es
        // stehen, entschlüsselt das Spiel die offenen Daten noch einmal → Datenmüll, im Spiel kommt kein Sound.
        // Handgemachte Packs (OpenIV) haben hier immer 0xFF01 – genau so wird es geschrieben.
        awc.MultiChannelEncryptFlag = false;
        awc.BuildChunkIndices();
        awc.BuildStreamInfos();
        awc.BuildStreamDict();
        return converted;
    }

    /// <summary>
    /// Bringt das Audio in die Form, in der es in diesen Stream geschrieben wird:
    /// einkanalige AWC → Samplerate der Quelle bleibt (wie OpenIV, nur über 65535 Hz wird auf 48 kHz gerechnet), Codec des Streams;
    /// Mehrkanal-AWC → Samplerate und Codec des Originals (alle Kanäle teilen sich die Blöcke).
    /// </summary>
    public static (AudioBuffer Audio, AwcCodecType Codec) Fit(AwcFile awc, uint hash, AudioBuffer mono)
    {
        var s = FindStream(awc, hash);
        if (awc.MultiChannelFlag)
        {
            var sf = s.StreamFormat ?? throw new AwcException($"Eintrag {s.Name} hat kein StreamFormat.");
            return (AudioProcessor.Resample(mono, sf.SamplesPerSecond), sf.Codec);
        }
        var fc = s.FormatChunk ?? throw new AwcException($"Eintrag {s.Name} hat keinen Format-Chunk.");
        var audio = mono.SampleRate > MaxSampleRate ? AudioProcessor.Resample(mono, 48000) : mono;
        return (audio, fc.Codec);
    }

    /// <summary>
    /// Ersetzt einen Eintrag durch neues Mono-Audio (vorher <see cref="Fit"/> anwenden).
    /// Einkanalig: die Samplerate des Audios wird übernommen (wie OpenIV), Codec und Headroom des Streams bleiben.
    /// Mehrkanalig: das Audio muss die Samplerate des Originals haben.
    /// </summary>
    public static void ReplaceStream(AwcFile awc, uint hash, AudioBuffer monoAudio)
    {
        if (monoAudio.ChannelCount != 1) throw new AwcException("ReplaceStream erwartet Mono-Audio (ein AWC-Stream = ein Kanal).");
        var stream = FindStream(awc, hash);
        if (stream.MidiChunk != null) throw new AwcException("MIDI-Einträge werden nicht unterstützt.");

        if (awc.MultiChannelFlag)
        {
            ReplaceMultiChannel(awc, stream, monoAudio);
        }
        else
        {
            ReplaceSingleChannel(stream, monoAudio);
        }

        awc.BuildChunkIndices();
        awc.BuildStreamInfos();
        awc.BuildStreamDict();
    }

    private static void ReplaceSingleChannel(AwcStream stream, AudioBuffer audio)
    {
        var fc = stream.FormatChunk ?? throw new AwcException($"Eintrag {stream.Name} hat keinen Format-Chunk.");
        if (audio.SampleRate < 1 || audio.SampleRate > MaxSampleRate)
            throw new AwcException($"Samplerate {audio.SampleRate} Hz ist für AWC nicht möglich (1–{MaxSampleRate} Hz).");

        var (samples, data, pcm) = Encode(audio, fc.Codec);

        fc.SamplesPerSecond = (ushort)audio.SampleRate;
        fc.Samples = (uint)samples;
        if (fc.LoopPoint >= samples) fc.LoopPoint = -1;
        if (fc.LoopBegin >= samples) fc.LoopBegin = 0;
        if (fc.LoopEnd >= samples) fc.LoopEnd = 0;
        if (fc.PlayEnd >= samples) fc.PlayEnd = 0;
        // Headroom bleibt wie beim Original (OpenIV übernimmt ihn aus der .oac) – die Lautstärke bestimmt deine WAV.

        if (stream.DataChunk == null)
            throw new AwcException($"Eintrag {stream.Name} hat keinen Daten-Chunk.");
        stream.DataChunk.Data = data;

        UpdatePeak(stream, pcm, samples);
    }

    private static void ReplaceMultiChannel(AwcFile awc, AwcStream stream, AudioBuffer audio)
    {
        var src = awc.MultiChannelSource ?? throw new AwcException("Multichannel-AWC ohne Quell-Stream.");
        var sf = stream.StreamFormat ?? throw new AwcException($"Eintrag {stream.Name} hat kein StreamFormat.");
        if (audio.SampleRate != sf.SamplesPerSecond)
            throw new AwcException($"Samplerate passt nicht: {audio.SampleRate} Hz statt {sf.SamplesPerSecond} Hz.");

        // Alle Kanäle als Rohdaten materialisieren, damit CompactMultiChannelSources sie neu verpacken kann.
        foreach (var s in awc.Streams)
        {
            if (s != src) s.GetRawData();
        }

        var (samples, data, _) = Encode(audio, sf.Codec);
        sf.Samples = (uint)samples;
        stream.DataChunk = new AwcDataChunk(null) { Data = data };
        src.CompactMultiChannelSources(awc.Streams);
    }

    /// <summary>
    /// Kodiert Mono-Audio im Zielcodec. Länge wird ausgerichtet: PCM auf gerade Sampleanzahl,
    /// ADPCM auf ein Vielfaches von 8 (RSXXTEA-Verschlüsselung erfordert 4-Byte-Ausrichtung).
    /// </summary>
    public static (int Samples, byte[] Data, byte[] Pcm16) Encode(AudioBuffer mono, AwcCodecType codec)
    {
        mono = AudioProcessor.PadToMultiple(mono, codec == AwcCodecType.ADPCM ? 8 : 2);
        var samples = mono.FrameCount;
        var pcm = mono.ToPcm16();
        var data = codec switch
        {
            AwcCodecType.PCM => pcm,
            AwcCodecType.ADPCM => ImaAdpcm.Encode(pcm, samples),
            _ => throw new AwcException($"Codec {codec} wird nicht unterstützt (nur PCM und ADPCM)."),
        };
        return (samples, data, pcm);
    }

    public static AwcCodecType ParseCodec(string codec) =>
        Enum.TryParse<AwcCodecType>(codec, true, out var c) ? c : throw new AwcException($"Unbekannter Codec '{codec}'.");

    /// <summary>Berechnet Format-Peak und Peak-Chunk wie CodeWalkers BuildPeakChunks, aber nur für diesen Stream.</summary>
    private static void UpdatePeak(AwcStream stream, byte[] pcm, int sampleCount)
    {
        var fc = stream.FormatChunk;
        if (fc?.Peak == null) return;
        const int peakSize = 4096;

        ushort GetSample(int i)
        {
            var o = i * 2;
            if (o + 2 >= pcm.Length) return 0;
            return (ushort)Math.Min(Math.Abs((int)BitConverter.ToInt16(pcm, o)) * 2, 65535);
        }

        ushort GetPeak(int n)
        {
            ushort p = 0;
            var o = n * peakSize;
            for (var i = 0; i < peakSize; i++) p = Math.Max(p, GetSample(i + o));
            return p;
        }

        fc.PeakVal = GetPeak(0);
        var peakCount = sampleCount > peakSize ? (sampleCount - peakSize) / peakSize : 0;
        var vals = new ushort[peakCount];
        for (var n = 0; n < peakCount; n++) vals[n] = GetPeak(n + 1);

        var chunks = stream.Chunks?.ToList() ?? new List<AwcChunk>();
        if (vals.Length > 0)
        {
            if (stream.PeakChunk == null)
            {
                var pc = (AwcPeakChunk)AwcStream.CreateChunk(new AwcChunkInfo { Type = AwcChunkType.peak });
                chunks.Add(pc);
                stream.PeakChunk = pc;
            }
            stream.PeakChunk.Data = vals;
        }
        else if (stream.PeakChunk != null)
        {
            chunks.Remove(stream.PeakChunk);
            stream.PeakChunk = null;
        }
        stream.Chunks = chunks.ToArray();
    }

    /// <summary>
    /// Serialisiert die AWC. Achtung: CodeWalker verschlüsselt Daten-Chunks beim Schreiben in-place,
    /// das AwcFile-Objekt darf danach nicht weiterverwendet werden – deshalb wird es hier verbraucht.
    /// </summary>
    public static byte[] SaveAndDispose(AwcFile awc)
    {
        try
        {
            return awc.Save();
        }
        catch (Exception ex)
        {
            throw new AwcException($"AWC '{awc.Name}' konnte nicht geschrieben werden: {ex.Message}", ex);
        }
        finally
        {
            awc.Streams = Array.Empty<AwcStream>();
        }
    }
}
