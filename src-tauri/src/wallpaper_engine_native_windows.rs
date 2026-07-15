use anyhow::{anyhow, Result};
use tauri::WebviewWindow;

#[cfg(windows)]
use windows::{
    Win32::{
        Foundation::RECT,
        UI::WindowsAndMessaging::GetClientRect,
    },
};

#[derive(Debug, Clone)]
pub struct NativeSceneHostWindowInfo {
    pub window_label: String,
    pub hwnd: isize,
    pub width: u32,
    pub height: u32,
}

#[cfg(windows)]
pub fn resolve_native_scene_host_window<R: tauri::Runtime>(
    window: &WebviewWindow<R>,
) -> Result<NativeSceneHostWindowInfo> {
    let hwnd = window
        .hwnd()
        .map_err(|error| anyhow!("failed to resolve wallpaper host HWND: {error}"))?;

    let mut rect = RECT::default();
    unsafe {
        GetClientRect(hwnd, &mut rect)
            .map_err(|error| anyhow!("failed to query wallpaper host client rect: {error}"))?;
    }

    let width = (rect.right - rect.left).max(1) as u32;
    let height = (rect.bottom - rect.top).max(1) as u32;

    Ok(NativeSceneHostWindowInfo {
        window_label: window.label().to_string(),
        hwnd: hwnd.0 as isize,
        width,
        height,
    })
}

#[cfg(not(windows))]
pub fn resolve_native_scene_host_window<R: tauri::Runtime>(
    window: &WebviewWindow<R>,
) -> Result<NativeSceneHostWindowInfo> {
    Ok(NativeSceneHostWindowInfo {
        window_label: window.label().to_string(),
        hwnd: 0,
        width: 1,
        height: 1,
    })
}
