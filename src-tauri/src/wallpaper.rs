use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use std::sync::OnceLock;
use tauri::{Emitter, WebviewWindow};
use std::{thread, time::Duration};

const WALLPAPER_LOG_EVENT: &str = "wallpaper-log";
const MAIN_WINDOW_LABEL: &str = "main";

static WALLPAPER_LOG_APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

#[derive(Clone, Serialize)]
struct WallpaperLogPayload {
    message: String,
}

pub fn set_log_app_handle(app_handle: tauri::AppHandle) {
    let _ = WALLPAPER_LOG_APP_HANDLE.set(app_handle);
}

fn log_wallpaper(message: &str) {
    eprintln!("[wallpaper] {message}");
    if let Some(app_handle) = WALLPAPER_LOG_APP_HANDLE.get() {
        let _ = app_handle.emit_to(
            MAIN_WINDOW_LABEL,
            WALLPAPER_LOG_EVENT,
            WallpaperLogPayload {
                message: message.to_string(),
            },
        );
    }
}

#[cfg(windows)]
use windows::{
    core::{w, BOOL, PCWSTR},
    Win32::{
        Foundation::{HWND, LPARAM, WPARAM},
        Graphics::Dwm::{
            DwmSetWindowAttribute, DWM_WINDOW_CORNER_PREFERENCE, DWMWA_WINDOW_CORNER_PREFERENCE,
            DWMWCP_DONOTROUND,
        },
        UI::WindowsAndMessaging::{
            EnumWindows, FindWindowExW, FindWindowW, GetSystemMetrics,
            GetWindowLongPtrW, SendMessageTimeoutW, SetWindowLongPtrW,
            SetWindowPos, ShowWindow, GWL_EXSTYLE, GWL_STYLE, HWND_BOTTOM,
            SEND_MESSAGE_TIMEOUT_FLAGS, SET_WINDOW_POS_FLAGS, SHOW_WINDOW_CMD,
            SMTO_NORMAL, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
            SM_YVIRTUALSCREEN, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_SHOWWINDOW,
            SW_HIDE, SW_SHOW, SW_SHOWNORMAL, WS_CHILD, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
            WS_OVERLAPPEDWINDOW, WS_POPUP, WS_VISIBLE,
        },
    },
};
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::SetParent as SetParentSys;

#[cfg(windows)]
const PROGMAN_SPAWN_WORKERW_MESSAGE: u32 = 0x052C;

#[cfg(windows)]
unsafe extern "system" fn find_workerw_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let shell_view = FindWindowExW(
        Some(hwnd),
        None,
        w!("SHELLDLL_DefView"),
        PCWSTR::null(),
    );

    if shell_view.is_ok() {
        log_wallpaper(&format!("found SHELLDLL_DefView under hwnd={:?}", hwnd.0));
        if let Ok(workerw) = FindWindowExW(None, Some(hwnd), w!("WorkerW"), PCWSTR::null()) {
            let workerw_slot = lparam.0 as *mut HWND;
            if !workerw_slot.is_null() {
                *workerw_slot = workerw;
            }
            log_wallpaper(&format!("selected WorkerW host hwnd={:?}", workerw.0));
            return BOOL(0);
        }
    }

    BOOL(1)
}

