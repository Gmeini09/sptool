//! File I/O for paths the user chose through a native dialog.
//! Binary data crosses the IPC bridge as base64.

use base64::{engine::general_purpose::STANDARD, Engine};
use std::path::Path;

const MAX_READ: u64 = 256 * 1024 * 1024;

#[tauri::command]
pub fn read_file_b64(path: String) -> Result<String, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("Cannot read {path}: {e}"))?;
    if meta.len() > MAX_READ {
        return Err(format!("File is larger than {} MB", MAX_READ / 1024 / 1024));
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(bytes))
}

/// Writes atomically: temp file next to the target, then rename.
#[tauri::command]
pub fn write_file_b64(path: String, data: String) -> Result<(), String> {
    let bytes = STANDARD.decode(data).map_err(|e| e.to_string())?;
    let target = Path::new(&path);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = target.with_extension("sptool-tmp");
    std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}
