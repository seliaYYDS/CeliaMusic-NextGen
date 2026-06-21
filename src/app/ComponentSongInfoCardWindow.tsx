import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  LogicalPosition,
  LogicalSize,
  PhysicalPosition,
  currentMonitor,
  cursorPosition,
  getAllWindows,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import { createDefaultAppSettings } from "../settings/types";
import {
  listenComponentSongInfoCardSettings,
  listenComponentSongInfoCardSnapshot,
  readComponentSongInfoCardPosition,
  readComponentSongInfoCardSettings,
  writeComponentSongInfoCardPosition,
  type ComponentSongInfoCardSettings,
  type ComponentSongInfoCardSnapshot,
} from "./componentSongInfoCardSync";
import "./styles.css";
import "./component-windows.css";

const EMPTY_SNAPSHOT: ComponentSongInfoCardSnapshot = {
  hasTrack: false,
  title: "暂无播放",
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
const CARD_BODY_HEIGHT = 96;
const BOX_CARD_BODY_HEIGHT = 246;
const HIDE_NEARBY_THRESHOLD_PX = 72;
const DEFAULT_CARD_WIDTH = 452;
const DEFAULT_CARD_MIN_WIDTH = 400;
const DEFAULT_CARD_MAX_WIDTH = 540;
const MINIMAL_CARD_WIDTH = 360;
const MINIMAL_CARD_MIN_WIDTH = 320;
const MINIMAL_CARD_MAX_WIDTH = 460;
const BOX_CARD_WIDTH = 220;
const BOX_CARD_MIN_WIDTH = 220;
const BOX_CARD_MAX_WIDTH = 260;
const CARD_BODY_CONTENT_PADDING_X = 16;

type CardPalette = {
  background: string;
  backgroundSecondary: string;
  gradientStart: string;
  gradientEnd: string;
  text: string;
  subtext: string;
  accent: string;
  track: string;
  progressFill: string;
  border: string;
};

type DragState = {
  offsetX: number;
  offsetY: number;
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

function ensureOpaqueColor(input: string | null | undefined, fallback: string) {
  if (typeof input !== "string") {
    return fallback;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return fallback;
  }

  const hexMatch = /^#([0-9a-f]{6})$/i.exec(normalizeHexColor(trimmed, ""));
  if (hexMatch) {
    return `#${hexMatch[1].toLowerCase()}`;
  }

  const rgbMatch =
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*[\d.]+\s*)?\)$/i.exec(trimmed);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch;
    const toHex = (value: string) =>
      clampNumber(Math.round(Number.parseFloat(value)), 0, 255).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  return fallback;
}

function resolveCardPalette(
  settings: ComponentSongInfoCardSettings,
  snapshot: ComponentSongInfoCardSnapshot,
): CardPalette {
  const fallbackBackground = snapshot.colorScheme === "dark" ? "#0d121a" : "#f5f7fb";
  const resolvedBackground = ensureOpaqueColor(
    snapshot.resolvedDynamicIslandBackground,
    fallbackBackground,
  );
  const resolvedAccent =
    typeof snapshot.resolvedDynamicIslandAccent === "string" &&
    snapshot.resolvedDynamicIslandAccent.trim()
      ? snapshot.resolvedDynamicIslandAccent.trim()
      : "";
  const accent = normalizeHexColor(snapshot.primaryColor, "#2d5fa8");

  const isDark =
    settings.colorMode === "dark" ||
    (settings.colorMode === "follow-system" &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches) ||
    (settings.colorMode === "follow-app" && snapshot.colorScheme === "dark");

  if (settings.colorMode === "follow-app") {
    const background = mixHexColors(resolvedBackground, "#202a37", 0.2);
    const gradientStart = mixHexColors(
      normalizeHexColor(snapshot.primaryColor, resolvedBackground),
      "#18212d",
      0.58,
    );
    const gradientEnd = mixHexColors(
      normalizeHexColor(snapshot.secondaryColor, resolvedAccent || "#8ecdf4"),
      "#223246",
      0.52,
    );
    return {
      background,
      backgroundSecondary: mixHexColors(background, ensureOpaqueColor(resolvedAccent, "#8ecdf4"), 0.24),
      gradientStart,
      gradientEnd,
      text: "#f7fbff",
      subtext: "rgba(230, 238, 248, 0.72)",
      accent: ensureOpaqueColor(
        resolvedAccent,
        normalizeHexColor(snapshot.secondaryColor, "#8ecdf4"),
      ),
      track: "rgba(255, 255, 255, 0.14)",
      progressFill: "#ffffff",
      border: "rgba(255, 255, 255, 0.08)",
    };
  }

  return isDark
    ? {
        background: "#0d121a",
        backgroundSecondary: "#1a2330",
        gradientStart: "#0d121a",
        gradientEnd: "#1a2330",
        text: "#f7fbff",
        subtext: mixHexColors(accent, "#b9c7d8", 0.84),
        accent: resolvedAccent || normalizeHexColor(snapshot.secondaryColor, "#8ecdf4"),
        track: "rgba(255, 255, 255, 0.14)",
        progressFill: "#ffffff",
        border: "rgba(255, 255, 255, 0.08)",
      }
    : {
        background: "#f5f7fb",
        backgroundSecondary: "#dbe6f7",
        gradientStart: "#f5f7fb",
        gradientEnd: "#dbe6f7",
        text: "#111827",
        subtext: "rgba(17, 24, 39, 0.62)",
        accent: resolvedAccent || normalizeHexColor(snapshot.secondaryColor, "#3468c9"),
        track: "rgba(17, 24, 39, 0.12)",
        progressFill: "#111827",
        border: "rgba(17, 24, 39, 0.08)",
      };
}