#[cfg(windows)]
fn resolve_desktop_host_window() -> Result<HWND> {
    unsafe {
        log_wallpaper("resolving desktop host window");
        let progman = FindWindowW(w!("Progman"), PCWSTR::null())
            .context("failed to locate the Windows desktop manager window")?;
        log_wallpaper(&format!("resolved Progman hwnd={:?}", progman.0));
        let mut send_result = 0usize;
        let _ = SendMessageTimeoutW(
            progman,
            PROGMAN_SPAWN_WORKERW_MESSAGE,
            WPARAM(0),
            LPARAM(0),
            SEND_MESSAGE_TIMEOUT_FLAGS(SMTO_NORMAL.0),
            1000,
            Some(&mut send_result as *mut usize),
        );
        log_wallpaper(&format!(
            "sent Progman worker spawn message, result={send_result}"
        ));

        if let Ok(progman_defview) = FindWindowExW(
            Some(progman),
            None,
            w!("SHELLDLL_DefView"),
            PCWSTR::null(),
        ) {
            log_wallpaper(&format!(
                "found SHELLDLL_DefView directly under Progman hwnd={:?}",
                progman_defview.0
            ));

            if let Ok(child_workerw) = FindWindowExW(
                Some(progman),
                None,
                w!("WorkerW"),
                PCWSTR::null(),
            ) {
                log_wallpaper(&format!(
                    "using child WorkerW under Progman hwnd={:?}",
                    child_workerw.0
                ));
                return Ok(child_workerw);
            }

            log_wallpaper("no child WorkerW found under Progman");
        }

        let mut workerw = HWND::default();
        EnumWindows(
            Some(find_workerw_window),
            LPARAM((&mut workerw as *mut HWND) as isize),
        )
        .context("failed to enumerate desktop host windows")?;

        if !workerw.0.is_null() {
            log_wallpaper(&format!("using WorkerW host hwnd={:?}", workerw.0));
            Ok(workerw)
        } else {
            log_wallpaper("WorkerW not found, falling back to Progman");
            Ok(progman)
        }
    }
}

#[cfg(windows)]
fn wait_for_window_hwnd<R: tauri::Runtime>(window: &WebviewWindow<R>) -> Result<HWND> {
    let mut last_error = None;
    log_wallpaper(&format!(
        "waiting for wallpaper HWND, label={}",
        window.label()
    ));

    for attempt in 1..=40 {
        match window.hwnd() {
            Ok(hwnd) => {
                log_wallpaper(&format!(
                    "resolved wallpaper HWND on attempt {attempt}: {:?}",
                    hwnd.0
                ));
                return Ok(hwnd);
            }
            Err(error) => {
                log_wallpaper(&format!(
                    "wallpaper HWND not ready on attempt {attempt}: {error}"
                ));
                last_error = Some(error);
                thread::sleep(Duration::from_millis(50));
            }
        }
    }

    let error = last_error
        .map(|error| anyhow!(error.to_string()))
        .unwrap_or_else(|| anyhow!("window handle is not ready yet"));

    Err(error).context("failed to resolve wallpaper window handle")
}

