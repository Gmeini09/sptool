using System.Text;

namespace GtaSoundpack.Core.Audio;

/// <summary>Minimaler, abhängigkeitsfreier WAV-Reader/Writer (PCM 8/16/24/32 Bit, IEEE float 32/64, WAVE_FORMAT_EXTENSIBLE).</summary>
public static class WavFile
{
    public static AudioBuffer Read(byte[] data)
    {
        using var ms = new MemoryStream(data);
        using var r = new BinaryReader(ms);
        if (Encoding.ASCII.GetString(r.ReadBytes(4)) != "RIFF") throw new InvalidDataException("Keine RIFF-Datei.");
        r.ReadInt32();
        if (Encoding.ASCII.GetString(r.ReadBytes(4)) != "WAVE") throw new InvalidDataException("Keine WAVE-Datei.");

        int format = 0, channels = 0, rate = 0, bits = 0;
        byte[]? pcm = null;
        while (ms.Position + 8 <= ms.Length)
        {
            var id = Encoding.ASCII.GetString(r.ReadBytes(4));
            var size = r.ReadInt32();
            if (size < 0 || ms.Position + size > ms.Length) size = (int)(ms.Length - ms.Position);
            var start = ms.Position;
            if (id == "fmt ")
            {
                format = r.ReadUInt16();
                channels = r.ReadUInt16();
                rate = r.ReadInt32();
                r.ReadInt32();
                r.ReadUInt16();
                bits = r.ReadUInt16();
                if (format == 0xFFFE && size >= 40)
                {
                    r.ReadUInt16(); // cbSize
                    r.ReadUInt16(); // valid bits
                    r.ReadUInt32(); // channel mask
                    format = r.ReadUInt16(); // sub format GUID, erste 2 Bytes
                }
            }
            else if (id == "data")
            {
                pcm = r.ReadBytes(size);
            }
            ms.Position = start + size + (size & 1);
        }

        if (pcm == null || channels == 0 || rate == 0) throw new InvalidDataException("WAV ohne fmt- oder data-Chunk.");
        var bytesPerSample = bits / 8;
        if (bytesPerSample == 0) throw new InvalidDataException($"Nicht unterstützte Bittiefe {bits}.");
        var frames = pcm.Length / (bytesPerSample * channels);
        var outCh = Enumerable.Range(0, channels).Select(_ => new float[frames]).ToArray();
        for (var f = 0; f < frames; f++)
        {
            for (var c = 0; c < channels; c++)
            {
                var o = (f * channels + c) * bytesPerSample;
                outCh[c][f] = (format, bits) switch
                {
                    (1, 8) => (pcm[o] - 128) / 128f,
                    (1, 16) => BitConverter.ToInt16(pcm, o) / 32768f,
                    (1, 24) => ((pcm[o] | (pcm[o + 1] << 8) | ((sbyte)pcm[o + 2] << 16))) / 8388608f,
                    (1, 32) => BitConverter.ToInt32(pcm, o) / 2147483648f,
                    (3, 32) => BitConverter.ToSingle(pcm, o),
                    (3, 64) => (float)BitConverter.ToDouble(pcm, o),
                    _ => throw new InvalidDataException($"Nicht unterstütztes WAV-Format {format}/{bits} Bit."),
                };
            }
        }
        return new AudioBuffer(rate, outCh);
    }

    /// <summary>Schreibt 16-Bit-PCM-WAV (interleaved).</summary>
    public static byte[] Write16(AudioBuffer b)
    {
        var ch = b.ChannelCount;
        var frames = b.FrameCount;
        var dataLen = frames * ch * 2;
        using var ms = new MemoryStream(44 + dataLen);
        using var w = new BinaryWriter(ms);
        w.Write(Encoding.ASCII.GetBytes("RIFF"));
        w.Write(36 + dataLen);
        w.Write(Encoding.ASCII.GetBytes("WAVE"));
        w.Write(Encoding.ASCII.GetBytes("fmt "));
        w.Write(16);
        w.Write((short)1);
        w.Write((short)ch);
        w.Write(b.SampleRate);
        w.Write(b.SampleRate * ch * 2);
        w.Write((short)(ch * 2));
        w.Write((short)16);
        w.Write(Encoding.ASCII.GetBytes("data"));
        w.Write(dataLen);
        for (var f = 0; f < frames; f++)
        {
            for (var c = 0; c < ch; c++)
            {
                var v = (int)Math.Round(b.Channels[c][f] * 32767.0);
                w.Write((short)Math.Clamp(v, short.MinValue, short.MaxValue));
            }
        }
        w.Flush();
        return ms.ToArray();
    }
}
