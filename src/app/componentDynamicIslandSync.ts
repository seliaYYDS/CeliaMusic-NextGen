import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "../settings/types";

export const COMPONENT_DYNAMIC_ISLAND_WINDOW_LABEL = "component-dynamic-island";
const COMPONENT_DYNAMIC_ISLAND_SETTINGS_KEY = "celia:component:dynamic-island:settings";
const COMPONENT_DYNAMIC_ISLAND_SETTINGS_EVENT = "component-dynamic-island://settings";
const COMPONENT_DYNAMIC_ISLAND_SNAPSHOT_EVENT = "component-dynamic-island://snapshot";

export type ComponentDynamicIslandDesign = "separated" | "integrated";
export type ComponentDynamicIslandColorMode = "follow-app" | "light" | "dark" | "follow-system";
export type ComponentDynamicIslandDefaultContentMode =
  | "time"
  | "date"
  | "custom-text"
  | "custom-format";

export type ComponentDynamicIslandSettings = {
  enabled: boolean;
  alwaysOnTop: boolean;
  hideOnMouseNearby: boolean;
  hideWhenMainWindowVisible: boolean;
  hideWhenOtherAppsFullscreen: boolean;
  hideWhenIdle: boolean;
  scale: number;
  design: ComponentDynamicIslandDesign;
  colorMode: ComponentDynamicIslandColorMode;
  defaultContentMode: ComponentDynamicIslandDefaultContentMode;
  defaultCustomText: string;
  defaultCustomFormat: string;
};

export type ComponentDynamicIslandSnapshot = {
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

export const DEFAULT_COMPONENT_DYNAMIC_ISLAND_SETTINGS: ComponentDynamicIslandSettings = {
  enabled: false,
  alwaysOnTop: true,
  hideOnMouseNearby: false,
  hideWhenMainWindowVisible: false,
  hideWhenOtherAppsFullscreen: false,
  hideWhenIdle: false,
  scale: 100,
  design: "separated",
  colorMode: "follow-app",
  defaultContentMode: "time",
  defaultCustomText: "Celia Music",
  defaultCustomFormat: "yyyy年mm月dd日",
};

export function readComponentDynamicIslandSettings(): ComponentDynamicIslandSettings {
  if (typeof window === "undefined") {
    return DEFAULT_COMPONENT_DYNAMIC_ISLAND_SETTINGS;
  }

  try {
    const rawValue = window.localStorage.getItem(COMPONENT_DYNAMIC_ISLAND_SETTINGS_KEY);
    if (!rawValue) {
      return DEFAULT_COMPONENT_DYNAMIC_ISLAND_SETTINGS;
    }

    const parsed = JSON.parse(rawValue) as Partial<ComponentDynamicIslandSettings>;
    return {
      enabled:
        typeof parsed.enabled === "boolean"
          ? parsed.enabled
          : DEFAULT_COMPONENT_DYNAMIC_ISLAND_SETTINGS.enabled,
      alwaysOnTop:
        typeof parsed.alwaysOnTop === "boolean"
          ? parsed.alwaysOnTop
          : DEFAULT_COMPONENT_DYNAMIC_ISLAND_SETTINGS.alwaysOnTop,
      hideOnMouseNearby:
        typeof parsed.hideOnMouseNearby === "boolean"
          ? parsed.hideOnMouseNearby
          : DEFAULT_COMPONENT_DYNAMIC_ISLAND_SETTINGS.hideOnMouseNearby,
      hideWhenMainWindowVisible:
        typeof parsed.hideWhenMainWindowVisible === "boolean"
          ? parsed.hideWhenMainWindowVisible
          : DEFAULT_COMPONENT_DYNAMIC_ISLAND_SETTINGS.hideWhenMainWindowVisible,
      hideWhenOtherAppsFullscreen:
        typeof parsed.hideWhenOtherAppsFullscreen === "boolean"
          ? parsed.hideWhenOtherAppsFullscreen
          : DEFAULT_COMPONENT_DYNAMIC_ISLAND_SETTINGS.hideWhenOtherAppsFullscreen,
      hideWhenIdle:
        typeof parsed.hideWhenIdle === "boolean"
          ? parsed.hideWhenIdle
          : DEFAULT_COMPONENT_DYNAMIC_ISLAND_SETTINGS.hideWhenIdle,
      scale:
        typeof parsed.scale === "number" && Number.isFinite(parsed.scale)
          ? Math.max(70, Math.min(160, Math.round(parsed.scale)))
          : DEFAULT_COMPONENT_DYNAMIC_ISLAND_SETTINGS.scale,
      design:
        parsed.design === "integrated" || parsed.design === "separated"
          ? parsed.design
          : DEFAULT_COMPONENT_DYNAMIC_ISLAND_SETTINGS.design,
      colorMode:
        parsed.colorMode === "light" ||
        parsed.colorMode === "dark" ||
        parsed.colorMode === "follow-system" ||
        parsed.colorMode === "follow-app"
          ? parsed.colorMode
          : DEFAULT_COMPONENT_DYNAMIC_ISLAND_SETTINGS.colorMode,
      defaultContentMode:
        parsed.defaultContentMode === "date" ||
        parsed.defaultContentMode === "custom-text" ||
        parsed.defaultContentMode === "custom-format" ||
        parsed.defaultContentMode === "time"
          ? parsed.defaultContentMode
          : DEFAULT_COMPONENT_DYNAMIC_ISLAND_SETTINGS.defaultContentMode,
      defaultCustomText:
        typeof parsed.defaultCustomText === "string"
          ? parsed.defaultCustomText
          : DEFAULT_COMPONENT_DYNAMIC_ISLAND_SETTINGS.defaultCustomText,
      defaultCustomFormat:
        typeof parsed.defaultCustomFormat === "string"
          ? parsed.defaultCustomFormat
          : DEFAULT_COMPONENT_DYNAMIC_ISLAND_SETTINGS.defaultCustomFormat,
    };
  } catch {
    return DEFAULT_COMPONENT_DYNAMIC_ISLAND_SETTINGS;
  }
}

export function writeComponentDynamicIslandSettings(settings: ComponentDynamicIslandSettings) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(COMPONENT_DYNAMIC_ISLAND_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore persistence failures.
  }
}

