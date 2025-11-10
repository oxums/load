use std::io;
use std::process::{Command, Output, Stdio};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
#[cfg(windows)]
const DETACHED_PROCESS: u32 = 0x00000008;

#[inline]
fn configure_hidden(cmd: &mut Command) {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
    }
}

#[tauri::command]
pub fn ollama_available() -> bool {
    which::which("ollama").is_ok()
}

#[tauri::command]
pub async fn ollama_model_is_downloaded(model: String) -> Result<bool, String> {
    if !ollama_available() {
        return Err("ollama is not installed or not found in PATH".into());
    }

    use std::sync::mpsc;
    use std::time::Duration;
    let (tx, rx) = mpsc::channel();
    let model_clone = model.clone();
    std::thread::spawn(move || {
        let res = run_ollama(&["show", &model_clone]);
        let _ = tx.send(res);
    });
    let output = rx
        .recv_timeout(Duration::from_secs(3))
        .map_err(|_| "timed out checking model; is the Ollama service running?".to_string())?
        .map_err(|e| format!("failed to run ollama: {e}"))?;
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
    let mut cmd = Command::new("ollama");
    cmd.args(args);
    configure_hidden(&mut cmd);
    cmd.output()
}

async fn run_ollama_async(args: Vec<String>) -> Result<Output, String> {
    tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new("ollama");
        cmd.args(&args);
        configure_hidden(&mut cmd);
        cmd.output().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
