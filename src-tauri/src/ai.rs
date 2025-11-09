 use std::io;
use std::process::{Command, Output, Stdio};

#[tauri::command]
pub fn ollama_available() -> bool {
    which::which("ollama").is_ok()
}

#[tauri::command]
pub fn ollama_model_is_downloaded(model: String) -> Result<bool, String> {
    if !ollama_available() {
        return Err("ollama is not installed or not found in PATH".into());
    }

    let output = run_ollama(&["show", &model]).map_err(|e| format!("failed to run ollama: {e}"))?;
    Ok(output.status.success())
}

#[tauri::command]
pub async fn ollama_pull_model(model: String) -> Result<String, String> {
    if !ollama_available() {
        return Err("ollama is not installed or not found in PATH".into());
    }

    let output = run_ollama_async(vec!["pull".to_string(), model]).await?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(if stderr.trim().is_empty() {
            "ollama pull failed with unknown error".into()
        } else {
            stderr
        })
    }
}

#[tauri::command]
pub async fn ollama_generate(model: String, prompt: String) -> Result<String, String> {
    if !ollama_available() {
        return Err("ollama is not installed or not found in PATH".into());
    }

    let output = run_ollama_async(vec!["run".to_string(), model, prompt]).await?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(if stderr.trim().is_empty() {
            "ollama run failed with unknown error".into()
        } else {
            stderr
        })
    }
}

fn run_ollama(args: &[&str]) -> io::Result<Output> {
    Command::new("ollama")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
}

async fn run_ollama_async(args: Vec<String>) -> Result<Output, String> {
    tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new("ollama");
        cmd.args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        cmd.output().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
