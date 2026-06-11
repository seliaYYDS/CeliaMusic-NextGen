mod local_api;
mod media;
mod media_proxy;
mod settings;
mod wallpaper;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    OnceLock,
};

use local_api::{
    get_local_netease_api_server_status, sync_local_netease_api_server,
    sync_local_netease_api_server_for_settings, shutdown_local_netease_api_server,
    LocalNeteaseApiState,
};
use media::{
    clear_media_library, delete_media_tracks, ensure_media_library, import_media_files,
    list_media_library, register_remote_track, save_song_config, cache_remote_audio_for_spectrum,
    clear_cached_spectrum_audio, analyze_local_audio_spectrum, analyze_local_audio_track,
    analyze_audio_alignment,
    MediaState,
};
use media_proxy::{
    ensure_media_proxy_server, get_media_proxy_server_status, MediaProxyState,
};
use settings::{
    ensure_app_settings, get_app_settings, list_system_font_families,
    load_app_settings_or_default, reset_app_settings, save_app_settings, AppSettingsState,
    MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH,
};
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, LogicalPosition, LogicalSize, Manager, Size, WebviewUrl, WebviewWindowBuilder,
};

#[cfg(windows)]
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS},
        System::Threading::CreateMutexW,
        UI::WindowsAndMessaging::{FindWindowW, SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOW},
    },
};

const MAIN_WINDOW_LABEL: &str = "main";
const COMPONENT_DYNAMIC_ISLAND_WINDOW_LABEL: &str = "component-dynamic-island";
const COMPONENT_DYNAMIC_ISLAND_WINDOW_URL: &str = "index.html?window=component-dynamic-island";
const COMPONENT_DYNAMIC_ISLAND_WINDOW_TITLE: &str = "Celia Component Dynamic Island";
const COMPONENT_DYNAMIC_ISLAND_BODY_WIDTH: f64 = 416.0;
const COMPONENT_DYNAMIC_ISLAND_BODY_HEIGHT: f64 = 68.0;
const COMPONENT_DYNAMIC_ISLAND_WINDOW_PADDING_X: f64 = 16.0;
const COMPONENT_DYNAMIC_ISLAND_WINDOW_PADDING_BOTTOM: f64 = 16.0;
const COMPONENT_DYNAMIC_ISLAND_WINDOW_WIDTH: f64 =
    COMPONENT_DYNAMIC_ISLAND_BODY_WIDTH + (COMPONENT_DYNAMIC_ISLAND_WINDOW_PADDING_X * 2.0);
const COMPONENT_DYNAMIC_ISLAND_WINDOW_HEIGHT: f64 =
    COMPONENT_DYNAMIC_ISLAND_BODY_HEIGHT + COMPONENT_DYNAMIC_ISLAND_WINDOW_PADDING_BOTTOM;
const COMPONENT_DYNAMIC_ISLAND_TOP_OFFSET: f64 = 18.0;
const IMMERSIVE_WALLPAPER_WINDOW_LABEL: &str = "immersive-wallpaper";
const IMMERSIVE_WALLPAPER_WINDOW_URL: &str = "index.html?window=immersive-wallpaper";
const IMMERSIVE_WALLPAPER_WINDOW_TITLE: &str = "Celia Immersive Wallpaper";
const TRAY_MENU_OPEN_ID: &str = "tray_open";
const TRAY_MENU_COMPONENT_CONTROL_ID: &str = "tray_component_control";
const TRAY_MENU_REFRESH_ID: &str = "tray_refresh";
const TRAY_MENU_QUIT_ID: &str = "tray_quit";
const COMPONENT_CONTROL_INIT_SCRIPT: &str = "window.__CELIA_WINDOW_KIND__ = 'component-control';";
const COMPONENT_DYNAMIC_ISLAND_INIT_SCRIPT: &str =
    "window.__CELIA_WINDOW_KIND__ = 'component-dynamic-island';";
