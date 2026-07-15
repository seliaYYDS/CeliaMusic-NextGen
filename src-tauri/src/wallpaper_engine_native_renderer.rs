use std::{
    cell::RefCell,
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use anyhow::{anyhow, Context, Result};
use bytemuck::{Pod, Zeroable};
use fontdue::Font;
use rquickjs::{Context as JsContext, Runtime as JsRuntime};

use crate::wallpaper_engine_scene::{
    prepare_scene_runtime, WallpaperEngineSceneLayer, WallpaperEngineSceneRuntime,
    WallpaperEngineSceneScriptValue,
};

#[derive(Debug, Clone)]
pub struct NativeSceneRendererConfig {
    pub folder_path: String,
    pub host_window_label: String,
    pub host_window_hwnd: isize,
    pub host_width: u32,
    pub host_height: u32,
}

pub trait NativeSceneRendererBackend: Send + 'static {
    fn run(self: Box<Self>, stop_flag: Arc<AtomicBool>) -> Result<()>;
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct SceneVertex {
    position: [f32; 2],
    tex_coord: [f32; 2],
}

impl SceneVertex {
    fn buffer_layout<'a>() -> wgpu::VertexBufferLayout<'a> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<SceneVertex>() as u64,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &[
                wgpu::VertexAttribute {
                    offset: 0,
                    shader_location: 0,
                    format: wgpu::VertexFormat::Float32x2,
                },
                wgpu::VertexAttribute {
                    offset: std::mem::size_of::<[f32; 2]>() as u64,
                    shader_location: 1,
                    format: wgpu::VertexFormat::Float32x2,
                },
            ],
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct SceneUniforms {
    tint: [f32; 4],
}

struct NativeSceneDrawable {
    vertex_buffer: wgpu::Buffer,
    index_buffer: wgpu::Buffer,
    index_count: u32,
    bind_group: wgpu::BindGroup,
}

#[derive(Clone)]
struct NativeDrawableCacheEntry {
    texture_view: wgpu::TextureView,
    uniform_buffer: wgpu::Buffer,
    width: u32,
    height: u32,
    content_key: String,
}

struct NativeDrawableSource {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
    alpha: f32,
    transform: Transform2D,
}

#[derive(Clone)]
struct NativeImageCacheEntry {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

#[derive(Clone)]
struct NativeTextCacheEntry {
    cache_key: String,
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

fn build_native_drawables(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    texture_bind_group_layout: &wgpu::BindGroupLayout,
    sampler: &wgpu::Sampler,
    runtime: &WallpaperEngineSceneRuntime,
    cache: &mut std::collections::HashMap<String, NativeDrawableCacheEntry>,
    image_cache: &mut std::collections::HashMap<String, NativeImageCacheEntry>,
    text_cache: &mut std::collections::HashMap<i64, NativeTextCacheEntry>,
) -> Result<Vec<NativeSceneDrawable>> {
    use image::GenericImageView;
    use wgpu::util::DeviceExt;

    let resolved_layers = build_resolved_native_layers(runtime);
    let mut drawable_sources = Vec::<NativeDrawableSource>::new();
    for resolved_layer in resolved_layers.iter().filter(|entry| entry.layer.visible) {
        let layer = resolved_layer.layer;
        let source = if layer.kind == "image" {
            let Some(image_path) = &layer.image_path else {
                continue;
            };
            if image_path.to_ascii_lowercase().ends_with(".mp4") {
                continue;
            }
            let image_entry = if let Some(entry) = image_cache.get(image_path) {
                entry.clone()
            } else {
                let image = image::open(image_path)
                    .with_context(|| format!("failed to open native scene layer image: {image_path}"))?;
                let rgba = image.to_rgba8();
                let (image_width, image_height) = image.dimensions();
                if image_width == 0 || image_height == 0 {
                    continue;
                }
                let created = NativeImageCacheEntry {
                    width: image_width,
                    height: image_height,
                    rgba: rgba.into_raw(),
                };
                image_cache.insert(image_path.clone(), created.clone());
                created
            };
            Some(NativeDrawableSource {
                width: image_entry.width,
                height: image_entry.height,
                rgba: image_entry.rgba,
                alpha: resolved_layer.world_alpha.clamp(0.0, 1.0),
                transform: resolved_layer.world_transform,
            })
        } else if layer.kind == "text" {
            let text_value = layer.text.as_deref().unwrap_or_default();
            let text_cache_key = format!(
                "{}|{}|{}|{}|{}",
                text_value,
                layer.font_path.as_deref().unwrap_or_default(),
                layer.font_size.unwrap_or(0.0),
                layer.text_color.as_deref().unwrap_or_default(),
                layer.width.round() as i64
            );
            let text_entry = if let Some(entry) = text_cache.get(&layer.id) {
                if entry.cache_key == text_cache_key {
                    Some(entry.clone())
                } else {
                    text_cache.remove(&layer.id);
                    rasterize_text_layer(layer).map(|(width, height, rgba)| {
                        let created = NativeTextCacheEntry {
                            cache_key: text_cache_key.clone(),
                            width,
                            height,
                            rgba,
                        };
                        text_cache.insert(layer.id, created.clone());
                        created
                    })
                }
            } else {
                rasterize_text_layer(layer).map(|(width, height, rgba)| {
                    let created = NativeTextCacheEntry {
                        cache_key: text_cache_key.clone(),
                        width,
                        height,
                        rgba,
                    };
                    text_cache.insert(layer.id, created.clone());
                    created
                })
            };
            text_entry.map(|entry| NativeDrawableSource {
                width: entry.width,
                height: entry.height,
                rgba: entry.rgba,
                alpha: resolved_layer.world_alpha.clamp(0.0, 1.0),
                transform: resolved_layer.world_transform,
            })
        } else {
            None
        };

        let Some(source) = source else {
            continue;
        };
        drawable_sources.push(source);
    }

    let mut drawables = Vec::<NativeSceneDrawable>::new();
    let cache_keys = drawable_sources
        .iter()
        .enumerate()
        .map(|(index, source)| format!("{index}:{}:{}:{}", source.width, source.height, source.alpha))
        .collect::<Vec<_>>();

    cache.retain(|key, _| cache_keys.iter().any(|active| active == key));

    for (index, source) in drawable_sources.into_iter().enumerate() {
        let cache_key = format!("{index}:{}:{}:{}", source.width, source.height, source.alpha);
        let content_key = format!("{:?}", source.rgba);
        let entry = if let Some(existing) = cache.get(&cache_key) {
            if existing.content_key == content_key && existing.width == source.width && existing.height == source.height {
                existing.clone()
            } else {
                cache.remove(&cache_key);
                let texture = device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("wallpaper-engine-native-layer-texture"),
                    size: wgpu::Extent3d {
                        width: source.width,
                        height: source.height,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba8UnormSrgb,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                    view_formats: &[],
                });
                queue.write_texture(
                    wgpu::TexelCopyTextureInfo {
                        texture: &texture,
                        mip_level: 0,
                        origin: wgpu::Origin3d::ZERO,
                        aspect: wgpu::TextureAspect::All,
                    },
                    &source.rgba,
                    wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(source.width * 4),
                        rows_per_image: Some(source.height),
                    },
                    wgpu::Extent3d {
                        width: source.width,
                        height: source.height,
                        depth_or_array_layers: 1,
                    },
                );
                let texture_view = texture.create_view(&wgpu::TextureViewDescriptor::default());
                let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("wallpaper-engine-native-layer-uniform-buffer"),
                    contents: bytemuck::bytes_of(&SceneUniforms {
                        tint: [1.0, 1.0, 1.0, source.alpha],
                    }),
                    usage: wgpu::BufferUsages::UNIFORM,
                });
                let created = NativeDrawableCacheEntry {
                    texture_view,
                    uniform_buffer,
                    width: source.width,
                    height: source.height,
                    content_key,
                };
                cache.insert(cache_key.clone(), created.clone());
                created
            }
        } else {
            let texture = device.create_texture(&wgpu::TextureDescriptor {
                label: Some("wallpaper-engine-native-layer-texture"),
                size: wgpu::Extent3d {
                    width: source.width,
                    height: source.height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8UnormSrgb,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });
            queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                &source.rgba,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(source.width * 4),
                    rows_per_image: Some(source.height),
                },
                wgpu::Extent3d {
                    width: source.width,
                    height: source.height,
                    depth_or_array_layers: 1,
                },
            );
            let texture_view = texture.create_view(&wgpu::TextureViewDescriptor::default());
            let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("wallpaper-engine-native-layer-uniform-buffer"),
                contents: bytemuck::bytes_of(&SceneUniforms {
                    tint: [1.0, 1.0, 1.0, source.alpha],
                }),
                usage: wgpu::BufferUsages::UNIFORM,
            });
            let created = NativeDrawableCacheEntry {
                texture_view,
                uniform_buffer,
                width: source.width,
                height: source.height,
                content_key,
            };
            cache.insert(cache_key.clone(), created.clone());
            created
        };

        let scene_width = runtime.canvas_width.max(1.0) as f32;
        let scene_height = runtime.canvas_height.max(1.0) as f32;
        let half_width = source.width as f32 / 2.0;
        let half_height = source.height as f32 / 2.0;
        let corners = [
            source.transform.transform_point(-half_width, -half_height),
            source.transform.transform_point(half_width, -half_height),
            source.transform.transform_point(half_width, half_height),
            source.transform.transform_point(-half_width, half_height),
        ];
        let to_ndc = |point: [f32; 2]| -> [f32; 2] {
            [
                (point[0] / scene_width) * 2.0 - 1.0,
                1.0 - ((point[1] / scene_height) * 2.0),
            ]
        };
        let vertices = [
            SceneVertex {
                position: to_ndc(corners[0]),
                tex_coord: [0.0, 0.0],
            },
            SceneVertex {
                position: to_ndc(corners[1]),
                tex_coord: [1.0, 0.0],
            },
            SceneVertex {
                position: to_ndc(corners[2]),
                tex_coord: [1.0, 1.0],
            },
            SceneVertex {
                position: to_ndc(corners[3]),
                tex_coord: [0.0, 1.0],
            },
        ];
        let indices: [u16; 6] = [0, 1, 2, 0, 2, 3];
        let vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("wallpaper-engine-native-layer-vertex-buffer"),
            contents: bytemuck::cast_slice(&vertices),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let index_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("wallpaper-engine-native-layer-index-buffer"),
            contents: bytemuck::cast_slice(&indices),
            usage: wgpu::BufferUsages::INDEX,
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("wallpaper-engine-native-layer-bind-group"),
            layout: texture_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&entry.texture_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: entry.uniform_buffer.as_entire_binding(),
                },
            ],
        });
        drawables.push(NativeSceneDrawable {
            vertex_buffer,
            index_buffer,
            index_count: indices.len() as u32,
            bind_group,
        });
    }

    Ok(drawables)
}

