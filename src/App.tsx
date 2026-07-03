import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { AppShell } from "./app/AppShell";
import { ComponentControlWindow } from "./app/ComponentControlWindow";
import { ComponentDynamicIslandWindow } from "./app/ComponentDynamicIslandWindow";
import { ComponentSongInfoCardWindow } from "./app/ComponentSongInfoCardWindow";
import { ImmersiveWallpaperWindow } from "./app/ImmersiveWallpaperWindow";
import { bootstrapMediaLibrary } from "./media/bootstrap";
import { bootstrapAppSettings } from "./settings/bootstrap";
import { createDefaultAppSettings } from "./settings/types";
import { getAppSettings } from "./settings/store";

const SPECIAL_WINDOW_KINDS = [
  "component-control",
  "component-dynamic-island",
  "component-song-info-card",
  "immersive-wallpaper",
] as const;
type SpecialWindowKind = (typeof SPECIAL_WINDOW_KINDS)[number];

function isSpecialWindowKind(value: string | null | undefined): value is SpecialWindowKind {
  return SPECIAL_WINDOW_KINDS.includes(value as SpecialWindowKind);
}

const currentWindowKind = (() => {
  try {
    const scriptedWindowKind = (
      window as Window & {
        __CELIA_WINDOW_KIND__?: string;
      }
    ).__CELIA_WINDOW_KIND__;
    if (isSpecialWindowKind(scriptedWindowKind)) {
      return scriptedWindowKind;
    }
  } catch {
    // Ignore scripted window kind lookup failures and keep falling back.
  }

  try {
    const searchParams = new URLSearchParams(window.location.search);
    const routedWindow = searchParams.get("window");
    if (isSpecialWindowKind(routedWindow)) {
      return routedWindow;
    }
  } catch {
    // Ignore search parsing failures and fall back to the Tauri label.
  }

  try {
    const label = getCurrentWindow().label;
    if (isSpecialWindowKind(label)) {
      return label;
    }
  } catch {
    // Ignore and use the main window fallback below.
  }

  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
})();

function App() {
  const defaultStartupAppearance = createDefaultAppSettings().appearance;
  const [startupAnimationMode, setStartupAnimationMode] = useState(
    defaultStartupAppearance.startupAnimation,
  );
  const [startupAnimationDurationMs, setStartupAnimationDurationMs] = useState(
    defaultStartupAppearance.startupAnimationDurationMs,
  );
  const [isStartupAnimationResolved, setIsStartupAnimationResolved] = useState(
    currentWindowKind !== "main",
  );

  useEffect(() => {
    document.body.style.overflow = "hidden";

    if (currentWindowKind === "main") {
      void bootstrapMediaLibrary();
      void bootstrapAppSettings();

      let isMounted = true;

      void getAppSettings()
        .then((snapshot) => {
          if (!isMounted) {
            return;
          }

          setStartupAnimationMode(snapshot.settings.appearance.startupAnimation);
          setStartupAnimationDurationMs(snapshot.settings.appearance.startupAnimationDurationMs);
          setIsStartupAnimationResolved(true);
        })
        .catch(() => {
          if (!isMounted) {
            return;
          }

          setStartupAnimationMode(defaultStartupAppearance.startupAnimation);
          setStartupAnimationDurationMs(defaultStartupAppearance.startupAnimationDurationMs);
          setIsStartupAnimationResolved(true);
        });

      return () => {
        isMounted = false;
      };
    }
  }, []);

  if (currentWindowKind === "component-control") {
    return <ComponentControlWindow />;
  }

  if (currentWindowKind === "component-dynamic-island") {
    return <ComponentDynamicIslandWindow />;
  }

  if (currentWindowKind === "component-song-info-card") {
    return <ComponentSongInfoCardWindow />;
  }

  if (currentWindowKind === "immersive-wallpaper") {
    return <ImmersiveWallpaperWindow />;
  }

  if (!isStartupAnimationResolved) {
    return null;
  }

  return (
    <AppShell
      initialStartupAnimationMode={startupAnimationMode}
      initialStartupAnimationDurationMs={startupAnimationDurationMs}
    />
  );
}

export default App;
