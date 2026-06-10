use std::{
    collections::BTreeMap,
    io::{self, BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    sync::Mutex,
    thread,
    time::Duration,
};

use anyhow::{anyhow, Context};
use reqwest::{
    blocking::Client,
    header::{
        HeaderName, HeaderValue, ACCEPT_RANGES, CONTENT_DISPOSITION,
        CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG, IF_RANGE, LAST_MODIFIED, RANGE,
    },
};
use serde::Serialize;
use tauri::State;
use url::{form_urlencoded, Url};

const MEDIA_PROXY_ALLOWED_HEADERS: &[&str] = &[
    "accept",
    "accept-language",
    "cache-control",
    "origin",
    "pragma",
    "referer",
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
    "user-agent",
];

pub struct MediaProxyState {
    runtime: Mutex<MediaProxyRuntime>,
}

impl Default for MediaProxyState {
    fn default() -> Self {
        Self {
            runtime: Mutex::new(MediaProxyRuntime::default()),
        }
    }
}

#[derive(Default)]
struct MediaProxyRuntime {
    port: u16,
    running: bool,
    last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaProxyServerStatus {
    pub running: bool,
    pub url: String,
    pub port: u16,
    pub message: Option<String>,
}

struct ParsedHttpRequest {
    method: String,
    target: String,
    headers: BTreeMap<String, String>,
}

struct ProxyTargetRequest {
    remote_url: String,
    mime_type: Option<String>,
    headers: BTreeMap<String, String>,
}

fn build_status(runtime: &MediaProxyRuntime) -> MediaProxyServerStatus {
    MediaProxyServerStatus {
        running: runtime.running && runtime.port > 0,
        url: if runtime.port > 0 {
            format!("http://127.0.0.1:{}", runtime.port)
        } else {
            String::new()
        },
        port: runtime.port,
        message: runtime.last_error.clone(),
    }
}

pub fn ensure_media_proxy_server(state: &MediaProxyState) -> anyhow::Result<MediaProxyServerStatus> {
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| anyhow!("failed to acquire media proxy runtime lock"))?;

    if runtime.running && runtime.port > 0 {
        return Ok(build_status(&runtime));
    }

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .context("failed to bind media proxy listener")?;
    let port = listener
        .local_addr()
        .context("failed to resolve media proxy listener address")?
        .port();

    thread::spawn(move || run_media_proxy_server(listener));

    runtime.port = port;
    runtime.running = true;
    runtime.last_error = None;
    Ok(build_status(&runtime))
}

fn run_media_proxy_server(listener: TcpListener) {
    for incoming in listener.incoming() {
        match incoming {
            Ok(stream) => {
                thread::spawn(move || {
                    if let Err(error) = handle_media_proxy_connection(stream) {
                        eprintln!("[media-proxy] request failed: {error:#}");
                    }
                });
            }
            Err(error) => {
                eprintln!("[media-proxy] failed to accept connection: {error}");
            }
        }
    }
}

fn handle_media_proxy_connection(mut stream: TcpStream) -> anyhow::Result<()> {
    let request = parse_http_request(&stream)?;

    if request.method.eq_ignore_ascii_case("OPTIONS") {
        write_http_response(
            &mut stream,
            204,
            "No Content",
            &[("Content-Length", "0".to_string())],
            None,
        )?;
        return Ok(());
    }

    if !request.method.eq_ignore_ascii_case("GET") && !request.method.eq_ignore_ascii_case("HEAD") {
        write_text_response(&mut stream, 405, "Method Not Allowed", "Method not allowed.")?;
        return Ok(());
    }

    let proxy_request = parse_proxy_target_request(&request.target)?;
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .context("failed to build media proxy http client")?;

    let method = reqwest::Method::from_bytes(request.method.as_bytes())
        .context("failed to parse proxy request method")?;
    let mut upstream_request = client.request(method.clone(), &proxy_request.remote_url);

    for (header_name, header_value) in proxy_request.headers {
        let normalized_name = header_name.trim().to_ascii_lowercase();
        if normalized_name.is_empty() {
            continue;
        }

        let header_name = match HeaderName::from_bytes(normalized_name.as_bytes()) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let header_value = match HeaderValue::from_str(header_value.trim()) {
            Ok(value) => value,
            Err(_) => continue,
        };
        upstream_request = upstream_request.header(header_name, header_value);
    }

    for allowed_header in MEDIA_PROXY_ALLOWED_HEADERS {
        if let Some(value) = request.headers.get(*allowed_header) {
            upstream_request = upstream_request.header(*allowed_header, value.as_str());
        }
    }

    if let Some(range) = request.headers.get("range") {
        upstream_request = upstream_request.header(RANGE, range.as_str());
    }
    if let Some(if_range) = request.headers.get("if-range") {
        upstream_request = upstream_request.header(IF_RANGE, if_range.as_str());
    }

    let mut upstream_response = match upstream_request.send() {
        Ok(response) => response,
        Err(error) => {
            write_text_response(
                &mut stream,
                502,
                "Bad Gateway",
                &format!("Failed to fetch media source: {error}"),
            )?;
            return Ok(());
        }
    };

    let upstream_status = upstream_response.status();
    let mut response_headers = Vec::<(String, String)>::new();
    response_headers.push(("Cache-Control".to_string(), "no-store".to_string()));
    response_headers.push(("Connection".to_string(), "close".to_string()));

    let upstream_headers = upstream_response.headers();
    if let Some(value) = upstream_headers.get(CONTENT_TYPE).and_then(header_value_to_string) {
        response_headers.push(("Content-Type".to_string(), value));
    } else if let Some(mime_type) = proxy_request.mime_type.filter(|value| !value.trim().is_empty()) {
        response_headers.push(("Content-Type".to_string(), mime_type));
    }

    for header_name in [
        ACCEPT_RANGES,
        CONTENT_DISPOSITION,
        CONTENT_LENGTH,
        CONTENT_RANGE,
        ETAG,
        LAST_MODIFIED,
    ] {
        if let Some(value) = upstream_headers.get(&header_name).and_then(header_value_to_string) {
            response_headers.push((header_name.to_string(), value));
        }
    }

    write_http_response(
        &mut stream,
        upstream_status.as_u16(),
        upstream_status.canonical_reason().unwrap_or("OK"),
        &response_headers
            .iter()
            .map(|(name, value)| (name.as_str(), value.clone()))
            .collect::<Vec<_>>(),
        None,
    )?;

    if request.method.eq_ignore_ascii_case("HEAD") {
        return Ok(());
    }

    io::copy(&mut upstream_response, &mut stream)
        .context("failed to proxy media response body")?;
    Ok(())
}

fn parse_http_request(stream: &TcpStream) -> anyhow::Result<ParsedHttpRequest> {
    let mut reader = BufReader::new(
        stream
            .try_clone()
            .context("failed to clone media proxy stream")?,
    );
    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .context("failed to read media proxy request line")?;

    let request_line = request_line.trim_end_matches(['\r', '\n']);
    if request_line.is_empty() {
        return Err(anyhow!("media proxy request line is empty"));
    }

    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| anyhow!("missing media proxy request method"))?
        .to_string();
    let target = request_parts
        .next()
        .ok_or_else(|| anyhow!("missing media proxy request target"))?
        .to_string();

    let mut headers = BTreeMap::new();
    loop {
        let mut line = String::new();
        let bytes_read = reader
            .read_line(&mut line)
            .context("failed to read media proxy request header")?;
        if bytes_read == 0 {
            break;
        }

        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }

        if let Some((name, value)) = trimmed.split_once(':') {
            let normalized_name = name.trim().to_ascii_lowercase();
            let normalized_value = value.trim().to_string();
            if !normalized_name.is_empty() && !normalized_value.is_empty() {
                headers.insert(normalized_name, normalized_value);
            }
        }
    }

    Ok(ParsedHttpRequest {
        method,
        target,
        headers,
    })
}

