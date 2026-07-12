use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use anyhow::{anyhow, Context};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::media::{
    save_local_lyrics_bundle_impl, save_local_song_metadata_impl, SaveLocalSongMetadataRequest,
};

const SONG_DOWNLOAD_PROGRESS_EVENT: &str = "song-download-progress";

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadNeteaseSongRequest {
    pub job_id: String,
    pub song_id: u64,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub artwork_url: Option<String>,
    pub lyric: Option<String>,
    pub translated_lyric: Option<String>,
    pub romanized_lyric: Option<String>,
    pub lyrics_mode: Option<String>,
    pub url: String,
    pub save_directory: String,
    pub file_extension: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SongDownloadProgressPayload {
    job_id: String,
    song_id: u64,
    title: String,
    artist: Option<String>,
    status: &'static str,
    received_bytes: u64,
    total_bytes: Option<u64>,
    progress_percent: Option<f64>,
    file_path: Option<String>,
    error: Option<String>,
}

#[tauri::command]
pub async fn download_netease_song(
    app: AppHandle,
    request: DownloadNeteaseSongRequest,
) -> Result<String, String> {
    let job_id = request.job_id.trim().to_string();
    if job_id.is_empty() {
        return Err("Download job id is required.".to_string());
    }

    if request.title.trim().is_empty() {
        return Err("Song title is required.".to_string());
    }

    if request.url.trim().is_empty() {
        return Err("Download URL is required.".to_string());
    }

    if request.save_directory.trim().is_empty() {
        return Err("Download directory is required.".to_string());
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = download_netease_song_impl(&app_handle, request.clone()).await {
            let _ = emit_song_download_progress(
                app_handle,
                SongDownloadProgressPayload {
                    job_id: request.job_id,
                    song_id: request.song_id,
                    title: request.title,
                    artist: request.artist,
                    status: "failed",
                    received_bytes: 0,
                    total_bytes: None,
                    progress_percent: None,
                    file_path: None,
                    error: Some(format!("{error:#}")),
                },
            );
        }
    });

    Ok(job_id)
}

async fn download_netease_song_impl(
    app: &AppHandle,
    request: DownloadNeteaseSongRequest,
) -> anyhow::Result<()> {
    let download_dir = PathBuf::from(request.save_directory.trim());
    fs::create_dir_all(&download_dir).with_context(|| {
        format!(
            "Failed to create download directory {}",
            download_dir.display()
        )
    })?;

    let extension = resolve_extension(
        request.file_extension.as_deref(),
        request.url.as_str(),
        None,
    );
    let file_name_stem = build_song_file_stem(&request.title, request.artist.as_deref());
    let final_path = allocate_download_path(&download_dir, &file_name_stem, &extension);
    emit_song_download_progress(
        app.clone(),
        SongDownloadProgressPayload {
            job_id: request.job_id.clone(),
            song_id: request.song_id,
            title: request.title.clone(),
            artist: request.artist.clone(),
            status: "started",
            received_bytes: 0,
            total_bytes: None,
            progress_percent: Some(0.0),
            file_path: None,
            error: None,
        },
    )?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .context("Failed to create HTTP client for song download")?;
    let mut response = client
        .get(request.url.trim())
        .send()
        .await
        .with_context(|| format!("Failed to request download URL {}", request.url))?
        .error_for_status()
        .with_context(|| format!("Download request returned an error for {}", request.url))?;

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let total_bytes = response.content_length();

    let final_path = if request.file_extension.as_deref().unwrap_or("").trim().is_empty() {
        let resolved_extension = resolve_extension(None, request.url.as_str(), content_type.as_deref());
        if resolved_extension != extension {
            allocate_download_path(&download_dir, &file_name_stem, &resolved_extension)
        } else {
            final_path
        }
    } else {
        final_path
    };
    let temp_path = final_path.with_extension(format!(
        "{}.part",
        final_path
            .extension()
            .and_then(|value| value.to_str())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("bin")
    ));

    let mut file = fs::File::create(&temp_path).with_context(|| {
        format!(
            "Failed to create temporary download file {}",
            temp_path.display()
        )
    })?;
    let mut received_bytes = 0u64;
    let mut last_emit = Instant::now();

    while let Some(chunk) = response.chunk().await.context("Failed to read download chunk")? {
        file.write_all(&chunk).with_context(|| {
            format!(
                "Failed to write temporary download file {}",
                temp_path.display()
            )
        })?;
        received_bytes = received_bytes.saturating_add(chunk.len() as u64);

        let should_emit = total_bytes
            .map(|total| received_bytes >= total)
            .unwrap_or(false)
            || last_emit.elapsed() >= Duration::from_millis(160);
        if should_emit {
            emit_song_download_progress(
                app.clone(),
                SongDownloadProgressPayload {
                    job_id: request.job_id.clone(),
                    song_id: request.song_id,
            title: request.title.clone(),
            artist: request.artist.clone(),
                    status: "progress",
                    received_bytes,
                    total_bytes,
                    progress_percent: calculate_progress_percent(received_bytes, total_bytes),
                    file_path: None,
                    error: None,
                },
            )?;
            last_emit = Instant::now();
        }
    }

    drop(file);

    fs::rename(&temp_path, &final_path).with_context(|| {
        format!(
            "Failed to finalize downloaded file {}",
            final_path.display()
        )
    })?;

    let downloaded_cover_art_path =
        download_cover_art_to_temp(app, request.artwork_url.as_deref(), &request.job_id).await?;

    let embedded_lyric = match request.lyrics_mode.as_deref() {
        Some("embedded") => request.lyric.clone(),
        _ => None,
    };

    save_local_song_metadata_impl(
        app,
        &final_path,
        SaveLocalSongMetadataRequest {
            path: final_path.display().to_string(),
            title: Some(request.title.clone()),
            artist: request.artist.clone(),
            album: request.album.clone(),
            lyric: embedded_lyric,
            cover_art_path: downloaded_cover_art_path
                .as_ref()
                .map(|path| path.display().to_string()),
        },
    )
    .with_context(|| {
        format!(
            "Failed to write media metadata to downloaded file {}",
            final_path.display()
        )
    })?;

    if matches!(request.lyrics_mode.as_deref(), Some("sidecar")) {
        save_local_lyrics_bundle_impl(
            &final_path,
            request.lyric.as_deref(),
            request.translated_lyric.as_deref(),
            request.romanized_lyric.as_deref(),
        )
        .with_context(|| {
            format!(
                "Failed to write sidecar lyrics for downloaded file {}",
                final_path.display()
            )
        })?;
    }

    if let Some(path) = downloaded_cover_art_path.as_ref() {
        let _ = fs::remove_file(path);
    }

    emit_song_download_progress(
        app.clone(),
        SongDownloadProgressPayload {
            job_id: request.job_id,
            song_id: request.song_id,
            title: request.title,
            artist: request.artist,
            status: "completed",
            received_bytes,
            total_bytes,
            progress_percent: Some(100.0),
            file_path: Some(final_path.display().to_string()),
            error: None,
        },
    )?;

    Ok(())
}

