use std::{
    collections::VecDeque,
    io::{BufRead, BufReader},
    net::{TcpListener, TcpStream},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use anyhow::{anyhow, Context};
use serde::Serialize;
use tauri::{AppHandle, State};
use url::Url;

use crate::settings::AppSettings;

const DEFAULT_LOCAL_API_PORT: u16 = 3000;
const MAX_LOG_LINES: usize = 240;
const MAX_PORT_SCAN_STEPS: u16 = 32;
const LOCAL_API_STARTUP_TIMEOUT_SECS: u64 = 20;
const LOCAL_API_STARTUP_EXTENDED_TIMEOUT_SECS: u64 = 60;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub struct LocalNeteaseApiState {
    runtime: Arc<Mutex<LocalNeteaseApiRuntime>>,
    logs: Arc<Mutex<VecDeque<String>>>,
}

impl Default for LocalNeteaseApiState {
    fn default() -> Self {
        Self {
            runtime: Arc::new(Mutex::new(LocalNeteaseApiRuntime::default())),
            logs: Arc::new(Mutex::new(VecDeque::with_capacity(MAX_LOG_LINES))),
        }
    }
}

#[derive(Default)]
struct LocalNeteaseApiRuntime {
    child: Option<Child>,
    signature: Option<String>,
    port: u16,
    last_error: Option<String>,
    is_starting: bool,
}

impl Drop for LocalNeteaseApiState {
    fn drop(&mut self) {
        if let Ok(mut runtime) = self.runtime.lock() {
            stop_child_process(runtime.child.take());
        }
    }
}

#[derive(Debug, Clone)]
struct LocalNeteaseApiConfig {
    port: u16,
    cookie: String,
    proxy: String,
    real_ip: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalNeteaseApiServerStatus {
    pub enabled: bool,
    pub running: bool,
    pub starting: bool,
    pub managed_by_app: bool,
    pub url: String,
    pub port: u16,
    pub message: Option<String>,
    pub log_lines: Vec<String>,
}

fn is_netease_enabled(settings: &AppSettings) -> bool {
    settings
        .network
        .enabled_sources
        .iter()
        .any(|source| source.trim().eq_ignore_ascii_case("netease"))
}

fn resolve_local_api_port(settings: &AppSettings) -> u16 {
    let trimmed = settings.network.netease_api_base_url.trim();
    if trimmed.is_empty() {
        return DEFAULT_LOCAL_API_PORT;
    }

    Url::parse(trimmed)
        .ok()
        .and_then(|url| url.port())
        .unwrap_or(DEFAULT_LOCAL_API_PORT)
}

fn build_signature(config: &LocalNeteaseApiConfig) -> String {
    [
        config.port.to_string(),
        config.cookie.clone(),
        config.proxy.clone(),
        config.real_ip.clone(),
    ]
    .join("|")
}

fn resolve_desired_config(settings: &AppSettings) -> Option<LocalNeteaseApiConfig> {
    if !settings.network.use_local_api_server || !is_netease_enabled(settings) {
        return None;
    }

    Some(LocalNeteaseApiConfig {
        port: resolve_local_api_port(settings),
        cookie: settings.network.netease_cookie.trim().to_string(),
        proxy: settings.network.netease_proxy.trim().to_string(),
        real_ip: settings.network.netease_real_ip.trim().to_string(),
    })
}

fn stop_child_process(child: Option<Child>) {
    if let Some(child) = child {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;

            let _ = Command::new("taskkill")
                .args(["/PID", &child.id().to_string(), "/T", "/F"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW)
                .spawn();
        }

        #[cfg(not(windows))]
        {
            let _ = child.kill();
        }
    }
}

fn is_local_port_available(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn resolve_spawn_port(preferred_port: u16, logs: &Arc<Mutex<VecDeque<String>>>) -> u16 {
    if is_local_port_available(preferred_port) {
        return preferred_port;
    }

    for step in 1..=MAX_PORT_SCAN_STEPS {
        let candidate = preferred_port.saturating_add(step);
        if candidate == preferred_port {
            break;
        }

        if is_local_port_available(candidate) {
            push_log_line(
                logs,
                format!(
                    "[system] port {preferred_port} is already in use, falling back to http://127.0.0.1:{candidate}"
                ),
            );
            return candidate;
        }
    }

    push_log_line(
        logs,
        format!(
            "[system] no free port was found near {preferred_port}, retrying the preferred port"
        ),
    );
    preferred_port
}

fn wait_for_local_api_ready(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;

    while Instant::now() < deadline {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }

        thread::sleep(Duration::from_millis(180));
    }

    false
}

fn push_log_line(logs: &Arc<Mutex<VecDeque<String>>>, line: impl Into<String>) {
    if let Ok(mut lines) = logs.lock() {
        let line = line.into();
        if line.trim().is_empty() {
            return;
        }

        lines.push_back(line);
        while lines.len() > MAX_LOG_LINES {
            lines.pop_front();
        }
    }
}

fn clear_log_lines(logs: &Arc<Mutex<VecDeque<String>>>) {
    if let Ok(mut lines) = logs.lock() {
        lines.clear();
    }
}

fn read_log_lines(logs: &Arc<Mutex<VecDeque<String>>>) -> Vec<String> {
    logs.lock()
        .map(|lines| lines.iter().cloned().collect())
        .unwrap_or_default()
}

fn spawn_output_reader<T: std::io::Read + Send + 'static>(
    reader: T,
    logs: Arc<Mutex<VecDeque<String>>>,
    source: &'static str,
) {
    thread::spawn(move || {
        let buffered = BufReader::new(reader);
        for line in buffered.lines() {
            match line {
                Ok(content) => push_log_line(&logs, format!("[{source}] {content}")),
                Err(error) => {
                    push_log_line(&logs, format!("[system] failed to read {source}: {error}"));
                    break;
                }
            }
        }
    });
}

fn spawn_local_netease_api(
    config: &LocalNeteaseApiConfig,
    logs: &Arc<Mutex<VecDeque<String>>>,
) -> anyhow::Result<Child> {
    #[cfg(windows)]
    use std::os::windows::process::CommandExt;

    #[cfg(windows)]
    let mut command = {
        let mut command = Command::new("npx.cmd");
        command.args(["-y", "NeteaseCloudMusicApi@latest"]);
        command.creation_flags(CREATE_NO_WINDOW);
        command
    };

    #[cfg(not(windows))]
    let mut command = {
        let mut command = Command::new("npx");
        command.args(["-y", "NeteaseCloudMusicApi@latest"]);
        command
    };

    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PORT", config.port.to_string())
        .env("HOST", "127.0.0.1");

    if !config.cookie.is_empty() {
        command.env("COOKIE", &config.cookie);
    }

    if !config.proxy.is_empty() {
        command
            .env("PROXY", &config.proxy)
            .env("HTTP_PROXY", &config.proxy)
            .env("HTTPS_PROXY", &config.proxy)
            .env("http_proxy", &config.proxy)
            .env("https_proxy", &config.proxy);
    }

    if !config.real_ip.is_empty() {
        command.env("REAL_IP", &config.real_ip);
    }

    let mut child = command
        .spawn()
        .context("failed to start NeteaseCloudMusicApi with the system Node.js environment")?;

    if let Some(stdout) = child.stdout.take() {
        spawn_output_reader(stdout, Arc::clone(logs), "stdout");
    }

    if let Some(stderr) = child.stderr.take() {
        spawn_output_reader(stderr, Arc::clone(logs), "stderr");
    }

    Ok(child)
}

fn run_command_success(command: &str, args: &[&str]) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        Command::new(command)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    #[cfg(not(windows))]
    {
        Command::new(command)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
}

fn detect_local_api_dependencies(
    logs: &Arc<Mutex<VecDeque<String>>>,
) -> anyhow::Result<Duration> {
    #[cfg(windows)]
    let npx_command = "npx.cmd";
    #[cfg(not(windows))]
    let npx_command = "npx";

    if !run_command_success("node", &["--version"]) {
        return Err(anyhow!(
            "Node.js is not installed or not available in PATH, so the local Netease API server cannot be started."
        ));
    }

    if !run_command_success(npx_command, &["--version"]) {
        return Err(anyhow!(
            "npx is not available in PATH, so the local Netease API server cannot be started."
        ));
    }

    if !run_command_success(
        npx_command,
        &["--no-install", "NeteaseCloudMusicApi", "--version"],
    ) {
        push_log_line(
            logs,
            "[system] NeteaseCloudMusicApi is not available locally yet; first startup may download the package and take longer.",
        );
        return Ok(Duration::from_secs(LOCAL_API_STARTUP_EXTENDED_TIMEOUT_SECS));
    }

    Ok(Duration::from_secs(LOCAL_API_STARTUP_TIMEOUT_SECS))
}

fn build_status_from_runtime(
    runtime: &LocalNeteaseApiRuntime,
    enabled: bool,
    port: u16,
    logs: &Arc<Mutex<VecDeque<String>>>,
) -> LocalNeteaseApiServerStatus {
    let resolved_port = if enabled && runtime.child.is_some() && runtime.port > 0 {
        runtime.port
    } else {
        port
    };

    LocalNeteaseApiServerStatus {
        enabled,
        running: enabled && runtime.child.is_some() && !runtime.is_starting,
        starting: enabled && runtime.child.is_some() && runtime.is_starting,
        managed_by_app: enabled,
        url: format!("http://127.0.0.1:{resolved_port}"),
        port: resolved_port,
        message: runtime.last_error.clone(),
        log_lines: read_log_lines(logs),
    }
}

fn snapshot_local_netease_api_status(
    state: &LocalNeteaseApiState,
    settings: &AppSettings,
) -> anyhow::Result<LocalNeteaseApiServerStatus> {
    let enabled = settings.network.use_local_api_server && is_netease_enabled(settings);
    let preferred_port = resolve_local_api_port(settings);
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| anyhow!("failed to acquire local api runtime lock"))?;

    if let Some(child) = runtime.child.as_mut() {
        match child.try_wait() {
            Ok(Some(status)) => {
                runtime.last_error = Some(format!("local api server exited with status {status}"));
                runtime.child = None;
                runtime.signature = None;
                runtime.is_starting = false;
            }
            Ok(None) => {}
            Err(error) => {
                runtime.last_error = Some(error.to_string());
                runtime.child = None;
                runtime.signature = None;
                runtime.is_starting = false;
            }
        }
    }

    if !enabled || runtime.child.is_none() || runtime.port == 0 {
        runtime.port = preferred_port;
    }

    Ok(build_status_from_runtime(
        &runtime,
        enabled,
        preferred_port,
        &state.logs,
    ))
}

