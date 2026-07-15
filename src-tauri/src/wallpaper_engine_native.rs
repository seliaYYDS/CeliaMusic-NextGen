use serde::Serialize;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

use crate::wallpaper_engine::{inspect_project, WallpaperEngineProjectKind};
use crate::wallpaper_engine_native_renderer::{
    NativeSceneRendererConfig, NativeSceneRendererSession, PlatformNativeSceneRendererBackend,
};
use crate::wallpaper_engine_native_windows::resolve_native_scene_host_window;

pub const WALLPAPER_ENGINE_NATIVE_STATUS_EVENT: &str = "wallpaper-engine-native-status";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperEngineNativeStatus {
    pub backend: String,
    pub scene_renderer_ready: bool,
    pub active_scene_folder: Option<String>,
    pub active_scene_window_label: Option<String>,
    pub active_scene_window_hwnd: Option<isize>,
    pub active_scene_width: Option<u32>,
    pub active_scene_height: Option<u32>,
    pub last_error: Option<String>,
}

#[derive(Default)]
pub struct WallpaperEngineNativeState {
    inner: Mutex<WallpaperEngineNativeStateInner>,
}

#[derive(Default)]
struct WallpaperEngineNativeStateInner {
    active_scene_folder: Option<String>,
    active_scene_window_label: Option<String>,
    active_scene_window_hwnd: Option<isize>,
    active_scene_width: Option<u32>,
    active_scene_height: Option<u32>,
    last_error: Option<String>,
    scene_session: Option<NativeSceneRendererSession>,
}

impl WallpaperEngineNativeState {
    fn status(&self) -> WallpaperEngineNativeStatus {
        let inner = self.inner.lock().expect("wallpaper engine native state poisoned");
        WallpaperEngineNativeStatus {
            backend: "wgpu-child-surface".to_string(),
            scene_renderer_ready: inner.scene_session.is_some(),
            active_scene_folder: inner.active_scene_folder.clone(),
            active_scene_window_label: inner.active_scene_window_label.clone(),
            active_scene_window_hwnd: inner.active_scene_window_hwnd,
            active_scene_width: inner.active_scene_width,
            active_scene_height: inner.active_scene_height,
            last_error: inner.last_error.clone(),
        }
    }

    fn clear_active_scene(&self) -> WallpaperEngineNativeStatus {
        let mut inner = self.inner.lock().expect("wallpaper engine native state poisoned");
        if let Some(mut session) = inner.scene_session.take() {
            if let Err(error) = session.stop() {
                inner.last_error = Some(error.to_string());
            }
        }
        inner.active_scene_folder = None;
        inner.active_scene_window_label = None;
        inner.active_scene_window_hwnd = None;
        inner.active_scene_width = None;
        inner.active_scene_height = None;
        WallpaperEngineNativeStatus {
            backend: "wgpu-child-surface".to_string(),
            scene_renderer_ready: false,
            active_scene_folder: None,
            active_scene_window_label: None,
            active_scene_window_hwnd: None,
            active_scene_width: None,
            active_scene_height: None,
            last_error: inner.last_error.clone(),
        }
    }

    fn set_error(&self, error: String) -> WallpaperEngineNativeStatus {
        let mut inner = self.inner.lock().expect("wallpaper engine native state poisoned");
        inner.last_error = Some(error.clone());
        WallpaperEngineNativeStatus {
            backend: "wgpu-child-surface".to_string(),
            scene_renderer_ready: false,
            active_scene_folder: inner.active_scene_folder.clone(),
            active_scene_window_label: inner.active_scene_window_label.clone(),
            active_scene_window_hwnd: inner.active_scene_window_hwnd,
            active_scene_width: inner.active_scene_width,
            active_scene_height: inner.active_scene_height,
            last_error: Some(error),
        }
    }

