using System.Text.Json;
using System.Text.Json.Serialization;

namespace GtaSoundpack.Core.Mapping;

public enum SlotKind { Reload, Fire, SuppressedFire }

public enum ChannelRole { Mono, Left, Right }

/// <summary>Eintrag in weapons.json – die Zielwaffen sind darüber erweiterbar.</summary>
public sealed class WeaponDefinition
{
    /// <summary>Waffenname wie in weapons.meta, z. B. WEAPON_PISTOL.</summary>
    public string Name { get; set; } = "";
    public string DisplayName { get; set; } = "";
    /// <summary>Optional: Audio-Item (z. B. AUDIO_ITEM_PISTOL). Leer = automatisch aus weapons*.meta ermitteln.</summary>
    public string? AudioItem { get; set; }
    /// <summary>Welche Slot-Arten das Tool für diese Waffe auflösen soll.</summary>
    public List<SlotKind> Kinds { get; set; } = new() { SlotKind.Reload };
}

public sealed class WeaponsConfig
{
    public List<WeaponDefinition> Weapons { get; set; } = new();

    public static WeaponsConfig Default() => new()
    {
        Weapons =
        {
            new WeaponDefinition { Name = "WEAPON_PISTOL", DisplayName = "Pistol" },
            new WeaponDefinition { Name = "WEAPON_PISTOL_MK2", DisplayName = "Pistol Mk II" },
            new WeaponDefinition { Name = "WEAPON_PISTOL50", DisplayName = "Pistol .50" },
        },
    };

    public static WeaponsConfig Load(string path) => Json.Load<WeaponsConfig>(path);
    public void Save(string path) => Json.Save(path, this);

    /// <summary>Lädt weapons.json neben der Anwendung bzw. legt die Standardliste an.</summary>
    public static WeaponsConfig LoadOrDefault(string? path)
    {
        path ??= Path.Combine(AppContext.BaseDirectory, "weapons.json");
        return File.Exists(path) ? Load(path) : Default();
    }
}

/// <summary>Verweis auf genau einen Wave-Eintrag in einer AWC.</summary>
public sealed class AwcEntryRef
{
    /// <summary>Virtueller Pfad der AWC relativ zum GTA-Ordner, z. B. "x64\audio\sfx\RESIDENT.rpf\weapons.awc".</summary>
    public string AwcPath { get; set; } = "";
    public uint StreamHash { get; set; }
    public string StreamName { get; set; } = "";
    public ChannelRole Role { get; set; }

    // Originalformat (zur Anzeige und zur Prüfung vor dem Build)
    public string Codec { get; set; } = "";
    public int SampleRate { get; set; }
    public int Samples { get; set; }
    public int Channels { get; set; } = 1;

    [JsonIgnore] public double DurationSeconds => SampleRate > 0 ? (double)Samples / SampleRate : 0;
    [JsonIgnore] public string StreamHashHex => "0x" + StreamHash.ToString("X8");
    [JsonIgnore] public string TopLevelRpf => Gta.RpfAccess.Split(AwcPath).TopLevelRpf;
}

/// <summary>Ein ersetzbarer Sound (z. B. "Mag out"). Kann aus mehreren Einträgen bestehen (Stereo-Paar, Varianten).</summary>
public sealed class SoundSlot
{
    public string Weapon { get; set; } = "";
    public SlotKind Kind { get; set; }
    /// <summary>Anzeigename, z. B. "MAG_OUT" oder "Variante 2".</summary>
    public string Name { get; set; } = "";
    /// <summary>Eindeutige ID: WEAPON/Kind/Name.</summary>
    public string Id { get; set; } = "";
    /// <summary>"auto" = aus den Audio-Metadaten ermittelt, "manual" = im Explorer zugewiesen.</summary>
    public string Source { get; set; } = "auto";
    /// <summary>Pfad im Sound-Baum (Hashes/Namen), zur Nachvollziehbarkeit.</summary>
    public string SoundPath { get; set; } = "";
    public List<AwcEntryRef> Entries { get; set; } = new();

    public static string MakeId(string weapon, SlotKind kind, string name) => $"{weapon}/{kind}/{name}";
}