const MAIN_WINDOW_VISIBILITY_EVENT: &str = "app-window-visibility";
#[cfg(windows)]
const SINGLE_INSTANCE_MUTEX_NAME: &str = "Local\\CeliaMusicNextGen.SingleInstance";
#[cfg(windows)]
const MAIN_WINDOW_TITLE: &str = "Celia Music Next Gen";

#[cfg(windows)]
static SINGLE_INSTANCE_MUTEX: OnceLock<isize> = OnceLock::new();

#[derive(Default)]
struct AppRuntimeState {
    exit_requested: AtomicBool,
}

#[cfg(windows)]
fn to_wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn activate_existing_instance_window() {
    let window_title = to_wide_null(MAIN_WINDOW_TITLE);

    unsafe {
        if let Ok(hwnd) = FindWindowW(PCWSTR::null(), PCWSTR(window_title.as_ptr())) {
            let _ = ShowWindow(hwnd, SW_SHOW);
            let _ = ShowWindow(hwnd, SW_RESTORE);
            let _ = SetForegroundWindow(hwnd);
        }
    }
}

#[cfg(windows)]
fn acquire_single_instance() -> bool {
    let mutex_name = to_wide_null(SINGLE_INSTANCE_MUTEX_NAME);

    unsafe {
        let mutex = match CreateMutexW(None, true, PCWSTR(mutex_name.as_ptr())) {
            Ok(handle) => handle,
            Err(_) => return true,
        };

        if GetLastError() == ERROR_ALREADY_EXISTS {
            let _ = CloseHandle(mutex);
            return false;
        }

        let _ = SINGLE_INSTANCE_MUTEX.set(mutex.0 as isize);
        true
    }
}

#[cfg(not(windows))]
fn acquire_single_instance() -> bool {
    true
}

fn should_start_hidden_to_tray() -> bool {
    std::env::args_os().any(|arg| {
        arg.to_string_lossy()
            .eq_ignore_ascii_case("--startup-tray")
    })
}

fn hide_main_window_to_tray<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.emit(MAIN_WINDOW_VISIBILITY_EVENT, false);
        let _ = window.set_skip_taskbar(true);
        let _ = window.minimize();
        let _ = window.hide();
    }
}

fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.set_skip_taskbar(false);
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = window.emit(MAIN_WINDOW_VISIBILITY_EVENT, true);
    }
}

fn refresh_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = window.eval("window.location.reload()");
    }
}

fn open_component_control_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("component-control") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        app,
        "component-control",
        WebviewUrl::App("index.html".into()),
    )
    .initialization_script(COMPONENT_CONTROL_INIT_SCRIPT)
    .title("Celia Component Control")
    .inner_size(438.0, 580.0)
    .min_inner_size(380.0, 480.0)
    .resizable(true)
    .maximizable(true)
    .minimizable(true)
    .closable(true)
    .fullscreen(false)
    .decorations(false)
    .transparent(true)
    .shadow(true)
    .skip_taskbar(false)
    .visible(true)
    .build()?;

    if let Some(main_window) = app.get_webview_window("main") {
        let main_window_visible = main_window.is_visible().unwrap_or(false);
        let main_window_minimized = main_window.is_minimized().unwrap_or(false);

        if main_window_visible && !main_window_minimized {
            if let Ok(position) = main_window.outer_position() {
                let _ = window.set_position(LogicalPosition::new(
                    position.x as f64 + 72.0,
                    position.y as f64 + 72.0,
                ));
            } else {
                let _ = window.center();
            }
        } else {
            let _ = window.center();
        }
    } else {
        let _ = window.center();
    }

    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
