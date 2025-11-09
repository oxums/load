use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

mod pools;
mod task;

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use serde::Serialize;

use tauri::{AppHandle, Emitter, State};
use tree_sitter::{Language, Parser, Point};

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
fn insert_line(
    app: AppHandle,
    state: State<'_, EditorState>,
    num: usize,
    content: String,
) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    if let Some(file) = guard.as_mut() {
        let idx = if num > file.lines.len() {
            file.lines.len()
        } else {
            num
        };
        if idx >= file.lines.len() {
            if idx > file.lines.len() {
                while file.lines.len() < idx {
                    file.lines.push(String::new());
                }
            }
            file.lines.push(content.clone());
        } else {
            file.lines.insert(idx, content.clone());
        }

        file.size =
            file.lines.iter().map(|l| l.len()).sum::<usize>() + file.lines.len().saturating_sub(1);

        app.emit(
            "file-updated",
            serde_json::json!({
              "line": idx,
              "content": file.lines[idx],
              "totalLines": file.lines.len()
            }),
        )
        .map_err(|e| e.to_string())
        .ok();

        Ok(())
    } else {
        Err("no file opened".to_string())
    }
}

#[tauri::command]
fn remove_line(app: AppHandle, state: State<'_, EditorState>, num: usize) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    if let Some(file) = guard.as_mut() {
        if num >= file.lines.len() {
            return Ok(());
        }
        file.lines.remove(num);
        file.size =
            file.lines.iter().map(|l| l.len()).sum::<usize>() + file.lines.len().saturating_sub(1);

        app.emit(
            "file-updated",
            serde_json::json!({
              "line": num,
              "content": file.lines.get(num).cloned().unwrap_or_default(),
              "totalLines": file.lines.len()
            }),
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

        let text = file.lines.join("\n");
        let mut tokens: Vec<Token> = Vec::new();

        if let Some(lang) = get_ts_language(&file.language) {
            let mut parser = Parser::new();
            if parser.set_language(&lang).is_ok() {
                if let Some(tree) = parser.parse(&text, None) {
                    let mut raw: Vec<(Point, Point, String)> = Vec::new();
                    collect_ts_tokens(tree.root_node(), start, end, &mut raw);
                    for (sp, ep, kind) in raw {
                        if ep.row < start || sp.row > end {
                            continue;
                        }
                        tokens.push(Token {
                            start_offset: Offset {
                                row: sp.row,
                                col: sp.column,
                            },
                            end_offset: Offset {
                                row: ep.row,
                                col: ep.column,
                            },
                            kind,
                        });
                    }
                }
            }
        }

        if tokens.is_empty() {
            for row in start..=end {
                let len = file.lines[row].len();
                tokens.push(Token {
                    start_offset: Offset { row, col: 0 },
                    end_offset: Offset { row, col: len },
                    kind: "untokenized".to_string(),
                });
            }
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirEntryItem {
    name: String,
    path: String,
    isDir: bool,
    ignored: bool,
    children: Option<Vec<DirEntryItem>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PathMovedPayload {
    src: String,
    dest: String,
}

fn is_dot_folder(name: &str) -> bool {
    name.starts_with('.')
}

fn build_gitignore(root: &Path) -> Option<Gitignore> {
    let mut builder = GitignoreBuilder::new(root);

    let gi_path = root.join(".gitignore");
    if gi_path.exists() {
        let _ = builder.add(gi_path);
    }

    let info_exclude = root.join(".git").join("info").join("exclude");
    if info_exclude.exists() {
        let _ = builder.add(info_exclude);
    }

    match builder.build() {
        Ok(m) => Some(m),
        Err(_) => None,
    }
}

fn is_ignored_path(m: Option<&Gitignore>, root: &Path, path: &Path, is_dir: bool) -> bool {
    if let Some(matcher) = m {
        if let Ok(rel) = path.strip_prefix(root) {
            let matched = matcher.matched(rel, is_dir);
            return matched.is_ignore();
        }
        let matched = matcher.matched(path, is_dir);
        return matched.is_ignore();
    }
    false
}

fn build_dir_entry(
    path: &Path,
    root: &Path,
    matcher: Option<&Gitignore>,
) -> Result<DirEntryItem, String> {
    let is_dir = path.is_dir();

    let name = {
        path.file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| path.display().to_string())
    };

    let ignored = is_ignored_path(matcher, root, path, is_dir);

    Ok(DirEntryItem {
        name,
        path: path.to_string_lossy().to_string(),
        isDir: is_dir,
        ignored,
        children: None,
    })
}

fn list_dir_children(
    dir: &Path,
    root: &Path,
    matcher: Option<&Gitignore>,
) -> Result<Vec<DirEntryItem>, String> {
    let mut children: Vec<DirEntryItem> = Vec::new();

    let rd = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in rd {
        let entry = match entry {
            Ok(v) => v,
            Err(_) => continue,
        };

        let child_path = entry.path();
        let ft = match entry.file_type() {
            Ok(v) => v,
            Err(_) => continue,
        };
        let child_name = entry.file_name().to_string_lossy().to_string();

        // Hide any folder that starts with a '.'
        if ft.is_dir() && is_dot_folder(&child_name) {
            continue;
        }

        match build_dir_entry(&child_path, root, matcher) {
            Ok(child) => children.push(child),
            Err(_) => continue,
        }
    }

    children.sort_by(|a, b| {
        if a.isDir != b.isDir {
            b.isDir.cmp(&a.isDir)
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(children)
}

#[tauri::command]
fn read_directory_root(path: String) -> Result<DirEntryItem, String> {
    let root = PathBuf::from(&path);
    if !root.exists() {
        return Err("path does not exist".into());
    }
    if !root.is_dir() {
        return Err("path is not a directory".into());
    }
    let matcher = build_gitignore(&root);

    let mut node = build_dir_entry(&root, &root, matcher.as_ref())?;
    let children = list_dir_children(&root, &root, matcher.as_ref())?;
    node.children = Some(children);
    Ok(node)
}

#[tauri::command]
fn read_directory_children(path: String, root: String) -> Result<Vec<DirEntryItem>, String> {
    let dir = PathBuf::from(&path);
    if !dir.exists() {
        return Err("path does not exist".into());
    }
    if !dir.is_dir() {
        return Err("path is not a directory".into());
    }

    let root_pb = PathBuf::from(&root);
    let matcher = build_gitignore(&root_pb);

    list_dir_children(&dir, &root_pb, matcher.as_ref())
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

fn get_ts_language(language: &str) -> Option<Language> {
    match language.to_ascii_lowercase().as_str() {
        "rust" => Some(tree_sitter_rust::LANGUAGE.into()),
        "javascript" => Some(tree_sitter_javascript::LANGUAGE.into()),
        "typescript" => Some(tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()),
        "tsx" => Some(tree_sitter_typescript::LANGUAGE_TSX.into()),
        "json" => Some(tree_sitter_json::LANGUAGE.into()),
        "css" => Some(tree_sitter_css::LANGUAGE.into()),
        "html" => Some(tree_sitter_html::LANGUAGE.into()),
        "markdown" => Some(tree_sitter_md::LANGUAGE.into()),
        "python" => Some(tree_sitter_python::LANGUAGE.into()),
        "go" => Some(tree_sitter_go::LANGUAGE.into()),
        "java" => Some(tree_sitter_java::LANGUAGE.into()),
        "c" => Some(tree_sitter_c::LANGUAGE.into()),
        "cpp" => Some(tree_sitter_cpp::LANGUAGE.into()),
        "zig" => Some(tree_sitter_zig::LANGUAGE.into()),
        "lua" => Some(tree_sitter_lua::LANGUAGE.into()),
        "dart" => Some(tree_sitter_dart::language()),
        "php" => Some(tree_sitter_php::LANGUAGE_PHP.into()),
        "ruby" => Some(tree_sitter_ruby::LANGUAGE.into()),
        "bash" => Some(tree_sitter_bash::LANGUAGE.into()),
        "powershell" => Some(tree_sitter_powershell::LANGUAGE.into()),
        "haskell" => Some(tree_sitter_haskell::LANGUAGE.into()),
        "ocaml" => Some(tree_sitter_ocaml::LANGUAGE_OCAML.into()),
        "swift" => Some(tree_sitter_swift::LANGUAGE.into()),
        _ => None,
    }
}

fn collect_ts_tokens(
    node: tree_sitter::Node,
    row_start: usize,
    row_end: usize,
    out: &mut Vec<(Point, Point, String)>,
) {
    let start_pos = node.start_position();
    let end_pos = node.end_position();

    if end_pos.row < row_start || start_pos.row > row_end {
        return;
    }

    if node.child_count() == 0 {
        out.push((start_pos, end_pos, node.kind().to_string()));
        return;
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_ts_tokens(child, row_start, row_end, out);
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
#[tauri::command]
fn copy_path(src: String, dest: String) -> Result<(), String> {
    let src_pb = PathBuf::from(&src);
    if !src_pb.exists() {
        return Err("source does not exist".into());
    }
    let dest_pb = PathBuf::from(&dest);

    if src_pb.is_dir() {
        copy_dir_recursive(&src_pb, &dest_pb).map_err(|e| e.to_string())?;
    } else {
        if let Some(parent) = dest_pb.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::copy(&src_pb, &dest_pb).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), std::io::Error> {
    if !dest.exists() {
        fs::create_dir_all(dest)?;
    }
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name();
        let target = dest.join(name);
        if path.is_dir() {
            copy_dir_recursive(&path, &target)?;
        } else {
            if let Some(parent) = target.parent() {
                if !parent.exists() {
                    fs::create_dir_all(parent)?;
                }
            }
            fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

#[tauri::command]
fn move_path(src: String, dest: String) -> Result<(), String> {
    let src_pb = PathBuf::from(&src);
    if !src_pb.exists() {
        return Err("source does not exist".into());
    }

    let dest_pb = PathBuf::from(&dest);
    if let Some(parent) = dest_pb.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }

    match fs::rename(&src_pb, &dest_pb) {
        Ok(_) => Ok(()),
        Err(e) => {
            if e.kind() == std::io::ErrorKind::CrossesDevices {
                if src_pb.is_dir() {
                    copy_dir_recursive(&src_pb, &dest_pb).map_err(|e| e.to_string())?;

                    fs::remove_dir_all(&src_pb).map_err(|e| e.to_string())?;
                } else {
                    if let Some(parent) = dest_pb.parent() {
                        if !parent.exists() {
                            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                        }
                    }
                    fs::copy(&src_pb, &dest_pb).map_err(|e| e.to_string())?;
                    fs::remove_file(&src_pb).map_err(|e| e.to_string())?;
                }
                Ok(())
            } else {
                Err(e.to_string())
            }
        }
    }
}

#[tauri::command]
fn delete_path(path: String) -> Result<(), String> {
    let pb = PathBuf::from(&path);
    if !pb.exists() {
        return Err("path does not exist".into());
    }
    if pb.is_dir() {
        fs::remove_dir_all(&pb).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(&pb).map_err(|e| e.to_string())?;
    }
    Ok(())
}

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
            read_directory_root,
            read_directory_children,
            read_line,
            write_line,
            insert_line,
            remove_line,
            request_tokenization,
            save_buffer,
            change_language,
            close_file,
            copy_path,
            move_path,
            delete_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
