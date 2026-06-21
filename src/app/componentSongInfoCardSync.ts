import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "../settings/types";

export const COMPONENT_SONG_INFO_CARD_WINDOW_LABEL = "component-song-info-card";
const COMPONENT_SONG_INFO_CARD_SETTINGS_KEY = "celia:component:song-info-card:settings";
const COMPONENT_SONG_INFO_CARD_SETTINGS_EVENT = "component-song-info-card://settings";
const COMPONENT_SONG_INFO_CARD_SNAPSHOT_EVENT = "component-song-info-card://snapshot";
const COMPONENT_SONG_INFO_CARD_POSITION_KEY = "celia:component:song-info-card:position";

export type ComponentSongInfoCardStyle = "default" | "compact" | "box" | "minimal";
export type ComponentSongInfoCardColorMode = "follow-app" | "light" | "dark" | "follow-system";
export type ComponentSongInfoCardBackgroundMode = "solid" | "gradient" | "cover-blur";
export type ComponentSongInfoCardPosition = {
  x: number;
  y: number;
};

export type ComponentSongInfoCardSettings = {
  enabled: boolean;
  scale: number;
  alwaysOnTop: boolean;
  hideOnMouseNearby: boolean;
  hideWhenMainWindowVisible: boolean;
  hideWhenOtherAppsFullscreen: boolean;
  hideWhenIdle: boolean;
  style: ComponentSongInfoCardStyle;
  colorMode: ComponentSongInfoCardColorMode;
  backgroundMode: ComponentSongInfoCardBackgroundMode;
};

export type ComponentSongInfoCardSnapshot = {
  hasTrack: boolean;
  title: string;
  artist: string | null;
  album: string | null;
  artworkUrl: string | null;
  isPlaying: boolean;
  progress: number;
  elapsedLabel: string;
  durationLabel: string;
  colorScheme: AppSettings["appearance"]["colorScheme"];
  resolvedDynamicIslandBackground: string;
  resolvedDynamicIslandBackgroundHover: string;
  resolvedDynamicIslandAccent: string;
  primaryColor: string;
  secondaryColor: string;
  surfaceColor: string;
  updatedAtMs: number;
};

export const DEFAULT_COMPONENT_SONG_INFO_CARD_SETTINGS: ComponentSongInfoCardSettings = {
  enabled: false,
  scale: 100,
  alwaysOnTop: true,
  hideOnMouseNearby: false,
  hideWhenMainWindowVisible: false,
  hideWhenOtherAppsFullscreen: false,
  hideWhenIdle: false,
  style: "default",
  colorMode: "follow-app",
  backgroundMode: "solid",
};

export function readComponentSongInfoCardSettings(): ComponentSongInfoCardSettings {
  if (typeof window === "undefined") {
    return DEFAULT_COMPONENT_SONG_INFO_CARD_SETTINGS;
  }

  try {
    const rawValue = window.localStorage.getItem(COMPONENT_SONG_INFO_CARD_SETTINGS_KEY);
    if (!rawValue) {
      return DEFAULT_COMPONENT_SONG_INFO_CARD_SETTINGS;
    }

    const parsed = JSON.parse(rawValue) as Partial<ComponentSongInfoCardSettings>;
    return {
      enabled:
        typeof parsed.enabled === "boolean"
          ? parsed.enabled
          : DEFAULT_COMPONENT_SONG_INFO_CARD_SETTINGS.enabled,
      scale:
        typeof parsed.scale === "number" && Number.isFinite(parsed.scale)
          ? Math.max(70, Math.min(160, Math.round(parsed.scale)))
          : DEFAULT_COMPONENT_SONG_INFO_CARD_SETTINGS.scale,
      alwaysOnTop:
        typeof parsed.alwaysOnTop === "boolean"
          ? parsed.alwaysOnTop
          : DEFAULT_COMPONENT_SONG_INFO_CARD_SETTINGS.alwaysOnTop,
      hideOnMouseNearby:
        typeof parsed.hideOnMouseNearby === "boolean"
          ? parsed.hideOnMouseNearby
          : DEFAULT_COMPONENT_SONG_INFO_CARD_SETTINGS.hideOnMouseNearby,
      hideWhenMainWindowVisible:
        typeof parsed.hideWhenMainWindowVisible === "boolean"
          ? parsed.hideWhenMainWindowVisible
          : DEFAULT_COMPONENT_SONG_INFO_CARD_SETTINGS.hideWhenMainWindowVisible,
      hideWhenOtherAppsFullscreen:
        typeof parsed.hideWhenOtherAppsFullscreen === "boolean"
          ? parsed.hideWhenOtherAppsFullscreen
          : DEFAULT_COMPONENT_SONG_INFO_CARD_SETTINGS.hideWhenOtherAppsFullscreen,
      hideWhenIdle:
        typeof parsed.hideWhenIdle === "boolean"
          ? parsed.hideWhenIdle
          : DEFAULT_COMPONENT_SONG_INFO_CARD_SETTINGS.hideWhenIdle,
      style:
        parsed.style === "compact" ||
        parsed.style === "box" ||
        parsed.style === "minimal" ||
        parsed.style === "default"
          ? parsed.style
          : DEFAULT_COMPONENT_SONG_INFO_CARD_SETTINGS.style,
      colorMode:
        parsed.colorMode === "light" ||
        parsed.colorMode === "dark" ||
        parsed.colorMode === "follow-system" ||
        parsed.colorMode === "follow-app"
          ? parsed.colorMode
          : DEFAULT_COMPONENT_SONG_INFO_CARD_SETTINGS.colorMode,
      backgroundMode:
        parsed.backgroundMode === "gradient" ||
        parsed.backgroundMode === "cover-blur" ||
        parsed.backgroundMode === "solid"
          ? parsed.backgroundMode
          : DEFAULT_COMPONENT_SONG_INFO_CARD_SETTINGS.backgroundMode,
    };
  } catch {
    return DEFAULT_COMPONENT_SONG_INFO_CARD_SETTINGS;
  }
}