#[derive(Clone, Copy)]
struct Transform2D {
    m11: f32,
    m12: f32,
    m21: f32,
    m22: f32,
    tx: f32,
    ty: f32,
}

impl Transform2D {
    fn identity() -> Self {
        Self {
            m11: 1.0,
            m12: 0.0,
            m21: 0.0,
            m22: 1.0,
            tx: 0.0,
            ty: 0.0,
        }
    }

    fn translation(x: f32, y: f32) -> Self {
        Self { tx: x, ty: y, ..Self::identity() }
    }

    fn rotation_radians(angle: f32) -> Self {
        let cos = angle.cos();
        let sin = angle.sin();
        Self {
            m11: cos,
            m12: -sin,
            m21: sin,
            m22: cos,
            tx: 0.0,
            ty: 0.0,
        }
    }

    fn scale(x: f32, y: f32) -> Self {
        Self {
            m11: x,
            m22: y,
            m12: 0.0,
            m21: 0.0,
            tx: 0.0,
            ty: 0.0,
        }
    }

    fn multiply(self, rhs: Self) -> Self {
        Self {
            m11: (self.m11 * rhs.m11) + (self.m12 * rhs.m21),
            m12: (self.m11 * rhs.m12) + (self.m12 * rhs.m22),
            m21: (self.m21 * rhs.m11) + (self.m22 * rhs.m21),
            m22: (self.m21 * rhs.m12) + (self.m22 * rhs.m22),
            tx: (self.m11 * rhs.tx) + (self.m12 * rhs.ty) + self.tx,
            ty: (self.m21 * rhs.tx) + (self.m22 * rhs.ty) + self.ty,
        }
    }