function getCardMetrics(style: ComponentSongInfoCardSettings["style"]) {
  if (style === "box") {
    return {
      defaultWidth: BOX_CARD_WIDTH,
      minWidth: BOX_CARD_MIN_WIDTH,
      maxWidth: BOX_CARD_MAX_WIDTH,
      bodyHeight: BOX_CARD_BODY_HEIGHT,
    };
  }

  if (style === "minimal") {
    return {
      defaultWidth: MINIMAL_CARD_WIDTH,
      minWidth: MINIMAL_CARD_MIN_WIDTH,
      maxWidth: MINIMAL_CARD_MAX_WIDTH,
      bodyHeight: CARD_BODY_HEIGHT,
    };
  }

  return {
    defaultWidth: DEFAULT_CARD_WIDTH,
    minWidth: DEFAULT_CARD_MIN_WIDTH,
    maxWidth: DEFAULT_CARD_MAX_WIDTH,
    bodyHeight: CARD_BODY_HEIGHT,
  };
}

function isCursorInsideCard(
  cursorX: number,
  cursorY: number,
  windowX: number,
  windowY: number,
  windowWidth: number,
  bodyWidth: number,
  bodyHeight: number,
) {
  const cardLeft = windowX + Math.max(0, Math.round((windowWidth - bodyWidth) / 2));
  const cardTop = windowY;
  const cardRight = cardLeft + bodyWidth;
  const cardBottom = cardTop + bodyHeight;

  return cursorX >= cardLeft && cursorX <= cardRight && cursorY >= cardTop && cursorY <= cardBottom;
}

