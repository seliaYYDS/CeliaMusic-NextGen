use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use anyhow::{anyhow, Context};
use fontdb::Database;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

const SETTINGS_SCHEMA_VERSION: u32 = 8;
const DEFAULT_SETTINGS_FILE: &str = "app-settings.json";
pub const DEFAULT_WINDOW_WIDTH: u32 = 960;
pub const DEFAULT_WINDOW_HEIGHT: u32 = 600;
pub const MIN_WINDOW_WIDTH: u32 = 800;
pub const MIN_WINDOW_HEIGHT: u32 = 500;

pub struct AppSettingsState {
    write_lock: Mutex<()>,
}

impl Default for AppSettingsState {
    fn default() -> Self {
        Self {
            write_lock: Mutex::new(()),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsSnapshot {
    pub schema_version: u32,
    pub settings_path: String,
    pub settings: AppSettings,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
struct AppSettingsDocument {
    schema_version: u32,
    settings: AppSettings,
}

impl Default for AppSettingsDocument {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            settings: AppSettings::default(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AppSettings {
    pub appearance: AppearanceSettings,
    pub playback: PlaybackSettings,
    pub library: LibrarySettings,
    pub network: NetworkSettings,
    pub lyrics: LyricsSettings,
    pub shortcuts: ShortcutSettings,
    pub window: WindowSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            appearance: AppearanceSettings::default(),
            playback: PlaybackSettings::default(),
            library: LibrarySettings::default(),
            network: NetworkSettings::default(),
            lyrics: LyricsSettings::default(),
            shortcuts: ShortcutSettings::default(),
            window: WindowSettings::default(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct AppearanceSettings {
    pub language: String,
    pub font_family: String,
    pub font_weight: u16,
    pub theme_mode: String,
    pub color_scheme: String,
    pub follow_song_artwork_theme: bool,
    pub use_background_mv: bool,
    pub enable_background_mv_offset_correction: bool,
    pub background_mode: String,
    pub background_blur: u8,
    pub component_backdrop_blur: u8,
    pub background_dim: u8,
    pub background_image_path: String,
    pub background_image_opacity: u8,
    pub use_compact_mode: bool,
    pub show_album_artwork: bool,
    pub show_dynamic_island: bool,
    pub custom_theme_primary: String,
    pub custom_theme_secondary: String,
    pub custom_theme_surface: String,
    pub dynamic_island_style: String,
    pub dynamic_island_color_mode: String,
    pub dynamic_island_default_content: String,
    pub dynamic_island_position: String,
    pub dynamic_island_show_lyrics: bool,
    pub immersive_background_mode: String,
    pub immersive_background_animated: bool,
    pub immersive_background_resolution: u8,
    pub immersive_background_speed: u8,
    pub immersive_background_blur: u8,
    pub immersive_background_softness: u8,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            language: "zh-CN".to_string(),
            font_family: "system-ui".to_string(),
            font_weight: 400,
            theme_mode: "celia-default".to_string(),
            color_scheme: "light".to_string(),
            follow_song_artwork_theme: false,
            use_background_mv: false,
            enable_background_mv_offset_correction: false,
            background_mode: "theme".to_string(),
            background_blur: 18,
            component_backdrop_blur: 14,
            background_dim: 18,
            background_image_path: String::new(),
            background_image_opacity: 82,
            use_compact_mode: false,
            show_album_artwork: true,
            show_dynamic_island: false,
            custom_theme_primary: "#7aa2d6".to_string(),
            custom_theme_secondary: "#b7d7f2".to_string(),
            custom_theme_surface: "#eef3fa".to_string(),
            dynamic_island_style: "default".to_string(),
            dynamic_island_color_mode: "follow-theme".to_string(),
            dynamic_island_default_content: "time".to_string(),
            dynamic_island_position: "right".to_string(),
            dynamic_island_show_lyrics: false,
            immersive_background_mode: "flow".to_string(),
            immersive_background_animated: true,
            immersive_background_resolution: 72,
            immersive_background_speed: 112,
            immersive_background_blur: 24,
            immersive_background_softness: 58,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct PlaybackSettings {
    pub default_volume: u8,
    pub muted: bool,
    pub playback_mode: String,
    pub cache_mode: String,
    pub remember_queue: bool,
    pub remember_playback_position: bool,
    pub autoplay_on_launch: bool,
    pub song_transition_enabled: bool,
    pub song_transition_mode: String,
    pub song_transition_start_ms: u16,
    pub spectrum_enabled: bool,
    pub spectrum_position: String,
    pub spectrum_gain: u8,
    pub spectrum_smoothing: u8,
    pub spectrum_style: String,
    pub spectrum_animation: String,
    pub prefer_remote_streaming: bool,
    pub preferred_quality: String,
    pub resume_queue_track_ids: Vec<String>,
    pub resume_track_id: Option<String>,
    pub resume_track_position_ms: u32,
    pub resume_was_playing: bool,
}

impl Default for PlaybackSettings {
    fn default() -> Self {
        Self {
            default_volume: 68,
            muted: false,
            playback_mode: "ordered".to_string(),
            cache_mode: "stream".to_string(),
            remember_queue: true,
            remember_playback_position: true,
            autoplay_on_launch: false,
            song_transition_enabled: false,
            song_transition_mode: "simple-mix".to_string(),
            song_transition_start_ms: 4000,
            spectrum_enabled: false,
            spectrum_position: "timeline-top".to_string(),
            spectrum_gain: 110,
            spectrum_smoothing: 68,
            spectrum_style: "bars".to_string(),
            spectrum_animation: "smooth".to_string(),
            prefer_remote_streaming: false,
            preferred_quality: "high".to_string(),
            resume_queue_track_ids: Vec::new(),
            resume_track_id: None,
            resume_track_position_ms: 0,
            resume_was_playing: false,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct LibrarySettings {
    pub scan_directories: Vec<String>,
    pub watch_directories: bool,
    pub auto_import_artwork: bool,
    pub extract_embedded_artwork: bool,
}

impl Default for LibrarySettings {
    fn default() -> Self {
        Self {
            scan_directories: Vec::new(),
            watch_directories: false,
            auto_import_artwork: true,
            extract_embedded_artwork: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct NetworkSettings {
    pub enabled_sources: Vec<String>,
    pub use_local_api_server: bool,
    pub allow_metered_network: bool,
    pub prefer_online_metadata: bool,
    pub request_timeout_ms: u64,
    pub netease_api_base_url: String,
    pub netease_cookie: String,
    pub netease_proxy: String,
    pub netease_real_ip: String,
}

impl Default for NetworkSettings {
    fn default() -> Self {
        Self {
            enabled_sources: vec!["netease".to_string()],
            use_local_api_server: false,
            allow_metered_network: true,
            prefer_online_metadata: true,
            request_timeout_ms: 15000,
            netease_api_base_url: "http://127.0.0.1:3000".to_string(),
            netease_cookie: String::new(),
            netease_proxy: String::new(),
            netease_real_ip: String::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct LyricsSettings {
    pub delay_ms: i16,
    pub font_family: String,
    pub font_weight: u16,
    pub font_size: u8,
    pub line_spacing: u8,
    pub line_alignment: String,
    pub text_alignment: String,
    pub render_mode: String,
    pub progress_bar_preview: bool,
    pub text_shadow: bool,
    pub text_shadow_intensity: u8,
    pub text_shadow_definition: u8,
    pub glow: bool,
    pub glow_intensity: u8,
    pub glow_definition: u8,
    pub animation_speed: u8,
    pub line_animation_stagger_ms: u16,
    pub blur_range: u8,
    pub curve_amount: i16,
}

impl Default for LyricsSettings {
    fn default() -> Self {
        Self {
            delay_ms: 0,
            font_family: "system-ui".to_string(),
            font_weight: 800,
            font_size: 140,
            line_spacing: 130,
            line_alignment: "upper".to_string(),
            text_alignment: "left".to_string(),
            render_mode: "advanced".to_string(),
            progress_bar_preview: true,
            text_shadow: false,
            text_shadow_intensity: 100,
            text_shadow_definition: 72,
            glow: false,
            glow_intensity: 100,
            glow_definition: 68,
            animation_speed: 65,
            line_animation_stagger_ms: 50,
            blur_range: 52,
            curve_amount: 0,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct WindowSettings {
    pub width: u32,
    pub height: u32,
}

impl Default for WindowSettings {
    fn default() -> Self {
        Self {
            width: DEFAULT_WINDOW_WIDTH,
            height: DEFAULT_WINDOW_HEIGHT,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct ShortcutSettings {
    pub toggle_playback: Vec<String>,
    pub next_track: Vec<String>,
    pub previous_track: Vec<String>,
    pub stop_playback: Vec<String>,
    pub volume_up: Vec<String>,
    pub volume_down: Vec<String>,
    pub seek_forward: Vec<String>,
    pub seek_backward: Vec<String>,
    pub cycle_playback_mode: Vec<String>,
}

impl Default for ShortcutSettings {
    fn default() -> Self {
        Self {
            toggle_playback: Vec::new(),
            next_track: Vec::new(),
            previous_track: Vec::new(),
            stop_playback: Vec::new(),
            volume_up: Vec::new(),
            volume_down: Vec::new(),
            seek_forward: Vec::new(),
            seek_backward: Vec::new(),
            cycle_playback_mode: Vec::new(),
        }
    }
}

#[tauri::command]
pub fn ensure_app_settings(
    app: AppHandle,
    state: State<'_, AppSettingsState>,
) -> Result<AppSettingsSnapshot, String> {
    with_settings_mutation(&app, &state, |path, document| {
        Ok(snapshot_from_document(path, document))
    })
    .map_err(error_to_string)
}

#[tauri::command]
pub fn get_app_settings(
    app: AppHandle,
    state: State<'_, AppSettingsState>,
) -> Result<AppSettingsSnapshot, String> {
    ensure_app_settings(app, state)
}

#[tauri::command]
pub fn save_app_settings(
    app: AppHandle,
    state: State<'_, AppSettingsState>,
    settings: AppSettings,
) -> Result<AppSettingsSnapshot, String> {
    with_settings_mutation(&app, &state, |path, document| {
        document.schema_version = SETTINGS_SCHEMA_VERSION;
        document.settings = sanitize_settings(settings);
        Ok(snapshot_from_document(path, document))
    })
    .map_err(error_to_string)
}

#[tauri::command]
pub fn reset_app_settings(
    app: AppHandle,
    state: State<'_, AppSettingsState>,
) -> Result<AppSettingsSnapshot, String> {
    with_settings_mutation(&app, &state, |path, document| {
        document.schema_version = SETTINGS_SCHEMA_VERSION;
        document.settings = AppSettings::default();
        Ok(snapshot_from_document(path, document))
    })
    .map_err(error_to_string)
}

#[tauri::command]
pub fn list_system_font_families() -> Result<Vec<String>, String> {
    let mut database = Database::new();
    database.load_system_fonts();

    let mut families = BTreeSet::new();
    for face in database.faces() {
        for (family, _) in &face.families {
            let trimmed = family.trim();
            if !trimmed.is_empty() {
                families.insert(trimmed.to_string());
            }
        }
    }

    Ok(families.into_iter().collect())
}

pub fn load_app_settings_or_default(app: &AppHandle) -> anyhow::Result<AppSettings> {
    let settings_path = settings_file_path(app)?;
    let document = load_or_create_settings(&settings_path)?;
    Ok(document.settings)
}

fn with_settings_mutation<T>(
    app: &AppHandle,
    state: &State<'_, AppSettingsState>,
    mutator: impl FnOnce(&Path, &mut AppSettingsDocument) -> anyhow::Result<T>,
) -> anyhow::Result<T> {
    let _guard = state
        .write_lock
        .lock()
        .map_err(|_| anyhow!("Failed to acquire app settings lock"))?;

    let settings_path = settings_file_path(app)?;
    let mut document = load_or_create_settings(&settings_path)?;
    let result = mutator(&settings_path, &mut document)?;
    persist_settings(&settings_path, &document)?;
    Ok(result)
}

fn load_or_create_settings(path: &Path) -> anyhow::Result<AppSettingsDocument> {
    if path.exists() {
        let content = fs::read_to_string(path)
            .with_context(|| format!("Failed to read settings file at {}", path.display()))?;
        let mut document = serde_json::from_str::<AppSettingsDocument>(&content)
            .with_context(|| format!("Failed to parse settings file at {}", path.display()))?;
        let previous_schema_version = document.schema_version;
        document.schema_version = SETTINGS_SCHEMA_VERSION;
        document.settings = sanitize_settings(document.settings);
        migrate_settings_defaults(&mut document.settings, previous_schema_version);
        return Ok(document);
    }

    let document = AppSettingsDocument {
        schema_version: SETTINGS_SCHEMA_VERSION,
        settings: AppSettings::default(),
    };

    persist_settings(path, &document)?;
    Ok(document)
}

fn persist_settings(path: &Path, document: &AppSettingsDocument) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!("Failed to create settings directory {}", parent.display())
        })?;
    }

    let payload = serde_json::to_string_pretty(document)?;
    fs::write(path, payload)
        .with_context(|| format!("Failed to write settings file at {}", path.display()))?;
    Ok(())
}

fn snapshot_from_document(path: &Path, document: &AppSettingsDocument) -> AppSettingsSnapshot {
    AppSettingsSnapshot {
        schema_version: document.schema_version,
        settings_path: path.display().to_string(),
        settings: document.settings.clone(),
    }
}

fn settings_file_path(app: &AppHandle) -> anyhow::Result<PathBuf> {
    let app_dir = app
        .path()
        .app_data_dir()
        .context("Failed to resolve app data directory")?;
    Ok(app_dir.join(DEFAULT_SETTINGS_FILE))
}

fn sanitize_settings(mut settings: AppSettings) -> AppSettings {
    settings.playback.default_volume = settings.playback.default_volume.min(100);
    settings.playback.playback_mode = sanitize_limited_value(
        settings.playback.playback_mode,
        &["ordered", "repeat-all", "repeat-one", "shuffle"],
        "ordered",
    );
    settings.playback.cache_mode = sanitize_limited_value(
        settings.playback.cache_mode,
        &["stream", "complete"],
        "stream",
    );
    settings.playback.preferred_quality =
        sanitize_non_empty(settings.playback.preferred_quality, "high");
    settings.playback.song_transition_mode = sanitize_limited_value(
        settings.playback.song_transition_mode,
        &["simple-mix", "auto-mix"],
        "simple-mix",
    );
    settings.playback.song_transition_start_ms =
        settings.playback.song_transition_start_ms.clamp(1000, 12000);
    settings.playback.spectrum_position = sanitize_limited_value(
        settings.playback.spectrum_position,
        &[
            "sidebar-left",
            "timeline-top",
            "page-right",
            "dynamic-island",
            "page-top",
        ],
        "timeline-top",
    );
    settings.playback.spectrum_gain = settings.playback.spectrum_gain.clamp(50, 250);
    settings.playback.spectrum_smoothing = settings.playback.spectrum_smoothing.clamp(0, 95);
    settings.playback.spectrum_style = sanitize_limited_value(
        settings.playback.spectrum_style,
        &["bars", "line", "capsule"],
        "bars",
    );
    settings.playback.spectrum_animation = sanitize_limited_value(
        settings.playback.spectrum_animation,
        &["smooth", "pulse", "crisp"],
        "smooth",
    );
    settings.playback.resume_queue_track_ids = dedupe_strings(settings.playback.resume_queue_track_ids);
    settings.playback.resume_track_id = settings
        .playback
        .resume_track_id
        .take()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    settings.appearance.language = sanitize_non_empty(settings.appearance.language, "zh-CN");
    settings.appearance.font_family = sanitize_non_empty(settings.appearance.font_family, "system-ui");
    settings.appearance.theme_mode =
        sanitize_non_empty(settings.appearance.theme_mode, "celia-default");
    settings.appearance.color_scheme =
        sanitize_limited_value(settings.appearance.color_scheme, &["light", "dark"], "light");
    settings.appearance.background_mode = sanitize_limited_value(
        settings.appearance.background_mode,
        &["theme", "custom"],
        "theme",
    );
    settings.appearance.background_blur = settings.appearance.background_blur.min(48);
    settings.appearance.component_backdrop_blur =
        settings.appearance.component_backdrop_blur.min(32);
    settings.appearance.background_dim = settings.appearance.background_dim.min(100);
    settings.appearance.background_image_path =
        sanitize_non_empty_or_empty(settings.appearance.background_image_path);
    settings.appearance.background_image_opacity =
        settings.appearance.background_image_opacity.min(100);
    settings.appearance.custom_theme_primary =
        sanitize_hex_color(settings.appearance.custom_theme_primary, "#7aa2d6");
    settings.appearance.custom_theme_secondary =
        sanitize_hex_color(settings.appearance.custom_theme_secondary, "#b7d7f2");
    settings.appearance.custom_theme_surface =
        sanitize_hex_color(settings.appearance.custom_theme_surface, "#eef3fa");
    settings.appearance.dynamic_island_style = sanitize_limited_value(
        settings.appearance.dynamic_island_style,
        &["default", "soft", "solid"],
        "default",
    );
    settings.appearance.dynamic_island_color_mode = sanitize_limited_value(
        settings.appearance.dynamic_island_color_mode,
        &["follow-theme", "primary", "secondary"],
        "follow-theme",
    );
    settings.appearance.dynamic_island_default_content = sanitize_limited_value(
        settings.appearance.dynamic_island_default_content,
        &["time", "date", "datetime"],
        "time",
    );
    settings.appearance.dynamic_island_position = sanitize_limited_value(
        settings.appearance.dynamic_island_position,
        &["center", "left", "right"],
        "center",
    );
    settings.appearance.immersive_background_mode = sanitize_limited_value(
        settings.appearance.immersive_background_mode,
        &[
            "palette-solid",
            "palette-gradient",
            "app-background",
            "background-mv",
            "cover-blur",
            "flow",
            "static",
        ],
        "palette-gradient",
    );
    if settings.appearance.immersive_background_mode == "static" {
        settings.appearance.immersive_background_mode = "palette-gradient".to_string();
    }
    settings.appearance.immersive_background_resolution =
        settings.appearance.immersive_background_resolution.clamp(45, 100);
    settings.appearance.immersive_background_speed =
        settings.appearance.immersive_background_speed.clamp(40, 180);
    settings.appearance.immersive_background_blur =
        settings.appearance.immersive_background_blur.clamp(0, 36);
    settings.appearance.immersive_background_softness =
        settings.appearance.immersive_background_softness.clamp(0, 100);
    settings.appearance.font_weight = settings.appearance.font_weight.clamp(100, 900);
    settings.network.request_timeout_ms = settings.network.request_timeout_ms.max(1000);
    settings.library.scan_directories = dedupe_strings(settings.library.scan_directories);
    settings.network.enabled_sources = sanitize_enabled_sources(settings.network.enabled_sources);
    settings.network.netease_api_base_url = sanitize_url_or_fallback(
        settings.network.netease_api_base_url,
        "http://127.0.0.1:3000",
    );
    settings.network.netease_cookie = settings.network.netease_cookie.trim().to_string();
    settings.network.netease_proxy = settings.network.netease_proxy.trim().to_string();
    settings.network.netease_real_ip = settings.network.netease_real_ip.trim().to_string();
    settings.lyrics.delay_ms = settings.lyrics.delay_ms.clamp(-1000, 1000);
    settings.lyrics.font_family = sanitize_non_empty(settings.lyrics.font_family, "system-ui");
    settings.lyrics.font_weight = settings.lyrics.font_weight.clamp(100, 900);
    settings.lyrics.font_size = settings.lyrics.font_size.clamp(80, 160);
    settings.lyrics.line_spacing = settings.lyrics.line_spacing.clamp(80, 180);
    settings.lyrics.line_alignment = match settings.lyrics.line_alignment.as_str() {
        "upper" => "upper".to_string(),
        _ => "center".to_string(),
    };
    settings.lyrics.text_alignment = match settings.lyrics.text_alignment.as_str() {
        "center" => "center".to_string(),
        "right" => "right".to_string(),
        _ => "left".to_string(),
    };
    settings.lyrics.render_mode = match settings.lyrics.render_mode.as_str() {
        "simple" => "simple".to_string(),
        "balanced" => "balanced".to_string(),
        _ => "advanced".to_string(),
    };
    settings.lyrics.text_shadow_intensity = settings.lyrics.text_shadow_intensity.clamp(0, 200);
    settings.lyrics.text_shadow_definition = settings.lyrics.text_shadow_definition.clamp(0, 100);
    settings.lyrics.glow_intensity = settings.lyrics.glow_intensity.clamp(0, 200);
    settings.lyrics.glow_definition = settings.lyrics.glow_definition.clamp(0, 100);
    settings.lyrics.animation_speed = settings.lyrics.animation_speed.clamp(50, 200);
    settings.lyrics.line_animation_stagger_ms = settings.lyrics.line_animation_stagger_ms.clamp(0, 240);
    settings.lyrics.blur_range = settings.lyrics.blur_range.clamp(0, 100);
    settings.lyrics.curve_amount = settings.lyrics.curve_amount.clamp(-100, 100);
    settings.shortcuts.toggle_playback = dedupe_strings(settings.shortcuts.toggle_playback);
    settings.shortcuts.next_track = dedupe_strings(settings.shortcuts.next_track);
    settings.shortcuts.previous_track = dedupe_strings(settings.shortcuts.previous_track);
    settings.shortcuts.stop_playback = dedupe_strings(settings.shortcuts.stop_playback);
    settings.shortcuts.volume_up = dedupe_strings(settings.shortcuts.volume_up);
    settings.shortcuts.volume_down = dedupe_strings(settings.shortcuts.volume_down);
    settings.shortcuts.seek_forward = dedupe_strings(settings.shortcuts.seek_forward);
    settings.shortcuts.seek_backward = dedupe_strings(settings.shortcuts.seek_backward);
    settings.shortcuts.cycle_playback_mode = dedupe_strings(settings.shortcuts.cycle_playback_mode);
    settings.window.width = settings.window.width.max(MIN_WINDOW_WIDTH);
    settings.window.height = settings.window.height.max(MIN_WINDOW_HEIGHT);
    settings
}

fn migrate_settings_defaults(settings: &mut AppSettings, previous_schema_version: u32) {
    if previous_schema_version >= 8 {
        return;
    }

    if settings.appearance.show_dynamic_island {
        settings.appearance.show_dynamic_island = false;
    }

    if settings.appearance.dynamic_island_position == "center" {
        settings.appearance.dynamic_island_position = "right".to_string();
    }

    if settings.lyrics.line_alignment == "center" {
        settings.lyrics.line_alignment = "upper".to_string();
    }

    if settings.lyrics.font_size == 100 {
        settings.lyrics.font_size = 140;
    }

    if settings.lyrics.line_spacing == 100 {
        settings.lyrics.line_spacing = 130;
    }

    if settings.lyrics.curve_amount == 24 {
        settings.lyrics.curve_amount = 0;
    }

    if settings.lyrics.animation_speed == 100 {
        settings.lyrics.animation_speed = 65;
    }

    if settings.lyrics.line_animation_stagger_ms == 100 {
        settings.lyrics.line_animation_stagger_ms = 50;
    }
}

fn sanitize_non_empty(value: String, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn sanitize_non_empty_or_empty(value: String) -> String {
    value.trim().to_string()
}

fn sanitize_url_or_fallback(value: String, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.trim_end_matches('/').to_string()
    } else {
        fallback.to_string()
    }
}

fn sanitize_limited_value(value: String, allowed: &[&str], fallback: &str) -> String {
    let trimmed = value.trim();
    if allowed.iter().any(|candidate| *candidate == trimmed) {
        trimmed.to_string()
    } else {
        fallback.to_string()
    }
}

fn sanitize_hex_color(value: String, fallback: &str) -> String {
    let trimmed = value.trim();
    let is_valid = trimmed.len() == 7
        && trimmed.starts_with('#')
        && trimmed
            .chars()
            .skip(1)
            .all(|character| character.is_ascii_hexdigit());

    if is_valid {
        trimmed.to_ascii_lowercase()
    } else {
        fallback.to_string()
    }
}

fn dedupe_strings(values: Vec<String>) -> Vec<String> {
    let mut deduped = Vec::new();

    for value in values {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }

        if deduped.iter().any(|existing| existing == trimmed) {
            continue;
        }

        deduped.push(trimmed.to_string());
    }

    deduped
}

fn sanitize_enabled_sources(values: Vec<String>) -> Vec<String> {
    let deduped = dedupe_strings(values);
    let has_netease = deduped
        .iter()
        .any(|value| value.eq_ignore_ascii_case("netease"));

    if has_netease {
        vec!["netease".to_string()]
    } else {
        Vec::new()
    }
}

fn error_to_string(error: anyhow::Error) -> String {
    format!("{error:#}")
}
