//! Device identity for license binding (HWID).
//!
//! Returns a stable, OS-provided machine identifier. The frontend never sends it
//! as-is: it hashes it (SHA-256, app-specific salt) and the server hashes it again
//! with a server secret, so the raw ID never leaves this computer.
//!
//! Sources:
//!  • Windows: HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid (set at OS install)
//!  • Linux:   /etc/machine-id or /var/lib/dbus/machine-id
//!  • macOS:   IOPlatformUUID (ioreg)
//!  • other / fallback: a random ID created once in the app data folder
use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineId {
    id: String,
    source: String,
    host_name: String,
}

#[cfg(windows)]
fn os_machine_id() -> Option<(String, &'static str)> {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_64KEY};
    let key = winreg::RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags("SOFTWARE\\Microsoft\\Cryptography", KEY_READ | KEY_WOW64_64KEY)
        .ok()?;
    let v: String = key.get_value("MachineGuid").ok()?;
    let v = v.trim().to_lowercase();
    (!v.is_empty()).then_some((v, "windows-machine-guid"))
}

#[cfg(all(target_os = "linux", not(target_os = "android")))]
fn os_machine_id() -> Option<(String, &'static str)> {
    for p in ["/etc/machine-id", "/var/lib/dbus/machine-id"] {
        if let Ok(s) = std::fs::read_to_string(p) {
            let s = s.trim().to_lowercase();
            if s.len() >= 16 {
                return Some((s, "linux-machine-id"));
            }
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn os_machine_id() -> Option<(String, &'static str)> {
    let out = std::process::Command::new("ioreg").args(["-rd1", "-c", "IOPlatformExpertDevice"]).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text.lines().find(|l| l.contains("IOPlatformUUID"))?;
    let uuid = line.split('"').nth(3)?.trim().to_lowercase();
    (!uuid.is_empty()).then_some((uuid, "macos-platform-uuid"))
}

#[cfg(not(any(windows, target_os = "macos", all(target_os = "linux", not(target_os = "android")))))]
fn os_machine_id() -> Option<(String, &'static str)> {
    None
}

fn fallback_id(app: &tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join("device.id");
    if let Ok(s) = std::fs::read_to_string(&file) {
        let s = s.trim().to_string();
        if s.len() >= 32 {
            return Ok(s);
        }
    }
    // Only reached on platforms without an OS machine id (e.g. mobile).
    // Prefer the system RNG; otherwise mix time, pid and a stack address.
    let mut bytes = [0u8; 16];
    let filled = std::fs::File::open("/dev/urandom")
        .and_then(|mut f| std::io::Read::read_exact(&mut f, &mut bytes))
        .is_ok();
    if !filled {
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let mix = t ^ ((std::process::id() as u128) << 64) ^ (&bytes as *const _ as usize as u128);
        bytes = mix.to_le_bytes();
    }
    let id: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    std::fs::write(&file, &id).map_err(|e| e.to_string())?;
    Ok(id)
}

fn host_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .or_else(|| std::fs::read_to_string("/etc/hostname").ok().map(|s| s.trim().to_string()))
        .unwrap_or_else(|| "PC".into())
}

#[tauri::command]
pub fn machine_id(app: tauri::AppHandle) -> Result<MachineId, String> {
    let (id, source) = match os_machine_id() {
        Some((id, src)) => (id, src.to_string()),
        None => (fallback_id(&app)?, "app-generated".to_string()),
    };
    Ok(MachineId { id, source, host_name: host_name() })
}