export function writeComponentSongInfoCardSettings(settings: ComponentSongInfoCardSettings) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(COMPONENT_SONG_INFO_CARD_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore persistence failures.
  }
}

export function readComponentSongInfoCardPosition(): ComponentSongInfoCardPosition | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(COMPONENT_SONG_INFO_CARD_POSITION_KEY);
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as Partial<ComponentSongInfoCardPosition>;
    if (
      typeof parsed.x === "number" &&
      Number.isFinite(parsed.x) &&
      typeof parsed.y === "number" &&
      Number.isFinite(parsed.y)
    ) {
      return {
        x: parsed.x,
        y: parsed.y,
      };
    }
  } catch {
    // Ignore persistence failures.
  }

  return null;
}

export function writeComponentSongInfoCardPosition(position: ComponentSongInfoCardPosition) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(COMPONENT_SONG_INFO_CARD_POSITION_KEY, JSON.stringify(position));
  } catch {
    // Ignore persistence failures.
  }
}

export function clearComponentSongInfoCardPosition() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(COMPONENT_SONG_INFO_CARD_POSITION_KEY);
  } catch {
    // Ignore persistence failures.
  }
}

export async function emitComponentSongInfoCardSettings(settings: ComponentSongInfoCardSettings) {
  await emitTo(COMPONENT_SONG_INFO_CARD_WINDOW_LABEL, COMPONENT_SONG_INFO_CARD_SETTINGS_EVENT, settings);
}

export async function emitComponentSongInfoCardSnapshot(snapshot: ComponentSongInfoCardSnapshot) {
  await emitTo(COMPONENT_SONG_INFO_CARD_WINDOW_LABEL, COMPONENT_SONG_INFO_CARD_SNAPSHOT_EVENT, snapshot);
}

export async function listenComponentSongInfoCardSettings(
  handler: (settings: ComponentSongInfoCardSettings) => void,
): Promise<UnlistenFn> {
  return listen<ComponentSongInfoCardSettings>(
    COMPONENT_SONG_INFO_CARD_SETTINGS_EVENT,
    ({ payload }) => handler(payload),
    {
      target: { kind: "WebviewWindow", label: COMPONENT_SONG_INFO_CARD_WINDOW_LABEL },
    },
  );
}

export async function listenComponentSongInfoCardSnapshot(
  handler: (snapshot: ComponentSongInfoCardSnapshot) => void,
): Promise<UnlistenFn> {
  return listen<ComponentSongInfoCardSnapshot>(
    COMPONENT_SONG_INFO_CARD_SNAPSHOT_EVENT,
    ({ payload }) => handler(payload),
    {
      target: { kind: "WebviewWindow", label: COMPONENT_SONG_INFO_CARD_WINDOW_LABEL },
    },
  );
}

export async function openComponentSongInfoCardWindow() {
  await invoke("open_component_song_info_card_window");
}