export async function emitComponentDynamicIslandSettings(
  settings: ComponentDynamicIslandSettings,
) {
  await emitTo(COMPONENT_DYNAMIC_ISLAND_WINDOW_LABEL, COMPONENT_DYNAMIC_ISLAND_SETTINGS_EVENT, settings);
}

export async function emitComponentDynamicIslandSnapshot(
  snapshot: ComponentDynamicIslandSnapshot,
) {
  await emitTo(COMPONENT_DYNAMIC_ISLAND_WINDOW_LABEL, COMPONENT_DYNAMIC_ISLAND_SNAPSHOT_EVENT, snapshot);
}

export async function listenComponentDynamicIslandSettings(
  handler: (settings: ComponentDynamicIslandSettings) => void,
): Promise<UnlistenFn> {
  return listen<ComponentDynamicIslandSettings>(
    COMPONENT_DYNAMIC_ISLAND_SETTINGS_EVENT,
    ({ payload }) => handler(payload),
    {
      target: { kind: "WebviewWindow", label: COMPONENT_DYNAMIC_ISLAND_WINDOW_LABEL },
    },
  );
}

export async function listenComponentDynamicIslandSnapshot(
  handler: (snapshot: ComponentDynamicIslandSnapshot) => void,
): Promise<UnlistenFn> {
  return listen<ComponentDynamicIslandSnapshot>(
    COMPONENT_DYNAMIC_ISLAND_SNAPSHOT_EVENT,
    ({ payload }) => handler(payload),
    {
      target: { kind: "WebviewWindow", label: COMPONENT_DYNAMIC_ISLAND_WINDOW_LABEL },
    },
  );
}

export async function openComponentDynamicIslandWindow() {
  await invoke("open_component_dynamic_island_window");
}