export function ComponentSongInfoCardWindow() {
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const [settings, setSettings] = useState<ComponentSongInfoCardSettings>(() =>
    readComponentSongInfoCardSettings(),
  );
  const [snapshot, setSnapshot] = useState<ComponentSongInfoCardSnapshot>(EMPTY_SNAPSHOT);
  const [isHiddenForCursor, setIsHiddenForCursor] = useState(false);
  const [isHiddenForMainWindow, setIsHiddenForMainWindow] = useState(false);
  const [isHiddenForFullscreenApp, setIsHiddenForFullscreenApp] = useState(false);
  const metrics = getCardMetrics(settings.style);
  const [bodyWidth, setBodyWidth] = useState(metrics.defaultWidth);
  const [isDragHintVisible, setIsDragHintVisible] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [hasCustomPosition, setHasCustomPosition] = useState(() => readComponentSongInfoCardPosition() !== null);
  const palette = resolveCardPalette(settings, snapshot);
  const scale = settings.scale / 100;
  const hasActivePlayback = snapshot.hasTrack && snapshot.isPlaying;
  const metaLabel = snapshot.artist?.trim() || snapshot.album?.trim() || "等待歌曲开始播放";
  const titleLabel = snapshot.hasTrack ? snapshot.title : "暂无播放";
  const progressValue = snapshot.hasTrack ? Math.max(0, Math.min(100, snapshot.progress)) : 0;
  const measuredBodyNode =
    typeof document !== "undefined"
      ? (document.querySelector(".component-song-info-card__body") as HTMLDivElement | null)
      : null;
  const bodyHeight = measuredBodyNode ? Math.ceil(measuredBodyNode.scrollHeight) : metrics.bodyHeight;

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    document.body.style.margin = "0";
    void currentWindow.setDecorations(false).catch(() => undefined);
    void currentWindow.setShadow(false).catch(() => undefined);
    void currentWindow.setAlwaysOnTop(settings.alwaysOnTop).catch(() => undefined);
  }, [currentWindow, settings.alwaysOnTop]);

  useEffect(() => {
    let disposed = false;
    let unlistenSettings: (() => void) | null = null;
    let unlistenSnapshot: (() => void) | null = null;

    void listenComponentSongInfoCardSettings((payload) => {
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

    void listenComponentSongInfoCardSnapshot((payload) => {
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

  useEffect(() => {
    const updateBodyWidth = () => {
      const selector =
        settings.style === "box"
          ? ".component-song-info-card__measure-box"
          : settings.style === "minimal"
            ? ".component-song-info-card__measure-minimal"
            : ".component-song-info-card__measure-playback";
      const measureNode = document.querySelector(selector) as HTMLDivElement | null;

      const nextWidth = clampNumber(
        Math.ceil((measureNode?.scrollWidth ?? metrics.defaultWidth) + CARD_BODY_CONTENT_PADDING_X),
        metrics.minWidth,
        metrics.maxWidth,
      );

      setBodyWidth((current) => (current === nextWidth ? current : nextWidth));
    };

    updateBodyWidth();
    const frameId = window.requestAnimationFrame(updateBodyWidth);
    const resizeTimer = window.setTimeout(updateBodyWidth, 120);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(resizeTimer);
    };
  }, [
    metaLabel,
    metrics.defaultWidth,
    metrics.maxWidth,
    metrics.minWidth,
    settings.style,
    snapshot.durationLabel,
    snapshot.elapsedLabel,
    titleLabel,
  ]);

  useEffect(() => {
    const syncWindowBounds = async () => {
      const monitor = await currentMonitor().catch(() => null);
      if (!monitor) {
        return;
      }

      const scaleFactor = await currentWindow.scaleFactor().catch(() => monitor.scaleFactor);
      const monitorPosition = monitor.position.toLogical(scaleFactor);
      const monitorSize = monitor.size.toLogical(scaleFactor);
      const windowWidth = Math.ceil(metrics.maxWidth * scale) + (WINDOW_MEASURE_PADDING_X * 2);
      const measuredBodyHeight = bodyHeight;
      const windowHeight =
        Math.ceil(Math.max(bodyHeight, measuredBodyHeight) * scale) + WINDOW_MEASURE_PADDING_BOTTOM;
      const centeredX = monitorPosition.x + Math.max(0, (monitorSize.width - windowWidth) / 2);
      const topOffset = monitorPosition.y + SEPARATED_TOP_OFFSET;
      const savedPosition = readComponentSongInfoCardPosition();

      await currentWindow.setSize(new LogicalSize(windowWidth, windowHeight)).catch(() => undefined);

      if (savedPosition && hasCustomPosition) {
        await currentWindow
          .setPosition(new PhysicalPosition(savedPosition.x, savedPosition.y))
          .catch(() => undefined);
        return;
      }

      await currentWindow.setPosition(new LogicalPosition(centeredX, topOffset)).catch(() => undefined);
    };

    const frameId = window.requestAnimationFrame(() => {
      void syncWindowBounds();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [bodyHeight, currentWindow, hasCustomPosition, metrics.maxWidth, scale]);

  useEffect(() => {
    let disposed = false;

    const syncMiddleDrag = async () => {
      const [isMiddlePressed, cursor, windowPosition, windowSize] = await Promise.all([
        invoke<boolean>("is_middle_mouse_pressed").catch(() => false),
        cursorPosition().catch(() => null),
        currentWindow.outerPosition().catch(() => null),
        currentWindow.outerSize().catch(() => null),
      ]);

      if (disposed || !cursor || !windowPosition || !windowSize) {
        return;
      }

      const physicalCursorX = cursor.x;
      const physicalCursorY = cursor.y;
      const physicalWindowX = windowPosition.x;
      const physicalWindowY = windowPosition.y;
      const physicalWindowWidth = windowSize.width;

      const measuredBodyWidth = Math.round(bodyWidth * scale);
      const measuredBodyHeight = Math.round(bodyHeight * scale);
      const cardLeft =
        physicalWindowX + Math.max(0, Math.round((physicalWindowWidth - measuredBodyWidth) / 2));
      const isInside = isCursorInsideCard(
        physicalCursorX,
        physicalCursorY,
        physicalWindowX,
        physicalWindowY,
        physicalWindowWidth,
        measuredBodyWidth,
        measuredBodyHeight,
      );

      if (isMiddlePressed && dragState === null && isInside) {
        setDragState({
          offsetX: physicalCursorX - cardLeft,
          offsetY: physicalCursorY - physicalWindowY,
        });
        setIsDragHintVisible(true);
        return;
      }

      if (isMiddlePressed && dragState) {
        const cardOffsetWithinWindow = Math.max(
          0,
          Math.round((physicalWindowWidth - measuredBodyWidth) / 2),
        );
        await currentWindow
          .setPosition(
            new PhysicalPosition(
              physicalCursorX - dragState.offsetX - cardOffsetWithinWindow,
              physicalCursorY - dragState.offsetY,
            ),
          )
          .catch(() => undefined);
        return;
      }

      if (!isMiddlePressed && dragState) {
        const position = await currentWindow.outerPosition().catch(() => null);
        if (position) {
          writeComponentSongInfoCardPosition({ x: position.x, y: position.y });
          setHasCustomPosition(true);
        }
        setDragState(null);
        window.setTimeout(() => {
          setIsDragHintVisible(false);
        }, 600);
      }
    };

    void syncMiddleDrag();
    const timer = window.setInterval(() => {
      void syncMiddleDrag();
    }, 40);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [bodyHeight, bodyWidth, currentWindow, dragState, scale]);

  useEffect(() => {
    if (!settings.hideOnMouseNearby || dragState) {
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

      const measuredBodyWidth = Math.round(bodyWidth * scale);
      const cardLeft = windowPosition.x + Math.max(0, Math.round((windowSize.width - measuredBodyWidth) / 2));
      const cardTop = windowPosition.y;
      const cardRight = cardLeft + measuredBodyWidth;
      const cardBottom = cardTop + Math.round(bodyHeight * scale);

      const dx =
        cursor.x < cardLeft ? cardLeft - cursor.x : cursor.x > cardRight ? cursor.x - cardRight : 0;
      const dy =
        cursor.y < cardTop ? cardTop - cursor.y : cursor.y > cardBottom ? cursor.y - cardBottom : 0;
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
  }, [bodyHeight, bodyWidth, currentWindow, dragState, scale, settings.hideOnMouseNearby]);

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

  useEffect(() => {
    if (!settings.hideWhenOtherAppsFullscreen) {
      setIsHiddenForFullscreenApp(false);
      return;
    }

    let disposed = false;

    const updateFullscreenVisibility = async () => {
      const isFullscreen = await invoke<boolean>("is_other_app_fullscreen").catch(() => false);
      if (disposed) {
        return;
      }

      setIsHiddenForFullscreenApp((previous) =>
        previous === Boolean(isFullscreen) ? previous : Boolean(isFullscreen),
      );
    };

    void updateFullscreenVisibility();
    const timer = window.setInterval(() => {
      void updateFullscreenVisibility();
    }, 500);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [settings.hideWhenOtherAppsFullscreen]);

  const shouldHideForIdle = settings.hideWhenIdle && !hasActivePlayback;
  const isCardHidden =
    isHiddenForCursor || isHiddenForMainWindow || isHiddenForFullscreenApp || shouldHideForIdle;

  return (
    <div className="component-song-info-card-window">
      <div
        className={[
          "component-song-info-card",
          isCardHidden ? "component-song-info-card--hidden" : "",
          `component-song-info-card--${settings.style}`,
        ].join(" ")}
        data-background-mode={settings.backgroundMode}
        style={
          {
            "--component-song-info-card-scale": String(scale),
            "--component-song-info-card-width": `${bodyWidth}px`,
            "--component-song-info-card-bg": palette.background,
            "--component-song-info-card-bg-secondary": palette.backgroundSecondary,
            "--component-song-info-card-gradient-start": palette.gradientStart,
            "--component-song-info-card-gradient-end": palette.gradientEnd,
            "--component-song-info-card-text": palette.text,
            "--component-song-info-card-subtext": palette.subtext,
            "--component-song-info-card-accent": palette.accent,
            "--component-song-info-card-track": palette.track,
            "--component-song-info-card-progress-fill": palette.progressFill,
            "--component-song-info-card-border": palette.border,
            "--component-song-info-card-artwork-url": snapshot.artworkUrl ? `url("${snapshot.artworkUrl}")` : "none",
          } as CSSProperties
        }
      >
        <div className="component-song-info-card__body component-song-info-card__body--playback">
          {settings.style === "box" ? (
            <div className="component-song-info-card__box-layout">
              <span className="component-song-info-card__box-artwork" aria-hidden="true">
                {snapshot.artworkUrl ? <img src={snapshot.artworkUrl} alt="" /> : null}
              </span>
              <div className="component-song-info-card__box-meta">
                <span className="component-song-info-card__title">{titleLabel}</span>
                <span className="component-song-info-card__meta">{metaLabel}</span>
              </div>
              <div className="component-song-info-card__footer component-song-info-card__footer--stacked">
                <div className="component-song-info-card__progress">
                  <div
                    className="component-song-info-card__progress-fill"
                    style={{ width: `${progressValue}%` }}
                  />
                </div>
                <div className="component-song-info-card__times">
                  <span>{snapshot.hasTrack ? snapshot.elapsedLabel : "0:00"}</span>
                  <span>{snapshot.hasTrack ? snapshot.durationLabel : "--:--"}</span>
                </div>
              </div>
            </div>
          ) : settings.style === "minimal" ? (
            <div className="component-song-info-card__minimal-layout">
              <div className="component-song-info-card__minimal-header">
                <div className="component-song-info-card__minimal-headline">
                  <span className="component-song-info-card__title">{titleLabel}</span>
                  <span className="component-song-info-card__meta">{metaLabel}</span>
                </div>
              </div>
              <div className="component-song-info-card__minimal-footer">
                <div className="component-song-info-card__progress">
                  <div
                    className="component-song-info-card__progress-fill"
                    style={{ width: `${progressValue}%` }}
                  />
                </div>
                <div className="component-song-info-card__times">
                  <span>{snapshot.hasTrack ? snapshot.elapsedLabel : "0:00"}</span>
                  <span>{snapshot.hasTrack ? snapshot.durationLabel : "--:--"}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="component-song-info-card__playback-layout">
              <span className="component-song-info-card__artwork" aria-hidden="true">
                {snapshot.artworkUrl ? <img src={snapshot.artworkUrl} alt="" /> : null}
              </span>
              <div className="component-song-info-card__content">
                <div className="component-song-info-card__header">
                  <div
                    className="component-song-info-card__headline"
                    title={snapshot.hasTrack ? (snapshot.artist?.trim() || snapshot.album?.trim() ? `${snapshot.title} · ${metaLabel}` : snapshot.title) : "暂无播放"}
                  >
                    <span className="component-song-info-card__title">{titleLabel}</span>
                    <span className="component-song-info-card__meta">{metaLabel}</span>
                  </div>
                </div>
                <div className="component-song-info-card__footer">
                  <div className="component-song-info-card__progress">
                    <div
                      className="component-song-info-card__progress-fill"
                      style={{ width: `${progressValue}%` }}
                    />
                  </div>
                  <div className="component-song-info-card__times">
                    <span>{snapshot.hasTrack ? snapshot.elapsedLabel : "0:00"}</span>
                    <span>{snapshot.hasTrack ? snapshot.durationLabel : "--:--"}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {isDragHintVisible ? (
          <div className="component-song-info-card__drag-hint">中键按住可拖动位置</div>
        ) : null}

        <div className="component-song-info-card__measure" aria-hidden="true">
          <div className="component-song-info-card__measure-playback">
            <span className="component-song-info-card__measure-artwork" />
            <div className="component-song-info-card__measure-content">
              <div className="component-song-info-card__measure-headline">
                <span className="component-song-info-card__measure-title">{titleLabel}</span>
                <span className="component-song-info-card__measure-meta">{metaLabel}</span>
              </div>
              <div className="component-song-info-card__measure-times">
                <span>{snapshot.hasTrack ? snapshot.elapsedLabel : "0:00"}</span>
                <span>{snapshot.hasTrack ? snapshot.durationLabel : "--:--"}</span>
              </div>
            </div>
          </div>

          <div className="component-song-info-card__measure-box">
            <span className="component-song-info-card__measure-box-artwork" />
            <span className="component-song-info-card__measure-title">{titleLabel}</span>
            <span className="component-song-info-card__measure-meta">{metaLabel}</span>
            <div className="component-song-info-card__measure-times">
              <span>{snapshot.hasTrack ? snapshot.elapsedLabel : "0:00"}</span>
              <span>{snapshot.hasTrack ? snapshot.durationLabel : "--:--"}</span>
            </div>
          </div>

          <div className="component-song-info-card__measure-minimal">
            <div className="component-song-info-card__measure-headline component-song-info-card__measure-headline--inline">
              <span className="component-song-info-card__measure-title">{titleLabel}</span>
              <span className="component-song-info-card__measure-meta">{metaLabel}</span>
            </div>
            <div className="component-song-info-card__measure-times">
              <span>{snapshot.hasTrack ? snapshot.elapsedLabel : "0:00"}</span>
              <span>{snapshot.hasTrack ? snapshot.durationLabel : "--:--"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
