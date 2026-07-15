import { invoke } from "@tauri-apps/api/core";

const WALLPAPER_ENGINE_PATH_PREFIX = "wallpaper-engine://";

export type WallpaperEngineProjectKind =
  | "scene"
  | "video"
  | "web"
  | "application"
  | "unknown";

export type WallpaperEngineProjectProperty = {
  key: string;
  propertyType: string;
  text: string | null;
  value: unknown;
  condition: string | null;
};

export type WallpaperEnginePkgSummary = {
  path: string;
  versionTag: string | null;
  containsSceneJson: boolean;
  entryCount: number;
  entries: string[];
};

export type WallpaperEngineProjectDescriptor = {
  folderPath: string;
  title: string;
  description: string;
  wallpaperType: WallpaperEngineProjectKind;
  projectJsonPath: string;
  previewPath: string | null;
  fileName: string | null;
  mainFilePath: string | null;
  sceneJsonPath: string | null;
  scenePkg: WallpaperEnginePkgSummary | null;
  supportsAudioProcessing: boolean;
  supportsVideo: boolean;
  properties: WallpaperEngineProjectProperty[];
  propertyCount: number;
  tags: string[];
  workshopUrl: string | null;
  rawType: string;
};

export type WallpaperEngineSceneLayer = {
  id: number;
  parentId: number | null;
  name: string;
  kind: string;
  anchor: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  rotationZDegrees: number;
  alpha: number;
  visible: boolean;
  text: string | null;
  fontPath: string | null;
  fontSize: number | null;
  textColor: string | null;
  imagePath: string | null;
  particleDefinition: Record<string, unknown> | null;
  particleMaterialShader: string | null;
  particleMaterialTextures: Array<string | null>;
  particleInstanceOverride: Record<string, unknown> | null;
  particleFlags: number | null;
  puppetPath: string | null;
  puppetMesh: WallpaperEngineScenePuppetMesh | null;
  modelCropOffsetX: number;
  modelCropOffsetY: number;
  lockTransforms: boolean;
  sourceAssetPath: string | null;
  utilLayerKind: string | null;
  materialShader: string | null;
  materialTextures: Array<string | null>;
  materialConstants: Record<string, unknown> | null;
  materialPasses: WallpaperEngineSceneMaterialPass[];
  effects: WallpaperEngineSceneEffect[];
  animationLayers: WallpaperEngineSceneAnimationLayer[];
  dynamicOrigin: WallpaperEngineSceneScriptValue | null;
  dynamicScale: WallpaperEngineSceneScriptValue | null;
  dynamicAngles: WallpaperEngineSceneScriptValue | null;
  dynamicAlpha: WallpaperEngineSceneScriptValue | null;
  dynamicText: WallpaperEngineSceneScriptValue | null;
  dynamicVisible: WallpaperEngineSceneScriptValue | null;
};

export type WallpaperEngineSceneEffect = {
  kind: string;
  sourcePath: string;
  visible: boolean;
  materialPath: string | null;
  target: string | null;
  command: string | null;
  source: string | null;
  binds: Record<string, unknown> | unknown[] | null;
  constantShaderValues: Record<string, unknown> | null;
  combos: Record<string, unknown> | null;
  texturePaths: Array<string | null>;
  materialPasses: WallpaperEngineSceneMaterialPass[];
};

export type WallpaperEngineSceneMaterialPass = {
  shader: string | null;
  textures: Array<string | null>;
  constants: Record<string, unknown> | null;
  combos: Record<string, unknown> | null;
  blending: string | null;
  cullMode: string | null;
  depthTest: string | null;
  depthWrite: string | null;
};

export type WallpaperEngineSceneAnimationLayer = {
  id: number;
  animation: number;
  blend: number;
  rate: number;
  additive: boolean;
  visible: boolean;
};

export type WallpaperEngineScenePuppetMesh = {
  version: string;
  positions: number[];
  texCoords: number[];
  indices: number[];
};

export type WallpaperEngineSceneScriptValue = {
  script: string;
  scriptProperties: Record<string, unknown> | null;
  value: unknown;
};

export type WallpaperEngineSceneRuntime = {
  project: WallpaperEngineProjectDescriptor;
  canvasWidth: number;
  canvasHeight: number;
  cacheDir: string;
  layers: WallpaperEngineSceneLayer[];
};

export type WallpaperEngineNativeStatus = {
  backend: string;
  sceneRendererReady: boolean;
  activeSceneFolder: string | null;
  activeSceneWindowLabel: string | null;
  activeSceneWindowHwnd: number | null;
  activeSceneWidth: number | null;
  activeSceneHeight: number | null;
  lastError: string | null;
};

export function createWallpaperEngineProjectPath(folderPath: string) {
  return `${WALLPAPER_ENGINE_PATH_PREFIX}${folderPath.replace(/\\/g, "/")}`;
}

export function isWallpaperEngineProjectPath(path: string) {
  return path.trim().startsWith(WALLPAPER_ENGINE_PATH_PREFIX);
}

export function parseWallpaperEngineProjectPath(path: string) {
  if (!isWallpaperEngineProjectPath(path)) {
    return null;
  }

  return path.trim().slice(WALLPAPER_ENGINE_PATH_PREFIX.length) || null;
}

export function inspectWallpaperEngineProject(folderPath: string) {
  return invoke<WallpaperEngineProjectDescriptor>("inspect_wallpaper_engine_project", {
    folderPath,
  });
}

export function hostWallpaperEngineWebProject(folderPath: string) {
  return invoke<string>("host_wallpaper_engine_web_project", { folderPath });
}

export function prepareWallpaperEngineSceneRuntime(folderPath: string) {
  return invoke<WallpaperEngineSceneRuntime>("prepare_wallpaper_engine_scene_runtime", {
    folderPath,
  });
}

export function getWallpaperEngineNativeStatus() {
  return invoke<WallpaperEngineNativeStatus>("get_wallpaper_engine_native_status");
}

export function activateWallpaperEngineNativeScene(folderPath: string, windowLabel: string) {
  return invoke<WallpaperEngineNativeStatus>("activate_wallpaper_engine_native_scene", {
    folderPath,
    windowLabel,
  });
}

export function deactivateWallpaperEngineNativeScene() {
  return invoke<WallpaperEngineNativeStatus>("deactivate_wallpaper_engine_native_scene");
}
