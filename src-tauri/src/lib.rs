//! SP Tool – native core.
//!
//! The frontend (React) owns UI, audio DSP and the sound library. The native side
//! only does what a WebView cannot: inspect the local machine (FiveM / GTA V),
//! read and write files the user picked, and persist logs.

mod detect;
mod device;
mod fsio;
mod logs;

use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    data_dir: String,
    log_dir: String,
    platform: String,
}

#[tauri::command]
fn app_info(app: tauri::AppHandle) -> Result<AppInfo, String> {
    let paths = app.path();
    let data_dir = paths.app_data_dir().map_err(|e| e.to_string())?;
    let log_dir = paths.app_log_dir().map_err(|e| e.to_string())?;
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        data_dir: data_dir.display().to_string(),
        log_dir: log_dir.display().to_string(),
        platform: std::env::consts::OS.to_string(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            app_info,
            device::machine_id,
            detect::detect_fivem,
            detect::detect_gta,
            detect::is_fivem_running,
            logs::write_log,
            logs::read_log,
            fsio::read_file_b64,
            fsio::write_file_b64,
            fsio::path_exists,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SP Tool");
}
