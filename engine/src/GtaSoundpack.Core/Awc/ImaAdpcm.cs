namespace GtaSoundpack.Core.Awc;

/// <summary>
/// IMA-ADPCM-Encoder im Rockstar-AWC-Blockformat (2048-Byte-Blöcke: 4 Byte Header [StepIndex, Predictor] + 2044 Byte Nibbles = 4088 Samples).
/// Kompatibel zu CodeWalkers ADPCMCodec.DecodeADPCM. Anders als CodeWalkers Encoder wird der Ausgabepuffer
/// inkl. Block-Header korrekt dimensioniert, sodass am Ende keine Samples verloren gehen.
/// </summary>
public static class ImaAdpcm
{
    public const int BlockBytes = 2048;
    public const int BlockHeaderBytes = 4;
    public const int SamplesPerBlock = (BlockBytes - BlockHeaderBytes) * 2; // 4088

    private static readonly int[] IndexTable = { -1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8 };

    private static readonly short[] StepTable =
    {
        7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
        50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
        337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
        2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
        15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
    };

    public static int EncodedLength(int sampleCount)
    {
        if (sampleCount <= 0) return 0;
        var fullBlocks = sampleCount / SamplesPerBlock;
        var rem = sampleCount % SamplesPerBlock;
        var len = fullBlocks * BlockBytes + (rem > 0 ? BlockHeaderBytes + (rem + 1) / 2 : 0);
        return (len + 3) & ~3; // Vielfaches von 4 (für RSXXTEA-Verschlüsselung)
    }

    /// <param name="pcm16">16-Bit-PCM mono, little endian.</param>
    public static byte[] Encode(byte[] pcm16, int sampleCount)
    {
        sampleCount = Math.Min(sampleCount, pcm16.Length / 2);
        var output = new byte[EncodedLength(sampleCount)];
        int predictor = 0, stepIndex = 0, w = 0;

        short Sample(int i) => i < sampleCount ? BitConverter.ToInt16(pcm16, i * 2) : (short)0;

        byte EncodeNibble(int pcm)
        {
            var delta = pcm - predictor;
            var value = 0;
            if (delta < 0) { value = 8; delta = -delta; }
            int step = StepTable[stepIndex];
            var diff = step >> 3;
            if (delta >= step) { value |= 4; delta -= step; diff += step; }
            step >>= 1;
            if (delta >= step) { value |= 2; delta -= step; diff += step; }
            step >>= 1;
            if (delta >= step) { value |= 1; diff += step; }
            predictor += (value & 8) != 0 ? -diff : diff;
            predictor = Math.Clamp(predictor, short.MinValue, short.MaxValue);
            stepIndex = Math.Clamp(stepIndex + IndexTable[value], 0, 88);
            return (byte)value;
        }

        var s = 0;
        while (s < sampleCount)
        {
            output[w] = (byte)stepIndex;
            output[w + 1] = 0;
            output[w + 2] = (byte)(predictor & 0xFF);
            output[w + 3] = (byte)((predictor >> 8) & 0xFF);
            w += BlockHeaderBytes;
            var inBlock = Math.Min(SamplesPerBlock, sampleCount - s);
            for (var i = 0; i < inBlock; i += 2)
            {
                var lo = EncodeNibble(Sample(s + i));
                var hi = EncodeNibble(Sample(s + i + 1));
                output[w++] = (byte)(lo | (hi << 4));
            }
            s += inBlock;
        }
        return output;
    }
}