    fn transform_point(self, x: f32, y: f32) -> [f32; 2] {
        [
            (self.m11 * x) + (self.m12 * y) + self.tx,
            (self.m21 * x) + (self.m22 * y) + self.ty,
        ]
    }
}

struct ResolvedNativeLayer<'a> {
    layer: &'a WallpaperEngineSceneLayer,
    world_transform: Transform2D,
    world_alpha: f32,
}

struct NativeSceneScriptHost {
    _runtime: JsRuntime,
    context: JsContext,
    registered_keys: RefCell<HashSet<String>>,
}

impl NativeSceneScriptHost {
    fn new(canvas_width: f64, canvas_height: f64) -> Result<Self> {
        let runtime = JsRuntime::new().context("failed to create QuickJS runtime for native scene renderer")?;
        let context = JsContext::full(&runtime).context("failed to create QuickJS context for native scene renderer")?;
        context.with(|ctx| {
            let globals = ctx.globals();
            let engine = rquickjs::Object::new(ctx.clone())?;
            engine.set("canvasSize", {
                let canvas = rquickjs::Object::new(ctx.clone())?;
                canvas.set("x", canvas_width)?;
                canvas.set("y", canvas_height)?;
                canvas.set("z", 0.0f64)?;
                canvas
            })?;
            engine.set("frametime", 1.0 / 60.0)?;
            engine.set("time", 0.0f64)?;
            globals.set("engine", engine)?;
            globals.set("__celiaScriptRegistry", rquickjs::Object::new(ctx.clone())?)?;
            Ok::<(), rquickjs::Error>(())
        })
        .context("failed to initialize QuickJS engine globals")?;

        Ok(Self {
            _runtime: runtime,
            context,
            registered_keys: RefCell::new(HashSet::new()),
        })
    }

    fn set_time(&self, elapsed_seconds: f64, frame_time: f64) -> Result<()> {
        self.context
            .with(|ctx| {
                let globals = ctx.globals();
                let engine: rquickjs::Object<'_> = globals.get("engine")?;
                engine.set("frametime", frame_time)?;
                engine.set("time", elapsed_seconds)?;
                Ok::<(), rquickjs::Error>(())
            })
            .context("failed to update QuickJS engine timing state")
    }