    fn start_scene_session(
        &self,
        folder_path: String,
        host_window_label: String,
        host_window_hwnd: isize,
        host_width: u32,
        host_height: u32,
    ) -> Result<WallpaperEngineNativeStatus, String> {
        let mut inner = self.inner.lock().expect("wallpaper engine native state poisoned");

        if let Some(mut session) = inner.scene_session.take() {
            if let Err(error) = session.stop() {
                inner.last_error = Some(error.to_string());
            }
        }

        let config = NativeSceneRendererConfig {
            folder_path: folder_path.clone(),
            host_window_label: host_window_label.clone(),
            host_window_hwnd,
            host_width,
            host_height,
        };

        let session = NativeSceneRendererSession::start(config, PlatformNativeSceneRendererBackend::create)
            .map_err(|error| error.to_string())?;

        inner.scene_session = Some(session);
        inner.active_scene_folder = Some(folder_path);
        inner.active_scene_window_label = Some(host_window_label);
        inner.active_scene_window_hwnd = Some(host_window_hwnd);
        inner.active_scene_width = Some(host_width);
        inner.active_scene_height = Some(host_height);
        if inner
            .last_error
            .as_deref()
            .is_some_and(|message| message.contains("native renderer worker panicked while stopping"))
        {
            inner.last_error = None;
        }

        Ok(WallpaperEngineNativeStatus {
            backend: "wgpu-child-surface".to_string(),
            scene_renderer_ready: true,
            active_scene_folder: inner.active_scene_folder.clone(),
            active_scene_window_label: inner.active_scene_window_label.clone(),
            active_scene_window_hwnd: inner.active_scene_window_hwnd,
            active_scene_width: inner.active_scene_width,
            active_scene_height: inner.active_scene_height,
            last_error: None,
        })
    }
}

fn emit_native_status(app: &AppHandle, status: &WallpaperEngineNativeStatus) {
    let _ = app.emit(WALLPAPER_ENGINE_NATIVE_STATUS_EVENT, status);
    if let Some(window_label) = &status.active_scene_window_label {
        if let Some(window) = app.get_webview_window(window_label) {
            let _ = window.emit(WALLPAPER_ENGINE_NATIVE_STATUS_EVENT, status);
        }
    }
}

#[tauri::command]
pub fn get_wallpaper_engine_native_status(
    app: AppHandle,
    state: tauri::State<WallpaperEngineNativeState>,
) -> Result<WallpaperEngineNativeStatus, String> {
    let status = state.status();
    emit_native_status(&app, &status);
    Ok(status)
}

#[tauri::command]
pub fn activate_wallpaper_engine_native_scene(
    app: AppHandle,
    state: tauri::State<WallpaperEngineNativeState>,
    folder_path: String,
    window_label: String,
) -> Result<WallpaperEngineNativeStatus, String> {
    let descriptor = inspect_project(std::path::Path::new(&folder_path)).map_err(|error| error.to_string())?;
    if descriptor.wallpaper_type != WallpaperEngineProjectKind::Scene {
        let status = state.set_error(format!(
            "native scene renderer can only be activated for scene wallpapers, got `{}`",
            descriptor.raw_type
        ));
        emit_native_status(&app, &status);
        return Err(status
            .last_error
            .clone()
            .unwrap_or_else(|| "failed to activate native scene renderer".to_string()));
    }

    let host_window = app
        .get_webview_window(&window_label)
        .ok_or_else(|| format!("wallpaper host window `{window_label}` was not found"))?;
    let host_info = resolve_native_scene_host_window(&host_window).map_err(|error| error.to_string())?;

    let status = state.start_scene_session(
        folder_path,
        host_info.window_label,
        host_info.hwnd,
        host_info.width,
        host_info.height,
    )?;
    emit_native_status(&app, &status);
    Ok(status)
}

#[tauri::command]
pub fn deactivate_wallpaper_engine_native_scene(
    app: AppHandle,
    state: tauri::State<WallpaperEngineNativeState>,
) -> Result<WallpaperEngineNativeStatus, String> {
    let status = state.clear_active_scene();
    emit_native_status(&app, &status);
    Ok(status)
}
