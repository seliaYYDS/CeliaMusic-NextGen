import { listen } from "@tauri-apps/api/event";

import type {
  WallpaperEngineNativeStatus,
  WallpaperEngineProjectDescriptor,
  WallpaperEngineSceneRuntime,
} from "./wallpaperEngine";
import {
  inspectWallpaperEngineProject,
  hostWallpaperEngineWebProject,
  deactivateWallpaperEngineNativeScene,
} from "./wallpaperEngine";

const STORAGE_KEY = "celia:wallpaper-engine:project";
const CHANNEL_NAME = "celia-wallpaper-engine-project";
const NATIVE_STATUS_EVENT = "wallpaper-engine-native-status";
const LOCAL_STATE_EVENT = "celia-wallpaper-engine-project-state";
let memoryState: WallpaperEngineProjectState | null | undefined;
const inFlightLoads = new Map<string, Promise<WallpaperEngineProjectState>>();

export type WallpaperEngineProjectState = {
  folderPath: string;
  descriptor: WallpaperEngineProjectDescriptor;
  sceneRuntime: WallpaperEngineSceneRuntime | null;
  webHostUrl: string | null;
  nativeStatus: WallpaperEngineNativeStatus | null;
  loadedAtMs: number;
};

function createBroadcastChannel() {
  if (typeof window === "undefined" || typeof window.BroadcastChannel === "undefined") {
    return null;
  }

  try {
    return new window.BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
}

function normalizeState(rawValue: unknown): WallpaperEngineProjectState | null {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  const candidate = rawValue as Partial<WallpaperEngineProjectState>;
  if (
    typeof candidate.folderPath !== "string" ||
    typeof candidate.loadedAtMs !== "number" ||
    !candidate.descriptor ||
    typeof candidate.descriptor !== "object"
  ) {
    return null;
  }

  return {
    ...candidate,
    sceneRuntime: candidate.sceneRuntime ?? null,
    webHostUrl: candidate.webHostUrl ?? null,
    nativeStatus: candidate.nativeStatus ?? null,
  } as WallpaperEngineProjectState;
}

function persistableState(state: WallpaperEngineProjectState) {
  // Scene runtimes contain every decoded asset and puppet frame. Persisting or
  // broadcasting that graph freezes the WebView and can exceed storage quotas.
  // Each window prepares its own runtime once and keeps it in memory.
  return { ...state, sceneRuntime: null, webHostUrl: null, nativeStatus: null };
}

function mergeProjectRuntime(
  received: WallpaperEngineProjectState | null,
  current: WallpaperEngineProjectState | null,
) {
  if (!received || !current || received.folderPath !== current.folderPath) {
    return received;
  }

  return {
    ...received,
    sceneRuntime: current.sceneRuntime,
    webHostUrl: current.webHostUrl,
    nativeStatus: current.nativeStatus,
  };
}

function publishLocalState(state: WallpaperEngineProjectState | null) {
  window.dispatchEvent(new CustomEvent<WallpaperEngineProjectState | null>(LOCAL_STATE_EVENT, { detail: state }));
}

export function readWallpaperEngineProjectState() {
  if (typeof window === "undefined") {
    return null;
  }

  if (memoryState !== undefined) {
    return memoryState;
  }

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    const state = normalizeState(JSON.parse(rawValue));
    memoryState = state ? { ...state, sceneRuntime: null, webHostUrl: null, nativeStatus: null } : null;
    return memoryState;
  } catch {
    memoryState = null;
    return null;
  }
}

export function writeWallpaperEngineProjectState(state: WallpaperEngineProjectState | null) {
  if (typeof window === "undefined") {
    return;
  }

  memoryState = state;

  try {
    if (state) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistableState(state)));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures and keep cross-window sync alive.
  }

  publishLocalState(state);

  const channel = createBroadcastChannel();
  if (!channel) {
    return;
  }

  try {
    channel.postMessage(state ? persistableState(state) : null);
  } finally {
    channel.close();
  }
}

export function subscribeWallpaperEngineProjectState(
  listener: (state: WallpaperEngineProjectState | null) => void,
) {
  listener(readWallpaperEngineProjectState());

  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) {
      return;
    }

    const received = event.newValue ? normalizeState(JSON.parse(event.newValue)) : null;
    memoryState = mergeProjectRuntime(received, memoryState ?? null);
    listener(memoryState);
  };

  window.addEventListener("storage", handleStorage);
  const handleLocalState = (event: Event) => listener((event as CustomEvent<WallpaperEngineProjectState | null>).detail);
  window.addEventListener(LOCAL_STATE_EVENT, handleLocalState);

  const channel = createBroadcastChannel();
  if (channel) {
    channel.onmessage = (event) => {
      const received = normalizeState(event.data);
      const current = readWallpaperEngineProjectState();
      memoryState = mergeProjectRuntime(received, current);
      listener(memoryState);
    };
  }

  let disposed = false;
  void listen<WallpaperEngineNativeStatus>(NATIVE_STATUS_EVENT, (event) => {
    if (disposed) {
      return;
    }

    const currentState = readWallpaperEngineProjectState();
    if (!currentState) {
      return;
    }

    const nextState: WallpaperEngineProjectState = {
      ...currentState,
      nativeStatus: event.payload,
    };
    writeWallpaperEngineProjectState(nextState);
    listener(nextState);
  }).catch(() => undefined);

  return () => {
    disposed = true;
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(LOCAL_STATE_EVENT, handleLocalState);
    channel?.close();
  };
}

function loadProjectOnce(folderPath: string) {
  const key = folderPath.replace(/\\/g, "/").toLowerCase();
  const existing = inFlightLoads.get(key);
  if (existing) return existing;

  const task = (async () => {
    const descriptor = await inspectWallpaperEngineProject(folderPath);
    if (descriptor.wallpaperType === "scene") {
      throw new Error("暂不支持该类壁纸");
    }
    const sceneRuntime = null;
    const webHostUrl =
      descriptor.wallpaperType === "web"
        ? await hostWallpaperEngineWebProject(folderPath)
        : null;
    const nativeStatus = await deactivateWallpaperEngineNativeScene().catch(() => null);
    const state: WallpaperEngineProjectState = {
      folderPath,
      descriptor,
      sceneRuntime,
      webHostUrl,
      nativeStatus,
      loadedAtMs: Date.now(),
    };
    writeWallpaperEngineProjectState(state);
    return state;
  })();
  inFlightLoads.set(key, task);
  void task.finally(() => inFlightLoads.delete(key)).catch(() => undefined);
  return task;
}

export function loadWallpaperEngineProject(folderPath: string) {
  return loadProjectOnce(folderPath);
}

export function loadWallpaperEngineProjectForHost(folderPath: string, windowLabel: string) {
  void windowLabel;
  return loadProjectOnce(folderPath);
}

export function clearWallpaperEngineProjectState() {
  void deactivateWallpaperEngineNativeScene().catch(() => undefined);
  writeWallpaperEngineProjectState(null);
}
