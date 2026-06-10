import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  LogicalPosition,
  LogicalSize,
  currentMonitor,
  cursorPosition,
  getAllWindows,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import {
  type ComponentDynamicIslandSettings,
  type ComponentDynamicIslandSnapshot,
  listenComponentDynamicIslandSettings,
  listenComponentDynamicIslandSnapshot,
  readComponentDynamicIslandSettings,
} from "./componentDynamicIslandSync";
import { createDefaultAppSettings } from "../settings/types";
import "./styles.css";
import "./component-windows.css";

const EMPTY_SNAPSHOT: ComponentDynamicIslandSnapshot = {
  hasTrack: false,
  title: "Celia Music",
  artist: null,
  album: null,
  artworkUrl: null,
  isPlaying: false,
  progress: 0,
  elapsedLabel: "0:00",
  durationLabel: "--:--",
  colorScheme: createDefaultAppSettings().appearance.colorScheme,
  resolvedDynamicIslandBackground: "",
  resolvedDynamicIslandBackgroundHover: "",
  resolvedDynamicIslandAccent: "",
  primaryColor: createDefaultAppSettings().appearance.customThemePrimary,
  secondaryColor: createDefaultAppSettings().appearance.customThemeSecondary,
  surfaceColor: createDefaultAppSettings().appearance.customThemeSurface,
  updatedAtMs: 0,
};

const SEPARATED_TOP_OFFSET = 18;
const WINDOW_MEASURE_PADDING_X = 16;
const WINDOW_MEASURE_PADDING_BOTTOM = 16;
const IDLE_BODY_WIDTH = 138;
const IDLE_BODY_HEIGHT = 36;
const PLAYBACK_BODY_WIDTH = 416;
const PLAYBACK_BODY_HEIGHT = 68;
const HIDE_NEARBY_THRESHOLD_PX = 72;

type IslandVisualMode = "idle" | "playback";

type IslandPalette = {
  background: string;
  text: string;
  subtext: string;
  accent: string;
  track: string;
  progressFill: string;
};

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHexColor(input: string | null | undefined, fallback: string) {
  if (typeof input !== "string") {
    return fallback;
  }

  const trimmed = input.trim();
  const shortMatch = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (shortMatch) {
    const [, shortHex] = shortMatch;
    return `#${shortHex
      .split("")
      .map((char) => `${char}${char}`)
      .join("")
      .toLowerCase()}`;
  }

  const longMatch = /^#([0-9a-f]{6})$/i.exec(trimmed);
  if (longMatch) {
    return `#${longMatch[1].toLowerCase()}`;
  }

  return fallback;
}