pub fn shutdown_local_netease_api_server(state: &LocalNeteaseApiState) {
    if let Ok(mut runtime) = state.runtime.lock() {
        stop_child_process(runtime.child.take());
        runtime.signature = None;
        runtime.last_error = None;
        runtime.is_starting = false;
    }
}

pub fn sync_local_netease_api_server_for_settings(
    _app: &AppHandle,
    state: &LocalNeteaseApiState,
    settings: &AppSettings,
) -> anyhow::Result<LocalNeteaseApiServerStatus> {
    let desired_config = resolve_desired_config(settings);
    let logs = Arc::clone(&state.logs);

    {
        let mut runtime = state
            .runtime
            .lock()
            .map_err(|_| anyhow!("failed to acquire local api runtime lock"))?;

        if let Some(child) = runtime.child.as_mut() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    runtime.last_error = Some(format!("local api server exited with status {status}"));
                    runtime.child = None;
                    runtime.signature = None;
                    runtime.is_starting = false;
                }
                Ok(None) => {}
                Err(error) => {
                    runtime.last_error = Some(error.to_string());
                    runtime.child = None;
                    runtime.signature = None;
                    runtime.is_starting = false;
                }
            }
        }

        let Some(mut config) = desired_config.clone() else {
            if runtime.child.is_some() {
                push_log_line(&logs, "[system] stopping local Netease API server");
            }
            stop_child_process(runtime.child.take());
            runtime.signature = None;
            runtime.last_error = None;
            runtime.port = resolve_local_api_port(settings);
            runtime.is_starting = false;
            clear_log_lines(&logs);
            return Ok(build_status_from_runtime(
                &runtime,
                false,
                runtime.port,
                &logs,
            ));
        };

        let signature = build_signature(&config);
        if runtime.child.is_some() && runtime.signature.as_deref() == Some(signature.as_str()) {
            return Ok(build_status_from_runtime(&runtime, true, config.port, &logs));
        }

        config.port = resolve_spawn_port(config.port, &logs);

        if runtime.child.is_some() {
            push_log_line(&logs, "[system] restarting local Netease API server");
        }
        stop_child_process(runtime.child.take());
        runtime.signature = None;
        runtime.port = config.port;
        runtime.last_error = None;
        runtime.is_starting = true;

        clear_log_lines(&logs);
        push_log_line(
            &logs,
            format!("[system] starting local Netease API server on http://127.0.0.1:{}", config.port),
        );

        let startup_timeout = match detect_local_api_dependencies(&logs) {
            Ok(timeout) => timeout,
            Err(error) => {
                runtime.child = None;
                runtime.signature = None;
                runtime.is_starting = false;
                runtime.last_error = Some(error.to_string());
                push_log_line(&logs, format!("[system] {error}"));
                return Ok(build_status_from_runtime(&runtime, true, config.port, &logs));
            }
        };

        let child = spawn_local_netease_api(&config, &logs)?;
        runtime.child = Some(child);
        runtime.signature = Some(signature);

        let runtime_state = Arc::clone(&state.runtime);
        let logs_state = Arc::clone(&logs);
        let startup_signature = runtime.signature.clone();
        let startup_port = config.port;
        let startup_timeout_for_thread = startup_timeout;

        thread::spawn(move || {
            if wait_for_local_api_ready(startup_port, startup_timeout_for_thread) {
                if let Ok(mut runtime) = runtime_state.lock() {
                    if runtime.signature.as_ref() == startup_signature.as_ref() {
                        runtime.last_error = None;
                        runtime.is_starting = false;
                        push_log_line(
                            &logs_state,
                            format!(
                                "[system] local Netease API server is ready at http://127.0.0.1:{startup_port}"
                            ),
                        );
                    }
                }
                return;
            }

            if let Ok(mut runtime) = runtime_state.lock() {
                if runtime.signature.as_ref() != startup_signature.as_ref() {
                    return;
                }

                stop_child_process(runtime.child.take());
                runtime.signature = None;
                runtime.is_starting = false;
                runtime.last_error = Some("local api server did not become ready in time".to_string());
                push_log_line(
                    &logs_state,
                    "[system] local Netease API server did not become ready in time",
                );
            }
        });
    }

    let config = desired_config.expect("desired config must exist when local api is enabled");
    let runtime = state
        .runtime
        .lock()
        .map_err(|_| anyhow!("failed to acquire local api runtime lock"))?;
    Ok(build_status_from_runtime(&runtime, true, config.port, &logs))
}

#[tauri::command]
pub fn sync_local_netease_api_server(
    app: AppHandle,
    state: State<'_, LocalNeteaseApiState>,
    settings: AppSettings,
) -> Result<LocalNeteaseApiServerStatus, String> {
    sync_local_netease_api_server_for_settings(&app, &state, &settings)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_local_netease_api_server_status(
    state: State<'_, LocalNeteaseApiState>,
    settings: AppSettings,
) -> Result<LocalNeteaseApiServerStatus, String> {
    snapshot_local_netease_api_status(&state, &settings).map_err(|error| error.to_string())
}
