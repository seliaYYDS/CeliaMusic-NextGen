import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize, PhysicalPosition, cursorPosition, getAllWindows, getCurrentWindow } from "@tauri-apps/api/window";
import {
  listenComponentLyricsDisplaySettings,
  listenComponentLyricsDisplaySnapshot,
  readComponentLyricsDisplayPosition,
  readComponentLyricsDisplaySettings,
  writeComponentLyricsDisplayPosition,
  type ComponentLyricsDisplaySnapshot,
} from "./componentLyricsDisplaySync";
import "./component-windows.css";

const HIDE_NEARBY_THRESHOLD_PX = 72;

type DragState = {
  offsetX: number;
  offsetY: number;
};

export function ComponentLyricsDisplayWindow() {
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const [settings, setSettings] = useState(() => readComponentLyricsDisplaySettings());
  const [snapshot, setSnapshot] = useState<ComponentLyricsDisplaySnapshot>({
    isPlaying: false,
    lines: [],
    activeLineIndex: -1,
    currentTimeMs: 0,
  });
  const [isHiddenForCursor, setIsHiddenForCursor] = useState(false);
  const [isHiddenForMainWindow, setIsHiddenForMainWindow] = useState(false);
  const [isHiddenForFullscreenApp, setIsHiddenForFullscreenApp] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [isSizeRangeVisible, setIsSizeRangeVisible] = useState(false);
  const [wordPlayheadTimeMs, setWordPlayheadTimeMs] = useState(0);
  const wordPlayheadAnchorRef = useRef({ timeMs: 0, performanceNow: performance.now() });
  const lyricLineNodesRef = useRef(new Map<number, HTMLDivElement>());
  const [lyricLineHeights, setLyricLineHeights] = useState<Record<number, number>>({});
  const sizeHintInitializedRef = useRef(false);
  const sizeHintTimerRef = useRef<number | null>(null);
  const scale = settings.scale / 100;

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    document.body.style.margin = "0";
    document.body.style.overflow = "hidden";
    void currentWindow.setDecorations(false).catch(() => undefined);
    void currentWindow.setShadow(false).catch(() => undefined);
    void currentWindow.setAlwaysOnTop(settings.alwaysOnTop).catch(() => undefined);
    const savedPosition = readComponentLyricsDisplayPosition();
    if (savedPosition) {
      void currentWindow.setPosition(new PhysicalPosition(savedPosition.x, savedPosition.y)).catch(() => undefined);
    }
  }, [currentWindow, settings.alwaysOnTop]);

  useEffect(() => {
    void currentWindow
      .setSize(new LogicalSize(settings.width, settings.height))
      .catch(() => undefined);
  }, [currentWindow, settings.height, settings.width]);

  useEffect(() => {
    if (!sizeHintInitializedRef.current) {
      sizeHintInitializedRef.current = true;
      return;
    }

    setIsSizeRangeVisible(true);
    if (sizeHintTimerRef.current !== null) {
      window.clearTimeout(sizeHintTimerRef.current);
    }
    sizeHintTimerRef.current = window.setTimeout(() => {
      setIsSizeRangeVisible(false);
      sizeHintTimerRef.current = null;
    }, 1200);

    return () => {
      if (sizeHintTimerRef.current !== null) {
        window.clearTimeout(sizeHintTimerRef.current);
      }
    };
  }, [settings.height, settings.width]);

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

      const isInside =
        cursor.x >= windowPosition.x &&
        cursor.x <= windowPosition.x + windowSize.width &&
        cursor.y >= windowPosition.y &&
        cursor.y <= windowPosition.y + windowSize.height;

      if (isMiddlePressed && dragState === null && isInside) {
        setDragState({
          offsetX: cursor.x - windowPosition.x,
          offsetY: cursor.y - windowPosition.y,
        });
        return;
      }

      if (isMiddlePressed && dragState) {
        await currentWindow
          .setPosition(new PhysicalPosition(cursor.x - dragState.offsetX, cursor.y - dragState.offsetY))
          .catch(() => undefined);
        return;
      }

      if (!isMiddlePressed && dragState) {
        const position = await currentWindow.outerPosition().catch(() => null);
        if (position) {
          writeComponentLyricsDisplayPosition({ x: position.x, y: position.y });
        }
        setDragState(null);
      }
    };

    void syncMiddleDrag();
    const timer = window.setInterval(() => void syncMiddleDrag(), 40);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [currentWindow, dragState]);

  useEffect(() => {
    let disposed = false;
    let unlistenSettings: (() => void) | null = null;
    let unlistenSnapshot: (() => void) | null = null;

    void listenComponentLyricsDisplaySettings((payload) => {
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

    void listenComponentLyricsDisplaySnapshot((payload) => {
      if (!disposed) {
        setSnapshot(payload);
      }
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
    wordPlayheadAnchorRef.current = {
      timeMs: snapshot.currentTimeMs,
      performanceNow: performance.now(),
    };
    setWordPlayheadTimeMs(snapshot.currentTimeMs);
  }, [snapshot.currentTimeMs]);

  useEffect(() => {
    if (!snapshot.isPlaying) {
      return;
    }

    let frameId = 0;
    const tick = (frameNow: number) => {
      const anchor = wordPlayheadAnchorRef.current;
      setWordPlayheadTimeMs(anchor.timeMs + (frameNow - anchor.performanceNow));
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [snapshot.isPlaying]);

  useEffect(() => {
    const updateHeights = () => {
      const nextHeights: Record<number, number> = {};
      lyricLineNodesRef.current.forEach((node, index) => {
        nextHeights[index] = Math.max(1, Math.ceil(node.getBoundingClientRect().height));
      });
      setLyricLineHeights(nextHeights);
    };
    const observer = new ResizeObserver(updateHeights);
    lyricLineNodesRef.current.forEach((node) => observer.observe(node));
    const frameId = window.requestAnimationFrame(updateHeights);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frameId);
    };
  }, [snapshot.lines.map((line) => line.text).join("\u0001"), settings.alignment, settings.fontSize, settings.height, settings.width]);

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

      const dx = cursor.x < windowPosition.x ? windowPosition.x - cursor.x : cursor.x > windowPosition.x + windowSize.width ? cursor.x - (windowPosition.x + windowSize.width) : 0;
      const dy = cursor.y < windowPosition.y ? windowPosition.y - cursor.y : cursor.y > windowPosition.y + windowSize.height ? cursor.y - (windowPosition.y + windowSize.height) : 0;
      const shouldHide = Math.hypot(dx, dy) <= HIDE_NEARBY_THRESHOLD_PX;
      setIsHiddenForCursor((previous) => (previous === shouldHide ? previous : shouldHide));
    };

    void updateCursorVisibility();
    const timer = window.setInterval(() => void updateCursorVisibility(), 120);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [currentWindow, settings.hideOnMouseNearby]);

  useEffect(() => {
    if (!settings.hideWhenMainWindowVisible) {
      setIsHiddenForMainWindow(false);
      return;
    }

    let disposed = false;
    const updateMainWindowVisibility = async () => {
      const mainWindow = (await getAllWindows().catch(() => [])).find((window) => window.label === "main");
      if (!mainWindow) {
        return;
      }
      const [visible, minimized] = await Promise.all([
        mainWindow.isVisible().catch(() => false),
        mainWindow.isMinimized().catch(() => false),
      ]);
      if (!disposed) {
        setIsHiddenForMainWindow(Boolean(visible) && !Boolean(minimized));
      }
    };

    void updateMainWindowVisibility();
    const timer = window.setInterval(() => void updateMainWindowVisibility(), 300);
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
      const shouldHide = await invoke<boolean>("is_other_app_fullscreen").catch(() => false);
      if (!disposed) {
        setIsHiddenForFullscreenApp(Boolean(shouldHide));
      }
    };

    void updateFullscreenVisibility();
    const timer = window.setInterval(() => void updateFullscreenVisibility(), 500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [settings.hideWhenOtherAppsFullscreen]);

  const isHidden =
    isHiddenForCursor ||
    isHiddenForMainWindow ||
    isHiddenForFullscreenApp ||
    (settings.hideWhenIdle && !snapshot.isPlaying);
  const lyrics = snapshot.lines.filter((line) => line.text.trim().length > 0);
  const activeLineIndex = Math.max(0, Math.min(snapshot.activeLineIndex, lyrics.length - 1));
  const lyricLineHeight = Math.max(64, settings.fontSize * 2);
  const resolveLyricBlockHeight = (line: (typeof lyrics)[number], index: number) =>
    lyricLineHeights[index] ??
    lyricLineHeight + (line.translatedText?.trim() ? Math.round(settings.fontSize * 0.9) : 0);
  const lyricLineCenters = lyrics.map((_, index) => {
    const beforeHeight = lyrics.slice(0, index).reduce(
      (offset, line, previousIndex) =>
        offset + resolveLyricBlockHeight(line, previousIndex) + settings.lineGap,
      0,
    );
    return beforeHeight + (resolveLyricBlockHeight(lyrics[index], index) / 2);
  });
  const activeLineCenter = lyricLineCenters[activeLineIndex] ?? lyricLineHeight / 2;
  const lyricAnimationDurationMs = Math.round(
    Math.max(260, Math.min(1200, 660 / (settings.animationSpeed / 100))),
  );

  return (
    <div
      className={[
        "component-lyrics-display-window",
        isHidden ? "component-lyrics-display-window--hidden" : "",
      ].join(" ")}
      style={
        {
          "--component-lyrics-display-scale": String(scale),
          "--component-lyrics-display-font-size": `${settings.fontSize}px`,
          "--component-lyrics-display-line-height": `${lyricLineHeight}px`,
          "--component-lyrics-display-text-align": settings.alignment,
          "--component-lyrics-display-shadow-alpha": settings.textShadow
            ? `${(settings.textShadowIntensity / 100) * 0.62}`
            : "0",
          "--component-lyrics-display-glow-alpha": settings.glow
            ? `${(settings.glowIntensity / 100) * 0.7}`
            : "0",
        } as CSSProperties
      }
      aria-hidden="true"
    >
      <div className="component-lyrics-display-window__content">
        {lyrics.length > 0 ? (
          <div className="component-lyrics-display-window__viewport">
          <div
            className="component-lyrics-display-window__track"
          >
            {lyrics.map((line, index) => {
              const distance = Math.abs(index - activeLineIndex);
              const fadeProgress = Math.max(0, (distance - 0.4) / settings.fadeLength);
              const isActiveLine = index === activeLineIndex;
              const relativeIndex = index - activeLineIndex;
              const staggerIndex = Math.max(0, Math.min(10, relativeIndex + 5));
              const scrollTimingOffsetMs = staggerIndex * settings.scrollDelayMs;
              const verticalOffset =
                (lyricLineCenters[index] ?? 0) -
                activeLineCenter -
                (resolveLyricBlockHeight(line, index) / 2);
              return (
                <div
                  key={`${index}:${line.text}`}
                  ref={(node) => {
                    if (node) {
                      lyricLineNodesRef.current.set(index, node);
                    } else {
                      lyricLineNodesRef.current.delete(index);
                    }
                  }}
                  className={[
                    "component-lyrics-display-window__line",
                    isActiveLine ? "component-lyrics-display-window__line--active" : "",
                  ].join(" ")}
                  style={{
                    opacity: isActiveLine ? 1 : Math.max(0.08, 1 - Math.pow(fadeProgress, 1.18) * 0.9),
                    transform: `translateY(${verticalOffset}px)`,
                    transitionDelay: `${scrollTimingOffsetMs}ms`,
                    transitionDuration: `${lyricAnimationDurationMs}ms`,
                    transitionTimingFunction: "cubic-bezier(0.14, 0.82, 0.16, 1.02)",
                  }}
                >
                  <span className="component-lyrics-display-window__primary">
                    <span className="component-lyrics-display-window__primary-shadow" aria-hidden="true">{line.text}</span>
                    <span className="component-lyrics-display-window__primary-glow" aria-hidden="true">{line.text}</span>
                    <span className="component-lyrics-display-window__primary-content">
                      {isActiveLine && settings.wordLyricsEnabled && line.words.length > 0 ? (
                        <span className="component-lyrics-display-window__words">
                          {line.words.map((word, wordIndex) => {
                            const durationMs = Math.max(1, word.endTimeMs - word.startTimeMs);
                            const fillProgress = Math.max(0, Math.min(1, (wordPlayheadTimeMs - word.startTimeMs) / durationMs));
                            return <span key={`${word.startTimeMs}:${wordIndex}:${word.text}`} className="component-lyrics-display-window__word" style={{ "--component-lyrics-display-word-progress": String(fillProgress) } as CSSProperties}>{word.text}</span>;
                          })}
                        </span>
                      ) : line.text}
                    </span>
                  </span>
                  {line.translatedText?.trim() ? <small>{line.translatedText}</small> : null}
                </div>
              );
            })}
          </div>
          </div>
        ) : (
          <div className="component-lyrics-display-window__empty">无播放</div>
        )}
      </div>
      {dragState || isSizeRangeVisible ? (
        <>
          <div className="component-lyrics-display-window__drag-boundary" aria-hidden="true" />
          <div className="component-lyrics-display-window__size-hint" aria-hidden="true">
            {settings.width} x {settings.height}px, 宽度 360-900px, 高度 480-1080px
          </div>
        </>
      ) : null}
    </div>
  );
}