public sealed class ArchiveFingerprint
{
    public long Size { get; set; }
    public string Sha256 { get; set; } = "";
}

/// <summary>Inhalt von mapping.json: Ergebnis der Analyse plus manuelle Zuordnungen.</summary>
public sealed class SlotMapping
{
    public int Version { get; set; } = 1;
    public string GameVersion { get; set; } = "";
    public string GameExe { get; set; } = "";
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
    /// <summary>SHA-256 der betroffenen Original-Top-Level-RPFs (Schlüssel = relativer Pfad).</summary>
    public Dictionary<string, ArchiveFingerprint> Archives
    {
        get => _archives;
        set => _archives = Json.IgnoreCase(value);
    }
    private Dictionary<string, ArchiveFingerprint> _archives = new(StringComparer.OrdinalIgnoreCase);
    public List<SoundSlot> Slots { get; set; } = new();
    /// <summary>Hinweise aus der Analyse (z. B. nicht auflösbare Waffen).</summary>
    public List<string> Notes { get; set; } = new();

    public SoundSlot? FindSlot(string id) => Slots.FirstOrDefault(s => s.Id.Equals(id, StringComparison.OrdinalIgnoreCase));

    public IEnumerable<string> TopLevelArchives() =>
        Slots.SelectMany(s => s.Entries).Select(e => e.TopLevelRpf).Distinct(StringComparer.OrdinalIgnoreCase);

    /// <summary>Manuelle Zuordnung aus dem AWC-Explorer: ersetzt die Einträge eines Slots (oder legt ihn an).</summary>
    public SoundSlot Assign(string weapon, SlotKind kind, string slotName, AwcEntryRef entry, bool append = false)
    {
        var id = SoundSlot.MakeId(weapon, kind, slotName);
        var slot = FindSlot(id);
        if (slot == null)
        {
            slot = new SoundSlot { Weapon = weapon, Kind = kind, Name = slotName, Id = id };
            Slots.Add(slot);
        }
        slot.Source = "manual";
        if (!append) slot.Entries.Clear();
        slot.Entries.RemoveAll(e => e.AwcPath.Equals(entry.AwcPath, StringComparison.OrdinalIgnoreCase) && e.StreamHash == entry.StreamHash);
        slot.Entries.Add(entry);
        return slot;
    }

    /// <summary>Übernimmt manuelle Slots aus einem älteren Mapping (bei erneuter Analyse).</summary>
    public void MergeManual(SlotMapping? previous)
    {
        if (previous == null) return;
        foreach (var s in previous.Slots.Where(s => s.Source == "manual"))
        {
            Slots.RemoveAll(x => x.Id.Equals(s.Id, StringComparison.OrdinalIgnoreCase));
            Slots.Add(s);
        }
        foreach (var a in previous.Archives)
        {
            Archives.TryAdd(a.Key, a.Value);
        }
    }

    public static SlotMapping Load(string path) => Json.Load<SlotMapping>(path);
    public void Save(string path) => Json.Save(path, this);
}

public static class Json
{
    public static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter() },
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    /// <summary>System.Text.Json erzeugt Dictionaries ohne Comparer – Pfadschlüssel sollen aber ohne Groß/Klein verglichen werden.</summary>
    public static Dictionary<string, TValue> IgnoreCase<TValue>(Dictionary<string, TValue>? d)
    {
        var r = new Dictionary<string, TValue>(StringComparer.OrdinalIgnoreCase);
        if (d != null)
            foreach (var kv in d) r[kv.Key] = kv.Value;
        return r;
    }

    public static T Load<T>(string path)
    {
        try
        {
            return JsonSerializer.Deserialize<T>(File.ReadAllText(path), Options)
                   ?? throw new InvalidDataException($"'{path}' ist leer.");
        }
        catch (JsonException ex)
        {
            throw new InvalidDataException($"'{path}' ist kein gültiges JSON: {ex.Message}", ex);
        }
    }

    public static void Save<T>(string path, T value)
    {
        var dir = Path.GetDirectoryName(Path.GetFullPath(path));
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        File.WriteAllText(path, JsonSerializer.Serialize(value, Options));
    }
}