fn parse_proxy_target_request(target: &str) -> anyhow::Result<ProxyTargetRequest> {
    let parsed = Url::parse(&format!("http://127.0.0.1{target}"))
        .with_context(|| format!("failed to parse media proxy target `{target}`"))?;
    if parsed.path() != "/media-proxy" {
        return Err(anyhow!("unsupported media proxy path `{}`", parsed.path()));
    }

    let query = parsed
        .query()
        .ok_or_else(|| anyhow!("media proxy request is missing a query string"))?;
    let params: BTreeMap<String, String> = form_urlencoded::parse(query.as_bytes())
        .into_owned()
        .collect();
    let remote_url = params
        .get("url")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("media proxy request is missing the remote url"))?;

    let headers = params
        .get("headers")
        .map(|value| serde_json::from_str::<BTreeMap<String, String>>(value))
        .transpose()
        .context("failed to parse media proxy headers")?
        .unwrap_or_default();

    Ok(ProxyTargetRequest {
        remote_url,
        mime_type: params.get("mime").cloned(),
        headers,
    })
}

fn header_value_to_string(value: &HeaderValue) -> Option<String> {
    value.to_str().ok().map(|text| text.to_string())
}

fn write_text_response(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    body: &str,
) -> anyhow::Result<()> {
    write_http_response(
        stream,
        status,
        reason,
        &[("Content-Type", "text/plain; charset=utf-8".to_string())],
        Some(body.as_bytes()),
    )
}

fn write_http_response(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    headers: &[(&str, String)],
    body: Option<&[u8]>,
) -> anyhow::Result<()> {
    let mut response = format!(
        "HTTP/1.1 {status} {reason}\r\nAccess-Control-Allow-Origin: *\r\n\
Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n\
Access-Control-Allow-Headers: Range, Content-Type\r\n\
Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges, Content-Type\r\n\
Connection: close\r\n"
    );
    let mut has_content_length = false;
    for (name, value) in headers {
        if name.eq_ignore_ascii_case("content-length") {
            has_content_length = true;
        }
        response.push_str(name);
        response.push_str(": ");
        response.push_str(value);
        response.push_str("\r\n");
    }

    if !has_content_length && body.is_some() {
        let body_length = body.map(|value| value.len()).unwrap_or(0);
        response.push_str(&format!("Content-Length: {body_length}\r\n"));
    }
    response.push_str("\r\n");

    stream
        .write_all(response.as_bytes())
        .context("failed to write media proxy response headers")?;
    if let Some(body) = body {
        stream
            .write_all(body)
            .context("failed to write media proxy response body")?;
    }
    stream.flush().ok();
    Ok(())
}

#[tauri::command]
pub fn get_media_proxy_server_status(
    state: State<'_, MediaProxyState>,
) -> Result<MediaProxyServerStatus, String> {
    ensure_media_proxy_server(&state).map_err(|error| error.to_string())
}
