use std::fs;
use std::path::PathBuf;

#[tauri::command]
async fn get_settings() -> String {
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
    let load_dir = PathBuf::from(local_app_data).join("load");

    if !load_dir.exists() {
        if let Err(e) = fs::create_dir_all(&load_dir) {
            return format!("{{\"__error\": \"Failed to create directory: {}\"}}", e);
        }
    }

    let settings_path = load_dir.join("settings.json");

    if !settings_path.exists() {
        if let Err(e) = fs::write(&settings_path, "{}") {
            return format!("{{\"__error\": \"Failed to create file: {}\"}}", e);
        }
        return "{}".to_string();
    }

    match fs::read_to_string(&settings_path) {
        Ok(contents) => contents,
        Err(e) => format!("{{\"__error\": \"Failed to read file: {}\"}}", e),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_settings])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
