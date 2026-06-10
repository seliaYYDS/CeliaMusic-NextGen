import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { AppShell } from "./app/AppShell";
import { ComponentControlWindow } from "./app/ComponentControlWindow";
import { ComponentDynamicIslandWindow } from "./app/ComponentDynamicIslandWindow";
import { ImmersiveWallpaperWindow } from "./app/ImmersiveWallpaperWindow";
import { bootstrapMediaLibrary } from "./media/bootstrap";
import { bootstrapAppSettings } from "./settings/bootstrap";

const SPECIAL_WINDOW_KINDS = [
  "component-control",
  "component-dynamic-island",
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
  useEffect(() => {
    document.body.style.overflow = "hidden";

    if (currentWindowKind === "main") {
      void bootstrapMediaLibrary();
      void bootstrapAppSettings();
    }
  }, []);

  if (currentWindowKind === "component-control") {
    return <ComponentControlWindow />;
  }

  if (currentWindowKind === "component-dynamic-island") {
    return <ComponentDynamicIslandWindow />;
  }

  if (currentWindowKind === "immersive-wallpaper") {
    return <ImmersiveWallpaperWindow />;
  }

  return <AppShell />;
}

export default App;
