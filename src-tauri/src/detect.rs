//! Real detection of FiveM and GTA V installations on Windows.
//! Nothing here is simulated: every result comes from the file system, the
//! registry or the process list. On non-Windows platforms the commands report
//! "not detected" rather than inventing data.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FiveMStatus {
    detected: bool,
    /// Folder containing FiveM.exe (usually %LOCALAPPDATA%\FiveM)
    root: Option<String>,
    /// FiveM.app data folder
    app_dir: Option<String>,
    /// GTA V path FiveM was configured with (CitizenFX.ini → IVPath), if present
    configured_gta_path: Option<String>,
    running: bool,
    checked: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GtaInstall {
    source: String,
    path: String,
    /// true when GTA5.exe exists in `path`
    valid: bool,
    edition: String,
}

fn local_appdata() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
}

fn fivem_candidates() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(l) = local_appdata() {
        v.push(l.join("FiveM"));
    }
    // Common alternative locations seen when users move the install manually.
    for drive in ["C", "D", "E", "F"] {
        v.push(PathBuf::from(format!("{drive}:\\FiveM")));
        v.push(PathBuf::from(format!("{drive}:\\Games\\FiveM")));
    }
    v
}

/// Reads `IVPath=` from CitizenFX.ini, which FiveM writes next to FiveM.exe.
fn read_ivpath(root: &Path) -> Option<String> {
    let ini = std::fs::read_to_string(root.join("CitizenFX.ini")).ok()?;
    ini.lines().find_map(|l| {
        let l = l.trim();
        l.strip_prefix("IVPath=").map(|p| p.trim().to_string())
    })
}

#[tauri::command]
pub fn detect_fivem(custom_root: Option<String>) -> FiveMStatus {
    let mut status = FiveMStatus::default();
    let mut candidates = Vec::new();
    if let Some(c) = custom_root.filter(|c| !c.is_empty()) {
        candidates.push(PathBuf::from(c));
    }
    candidates.extend(fivem_candidates());

    for root in candidates {
        status.checked.push(root.display().to_string());
        let app_dir = root.join("FiveM.app");
        if app_dir.is_dir() {
            status.detected = true;
            status.root = Some(root.display().to_string());
            status.app_dir = Some(app_dir.display().to_string());
            status.configured_gta_path = read_ivpath(&root);
            break;
        }
    }
    status.running = is_fivem_running();
    status
}

/// Uses the Windows process list. FiveM runs as FiveM.exe plus FiveM_*GTAProcess.exe.
#[tauri::command]
pub fn is_fivem_running() -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let out = std::process::Command::new("tasklist")
            .args(["/FO", "CSV", "/NH"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        if let Ok(out) = out {
            let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
            return text.lines().any(|l| l.starts_with("\"fivem"));
        }
        false
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn make_install(source: &str, path: PathBuf) -> GtaInstall {
    let legacy = path.join("GTA5.exe").is_file();
    let enhanced = path.join("GTA5_Enhanced.exe").is_file();
    GtaInstall {
        source: source.to_string(),
        valid: legacy || enhanced,
        edition: if legacy {
            "Legacy".into()
        } else if enhanced {
            "Enhanced".into()
        } else {
            "Unknown".into()
        },
        path: path.display().to_string(),
    }
}

/// Parses `"path"  "D:\\SteamLibrary"` entries from libraryfolders.vdf.
fn steam_library_paths(steam_root: &Path) -> Vec<PathBuf> {
    let mut libs = vec![steam_root.to_path_buf()];
    let vdf = steam_root.join("steamapps").join("libraryfolders.vdf");
    if let Ok(text) = std::fs::read_to_string(vdf) {
        for line in text.lines() {
            let t = line.trim();
            if let Some(rest) = t.strip_prefix("\"path\"") {
                let p = rest.trim().trim_matches('"').replace("\\\\", "\\");
                if !p.is_empty() {
                    libs.push(PathBuf::from(p));
                }
            }
        }
    }
    libs
}

#[cfg(windows)]
fn reg_string(root: winreg::HKEY, key: &str, value: &str) -> Option<String> {
    let k = winreg::RegKey::predef(root).open_subkey(key).ok()?;
    k.get_value::<String, _>(value).ok()
}

#[tauri::command]
pub fn detect_gta(custom_path: Option<String>) -> Vec<GtaInstall> {
    let mut found: Vec<GtaInstall> = Vec::new();
    let mut push = |source: &str, p: PathBuf| {
        let key = p.display().to_string().to_lowercase();
        if !found.iter().any(|f| f.path.to_lowercase() == key) {
            found.push(make_install(source, p));
        }
    };

    if let Some(c) = custom_path.filter(|c| !c.is_empty()) {
        push("Custom", PathBuf::from(c));
    }

    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        // Rockstar Games Launcher
        if let Some(p) = reg_string(
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\WOW6432Node\Rockstar Games\Grand Theft Auto V",
            "InstallFolder",
        ) {
            push("Rockstar", PathBuf::from(p));
        }
        // Steam
        if let Some(steam) = reg_string(HKEY_CURRENT_USER, r"Software\Valve\Steam", "SteamPath") {
            for lib in steam_library_paths(Path::new(&steam.replace('/', "\\"))) {
                for name in ["Grand Theft Auto V", "Grand Theft Auto V Legacy", "Grand Theft Auto V Enhanced"] {
                    let p = lib.join("steamapps").join("common").join(name);
                    if p.is_dir() {
                        push("Steam", p);
                    }
                }
            }
        }
    }

    // Epic Games: launcher manifests are JSON files with DisplayName + InstallLocation.
    let epic = PathBuf::from(r"C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests");
    if let Ok(entries) = std::fs::read_dir(&epic) {
        for e in entries.flatten() {
            if e.path().extension().and_then(|x| x.to_str()) != Some("item") {
                continue;
            }
            if let Ok(text) = std::fs::read_to_string(e.path()) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                    let name = v["DisplayName"].as_str().unwrap_or_default();
                    if name.contains("Grand Theft Auto V") {
                        if let Some(loc) = v["InstallLocation"].as_str() {
                            push("Epic Games", PathBuf::from(loc));
                        }
                    }
                }
            }
        }
    }

    // The path FiveM itself was set up with.
    if let Some(root) = local_appdata().map(|l| l.join("FiveM")) {
        if let Some(p) = read_ivpath(&root) {
            push("FiveM config", PathBuf::from(p));
        }
    }

    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_steam_vdf() {
        let dir = std::env::temp_dir().join("sptool_vdf_test");
        let _ = std::fs::create_dir_all(dir.join("steamapps"));
        std::fs::write(
            dir.join("steamapps").join("libraryfolders.vdf"),
            "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"D:\\\\SteamLibrary\"\n\t}\n}\n",
        )
        .unwrap();
        let libs = steam_library_paths(&dir);
        assert_eq!(libs.len(), 2);
        assert_eq!(libs[1], PathBuf::from("D:\\SteamLibrary"));
    }

    #[test]
    fn reads_ivpath() {
        let dir = std::env::temp_dir().join("sptool_ini_test");
        let _ = std::fs::create_dir_all(&dir);
        std::fs::write(dir.join("CitizenFX.ini"), "[Game]\nIVPath=E:\\GTAV\n").unwrap();
        assert_eq!(read_ivpath(&dir).as_deref(), Some("E:\\GTAV"));
    }
}