#[cfg(windows)]
fn attach_window_to_desktop<R: tauri::Runtime>(window: &WebviewWindow<R>, hwnd: HWND) -> Result<()> {
    log_wallpaper(&format!("attaching wallpaper window hwnd={:?}", hwnd.0));
    let desktop_host = resolve_desktop_host_window()?;
    log_wallpaper(&format!("desktop host hwnd={:?}", desktop_host.0));

    unsafe {
        let corner_preference = DWM_WINDOW_CORNER_PREFERENCE(DWMWCP_DONOTROUND.0);
        match DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &corner_preference as *const DWM_WINDOW_CORNER_PREFERENCE as *const core::ffi::c_void,
            std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
        ) {
            Ok(()) => {
                log_wallpaper("disabled wallpaper window rounded corners");
            }
            Err(error) => {
                log_wallpaper(&format!(
                    "failed to disable wallpaper window rounded corners (ignored): {error}"
                ));
            }
        }

        let current_style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
        let current_ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        log_wallpaper(&format!(
            "current styles: style=0x{current_style:08x}, ex_style=0x{current_ex_style:08x}"
        ));
        let next_style =
            ((current_style & !(WS_OVERLAPPEDWINDOW.0 | WS_POPUP.0)) | WS_CHILD.0 | WS_VISIBLE.0)
                as isize;
        let next_ex_style = ((current_ex_style & !WS_EX_APPWINDOW.0 & !WS_EX_TOOLWINDOW.0)
            | WS_EX_NOACTIVATE.0) as isize;

        SetWindowLongPtrW(hwnd, GWL_STYLE, next_style);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next_ex_style);
        log_wallpaper(&format!(
            "updated styles: style=0x{:08x}, ex_style=0x{:08x}",
            next_style as u32,
            next_ex_style as u32
        ));
        let previous_parent = SetParentSys(hwnd.0 as _, desktop_host.0 as _);
        if previous_parent.is_null() {
            let last_error = std::io::Error::last_os_error();
            if last_error.raw_os_error().unwrap_or_default() != 0 {
                return Err(last_error)
                    .context("failed to attach the wallpaper window to the desktop host");
            }
        }
        log_wallpaper(&format!(
            "SetParent completed, previous_parent={previous_parent:?}"
        ));

        let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        log_wallpaper(&format!(
            "virtual screen bounds: x={x}, y={y}, width={width}, height={height}"
        ));
        let flags = SET_WINDOW_POS_FLAGS(
            SWP_SHOWWINDOW.0 | SWP_FRAMECHANGED.0 | SWP_NOACTIVATE.0,
        );

        SetWindowPos(hwnd, Some(HWND_BOTTOM), x, y, width, height, flags)
            .context("failed to resize the wallpaper window to the desktop bounds")?;
        let _ = ShowWindow(hwnd, SHOW_WINDOW_CMD(SW_SHOW.0));
        log_wallpaper("SetWindowPos + ShowWindow completed");

        if let Ok(defview) = FindWindowExW(
            Some(FindWindowW(w!("Progman"), PCWSTR::null())
                .context("failed to locate Progman during DefView refresh")?),
            None,
            w!("SHELLDLL_DefView"),
            PCWSTR::null(),
        ) {
            log_wallpaper(&format!(
                "forcing SHELLDLL_DefView redraw hwnd={:?}",
                defview.0
            ));
            let _ = ShowWindow(defview, SHOW_WINDOW_CMD(SW_HIDE.0));
            let _ = ShowWindow(defview, SHOW_WINDOW_CMD(SW_SHOWNORMAL.0));
            log_wallpaper("SHELLDLL_DefView redraw completed");
        }
    }

    window
        .set_always_on_top(false)
        .context("failed to clear top-most state for the wallpaper window")?;
    log_wallpaper("cleared always-on-top state");
    window
        .set_always_on_bottom(true)
        .context("failed to push the wallpaper window to the bottom layer")?;
    log_wallpaper("enabled always-on-bottom state");
    window
        .set_skip_taskbar(true)
        .context("failed to hide the wallpaper window from the taskbar")?;
    log_wallpaper("enabled skip-taskbar");
    window
        .set_focusable(false)
        .context("failed to disable wallpaper window focus")?;
    log_wallpaper("disabled focus");
    window
        .set_ignore_cursor_events(true)
        .context("failed to disable wallpaper window cursor events")?;
    log_wallpaper("enabled ignore-cursor-events");
    window
        .show()
        .context("failed to show the wallpaper window")?;
    log_wallpaper("wallpaper window show() completed");

    Ok(())
}

#[cfg(not(windows))]
fn attach_window_to_desktop<R: tauri::Runtime>(_window: &WebviewWindow<R>) -> Result<()> {
    Err(anyhow!("Wallpaper mode is only available on Windows."))
}

pub fn enable_wallpaper_mode<R: tauri::Runtime>(window: WebviewWindow<R>) -> Result<()> {
    log_wallpaper(&format!(
        "enable_wallpaper_mode requested for label={}",
        window.label()
    ));
    #[cfg(windows)]
    let hwnd_value = wait_for_window_hwnd(&window)?.0 as isize;
    let (tx, rx) = std::sync::mpsc::channel();
    let window_for_main_thread = window.clone();

    window
        .run_on_main_thread(move || {
            log_wallpaper("entered main-thread wallpaper setup");
            #[cfg(windows)]
            let result = attach_window_to_desktop(
                &window_for_main_thread,
                HWND(hwnd_value as *mut core::ffi::c_void),
            );
            #[cfg(not(windows))]
            let result = attach_window_to_desktop(&window_for_main_thread);
            if let Err(error) = &result {
                log_wallpaper(&format!("wallpaper setup failed on main thread: {error:#}"));
            } else {
                log_wallpaper("wallpaper setup completed on main thread");
            }
            let _ = tx.send(result.map_err(|error| error.to_string()));
        })
        .context("failed to schedule the wallpaper window setup on the main thread")?;

    let wallpaper_setup_result = rx
        .recv()
        .map_err(|error| anyhow!("failed to receive the wallpaper setup result: {error}"))?;
    wallpaper_setup_result.map_err(|error| anyhow!(error))?;
    log_wallpaper("enable_wallpaper_mode finished successfully");

    Ok(())
}
