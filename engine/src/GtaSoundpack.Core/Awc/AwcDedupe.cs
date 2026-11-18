using System.Security.Cryptography;

namespace GtaSoundpack.Core.Awc;

/// <summary>
/// Legt byte-gleiche Audiodaten (data-Chunks) einer unverschlüsselten, einkanaligen AWC nur einmal ab: jeder Eintrag zeigt
/// über seine Chunk-Tabelle auf eine Stelle der Datei, mehrere Einträge dürfen dieselbe Stelle benutzen.
/// Wichtig für RESIDENT.rpf\weapons.awc: der ganze Reload steckt dort in bis zu 14 Varianten-Einträgen, die Datei darf aber
/// nicht größer als das Original werden (sonst lädt GTA die Bank nicht und alle Waffen sind stumm).
/// Aufbau (verifiziert, docs/REFERENCE_ANALYSIS.md): Header → Chunk-Tabelle → Format/Peak/Marker-Chunks → Daten-Chunks.
/// </summary>
public static class AwcDedupe
{
    private const byte DataChunk = 0x55;

    /// <summary>Gibt die kompaktierte AWC zurück – oder die Eingabe unverändert, wenn es nichts zu teilen gibt bzw. der Aufbau unerwartet ist.</summary>
    public static byte[] ShareIdenticalData(byte[] awc)
    {
        if (awc.Length < 16 || BitConverter.ToUInt32(awc, 0) != 0x54414441) return awc; // nur offenes "ADAT" (Little Endian)
        var flags = BitConverter.ToUInt16(awc, 6);
        if ((flags & 0x4) != 0) return awc; // Mehrkanal: Daten liegen verschränkt in Blöcken – nicht anfassen
        var n = BitConverter.ToInt32(awc, 8);
        if (n <= 0) return awc;

        var p = 16 + ((flags & 1) != 0 ? n * 2 : 0);
        var chunkCounts = new int[n];
        for (var i = 0; i < n; i++) chunkCounts[i] = (int)(BitConverter.ToUInt32(awc, p + i * 4) >> 29);
        var infoStart = p + n * 4;
        var total = chunkCounts.Sum();
        if (infoStart + total * 8 > awc.Length) return awc;

        var chunks = new List<(int InfoPos, long Off, long Size, byte Type)>(total);
        for (var c = 0; c < total; c++)
        {
            var pos = infoStart + c * 8;
            var v = BitConverter.ToUInt64(awc, pos);
            chunks.Add((pos, (long)(v & 0xFFFFFFF), (long)((v >> 28) & 0xFFFFFFF), (byte)(v >> 56)));
        }
        var data = chunks.Where(c => c.Type == DataChunk).ToList();
        if (data.Count < 2) return awc;
        var firstData = data.Min(c => c.Off);
        // Erwarteter Aufbau: alle anderen Chunks liegen vor den Daten, nichts ragt über das Dateiende
        if (chunks.Any(c => c.Type != DataChunk && c.Off + c.Size > firstData) || chunks.Any(c => c.Off + c.Size > awc.Length)) return awc;

        // Daten-Chunks nach Inhalt gruppieren, jedes eindeutige Stück einmal (in der bisherigen Reihenfolge) neu ablegen
        var unique = new Dictionary<string, long>();
        var output = new MemoryStream();
        output.Write(awc, 0, (int)firstData);
        var newOffsets = new Dictionary<int, long>();
        foreach (var c in data.OrderBy(c => c.Off))
        {
            var key = Convert.ToHexString(SHA256.HashData(awc.AsSpan((int)c.Off, (int)c.Size))) + ":" + c.Size;
            if (!unique.TryGetValue(key, out var off))
            {
                while (output.Length % 16 != 0) output.WriteByte(0);
                off = output.Length;
                output.Write(awc, (int)c.Off, (int)c.Size);
                unique[key] = off;
            }
            newOffsets[c.InfoPos] = off;
        }
        while (output.Length % 16 != 0) output.WriteByte(0);
        if (output.Length >= awc.Length || unique.Count == data.Count) return awc;

        var result = output.ToArray();
        foreach (var (pos, off) in newOffsets)
        {
            var v = BitConverter.ToUInt64(result, pos);
            v = (v & ~0xFFFFFFFUL) | ((ulong)off & 0xFFFFFFF);
            BitConverter.TryWriteBytes(result.AsSpan(pos, 8), v);
        }
        return result;
    }
}
