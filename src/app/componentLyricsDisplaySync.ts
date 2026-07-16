import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export const COMPONENT_LYRICS_DISPLAY_WINDOW_LABEL = "component-lyrics-display";
const COMPONENT_LYRICS_DISPLAY_SETTINGS_KEY = "celia:component:lyrics-display:settings";
const COMPONENT_LYRICS_DISPLAY_SETTINGS_EVENT = "component-lyrics-display://settings";
const COMPONENT_LYRICS_DISPLAY_SNAPSHOT_EVENT = "component-lyrics-display://snapshot";
const COMPONENT_LYRICS_DISPLAY_POSITION_KEY = "celia:component:lyrics-display:position";

export type ComponentLyricsDisplayPosition = {
  x: number;
  y: number;
};

export type ComponentLyricsDisplaySettings = {
  enabled: boolean;
  alwaysOnTop: boolean;
  hideOnMouseNearby: boolean;
  hideWhenMainWindowVisible: boolean;
  hideWhenOtherAppsFullscreen: boolean;
  hideWhenIdle: boolean;
  scale: number;
  alignment: "left" | "center" | "right";
  fontSize: number;
  height: number;
  textShadow: boolean;
  textShadowIntensity: number;
  glow: boolean;
  glowIntensity: number;
  scrollDelayMs: number;
  animationSpeed: number;
  wordLyricsEnabled: boolean;
  fadeLength: number;
  lineGap: number;
  width: number;
};

export type ComponentLyricsDisplaySnapshot = {
  isPlaying: boolean;
  lines: Array<{
    text: string;
    translatedText: string | null;
    words: Array<{
      text: string;
      startTimeMs: number;
      endTimeMs: number;
    }>;
  }>;
  activeLineIndex: number;
  currentTimeMs: number;
};

export const DEFAULT_COMPONENT_LYRICS_DISPLAY_SETTINGS: ComponentLyricsDisplaySettings = {
  enabled: false,
  alwaysOnTop: true,
  hideOnMouseNearby: false,
  hideWhenMainWindowVisible: false,
  hideWhenOtherAppsFullscreen: false,
  hideWhenIdle: false,
  scale: 100,
  alignment: "center",
  fontSize: 28,
  height: 720,
  textShadow: true,
  textShadowIntensity: 55,
  glow: false,
  glowIntensity: 45,
  scrollDelayMs: 80,
  animationSpeed: 100,
  wordLyricsEnabled: true,
  fadeLength: 3,
  lineGap: 12,
  width: 560,
};

export function readComponentLyricsDisplaySettings(): ComponentLyricsDisplaySettings {
  if (typeof window === "undefined") {
    return DEFAULT_COMPONENT_LYRICS_DISPLAY_SETTINGS;
  }

  try {
    const rawValue = window.localStorage.getItem(COMPONENT_LYRICS_DISPLAY_SETTINGS_KEY);
    if (!rawValue) {
      return DEFAULT_COMPONENT_LYRICS_DISPLAY_SETTINGS;
    }

    const parsed = JSON.parse(rawValue) as Partial<ComponentLyricsDisplaySettings>;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_COMPONENT_LYRICS_DISPLAY_SETTINGS.enabled,
      alwaysOnTop: typeof parsed.alwaysOnTop === "boolean" ? parsed.alwaysOnTop : DEFAULT_COMPONENT_LYRICS_DISPLAY_SETTINGS.alwaysOnTop,
      hideOnMouseNearby: typeof parsed.hideOnMouseNearby === "boolean" ? parsed.hideOnMouseNearby : DEFAULT_COMPONENT_LYRICS_DISPLAY_SETTINGS.hideOnMouseNearby,
      hideWhenMainWindowVisible: typeof parsed.hideWhenMainWindowVisible === "boolean" ? parsed.hideWhenMainWindowVisible : DEFAULT_COMPONENT_LYRICS_DISPLAY_SETTINGS.hideWhenMainWindowVisible,
      hideWhenOtherAppsFullscreen: typeof parsed.hideWhenOtherAppsFullscreen === "boolean" ? parsed.hideWhenOtherAppsFullscreen : DEFAULT_COMPONENT_LYRICS_DISPLAY_SETTINGS.hideWhenOtherAppsFullscreen,
      hideWhenIdle: typeof parsed.hideWhenIdle === "boolean" ? parsed.hideWhenIdle : DEFAULT_COMPONENT_LYRICS_DISPLAY_SETTINGS.hideWhenIdle,
      scale: typeof parsed.scale === "number" && Number.isFinite(parsed.scale)
        ? Math.max(70, Math.min(160, Math.round(parsed.scale)))
        : DEFAULT_COMPONENT_LYRICS_DISPLAY_SETTINGS.scale,
      alignment: parsed.alignment === "left" || parsed.alignment === "right" || parsed.alignment === "center"
        ? parsed.alignment
        : DEFAULT_COMPONENT_LYRICS_DISPLAY_SETTINGS.alignment,
      fontSize: typeof parsed.fontSize === "number" && Number.isFinite(parsed.fontSize)
        ? Math.max(16, Math.min(48, Math.round(parsed.fontSize)))
        : DEFAULT_COMPONENT_LYRICS_DISPLAY_SETTINGS.fontSize,
      height: typeof parsed.height === "number" && Number.isFinite(parsed.height)
        ? Math.max(480, Math.min(1080, Math.round(parsed.height)))
        : DEFAULT_COMPONENT_LYRICS_DISPLAY_SETTINGS.height,
      textShadow: typeof parsed.textShadow === "boolean"
        ? parsed.textShadow
        : DEFAULT_COMPONENT_LYRICS_DISPLAY_SETTINGS.textShadow,
      textShadowIntensity: typeof parsed.textShadowIntensity === "number" && Number.isFinite(parsed.textShadowIntensity)
        ? Math.max(0, Math.min(100, Math.round(parsed.textShadowIntensity)))
        : DEFAULT_COMPONENT_LYRICS_DISPLAY_SETTINGS.textShadowIntensity,
      glow: typeof parsed.glow === "boolean" ? parsed.glow : DEFAULT_COMPONENT_LYRICS_DISPLAY_SETTINGS.glow,
      glowIntensity: typeof parsed.glowIntensity === "number" && Number.isFinite(parsed.glowIntensity)
        ? Math.max(0, Math.min(100, Math.round(parsed.glowIntensity)))
        : DEFAULT_COMPONENT_LYRICS_DISPLAY_SETTINGS.glowIntensity,
      scrollDelayMs: typeof parsed.scrollDelayMs === "number" && Number.isFinite(parsed.scrollDelayMs)
        ? Math.max(0, Math.min(240, Math.round(parsed.scrollDelayMs)))
        : DEFAULT_COMPONENT_LYRICS_DISPLAY_SETTINGS.scrollDelayMs,
      animationSpeed: typeof parsed.animationSpeed === "number" && Number.isFinite(parsed.animationSpeed)
        ? Math.max(50, Math.min(200, Math.round(parsed.animationSpeed)))
        : DEFAULT_COMPONENT_LYRICS_DISPLAY_SETTINGS.animationSpeed,
      wordLyricsEnabled: typeof parsed.wordLyricsEnabled === "boolean"
        ? parsed.wordLyricsEnabled
        : DEFAULT_COMPONENT_LYRICS_DISPLAY_SETTINGS.wordLyricsEnabled,
      fadeLength: typeof parsed.fadeLength === "number" && Number.isFinite(parsed.fadeLength)
        ? Math.max(1, Math.min(8, Math.round(parsed.fadeLength)))
        : DEFAULT_COMPONENT_LYRICS_DISPLAY_SETTINGS.fadeLength,
      lineGap: typeof parsed.lineGap === "number" && Number.isFinite(parsed.lineGap)
        ? Math.max(0, Math.min(48, Math.round(parsed.lineGap)))
        : DEFAULT_COMPONENT_LYRICS_DISPLAY_SETTINGS.lineGap,
      width: typeof parsed.width === "number" && Number.isFinite(parsed.width)
        ? Math.max(360, Math.min(900, Math.round(parsed.width)))
        : DEFAULT_COMPONENT_LYRICS_DISPLAY_SETTINGS.width,
    };
  } catch {
    return DEFAULT_COMPONENT_LYRICS_DISPLAY_SETTINGS;
  }
}