    fn ensure_property_script(
        &self,
        script_key: &str,
        script_value: &WallpaperEngineSceneScriptValue,
    ) -> Result<NativeScenePropertyScript> {
        let source_for_registration = script_value
            .script
            .replace("export function", "function")
            .replace("export var", "var")
            .replace("export let", "let")
            .replace("export const", "const");

        if self.registered_keys.borrow().contains(script_key) {
            return Ok(NativeScenePropertyScript {
                key: script_key.to_string(),
                has_update: true,
            });
        }

        let key_json = serde_json::to_string(script_key)?;
        let properties_json = serde_json::to_string(&script_value.script_properties)?;
        let initial_json = serde_json::to_string(&script_value.value)?;
        self.context
            .with(|ctx| {
                let bootstrap = format!(
                    r#"
                    (function() {{
                      const __scriptKey = JSON.parse({key_json});
                      var __rawProps = {properties_json};
                      function __unwrap(value) {{
                        if (value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'value')) {{
                          return __unwrap(value.value);
                        }}
                        if (Array.isArray(value)) {{
                          return value.map(__unwrap);
                        }}
                        if (value && typeof value === 'object') {{
                          var result = {{}};
                          for (var key in value) {{
                            result[key] = __unwrap(value[key]);
                          }}
                          return result;
                        }}
                        return value;
                      }}
                      function createScriptProperties() {{
                        return {{
                          addSlider: function() {{ return this; }},
                          addCheckbox: function() {{ return this; }},
                          addText: function() {{ return this; }},
                          addCombo: function() {{ return this; }},
                          addColor: function() {{ return this; }},
                          finish: function() {{ return __unwrap(__rawProps); }}
                        }};
                      }}
                      {source}
                      const __entry = {{
                        update: (typeof update === 'function') ? update : null,
                        init: (typeof init === 'function') ? init : null,
                        state: {initial_json}
                      }};
                      if (__entry.init) {{
                        __entry.init(__entry.state);
                      }}
                      globalThis.__celiaScriptRegistry[__scriptKey] = __entry;
                      return {{
                        hasUpdate: !!__entry.update,
                        hasInit: !!__entry.init
                      }};
                    }})()
                    "#,
                    key_json = key_json,
                    source = source_for_registration,
                );

                let object: rquickjs::Object<'_> = ctx.eval(bootstrap.as_str())?;
                let has_update = object.get::<_, bool>("hasUpdate")?;
                let _has_init = object.get::<_, bool>("hasInit")?;
                Ok::<NativeScenePropertyScript, rquickjs::Error>(NativeScenePropertyScript {
                    key: script_key.to_string(),
                    has_update,
                })
            })
            .context("failed to register native scene property script")?;

        self.registered_keys
            .borrow_mut()
            .insert(script_key.to_string());

        Ok(NativeScenePropertyScript {
            key: script_key.to_string(),
            has_update: true,
        })
    }
}

struct NativeScenePropertyScript {
    key: String,
    has_update: bool,
}

fn evaluate_script_value(
    host: &NativeSceneScriptHost,
    script_key: &str,
    script_value: &WallpaperEngineSceneScriptValue,
    elapsed_seconds: f64,
    frame_time: f64,
) -> Result<serde_json::Value> {
    host.set_time(elapsed_seconds, frame_time)?;
    let compiled = host.ensure_property_script(script_key, script_value)?;
    if !compiled.has_update {
        return Ok(script_value.value.clone());
    }

    let key_json = serde_json::to_string(&compiled.key)?;
    host.context
        .with(|ctx| {
            let eval_source = format!(
                r#"
                (function() {{
                  const __scriptKey = JSON.parse({key_json});
                  const __entry = globalThis.__celiaScriptRegistry[__scriptKey];
                  if (!__entry) {{
                    return "null";
                  }}
                  const __result = __entry.update ? __entry.update(__entry.state) : __entry.state;
                  if (__result !== undefined) {{
                    __entry.state = __result;
                  }}
                  return JSON.stringify(__entry.state);
                }})()
                "#,
                key_json = key_json,
            );
            let json: String = ctx.eval(eval_source.as_str())?;
            Ok::<serde_json::Value, rquickjs::Error>(
                serde_json::from_str(&json).unwrap_or_else(|_| script_value.value.clone()),
            )
        })
        .context("failed to evaluate native scene script")
}

fn value_to_vec3(value: &serde_json::Value) -> Option<(f64, f64, f64)> {
    match value {
        serde_json::Value::String(string) => {
            let mut parts = string
                .split_whitespace()
                .filter_map(|part| part.parse::<f64>().ok());
            Some((
                parts.next().unwrap_or(0.0),
                parts.next().unwrap_or(0.0),
                parts.next().unwrap_or(0.0),
            ))
        }
        serde_json::Value::Object(object) => Some((
            object.get("x").and_then(serde_json::Value::as_f64).unwrap_or(0.0),
            object.get("y").and_then(serde_json::Value::as_f64).unwrap_or(0.0),
            object.get("z").and_then(serde_json::Value::as_f64).unwrap_or(0.0),
        )),
        _ => None,
    }
}

