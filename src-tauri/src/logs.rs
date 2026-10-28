//! Persistent log file in the app log directory (rotated at 5 MB).

use std::io::Write;
use tauri::Manager;

const MAX_BYTES: u64 = 5 * 1024 * 1024;

fn log_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("sptool.log"))
}

#[tauri::command]
pub fn write_log(app: tauri::AppHandle, lines: Vec<String>) -> Result<(), String> {
    let path = log_path(&app)?;
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > MAX_BYTES {
            let _ = std::fs::rename(&path, path.with_extension("log.1"));
        }
    }
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    for l in lines {
        // Never allow multi-line injection into the log file.
        let clean = l.replace(['\r', '\n'], " ");
        writeln!(f, "{clean}").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn read_log(app: tauri::AppHandle) -> Result<String, String> {
    let path = log_path(&app)?;
    Ok(std::fs::read_to_string(path).unwrap_or_default())
}