async fn download_cover_art_to_temp(
    app: &AppHandle,
    artwork_url: Option<&str>,
    job_id: &str,
) -> anyhow::Result<Option<PathBuf>> {
    let Some(url) = artwork_url.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };

    let cache_dir = app
        .path()
        .app_cache_dir()
        .or_else(|_| app.path().app_data_dir())
        .context("Failed to resolve app cache directory")?
        .join("download-artwork-cache");
    fs::create_dir_all(&cache_dir)
        .with_context(|| format!("Failed to create artwork cache directory {}", cache_dir.display()))?;

    let response = reqwest::get(url)
        .await
        .with_context(|| format!("Failed to request cover artwork {}", url))?
        .error_for_status()
        .with_context(|| format!("Failed to download cover artwork {}", url))?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let bytes = response
        .bytes()
        .await
        .context("Failed to read cover artwork bytes")?;

    let extension = resolve_extension(None, url, content_type.as_deref());
    let target_path = cache_dir.join(format!(
        "{}-cover.{}",
        sanitize_file_segment(job_id),
        extension
    ));
    fs::write(&target_path, &bytes)
        .with_context(|| format!("Failed to write cover artwork file {}", target_path.display()))?;

    Ok(Some(target_path))
}

fn emit_song_download_progress(
    app: AppHandle,
    payload: SongDownloadProgressPayload,
) -> anyhow::Result<()> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| anyhow!("Main window was not found"))?;
    window
        .emit(SONG_DOWNLOAD_PROGRESS_EVENT, payload)
        .context("Failed to emit song download progress event")?;
    Ok(())
}

fn calculate_progress_percent(received_bytes: u64, total_bytes: Option<u64>) -> Option<f64> {
    total_bytes
        .filter(|value| *value > 0)
        .map(|value| ((received_bytes as f64 / value as f64) * 100.0).clamp(0.0, 100.0))
}

fn build_song_file_stem(title: &str, artist: Option<&str>) -> String {
    let safe_title = sanitize_file_segment(title);
    let safe_artist = artist.map(sanitize_file_segment).unwrap_or_default();

    if safe_artist.is_empty() {
        safe_title
    } else {
        format!("{safe_artist} - {safe_title}")
    }
}

fn sanitize_file_segment(value: &str) -> String {
    let sanitized = value
        .trim()
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect::<String>();
    let collapsed = sanitized.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.trim_matches(['.', ' ']).trim().to_string()
}

fn allocate_download_path(directory: &Path, file_stem: &str, extension: &str) -> PathBuf {
    let normalized_stem = if file_stem.trim().is_empty() {
        "download".to_string()
    } else {
        file_stem.trim().to_string()
    };
    let normalized_extension = if extension.trim().is_empty() {
        "bin".to_string()
    } else {
        extension.trim().trim_start_matches('.').to_string()
    };

    let initial_path = directory.join(format!("{normalized_stem}.{normalized_extension}"));
    if !initial_path.exists() {
        return initial_path;
    }

    for index in 1..1000 {
        let candidate = directory.join(format!(
            "{normalized_stem} ({index}).{normalized_extension}"
        ));
        if !candidate.exists() {
            return candidate;
        }
    }

    directory.join(format!(
        "{}-{}.{}",
        normalized_stem,
        uuid::Uuid::new_v4(),
        normalized_extension
    ))
}

fn resolve_extension(
    hint: Option<&str>,
    url: &str,
    content_type: Option<&str>,
) -> String {
    if let Some(value) = hint {
        let trimmed = value.trim().trim_start_matches('.');
        if !trimmed.is_empty() {
            return trimmed.to_ascii_lowercase();
        }
    }

    if let Some(extension) = Path::new(url)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty() && value.len() <= 8)
    {
        return extension;
    }

    if let Some(value) = content_type {
        let normalized = value.trim().to_ascii_lowercase();
        if normalized.contains("flac") {
            return "flac".to_string();
        }
        if normalized.contains("wav") {
            return "wav".to_string();
        }
        if normalized.contains("aac") {
            return "aac".to_string();
        }
        if normalized.contains("ogg") {
            return "ogg".to_string();
        }
        if normalized.contains("mp4") || normalized.contains("m4a") {
            return "m4a".to_string();
        }
        if normalized.contains("mpeg") || normalized.contains("mp3") {
            return "mp3".to_string();
        }
    }

    "mp3".to_string()
}