fn value_to_bool(value: &serde_json::Value) -> Option<bool> {
    match value {
        serde_json::Value::Bool(boolean) => Some(*boolean),
        serde_json::Value::Number(number) => number.as_i64().map(|value| value != 0),
        serde_json::Value::String(string) => match string.as_str() {
            "true" | "1" => Some(true),
            "false" | "0" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn value_to_text(value: &serde_json::Value) -> Option<String> {
    value.as_str().map(ToOwned::to_owned)
}

fn runtime_with_dynamic_updates(
    runtime: &WallpaperEngineSceneRuntime,
    host: &NativeSceneScriptHost,
    elapsed_seconds: f64,
    frame_time: f64,
) -> WallpaperEngineSceneRuntime {
    let layers = runtime
        .layers
        .iter()
        .cloned()
        .map(|mut layer| {
            if let Some(script) = &layer.dynamic_origin {
                let key = format!("layer:{}:origin", layer.id);
                if let Ok(value) = evaluate_script_value(host, &key, script, elapsed_seconds, frame_time) {
                    if let Some((x, y, _)) = value_to_vec3(&value) {
                        layer.x = x;
                        layer.y = y;
                    }
                }
            }

            if let Some(script) = &layer.dynamic_scale {
                let key = format!("layer:{}:scale", layer.id);
                if let Ok(value) = evaluate_script_value(host, &key, script, elapsed_seconds, frame_time) {
                    if let Some((x, y, _)) = value_to_vec3(&value) {
                        layer.scale_x = x;
                        layer.scale_y = y;
                    }
                }
            }

            if let Some(script) = &layer.dynamic_text {
                let key = format!("layer:{}:text", layer.id);
                if let Ok(value) = evaluate_script_value(host, &key, script, elapsed_seconds, frame_time) {
                    if let Some(text) = value_to_text(&value) {
                        layer.text = Some(text);
                    }
                }
            }

            if let Some(script) = &layer.dynamic_visible {
                let key = format!("layer:{}:visible", layer.id);
                if let Ok(value) = evaluate_script_value(host, &key, script, elapsed_seconds, frame_time) {
                    if let Some(visible) = value_to_bool(&value) {
                        layer.visible = visible;
                    }
                }
            }

            layer
        })
        .collect::<Vec<_>>();

    WallpaperEngineSceneRuntime {
        project: runtime.project.clone(),
        canvas_width: runtime.canvas_width,
        canvas_height: runtime.canvas_height,
        cache_dir: runtime.cache_dir.clone(),
        layers,
    }
}

fn build_resolved_native_layers<'a>(runtime: &'a WallpaperEngineSceneRuntime) -> Vec<ResolvedNativeLayer<'a>> {
    use std::collections::HashMap;

    fn resolve_layer<'a>(
        layer: &'a WallpaperEngineSceneLayer,
        runtime: &'a WallpaperEngineSceneRuntime,
        layer_map: &HashMap<i64, &'a WallpaperEngineSceneLayer>,
        cache: &mut HashMap<i64, (Transform2D, f32)>,
    ) -> (Transform2D, f32) {
        if let Some(cached) = cache.get(&layer.id) {
            return *cached;
        }

        let local_transform = Transform2D::translation(layer.x as f32, layer.y as f32)
            .multiply(Transform2D::rotation_radians(layer.rotation_z_degrees.to_radians() as f32))
            .multiply(Transform2D::scale(layer.scale_x as f32, layer.scale_y as f32));

        let (world_transform, world_alpha) = if let Some(parent_id) = layer.parent_id {
            if let Some(parent) = layer_map.get(&parent_id) {
                let (parent_transform, parent_alpha) = resolve_layer(parent, runtime, layer_map, cache);
                (parent_transform.multiply(local_transform), parent_alpha * layer.alpha as f32)
            } else {
                (local_transform, layer.alpha as f32)
            }
        } else {
            (local_transform, layer.alpha as f32)
        };

        cache.insert(layer.id, (world_transform, world_alpha));
        (world_transform, world_alpha)
    }

    let layer_map = runtime
        .layers
        .iter()
        .map(|layer| (layer.id, layer))
        .collect::<HashMap<_, _>>();
    let mut cache = HashMap::<i64, (Transform2D, f32)>::new();
    let mut resolved = runtime
        .layers
        .iter()
        .map(|layer| {
            let (world_transform, world_alpha) = resolve_layer(layer, runtime, &layer_map, &mut cache);
            ResolvedNativeLayer {
                layer,
                world_transform,
                world_alpha,
            }
        })
        .collect::<Vec<_>>();
    resolved.sort_by_key(|entry| entry.layer.id);
    resolved
}

fn parse_css_hex_color(color: Option<&str>) -> [u8; 4] {
    let Some(color) = color else {
        return [255, 255, 255, 255];
    };
    let trimmed = color.trim();
    if trimmed.len() == 7 && trimmed.starts_with('#') {
        let parse = |range: std::ops::Range<usize>| u8::from_str_radix(&trimmed[range], 16).ok();
        if let (Some(r), Some(g), Some(b)) = (parse(1..3), parse(3..5), parse(5..7)) {
            return [r, g, b, 255];
        }
    }
    [255, 255, 255, 255]
}

