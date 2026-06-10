use std::{
    collections::hash_map::DefaultHasher,
    collections::BTreeMap,
    collections::HashSet,
    fs,
    hash::{Hash, Hasher},
    io,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{anyhow, Context};
use crate::settings::{load_app_settings_or_default, LibrarySettings};
use image::ImageReader;
use lofty::{
    file::TaggedFileExt,
    prelude::{AudioFile, ItemKey},
    probe::Probe,
    tag::Accessor,
};
use rustfft::{num_complex::Complex32, FftPlanner};
use serde::{Deserialize, Serialize};
use symphonia::core::{
    audio::SampleBuffer,
    codecs::{DecoderOptions, CODEC_TYPE_NULL},
    errors::Error as SymphoniaError,
    formats::FormatOptions,
    io::MediaSourceStream,
    meta::MetadataOptions,
    probe::Hint,
};
use symphonia::default::{get_codecs, get_probe};
use tauri::{AppHandle, Manager, State};
use url::Url;
use uuid::Uuid;

const LIBRARY_SCHEMA_VERSION: u32 = 1;
const DEFAULT_LIBRARY_FILE: &str = "media-library.json";
const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "wma", "aiff", "alac",
];
const MEDIA_CONTAINER_EXTENSIONS: &[&str] = &["mp4", "m4v", "mov", "webm", "ogv"];
const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "bmp", "gif"];
const ARTWORK_CANDIDATES: &[&str] = &[
    "cover", "folder", "front", "album", "artwork", "thumb", "thumbnail",
];

pub struct MediaState {
    write_lock: Mutex<()>,
}