async fn open_component_dynamic_island_window(app: tauri::AppHandle) -> Result<(), String> {
    let (window, created_now) = if let Some(existing_window) =
        app.get_webview_window(COMPONENT_DYNAMIC_ISLAND_WINDOW_LABEL)
    {
        let _ = existing_window.show();
        let _ = existing_window.unminimize();
        (existing_window, false)
    } else {
        let new_window = WebviewWindowBuilder::new(
            &app,
            COMPONENT_DYNAMIC_ISLAND_WINDOW_LABEL,
            WebviewUrl::App(COMPONENT_DYNAMIC_ISLAND_WINDOW_URL.into()),
        )
        .initialization_script(COMPONENT_DYNAMIC_ISLAND_INIT_SCRIPT)
        .title(COMPONENT_DYNAMIC_ISLAND_WINDOW_TITLE)
        .inner_size(
            COMPONENT_DYNAMIC_ISLAND_WINDOW_WIDTH,
            COMPONENT_DYNAMIC_ISLAND_WINDOW_HEIGHT,
        )
        .min_inner_size(
            COMPONENT_DYNAMIC_ISLAND_WINDOW_WIDTH,
            COMPONENT_DYNAMIC_ISLAND_WINDOW_HEIGHT,
        )
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(true)
        .fullscreen(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible(true)
        .focused(false)
        .build()
        .map_err(|error| format!("failed to build component dynamic island window: {error}"))?;

        (new_window, true)
    };

    let _ = window.set_ignore_cursor_events(true);

    if created_now {
        if let Some(monitor) = app.primary_monitor().map_err(|error| error.to_string())? {
        let monitor_position = monitor.position().to_logical::<f64>(monitor.scale_factor());
        let monitor_size = monitor.size().to_logical::<f64>(monitor.scale_factor());
        let target_x = monitor_position.x
            + ((monitor_size.width - COMPONENT_DYNAMIC_ISLAND_WINDOW_WIDTH) / 2.0).max(0.0);
        let target_y = monitor_position.y + COMPONENT_DYNAMIC_ISLAND_TOP_OFFSET;
        let _ = window.set_position(LogicalPosition::new(target_x, target_y));
        } else {
            let _ = window.center();
        }
    }

    Ok(())
}

fn shutdown_app<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let runtime_state = app.state::<AppRuntimeState>();
    runtime_state.exit_requested.store(true, Ordering::SeqCst);

    let local_api_state = app.state::<LocalNeteaseApiState>();
    shutdown_local_netease_api_server(&local_api_state);
    app.exit(0);
}

#[tauri::command]
fn enable_wallpaper_mode(app: tauri::AppHandle, label: String) -> Result<(), String> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Wallpaper window `{label}` was not found."))?;

    wallpaper::enable_wallpaper_mode(window).map_err(|error| error.to_string())
}