fn rasterize_text_layer(layer: &WallpaperEngineSceneLayer) -> Option<(u32, u32, Vec<u8>)> {
    let text = layer.text.as_ref()?.trim();
    if text.is_empty() {
        return None;
    }
    let font_path = layer.font_path.as_ref()?;
    let font_size = layer.font_size.unwrap_or(48.0).max(8.0) as f32;
    let font_bytes = std::fs::read(font_path).ok()?;
    let font = Font::from_bytes(font_bytes, fontdue::FontSettings::default()).ok()?;
    let color = parse_css_hex_color(layer.text_color.as_deref());

    let max_width = layer.width.max(1.0).round() as usize;
    let max_height = layer.height.max(1.0).round() as usize;
    let line_height = (font_size * 1.1).ceil() as usize;
    let mut bitmap = vec![0u8; max_width * max_height * 4];

    let lines = text.lines().collect::<Vec<_>>();
    let total_text_height = line_height.saturating_mul(lines.len()).max(1);
    let mut pen_y = max_height.saturating_sub(total_text_height) / 2;

    for line in lines {
        let glyphs = line
            .chars()
            .map(|character| {
                let metrics = font.metrics(character, font_size);
                (character, metrics)
            })
            .collect::<Vec<_>>();
        let line_width = glyphs.iter().map(|(_, metrics)| metrics.advance_width.max(0.0)).sum::<f32>().ceil() as usize;
        let mut pen_x = max_width.saturating_sub(line_width) / 2;

        for (character, metrics) in glyphs {
            let (glyph_metrics, glyph_bitmap) = font.rasterize(character, font_size);
            let draw_x = pen_x as isize + glyph_metrics.xmin as isize;
            let draw_y = pen_y as isize + line_height as isize / 2 - glyph_metrics.height as isize / 2;

            for row in 0..glyph_metrics.height {
                for col in 0..glyph_metrics.width {
                    let target_x = draw_x + col as isize;
                    let target_y = draw_y + row as isize;
                    if target_x < 0
                        || target_y < 0
                        || target_x >= max_width as isize
                        || target_y >= max_height as isize
                    {
                        continue;
                    }

                    let coverage = glyph_bitmap[row * glyph_metrics.width + col];
                    let index = ((target_y as usize * max_width) + target_x as usize) * 4;
                    bitmap[index] = color[0];
                    bitmap[index + 1] = color[1];
                    bitmap[index + 2] = color[2];
                    bitmap[index + 3] = coverage;
                }
            }

            pen_x += metrics.advance_width.max(0.0).round() as usize;
        }

        pen_y = pen_y.saturating_add(line_height);
    }

    Some((max_width as u32, max_height as u32, bitmap))
}

pub struct NativeSceneRendererSession {
    stop_flag: Arc<AtomicBool>,
    worker: Option<JoinHandle<Result<()>>>,
}

impl NativeSceneRendererSession {
    pub fn start(
        config: NativeSceneRendererConfig,
        backend_factory: impl FnOnce(&NativeSceneRendererConfig) -> Result<Box<dyn NativeSceneRendererBackend>>,
    ) -> Result<Self> {
        let stop_flag = Arc::new(AtomicBool::new(false));
        let backend = backend_factory(&config)?;
        let worker_stop_flag = Arc::clone(&stop_flag);
        let worker = thread::Builder::new()
            .name("wallpaper-engine-native-renderer".to_string())
            .spawn(move || backend.run(worker_stop_flag))
            .map_err(|error| anyhow!("failed to spawn native renderer worker: {error}"))?;

        Ok(Self {
            stop_flag,
            worker: Some(worker),
        })
    }

    pub fn stop(&mut self) -> Result<()> {
        self.stop_flag.store(true, Ordering::SeqCst);

        if let Some(worker) = self.worker.take() {
            let join_result = worker.join().map_err(|panic_payload| {
                let panic_message = if let Some(message) = panic_payload.downcast_ref::<&str>() {
                    (*message).to_string()
                } else if let Some(message) = panic_payload.downcast_ref::<String>() {
                    message.clone()
                } else {
                    "unknown panic payload".to_string()
                };
                anyhow!("native renderer worker panicked while stopping: {panic_message}")
            })?;
            join_result?;
        }

        Ok(())
    }
}

impl Drop for NativeSceneRendererSession {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

#[cfg(windows)]
pub struct WindowsChildSurfaceRendererBackend {
    config: NativeSceneRendererConfig,
}

#[cfg(windows)]
impl WindowsChildSurfaceRendererBackend {
    pub fn create(config: &NativeSceneRendererConfig) -> Result<Box<dyn NativeSceneRendererBackend>> {
        Ok(Box::new(Self {
            config: config.clone(),
        }))
    }
}

#[cfg(windows)]
impl NativeSceneRendererBackend for WindowsChildSurfaceRendererBackend {
    fn run(self: Box<Self>, stop_flag: Arc<AtomicBool>) -> Result<()> {
        use raw_window_handle::{
            DisplayHandle, HasDisplayHandle, HasWindowHandle, WindowHandle, WindowsDisplayHandle,
            Win32WindowHandle,
        };
        use std::num::NonZeroIsize;
        use windows::{
            core::{w, PCWSTR},
            Win32::{
                Foundation::HWND,
                UI::WindowsAndMessaging::{
                    CreateWindowExW, DestroyWindow, SetWindowPos, ShowWindow, HWND_TOP, SWP_NOACTIVATE,
                    SWP_SHOWWINDOW, SW_SHOW, WINDOW_EX_STYLE, WS_CHILD, WS_CLIPSIBLINGS, WS_VISIBLE,
                },
            },
        };

        struct OwnedRenderWindowHandle {
            hwnd: NonZeroIsize,
        }

        impl HasWindowHandle for OwnedRenderWindowHandle {
            fn window_handle(&self) -> std::result::Result<WindowHandle<'_>, raw_window_handle::HandleError> {
                let mut handle = Win32WindowHandle::new(self.hwnd);
                handle.hinstance = None;
                // SAFETY: hwnd is owned by this struct and remains valid until renderer shutdown.
                Ok(unsafe { WindowHandle::borrow_raw(handle.into()) })
            }
        }

