use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::BTreeSet,
    fs,
    io::{Read, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    thread,
};

const PKG_MAGIC: &[u8; 4] = b"PKGV";
const MIN_PATH_SCAN_LENGTH: usize = 6;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum WallpaperEngineProjectKind {
    Scene,
    Video,
    Web,
    Application,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperEngineProjectProperty {
    pub key: String,
    pub property_type: String,
    pub text: Option<String>,
    pub value: Value,
    pub condition: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperEnginePkgSummary {
    pub path: String,
    pub version_tag: Option<String>,
    pub contains_scene_json: bool,
    pub entry_count: usize,
    pub entries: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperEngineProjectDescriptor {
    pub folder_path: String,
    pub title: String,
    pub description: String,
    pub wallpaper_type: WallpaperEngineProjectKind,
    pub project_json_path: String,
    pub preview_path: Option<String>,
    pub file_name: Option<String>,
    pub main_file_path: Option<String>,
    pub scene_json_path: Option<String>,
    pub scene_pkg: Option<WallpaperEnginePkgSummary>,
    pub supports_audio_processing: bool,
    pub supports_video: bool,
    pub properties: Vec<WallpaperEngineProjectProperty>,
    pub property_count: usize,
    pub tags: Vec<String>,
    pub workshop_url: Option<String>,
    pub raw_type: String,
}

#[tauri::command]
pub fn inspect_wallpaper_engine_project(folder_path: String) -> Result<WallpaperEngineProjectDescriptor, String> {
    inspect_project(Path::new(&folder_path)).map_err(|error| error.to_string())
}

pub fn inspect_project(folder_path: &Path) -> Result<WallpaperEngineProjectDescriptor> {
    let project_json_path = folder_path.join("project.json");
    let project_json_contents = fs::read_to_string(&project_json_path).with_context(|| {
        format!(
            "failed to read Wallpaper Engine project file: {}",
            project_json_path.display()
        )
    })?;
    let project_value: Value =
        serde_json::from_str(&project_json_contents).context("failed to parse Wallpaper Engine project.json")?;

    let title = read_string(&project_value, "title").unwrap_or_default();
    let description = read_string(&project_value, "description").unwrap_or_default();
    let raw_type = read_string(&project_value, "type").unwrap_or_default();
    let wallpaper_type = classify_project_kind(&raw_type);
    let file_name = read_string(&project_value, "file");
    let preview_name = read_string(&project_value, "preview");
    let preview_path = preview_name
        .as_deref()
        .map(|name| folder_path.join(name))
        .filter(|path| path.exists())
        .as_deref()
        .map(path_to_string);
    let mut main_file_path = file_name
        .as_deref()
        .map(|name| folder_path.join(name.replace('\\', "/")))
        .filter(|path| path.exists())
        .as_deref()
        .map(path_to_string);

    // Some local web projects omit `file` even though their entry point is the
    // conventional root index document.  Wallpaper Engine resolves that entry
    // automatically; do the same for the embedded iframe.
    if wallpaper_type == WallpaperEngineProjectKind::Web && main_file_path.is_none() {
        main_file_path = ["index.html", "index.htm"]
            .into_iter()
            .map(|name| folder_path.join(name))
            .find(|path| path.is_file())
            .as_deref()
            .map(path_to_string);
    }

    let scene_json_path = resolve_scene_json_path(folder_path, file_name.as_deref());
    let scene_pkg_path = folder_path.join("scene.pkg");
    let scene_pkg = if scene_pkg_path.exists() {
        Some(scan_scene_pkg(&scene_pkg_path)?)
    } else {
        None
    };

    let general = project_value.get("general");
    let supports_audio_processing = general
        .and_then(|value| value.get("supportsaudioprocessing"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let supports_video = general
        .and_then(|value| value.get("supportsvideo"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let properties = read_properties(general.and_then(|value| value.get("properties")));
    let tags = project_value
        .get("tags")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(WallpaperEngineProjectDescriptor {
        folder_path: path_to_string(folder_path),
        title,
        description,
        wallpaper_type,
        project_json_path: path_to_string(&project_json_path),
        preview_path,
        file_name,
        main_file_path,
        scene_json_path: scene_json_path.as_deref().map(path_to_string),
        scene_pkg,
        supports_audio_processing,
        supports_video,
        property_count: properties.len(),
        properties,
        tags,
        workshop_url: read_string(&project_value, "workshopurl"),
        raw_type,
    })
}

#[tauri::command]
pub fn host_wallpaper_engine_web_project(folder_path: String) -> Result<String, String> {
    host_web_project(Path::new(&folder_path)).map_err(|error| error.to_string())
}

fn host_web_project(folder_path: &Path) -> Result<String> {
    let descriptor = inspect_project(folder_path)?;
    if descriptor.wallpaper_type != WallpaperEngineProjectKind::Web {
        return Err(anyhow!("Wallpaper Engine project is not a Web wallpaper"));
    }

    let entry_path = descriptor
        .main_file_path
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| anyhow!("Web wallpaper has no HTML entry point"))?;
    let root = fs::canonicalize(folder_path)
        .with_context(|| format!("failed to resolve Web wallpaper directory: {}", folder_path.display()))?;
    let entry = fs::canonicalize(&entry_path)
        .with_context(|| format!("failed to resolve Web wallpaper entry: {}", entry_path.display()))?;
    let entry_name = entry
        .strip_prefix(&root)
        .context("Web wallpaper entry is outside its project directory")?
        .to_string_lossy()
        .replace('\\', "/");

    let listener = TcpListener::bind(("127.0.0.1", 0)).context("failed to bind Web wallpaper host")?;
    let port = listener.local_addr()?.port();
    thread::Builder::new()
        .name(format!("we-web-{port}"))
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                let _ = serve_web_project_request(stream, &root);
            }
        })
        .context("failed to start Web wallpaper host")?;

    Ok(format!("http://127.0.0.1:{port}/{entry_name}"))
}

fn serve_web_project_request(mut stream: std::net::TcpStream, root: &Path) -> Result<()> {
    let mut request = [0u8; 8192];
    let size = stream.read(&mut request)?;
    let request = String::from_utf8_lossy(&request[..size]);
    let target = request.split_whitespace().nth(1).unwrap_or("/");
    let path = target.split('?').next().unwrap_or("/").trim_start_matches('/');
    let candidate = root.join(path);
    let resolved = fs::canonicalize(&candidate).ok();
    let Some(file_path) = resolved.filter(|value| value.starts_with(root) && value.is_file()) else {
        stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")?;
        return Ok(());
    };
    let bytes = fs::read(&file_path)?;
    let content_type = web_content_type(&file_path);
    write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
        bytes.len()
    )?;
    stream.write_all(&bytes)?;
    Ok(())
}

fn web_content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "atlas" => "application/json; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        _ => "application/octet-stream",
    }
}

