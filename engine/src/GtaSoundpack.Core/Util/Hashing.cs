using System.Security.Cryptography;
using GtaSoundpack.Core.Mapping;

namespace GtaSoundpack.Core.Util;

public static class Hashing
{
    public static string Sha256File(string path)
    {
        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 20);
        return Convert.ToHexString(SHA256.HashData(fs));
    }

    public static ArchiveFingerprint Fingerprint(string path) => new()
    {
        Size = new FileInfo(path).Length,
        Sha256 = Sha256File(path),
    };

    /// <summary>Jenkins-One-at-a-time-Hash (joaat) auf Kleinbuchstaben – wie von GTA verwendet.</summary>
    public static uint Joaat(string text) => CodeWalker.GameFiles.JenkHash.GenHash(text.ToLowerInvariant());
}
