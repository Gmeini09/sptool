using System.Text.Json.Serialization;
using GtaSoundpack.Core.Audio;
using GtaSoundpack.Core.Mapping;

namespace GtaSoundpack.Core.Project;

public enum OutputEncryption
{
    /// <summary>Original-NG-Verschlüsselung beibehalten (für den Original-sfx-Ordner gedacht).</summary>
    Ng,
    /// <summary>OpenIV-"OPEN"-Format (für mods-Ordner mit OpenIV.asi/OpenRPF.asi bzw. FiveM).</summary>
    Open,
}

public sealed class SlotAssignment
{
    public string SlotId { get; set; } = "";
    /// <summary>Quelldatei (WAV/MP3/OGG/FLAC). Relativ zur Projektdatei oder absolut.</summary>
    public string SourceFile { get; set; } = "";
    public EditSettings Edit { get; set; } = new();
}

/// <summary>Projektdatei (JSON): Packname, Mapping, Zuordnungen Slot → eigene Sounddatei.</summary>
public sealed class SoundpackProject
{
    public int Version { get; set; } = 1;
    public string PackName { get; set; } = "MeinSoundpack";
    /// <summary>Pfad zur mapping.json (relativ zur Projektdatei oder absolut).</summary>
    public string MappingFile { get; set; } = "mapping.json";
    /// <summary>Optional: zuletzt verwendeter GTA-Ordner (nur Komfort, die CLI-Option --gta hat Vorrang).</summary>
    public string? GtaFolder { get; set; }
    public OutputEncryption Encryption { get; set; } = OutputEncryption.Ng;
    public List<SlotAssignment> Assignments { get; set; } = new();

    [JsonIgnore] public string? ProjectPath { get; set; }

    public string Resolve(string path)
    {
        if (Path.IsPathRooted(path) || ProjectPath == null) return path;
        return Path.GetFullPath(Path.Combine(Path.GetDirectoryName(Path.GetFullPath(ProjectPath))!, path));
    }

    public string MakeRelative(string path)
    {
        if (ProjectPath == null || !Path.IsPathRooted(path)) return path;
        var dir = Path.GetDirectoryName(Path.GetFullPath(ProjectPath))!;
        var rel = Path.GetRelativePath(dir, path);
        return rel.StartsWith("..\\..\\", StringComparison.Ordinal) ? path : rel;
    }

    public SlotAssignment? Find(string slotId) =>
        Assignments.FirstOrDefault(a => a.SlotId.Equals(slotId, StringComparison.OrdinalIgnoreCase));

    public SlotAssignment SetSource(string slotId, string file)
    {
        var a = Find(slotId);
        if (a == null)
        {
            a = new SlotAssignment { SlotId = slotId };
            Assignments.Add(a);
        }
        a.SourceFile = MakeRelative(file);
        return a;
    }

    /// <summary>Gültiger Ordnername für den Pack.</summary>
    public string SafePackName
    {
        get
        {
            var invalid = Path.GetInvalidFileNameChars();
            var s = new string((PackName ?? "").Select(c => invalid.Contains(c) ? '_' : c).ToArray()).Trim().TrimEnd('.');
            return string.IsNullOrEmpty(s) ? "Soundpack" : s;
        }
    }

    public SlotMapping LoadMapping() => SlotMapping.Load(Resolve(MappingFile));

    public static SoundpackProject Load(string path)
    {
        var p = Json.Load<SoundpackProject>(path);
        p.ProjectPath = Path.GetFullPath(path);
        return p;
    }

    public void Save(string path)
    {
        ProjectPath = Path.GetFullPath(path);
        Json.Save(path, this);
    }
}
