use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

mod pools;
mod task;

use serde::Serialize;

use tauri::{AppHandle, Emitter, State};

static READY_ALREADY_CALLED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Offset {
    col: usize,
    row: usize,
}

#[derive(Clone, Serialize)]
struct Token {
    #[serde(rename = "startOffset")]
    start_offset: Offset,
    #[serde(rename = "endOffset")]
    end_offset: Offset,
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileMetadata {
    name: String,
    path: String,
    size: usize,
    language: String,
    line_count: usize,
}

struct FileState {
    path: PathBuf,
    name: String,
    size: usize,
    language: String,
    lines: Vec<String>,
}

#[derive(Default)]
struct EditorState(Mutex<Option<FileState>>);

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

#[tauri::command]
async fn ready() {
    if READY_ALREADY_CALLED.swap(true, Ordering::SeqCst) {
        return;
    }

    println!("Client ready for commands.");

    let pool = crate::pools::get_file_queue_pool();
    let current_files = pool.fetch_tasks();
    for file_path in current_files {
        process_queued_file(&file_path).await;
    }

    tokio::spawn(async move {
        loop {
            pool.wait_for_task();
            let new_files = pool.fetch_tasks();
            for file_path in new_files {
                process_queued_file(&file_path).await;
            }
        }
    });
}

#[tauri::command]
fn open_file(
    app: AppHandle,
    state: State<'_, EditorState>,
    path: String,
) -> Result<FileMetadata, String> {
    let pb = PathBuf::from(&path);
    let name = pb
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let contents = fs::read_to_string(&pb).map_err(|e| e.to_string())?;
    let size = contents.as_bytes().len();
    let language = detect_language_from_extension(&pb);
    let lines: Vec<String> = contents
        .split('\n')
        .map(|s| s.trim_end_matches('\r').to_string())
        .collect();

    let meta = FileMetadata {
        name: name.clone(),
        path: path.clone(),
        size,
        language: language.clone(),

        line_count: lines.len(),
    };

    {
        let mut guard = state.0.lock().unwrap();
        *guard = Some(FileState {
            path: pb,
            name,
            size,
            language,
            lines,
        });
    }

    app.emit("file-opened", &meta)
        .map_err(|e| e.to_string())
        .ok();

    Ok(meta)
}

#[tauri::command]
fn read_line(state: State<'_, EditorState>, num: usize) -> Result<String, String> {
    let guard = state.0.lock().unwrap();
    if let Some(file) = guard.as_ref() {
        if num < file.lines.len() {
            Ok(file.lines[num].clone())
        } else {
            Ok(String::new())
        }
    } else {
        Err("no file opened".to_string())
    }
}

#[tauri::command]
fn write_line(
    app: AppHandle,
    state: State<'_, EditorState>,
    num: usize,
    content: String,
) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    if let Some(file) = guard.as_mut() {
        if num >= file.lines.len() {
            file.lines.resize(num + 1, String::new());
        }
        file.lines[num] = content.clone();
        file.size =
            file.lines.iter().map(|l| l.len()).sum::<usize>() + file.lines.len().saturating_sub(1);
        app.emit(
            "file-updated",
            serde_json::json!({ "line": num, "content": content }),
        )
        .map_err(|e| e.to_string())
        .ok();
        Ok(())
    } else {
        Err("no file opened".to_string())
    }
}

#[tauri::command]
fn request_tokenization(
    app: AppHandle,
    state: State<'_, EditorState>,
    line_start: usize,
    line_end: usize,
) -> Result<(), String> {
    let guard = state.0.lock().unwrap();
    if let Some(file) = guard.as_ref() {
        if file.lines.is_empty() {
            app.emit("tokenization", Vec::<Token>::new())
                .map_err(|e| e.to_string())
                .ok();
            return Ok(());
        }
        let start = line_start.min(file.lines.len().saturating_sub(1));
        let end = line_end.min(file.lines.len().saturating_sub(1));
        let mut tokens: Vec<Token> = Vec::new();
        for row in start..=end {
            let line = &file.lines[row];
            let len = line.len();
            tokens.push(Token {
                start_offset: Offset { row, col: 0 },
                end_offset: Offset { row, col: len },
                kind: "untokenized".to_string(),
            });
        }
        app.emit("tokenization", &tokens)
            .map_err(|e| e.to_string())
            .ok();
        Ok(())
    } else {
        Err("no file opened".to_string())
    }
}

#[tauri::command]
fn save_buffer(state: State<'_, EditorState>) -> Result<(), String> {
    let guard = state.0.lock().unwrap();
    if let Some(file) = guard.as_ref() {
        let contents = file.lines.join("\n");
        fs::write(&file.path, contents).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("no file opened".to_string())
    }
}

#[tauri::command]
fn change_language(
    app: AppHandle,
    state: State<'_, EditorState>,
    language: String,
) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    if let Some(file) = guard.as_mut() {
        file.language = language.clone();
        app.emit(
            "language-changed",
            serde_json::json!({ "language": language }),
        )
        .map_err(|e| e.to_string())
        .ok();
        Ok(())
    } else {
        Err("no file opened".to_string())
    }
}

#[tauri::command]
fn close_file(state: State<'_, EditorState>) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    *guard = None;
    Ok(())
}

fn detect_language_from_extension(path: &PathBuf) -> String {
    match path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "rs" => "rust".into(),
        "ts" | "tsx" => "typescript".into(),
        "js" | "jsx" => "javascript".into(),
        "json" => "json".into(),
        "css" => "css".into(),
        "html" | "htm" => "html".into(),
        "md" | "markdown" => "markdown".into(),
        "go" => "go".into(),
        "java" => "java".into(),
        "c" => "c".into(),
        "cpp" | "cc" | "cxx" | "hpp" | "hh" | "hxx" => "cpp".into(),
        "py" => "python".into(),
        "hs" | "lhs" => "haskell".into(),
        "zig" => "zig".into(),
        "dart" => "dart".into(),
        "swift" => "swift".into(),
        "kt" | "kts" => "kotlin".into(),
        "sql" => "sql".into(),
        "php" => "php".into(),
        "lua" => "lua".into(),
        "rb" => "ruby".into(),
        "ml" | "mli" => "ocaml".into(),
        "sh" | "bash" => "bash".into(),
        "ps1" | "psm1" | "psd1" => "powershell".into(),
        other => other.to_string(),
    }
}

#[tauri::command]
fn create_empty_file(
    app: AppHandle,
    state: State<'_, EditorState>,
    path: String,
) -> Result<FileMetadata, String> {
    let pb = PathBuf::from(&path);
    if let Some(parent) = pb.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&pb, "").map_err(|e| e.to_string())?;

    let name = pb
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let language = detect_language_from_extension(&pb);
    let lines: Vec<String> = vec![String::new()];

    let meta = FileMetadata {
        name: name.clone(),

        path: path.clone(),

        size: 0,

        language: language.clone(),

        line_count: lines.len(),
    };

    {
        let mut guard = state.0.lock().unwrap();
        *guard = Some(FileState {
            path: pb,
            name,
            size: 0,
            language,
            lines,
        });
    }

    app.emit("file-opened", &meta)
        .map_err(|e| e.to_string())
        .ok();

    Ok(meta)
}

async fn process_queued_file(path: &String) {
    println!("Opening file: {}", &path);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(EditorState::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            ready,
            open_file,
            create_empty_file,
            read_line,
            write_line,
            request_tokenization,
            save_buffer,
            change_language,
            close_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
