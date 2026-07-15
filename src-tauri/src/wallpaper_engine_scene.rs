use anyhow::{anyhow, Context, Result};
use bcdec_rs::{bc1, bc2, bc3, bc7};
use image::{ImageBuffer, RgbaImage};
use lz4_flex::block::decompress_into;
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{hash_map::DefaultHasher, HashMap},
    fs,
    hash::{Hash, Hasher},
    io::{Cursor, Read},
    path::{Path, PathBuf},
};

use crate::wallpaper_engine::{
    inspect_project, path_to_string, WallpaperEngineProjectDescriptor, WallpaperEngineProjectKind,
};

const TEXTURE_FORMAT_ARGB8888: u32 = 0;
const TEXTURE_FORMAT_DXT5: u32 = 4;
const TEXTURE_FORMAT_DXT3: u32 = 6;
const TEXTURE_FORMAT_DXT1: u32 = 7;
const TEXTURE_FORMAT_R8: u32 = 9;
const TEXTURE_FORMAT_BC7: u32 = 12;
const TEXTURE_FLAG_VIDEO: u32 = 32;
const FREE_IMAGE_FORMAT_UNKNOWN: u32 = u32::MAX;
const FREE_IMAGE_FORMAT_MP4: u32 = 35;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperEngineSceneRuntime {
    pub project: WallpaperEngineProjectDescriptor,
    pub canvas_width: f64,
    pub canvas_height: f64,
    pub cache_dir: String,
    pub layers: Vec<WallpaperEngineSceneLayer>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperEngineSceneLayer {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub name: String,
    pub kind: String,
    pub anchor: Option<String>,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    pub rotation_z_degrees: f64,
    pub alpha: f64,
    pub visible: bool,
    pub text: Option<String>,
    pub font_path: Option<String>,
    pub font_size: Option<f64>,
    pub text_color: Option<String>,
    pub image_path: Option<String>,
    pub particle_definition: Value,
    pub particle_material_shader: Option<String>,
    pub particle_material_textures: Vec<Option<String>>,
    pub particle_instance_override: Value,
    pub particle_flags: Option<i64>,
    pub puppet_path: Option<String>,
    pub puppet_mesh: Option<WallpaperEngineScenePuppetMesh>,
    pub model_crop_offset_x: f64,
    pub model_crop_offset_y: f64,
    pub lock_transforms: bool,
    pub source_asset_path: Option<String>,
    pub util_layer_kind: Option<String>,
    pub material_shader: Option<String>,
    pub material_textures: Vec<Option<String>>,
    pub material_constants: Value,
    /// All material passes are preserved.  The renderer must not collapse these
    /// to pass zero: util/effect materials commonly use a multi-pass pipeline.
    pub material_passes: Vec<WallpaperEngineSceneMaterialPass>,
    pub effects: Vec<WallpaperEngineSceneEffect>,
    pub animation_layers: Vec<WallpaperEngineSceneAnimationLayer>,
    pub dynamic_origin: Option<WallpaperEngineSceneScriptValue>,
    pub dynamic_scale: Option<WallpaperEngineSceneScriptValue>,
    pub dynamic_angles: Option<WallpaperEngineSceneScriptValue>,
    pub dynamic_alpha: Option<WallpaperEngineSceneScriptValue>,
    pub dynamic_text: Option<WallpaperEngineSceneScriptValue>,
    pub dynamic_visible: Option<WallpaperEngineSceneScriptValue>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperEngineSceneEffect {
    pub kind: String,
    pub source_path: String,
    pub visible: bool,
    pub material_path: Option<String>,
    pub target: Option<String>,
    pub command: Option<String>,
    pub source: Option<String>,
    pub binds: Value,
    pub constant_shader_values: Value,
    pub combos: Value,
    pub texture_paths: Vec<Option<String>>,
    pub material_passes: Vec<WallpaperEngineSceneMaterialPass>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperEngineSceneMaterialPass {
    pub shader: Option<String>,
    pub textures: Vec<Option<String>>,
    pub constants: Value,
    pub combos: Value,
    pub blending: Option<String>,
    pub cull_mode: Option<String>,
    pub depth_test: Option<String>,
    pub depth_write: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperEngineSceneAnimationLayer {
    pub id: i64,
    pub animation: i64,
    pub blend: f64,
    pub rate: f64,
    pub additive: bool,
    pub visible: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperEngineScenePuppetMesh {
    pub version: String,
    pub positions: Vec<f32>,
    pub tex_coords: Vec<f32>,
    pub indices: Vec<u16>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperEngineSceneScriptValue {
    pub script: String,
    pub script_properties: Value,
    pub value: Value,
}

fn build_solid_layer(
    id: i64,
    parent_id: Option<i64>,
    name: String,
    anchor: Option<String>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    scale_x: f64,
    scale_y: f64,
    rotation_z_degrees: f64,
    alpha: f64,
    visible: bool,
    effects: Vec<WallpaperEngineSceneEffect>,
    dynamic_origin: Option<WallpaperEngineSceneScriptValue>,
    dynamic_scale: Option<WallpaperEngineSceneScriptValue>,
    dynamic_angles: Option<WallpaperEngineSceneScriptValue>,
    dynamic_alpha: Option<WallpaperEngineSceneScriptValue>,
    dynamic_visible: Option<WallpaperEngineSceneScriptValue>,
) -> WallpaperEngineSceneLayer {
    WallpaperEngineSceneLayer {
        id,
        parent_id,
        name,
        kind: "solid".to_string(),
        anchor,
        x,
        y,
        width: width.max(1.0),
        height: height.max(1.0),
        scale_x,
        scale_y,
        rotation_z_degrees,
        alpha,
        visible,
        text: None,
        font_path: None,
        font_size: None,
        text_color: None,
        image_path: None,
        particle_definition: Value::Null,
        particle_material_shader: None,
        particle_material_textures: Vec::new(),
        particle_instance_override: Value::Null,
        particle_flags: None,
        puppet_path: None,
        puppet_mesh: None,
        model_crop_offset_x: 0.0,
        model_crop_offset_y: 0.0,
        lock_transforms: false,
        source_asset_path: None,
        util_layer_kind: Some("solid".to_string()),
        material_shader: None,
        material_textures: Vec::new(),
        material_constants: Value::Null,
        material_passes: Vec::new(),
        effects,
        animation_layers: Vec::new(),
        dynamic_origin,
        dynamic_scale,
        dynamic_angles,
        dynamic_alpha,
        dynamic_text: None,
        dynamic_visible,
    }
}

fn is_util_layer_asset_path(asset_path: &str) -> bool {
    let normalized = asset_path.to_ascii_lowercase();
    normalized.contains("solidlayer")
        || normalized.contains("solidlayer_instance")
        || normalized.contains("composelayer")
        || normalized.contains("projectlayer")
        || normalized.contains("fullscreenlayer")
}

fn resolve_util_layer_kind(asset_path: &str) -> Option<String> {
    let normalized = asset_path.to_ascii_lowercase();
    if normalized.contains("composelayer") {
        return Some("composelayer".to_string());
    }
    if normalized.contains("projectlayer") {
        return Some("projectlayer".to_string());
    }
    if normalized.contains("fullscreenlayer") {
        return Some("fullscreenlayer".to_string());
    }
    if normalized.contains("solidlayer") {
        return Some("solidlayer".to_string());
    }
    None
}

#[tauri::command]
pub async fn prepare_wallpaper_engine_scene_runtime(
    folder_path: String,
) -> Result<WallpaperEngineSceneRuntime, String> {
    // Parsing a scene package includes texture decompression and can take
    // seconds. Never run that work on Tauri's command/event executor.
    tauri::async_runtime::spawn_blocking(move || prepare_scene_runtime(Path::new(&folder_path)))
        .await
        .map_err(|error| format!("scene preparation task failed: {error}"))?
        .map_err(|error| error.to_string())
}

pub fn prepare_scene_runtime(folder_path: &Path) -> Result<WallpaperEngineSceneRuntime> {
    let project = inspect_project(folder_path)?;
    if project.wallpaper_type != WallpaperEngineProjectKind::Scene {
        return Err(anyhow!("Wallpaper Engine project is not a scene wallpaper"));
    }

    let package_path = folder_path.join("scene.pkg");
    let package = PackageArchive::open(&package_path)?;
    let scene_json_path = project
        .scene_json_path
        .clone()
        .ok_or_else(|| anyhow!("scene wallpaper does not expose scene.json"))?;
    let scene_json = if Path::new(&scene_json_path).exists() {
        fs::read_to_string(&scene_json_path)
            .with_context(|| format!("failed to read scene json file: {scene_json_path}"))?
    } else {
        package
            .read_text("scene.json")?
            .ok_or_else(|| anyhow!("scene.json was not found in the package"))?
    };
    let scene_value: Value =
        serde_json::from_str(&scene_json).context("failed to parse scene.json from scene wallpaper")?;

    let canvas_width = scene_value
        .get("general")
        .and_then(|general| general.get("orthogonalprojection"))
        .and_then(|projection| projection.get("width"))
        .and_then(resolve_number)
        .unwrap_or(1920.0);
    let canvas_height = scene_value
        .get("general")
        .and_then(|general| general.get("orthogonalprojection"))
        .and_then(|projection| projection.get("height"))
        .and_then(resolve_number)
        .unwrap_or(1080.0);

    let cache_dir = build_cache_dir(folder_path);
    fs::create_dir_all(&cache_dir)
        .with_context(|| format!("failed to create scene runtime cache dir: {}", cache_dir.display()))?;

    let mut extracted_textures = HashMap::<String, String>::new();
    let mut layers = Vec::new();

    for object in scene_value
        .get("objects")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some(layer) = build_scene_layer(
            folder_path,
            &package,
            &cache_dir,
            object,
            &mut extracted_textures,
        )? {
            layers.push(layer);
        }
    }

    Ok(WallpaperEngineSceneRuntime {
        project,
        canvas_width,
        canvas_height,
        cache_dir: path_to_string(&cache_dir),
        layers,
    })
}

fn build_scene_layer(
    folder_path: &Path,
    package: &PackageArchive,
    cache_dir: &Path,
    object: &Value,
    extracted_textures: &mut HashMap<String, String>,
) -> Result<Option<WallpaperEngineSceneLayer>> {
    let id = object.get("id").and_then(resolve_integer).unwrap_or_default();
    let parent_id = object.get("parent").and_then(resolve_integer);
    let name = object
        .get("name")
        .and_then(resolve_string)
        .unwrap_or_default();
    let anchor = object.get("anchor").and_then(resolve_string);
    let visible = object.get("visible").and_then(resolve_bool).unwrap_or(true);
    let alpha = object.get("alpha").and_then(resolve_number).unwrap_or(1.0);
    let lock_transforms = object.get("locktransforms").and_then(resolve_bool).unwrap_or(false);
    let origin = object
        .get("origin")
        .and_then(resolve_vec3)
        .unwrap_or((0.0, 0.0, 0.0));
    let size = object
        .get("size")
        .and_then(resolve_vec3)
        .unwrap_or((0.0, 0.0, 0.0));
    let scale = object
        .get("scale")
        .and_then(resolve_vec3)
        .unwrap_or((1.0, 1.0, 1.0));
    let angles = object
        .get("angles")
        .and_then(resolve_vec3)
        .unwrap_or((0.0, 0.0, 0.0));
    let effects = build_scene_effects(folder_path, package, cache_dir, object, extracted_textures)?;
    let dynamic_origin = object.get("origin").and_then(resolve_script_value);
    let dynamic_scale = object.get("scale").and_then(resolve_script_value);
    let dynamic_angles = object.get("angles").and_then(resolve_script_value);
    let dynamic_alpha = object.get("alpha").and_then(resolve_script_value);
    let dynamic_text = object.get("text").and_then(resolve_script_value);
    let dynamic_visible = object.get("visible").and_then(resolve_script_value);
    let animation_layers = build_scene_animation_layers(object);

    if let Some(particle_source) = object.get("particle") {
        let particle_definition = resolve_particle_definition(folder_path, package, particle_source)?;
        let (particle_material_shader, particle_material_textures) = resolve_particle_material(
            folder_path,
            package,
            cache_dir,
            &particle_definition,
            extracted_textures,
        )?;
        let particle_bounds = estimate_particle_bounds(&particle_definition);
        let particle_flags = particle_definition.get("flags").and_then(resolve_integer);

        return Ok(Some(WallpaperEngineSceneLayer {
            id,
            parent_id,
            name,
            kind: "particle".to_string(),
            anchor,
            x: origin.0,
            y: origin.1,
            width: particle_bounds.0,
            height: particle_bounds.1,
            scale_x: scale.0,
            scale_y: scale.1,
            rotation_z_degrees: angles.2.to_degrees(),
            alpha,
            visible,
            text: None,
            font_path: None,
            font_size: None,
            text_color: None,
            image_path: None,
            particle_definition,
            particle_material_shader,
            particle_material_textures,
            particle_instance_override: object
                .get("instanceoverride")
                .cloned()
                .unwrap_or(Value::Null),
            particle_flags,
            puppet_path: None,
            puppet_mesh: None,
            model_crop_offset_x: 0.0,
            model_crop_offset_y: 0.0,
            lock_transforms,
            source_asset_path: object.get("particle").and_then(resolve_string),
            util_layer_kind: None,
            material_shader: None,
            material_textures: Vec::new(),
            material_constants: Value::Null,
            material_passes: Vec::new(),
            effects,
            animation_layers,
            dynamic_origin,
            dynamic_scale,
            dynamic_angles,
            dynamic_alpha,
            dynamic_text: None,
            dynamic_visible,
        }));
    }

    if let Some(text_value) = object.get("text").and_then(resolve_string) {
        return Ok(Some(WallpaperEngineSceneLayer {
            id,
            parent_id,
            name,
            kind: "text".to_string(),
            anchor,
            x: origin.0,
            y: origin.1,
            width: size.0,
            height: size.1,
            scale_x: scale.0,
            scale_y: scale.1,
            rotation_z_degrees: angles.2.to_degrees(),
            alpha,
            visible,
            text: Some(text_value),
            font_path: object
                .get("font")
                .and_then(resolve_string)
                .and_then(|font| resolve_asset_file(folder_path, package, &font, None)),
            font_size: object.get("pointsize").and_then(resolve_number),
            text_color: object
                .get("color")
                .and_then(resolve_string)
                .map(|color| vec3_color_to_css(&color)),
            image_path: None,
            particle_definition: Value::Null,
            particle_material_shader: None,
            particle_material_textures: Vec::new(),
            particle_instance_override: Value::Null,
            particle_flags: None,
            puppet_path: None,
            puppet_mesh: None,
            model_crop_offset_x: 0.0,
            model_crop_offset_y: 0.0,
            lock_transforms,
            source_asset_path: None,
            util_layer_kind: None,
            material_shader: None,
            material_textures: Vec::new(),
            material_constants: Value::Null,
            material_passes: Vec::new(),
            effects,
            animation_layers,
            dynamic_origin,
            dynamic_scale,
            dynamic_angles,
            dynamic_alpha,
            dynamic_text,
            dynamic_visible,
        }));
    }

    if let Some(image_model_path) = object.get("image").and_then(resolve_string) {
        if is_util_layer_asset_path(&image_model_path)
            || object.get("solid").and_then(resolve_bool).unwrap_or(false)
        {
            let mut layer = build_solid_layer(
                id,
                parent_id,
                name,
                anchor,
                origin.0,
                origin.1,
                size.0,
                size.1,
                scale.0,
                scale.1,
                angles.2.to_degrees(),
                alpha,
                visible,
                effects.clone(),
                dynamic_origin.clone(),
                dynamic_scale.clone(),
                dynamic_angles.clone(),
                dynamic_alpha.clone(),
                dynamic_visible.clone(),
            );
            layer.source_asset_path = Some(image_model_path.clone());
            layer.util_layer_kind = resolve_util_layer_kind(&image_model_path);
            return Ok(Some(layer));
        }

        let resolved_model_path = resolve_asset_path(folder_path, package, &image_model_path, None)
            .ok_or_else(|| anyhow!("failed to resolve scene model asset `{image_model_path}`"))?;
        let model_json = read_asset_text(folder_path, package, &resolved_model_path)?
            .ok_or_else(|| anyhow!("failed to resolve scene model asset `{image_model_path}`"))?;
        let model_value: Value =
            serde_json::from_str(&model_json).with_context(|| format!("failed to parse model `{image_model_path}`"))?;
        let model_width = model_value.get("width").and_then(resolve_number).unwrap_or(size.0.max(1.0));
        let model_height = model_value
            .get("height")
            .and_then(resolve_number)
            .unwrap_or(size.1.max(1.0));
        let model_crop_offset = model_value
            .get("cropoffset")
            .and_then(resolve_vec2)
            .unwrap_or((0.0, 0.0));
        let puppet_path = model_value
            .get("puppet")
            .and_then(resolve_string)
            .and_then(|path| resolve_asset_path(folder_path, package, &path, Some(&resolved_model_path)));
        let puppet_mesh = puppet_path
            .as_deref()
            .map(|path| parse_puppet_mesh(folder_path, package, path, model_width.max(1.0), model_height.max(1.0)))
            .transpose()?;
        let material_path = model_value
            .get("material")
            .and_then(resolve_string)
            .ok_or_else(|| anyhow!("model `{image_model_path}` does not contain a material path"))?;
        if is_util_layer_asset_path(&material_path) || material_path.to_ascii_lowercase().contains("materials/util/") {
            let mut layer = build_solid_layer(
                id,
                parent_id,
                name,
                anchor,
                origin.0,
                origin.1,
                size.0,
                size.1,
                scale.0,
                scale.1,
                angles.2.to_degrees(),
                alpha,
                visible,
                effects,
                dynamic_origin,
                dynamic_scale,
                dynamic_angles,
                dynamic_alpha,
                dynamic_visible,
            );
            layer.source_asset_path = Some(image_model_path.clone());
            layer.util_layer_kind = resolve_util_layer_kind(&image_model_path)
                .or_else(|| resolve_util_layer_kind(&material_path));
            return Ok(Some(layer));
        }
        let resolved_material_path = resolve_asset_path(folder_path, package, &material_path, Some(&resolved_model_path))
            .ok_or_else(|| anyhow!("failed to resolve material asset `{material_path}`"))?;
        let Some(material_json) = read_asset_text(folder_path, package, &resolved_material_path)? else {
            return Ok(None);
        };
        let material_value: Value = serde_json::from_str(&material_json)
            .with_context(|| format!("failed to parse material `{material_path}`"))?;
        let first_pass = material_value
            .get("passes")
            .and_then(Value::as_array)
            .and_then(|passes| passes.first())
            .ok_or_else(|| anyhow!("material `{material_path}` does not contain any passes"))?;
        let texture_name = first_pass
            .get("textures")
            .and_then(Value::as_array)
            .and_then(|textures| textures.first())
            .and_then(resolve_string)
            .ok_or_else(|| anyhow!("material `{material_path}` does not contain a texture reference"))?;
        let material_textures = first_pass
            .get("textures")
            .and_then(Value::as_array)
            .map(|textures| {
                textures
                    .iter()
                    .map(|texture| {
                        let texture_name = resolve_string(texture)?;
                        resolve_and_extract_texture(
                            folder_path,
                            package,
                            cache_dir,
                            &texture_name,
                            extracted_textures,
                        )
                        .ok()
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let image_path = resolve_and_extract_texture(
            folder_path,
            package,
            cache_dir,
            &texture_name,
            extracted_textures,
        )?;

        return Ok(Some(WallpaperEngineSceneLayer {
            id,
            parent_id,
            name,
            kind: "image".to_string(),
            anchor,
            x: origin.0,
            y: origin.1,
            width: size.0.max(model_width),
            height: size.1.max(model_height),
            scale_x: scale.0,
            scale_y: scale.1,
            rotation_z_degrees: angles.2.to_degrees(),
            alpha,
            visible,
            text: None,
            font_path: None,
            font_size: None,
            text_color: None,
            image_path: Some(image_path),
            particle_definition: Value::Null,
            particle_material_shader: None,
            particle_material_textures: Vec::new(),
            particle_instance_override: Value::Null,
            particle_flags: None,
            puppet_path,
            puppet_mesh,
            model_crop_offset_x: model_crop_offset.0,
            model_crop_offset_y: model_crop_offset.1,
            lock_transforms,
            source_asset_path: Some(image_model_path),
            util_layer_kind: None,
            material_shader: first_pass.get("shader").and_then(resolve_string),
            material_textures,
            material_constants: first_pass
                .get("constantshadervalues")
                .cloned()
                .unwrap_or(Value::Null),
            material_passes: build_material_passes(
                folder_path,
                package,
                cache_dir,
                &material_value,
                extracted_textures,
            )?,
            effects,
            animation_layers,
            dynamic_origin,
            dynamic_scale,
            dynamic_angles,
            dynamic_alpha,
            dynamic_text: None,
            dynamic_visible,
        }));
    }

    if object.get("solid").and_then(resolve_bool).unwrap_or(false) {
            return Ok(Some(build_solid_layer(
                id,
                parent_id,
                name,
                anchor,
                origin.0,
                origin.1,
                size.0,
            size.1,
            scale.0,
                scale.1,
                angles.2.to_degrees(),
                alpha,
                visible,
                effects,
                dynamic_origin,
                dynamic_scale,
                dynamic_angles,
                dynamic_alpha,
                dynamic_visible,
            )));
    }

    Ok(None)
}

fn resolve_and_extract_texture(
    folder_path: &Path,
    package: &PackageArchive,
    cache_dir: &Path,
    texture_name: &str,
    extracted_textures: &mut HashMap<String, String>,
) -> Result<String> {
    if let Some(existing) = extracted_textures.get(texture_name) {
        return Ok(existing.clone());
    }

    let resolved_texture_path = resolve_texture_asset_path(folder_path, package, texture_name)
        .ok_or_else(|| anyhow!("failed to locate texture asset `{texture_name}`"))?;
    if let Some(cached) = find_cached_texture(cache_dir, &resolved_texture_path) {
        let cached_path = path_to_string(&cached);
        extracted_textures.insert(texture_name.to_string(), cached_path.clone());
        return Ok(cached_path);
    }
    let texture_bytes = read_asset_bytes(folder_path, package, &resolved_texture_path)?
        .ok_or_else(|| anyhow!("failed to read texture asset `{resolved_texture_path}`"))?;
    let extracted_path = extract_texture_to_cache(cache_dir, &resolved_texture_path, &texture_bytes)?;
    extracted_textures.insert(texture_name.to_string(), extracted_path.clone());
    Ok(extracted_path)
}

fn extract_texture_to_cache(cache_dir: &Path, asset_path: &str, texture_bytes: &[u8]) -> Result<String> {
    let texture = parse_tex(texture_bytes)?;
    let stem = Path::new(asset_path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("texture");
    let mut hasher = DefaultHasher::new();
    asset_path.hash(&mut hasher);
    let cache_key = hasher.finish();
    let output_path = if texture.is_video_mp4 {
        cache_dir.join(format!("{}-{cache_key:016x}.mp4", sanitize_file_name(stem)))
    } else {
        cache_dir.join(format!("{}-{cache_key:016x}.png", sanitize_file_name(stem)))
    };

    if texture.is_video_mp4 {
        fs::write(&output_path, &texture.image_bytes)
            .with_context(|| format!("failed to write decoded video texture: {}", output_path.display()))?;
        return Ok(path_to_string(&output_path));
    }

    let width = texture.width;
    let height = texture.height;
    let rgba_bytes = decode_texture_to_rgba(&texture)?;
    let image: RgbaImage = ImageBuffer::from_raw(width, height, rgba_bytes)
        .ok_or_else(|| anyhow!("decoded texture buffer size does not match image dimensions"))?;
    image
        .save(&output_path)
        .with_context(|| format!("failed to save decoded texture png: {}", output_path.display()))?;

    Ok(path_to_string(&output_path))
}

fn find_cached_texture(cache_dir: &Path, asset_path: &str) -> Option<PathBuf> {
    let stem = Path::new(asset_path).file_stem()?.to_str()?;
    let mut hasher = DefaultHasher::new();
    asset_path.hash(&mut hasher);
    let cache_key = hasher.finish();
    ["png", "mp4"]
        .into_iter()
        .map(|extension| cache_dir.join(format!("{}-{cache_key:016x}.{extension}", sanitize_file_name(stem))))
        .find(|path| path.is_file())
}

fn parse_puppet_mesh(
    folder_path: &Path,
    package: &PackageArchive,
    puppet_asset_path: &str,
    width: f64,
    height: f64,
) -> Result<WallpaperEngineScenePuppetMesh> {
    let data = read_asset_bytes(folder_path, package, puppet_asset_path)?
        .ok_or_else(|| anyhow!("failed to read puppet asset `{puppet_asset_path}`"))?;

    const MARKER_SIZE: usize = 9;
    const MESH_HEADER_SIZE: usize = 8;
    const VERTEX_STRIDE: usize = 80;
    const POSITION_OFFSET: usize = 0;
    const UV_OFFSET: usize = 72;

    if data.len() < MARKER_SIZE {
        return Err(anyhow!("puppet asset `{puppet_asset_path}` is too small"));
    }

    let version = String::from_utf8_lossy(&data[..MARKER_SIZE])
        .trim_end_matches('\0')
        .to_string();
    if version != "MDLV0021" && version != "MDLV0023" {
        return Err(anyhow!("unsupported puppet model header `{version}`"));
    }

    let mdls_offset = data
        .windows(4)
        .position(|window| window == b"MDLS")
        .unwrap_or(data.len());
    let mesh_block = find_puppet_mesh_block(&data, MARKER_SIZE, mdls_offset, MESH_HEADER_SIZE, VERTEX_STRIDE)
        .ok_or_else(|| anyhow!("could not find a usable MDLV mesh block in `{puppet_asset_path}`"))?;

    let vertex_count = mesh_block.vertex_bytes / VERTEX_STRIDE;
    let vertices_offset = mesh_block.header_offset + MESH_HEADER_SIZE;
    let indices_offset = vertices_offset + mesh_block.vertex_bytes + 4;
    let index_count = mesh_block.index_bytes / 2;

    let mut positions = Vec::with_capacity(vertex_count * 3);
    let mut tex_coords = Vec::with_capacity(vertex_count * 2);
    let mut raw_positions = Vec::with_capacity(vertex_count * 3);

    for index in 0..vertex_count {
        let vertex_offset = vertices_offset + index * VERTEX_STRIDE;
        let x = read_f32_at(&data, vertex_offset + POSITION_OFFSET)?;
        let y = read_f32_at(&data, vertex_offset + POSITION_OFFSET + 4)?;
        let z = read_f32_at(&data, vertex_offset + POSITION_OFFSET + 8)?;
        let u = read_f32_at(&data, vertex_offset + UV_OFFSET)?;
        let v = read_f32_at(&data, vertex_offset + UV_OFFSET + 4)?;
        raw_positions.extend_from_slice(&[x, y, z]);
        tex_coords.extend_from_slice(&[u, v]);
    }

    let mut indices = Vec::with_capacity(index_count);
    for index in 0..index_count {
        let offset = indices_offset + index * 2;
        let value = read_u16_at(&data, offset)?;
        if value as usize >= vertex_count {
            return Err(anyhow!("invalid puppet mesh index `{value}` in `{puppet_asset_path}`"));
        }
        indices.push(value);
    }

    positions.reserve(raw_positions.len());
    let half_width = (width as f32) / 2.0;
    let half_height = (height as f32) / 2.0;
    for chunk in raw_positions.chunks_exact(3) {
        positions.push(half_width + chunk[0]);
        positions.push(half_height - chunk[1]);
        positions.push(chunk[2]);
    }

    Ok(WallpaperEngineScenePuppetMesh {
        version,
        positions,
        tex_coords,
        indices,
    })
}

struct PuppetMeshBlock {
    header_offset: usize,
    vertex_bytes: usize,
    index_bytes: usize,
}

fn find_puppet_mesh_block(
    data: &[u8],
    marker_size: usize,
    mdls_offset: usize,
    mesh_header_size: usize,
    vertex_stride: usize,
) -> Option<PuppetMeshBlock> {
    for offset in marker_size..mdls_offset {
        if offset + mesh_header_size + 4 >= mdls_offset {
            break;
        }

        let Ok(candidate_vertex_bytes) = read_u32_at(data, offset + 4).map(|value| value as usize) else {
            continue;
        };
        let vertices_offset = offset + mesh_header_size;
        let index_length_offset = vertices_offset + candidate_vertex_bytes;

        if candidate_vertex_bytes == 0
            || candidate_vertex_bytes % vertex_stride != 0
            || index_length_offset + 4 > mdls_offset
        {
            continue;
        }

        let Ok(candidate_index_bytes) = read_u32_at(data, index_length_offset).map(|value| value as usize) else {
            continue;
        };
        let indices_offset = index_length_offset + 4;
        if candidate_index_bytes == 0
            || candidate_index_bytes % (2 * 3) != 0
            || indices_offset + candidate_index_bytes > mdls_offset
        {
            continue;
        }

        return Some(PuppetMeshBlock {
            header_offset: offset,
            vertex_bytes: candidate_vertex_bytes,
            index_bytes: candidate_index_bytes,
        });
    }

    None
}

struct ParsedTex {
    format: u32,
    flags: u32,
    width: u32,
    height: u32,
    free_image_format: u32,
    is_video_mp4: bool,
    container_version: u32,
    image_bytes: Vec<u8>,
}

const CONTAINER_VERSION_TEXB0001: u32 = 1;
const CONTAINER_VERSION_TEXB0002: u32 = 2;
const CONTAINER_VERSION_TEXB0003: u32 = 3;
const CONTAINER_VERSION_TEXB0004: u32 = 4;

fn parse_tex(texture_bytes: &[u8]) -> Result<ParsedTex> {
    let mut cursor = Cursor::new(texture_bytes);
    let magic1 = read_c_string(&mut cursor)?;
    if magic1 != "TEXV0005" {
        return Err(anyhow!("unexpected texture magic `{magic1}`"));
    }
    let magic2 = read_c_string(&mut cursor)?;
    if magic2 != "TEXI0001" {
        return Err(anyhow!("unexpected texture sub-magic `{magic2}`"));
    }

    let format = read_u32(&mut cursor)?;
    let flags = read_u32(&mut cursor)?;
    let _texture_width = read_u32(&mut cursor)?;
    let _texture_height = read_u32(&mut cursor)?;
    let _width = read_u32(&mut cursor)?;
    let _height = read_u32(&mut cursor)?;
    let _unknown = read_u32(&mut cursor)?;
    let container_magic = read_c_string(&mut cursor)?;
    let image_count = read_u32(&mut cursor)?;
    let mut is_video_mp4 = false;
    let mut free_image_format = FREE_IMAGE_FORMAT_UNKNOWN;

    let container_version = if container_magic == "TEXB0004" {
        free_image_format = read_u32(&mut cursor)?;
        is_video_mp4 = read_u32(&mut cursor)? == 1;
        if is_video_mp4 {
            CONTAINER_VERSION_TEXB0004
        } else {
            CONTAINER_VERSION_TEXB0003
        }
    } else if container_magic == "TEXB0003" {
        free_image_format = read_u32(&mut cursor)?;
        CONTAINER_VERSION_TEXB0003
    } else if container_magic == "TEXB0002" {
        CONTAINER_VERSION_TEXB0002
    } else if container_magic == "TEXB0001" {
        CONTAINER_VERSION_TEXB0001
    } else {
        return Err(anyhow!("unsupported texture container `{container_magic}`"));
    };

    if image_count == 0 {
        return Err(anyhow!("texture container does not contain any images"));
    }

    let mipmap_count = read_u32(&mut cursor)?;
    if mipmap_count == 0 {
        return Err(anyhow!("texture image does not contain mipmaps"));
    }

    if container_version == CONTAINER_VERSION_TEXB0004 {
        let _unknown_a = read_u32(&mut cursor)?;
        let _unknown_b = read_u32(&mut cursor)?;
        let _json = read_c_string(&mut cursor)?;
        let _unknown_c = read_u32(&mut cursor)?;
    }

    let width = read_u32(&mut cursor)?;
    let height = read_u32(&mut cursor)?;
    let compression = if container_version == CONTAINER_VERSION_TEXB0004
        || container_version == CONTAINER_VERSION_TEXB0003
        || container_version == CONTAINER_VERSION_TEXB0002
    {
        read_u32(&mut cursor)?
    } else {
        0
    };
    let uncompressed_size = if container_version == CONTAINER_VERSION_TEXB0004
        || container_version == CONTAINER_VERSION_TEXB0003
        || container_version == CONTAINER_VERSION_TEXB0002
    {
        read_i32(&mut cursor)?
    } else {
        0
    };
    let compressed_size = read_i32(&mut cursor)?;

    let byte_count = if uncompressed_size > 0 {
        uncompressed_size as usize
    } else {
        compressed_size as usize
    };
    let mut image_bytes = vec![0u8; compressed_size.max(0) as usize];
    cursor
        .read_exact(&mut image_bytes)
        .context("failed to read texture image payload")?;

    let image_bytes = match compression {
        0 => image_bytes,
        1 => {
            let mut decompressed = vec![0u8; byte_count];
            decompress_into(&image_bytes, &mut decompressed)
                .map_err(|error| anyhow!("failed to LZ4-decompress texture mipmap: {error}"))?;
            decompressed
        }
        other => {
            return Err(anyhow!("unsupported texture compression mode `{other}`"));
        }
    };

    let is_video_mp4 = is_video_mp4
        || free_image_format == FREE_IMAGE_FORMAT_MP4
        || flags & TEXTURE_FLAG_VIDEO != 0
        || image_bytes
            .windows(8)
            .any(|window| matches!(window, b"ftypmp42" | b"ftypisom" | b"ftypMSNV" | b"ftypmp41"));

    Ok(ParsedTex {
        format,
        flags,
        width,
        height,
        free_image_format,
        is_video_mp4,
        container_version,
        image_bytes,
    })
}

fn decode_texture_to_rgba(texture: &ParsedTex) -> Result<Vec<u8>> {
    if texture.free_image_format != FREE_IMAGE_FORMAT_UNKNOWN {
        let image = image::load_from_memory(&texture.image_bytes)
            .with_context(|| format!("failed to decode embedded image texture format `{}`", texture.free_image_format))?;
        return Ok(image.to_rgba8().into_raw());
    }

    match texture.format {
        TEXTURE_FORMAT_ARGB8888 => {
            let expected_size = texture.width as usize * texture.height as usize * 4;
            if texture.image_bytes.len() == expected_size {
                Ok(texture.image_bytes.clone())
            } else {
                Err(anyhow!(
                    "ARGB8888 texture payload size mismatch: expected {expected_size} bytes, got {} (flags={}, free_image_format={}, container_version={})",
                    texture.image_bytes.len(),
                    texture.flags,
                    texture.free_image_format,
                    texture.container_version,
                ))
            }
        }
        TEXTURE_FORMAT_R8 => Ok(texture
            .image_bytes
            .iter()
            .copied()
            .into_iter()
            .flat_map(|value| [255, 255, 255, value])
            .collect()),
        TEXTURE_FORMAT_DXT1 => decode_bc_texture(texture.width, texture.height, &texture.image_bytes, 8, |block, out, pitch| {
            bc1(block, out, pitch);
        }),
        TEXTURE_FORMAT_DXT3 => decode_bc_texture(texture.width, texture.height, &texture.image_bytes, 16, |block, out, pitch| {
            bc2(block, out, pitch);
        }),
        TEXTURE_FORMAT_DXT5 => decode_bc_texture(texture.width, texture.height, &texture.image_bytes, 16, |block, out, pitch| {
            bc3(block, out, pitch);
        }),
        TEXTURE_FORMAT_BC7 => decode_bc_texture(texture.width, texture.height, &texture.image_bytes, 16, |block, out, pitch| {
            bc7(block, out, pitch);
        }),
        other => Err(anyhow!("texture format `{other}` is not implemented yet")),
    }
}

fn decode_bc_texture<F>(
    width: u32,
    height: u32,
    bytes: &[u8],
    bytes_per_block: usize,
    decode_block: F,
) -> Result<Vec<u8>>
where
    F: Fn(&[u8], &mut [u8], usize),
{
    let block_width = width.div_ceil(4) as usize;
    let block_height = height.div_ceil(4) as usize;
    let expected_size = block_width * block_height * bytes_per_block;
    if bytes.len() < expected_size {
        return Err(anyhow!(
            "compressed texture payload is too small: expected at least {expected_size} bytes, got {}",
            bytes.len()
        ));
    }

    let mut rgba = vec![0u8; width as usize * height as usize * 4];
    let mut block_rgba = [0u8; 4 * 4 * 4];

    for block_y in 0..block_height {
        for block_x in 0..block_width {
            let block_index = (block_y * block_width + block_x) * bytes_per_block;
            let block = &bytes[block_index..block_index + bytes_per_block];
            decode_block(block, &mut block_rgba, 4 * 4);

            for local_y in 0..4usize {
                let pixel_y = block_y * 4 + local_y;
                if pixel_y >= height as usize {
                    break;
                }

                for local_x in 0..4usize {
                    let pixel_x = block_x * 4 + local_x;
                    if pixel_x >= width as usize {
                        break;
                    }

                    let source_index = (local_y * 4 + local_x) * 4;
                    let destination_index = (pixel_y * width as usize + pixel_x) * 4;
                    rgba[destination_index..destination_index + 4]
                        .copy_from_slice(&block_rgba[source_index..source_index + 4]);
                }
            }
        }
    }

    Ok(rgba)
}

fn build_cache_dir(folder_path: &Path) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    folder_path.to_string_lossy().hash(&mut hasher);
    let hash = hasher.finish();
    std::env::temp_dir()
        .join("celia-music-next-gen")
        .join("wallpaper-engine")
        .join(format!("{hash:016x}"))
}

fn sanitize_file_name(name: &str) -> String {
    name.chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn normalize_asset_path(asset_path: &str) -> String {
    asset_path.replace('\\', "/")
}

fn resolve_asset_path(
    folder_path: &Path,
    package: &PackageArchive,
    asset_path: &str,
    relative_to: Option<&str>,
) -> Option<String> {
    let normalized = normalize_asset_path(asset_path);
    let mut candidates = Vec::new();
    candidates.push(normalized.clone());

    if let Some(base_path) = relative_to {
        if let Some(parent) = Path::new(base_path).parent() {
            let joined = normalize_asset_path(&parent.join(&normalized).to_string_lossy());
            if !candidates.iter().any(|candidate| candidate == &joined) {
                candidates.push(joined);
            }
        }
    }

    for candidate in &candidates {
        let loose_path = folder_path.join(candidate);
        if loose_path.exists() {
            return Some(candidate.clone());
        }

        if let Some(entry_path) = package.resolve_entry_path(candidate) {
            return Some(entry_path);
        }
    }

    None
}

fn resolve_asset_file(
    folder_path: &Path,
    package: &PackageArchive,
    asset_path: &str,
    relative_to: Option<&str>,
) -> Option<String> {
    let resolved_path = resolve_asset_path(folder_path, package, asset_path, relative_to)?;
    let loose_path = folder_path.join(&resolved_path);
    if loose_path.exists() {
        return Some(path_to_string(&loose_path));
    }

    if package.resolve_entry_path(&resolved_path).is_some() {
        return Some(resolved_path);
    }

    None
}

fn read_asset_text(folder_path: &Path, package: &PackageArchive, asset_path: &str) -> Result<Option<String>> {
    if let Some(bytes) = read_asset_bytes(folder_path, package, asset_path)? {
        return Ok(Some(String::from_utf8(bytes).with_context(|| format!("asset `{asset_path}` is not valid utf-8"))?));
    }

    Ok(None)
}

fn read_asset_bytes(folder_path: &Path, package: &PackageArchive, asset_path: &str) -> Result<Option<Vec<u8>>> {
    let normalized_path = normalize_asset_path(asset_path);
    let loose_path = folder_path.join(&normalized_path);
    if loose_path.exists() {
        return Ok(Some(
            fs::read(&loose_path)
                .with_context(|| format!("failed to read asset file: {}", loose_path.display()))?,
        ));
    }

    package.read_bytes(&normalized_path)
}

fn resolve_texture_asset_path(folder_path: &Path, package: &PackageArchive, texture_name: &str) -> Option<String> {
    let normalized_name = normalize_asset_path(texture_name);
    if normalized_name.contains('/') && normalized_name.ends_with(".tex") {
        if let Some(resolved_path) = resolve_asset_path(folder_path, package, &normalized_name, None) {
            return Some(resolved_path);
        }
    }

    let direct_texture_path = format!("materials/{texture_name}.tex");
    if folder_path.join(&direct_texture_path).exists() {
        return Some(direct_texture_path);
    }
    if let Some(entry_path) = package.resolve_entry_path(&direct_texture_path) {
        return Some(entry_path);
    }

    package
        .entries
        .keys()
        .find(|entry| {
            entry.starts_with("materials/")
                && entry.ends_with(".tex")
                && Path::new(entry)
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .is_some_and(|stem| stem == texture_name)
            })
        .cloned()
}

fn build_scene_effects(
    folder_path: &Path,
    package: &PackageArchive,
    cache_dir: &Path,
    object: &Value,
    extracted_textures: &mut HashMap<String, String>,
) -> Result<Vec<WallpaperEngineSceneEffect>> {
    let mut effects = Vec::new();
    let Some(effect_values) = object.get("effects").and_then(Value::as_array) else {
        return Ok(effects);
    };

    for effect in effect_values {
        let Some(source_path) = effect.get("file").and_then(resolve_string) else {
            continue;
        };
        let visible = effect.get("visible").and_then(resolve_bool).unwrap_or(true);
        let resolved_source_path = resolve_asset_path(folder_path, package, &source_path, None)
            .unwrap_or_else(|| source_path.clone());
        let effect_definition = read_asset_text(folder_path, package, &resolved_source_path)?
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .unwrap_or(Value::Null);
        let kind = effect_definition
            .get("replacementkey")
            .and_then(resolve_string)
            .or_else(|| {
                Path::new(&source_path)
                    .parent()
                    .and_then(Path::file_name)
                    .and_then(|name| name.to_str())
                    .map(ToOwned::to_owned)
            })
            .unwrap_or_else(|| "unknown".to_string());

        for pass in effect
            .get("passes")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let material_path = pass
                .get("material")
                .and_then(resolve_string)
                .and_then(|path| resolve_asset_path(folder_path, package, &path, None).or(Some(path)));
            let texture_paths = pass
                .get("textures")
                .and_then(Value::as_array)
                .map(|textures| {
                    textures
                        .iter()
                        .map(|texture| {
                            let texture_name = resolve_string(texture)?;
                            resolve_and_extract_texture(
                                folder_path,
                                package,
                                cache_dir,
                                &texture_name,
                                extracted_textures,
                            )
                            .ok()
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let material_passes = material_path
                .as_deref()
                .and_then(|path| read_asset_text(folder_path, package, path).ok().flatten())
                .and_then(|text| serde_json::from_str::<Value>(&text).ok())
                .map(|material| {
                    build_material_passes(
                        folder_path,
                        package,
                        cache_dir,
                        &material,
                        extracted_textures,
                    )
                })
                .transpose()?
                .unwrap_or_default();

            effects.push(WallpaperEngineSceneEffect {
                kind: kind.clone(),
                source_path: resolved_source_path.clone(),
                visible,
                material_path,
                target: pass.get("target").and_then(resolve_string),
                command: pass.get("command").and_then(resolve_string),
                source: pass.get("source").and_then(resolve_string),
                binds: pass.get("bind").cloned().unwrap_or(Value::Null),
                constant_shader_values: pass
                    .get("constantshadervalues")
                    .cloned()
                    .unwrap_or(Value::Null),
                combos: pass.get("combos").cloned().unwrap_or(Value::Null),
                texture_paths,
                material_passes,
            });
        }
    }

    Ok(effects)
}

/// Mirrors the material-pass expansion done by CImage::setup in the reference
/// renderer.  Paths are decoded here so the WebGL runtime only deals with real
/// file URLs and named FBO bindings.
fn build_material_passes(
    folder_path: &Path,
    package: &PackageArchive,
    cache_dir: &Path,
    material: &Value,
    extracted_textures: &mut HashMap<String, String>,
) -> Result<Vec<WallpaperEngineSceneMaterialPass>> {
    material
        .get("passes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|pass| {
            let textures = pass
                .get("textures")
                .and_then(Value::as_array)
                .map(|textures| {
                    textures
                        .iter()
                        .map(|texture| {
                            let name = resolve_string(texture)?;
                            if name.starts_with("_rt_") || name.starts_with("_alias_") {
                                return Some(name);
                            }
                            resolve_and_extract_texture(
                                folder_path,
                                package,
                                cache_dir,
                                &name,
                                extracted_textures,
                            )
                            .ok()
                        })
                        .collect()
                })
                .unwrap_or_default();
            Ok(WallpaperEngineSceneMaterialPass {
                shader: pass.get("shader").and_then(resolve_string),
                textures,
                constants: pass
                    .get("constantshadervalues")
                    .cloned()
                    .unwrap_or(Value::Null),
                combos: pass.get("combos").cloned().unwrap_or(Value::Null),
                blending: pass.get("blending").and_then(resolve_string),
                cull_mode: pass.get("cullmode").and_then(resolve_string),
                depth_test: pass.get("depthtest").and_then(resolve_string),
                depth_write: pass.get("depthwrite").and_then(resolve_string),
            })
        })
        .collect()
}

fn build_scene_animation_layers(object: &Value) -> Vec<WallpaperEngineSceneAnimationLayer> {
    object
        .get("animationlayers")
        .and_then(Value::as_array)
        .map(|layers| {
            layers
                .iter()
                .map(|layer| WallpaperEngineSceneAnimationLayer {
                    id: layer.get("id").and_then(resolve_integer).unwrap_or_default(),
                    animation: layer.get("animation").and_then(resolve_integer).unwrap_or_default(),
                    blend: layer.get("blend").and_then(resolve_number).unwrap_or(1.0),
                    rate: layer.get("rate").and_then(resolve_number).unwrap_or(1.0),
                    additive: layer.get("additive").and_then(resolve_bool).unwrap_or(false),
                    visible: layer.get("visible").and_then(resolve_bool).unwrap_or(true),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn resolve_particle_definition(folder_path: &Path, package: &PackageArchive, source: &Value) -> Result<Value> {
    if let Some(path) = resolve_string(source) {
        let resolved_path = resolve_asset_path(folder_path, package, &path, None)
            .unwrap_or(path);
        let Some(json) = read_asset_text(folder_path, package, &resolved_path)? else {
            return Err(anyhow!("failed to resolve particle asset `{resolved_path}`"));
        };
        return serde_json::from_str(&json)
            .with_context(|| format!("failed to parse particle definition `{resolved_path}`"));
    }

    Ok(source.clone())
}

fn resolve_particle_material(
    folder_path: &Path,
    package: &PackageArchive,
    cache_dir: &Path,
    particle_definition: &Value,
    extracted_textures: &mut HashMap<String, String>,
) -> Result<(Option<String>, Vec<Option<String>>)> {
    let Some(material_path) = particle_definition.get("material").and_then(resolve_string) else {
        return Ok((None, Vec::new()));
    };
    let resolved_material_path = resolve_asset_path(folder_path, package, &material_path, None)
        .unwrap_or(material_path);
    let Some(material_json) = read_asset_text(folder_path, package, &resolved_material_path)? else {
        return Ok((None, Vec::new()));
    };
    let material_value: Value = serde_json::from_str(&material_json)
        .with_context(|| format!("failed to parse particle material `{resolved_material_path}`"))?;
    let Some(first_pass) = material_value
        .get("passes")
        .and_then(Value::as_array)
        .and_then(|passes| passes.first())
    else {
        return Ok((None, Vec::new()));
    };

    let textures = first_pass
        .get("textures")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|texture| {
                    let texture_name = resolve_string(texture)?;
                    resolve_and_extract_texture(
                        folder_path,
                        package,
                        cache_dir,
                        &texture_name,
                        extracted_textures,
                    )
                    .ok()
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok((first_pass.get("shader").and_then(resolve_string), textures))
}

fn estimate_particle_bounds(particle_definition: &Value) -> (f64, f64) {
    let mut width: f64 = 1024.0;
    let mut height: f64 = 1024.0;

    for emitter in particle_definition
        .get("emitter")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some((x, y, _)) = emitter.get("distancemax").and_then(resolve_vec3) {
            width = width.max(x.abs() * 2.0);
            height = height.max(y.abs() * 2.0);
        } else if let Some(radius) = emitter.get("distancemax").and_then(resolve_number) {
            width = width.max(radius.abs() * 2.0);
            height = height.max(radius.abs() * 2.0);
        }

        if let Some((x, y, _)) = emitter.get("origin").and_then(resolve_vec3) {
            width = width.max(x.abs() * 2.0);
            height = height.max(y.abs() * 2.0);
        }
    }

    (width.max(1.0), height.max(1.0))
}

fn resolve_script_value(value: &Value) -> Option<WallpaperEngineSceneScriptValue> {
    let Value::Object(object) = value else {
        return None;
    };
    let script = object.get("script")?.as_str()?.to_string();
    Some(WallpaperEngineSceneScriptValue {
        script,
        script_properties: object.get("scriptproperties").cloned().unwrap_or(Value::Null),
        value: object.get("value").cloned().unwrap_or(Value::Null),
    })
}

fn resolve_string(value: &Value) -> Option<String> {
    match value {
        Value::String(string) => Some(string.clone()),
        Value::Object(object) => object.get("value").and_then(resolve_string),
        _ => None,
    }
}

fn resolve_bool(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(boolean) => Some(*boolean),
        Value::Object(object) => object.get("value").and_then(resolve_bool),
        Value::Number(number) => number.as_i64().map(|value| value != 0),
        Value::String(string) => match string.as_str() {
            "true" | "1" => Some(true),
            "false" | "0" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn resolve_number(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(string) => string.parse::<f64>().ok(),
        Value::Object(object) => object.get("value").and_then(resolve_number),
        _ => None,
    }
}

fn resolve_integer(value: &Value) -> Option<i64> {
    resolve_number(value).map(|number| number.round() as i64)
}

fn resolve_vec3(value: &Value) -> Option<(f64, f64, f64)> {
    let raw = resolve_string(value)?;
    let mut parts = raw
        .split_whitespace()
        .filter_map(|part| part.parse::<f64>().ok());
    Some((
        parts.next().unwrap_or(0.0),
        parts.next().unwrap_or(0.0),
        parts.next().unwrap_or(0.0),
    ))
}

fn resolve_vec2(value: &Value) -> Option<(f64, f64)> {
    let raw = resolve_string(value)?;
    let mut parts = raw
        .split_whitespace()
        .filter_map(|part| part.parse::<f64>().ok());
    Some((parts.next().unwrap_or(0.0), parts.next().unwrap_or(0.0)))
}

fn vec3_color_to_css(raw: &str) -> String {
    let mut parts = raw
        .split_whitespace()
        .filter_map(|part| part.parse::<f64>().ok());
    let r = (parts.next().unwrap_or(0.0) * 255.0).round().clamp(0.0, 255.0) as u8;
    let g = (parts.next().unwrap_or(0.0) * 255.0).round().clamp(0.0, 255.0) as u8;
    let b = (parts.next().unwrap_or(0.0) * 255.0).round().clamp(0.0, 255.0) as u8;
    format!("#{r:02x}{g:02x}{b:02x}")
}

fn read_u32(reader: &mut Cursor<&[u8]>) -> Result<u32> {
    let mut buffer = [0u8; 4];
    reader.read_exact(&mut buffer)?;
    Ok(u32::from_le_bytes(buffer))
}

fn read_u32_at(bytes: &[u8], offset: usize) -> Result<u32> {
    let slice = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| anyhow!("unexpected end of buffer while reading u32 at offset {offset}"))?;
    let mut buffer = [0u8; 4];
    buffer.copy_from_slice(slice);
    Ok(u32::from_le_bytes(buffer))
}

fn read_u16_at(bytes: &[u8], offset: usize) -> Result<u16> {
    let slice = bytes
        .get(offset..offset + 2)
        .ok_or_else(|| anyhow!("unexpected end of buffer while reading u16 at offset {offset}"))?;
    let mut buffer = [0u8; 2];
    buffer.copy_from_slice(slice);
    Ok(u16::from_le_bytes(buffer))
}

fn read_f32_at(bytes: &[u8], offset: usize) -> Result<f32> {
    let slice = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| anyhow!("unexpected end of buffer while reading f32 at offset {offset}"))?;
    let mut buffer = [0u8; 4];
    buffer.copy_from_slice(slice);
    Ok(f32::from_le_bytes(buffer))
}

fn read_i32(reader: &mut Cursor<&[u8]>) -> Result<i32> {
    let mut buffer = [0u8; 4];
    reader.read_exact(&mut buffer)?;
    Ok(i32::from_le_bytes(buffer))
}

fn read_c_string(reader: &mut Cursor<&[u8]>) -> Result<String> {
    let mut bytes = Vec::new();
    loop {
        let mut byte = [0u8; 1];
        reader.read_exact(&mut byte)?;
        if byte[0] == 0 {
            break;
        }
        bytes.push(byte[0]);
    }
    Ok(String::from_utf8(bytes)?)
}

struct PackageArchive {
    bytes: Vec<u8>,
    data_start: usize,
    entries: HashMap<String, PackageEntry>,
}

#[derive(Clone)]
struct PackageEntry {
    offset: usize,
    length: usize,
}

impl PackageArchive {
    fn open(path: &Path) -> Result<Self> {
        let bytes = fs::read(path)
            .with_context(|| format!("failed to read scene package: {}", path.display()))?;
        let mut cursor = Cursor::new(bytes.as_slice());
        let header_size = read_i32(&mut cursor)? as usize;
        let mut header_bytes = vec![0u8; header_size];
        cursor.read_exact(&mut header_bytes)?;
        let header = String::from_utf8(header_bytes).context("failed to decode package header")?;
        if !header.starts_with("PKGV") {
            return Err(anyhow!("unexpected package header `{header}`"));
        }
        let files_count = read_u32(&mut cursor)? as usize;
        let mut entries = HashMap::with_capacity(files_count);

        for _ in 0..files_count {
            let file_name_length = read_i32(&mut cursor)? as usize;
            let mut file_name_bytes = vec![0u8; file_name_length];
            cursor.read_exact(&mut file_name_bytes)?;
            let file_name = String::from_utf8(file_name_bytes).context("failed to decode package filename")?;
            let offset = read_u32(&mut cursor)? as usize;
            let length = read_u32(&mut cursor)? as usize;
            entries.insert(file_name, PackageEntry { offset, length });
        }

        let data_start = cursor.position() as usize;

        Ok(Self {
            bytes,
            data_start,
            entries,
        })
    }

    fn read_text(&self, path: &str) -> Result<Option<String>> {
        Ok(self
            .read_bytes(path)?
            .map(|bytes| String::from_utf8(bytes))
            .transpose()
            .with_context(|| format!("package file `{path}` is not valid utf-8"))?)
    }

    fn read_bytes(&self, path: &str) -> Result<Option<Vec<u8>>> {
        let Some(resolved_path) = self.resolve_entry_path(path) else {
            return Ok(None);
        };
        let Some(entry) = self.entries.get(&resolved_path) else {
            return Ok(None);
        };
        let start = self.data_start + entry.offset;
        let end = start + entry.length;
        let slice = self
            .bytes
            .get(start..end)
            .ok_or_else(|| anyhow!("package entry `{path}` points outside package bounds"))?;
        Ok(Some(slice.to_vec()))
    }

    fn resolve_entry_path(&self, path: &str) -> Option<String> {
        let normalized = normalize_asset_path(path);
        if self.entries.contains_key(&normalized) {
            return Some(normalized);
        }

        self.entries
            .keys()
            .find(|entry| entry.eq_ignore_ascii_case(&normalized))
            .cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepares_workspace_scene_runtime() {
        let sample_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("wallpaper");

        let runtime = prepare_scene_runtime(&sample_dir).expect("sample scene runtime should parse");
        assert!(runtime.canvas_width > 0.0);
        assert!(runtime.canvas_height > 0.0);
        assert!(!runtime.layers.is_empty());
        assert!(runtime.layers.iter().any(|layer| layer.kind == "image"));
    }

    #[test]
    fn detects_video_texture_in_workspace_sample() {
        let sample_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("wallpaper");
        let package = PackageArchive::open(&sample_dir.join("scene.pkg")).expect("sample scene package should open");
        let bytes = package
            .read_bytes("materials/诺亚 落花吟60帧 有水印.tex")
            .expect("sample texture read should succeed")
            .expect("sample video texture should exist");

        let texture = parse_tex(&bytes).expect("sample video texture should parse");
        assert!(texture.is_video_mp4);
    }

    #[test]
    fn preserves_solid_layer_effects_in_workspace_sample() {
        let sample_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("wallpaper");

        let runtime = prepare_scene_runtime(&sample_dir).expect("workspace scene runtime should parse");
        let solid_with_effects = runtime
            .layers
            .iter()
            .find(|layer| layer.kind == "solid" && !layer.effects.is_empty())
            .expect("solid layer effects should be preserved");

        assert!(solid_with_effects
            .effects
            .iter()
            .any(|effect| effect.kind == "video" || effect.kind == "opacity"));
    }

    #[test]
    fn parses_flowimage_material_from_sample_project() {
        let sample_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("820654165");

        let runtime = prepare_scene_runtime(&sample_dir).expect("flowimage sample scene runtime should parse");
        let background = runtime
            .layers
            .iter()
            .find(|layer| layer.material_shader.as_deref() == Some("flowimage"))
            .expect("flowimage material layer should exist");

        assert_eq!(background.kind, "image");
        assert!(background.material_textures.len() >= 2);
        assert!(background.material_textures[0].is_some());
        assert!(background.material_textures[1].is_some());
    }
}