#[tauri::command]
async fn open_immersive_wallpaper_window(app: tauri::AppHandle) -> Result<(), String> {
    eprintln!(
        "[wallpaper] open_immersive_wallpaper_window requested, label={IMMERSIVE_WALLPAPER_WINDOW_LABEL}"
    );

    let window = if let Some(existing_window) = app.get_webview_window(IMMERSIVE_WALLPAPER_WINDOW_LABEL)
    {
        eprintln!("[wallpaper] reusing existing immersive wallpaper window");
        existing_window
    } else {
        eprintln!("[wallpaper] building immersive wallpaper window in Rust");
        WebviewWindowBuilder::new(
            &app,
            IMMERSIVE_WALLPAPER_WINDOW_LABEL,
            WebviewUrl::App(IMMERSIVE_WALLPAPER_WINDOW_URL.into()),
        )
        .title(IMMERSIVE_WALLPAPER_WINDOW_TITLE)
        .inner_size(1280.0, 720.0)
        .min_inner_size(960.0, 540.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(true)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .focused(false)
        .skip_taskbar(true)
        .visible(true)
        .build()
        .map_err(|error| {
            format!("failed to build immersive wallpaper window: {error}")
        })?
    };

    if let Err(error) = wallpaper::enable_wallpaper_mode(window.clone()) {
        eprintln!("[wallpaper] open_immersive_wallpaper_window failed: {error:#}");
        let _ = window.close();
        return Err(error.to_string());
    }

    eprintln!("[wallpaper] open_immersive_wallpaper_window finished successfully");
    Ok(())
}

fn build_tray<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text(TRAY_MENU_OPEN_ID, "打开应用窗口")
        .text(TRAY_MENU_COMPONENT_CONTROL_ID, "打开组件控制窗口")
        .text(TRAY_MENU_REFRESH_ID, "刷新应用")
        .separator()
        .text(TRAY_MENU_QUIT_ID, "关闭应用")
        .build()?;

    let mut tray = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip("Celia Music Next Gen")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => {
                show_main_window(tray.app_handle());
            }
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } => {
                show_main_window(tray.app_handle());
            }
            _ => {}
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    let _ = tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if !acquire_single_instance() {
        #[cfg(windows)]
        activate_existing_instance_window();
        return;
    }

    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }));
    }

    builder
        .manage(MediaState::default())
        .manage(AppSettingsState::default())
        .manage(LocalNeteaseApiState::default())
        .manage(MediaProxyState::default())
        .manage(AppRuntimeState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_MENU_OPEN_ID => show_main_window(app),
            TRAY_MENU_COMPONENT_CONTROL_ID => {
                let _ = open_component_control_window(app);
            }
            TRAY_MENU_REFRESH_ID => refresh_main_window(app),
            TRAY_MENU_QUIT_ID => shutdown_app(app),
            _ => {}
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() != MAIN_WINDOW_LABEL {
                    return;
                }

                let runtime_state = window.app_handle().state::<AppRuntimeState>();
                if runtime_state.exit_requested.load(Ordering::SeqCst) {
                    let local_api_state = window.app_handle().state::<LocalNeteaseApiState>();
                    shutdown_local_netease_api_server(&local_api_state);
                    return;
                }

                api.prevent_close();
                hide_main_window_to_tray(window.app_handle());
            }
        })
        .setup(|app| {
            let app_handle = app.handle().clone();
            let start_hidden_to_tray = should_start_hidden_to_tray();

            wallpaper::set_log_app_handle(app_handle.clone());
            build_tray(&app_handle)?;

            let media_proxy_state = app.state::<MediaProxyState>();
            let _ = ensure_media_proxy_server(&media_proxy_state);

            if let Ok(settings) = load_app_settings_or_default(&app_handle) {
                if let Some(window) = app.get_webview_window("main") {
                    let width = settings.window.width.max(MIN_WINDOW_WIDTH) as f64;
                    let height = settings.window.height.max(MIN_WINDOW_HEIGHT) as f64;
                    let _ = window.set_size(Size::Logical(LogicalSize::new(width, height)));
                    if start_hidden_to_tray {
                        let _ = window.set_skip_taskbar(true);
                    }
                }

                let local_api_state = app.state::<LocalNeteaseApiState>();
                let _ = sync_local_netease_api_server_for_settings(
                    &app_handle,
                    &local_api_state,
                    &settings,
                );
            }

            if start_hidden_to_tray {
                hide_main_window_to_tray(&app_handle);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ensure_media_library,
            list_media_library,
            import_media_files,
            clear_media_library,
            delete_media_tracks,
            register_remote_track,
            save_song_config,
            cache_remote_audio_for_spectrum,
            clear_cached_spectrum_audio,
            analyze_local_audio_spectrum,
            analyze_local_audio_track,
            analyze_audio_alignment,
            ensure_app_settings,
            get_app_settings,
            save_app_settings,
            list_system_font_families,
            reset_app_settings,
            sync_local_netease_api_server,
            get_local_netease_api_server_status,
            get_media_proxy_server_status,
            enable_wallpaper_mode,
            open_immersive_wallpaper_window,
            open_component_dynamic_island_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