export function writeComponentLyricsDisplaySettings(settings: ComponentLyricsDisplaySettings) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(COMPONENT_LYRICS_DISPLAY_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore persistence failures.
  }
}

export function readComponentLyricsDisplayPosition(): ComponentLyricsDisplayPosition | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(COMPONENT_LYRICS_DISPLAY_POSITION_KEY);
    if (!rawValue) {
      return null;
    }
    const parsed = JSON.parse(rawValue) as Partial<ComponentLyricsDisplayPosition>;
    if (typeof parsed.x === "number" && Number.isFinite(parsed.x) && typeof parsed.y === "number" && Number.isFinite(parsed.y)) {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {
    // Ignore persistence failures.
  }

  return null;
}

export function writeComponentLyricsDisplayPosition(position: ComponentLyricsDisplayPosition) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(COMPONENT_LYRICS_DISPLAY_POSITION_KEY, JSON.stringify(position));
  } catch {
    // Ignore persistence failures.
  }
}

export function clearComponentLyricsDisplayPosition() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(COMPONENT_LYRICS_DISPLAY_POSITION_KEY);
  } catch {
    // Ignore persistence failures.
  }
}

export async function emitComponentLyricsDisplaySettings(settings: ComponentLyricsDisplaySettings) {
  await emitTo(COMPONENT_LYRICS_DISPLAY_WINDOW_LABEL, COMPONENT_LYRICS_DISPLAY_SETTINGS_EVENT, settings);
}

export async function emitComponentLyricsDisplaySnapshot(snapshot: ComponentLyricsDisplaySnapshot) {
  await emitTo(COMPONENT_LYRICS_DISPLAY_WINDOW_LABEL, COMPONENT_LYRICS_DISPLAY_SNAPSHOT_EVENT, snapshot);
}

export async function listenComponentLyricsDisplaySettings(
  handler: (settings: ComponentLyricsDisplaySettings) => void,
): Promise<UnlistenFn> {
  return listen<ComponentLyricsDisplaySettings>(COMPONENT_LYRICS_DISPLAY_SETTINGS_EVENT, ({ payload }) => handler(payload), {
    target: { kind: "WebviewWindow", label: COMPONENT_LYRICS_DISPLAY_WINDOW_LABEL },
  });
}

export async function listenComponentLyricsDisplaySnapshot(
  handler: (snapshot: ComponentLyricsDisplaySnapshot) => void,
): Promise<UnlistenFn> {
  return listen<ComponentLyricsDisplaySnapshot>(COMPONENT_LYRICS_DISPLAY_SNAPSHOT_EVENT, ({ payload }) => handler(payload), {
    target: { kind: "WebviewWindow", label: COMPONENT_LYRICS_DISPLAY_WINDOW_LABEL },
  });
}

export async function openComponentLyricsDisplayWindow() {
  await invoke("open_component_lyrics_display_window");
}
