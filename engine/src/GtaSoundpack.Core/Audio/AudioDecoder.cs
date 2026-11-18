using System.Diagnostics;

namespace GtaSoundpack.Core.Audio;

/// <summary>
/// Lädt WAV (eingebaut), MP3 (NLayer), OGG Vorbis (NVorbis) und – falls ffmpeg gefunden wird – FLAC und alle weiteren Formate.
/// </summary>
public static class AudioDecoder
{
    public static readonly string[] SupportedExtensions = { ".wav", ".mp3", ".ogg", ".flac" };

    public static AudioBuffer Load(string path)
    {
        if (!File.Exists(path)) throw new FileNotFoundException("Audiodatei nicht gefunden.", path);
        var ext = Path.GetExtension(path).ToLowerInvariant();
        try
        {
            return ext switch
            {
                ".wav" => WavFile.Read(File.ReadAllBytes(path)),
                ".mp3" => DecodeMp3(path),
                ".ogg" => DecodeOgg(path),
                _ => DecodeWithFfmpeg(path),
            };
        }
        catch (Exception ex) when (ext is ".wav" or ".mp3" or ".ogg" && FfmpegLocator.Find() != null && ex is not FileNotFoundException)
        {
            // Fallback: exotische WAV-Varianten o. Ä. über ffmpeg dekodieren.
            return DecodeWithFfmpeg(path);
        }
    }

    private static AudioBuffer DecodeMp3(string path)
    {
        using var mpeg = new NLayer.MpegFile(path);
        return ReadInterleaved(mpeg.SampleRate, mpeg.Channels, (buf, off, cnt) => mpeg.ReadSamples(buf, off, cnt));
    }

    private static AudioBuffer DecodeOgg(string path)
    {
        using var vorbis = new NVorbis.VorbisReader(path);
        return ReadInterleaved(vorbis.SampleRate, vorbis.Channels, (buf, off, cnt) => vorbis.ReadSamples(buf, off, cnt));
    }

    private static AudioBuffer ReadInterleaved(int rate, int channels, Func<float[], int, int, int> read)
    {
        var all = new List<float>(rate * channels * 4);
        var buffer = new float[4096 * channels];
        int n;
        while ((n = read(buffer, 0, buffer.Length)) > 0)
        {
            for (var i = 0; i < n; i++) all.Add(buffer[i]);
        }
        var frames = all.Count / channels;
        var outCh = Enumerable.Range(0, channels).Select(_ => new float[frames]).ToArray();
        for (var f = 0; f < frames; f++)
            for (var c = 0; c < channels; c++)
                outCh[c][f] = all[f * channels + c];
        return new AudioBuffer(rate, outCh);
    }

    private static AudioBuffer DecodeWithFfmpeg(string path)
    {
        var ffmpeg = FfmpegLocator.Find()
            ?? throw new NotSupportedException(
                $"Das Format '{Path.GetExtension(path)}' benötigt ffmpeg. Bitte ffmpeg installieren (PATH) oder ffmpeg.exe in den Ordner 'tools' neben das Programm legen.");
        var psi = new ProcessStartInfo(ffmpeg)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var a in new[] { "-v", "error", "-i", path, "-f", "wav", "-acodec", "pcm_f32le", "-" }) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi) ?? throw new InvalidOperationException("ffmpeg konnte nicht gestartet werden.");
        using var ms = new MemoryStream();
        var errTask = p.StandardError.ReadToEndAsync();
        p.StandardOutput.BaseStream.CopyTo(ms);
        p.WaitForExit();
        if (p.ExitCode != 0) throw new InvalidDataException($"ffmpeg-Fehler: {errTask.Result.Trim()}");
        var bytes = ms.ToArray();
        // ffmpeg schreibt bei Pipe-Ausgabe ungültige Chunk-Größen (0xFFFFFFFF) – der Reader kappt diese.
        return WavFile.Read(bytes);
    }
}

public static class FfmpegLocator
{
    private static string? _cached;
    private static bool _searched;

    public static string? Find()
    {
        if (_searched) return _cached;
        _searched = true;
        var env = Environment.GetEnvironmentVariable("GTASOUNDPACK_FFMPEG");
        if (!string.IsNullOrEmpty(env) && File.Exists(env)) return _cached = env;
        var local = Path.Combine(AppContext.BaseDirectory, "tools", "ffmpeg.exe");
        if (File.Exists(local)) return _cached = local;
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                var candidate = Path.Combine(dir.Trim('"'), OperatingSystem.IsWindows() ? "ffmpeg.exe" : "ffmpeg");
                if (File.Exists(candidate)) return _cached = candidate;
            }
            catch (ArgumentException) { }
        }
        return null;
    }
}
