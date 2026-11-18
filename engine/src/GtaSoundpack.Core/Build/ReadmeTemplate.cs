using System.Text;
using GtaSoundpack.Core.Project;

namespace GtaSoundpack.Core.Build;

public static class ReadmeTemplate
{
    public static string ForPack(SoundpackProject project, PackManifest manifest, IEnumerable<string> archives)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"{project.PackName} – GTA V Weapon-Soundpack");
        sb.AppendLine(new string('=', project.PackName.Length + 28));
        sb.AppendLine($"Erstellt: {manifest.BuiltUtc:yyyy-MM-dd HH:mm} UTC  |  Spielversion: {manifest.GameVersion}  |  Verschlüsselung: {manifest.Encryption}");
        sb.AppendLine();
        sb.AppendLine("Enthaltene Dateien (Pfade relativ zum GTA-V-Ordner):");
        foreach (var a in archives) sb.AppendLine("  " + a);
        sb.AppendLine();
        sb.AppendLine("Ersetzte Sounds:");
        foreach (var s in manifest.Slots) sb.AppendLine("  " + s);
        sb.AppendLine();
        sb.AppendLine("WICHTIG: BACKUP");
        sb.AppendLine("  Sichere die Originaldateien, bevor du etwas ersetzt (das Tool hat dafür die Funktion \"Backup\").");
        sb.AppendLine("  GTA Online: Modifizierte Spieldateien im Online-Modus können zu einem Bann führen. Nur im Story-Modus nutzen.");
        sb.AppendLine();
        sb.AppendLine("INSTALLATION – Variante A: OpenIV-mods-Ordner (empfohlen)");
        sb.AppendLine("  1. OpenIV.asi und OpenRPF.asi (ASI-Loader) müssen installiert sein.");
        sb.AppendLine("  2. Die Ordnerstruktur aus diesem Pack in \"Grand Theft Auto V\\mods\\\" kopieren,");
        sb.AppendLine("     z. B. x64\\audio\\sfx\\RESIDENT.rpf → Grand Theft Auto V\\mods\\x64\\audio\\sfx\\RESIDENT.rpf");
        sb.AppendLine("  3. Deinstallation: die Dateien im mods-Ordner löschen.");
        sb.AppendLine();
        sb.AppendLine("INSTALLATION – Variante B: direkt in den Spielordner");
        sb.AppendLine("  1. Originale sichern!");
        sb.AppendLine("  2. Die Dateien an dieselbe Stelle unter \"Grand Theft Auto V\\\" kopieren (überschreiben).");
        if (manifest.Encryption == OutputEncryption.Open)
            sb.AppendLine("  Hinweis: Dieser Pack ist im OPEN-Format gebaut. Ohne OpenRPF.asi lädt das Spiel ihn NICHT – nutze Variante A.");
        else
            sb.AppendLine("  Hinweis: Der Pack ist NG-verschlüsselt wie das Original. Ob das unmodifizierte Spiel geänderte Archive akzeptiert, hängt von der Spielversion ab – im Zweifel Variante A.");
        sb.AppendLine("  3. Deinstallation: Backup zurückkopieren oder im Launcher (Steam/Rockstar/Epic) \"Dateien überprüfen\".");
        sb.AppendLine();
        sb.AppendLine("FIVEM");
        sb.AppendLine("  Die Dateien in den FiveM-Ordner \"FiveM Application Data\\mods\\\" kopieren (gleiche Unterstruktur wie unter Variante A)");
        sb.AppendLine("  oder – wie gewünscht – in den GTA-Ordner. Viele Server erlauben keine clientseitigen Mods (\"Pure Mode\").");
        sb.AppendLine("  Für Server-Ressourcen eignen sich gestreamte AWC/DAT-Dateien besser als ganze RPFs.");
        sb.AppendLine();
        sb.AppendLine("Nach einem Spielupdate kann Rockstar die Originalarchive ändern. Dann den Pack mit dem Tool neu bauen.");
        return sb.ToString();
    }
}
