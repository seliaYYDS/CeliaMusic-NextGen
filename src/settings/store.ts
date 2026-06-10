import { invoke } from "@tauri-apps/api/core";

import { SHORTCUT_ACTION_IDS, type AppSettings, type AppSettingsSnapshot } from "./types";

export type LocalNeteaseApiServerStatus = {
  enabled: boolean;
  running: boolean;
  starting: boolean;
  managedByApp: boolean;
  url: string;
  port: number;
  message: string | null;
  logLines: string[];
};

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeShortcutKeys(keys: string[]) {
  const normalized: string[] = [];

  for (const key of keys) {
    const trimmed = key.trim();
    if (!trimmed || normalized.includes(trimmed)) {
      continue;
    }

    normalized.push(trimmed);
  }

  return normalized;
}

function normalizeAppSettingsForSave(settings: AppSettings): AppSettings {
  const normalizedShortcuts = SHORTCUT_ACTION_IDS.reduce(
    (result, actionId) => ({
      ...result,
      [actionId]: normalizeShortcutKeys(settings.shortcuts[actionId]),
    }),
    {} as AppSettings["shortcuts"],
  );

  return {
    ...settings,
    appearance: {
      ...settings.appearance,
      fontFamily: settings.appearance.fontFamily.trim() || "system-ui",
      fontWeight: clampInteger(settings.appearance.fontWeight, 100, 900),
      backgroundBlur: clampInteger(settings.appearance.backgroundBlur, 0, 48),
      componentBackdropBlur: clampInteger(settings.appearance.componentBackdropBlur, 0, 32),
      backgroundDim: clampInteger(settings.appearance.backgroundDim, 0, 100),
      backgroundImageOpacity: clampInteger(settings.appearance.backgroundImageOpacity, 0, 100),
      immersiveBackgroundMode:
        settings.appearance.immersiveBackgroundMode === "palette-solid" ||
        settings.appearance.immersiveBackgroundMode === "app-background" ||
        settings.appearance.immersiveBackgroundMode === "background-mv" ||
        settings.appearance.immersiveBackgroundMode === "cover-blur" ||
        settings.appearance.immersiveBackgroundMode === "flow"
          ? settings.appearance.immersiveBackgroundMode
          : "palette-gradient",
      immersiveBackgroundAnimated: Boolean(settings.appearance.immersiveBackgroundAnimated),
      immersiveBackgroundResolution: clampInteger(settings.appearance.immersiveBackgroundResolution, 45, 100),
      immersiveBackgroundSpeed: clampInteger(settings.appearance.immersiveBackgroundSpeed, 40, 180),
      immersiveBackgroundBlur: clampInteger(settings.appearance.immersiveBackgroundBlur, 0, 36),
      immersiveBackgroundSoftness: clampInteger(settings.appearance.immersiveBackgroundSoftness, 0, 100),
    },
    playback: {
      ...settings.playback,
      defaultVolume: clampInteger(settings.playback.defaultVolume, 0, 100),
      songTransitionStartMs: clampInteger(settings.playback.songTransitionStartMs, 1000, 12000),
      resumeTrackPositionMs: clampInteger(settings.playback.resumeTrackPositionMs, 0, 86400000),
    },
    network: {
      ...settings.network,
      requestTimeoutMs: clampInteger(settings.network.requestTimeoutMs, 1000, 120000),
    },
    lyrics: {
      ...settings.lyrics,
      delayMs: clampInteger(settings.lyrics.delayMs, -1000, 1000),
      fontFamily: settings.lyrics.fontFamily.trim() || "system-ui",
      fontWeight: clampInteger(settings.lyrics.fontWeight, 100, 900),
      fontSize: clampInteger(settings.lyrics.fontSize, 80, 160),
      lineSpacing: clampInteger(settings.lyrics.lineSpacing, 80, 180),
      lineAlignment: settings.lyrics.lineAlignment === "upper" ? "upper" : "center",
      textAlignment:
        settings.lyrics.textAlignment === "center"
          ? "center"
          : settings.lyrics.textAlignment === "right"
            ? "right"
            : "left",
      renderMode:
        settings.lyrics.renderMode === "simple"
          ? "simple"
          : settings.lyrics.renderMode === "balanced"
            ? "balanced"
            : "advanced",
      progressBarPreview: Boolean(settings.lyrics.progressBarPreview),
      textShadow: Boolean(settings.lyrics.textShadow),
      textShadowIntensity: clampInteger(settings.lyrics.textShadowIntensity, 0, 200),
      textShadowDefinition: clampInteger(settings.lyrics.textShadowDefinition, 0, 100),
      glow: Boolean(settings.lyrics.glow),
      glowIntensity: clampInteger(settings.lyrics.glowIntensity, 0, 200),
      glowDefinition: clampInteger(settings.lyrics.glowDefinition, 0, 100),
      animationSpeed: clampInteger(settings.lyrics.animationSpeed, 50, 200),
      lineAnimationStaggerMs: clampInteger(settings.lyrics.lineAnimationStaggerMs, 0, 240),
      blurRange: clampInteger(settings.lyrics.blurRange, 0, 100),
      curveAmount: clampInteger(settings.lyrics.curveAmount, -100, 100),
    },
    shortcuts: normalizedShortcuts,
    window: {
      ...settings.window,
      width: clampInteger(settings.window.width, 800, 10000),
      height: clampInteger(settings.window.height, 500, 10000),
    },
  };
}

export const ensureAppSettings = async (): Promise<AppSettingsSnapshot> =>
  invoke("ensure_app_settings");

export const getAppSettings = async (): Promise<AppSettingsSnapshot> =>
  invoke("get_app_settings");

export const saveAppSettings = async (
  settings: AppSettings,
): Promise<AppSettingsSnapshot> =>
  invoke("save_app_settings", {
    settings: normalizeAppSettingsForSave(settings),
  });

export const listSystemFontFamilies = async (): Promise<string[]> =>
  invoke("list_system_font_families");

export const resetAppSettings = async (): Promise<AppSettingsSnapshot> =>
  invoke("reset_app_settings");

export const syncLocalNeteaseApiServer = async (
  settings: AppSettings,
): Promise<LocalNeteaseApiServerStatus> =>
  invoke("sync_local_netease_api_server", {
    settings: normalizeAppSettingsForSave(settings),
  });

export const getLocalNeteaseApiServerStatus = async (
  settings: AppSettings,
): Promise<LocalNeteaseApiServerStatus> =>
  invoke("get_local_netease_api_server_status", {
    settings: normalizeAppSettingsForSave(settings),
  });