function hexToRgb(hexColor: string) {
  const normalized = normalizeHexColor(hexColor, "#000000");
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function mixHexColors(from: string, to: string, weight: number) {
  const start = hexToRgb(from);
  const end = hexToRgb(to);
  const ratio = clampNumber(weight, 0, 1);
  const blendChannel = (startValue: number, endValue: number) =>
    Math.round(startValue + ((endValue - startValue) * ratio))
      .toString(16)
      .padStart(2, "0");

  return `#${blendChannel(start.r, end.r)}${blendChannel(start.g, end.g)}${blendChannel(start.b, end.b)}`;
}

function withHexAlpha(color: string, alpha: number) {
  const { r, g, b } = hexToRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${clampNumber(alpha, 0, 1)})`;
}

function resolveIslandPalette(
  settings: ComponentDynamicIslandSettings,
  snapshot: ComponentDynamicIslandSnapshot,
) : IslandPalette {
  const isDark =
    settings.colorMode === "dark" ||
    (settings.colorMode === "follow-system" &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches) ||
    (settings.colorMode === "follow-app" && snapshot.colorScheme === "dark");

  if (settings.colorMode === "follow-app") {
    const resolvedBackground =
      typeof snapshot.resolvedDynamicIslandBackground === "string" &&
      snapshot.resolvedDynamicIslandBackground.trim()
        ? snapshot.resolvedDynamicIslandBackground.trim()
        : "";
    const resolvedAccent =
      typeof snapshot.resolvedDynamicIslandAccent === "string" &&
      snapshot.resolvedDynamicIslandAccent.trim()
        ? snapshot.resolvedDynamicIslandAccent.trim()
        : "";
    const accent = normalizeHexColor(snapshot.primaryColor, "#2d5fa8");

    return {
      background:
        resolvedBackground ||
        (snapshot.colorScheme === "dark"
          ? withHexAlpha(mixHexColors(accent, "#06090f", 0.8), 0.96)
          : withHexAlpha(mixHexColors(accent, "#0c1320", 0.78), 0.96)),
      text: "#f8fbff",
      subtext:
        snapshot.colorScheme === "dark"
          ? mixHexColors(accent, "#b8c3d5", 0.9)
          : mixHexColors(accent, "#d8e1ee", 0.84),
      accent: resolvedAccent || normalizeHexColor(snapshot.secondaryColor, "#8ecdf4"),
      track: "rgba(255, 255, 255, 0.18)",
      progressFill: "#ffffff",
    };
  }

  if (isDark) {
    return {
      background: "rgba(10, 14, 20, 1)",
      text: "#f8fbff",
      subtext: "rgba(248, 251, 255, 0.72)",
      accent: "#ffffff",
      track: "rgba(255, 255, 255, 0.14)",
      progressFill: "#ffffff",
    };
  }

  return {
    background: "rgba(255, 255, 255, 1)",
    text: "#101726",
    subtext: "rgba(16, 23, 38, 0.64)",
    accent: "#101726",
    track: "rgba(16, 23, 38, 0.12)",
    progressFill: "#101726",
  };
}

function buildTimeLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

export function ComponentDynamicIslandWindow() {
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const [settings, setSettings] = useState<ComponentDynamicIslandSettings>(() =>
    readComponentDynamicIslandSettings(),
  );
  const [snapshot, setSnapshot] = useState<ComponentDynamicIslandSnapshot>(EMPTY_SNAPSHOT);
  const [timeLabel, setTimeLabel] = useState(buildTimeLabel);
  const [isHiddenForCursor, setIsHiddenForCursor] = useState(false);
  const [isHiddenForMainWindow, setIsHiddenForMainWindow] = useState(false);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    document.body.style.margin = "0";
    void currentWindow.setDecorations(false).catch(() => undefined);
    void currentWindow.setShadow(false).catch(() => undefined);
    void currentWindow.setAlwaysOnTop(settings.alwaysOnTop).catch(() => undefined);
  }, [currentWindow, settings.alwaysOnTop]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTimeLabel(buildTimeLabel());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlistenSettings: (() => void) | null = null;
    let unlistenSnapshot: (() => void) | null = null;

    void listenComponentDynamicIslandSettings((payload) => {
      if (disposed) {
        return;
      }
      if (!payload.enabled) {
        void currentWindow.destroy().catch(() => undefined);
        return;
      }
      setSettings(payload);
      void currentWindow.setAlwaysOnTop(payload.alwaysOnTop).catch(() => undefined);
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlistenSettings = unlisten;
    });

    void listenComponentDynamicIslandSnapshot((payload) => {
      if (disposed) {
        return;
      }
      setSnapshot(payload);
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlistenSnapshot = unlisten;
    });

    return () => {
      disposed = true;
      unlistenSettings?.();
      unlistenSnapshot?.();
    };
  }, [currentWindow]);

  const palette = resolveIslandPalette(settings, snapshot);
  const scale = settings.scale / 100;
  const isPlaybackVisible = snapshot.hasTrack && snapshot.isPlaying;
  const visualMode: IslandVisualMode = isPlaybackVisible ? "playback" : "idle";
  const metaLabel = snapshot.artist?.trim() || snapshot.album?.trim() || "";
  const bodyClassName = [
    "component-dynamic-island__body",
    settings.design === "integrated" ? "component-dynamic-island__body--integrated" : "",
    visualMode === "playback"
      ? "component-dynamic-island__body--playback"
      : "component-dynamic-island__body--idle",
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    const syncWindowBounds = async () => {
      const monitor = await currentMonitor().catch(() => null);
      if (!monitor) {
        return;
      }

      const scaleFactor = await currentWindow.scaleFactor().catch(() => monitor.scaleFactor);
      const monitorPosition = monitor.position.toLogical(scaleFactor);
      const monitorSize = monitor.size.toLogical(scaleFactor);
      const windowWidth = Math.ceil(PLAYBACK_BODY_WIDTH * scale) + (WINDOW_MEASURE_PADDING_X * 2);
      const windowHeight = Math.ceil(PLAYBACK_BODY_HEIGHT * scale) + WINDOW_MEASURE_PADDING_BOTTOM;
      const centeredX = monitorPosition.x + Math.max(0, (monitorSize.width - windowWidth) / 2);
      const topOffset =
        settings.design === "integrated"
          ? monitorPosition.y
          : monitorPosition.y + SEPARATED_TOP_OFFSET;

      await currentWindow.setSize(new LogicalSize(windowWidth, windowHeight)).catch(() => undefined);
      await currentWindow
        .setPosition(new LogicalPosition(centeredX, topOffset))
        .catch(() => undefined);
    };

    const frameId = window.requestAnimationFrame(() => {
      void syncWindowBounds();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [currentWindow, scale, settings.design]);

  useEffect(() => {
    if (!settings.hideOnMouseNearby) {
      setIsHiddenForCursor(false);
      return;
    }

    let disposed = false;

    const updateCursorVisibility = async () => {
      const [cursor, windowPosition, windowSize] = await Promise.all([
        cursorPosition().catch(() => null),
        currentWindow.outerPosition().catch(() => null),
        currentWindow.outerSize().catch(() => null),
      ]);

      if (disposed || !cursor || !windowPosition || !windowSize) {
        return;
      }

      const bodyWidth = Math.round((visualMode === "playback" ? PLAYBACK_BODY_WIDTH : IDLE_BODY_WIDTH) * scale);
      const bodyHeight = Math.round(
        (visualMode === "playback" ? PLAYBACK_BODY_HEIGHT : IDLE_BODY_HEIGHT) * scale,
      );
      const islandLeft = windowPosition.x + Math.max(0, Math.round((windowSize.width - bodyWidth) / 2));
      const islandTop = windowPosition.y;
      const islandRight = islandLeft + bodyWidth;
      const islandBottom = islandTop + bodyHeight;

      const dx =
        cursor.x < islandLeft
          ? islandLeft - cursor.x
          : cursor.x > islandRight
            ? cursor.x - islandRight
            : 0;
      const dy =
        cursor.y < islandTop
          ? islandTop - cursor.y
          : cursor.y > islandBottom
            ? cursor.y - islandBottom
            : 0;
      const isNearby = Math.hypot(dx, dy) <= HIDE_NEARBY_THRESHOLD_PX;

      setIsHiddenForCursor((previous) => (previous === isNearby ? previous : isNearby));
    };

    void updateCursorVisibility();
    const timer = window.setInterval(() => {
      void updateCursorVisibility();
    }, 120);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [currentWindow, scale, settings.hideOnMouseNearby, visualMode]);

  useEffect(() => {
    if (!settings.hideWhenMainWindowVisible) {
      setIsHiddenForMainWindow(false);
      return;
    }

    let disposed = false;

    const updateMainWindowVisibility = async () => {
      const windows = await getAllWindows().catch(() => []);
      const mainWindow = windows.find((window) => window.label === "main");
      if (!mainWindow) {
        if (!disposed) {
          setIsHiddenForMainWindow(false);
        }
        return;
      }

      const [visible, minimized] = await Promise.all([
        mainWindow.isVisible().catch(() => false),
        mainWindow.isMinimized().catch(() => false),
      ]);

      if (disposed) {
        return;
      }

      const shouldHide = Boolean(visible) && !Boolean(minimized);
      setIsHiddenForMainWindow((previous) => (previous === shouldHide ? previous : shouldHide));
    };

    void updateMainWindowVisibility();
    const timer = window.setInterval(() => {
      void updateMainWindowVisibility();
    }, 300);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [settings.hideWhenMainWindowVisible]);

  const isIslandHidden = isHiddenForCursor || isHiddenForMainWindow;

  return (
    <div className="component-dynamic-island-window">
      <div
        className={[
          "component-dynamic-island",
          isIslandHidden ? "component-dynamic-island--cursor-hidden" : "",
          settings.design === "integrated"
            ? "component-dynamic-island--integrated"
            : "component-dynamic-island--separated",
        ].join(" ")}
        style={
          {
            "--component-dynamic-island-scale": String(scale),
            "--component-dynamic-island-bg": palette.background,
            "--component-dynamic-island-text": palette.text,
            "--component-dynamic-island-subtext": palette.subtext,
            "--component-dynamic-island-accent": palette.accent,
            "--component-dynamic-island-track": palette.track,
            "--component-dynamic-island-progress-fill": palette.progressFill,
          } as CSSProperties
        }
      >
        <div className={bodyClassName} data-mode={visualMode}>
          <div
            className={[
              "component-dynamic-island__view",
              "component-dynamic-island__view--idle",
              visualMode === "idle" ? "component-dynamic-island__view--active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="component-dynamic-island__idle-row">
              <span className="component-dynamic-island__time">{timeLabel}</span>
            </div>
          </div>

          <div
            className={[
              "component-dynamic-island__view",
              "component-dynamic-island__view--playback",
              visualMode === "playback" ? "component-dynamic-island__view--active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="component-dynamic-island__playback-layout">
              <span className="component-dynamic-island__artwork" aria-hidden="true">
                {snapshot.artworkUrl ? <img src={snapshot.artworkUrl} alt="" /> : null}
              </span>
              <div className="component-dynamic-island__content">
                <div className="component-dynamic-island__header">
                  <div className="component-dynamic-island__headline" title={metaLabel ? `${snapshot.title} · ${metaLabel}` : snapshot.title}>
                    <span className="component-dynamic-island__title">{snapshot.title}</span>
                    {metaLabel ? (
                      <span className="component-dynamic-island__meta">
                        {metaLabel}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="component-dynamic-island__footer">
                  <div className="component-dynamic-island__progress">
                    <div
                      className="component-dynamic-island__progress-fill"
                      style={{ width: `${Math.max(0, Math.min(100, snapshot.progress))}%` }}
                    />
                  </div>
                  <div className="component-dynamic-island__times">
                    <span>{snapshot.elapsedLabel}</span>
                    <span>{snapshot.durationLabel}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