fn classify_project_kind(raw_type: &str) -> WallpaperEngineProjectKind {
    match raw_type.trim().to_ascii_lowercase().as_str() {
        "scene" => WallpaperEngineProjectKind::Scene,
        "video" => WallpaperEngineProjectKind::Video,
        "web" => WallpaperEngineProjectKind::Web,
        "application" => WallpaperEngineProjectKind::Application,
        _ => WallpaperEngineProjectKind::Unknown,
    }
}

fn resolve_scene_json_path(folder_path: &Path, main_file_name: Option<&str>) -> Option<PathBuf> {
    let main_file_path = main_file_name.map(|name| folder_path.join(name));
    if let Some(path) = main_file_path.filter(|path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("scene.json"))
    }) {
        return Some(path);
    }

    let loose_scene_json_path = folder_path.join("scene.json");
    if loose_scene_json_path.exists() {
        return Some(loose_scene_json_path);
    }

    None
}

fn read_properties(properties_value: Option<&Value>) -> Vec<WallpaperEngineProjectProperty> {
    let Some(Value::Object(properties)) = properties_value else {
        return Vec::new();
    };

    let mut items = properties
        .iter()
        .map(|(key, value)| WallpaperEngineProjectProperty {
            key: key.clone(),
            property_type: value
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string(),
            text: value
                .get("text")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            value: value.get("value").cloned().unwrap_or(Value::Null),
            condition: value
                .get("condition")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
        })
        .collect::<Vec<_>>();
    items.sort_by(|left, right| left.key.cmp(&right.key));
    items
}

fn scan_scene_pkg(scene_pkg_path: &Path) -> Result<WallpaperEnginePkgSummary> {
    let bytes = fs::read(scene_pkg_path)
        .with_context(|| format!("failed to read scene package: {}", scene_pkg_path.display()))?;
    let magic_offset = bytes
        .windows(PKG_MAGIC.len())
        .position(|window| window == PKG_MAGIC)
        .ok_or_else(|| anyhow!("scene package does not contain a PKGV header"))?;

    let version_tag = bytes
        .get(magic_offset..magic_offset + 8)
        .and_then(|slice| std::str::from_utf8(slice).ok())
        .map(ToOwned::to_owned);

    let entries = scan_pkg_entry_names(&bytes);
    let contains_scene_json = entries
        .iter()
        .any(|entry| entry.eq_ignore_ascii_case("scene.json"));

    Ok(WallpaperEnginePkgSummary {
        path: path_to_string(scene_pkg_path),
        version_tag,
        contains_scene_json,
        entry_count: entries.len(),
        entries,
    })
}

fn scan_pkg_entry_names(bytes: &[u8]) -> Vec<String> {
    let mut entries = BTreeSet::new();
    let mut start = 0usize;

    while start < bytes.len() {
        if !is_path_byte(bytes[start]) {
            start += 1;
            continue;
        }

        let mut end = start;
        while end < bytes.len() && is_path_byte(bytes[end]) {
            end += 1;
        }

        if end - start >= MIN_PATH_SCAN_LENGTH {
            if let Ok(candidate) = std::str::from_utf8(&bytes[start..end]) {
                if looks_like_pkg_path(candidate) {
                    entries.insert(candidate.to_string());
                }
            }
        }

        start = end + 1;
    }

    entries.into_iter().collect()
}

fn looks_like_pkg_path(candidate: &str) -> bool {
    let lower = candidate.to_ascii_lowercase();
    if lower.starts_with("steam://") {
        return false;
    }

    let has_slash = lower.contains('/');
    let has_known_extension = [
        ".json", ".vert", ".frag", ".tex", ".jpg", ".jpeg", ".png", ".gif", ".mp4", ".webm", ".mp3", ".wav",
        ".ogg", ".ttf", ".otf", ".svg", ".txt",
    ]
    .iter()
    .any(|extension| lower.ends_with(extension));

    has_slash && has_known_extension
}

fn is_path_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric()
        || matches!(
            byte,
            b'/' | b'\\' | b'.' | b'-' | b'_' | b' ' | b'(' | b')'
        )
}

fn read_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

pub(crate) fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inspects_workspace_scene_sample() {
        let sample_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("wallpaper");

        let descriptor = inspect_project(&sample_dir).expect("sample wallpaper should parse");
        assert_eq!(descriptor.wallpaper_type, WallpaperEngineProjectKind::Scene);
        assert!(descriptor.scene_pkg.is_some());
        assert!(descriptor.property_count > 0);
    }
}