        impl HasDisplayHandle for OwnedRenderWindowHandle {
            fn display_handle(&self) -> std::result::Result<DisplayHandle<'_>, raw_window_handle::HandleError> {
                let handle = WindowsDisplayHandle::new();
                // SAFETY: Windows display handle does not carry borrowed memory.
                Ok(unsafe { DisplayHandle::borrow_raw(handle.into()) })
            }
        }

        let _ = &self.config.folder_path;
        let _ = &self.config.host_window_label;
        let parent_hwnd = HWND(self.config.host_window_hwnd as *mut _);
        let child_hwnd = unsafe {
            CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                w!("STATIC"),
                PCWSTR::null(),
                WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS,
                0,
                0,
                self.config.host_width as i32,
                self.config.host_height as i32,
                Some(parent_hwnd),
                None,
                None,
                None,
            )
        }
        .map_err(|error| anyhow!("failed to create native wallpaper child host window: {error}"))?;

        unsafe {
            let _ = SetWindowPos(
                child_hwnd,
                Some(HWND_TOP),
                0,
                0,
                self.config.host_width as i32,
                self.config.host_height as i32,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
            let _ = ShowWindow(child_hwnd, SW_SHOW);
        }

        let child_hwnd_nonzero = NonZeroIsize::new(child_hwnd.0 as isize)
            .ok_or_else(|| anyhow!("native wallpaper child host HWND was null"))?;
            let surface_window = OwnedRenderWindowHandle {
            hwnd: child_hwnd_nonzero,
        };

        let result = pollster::block_on(async {
            use std::path::Path;

            let instance = wgpu::Instance::default();
            let surface = instance
                .create_surface(&surface_window)
                .context("failed to create wgpu surface for native wallpaper host")?;

            let adapter = instance
                .request_adapter(&wgpu::RequestAdapterOptions {
                    power_preference: wgpu::PowerPreference::HighPerformance,
                    compatible_surface: Some(&surface),
                    force_fallback_adapter: false,
                })
                .await
                .context("failed to acquire wgpu adapter for native wallpaper host")?;

            let (device, queue) = adapter
                .request_device(&wgpu::DeviceDescriptor {
                    label: Some("wallpaper-engine-native-device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::downlevel_defaults(),
                    memory_hints: wgpu::MemoryHints::Performance,
                }, None)
                .await
                .context("failed to create wgpu device for native wallpaper host")?;

            let capabilities = surface.get_capabilities(&adapter);
            let format = capabilities
                .formats
                .first()
                .copied()
                .ok_or_else(|| anyhow!("wgpu surface exposed no supported formats"))?;
            let present_mode = capabilities
                .present_modes
                .iter()
                .copied()
                .find(|mode| *mode == wgpu::PresentMode::Fifo)
                .unwrap_or(wgpu::PresentMode::AutoVsync);
            let alpha_mode = capabilities
                .alpha_modes
                .first()
                .copied()
                .unwrap_or(wgpu::CompositeAlphaMode::Auto);

            let config = wgpu::SurfaceConfiguration {
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                format,
                width: self.config.host_width.max(1),
                height: self.config.host_height.max(1),
                present_mode,
                alpha_mode,
                view_formats: vec![],
                desired_maximum_frame_latency: 2,
            };
            surface.configure(&device, &config);

            let texture_bind_group_layout =
                device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("wallpaper-engine-native-texture-layout"),
                    entries: &[
                        wgpu::BindGroupLayoutEntry {
                            binding: 0,
                            visibility: wgpu::ShaderStages::FRAGMENT,
                            ty: wgpu::BindingType::Texture {
                                multisampled: false,
                                view_dimension: wgpu::TextureViewDimension::D2,
                                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                            },
                            count: None,
                        },
                        wgpu::BindGroupLayoutEntry {
                            binding: 1,
                            visibility: wgpu::ShaderStages::FRAGMENT,
                            ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                            count: None,
                        },
                        wgpu::BindGroupLayoutEntry {
                            binding: 2,
                            visibility: wgpu::ShaderStages::FRAGMENT,
                            ty: wgpu::BindingType::Buffer {
                                ty: wgpu::BufferBindingType::Uniform,
                                has_dynamic_offset: false,
                                min_binding_size: None,
                            },
                            count: None,
                        },
                    ],
                });

            let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("wallpaper-engine-native-scene-shader"),
                source: wgpu::ShaderSource::Wgsl(
                    r#"
struct VertexInput {
  @location(0) position: vec2<f32>,
  @location(1) texCoord: vec2<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) texCoord: vec2<f32>,
};

struct SceneUniforms {
  tint: vec4<f32>,
};

@group(0) @binding(0) var sceneTexture: texture_2d<f32>;
@group(0) @binding(1) var sceneSampler: sampler;
@group(0) @binding(2) var<uniform> sceneUniforms: SceneUniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4<f32>(input.position, 0.0, 1.0);
  output.texCoord = input.texCoord;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let color = textureSample(sceneTexture, sceneSampler, input.texCoord);
  return vec4<f32>(color.rgb * sceneUniforms.tint.rgb, color.a * sceneUniforms.tint.a);
}
"#
                    .into(),
                ),
            });

            let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("wallpaper-engine-native-scene-pipeline-layout"),
                bind_group_layouts: &[&texture_bind_group_layout],
                push_constant_ranges: &[],
            });

            let render_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("wallpaper-engine-native-scene-pipeline"),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &shader,
                    entry_point: Some("vs_main"),
                    buffers: &[SceneVertex::buffer_layout()],
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: Some("fs_main"),
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                }),
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                multiview: None,
                cache: None,
            });

            let base_runtime = prepare_scene_runtime(Path::new(&self.config.folder_path))
                .context("failed to prepare native wallpaper scene runtime")?;
            let script_host = NativeSceneScriptHost::new(base_runtime.canvas_width, base_runtime.canvas_height)
                .context("failed to create native scene script host")?;

            let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
                label: Some("wallpaper-engine-native-sampler"),
                mag_filter: wgpu::FilterMode::Linear,
                min_filter: wgpu::FilterMode::Linear,
                mipmap_filter: wgpu::FilterMode::Linear,
                ..Default::default()
            });
            let mut drawable_cache = std::collections::HashMap::<String, NativeDrawableCacheEntry>::new();
            let mut image_cache = std::collections::HashMap::<String, NativeImageCacheEntry>::new();
            let mut text_cache = std::collections::HashMap::<i64, NativeTextCacheEntry>::new();

            let start = Instant::now();
            while !stop_flag.load(Ordering::SeqCst) {
                let elapsed = start.elapsed().as_secs_f64();
                let dynamic_runtime =
                    runtime_with_dynamic_updates(&base_runtime, &script_host, elapsed, 1.0 / 60.0);
                let drawables = build_native_drawables(
                    &device,
                    &queue,
                    &texture_bind_group_layout,
                    &sampler,
                    &dynamic_runtime,
                    &mut drawable_cache,
                    &mut image_cache,
                    &mut text_cache,
                )
                .context("failed to build native wallpaper drawables")?;
                let frame = match surface.get_current_texture() {
                    Ok(frame) => frame,
                    Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                        surface.configure(&device, &config);
                        continue;
                    }
                    Err(wgpu::SurfaceError::OutOfMemory) => {
                        return Err(anyhow!("wgpu surface ran out of memory"));
                    }
                    Err(wgpu::SurfaceError::Timeout) => {
                        thread::sleep(Duration::from_millis(16));
                        continue;
                    }
                    Err(wgpu::SurfaceError::Other) => {
                        thread::sleep(Duration::from_millis(16));
                        continue;
                    }
                };

                let view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
                let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("wallpaper-engine-native-encoder"),
                });
                {
                    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some("wallpaper-engine-native-clear-pass"),
                        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                            view: &view,
                            resolve_target: None,
                            ops: wgpu::Operations {
                                load: wgpu::LoadOp::Clear(wgpu::Color {
                                    r: 0.02 + ((elapsed * 0.12).sin() * 0.01),
                                    g: 0.03 + ((elapsed * 0.17).cos() * 0.01),
                                    b: 0.05 + ((elapsed * 0.09).sin() * 0.01),
                                    a: 1.0,
                                }),
                                store: wgpu::StoreOp::Store,
                            },
                        })],
                        depth_stencil_attachment: None,
                        occlusion_query_set: None,
                        timestamp_writes: None,
                    });
                    pass.set_pipeline(&render_pipeline);
                    for drawable in &drawables {
                        pass.set_bind_group(0, &drawable.bind_group, &[]);
                        pass.set_vertex_buffer(0, drawable.vertex_buffer.slice(..));
                        pass.set_index_buffer(drawable.index_buffer.slice(..), wgpu::IndexFormat::Uint16);
                        pass.draw_indexed(0..drawable.index_count, 0, 0..1);
                    }
                }

                queue.submit([encoder.finish()]);
                frame.present();
                thread::sleep(Duration::from_millis(16));
            }

            Ok::<(), anyhow::Error>(())
        });

        unsafe {
            let _ = DestroyWindow(child_hwnd);
        }

        result
    }
}

#[cfg(not(windows))]
pub struct NullNativeSceneRendererBackend {
    _config: NativeSceneRendererConfig,
}

#[cfg(not(windows))]
impl NullNativeSceneRendererBackend {
    pub fn create(config: &NativeSceneRendererConfig) -> Result<Box<dyn NativeSceneRendererBackend>> {
        Ok(Box::new(Self {
            _config: config.clone(),
        }))
    }
}

#[cfg(not(windows))]
impl NativeSceneRendererBackend for NullNativeSceneRendererBackend {
    fn run(self: Box<Self>, stop_flag: Arc<AtomicBool>) -> Result<()> {
        while !stop_flag.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(16));
        }
        Ok(())
    }
}

#[cfg(windows)]
pub use WindowsChildSurfaceRendererBackend as PlatformNativeSceneRendererBackend;
#[cfg(not(windows))]
pub use NullNativeSceneRendererBackend as PlatformNativeSceneRendererBackend;