impl Default for MediaState {
    fn default() -> Self {
        Self {
            write_lock: Mutex::new(()),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MediaLibrarySnapshot {
    pub schema_version: u32,
    pub library_path: String,
    pub tracks: Vec<TrackRecord>,
    pub artworks: Vec<ArtworkRecord>,
    pub imported_at_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MediaLibraryDocument {
    schema_version: u32,
    tracks: Vec<TrackRecord>,
    artworks: Vec<ArtworkRecord>,
    imported_at_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TrackRecord {
    pub id: String,
    pub source: MediaSource,
    pub playback: PlaybackSource,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub duration_ms: Option<u64>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub artwork_ids: Vec<String>,
    pub config: SongConfig,
    pub imported_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MediaSource {
    LocalFile(LocalFileSource),
    RemoteStream(RemoteStreamSource),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileSource {
    pub path: String,
    pub file_name: String,
    pub extension: Option<String>,
    pub file_size_bytes: Option<u64>,
    pub modified_at_ms: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStreamSource {
    pub url: String,
    pub mime_type: Option<String>,
    pub headers: BTreeMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSource {
    pub mode: PlaybackMode,
    pub primary_uri: String,
    pub fallback_uri: Option<String>,
    #[serde(default)]
    pub fallback_uris: Vec<String>,
    pub cache_key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackMode {
    LocalFile,
    RemoteStream,
    Hybrid,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ArtworkRecord {
    pub id: String,
    pub source: ArtworkSource,
    pub mime_type: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub imported_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ArtworkSource {
    LocalFile(LocalFileSource),
    RemoteUrl { url: String },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct SongConfig {
    pub preferred_artwork_id: Option<String>,
    pub lyrics_offset_ms: i64,
    pub background_mv_offset_ms: i64,
    pub trim_start_ms: u64,
    pub trim_end_ms: Option<u64>,
    pub loudness_gain_db: f32,
    pub replay_gain_enabled: bool,
    pub last_position_ms: u64,
    pub normalize_volume: bool,
}

impl Default for SongConfig {
    fn default() -> Self {
        Self {
            preferred_artwork_id: None,
            lyrics_offset_ms: 0,
            background_mv_offset_ms: 0,
            trim_start_ms: 0,
            trim_end_ms: None,
            loudness_gain_db: 0.0,
            replay_gain_enabled: true,
            last_position_ms: 0,
            normalize_volume: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportMediaRequest {
    pub paths: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTrackDraft {
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub duration_ms: Option<u64>,
    pub genre: Option<String>,
    pub stream_url: String,
    pub artwork_url: Option<String>,
    pub fallback_local_path: Option<String>,
    pub fallback_urls: Option<Vec<String>>,
    pub mime_type: Option<String>,
    pub headers: Option<BTreeMap<String, String>>,
    pub cache_key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SongConfigPatch {
    pub track_id: String,
    pub config: SongConfig,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpectrumCacheRequest {
    pub url: String,
    pub cache_key: Option<String>,
    pub mime_type: Option<String>,
    pub headers: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSpectrumAnalysisRequest {
    pub path: String,
    pub frame_ms: Option<u16>,
    pub band_count: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrackAnalysisRequest {
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioAlignmentAnalysisRequest {
    pub reference_path: String,
    pub candidate_path: String,
    pub max_duration_ms: Option<u32>,
    pub frame_ms: Option<u16>,
    pub search_window_ms: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AudioSpectrumAnalysis {
    pub source_path: String,
    pub duration_ms: u64,
    pub frame_duration_ms: u16,
    pub sample_rate: u32,
    pub fft_size: usize,
    pub band_count: usize,
    pub frames: Vec<Vec<u8>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrackAnalysis {
    pub source_path: String,
    pub duration_ms: u64,
    pub sample_rate: u32,
    pub analysis_frame_ms: u16,
    pub estimated_tempo_bpm: Option<f32>,
    pub beat_times_ms: Vec<u32>,
    pub bar_times_ms: Vec<u32>,
    pub phrase_times_ms: Vec<u32>,
    pub intro_phase_end_ms: Option<u64>,
    pub outro_phase_start_ms: Option<u64>,
    pub energy_curve: Vec<u8>,
    pub average_energy: f32,
    pub intro_energy: f32,
    pub outro_energy: f32,
    pub suggested_transition_start_ms: Option<u64>,
    pub suggested_transition_reason: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AudioAlignmentAnalysis {
    pub reference_source_path: String,
    pub candidate_source_path: String,
    pub analyzed_duration_ms: u64,
    pub frame_duration_ms: u16,
    pub search_window_ms: u32,
    pub estimated_offset_ms: i32,
    pub correlation_score: f32,
    pub confidence: f32,
}

#[tauri::command]
pub fn ensure_media_library(app: AppHandle, state: State<'_, MediaState>) -> Result<MediaLibrarySnapshot, String> {
    let import_settings = load_app_settings_or_default(&app)
        .map(|settings| settings.library)
        .map_err(error_to_string)?;

    with_library_mutation(&app, &state, |path, document| {
        let app_data_dir = path
            .parent()
            .ok_or_else(|| anyhow!("Failed to resolve app data directory"))?;
        hydrate_missing_local_artworks(document, &import_settings, app_data_dir)?;
        Ok(snapshot_from_document(path, document))
    })
    .map_err(error_to_string)
}

#[tauri::command]
pub fn list_media_library(app: AppHandle, state: State<'_, MediaState>) -> Result<MediaLibrarySnapshot, String> {
    ensure_media_library(app, state)
}

#[tauri::command]
pub fn import_media_files(
    app: AppHandle,
    state: State<'_, MediaState>,
    request: ImportMediaRequest,
) -> Result<MediaLibrarySnapshot, String> {
    let import_settings = load_app_settings_or_default(&app)
        .map(|settings| settings.library)
        .map_err(error_to_string)?;

    with_library_mutation(&app, &state, |path, document| {
        let app_data_dir = path
            .parent()
            .ok_or_else(|| anyhow!("Failed to resolve app data directory"))?;

        for raw_path in request.paths {
            let target_path = PathBuf::from(raw_path);
            import_path_into_library(document, &target_path, &import_settings, app_data_dir)?;
        }

        document.imported_at_ms = now_ms();
        Ok(snapshot_from_document(path, document))
    })
    .map_err(error_to_string)
}

#[tauri::command]
pub fn clear_media_library(
    app: AppHandle,
    state: State<'_, MediaState>,
) -> Result<MediaLibrarySnapshot, String> {
    with_library_mutation(&app, &state, |path, document| {
        document.tracks.clear();
        document.artworks.clear();
        document.imported_at_ms = now_ms();

        if let Some(app_data_dir) = path.parent() {
            let embedded_artwork_dir = app_data_dir.join("embedded-artwork");
            if embedded_artwork_dir.exists() {
                fs::remove_dir_all(&embedded_artwork_dir).with_context(|| {
                    format!(
                        "Failed to clear embedded artwork directory {}",
                        embedded_artwork_dir.display()
                    )
                })?;
            }
        }

        Ok(snapshot_from_document(path, document))
    })
    .map_err(error_to_string)
}

#[tauri::command]
pub fn delete_media_tracks(
    app: AppHandle,
    state: State<'_, MediaState>,
    track_ids: Vec<String>,
) -> Result<MediaLibrarySnapshot, String> {
    with_library_mutation(&app, &state, |path, document| {
        if track_ids.is_empty() {
            return Ok(snapshot_from_document(path, document));
        }

        let existing_count = document.tracks.len();
        let track_ids_to_remove = track_ids.into_iter().collect::<HashSet<_>>();
        document
            .tracks
            .retain(|track| !track_ids_to_remove.contains(&track.id));

        if document.tracks.len() == existing_count {
            return Ok(snapshot_from_document(path, document));
        }

        prune_unused_artworks(document);
        document.imported_at_ms = now_ms();
        Ok(snapshot_from_document(path, document))
    })
    .map_err(error_to_string)
}

#[tauri::command]
pub fn register_remote_track(
    app: AppHandle,
    state: State<'_, MediaState>,
    draft: RemoteTrackDraft,
) -> Result<TrackRecord, String> {
    with_library_mutation(&app, &state, |_path, document| {
        let now = now_ms();
        let fallback_urls = draft.fallback_urls.clone().unwrap_or_default();
        let cache_key = draft.cache_key.clone().or_else(|| Some(draft.stream_url.clone()));
        let remote_source = MediaSource::RemoteStream(RemoteStreamSource {
            url: draft.stream_url.clone(),
            mime_type: draft.mime_type.clone(),
            headers: draft.headers.unwrap_or_default(),
        });

        let playback = match draft.fallback_local_path.clone() {
            Some(fallback_path) => PlaybackSource {
                mode: PlaybackMode::Hybrid,
                primary_uri: draft.stream_url.clone(),
                fallback_uri: Some(fallback_path),
                fallback_uris: fallback_urls.clone(),
                cache_key: cache_key.clone(),
            },
            None => PlaybackSource {
                mode: PlaybackMode::RemoteStream,
                primary_uri: draft.stream_url.clone(),
                fallback_uri: None,
                fallback_uris: fallback_urls,
                cache_key,
            },
        };

        let mut artwork_ids = Vec::new();
        let mut preferred_artwork_id = None;
        if let Some(artwork_url) = draft.artwork_url.clone() {
            let artwork = ArtworkRecord {
                id: Uuid::new_v4().to_string(),
                source: ArtworkSource::RemoteUrl {
                    url: artwork_url.clone(),
                },
                mime_type: None,
                width: None,
                height: None,
                imported_at_ms: now,
                updated_at_ms: now,
            };

            let canonical_artwork_id = upsert_artwork(document, artwork);
            preferred_artwork_id = Some(canonical_artwork_id.clone());
            artwork_ids.push(canonical_artwork_id);
        }

        let track = TrackRecord {
            id: Uuid::new_v4().to_string(),
            source: remote_source,
            playback,
            title: draft.title,
            artist: draft.artist,
            album: draft.album,
            album_artist: draft.album_artist,
            duration_ms: draft.duration_ms,
            track_number: None,
            disc_number: None,
            year: None,
            genre: draft.genre,
            artwork_ids,
            config: SongConfig {
                preferred_artwork_id,
                ..SongConfig::default()
            },
            imported_at_ms: now,
            updated_at_ms: now,
        };

        upsert_track(document, track.clone());
        document.imported_at_ms = now;
        Ok(track)
    })
    .map_err(error_to_string)
}

#[tauri::command]
pub fn save_song_config(
    app: AppHandle,
    state: State<'_, MediaState>,
    patch: SongConfigPatch,
) -> Result<TrackRecord, String> {
    with_library_mutation(&app, &state, |_path, document| {
        let track = document
            .tracks
            .iter_mut()
            .find(|track| track.id == patch.track_id)
            .ok_or_else(|| anyhow!("Track not found: {}", patch.track_id))?;

        track.config = patch.config;
        track.updated_at_ms = now_ms();
        Ok(track.clone())
    })
    .map_err(error_to_string)
}

#[tauri::command]
pub async fn cache_remote_audio_for_spectrum(
    app: AppHandle,
    request: SpectrumCacheRequest,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || cache_remote_audio_impl(&app, request))
        .await
        .map_err(|error| error_to_string(anyhow!("Failed to join remote audio cache task: {error}")))?
        .map_err(error_to_string)
}

#[tauri::command]
pub async fn clear_cached_spectrum_audio(
    app: AppHandle,
    path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || clear_cached_spectrum_audio_impl(&app, path))
        .await
        .map_err(|error| error_to_string(anyhow!("Failed to join spectrum cache cleanup task: {error}")))?
        .map_err(error_to_string)
}

#[tauri::command]
pub async fn analyze_local_audio_spectrum(
    app: AppHandle,
    request: AudioSpectrumAnalysisRequest,
) -> Result<AudioSpectrumAnalysis, String> {
    tauri::async_runtime::spawn_blocking(move || {
        analyze_local_audio_spectrum_impl(&app, request)
    })
    .await
    .map_err(|error| error_to_string(anyhow!("Failed to join spectrum analysis task: {error}")))?
    .map_err(error_to_string)
}

#[tauri::command]
pub async fn analyze_local_audio_track(
    app: AppHandle,
    request: AudioTrackAnalysisRequest,
) -> Result<AudioTrackAnalysis, String> {
    tauri::async_runtime::spawn_blocking(move || {
        analyze_local_audio_track_impl(&app, request)
    })
    .await
    .map_err(|error| error_to_string(anyhow!("Failed to join track analysis task: {error}")))?
    .map_err(error_to_string)
}

#[tauri::command]
pub async fn analyze_audio_alignment(
    app: AppHandle,
    request: AudioAlignmentAnalysisRequest,
) -> Result<AudioAlignmentAnalysis, String> {
    tauri::async_runtime::spawn_blocking(move || analyze_audio_alignment_impl(&app, request))
        .await
        .map_err(|error| error_to_string(anyhow!("Failed to join audio alignment task: {error}")))?
        .map_err(error_to_string)
}

fn with_library_mutation<T>(
    app: &AppHandle,
    state: &State<'_, MediaState>,
    mutator: impl FnOnce(&Path, &mut MediaLibraryDocument) -> anyhow::Result<T>,
) -> anyhow::Result<T> {
    let _guard = state
        .write_lock
        .lock()
        .map_err(|_| anyhow!("Failed to acquire media library lock"))?;

    let library_path = library_file_path(app)?;
    let mut document = load_or_create_library(&library_path)?;
    let result = mutator(&library_path, &mut document)?;
    persist_library(&library_path, &document)?;
    Ok(result)
}

fn load_or_create_library(path: &Path) -> anyhow::Result<MediaLibraryDocument> {
    if path.exists() {
        let content = fs::read_to_string(path)
            .with_context(|| format!("Failed to read library file at {}", path.display()))?;
        let document = serde_json::from_str::<MediaLibraryDocument>(&content)
            .with_context(|| format!("Failed to parse library file at {}", path.display()))?;
        return Ok(document);
    }

    let document = MediaLibraryDocument {
        schema_version: LIBRARY_SCHEMA_VERSION,
        tracks: Vec::new(),
        artworks: Vec::new(),
        imported_at_ms: now_ms(),
    };

    persist_library(path, &document)?;
    Ok(document)
}

fn persist_library(path: &Path, document: &MediaLibraryDocument) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create library directory {}", parent.display()))?;
    }

    let payload = serde_json::to_string_pretty(document)?;
    fs::write(path, payload)
        .with_context(|| format!("Failed to write library file at {}", path.display()))?;
    Ok(())
}

fn snapshot_from_document(path: &Path, document: &MediaLibraryDocument) -> MediaLibrarySnapshot {
    MediaLibrarySnapshot {
        schema_version: document.schema_version,
        library_path: path.display().to_string(),
        tracks: document.tracks.clone(),
        artworks: document.artworks.clone(),
        imported_at_ms: document.imported_at_ms,
    }
}

fn library_file_path(app: &AppHandle) -> anyhow::Result<PathBuf> {
    let app_dir = app
        .path()
        .app_data_dir()
        .context("Failed to resolve app data directory")?;
    Ok(app_dir.join(DEFAULT_LIBRARY_FILE))
}

fn cache_remote_audio_impl(app: &AppHandle, request: SpectrumCacheRequest) -> anyhow::Result<String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .or_else(|_| app.path().app_data_dir())
        .context("Failed to resolve app cache directory")?
        .join("spectrum-cache");
    fs::create_dir_all(&cache_dir).with_context(|| {
        format!("Failed to create spectrum cache directory {}", cache_dir.display())
    })?;

    let cache_seed = request
        .cache_key
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(request.url.as_str());
    let extension = infer_remote_audio_extension(request.url.as_str(), request.mime_type.as_deref());
    let file_name = format!("{}.{}", stable_hash(cache_seed), extension);
    let target_path = cache_dir.join(file_name);

    if target_path.exists() {
        let metadata = fs::metadata(&target_path).with_context(|| {
            format!("Failed to read cached spectrum file {}", target_path.display())
        })?;
        if metadata.len() > 0 {
            return Ok(target_path.display().to_string());
        }
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .context("Failed to create HTTP client for spectrum cache")?;
    let mut request_builder = client.get(request.url.as_str());

    if let Some(headers) = request.headers {
        for (key, value) in headers {
            let trimmed_key = key.trim();
            let trimmed_value = value.trim();
            if trimmed_key.is_empty() || trimmed_value.is_empty() {
                continue;
            }
            request_builder = request_builder.header(trimmed_key, trimmed_value);
        }
    }

    let mut response = request_builder
        .send()
        .with_context(|| format!("Failed to download remote audio {}", request.url))?
        .error_for_status()
        .with_context(|| format!("Remote audio request returned an error for {}", request.url))?;

    let temp_path = target_path.with_extension(format!("{}.part", extension));
    let mut file = fs::File::create(&temp_path).with_context(|| {
        format!(
            "Failed to create temporary spectrum cache file {}",
            temp_path.display()
        )
    })?;
    io::copy(&mut response, &mut file).with_context(|| {
        format!(
            "Failed to write spectrum cache file for remote audio {}",
            request.url
        )
    })?;
    drop(file);

    fs::rename(&temp_path, &target_path).with_context(|| {
        format!(
            "Failed to finalize spectrum cache file {}",
            target_path.display()
        )
    })?;

    Ok(target_path.display().to_string())
}

fn clear_cached_spectrum_audio_impl(app: &AppHandle, path: String) -> anyhow::Result<()> {
    let target_path = PathBuf::from(path.trim());
    if target_path.as_os_str().is_empty() {
        return Ok(());
    }

    let cache_dir = app
        .path()
        .app_cache_dir()
        .or_else(|_| app.path().app_data_dir())
        .context("Failed to resolve app cache directory")?
        .join("spectrum-cache");

    let normalized_cache_dir = fs::canonicalize(&cache_dir).unwrap_or(cache_dir.clone());
    let normalized_target_path = fs::canonicalize(&target_path).unwrap_or(target_path.clone());

    if !normalized_target_path.starts_with(&normalized_cache_dir) {
        return Err(anyhow!(
            "Refused to remove spectrum cache outside of {}",
            normalized_cache_dir.display()
        ));
    }

    if !normalized_target_path.exists() {
        return Ok(());
    }

    fs::remove_file(&normalized_target_path).with_context(|| {
        format!(
            "Failed to remove cached spectrum audio {}",
            normalized_target_path.display()
        )
    })?;

    Ok(())
}

fn resolve_audio_analysis_target_path(
    app: &AppHandle,
    raw_path: &str,
    context_label: &str,
) -> anyhow::Result<PathBuf> {
    let trimmed_path = raw_path.trim();
    if trimmed_path.is_empty() {
        return Err(anyhow!("{context_label} path is empty"));
    }

    let target_path = PathBuf::from(trimmed_path);
    if !target_path.exists() || !target_path.is_file() {
        return Err(anyhow!(
            "{context_label} target does not exist: {}",
            target_path.display()
        ));
    }

    let normalized_target_path =
        fs::canonicalize(&target_path).unwrap_or_else(|_| target_path.clone());
    let spectrum_cache_dir = app
        .path()
        .app_cache_dir()
        .or_else(|_| app.path().app_data_dir())
        .context("Failed to resolve app cache directory")?
        .join("spectrum-cache");
    let normalized_cache_dir =
        fs::canonicalize(&spectrum_cache_dir).unwrap_or_else(|_| spectrum_cache_dir.clone());

    if !normalized_target_path.starts_with(&normalized_cache_dir)
        && !is_supported_audio(&normalized_target_path)
    {
        return Err(anyhow!(
            "{context_label} only supports cached or local audio files: {}",
            normalized_target_path.display()
        ));
    }

    Ok(normalized_target_path)
}

fn analyze_local_audio_spectrum_impl(
    app: &AppHandle,
    request: AudioSpectrumAnalysisRequest,
) -> anyhow::Result<AudioSpectrumAnalysis> {
    let normalized_target_path =
        resolve_audio_analysis_target_path(app, &request.path, "Spectrum analysis")?;

    let frame_duration_ms = request.frame_ms.unwrap_or(48).clamp(16, 120);
    let band_count = request.band_count.unwrap_or(48).clamp(12, 96);
    let (mono_samples, sample_rate) = decode_audio_mono_samples(&normalized_target_path)?;
    let (fft_size, frames) =
        build_spectrum_frames(&mono_samples, sample_rate, frame_duration_ms, band_count)?;
    let duration_ms =
        ((mono_samples.len() as f64 / sample_rate as f64) * 1000.0).round().max(0.0) as u64;

    Ok(AudioSpectrumAnalysis {
        source_path: normalized_target_path.display().to_string(),
        duration_ms,
        frame_duration_ms,
        sample_rate,
        fft_size,
        band_count,
        frames,
    })
}

fn analyze_local_audio_track_impl(
    app: &AppHandle,
    request: AudioTrackAnalysisRequest,
) -> anyhow::Result<AudioTrackAnalysis> {
    let normalized_target_path =
        resolve_audio_analysis_target_path(app, &request.path, "Track analysis")?;
    let (mono_samples, sample_rate) = decode_audio_mono_samples(&normalized_target_path)?;
    let duration_ms =
        ((mono_samples.len() as f64 / sample_rate as f64) * 1000.0).round().max(0.0) as u64;

    let analysis_frame_ms = 50_u16;
    let frame_size = (((sample_rate as f32) * (analysis_frame_ms as f32)) / 1000.0)
        .round()
        .max(256.0) as usize;
    let energy_frames = build_energy_frames(&mono_samples, frame_size);
    if energy_frames.is_empty() {
        return Err(anyhow!(
            "Track analysis produced no energy frames for {}",
            normalized_target_path.display()
        ));
    }

    let energy_curve = normalize_energy_curve(&energy_frames, 96);
    let onset_envelope = build_onset_envelope(&energy_frames);
    let estimated_tempo_bpm =
        estimate_tempo_bpm(&onset_envelope, analysis_frame_ms).map(|value| (value * 10.0).round() / 10.0);
    let beat_times_ms = estimate_beat_times_ms(
        &onset_envelope,
        analysis_frame_ms,
        estimated_tempo_bpm,
        duration_ms,
    );
    let bar_times_ms = derive_bar_times_ms(&beat_times_ms);
    let phrase_times_ms = derive_phrase_times_ms(&bar_times_ms);
    let average_energy = mean_slice(&energy_frames);
    let intro_phase_end_ms = estimate_intro_phase_end_ms(
        &energy_frames,
        analysis_frame_ms,
        &phrase_times_ms,
        average_energy,
        duration_ms,
    );
    let outro_phase_start_ms = estimate_outro_phase_start_ms(
        &energy_frames,
        analysis_frame_ms,
        &phrase_times_ms,
        average_energy,
        duration_ms,
    );
    let intro_energy = mean_slice_portion(&energy_frames, true);
    let outro_energy = mean_slice_portion(&energy_frames, false);
    let suggested_transition_start_ms = suggest_transition_start_ms(
        &energy_frames,
        analysis_frame_ms,
        &beat_times_ms,
        &phrase_times_ms,
        duration_ms,
    );
    let suggested_transition_reason = if !phrase_times_ms.is_empty() {
        "phrase-aligned transition candidate selected in the outro".to_string()
    } else if outro_energy <= intro_energy * 0.92 {
        "outro energy is lower than intro; suitable for a soft transition".to_string()
    } else if !beat_times_ms.is_empty() {
        "beat-aligned transition candidate selected near the outro".to_string()
    } else {
        "energy valley selected near the outro without stable beat alignment".to_string()
    };

    Ok(AudioTrackAnalysis {
        source_path: normalized_target_path.display().to_string(),
        duration_ms,
        sample_rate,
        analysis_frame_ms,
        estimated_tempo_bpm,
        beat_times_ms,
        bar_times_ms,
        phrase_times_ms,
        intro_phase_end_ms,
        outro_phase_start_ms,
        energy_curve,
        average_energy,
        intro_energy,
        outro_energy,
        suggested_transition_start_ms,
        suggested_transition_reason,
    })
}

fn analyze_audio_alignment_impl(
    app: &AppHandle,
    request: AudioAlignmentAnalysisRequest,
) -> anyhow::Result<AudioAlignmentAnalysis> {
    let reference_path =
        resolve_audio_analysis_target_path(app, &request.reference_path, "Audio alignment reference")?;
    let candidate_path =
        resolve_audio_analysis_target_path(app, &request.candidate_path, "Audio alignment candidate")?;
    let max_duration_ms = request.max_duration_ms.unwrap_or(45_000).clamp(10_000, 90_000);
    let frame_duration_ms = request.frame_ms.unwrap_or(20).clamp(10, 60);
    let search_window_ms = request.search_window_ms.unwrap_or(8_000).clamp(500, 20_000);

    let (reference_samples, reference_sample_rate) =
        decode_audio_mono_samples_limited(&reference_path, Some(max_duration_ms as u64))?;
    let (candidate_samples, candidate_sample_rate) =
        decode_audio_mono_samples_limited(&candidate_path, Some(max_duration_ms as u64))?;

    if reference_samples.is_empty() || candidate_samples.is_empty() {
        return Err(anyhow!("Audio alignment requires non-empty decoded sample data"));
    }

    let reference_envelope =
        build_alignment_onset_envelope(&reference_samples, reference_sample_rate, frame_duration_ms);
    let candidate_envelope =
        build_alignment_onset_envelope(&candidate_samples, candidate_sample_rate, frame_duration_ms);

    if reference_envelope.len() < 24 || candidate_envelope.len() < 24 {
        return Err(anyhow!(
            "Audio alignment requires more decoded frames to estimate a stable offset"
        ));
    }

    let normalized_reference = normalize_alignment_series(&reference_envelope);
    let normalized_candidate = normalize_alignment_series(&candidate_envelope);
    let search_window_frames =
        ((search_window_ms as f32) / (frame_duration_ms as f32)).round().max(1.0) as isize;
    let (best_offset_frames, best_score, second_best_score) = estimate_alignment_offset_frames(
        &normalized_reference,
        &normalized_candidate,
        search_window_frames,
    );
    let estimated_offset_ms = (best_offset_frames as i32) * (frame_duration_ms as i32);
    let confidence = build_alignment_confidence(best_score, second_best_score);
    let analyzed_duration_ms = ((((reference_samples.len() as f64 / reference_sample_rate as f64)
        .min(candidate_samples.len() as f64 / candidate_sample_rate as f64))
        * 1000.0)
        .round()
        .max(0.0)) as u64;

    Ok(AudioAlignmentAnalysis {
        reference_source_path: reference_path.display().to_string(),
        candidate_source_path: candidate_path.display().to_string(),
        analyzed_duration_ms,
        frame_duration_ms,
        search_window_ms,
        estimated_offset_ms,
        correlation_score: best_score,
        confidence,
    })
}

fn build_energy_frames(mono_samples: &[f32], frame_size: usize) -> Vec<f32> {
    if mono_samples.is_empty() || frame_size == 0 {
        return Vec::new();
    }

    mono_samples
        .chunks(frame_size)
        .map(|frame| {
            let mean_square = frame
                .iter()
                .map(|sample| sample * sample)
                .sum::<f32>()
                / frame.len().max(1) as f32;
            mean_square.sqrt()
        })
        .collect()
}

fn build_onset_envelope(energy_frames: &[f32]) -> Vec<f32> {
    if energy_frames.is_empty() {
        return Vec::new();
    }

    let mut onset = Vec::with_capacity(energy_frames.len());
    onset.push(0.0);

    for window in energy_frames.windows(2) {
        let delta = (window[1] - window[0]).max(0.0);
        onset.push(delta);
    }

    onset
}

fn build_alignment_onset_envelope(
    mono_samples: &[f32],
    sample_rate: u32,
    frame_duration_ms: u16,
) -> Vec<f32> {
    let frame_size = (((sample_rate as f32) * (frame_duration_ms as f32)) / 1000.0)
        .round()
        .max(128.0) as usize;
    let energy_frames = build_energy_frames(mono_samples, frame_size);
    let onset_envelope = build_onset_envelope(&energy_frames);

    let mut smoothed = Vec::with_capacity(onset_envelope.len());
    for index in 0..onset_envelope.len() {
        let previous = if index > 0 {
            onset_envelope[index - 1]
        } else {
            onset_envelope[index]
        };
        let current = onset_envelope[index];
        let next = onset_envelope.get(index + 1).copied().unwrap_or(current);
        smoothed.push((previous * 0.25) + (current * 0.5) + (next * 0.25));
    }

    smoothed
}

fn normalize_alignment_series(series: &[f32]) -> Vec<f32> {
    if series.is_empty() {
        return Vec::new();
    }

    let mean = mean_slice(series);
    let variance = series
        .iter()
        .map(|value| {
            let delta = *value - mean;
            delta * delta
        })
        .sum::<f32>()
        / series.len().max(1) as f32;
    let std_dev = variance.sqrt().max(0.000_001);

    series
        .iter()
        .map(|value| (*value - mean) / std_dev)
        .collect()
}

fn estimate_alignment_offset_frames(
    reference: &[f32],
    candidate: &[f32],
    max_offset_frames: isize,
) -> (isize, f32, f32) {
    let mut best_offset = 0_isize;
    let mut best_score = f32::NEG_INFINITY;
    let mut second_best_score = f32::NEG_INFINITY;

    for offset in -max_offset_frames..=max_offset_frames {
        let start_reference = if offset < 0 { (-offset) as usize } else { 0 };
        let start_candidate = if offset > 0 { offset as usize } else { 0 };
        let overlap = reference
            .len()
            .saturating_sub(start_reference)
            .min(candidate.len().saturating_sub(start_candidate));

        if overlap < 24 {
            continue;
        }

        let score = reference[start_reference..start_reference + overlap]
            .iter()
            .zip(candidate[start_candidate..start_candidate + overlap].iter())
            .map(|(left, right)| left * right)
            .sum::<f32>()
            / overlap as f32;

        if score > best_score {
            second_best_score = best_score;
            best_score = score;
            best_offset = offset;
        } else if score > second_best_score {
            second_best_score = score;
        }
    }

    if !best_score.is_finite() {
        return (0, 0.0, 0.0);
    }

    (best_offset, best_score.max(0.0), second_best_score.max(0.0))
}

fn build_alignment_confidence(best_score: f32, second_best_score: f32) -> f32 {
    let score_component = best_score.clamp(0.0, 1.0);
    let separation_component = (best_score - second_best_score).clamp(0.0, 1.0);
    ((score_component * 0.65) + (separation_component * 0.85)).clamp(0.0, 1.0)
}

fn normalize_energy_curve(energy_frames: &[f32], target_points: usize) -> Vec<u8> {
    if energy_frames.is_empty() || target_points == 0 {
        return Vec::new();
    }

    let max_energy = energy_frames
        .iter()
        .copied()
        .fold(0.0_f32, f32::max)
        .max(0.000_001);
    let point_count = energy_frames.len().min(target_points).max(1);
    let bucket_size = (energy_frames.len() as f32 / point_count as f32)
        .ceil()
        .max(1.0) as usize;

    energy_frames
        .chunks(bucket_size)
        .take(point_count)
        .map(|bucket| {
            let energy = mean_slice(bucket) / max_energy;
            (energy.clamp(0.0, 1.0) * 255.0).round() as u8
        })
        .collect()
}

fn estimate_tempo_bpm(onset_envelope: &[f32], frame_duration_ms: u16) -> Option<f32> {
    if onset_envelope.len() < 8 || frame_duration_ms == 0 {
        return None;
    }

    let frame_duration_seconds = frame_duration_ms as f32 / 1000.0;
    let min_bpm = 70.0_f32;
    let max_bpm = 190.0_f32;
    let min_lag = ((60.0 / max_bpm) / frame_duration_seconds).round().max(1.0) as usize;
    let max_lag = ((60.0 / min_bpm) / frame_duration_seconds).round().max(min_lag as f32) as usize;

    if max_lag >= onset_envelope.len() {
        return None;
    }

    let mean_onset = mean_slice(onset_envelope);
    let centered: Vec<f32> = onset_envelope.iter().map(|value| *value - mean_onset).collect();

    let mut best_lag = None;
    let mut best_score = 0.0_f32;
    for lag in min_lag..=max_lag {
        let score = centered
            .iter()
            .zip(centered.iter().skip(lag))
            .map(|(left, right)| left * right)
            .sum::<f32>();

        if score > best_score {
            best_score = score;
            best_lag = Some(lag);
        }
    }

    let lag = best_lag?;
    if best_score <= 0.0 {
        return None;
    }

    Some(60.0 / (lag as f32 * frame_duration_seconds))
}

fn estimate_beat_times_ms(
    onset_envelope: &[f32],
    frame_duration_ms: u16,
    estimated_tempo_bpm: Option<f32>,
    duration_ms: u64,
) -> Vec<u32> {
    let Some(tempo_bpm) = estimated_tempo_bpm else {
        return Vec::new();
    };

    if onset_envelope.is_empty() || frame_duration_ms == 0 {
        return Vec::new();
    }

    let beat_interval_frames =
        ((60_000.0 / tempo_bpm) / frame_duration_ms as f32).round().max(1.0) as i32;
    let search_radius = (beat_interval_frames / 3).max(1);

    let mut anchor_index = 0usize;
    let mut anchor_value = 0.0_f32;
    let anchor_search_end = onset_envelope.len().min((12_000 / frame_duration_ms as usize).max(8));
    for (index, value) in onset_envelope.iter().copied().take(anchor_search_end).enumerate() {
        if value > anchor_value {
            anchor_value = value;
            anchor_index = index;
        }
    }

    let mut beat_indices = Vec::<usize>::new();
    let mut current = anchor_index as i32;
    while current >= 0 {
        let snapped = snap_to_local_peak(onset_envelope, current, search_radius);
        if !beat_indices.contains(&snapped) {
            beat_indices.push(snapped);
        }
        current -= beat_interval_frames;
    }

    current = anchor_index as i32 + beat_interval_frames;
    while current < onset_envelope.len() as i32 {
        let snapped = snap_to_local_peak(onset_envelope, current, search_radius);
        if !beat_indices.contains(&snapped) {
            beat_indices.push(snapped);
        }
        current += beat_interval_frames;
    }

    beat_indices.sort_unstable();
    beat_indices.dedup();

    beat_indices
        .into_iter()
        .map(|index| (index as u64 * frame_duration_ms as u64).min(duration_ms) as u32)
        .collect()
}

fn snap_to_local_peak(values: &[f32], center: i32, radius: i32) -> usize {
    let start = (center - radius).max(0) as usize;
    let end = (center + radius).min(values.len().saturating_sub(1) as i32) as usize;
    let mut best_index = center.clamp(0, values.len().saturating_sub(1) as i32) as usize;
    let mut best_value = values.get(best_index).copied().unwrap_or_default();

    for index in start..=end {
        let value = values[index];
        if value > best_value {
            best_value = value;
            best_index = index;
        }
    }

    best_index
}

fn derive_bar_times_ms(beat_times_ms: &[u32]) -> Vec<u32> {
    beat_times_ms
        .iter()
        .copied()
        .enumerate()
        .filter_map(|(index, time_ms)| (index % 4 == 0).then_some(time_ms))
        .collect()
}

fn derive_phrase_times_ms(bar_times_ms: &[u32]) -> Vec<u32> {
    bar_times_ms
        .iter()
        .copied()
        .enumerate()
        .filter_map(|(index, time_ms)| (index % 4 == 0).then_some(time_ms))
        .collect()
}

fn estimate_intro_phase_end_ms(
    energy_frames: &[f32],
    frame_duration_ms: u16,
    phrase_times_ms: &[u32],
    average_energy: f32,
    duration_ms: u64,
) -> Option<u64> {
    if phrase_times_ms.is_empty() || energy_frames.is_empty() {
        return None;
    }

    let max_intro_search_ms = duration_ms.min(60_000);
    let search_candidates: Vec<u64> = phrase_times_ms
        .iter()
        .copied()
        .map(|value| value as u64)
        .filter(|time_ms| *time_ms > 0 && *time_ms <= max_intro_search_ms)
        .collect();
    if search_candidates.is_empty() {
        return None;
    }

    let intro_reference_window = ((6_000 / frame_duration_ms as usize).max(4))
        .min(energy_frames.len());
    let intro_reference_mean = mean_slice(&energy_frames[..intro_reference_window]);
    let sustain_window_frames = (5_000 / frame_duration_ms as usize).max(4);
    let mut best_candidate: Option<(u64, f32)> = None;

    for phrase_time_ms in search_candidates.iter().copied() {
        let phrase_time_ms = phrase_time_ms as u64;
        let frame_index = (phrase_time_ms / frame_duration_ms as u64) as usize;
        let lookbehind_start = frame_index.saturating_sub((2_000 / frame_duration_ms as usize).max(2));
        let lookbehind_mean = mean_slice(&energy_frames[lookbehind_start..frame_index.min(energy_frames.len())]);
        let window_end = (frame_index + sustain_window_frames)
            .min(energy_frames.len());
        if window_end <= frame_index {
            continue;
        }

        let local_window = &energy_frames[frame_index..window_end];
        let local_mean = mean_slice(local_window);
        let local_min = local_window
            .iter()
            .copied()
            .fold(f32::MAX, f32::min);
        let local_max = local_window
            .iter()
            .copied()
            .fold(f32::MIN, f32::max);
        let uplift = local_mean - intro_reference_mean.max(lookbehind_mean);
        let stability = (local_max - local_min).abs();
        let score =
            uplift * 0.62
            + (local_mean - average_energy * 0.88) * 0.28
            - stability * 0.18
            + (phrase_time_ms as f32 / max_intro_search_ms.max(1) as f32) * 0.06;

        if local_mean >= average_energy * 0.86 && local_min >= intro_reference_mean * 0.82 {
            match best_candidate {
                Some((_, best_score)) if score <= best_score => {}
                _ => {
                    best_candidate = Some((phrase_time_ms.min(duration_ms), score));
                }
            }
        }
    }

    best_candidate
        .map(|(time_ms, _)| time_ms)
        .or_else(|| {
            search_candidates
                .iter()
                .copied()
                .find(|time_ms| *time_ms >= (max_intro_search_ms / 6).max(1))
        })
}

fn estimate_outro_phase_start_ms(
    energy_frames: &[f32],
    frame_duration_ms: u16,
    phrase_times_ms: &[u32],
    average_energy: f32,
    duration_ms: u64,
) -> Option<u64> {
    if phrase_times_ms.is_empty() || energy_frames.is_empty() {
        return None;
    }

    let min_outro_search_ms = duration_ms.saturating_sub(duration_ms.min(55_000));
    let search_candidates: Vec<u64> = phrase_times_ms
        .iter()
        .copied()
        .map(|value| value as u64)
        .filter(|time_ms| *time_ms >= min_outro_search_ms && *time_ms < duration_ms)
        .collect();
    if search_candidates.is_empty() {
        return None;
    }

    let tail_reference_start = energy_frames
        .len()
        .saturating_sub((6_000 / frame_duration_ms as usize).max(4));
    let tail_reference_mean = mean_slice(&energy_frames[tail_reference_start..]);
    let sustain_window_frames = (5_000 / frame_duration_ms as usize).max(4);
    let mut best_candidate: Option<(u64, f32)> = None;

    for phrase_time_ms in search_candidates.iter().copied().rev() {
        let phrase_time_ms = phrase_time_ms as u64;
        let frame_index = (phrase_time_ms / frame_duration_ms as u64) as usize;
        let window_end = (frame_index + sustain_window_frames)
            .min(energy_frames.len());
        if window_end <= frame_index {
            continue;
        }

        let local_window = &energy_frames[frame_index..window_end];
        let local_mean = mean_slice(local_window);
        let local_max = local_window
            .iter()
            .copied()
            .fold(f32::MIN, f32::max);
        let local_min = local_window
            .iter()
            .copied()
            .fold(f32::MAX, f32::min);
        let tail_distance_ratio = if duration_ms > min_outro_search_ms {
            (phrase_time_ms.saturating_sub(min_outro_search_ms)) as f32
                / (duration_ms - min_outro_search_ms) as f32
        } else {
            0.0
        };
        let drop_below_average = average_energy - local_mean;
        let stability = (local_max - local_min).abs();
        let score =
            drop_below_average * 0.56
            + (tail_reference_mean - local_mean) * 0.24
            - stability * 0.16
            + tail_distance_ratio * 0.1;

        if local_mean <= average_energy * 0.9 && local_max <= average_energy * 1.02 {
            match best_candidate {
                Some((_, best_score)) if score <= best_score => {}
                _ => {
                    best_candidate = Some((phrase_time_ms.min(duration_ms), score));
                }
            }
        }
    }

    best_candidate
        .map(|(time_ms, _)| time_ms)
        .or_else(|| search_candidates.iter().copied().rev().nth(1).or_else(|| search_candidates.last().copied()))
}

fn suggest_transition_start_ms(
    energy_frames: &[f32],
    frame_duration_ms: u16,
    beat_times_ms: &[u32],
    phrase_times_ms: &[u32],
    duration_ms: u64,
) -> Option<u64> {
    if energy_frames.is_empty() || duration_ms == 0 {
        return None;
    }

    let outro_window_ms = duration_ms.min(18_000).max(8_000);
    let trailing_guard_ms = duration_ms.min(3_500).max(2_000);
    let earliest_transition_ms = duration_ms.saturating_sub(outro_window_ms);
    let latest_transition_ms = duration_ms.saturating_sub(trailing_guard_ms);

    if latest_transition_ms <= earliest_transition_ms {
        return Some(earliest_transition_ms.min(duration_ms));
    }

    let start_frame = (earliest_transition_ms / frame_duration_ms as u64) as usize;
    let end_frame = ((latest_transition_ms / frame_duration_ms as u64) as usize)
        .min(energy_frames.len().saturating_sub(1));
    if end_frame <= start_frame {
        return Some(earliest_transition_ms.min(duration_ms));
    }

    let window_frame_count = (4_000 / frame_duration_ms as usize).max(4);
    let mut best_frame = start_frame;
    let mut best_score = f32::MAX;

    for frame_index in start_frame..=end_frame {
        let window_end = (frame_index + window_frame_count).min(end_frame + 1);
        let local_window = &energy_frames[frame_index..window_end];
        if local_window.is_empty() {
            continue;
        }

        let local_mean = mean_slice(local_window);
        let local_variance = local_window
            .iter()
            .map(|value| {
                let delta = *value - local_mean;
                delta * delta
            })
            .sum::<f32>()
            / local_window.len() as f32;
        let local_std = local_variance.sqrt();
        let progress_ratio = (frame_index - start_frame) as f32 / (end_frame - start_frame).max(1) as f32;

        // Prefer low-energy, relatively stable regions in the final section, but avoid the last tail.
        let score = local_mean * 0.72 + local_std * 0.2 + progress_ratio * 0.08;
        if score < best_score {
            best_score = score;
            best_frame = frame_index;
        }
    }

    let base_time_ms = (best_frame as u64 * frame_duration_ms as u64)
        .clamp(earliest_transition_ms, latest_transition_ms);
    let nearest_phrase_ms = phrase_times_ms
        .iter()
        .copied()
        .filter(|phrase_ms| {
            let value = *phrase_ms as u64;
            value >= earliest_transition_ms && value <= latest_transition_ms
        })
        .min_by_key(|phrase_ms| (*phrase_ms as i64 - base_time_ms as i64).abs());
    let nearest_beat_ms = beat_times_ms
        .iter()
        .copied()
        .filter(|beat_ms| {
            let value = *beat_ms as u64;
            value >= earliest_transition_ms && value <= latest_transition_ms
        })
        .min_by_key(|beat_ms| (*beat_ms as i64 - base_time_ms as i64).abs());

    Some(
        nearest_phrase_ms
            .map(|value| value as u64)
            .or_else(|| nearest_beat_ms.map(|value| value as u64))
            .map(|value| value as u64)
            .unwrap_or(base_time_ms)
            .clamp(earliest_transition_ms, latest_transition_ms)
            .min(duration_ms),
    )
}

fn mean_slice(values: &[f32]) -> f32 {
    if values.is_empty() {
        return 0.0;
    }

    values.iter().copied().sum::<f32>() / values.len() as f32
}

fn mean_slice_portion(values: &[f32], from_start: bool) -> f32 {
    if values.is_empty() {
        return 0.0;
    }

    let portion_len = values.len().min((values.len() as f32 * 0.15).ceil() as usize).max(1);
    if from_start {
        mean_slice(&values[..portion_len])
    } else {
        mean_slice(&values[values.len().saturating_sub(portion_len)..])
    }
}

fn decode_audio_mono_samples(path: &Path) -> anyhow::Result<(Vec<f32>, u32)> {
    decode_audio_mono_samples_limited(path, None)
}

fn decode_audio_mono_samples_limited(
    path: &Path,
    max_duration_ms: Option<u64>,
) -> anyhow::Result<(Vec<f32>, u32)> {
    let file = fs::File::open(path)
        .with_context(|| format!("Failed to open audio file for spectrum analysis {}", path.display()))?;
    let media_source = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();

    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }

    let probed = get_probe()
        .format(
            &hint,
            media_source,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .with_context(|| format!("Failed to probe audio format for {}", path.display()))?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|candidate| {
            candidate.codec_params.codec != CODEC_TYPE_NULL
                && candidate.codec_params.sample_rate.is_some()
        })
        .or_else(|| {
            format.default_track().filter(|candidate| {
                candidate.codec_params.codec != CODEC_TYPE_NULL
            })
        })
        .or_else(|| {
            format
                .tracks()
                .iter()
                .find(|candidate| candidate.codec_params.codec != CODEC_TYPE_NULL)
        })
        .cloned()
        .ok_or_else(|| anyhow!("No decodable audio track found in {}", path.display()))?;
    let sample_rate = track
        .codec_params
        .sample_rate
        .ok_or_else(|| anyhow!("Missing sample rate for {}", path.display()))?;
    let mut decoder = get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .with_context(|| format!("Failed to create audio decoder for {}", path.display()))?;

    let mut mono_samples = Vec::<f32>::new();
    let max_samples = max_duration_ms
        .map(|duration_ms| (((sample_rate as u64) * duration_ms) / 1000).max(1) as usize);

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(error)) if error.kind() == io::ErrorKind::UnexpectedEof => {
                break;
            }
            Err(error) => {
                return Err(anyhow!("Failed to read audio packet from {}: {error}", path.display()));
            }
        };

        if packet.track_id() != track.id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(SymphoniaError::IoError(error)) if error.kind() == io::ErrorKind::UnexpectedEof => {
                break;
            }
            Err(SymphoniaError::DecodeError(_)) => {
                continue;
            }
            Err(SymphoniaError::ResetRequired) => {
                return Err(anyhow!(
                    "Decoder reset required during spectrum analysis for {}",
                    path.display()
                ));
            }
            Err(error) => {
                return Err(anyhow!("Failed to decode audio packet from {}: {error}", path.display()));
            }
        };

        let spec = *decoded.spec();
        let channel_count = spec.channels.count().max(1);
        let mut sample_buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
        sample_buffer.copy_interleaved_ref(decoded);

        for frame in sample_buffer.samples().chunks(channel_count) {
            let mono_sample =
                frame.iter().copied().sum::<f32>() / channel_count as f32;
            mono_samples.push(mono_sample);
        }

        if let Some(limit) = max_samples {
            if mono_samples.len() >= limit {
                mono_samples.truncate(limit);
                break;
            }
        }
    }

    if mono_samples.is_empty() {
        return Err(anyhow!(
            "Decoded audio samples are empty for {}",
            path.display()
        ));
    }

    Ok((mono_samples, sample_rate))
}

fn build_spectrum_frames(
    mono_samples: &[f32],
    sample_rate: u32,
    frame_duration_ms: u16,
    band_count: usize,
) -> anyhow::Result<(usize, Vec<Vec<u8>>)> {
    if mono_samples.is_empty() || sample_rate == 0 {
        return Err(anyhow!("Cannot build spectrum frames from empty audio data"));
    }

    let hop_size = (((sample_rate as f32) * (frame_duration_ms as f32)) / 1000.0)
        .round()
        .max(256.0) as usize;
    let fft_size = hop_size.next_power_of_two().clamp(1024, 8192);
    let half_fft_size = fft_size / 2;
    let nyquist = sample_rate as f32 / 2.0;
    let min_frequency = 32.0_f32.min(nyquist.max(32.0));
    let max_frequency = nyquist.max(min_frequency + 1.0);
    let frequency_span = max_frequency / min_frequency.max(1.0);
    let logarithmic_range = frequency_span > 1.15;
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(fft_size);
    let hann_window: Vec<f32> = (0..fft_size)
        .map(|index| {
            0.5_f32
                - 0.5_f32
                    * ((2.0_f32 * std::f32::consts::PI * index as f32)
                        / fft_size as f32)
                        .cos()
        })
        .collect();
    let band_ranges: Vec<(usize, usize)> = (0..band_count)
        .map(|band_index| {
            let start_ratio = band_index as f32 / band_count as f32;
            let end_ratio = (band_index + 1) as f32 / band_count as f32;
            let start_frequency = if logarithmic_range {
                min_frequency * frequency_span.powf(start_ratio)
            } else {
                min_frequency + (max_frequency - min_frequency) * start_ratio
            };
            let end_frequency = if logarithmic_range {
                min_frequency * frequency_span.powf(end_ratio)
            } else {
                min_frequency + (max_frequency - min_frequency) * end_ratio
            };
            let start_bin = (((start_frequency / nyquist) * half_fft_size as f32).floor() as usize)
                .clamp(0, half_fft_size.saturating_sub(1));
            let end_bin = (((end_frequency / nyquist) * half_fft_size as f32).ceil() as usize)
                .clamp(start_bin + 1, half_fft_size);
            (start_bin, end_bin)
        })
        .collect();

    let mut frame_buffer = vec![Complex32::new(0.0, 0.0); fft_size];
    let mut raw_frames = Vec::<Vec<f32>>::new();
    let mut global_peak = 0.0_f32;
    let mut start_index = 0usize;

    while start_index < mono_samples.len() {
        for sample_index in 0..fft_size {
            let sample = mono_samples
                .get(start_index + sample_index)
                .copied()
                .unwrap_or_default();
            frame_buffer[sample_index] = Complex32::new(sample * hann_window[sample_index], 0.0);
        }

        fft.process(&mut frame_buffer);

        let mut frame = vec![0.0_f32; band_count];
        for (band_index, (start_bin, end_bin)) in band_ranges.iter().copied().enumerate() {
            let mut band_energy = 0.0_f32;
            let mut band_peak = 0.0_f32;
            let mut sample_count = 0usize;

            for bin_index in start_bin..end_bin {
                let magnitude = frame_buffer[bin_index].norm();
                band_energy += magnitude;
                band_peak = band_peak.max(magnitude);
                sample_count += 1;
            }

            let band_value = if sample_count == 0 {
                0.0
            } else {
                let average = band_energy / sample_count as f32;
                (average * 0.64).max(band_peak * 0.92)
            };

            frame[band_index] = band_value;
            global_peak = global_peak.max(band_value);
        }

        raw_frames.push(frame);

        if mono_samples.len() <= hop_size {
            break;
        }

        start_index = start_index.saturating_add(hop_size);
    }

    if raw_frames.is_empty() {
        raw_frames.push(vec![0.0_f32; band_count]);
    }

    let normalization_peak = if global_peak > 0.000_001 {
        global_peak
    } else {
        1.0
    };
    let frames = raw_frames
        .into_iter()
        .map(|frame| {
            frame
                .into_iter()
                .map(|value| {
                    let normalized = (value / normalization_peak).clamp(0.0, 1.0).powf(0.72);
                    (normalized * 255.0).round().clamp(0.0, 255.0) as u8
                })
                .collect::<Vec<u8>>()
        })
        .collect::<Vec<Vec<u8>>>();

    Ok((fft_size, frames))
}

fn infer_remote_audio_extension(url: &str, mime_type: Option<&str>) -> String {
    if let Some(extension) = mime_type.and_then(map_audio_extension_from_mime) {
        return extension.to_string();
    }

    if let Ok(parsed_url) = Url::parse(url) {
        if let Some(last_segment) = parsed_url
            .path_segments()
            .and_then(|segments| segments.last())
            .filter(|segment| !segment.is_empty())
        {
            if let Some((_, extension)) = last_segment.rsplit_once('.') {
                let normalized = extension.trim().to_lowercase();
                if AUDIO_EXTENSIONS.contains(&normalized.as_str())
                    || MEDIA_CONTAINER_EXTENSIONS.contains(&normalized.as_str())
                {
                    return normalized;
                }
            }
        }
    }

    "audio".to_string()
}

fn map_audio_extension_from_mime(mime_type: &str) -> Option<&'static str> {
    match mime_type.trim().to_ascii_lowercase().as_str() {
        "audio/mpeg" | "audio/mp3" => Some("mp3"),
        "audio/flac" | "audio/x-flac" => Some("flac"),
        "audio/mp4" | "audio/x-m4a" | "audio/aac" => Some("m4a"),
        "audio/ogg" => Some("ogg"),
        "audio/opus" => Some("opus"),
        "audio/wav" | "audio/x-wav" | "audio/wave" => Some("wav"),
        "audio/webm" => Some("webm"),
        "video/mp4" => Some("mp4"),
        "video/webm" => Some("webm"),
        "video/ogg" => Some("ogv"),
        "video/quicktime" => Some("mov"),
        _ => None,
    }
}

fn stable_hash(value: &str) -> String {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn parse_audio_track(path: &Path) -> anyhow::Result<TrackRecord> {
    let tagged_file = Probe::open(path)
        .with_context(|| format!("Failed to open audio file {}", path.display()))?
        .read()
        .with_context(|| format!("Failed to parse audio file {}", path.display()))?;

    let properties = tagged_file.properties();
    let primary_tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag());
    let now = now_ms();
    let title = primary_tag
        .and_then(|tag| tag.get_string(ItemKey::TrackTitle))
        .map(str::to_owned)
        .or_else(|| file_stem(path))
        .unwrap_or_else(|| "Unknown Title".to_string());

    let artist = primary_tag
        .and_then(|tag| tag.get_string(ItemKey::TrackArtist))
        .map(str::to_owned);
    let album = primary_tag
        .and_then(|tag| tag.get_string(ItemKey::AlbumTitle))
        .map(str::to_owned);
    let album_artist = primary_tag
        .and_then(|tag| tag.get_string(ItemKey::AlbumArtist))
        .map(str::to_owned);
    let genre = primary_tag
        .and_then(|tag| tag.get_string(ItemKey::Genre))
        .map(str::to_owned);
    let year = primary_tag
        .and_then(|tag| tag.get_string(ItemKey::RecordingDate))
        .and_then(parse_year);
    let track_number = primary_tag.and_then(|tag| tag.track());
    let disc_number = primary_tag.and_then(|tag| tag.disk());
    let local_source = local_file_source(path)?;

    Ok(TrackRecord {
        id: Uuid::new_v4().to_string(),
        playback: PlaybackSource {
            mode: PlaybackMode::LocalFile,
            primary_uri: local_source.path.clone(),
            fallback_uri: None,
            fallback_uris: Vec::new(),
            cache_key: None,
        },
        source: MediaSource::LocalFile(local_source),
        title,
        artist,
        album,
        album_artist,
        duration_ms: Some(properties.duration().as_millis() as u64),
        track_number,
        disc_number,
        year,
        genre,
        artwork_ids: Vec::new(),
        config: SongConfig::default(),
        imported_at_ms: now,
        updated_at_ms: now,
    })
}

fn import_path_into_library(
    document: &mut MediaLibraryDocument,
    target_path: &Path,
    import_settings: &LibrarySettings,
    app_data_dir: &Path,
) -> anyhow::Result<()> {
    if !target_path.exists() {
        return Ok(());
    }

    if target_path.is_dir() {
        for entry in fs::read_dir(target_path)
            .with_context(|| format!("Failed to read media directory {}", target_path.display()))?
        {
            let entry = entry?;
            import_path_into_library(document, &entry.path(), import_settings, app_data_dir)?;
        }

        return Ok(());
    }

    if is_supported_audio(target_path) {
        let mut track = parse_audio_track(target_path)?;
        let mut artwork_ids = Vec::new();

        if import_settings.auto_import_artwork {
            artwork_ids.extend(collect_related_artworks(document, target_path)?);
        }

        if import_settings.extract_embedded_artwork {
            artwork_ids.extend(extract_embedded_artworks(
                document,
                target_path,
                app_data_dir,
            )?);
        }

        artwork_ids.sort();
        artwork_ids.dedup();

        if track.config.preferred_artwork_id.is_none() {
            track.config.preferred_artwork_id = artwork_ids.first().cloned();
        }
        track.artwork_ids = artwork_ids;
        upsert_track(document, track);
        return Ok(());
    }

    if import_settings.auto_import_artwork && is_supported_image(target_path) {
        let _ = upsert_artwork(document, parse_image_artwork(target_path)?);
    }

    Ok(())
}

fn extract_embedded_artworks(
    document: &mut MediaLibraryDocument,
    audio_path: &Path,
    app_data_dir: &Path,
) -> anyhow::Result<Vec<String>> {
    let tagged_file = Probe::open(audio_path)
        .with_context(|| format!("Failed to open audio file {}", audio_path.display()))?
        .read()
        .with_context(|| format!("Failed to parse audio file {}", audio_path.display()))?;

    if !tagged_file
        .tags()
        .iter()
        .any(|candidate_tag| !candidate_tag.pictures().is_empty())
    {
        return Ok(Vec::new());
    }

    let embedded_artwork_dir = app_data_dir.join("embedded-artwork");
    fs::create_dir_all(&embedded_artwork_dir).with_context(|| {
        format!(
            "Failed to create embedded artwork directory {}",
            embedded_artwork_dir.display()
        )
    })?;

    let mut artwork_ids = Vec::new();
    let mut picture_index = 0usize;
    let mut seen_picture_keys = HashSet::new();

    for candidate_tag in tagged_file.tags() {
        for picture in candidate_tag.pictures() {
            persist_embedded_picture(
                document,
                audio_path,
                &embedded_artwork_dir,
                picture.mime_type().map(|mime| mime.as_str()),
                picture.data(),
                &mut picture_index,
                &mut artwork_ids,
                &mut seen_picture_keys,
            )?;
        }
    }

    if has_extension(audio_path, &["mp3"]) {
        if let Ok(tag) = id3::Tag::read_from_path(audio_path) {
            for picture in tag.pictures() {
                persist_embedded_picture(
                    document,
                    audio_path,
                    &embedded_artwork_dir,
                    Some(picture.mime_type.as_str()),
                    &picture.data,
                    &mut picture_index,
                    &mut artwork_ids,
                    &mut seen_picture_keys,
                )?;
            }
        }
    }

    Ok(artwork_ids)
}

fn embedded_picture_identity(mime_type: Option<&str>, data: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    mime_type.unwrap_or_default().hash(&mut hasher);
    data.hash(&mut hasher);
    hasher.finish()
}

fn persist_embedded_picture(
    document: &mut MediaLibraryDocument,
    audio_path: &Path,
    embedded_artwork_dir: &Path,
    mime_type: Option<&str>,
    picture_data: &[u8],
    picture_index: &mut usize,
    artwork_ids: &mut Vec<String>,
    seen_picture_keys: &mut HashSet<u64>,
) -> anyhow::Result<()> {
    let picture_identity = embedded_picture_identity(mime_type, picture_data);
    if !seen_picture_keys.insert(picture_identity) {
        return Ok(());
    }

    let extension = picture_mime_extension(mime_type).unwrap_or("bin");
    let file_path = embedded_artwork_file_path(
        embedded_artwork_dir,
        audio_path,
        *picture_index,
        extension,
    );
    *picture_index += 1;

    fs::write(&file_path, picture_data).with_context(|| {
        format!(
            "Failed to write embedded artwork extracted from {}",
            audio_path.display()
        )
    })?;

    let artwork = parse_image_artwork(&file_path)?;
    let canonical_artwork_id = upsert_artwork(document, artwork);
    artwork_ids.push(canonical_artwork_id);
    Ok(())
}

fn embedded_artwork_file_path(
    embedded_artwork_dir: &Path,
    audio_path: &Path,
    picture_index: usize,
    extension: &str,
) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    audio_path
        .canonicalize()
        .unwrap_or_else(|_| audio_path.to_path_buf())
        .to_string_lossy()
        .hash(&mut hasher);
    picture_index.hash(&mut hasher);

    embedded_artwork_dir.join(format!("{:x}.{extension}", hasher.finish()))
}

fn picture_mime_extension(mime_type: Option<&str>) -> Option<&'static str> {
    match mime_type {
        Some("image/png") => Some("png"),
        Some("image/jpeg") => Some("jpg"),
        Some("image/webp") => Some("webp"),
        Some("image/gif") => Some("gif"),
        Some("image/bmp") => Some("bmp"),
        Some("image/x-icon") => Some("ico"),
        _ => None,
    }
}

fn collect_related_artworks(
    document: &mut MediaLibraryDocument,
    audio_path: &Path,
) -> anyhow::Result<Vec<String>> {
    let mut artwork_ids = Vec::new();
    let Some(parent) = audio_path.parent() else {
        return Ok(artwork_ids);
    };

    let base_name = file_stem(audio_path).unwrap_or_default().to_lowercase();
    for entry in fs::read_dir(parent)
        .with_context(|| format!("Failed to read artwork directory {}", parent.display()))?
    {
        let entry = entry?;
        let candidate_path = entry.path();
        if !candidate_path.is_file() || !is_supported_image(&candidate_path) {
            continue;
        }

        let candidate_name = file_stem(&candidate_path).unwrap_or_default().to_lowercase();
        let matches_same_stem = !base_name.is_empty() && candidate_name == base_name;
        let matches_common_name = ARTWORK_CANDIDATES.iter().any(|name| candidate_name == *name);
        if !matches_same_stem && !matches_common_name {
            continue;
        }

        let artwork = parse_image_artwork(&candidate_path)?;
        let canonical_artwork_id = upsert_artwork(document, artwork);
        artwork_ids.push(canonical_artwork_id);
    }

    artwork_ids.sort();
    artwork_ids.dedup();
    Ok(artwork_ids)
}

fn hydrate_missing_local_artworks(
    document: &mut MediaLibraryDocument,
    import_settings: &LibrarySettings,
    app_data_dir: &Path,
) -> anyhow::Result<()> {
    let mut library_updated = false;

    for track_index in 0..document.tracks.len() {
        let audio_path = match &document.tracks[track_index].source {
            MediaSource::LocalFile(source) => PathBuf::from(&source.path),
            MediaSource::RemoteStream(_) => continue,
        };

        if !audio_path.exists() {
            continue;
        }

        let needs_artwork_refresh = document.tracks[track_index].artwork_ids.is_empty();
        let needs_preferred_refresh =
            document.tracks[track_index].config.preferred_artwork_id.is_none();

        if !needs_artwork_refresh && !needs_preferred_refresh {
            continue;
        }

        let mut artwork_ids = document.tracks[track_index].artwork_ids.clone();

        if import_settings.auto_import_artwork {
            artwork_ids.extend(collect_related_artworks(document, &audio_path)?);
        }

        if import_settings.extract_embedded_artwork {
            artwork_ids.extend(extract_embedded_artworks(
                document,
                &audio_path,
                app_data_dir,
            )?);
        }

        artwork_ids.sort();
        artwork_ids.dedup();

        let track = &mut document.tracks[track_index];
        let previous_artwork_ids = track.artwork_ids.clone();
        let previous_preferred_artwork_id = track.config.preferred_artwork_id.clone();

        if needs_artwork_refresh {
            track.artwork_ids = artwork_ids.clone();
        }

        if track.config.preferred_artwork_id.is_none() {
            track.config.preferred_artwork_id = artwork_ids.first().cloned();
        } else if let Some(preferred_artwork_id) = &track.config.preferred_artwork_id {
            if !artwork_ids.contains(preferred_artwork_id) {
                track.config.preferred_artwork_id = artwork_ids.first().cloned();
            }
        }

        if track.artwork_ids != previous_artwork_ids
            || track.config.preferred_artwork_id != previous_preferred_artwork_id
        {
            track.updated_at_ms = now_ms();
            library_updated = true;
        }
    }

    if library_updated {
        document.imported_at_ms = now_ms();
    }

    Ok(())
}

fn parse_image_artwork(path: &Path) -> anyhow::Result<ArtworkRecord> {
    let now = now_ms();
    let reader = ImageReader::open(path)
        .with_context(|| format!("Failed to open image file {}", path.display()))?
        .with_guessed_format()
        .with_context(|| format!("Failed to detect image format for {}", path.display()))?;
    let format = reader.format();
    let (width, height) = reader
        .into_dimensions()
        .with_context(|| format!("Failed to parse image dimensions for {}", path.display()))?;
    let local_source = local_file_source(path)?;

    Ok(ArtworkRecord {
        id: Uuid::new_v4().to_string(),
        source: ArtworkSource::LocalFile(local_source),
        mime_type: format.and_then(image_format_to_mime),
        width: Some(width),
        height: Some(height),
        imported_at_ms: now,
        updated_at_ms: now,
    })
}

fn local_file_source(path: &Path) -> anyhow::Result<LocalFileSource> {
    let metadata = fs::metadata(path)
        .with_context(|| format!("Failed to read metadata for {}", path.display()))?;
    let normalized_path = normalize_stored_path(path);

    Ok(LocalFileSource {
        path: normalized_path,
        file_name: path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default(),
        extension: path
            .extension()
            .map(|value| value.to_string_lossy().to_ascii_lowercase()),
        file_size_bytes: Some(metadata.len()),
        modified_at_ms: metadata.modified().ok().and_then(system_time_to_ms),
    })
}

fn normalize_stored_path(path: &Path) -> String {
    let raw_path = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .display()
        .to_string();

    if let Some(stripped) = raw_path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{stripped}");
    }

    raw_path
        .strip_prefix(r"\\?\")
        .map(str::to_string)
        .unwrap_or(raw_path)
}

fn upsert_track(document: &mut MediaLibraryDocument, mut incoming: TrackRecord) {
    let incoming_path = track_local_path(&incoming);

    if let Some(existing) = document.tracks.iter_mut().find(|track| {
        track_local_path(track)
            .zip(incoming_path.clone())
            .map(|(left, right)| left == right)
            .unwrap_or(false)
    }) {
        incoming.id = existing.id.clone();
        incoming.imported_at_ms = existing.imported_at_ms;
        incoming.config = existing.config.clone();
        if incoming.config.preferred_artwork_id.is_none() {
            incoming.config.preferred_artwork_id = incoming.artwork_ids.first().cloned();
        }
        existing.clone_from(&incoming);
        return;
    }

    if let Some(existing) = document.tracks.iter_mut().find(|track| {
        track.playback
            .cache_key
            .as_ref()
            .zip(incoming.playback.cache_key.as_ref())
            .map(|(left, right)| left == right)
            .unwrap_or(false)
    }) {
        incoming.id = existing.id.clone();
        incoming.imported_at_ms = existing.imported_at_ms;
        if incoming.config.preferred_artwork_id.is_none() {
            incoming.config = existing.config.clone();
        }
        existing.clone_from(&incoming);
        return;
    }

    if let Some(existing) = document.tracks.iter_mut().find(|track| {
        matches!(
            (&track.source, &incoming.source),
            (MediaSource::RemoteStream(left), MediaSource::RemoteStream(right))
                if !left.url.is_empty() && !right.url.is_empty() && left.url == right.url
        )
    }) {
        incoming.id = existing.id.clone();
        incoming.imported_at_ms = existing.imported_at_ms;
        if incoming.config.preferred_artwork_id.is_none() {
            incoming.config = existing.config.clone();
        }
        existing.clone_from(&incoming);
        return;
    }

    document.tracks.push(incoming);
}

fn upsert_artwork(document: &mut MediaLibraryDocument, mut incoming: ArtworkRecord) -> String {
    let incoming_key = artwork_identity(&incoming);
    if let Some(existing) = document
        .artworks
        .iter_mut()
        .find(|artwork| artwork_identity(artwork) == incoming_key)
    {
        incoming.id = existing.id.clone();
        incoming.imported_at_ms = existing.imported_at_ms;
        existing.clone_from(&incoming);
        return existing.id.clone();
    }

    let canonical_id = incoming.id.clone();
    document.artworks.push(incoming);
    canonical_id
}

fn prune_unused_artworks(document: &mut MediaLibraryDocument) {
    let referenced_artwork_ids = document
        .tracks
        .iter()
        .flat_map(|track| {
            track.artwork_ids.iter().cloned().chain(
                track.config
                    .preferred_artwork_id
                    .iter()
                    .cloned(),
            )
        })
        .collect::<HashSet<_>>();

    document
        .artworks
        .retain(|artwork| referenced_artwork_ids.contains(&artwork.id));
}

fn artwork_identity(artwork: &ArtworkRecord) -> String {
    match &artwork.source {
        ArtworkSource::LocalFile(source) => format!("local:{}", source.path),
        ArtworkSource::RemoteUrl { url } => format!("remote:{url}"),
    }
}

fn track_local_path(track: &TrackRecord) -> Option<String> {
    match &track.source {
        MediaSource::LocalFile(source) => Some(source.path.clone()),
        MediaSource::RemoteStream(_) => None,
    }
}

fn file_stem(path: &Path) -> Option<String> {
    path.file_stem()
        .map(|value| value.to_string_lossy().to_string())
}

fn parse_year(value: &str) -> Option<i32> {
    value.get(0..4)?.parse::<i32>().ok()
}

fn image_format_to_mime(format: image::ImageFormat) -> Option<String> {
    let mime = match format {
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::Jpeg => "image/jpeg",
        image::ImageFormat::Gif => "image/gif",
        image::ImageFormat::WebP => "image/webp",
        image::ImageFormat::Bmp => "image/bmp",
        image::ImageFormat::Ico => "image/x-icon",
        _ => return None,
    };

    Some(mime.to_string())
}

fn is_supported_audio(path: &Path) -> bool {
    has_extension(path, AUDIO_EXTENSIONS)
}

fn is_supported_image(path: &Path) -> bool {
    has_extension(path, IMAGE_EXTENSIONS)
}

fn has_extension(path: &Path, supported: &[&str]) -> bool {
    path.extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .map(|extension| supported.iter().any(|candidate| *candidate == extension))
        .unwrap_or(false)
}

fn now_ms() -> u64 {
    system_time_to_ms(SystemTime::now()).unwrap_or_default()
}

fn system_time_to_ms(value: SystemTime) -> Option<u64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

fn error_to_string(error: anyhow::Error) -> String {
    format!("{error:#}")
}
