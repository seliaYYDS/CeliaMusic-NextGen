import type { NeteaseSongLyrics } from "../network/types";
import type { AppearanceSettings, LyricsSettings } from "../settings/types";

export type ImmersiveWallpaperPaletteSample = {
  color: string;
  x: number;
  y: number;
  weight: number;
};

export type ImmersiveWallpaperPalette = {
  base: string;
  secondary: string;
  glow: string;
  edge: string;
  samples: ImmersiveWallpaperPaletteSample[];
};

export type ImmersiveWallpaperStaticSnapshot = {
  version: 1;
  locale: string;
  hasTrack: boolean;
  trackId: string | null;
  title: string;
  artist: string | null;
  album: string | null;
  artworkUrl: string | null;
  palette: ImmersiveWallpaperPalette | null;
  appearanceSettings: AppearanceSettings;
  lyricsSettings: LyricsSettings;
  appBackgroundImageStyle: string;
  appBackgroundVideoSrc: string | null;
  appBackgroundVideoLoop: boolean;
  appBackgroundOpacity: number;
  appBackgroundBlurPx: number;
  appBackgroundDimOpacity: number;
  lyrics: NeteaseSongLyrics | null;
  updatedAtMs: number;
};

export type ImmersiveWallpaperDynamicSnapshot = {
  version: 1;
  currentTimeSeconds: number;
  durationSeconds: number;
  progress: number;
  isPlaying: boolean;
  isPlaybackLoading: boolean;
  isLyricsLoading: boolean;
  currentLyricsTimeMs: number;
  activeLyricLineIndex: number;
  updatedAtMs: number;
};

const STATIC_STORAGE_KEY = "celia:immersive-wallpaper:static";
const STATIC_CHANNEL_NAME = "celia-immersive-wallpaper-static";
const DYNAMIC_STORAGE_KEY = "celia:immersive-wallpaper:dynamic";
const DYNAMIC_CHANNEL_NAME = "celia-immersive-wallpaper-dynamic";

const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  language: "zh-CN",
  fontFamily: "system-ui",
  fontWeight: 400,
  themeMode: "celia-default",
  colorScheme: "light",
  followSongArtworkTheme: false,
  showDynamicIsland: false,
  useBackgroundMv: false,
  backgroundMode: "theme",
  backgroundBlur: 18,
  componentBackdropBlur: 14,
  backgroundDim: 18,
  backgroundImagePath: "",
  backgroundImageOpacity: 82,
  useCompactMode: false,
  showAlbumArtwork: true,
  customThemePrimary: "#7aa2d6",
  customThemeSecondary: "#b7d7f2",
  customThemeSurface: "#eef3fa",
  dynamicIslandStyle: "default",
  dynamicIslandColorMode: "follow-theme",
  dynamicIslandDefaultContent: "time",
  dynamicIslandPosition: "right",
  dynamicIslandShowLyrics: false,
  immersiveBackgroundMode: "flow",
  immersiveBackgroundAnimated: true,
  immersiveBackgroundResolution: 72,
  immersiveBackgroundSpeed: 112,
  immersiveBackgroundBlur: 24,
  immersiveBackgroundSoftness: 58,
};

const DEFAULT_LYRICS_SETTINGS: LyricsSettings = {
  delayMs: 0,
  fontFamily: "system-ui",
  fontWeight: 800,
  fontSize: 140,
  lineSpacing: 130,
  lineAlignment: "upper",
  textAlignment: "left",
  renderMode: "advanced",
  progressBarPreview: true,
  textShadow: false,
  textShadowIntensity: 100,
  textShadowDefinition: 72,
  glow: false,
  glowIntensity: 100,
  glowDefinition: 68,
  animationSpeed: 65,
  lineAnimationStaggerMs: 50,
  blurRange: 52,
  curveAmount: 0,
};

export const EMPTY_IMMERSIVE_WALLPAPER_STATIC_SNAPSHOT: ImmersiveWallpaperStaticSnapshot = {
  version: 1,
  locale: "zh-CN",
  hasTrack: false,
  trackId: null,
  title: "",
  artist: null,
  album: null,
  artworkUrl: null,
  palette: null,
  appearanceSettings: DEFAULT_APPEARANCE_SETTINGS,
  lyricsSettings: DEFAULT_LYRICS_SETTINGS,
  appBackgroundImageStyle: "none",
  appBackgroundVideoSrc: null,
  appBackgroundVideoLoop: true,
  appBackgroundOpacity: 0,
  appBackgroundBlurPx: 0,
  appBackgroundDimOpacity: 0,
  lyrics: null,
  updatedAtMs: 0,
};

export const EMPTY_IMMERSIVE_WALLPAPER_DYNAMIC_SNAPSHOT: ImmersiveWallpaperDynamicSnapshot = {
  version: 1,
  currentTimeSeconds: 0,
  durationSeconds: 0,
  progress: 0,
  isPlaying: false,
  isPlaybackLoading: false,
  isLyricsLoading: false,
  currentLyricsTimeMs: 0,
  activeLyricLineIndex: -1,
  updatedAtMs: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeNullableString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeAppearanceSettings(value: unknown): AppearanceSettings {
  if (!isRecord(value)) {
    return DEFAULT_APPEARANCE_SETTINGS;
  }

  return {
    language: normalizeString(value.language, DEFAULT_APPEARANCE_SETTINGS.language),
    fontFamily: normalizeString(value.fontFamily, DEFAULT_APPEARANCE_SETTINGS.fontFamily),
    fontWeight: normalizeNumber(value.fontWeight, DEFAULT_APPEARANCE_SETTINGS.fontWeight),
    themeMode: normalizeString(value.themeMode, DEFAULT_APPEARANCE_SETTINGS.themeMode),
    colorScheme:
      value.colorScheme === "dark" || value.colorScheme === "light"
        ? value.colorScheme
        : DEFAULT_APPEARANCE_SETTINGS.colorScheme,
    followSongArtworkTheme: normalizeBoolean(
      value.followSongArtworkTheme,
      DEFAULT_APPEARANCE_SETTINGS.followSongArtworkTheme,
    ),
    showDynamicIsland: normalizeBoolean(
      value.showDynamicIsland,
      DEFAULT_APPEARANCE_SETTINGS.showDynamicIsland,
    ),
    useBackgroundMv: normalizeBoolean(value.useBackgroundMv, DEFAULT_APPEARANCE_SETTINGS.useBackgroundMv),
    backgroundMode:
      value.backgroundMode === "custom" || value.backgroundMode === "theme"
        ? value.backgroundMode
        : DEFAULT_APPEARANCE_SETTINGS.backgroundMode,
    backgroundBlur: normalizeNumber(value.backgroundBlur, DEFAULT_APPEARANCE_SETTINGS.backgroundBlur),
    componentBackdropBlur: normalizeNumber(
      value.componentBackdropBlur,
      DEFAULT_APPEARANCE_SETTINGS.componentBackdropBlur,
    ),
    backgroundDim: normalizeNumber(value.backgroundDim, DEFAULT_APPEARANCE_SETTINGS.backgroundDim),
    backgroundImagePath: normalizeString(
      value.backgroundImagePath,
      DEFAULT_APPEARANCE_SETTINGS.backgroundImagePath,
    ),
    backgroundImageOpacity: normalizeNumber(
      value.backgroundImageOpacity,
      DEFAULT_APPEARANCE_SETTINGS.backgroundImageOpacity,
    ),
    useCompactMode: normalizeBoolean(value.useCompactMode, DEFAULT_APPEARANCE_SETTINGS.useCompactMode),
    showAlbumArtwork: normalizeBoolean(value.showAlbumArtwork, DEFAULT_APPEARANCE_SETTINGS.showAlbumArtwork),
    customThemePrimary: normalizeString(
      value.customThemePrimary,
      DEFAULT_APPEARANCE_SETTINGS.customThemePrimary,
    ),
    customThemeSecondary: normalizeString(
      value.customThemeSecondary,
      DEFAULT_APPEARANCE_SETTINGS.customThemeSecondary,
    ),
    customThemeSurface: normalizeString(
      value.customThemeSurface,
      DEFAULT_APPEARANCE_SETTINGS.customThemeSurface,
    ),
    dynamicIslandStyle:
      value.dynamicIslandStyle === "soft" || value.dynamicIslandStyle === "solid" || value.dynamicIslandStyle === "default"
        ? value.dynamicIslandStyle
        : DEFAULT_APPEARANCE_SETTINGS.dynamicIslandStyle,
    dynamicIslandColorMode:
      value.dynamicIslandColorMode === "primary" ||
      value.dynamicIslandColorMode === "secondary" ||
      value.dynamicIslandColorMode === "follow-theme"
        ? value.dynamicIslandColorMode
        : DEFAULT_APPEARANCE_SETTINGS.dynamicIslandColorMode,
    dynamicIslandDefaultContent:
      value.dynamicIslandDefaultContent === "date" ||
      value.dynamicIslandDefaultContent === "datetime" ||
      value.dynamicIslandDefaultContent === "time"
        ? value.dynamicIslandDefaultContent
        : DEFAULT_APPEARANCE_SETTINGS.dynamicIslandDefaultContent,
    dynamicIslandPosition:
      value.dynamicIslandPosition === "left" ||
      value.dynamicIslandPosition === "right" ||
      value.dynamicIslandPosition === "center"
        ? value.dynamicIslandPosition
        : DEFAULT_APPEARANCE_SETTINGS.dynamicIslandPosition,
    dynamicIslandShowLyrics: normalizeBoolean(
      value.dynamicIslandShowLyrics,
      DEFAULT_APPEARANCE_SETTINGS.dynamicIslandShowLyrics,
    ),
    immersiveBackgroundMode:
      value.immersiveBackgroundMode === "palette-solid" ||
      value.immersiveBackgroundMode === "palette-gradient" ||
      value.immersiveBackgroundMode === "app-background" ||
      value.immersiveBackgroundMode === "cover-blur" ||
      value.immersiveBackgroundMode === "flow"
        ? value.immersiveBackgroundMode
        : DEFAULT_APPEARANCE_SETTINGS.immersiveBackgroundMode,
    immersiveBackgroundAnimated: normalizeBoolean(
      value.immersiveBackgroundAnimated,
      DEFAULT_APPEARANCE_SETTINGS.immersiveBackgroundAnimated,
    ),
    immersiveBackgroundResolution: normalizeNumber(
      value.immersiveBackgroundResolution,
      DEFAULT_APPEARANCE_SETTINGS.immersiveBackgroundResolution,
    ),
    immersiveBackgroundSpeed: normalizeNumber(
      value.immersiveBackgroundSpeed,
      DEFAULT_APPEARANCE_SETTINGS.immersiveBackgroundSpeed,
    ),
    immersiveBackgroundBlur: normalizeNumber(
      value.immersiveBackgroundBlur,
      DEFAULT_APPEARANCE_SETTINGS.immersiveBackgroundBlur,
    ),
    immersiveBackgroundSoftness: normalizeNumber(
      value.immersiveBackgroundSoftness,
      DEFAULT_APPEARANCE_SETTINGS.immersiveBackgroundSoftness,
    ),
  };
}

function normalizeLyricsSettings(value: unknown): LyricsSettings {
  if (!isRecord(value)) {
    return DEFAULT_LYRICS_SETTINGS;
  }

  return {
    delayMs: normalizeNumber(value.delayMs, DEFAULT_LYRICS_SETTINGS.delayMs),
    fontFamily: normalizeString(value.fontFamily, DEFAULT_LYRICS_SETTINGS.fontFamily),
    fontWeight: normalizeNumber(value.fontWeight, DEFAULT_LYRICS_SETTINGS.fontWeight),
    fontSize: normalizeNumber(value.fontSize, DEFAULT_LYRICS_SETTINGS.fontSize),
    lineSpacing: normalizeNumber(value.lineSpacing, DEFAULT_LYRICS_SETTINGS.lineSpacing),
    lineAlignment:
      value.lineAlignment === "upper" || value.lineAlignment === "center"
        ? value.lineAlignment
        : DEFAULT_LYRICS_SETTINGS.lineAlignment,
    textAlignment:
      value.textAlignment === "center" || value.textAlignment === "right" || value.textAlignment === "left"
        ? value.textAlignment
        : DEFAULT_LYRICS_SETTINGS.textAlignment,
    renderMode:
      value.renderMode === "simple" || value.renderMode === "balanced"
        ? value.renderMode
        : DEFAULT_LYRICS_SETTINGS.renderMode,
    progressBarPreview: normalizeBoolean(value.progressBarPreview, DEFAULT_LYRICS_SETTINGS.progressBarPreview),
    textShadow: normalizeBoolean(value.textShadow, DEFAULT_LYRICS_SETTINGS.textShadow),
    textShadowIntensity: normalizeNumber(
      value.textShadowIntensity,
      DEFAULT_LYRICS_SETTINGS.textShadowIntensity,
    ),
    textShadowDefinition: normalizeNumber(
      value.textShadowDefinition,
      DEFAULT_LYRICS_SETTINGS.textShadowDefinition,
    ),
    glow: normalizeBoolean(value.glow, DEFAULT_LYRICS_SETTINGS.glow),
    glowIntensity: normalizeNumber(value.glowIntensity, DEFAULT_LYRICS_SETTINGS.glowIntensity),
    glowDefinition: normalizeNumber(value.glowDefinition, DEFAULT_LYRICS_SETTINGS.glowDefinition),
    animationSpeed: normalizeNumber(value.animationSpeed, DEFAULT_LYRICS_SETTINGS.animationSpeed),
    lineAnimationStaggerMs: normalizeNumber(
      value.lineAnimationStaggerMs,
      DEFAULT_LYRICS_SETTINGS.lineAnimationStaggerMs,
    ),
    blurRange: normalizeNumber(value.blurRange, DEFAULT_LYRICS_SETTINGS.blurRange),
    curveAmount: normalizeNumber(value.curveAmount, DEFAULT_LYRICS_SETTINGS.curveAmount),
  };
}

function normalizePaletteSample(value: unknown): ImmersiveWallpaperPaletteSample | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    color: normalizeString(value.color),
    x: normalizeNumber(value.x),
    y: normalizeNumber(value.y),
    weight: normalizeNumber(value.weight, 1),
  };
}

function normalizePalette(value: unknown): ImmersiveWallpaperPalette | null {
  if (!isRecord(value)) {
    return null;
  }

  const samples = Array.isArray(value.samples)
    ? value.samples.map(normalizePaletteSample).filter((sample): sample is ImmersiveWallpaperPaletteSample => sample !== null)
    : [];

  return {
    base: normalizeString(value.base),
    secondary: normalizeString(value.secondary),
    glow: normalizeString(value.glow),
    edge: normalizeString(value.edge),
    samples,
  };
}

function normalizeLyrics(value: unknown): NeteaseSongLyrics | null {
  if (!isRecord(value)) {
    return null;
  }

  return value as NeteaseSongLyrics;
}

function normalizeStaticSnapshot(rawValue: unknown): ImmersiveWallpaperStaticSnapshot {
  if (!isRecord(rawValue)) {
    return EMPTY_IMMERSIVE_WALLPAPER_STATIC_SNAPSHOT;
  }

  return {
    version: 1,
    locale: normalizeString(rawValue.locale, EMPTY_IMMERSIVE_WALLPAPER_STATIC_SNAPSHOT.locale),
    hasTrack: normalizeBoolean(rawValue.hasTrack),
    trackId: normalizeNullableString(rawValue.trackId),
    title: normalizeString(rawValue.title),
    artist: normalizeNullableString(rawValue.artist),
    album: normalizeNullableString(rawValue.album),
    artworkUrl: normalizeNullableString(rawValue.artworkUrl),
    palette: normalizePalette(rawValue.palette),
    appearanceSettings: normalizeAppearanceSettings(rawValue.appearanceSettings),
    lyricsSettings: normalizeLyricsSettings(rawValue.lyricsSettings),
    appBackgroundImageStyle: normalizeString(
      rawValue.appBackgroundImageStyle,
      EMPTY_IMMERSIVE_WALLPAPER_STATIC_SNAPSHOT.appBackgroundImageStyle,
    ),
    appBackgroundVideoSrc: normalizeNullableString(rawValue.appBackgroundVideoSrc),
    appBackgroundVideoLoop: normalizeBoolean(
      rawValue.appBackgroundVideoLoop,
      EMPTY_IMMERSIVE_WALLPAPER_STATIC_SNAPSHOT.appBackgroundVideoLoop,
    ),
    appBackgroundOpacity: normalizeNumber(
      rawValue.appBackgroundOpacity,
      EMPTY_IMMERSIVE_WALLPAPER_STATIC_SNAPSHOT.appBackgroundOpacity,
    ),
    appBackgroundBlurPx: normalizeNumber(
      rawValue.appBackgroundBlurPx,
      EMPTY_IMMERSIVE_WALLPAPER_STATIC_SNAPSHOT.appBackgroundBlurPx,
    ),
    appBackgroundDimOpacity: normalizeNumber(
      rawValue.appBackgroundDimOpacity,
      EMPTY_IMMERSIVE_WALLPAPER_STATIC_SNAPSHOT.appBackgroundDimOpacity,
    ),
    lyrics: normalizeLyrics(rawValue.lyrics),
    updatedAtMs: normalizeNumber(rawValue.updatedAtMs),
  };
}

function normalizeDynamicSnapshot(rawValue: unknown): ImmersiveWallpaperDynamicSnapshot {
  if (!isRecord(rawValue)) {
    return EMPTY_IMMERSIVE_WALLPAPER_DYNAMIC_SNAPSHOT;
  }

  return {
    version: 1,
    currentTimeSeconds: normalizeNumber(rawValue.currentTimeSeconds),
    durationSeconds: normalizeNumber(rawValue.durationSeconds),
    progress: normalizeNumber(rawValue.progress),
    isPlaying: normalizeBoolean(rawValue.isPlaying),
    isPlaybackLoading: normalizeBoolean(rawValue.isPlaybackLoading),
    isLyricsLoading: normalizeBoolean(rawValue.isLyricsLoading),
    currentLyricsTimeMs: normalizeNumber(rawValue.currentLyricsTimeMs),
    activeLyricLineIndex: Math.round(normalizeNumber(rawValue.activeLyricLineIndex, -1)),
    updatedAtMs: normalizeNumber(rawValue.updatedAtMs),
  };
}

function createBroadcastChannel(channelName: string) {
  if (typeof window === "undefined" || typeof window.BroadcastChannel === "undefined") {
    return null;
  }

  try {
    return new window.BroadcastChannel(channelName);
  } catch {
    return null;
  }
}

function readSharedValue<T>(storageKey: string, fallback: T, normalize: (value: unknown) => T) {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const rawValue = window.localStorage.getItem(storageKey);
    if (!rawValue) {
      return fallback;
    }

    return normalize(JSON.parse(rawValue));
  } catch {
    return fallback;
  }
}

function writeSharedValue<T>(options: {
  storageKey: string;
  channelName: string;
  value: T;
  normalize: (rawValue: unknown) => T;
  persist?: boolean;
}) {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedValue = options.normalize(options.value);

  if (options.persist !== false) {
    try {
      window.localStorage.setItem(options.storageKey, JSON.stringify(normalizedValue));
    } catch {
      // Ignore storage write failures and keep broadcast updates flowing.
    }
  }

  const channel = createBroadcastChannel(options.channelName);
  if (!channel) {
    return;
  }

  try {
    channel.postMessage(normalizedValue);
  } finally {
    channel.close();
  }
}

function subscribeSharedValue<T>(options: {
  storageKey: string;
  channelName: string;
  read: () => T;
  normalize: (rawValue: unknown) => T;
  listener: (value: T) => void;
}) {
  options.listener(options.read());

  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== options.storageKey) {
      return;
    }

    options.listener(options.read());
  };

  window.addEventListener("storage", handleStorage);

  const channel = createBroadcastChannel(options.channelName);
  if (channel) {
    channel.onmessage = (event) => {
      options.listener(options.normalize(event.data));
    };
  }

  return () => {
    window.removeEventListener("storage", handleStorage);
    channel?.close();
  };
}

export function readImmersiveWallpaperStaticSnapshot() {
  return readSharedValue(
    STATIC_STORAGE_KEY,
    EMPTY_IMMERSIVE_WALLPAPER_STATIC_SNAPSHOT,
    normalizeStaticSnapshot,
  );
}

export function readImmersiveWallpaperDynamicSnapshot() {
  return readSharedValue(
    DYNAMIC_STORAGE_KEY,
    EMPTY_IMMERSIVE_WALLPAPER_DYNAMIC_SNAPSHOT,
    normalizeDynamicSnapshot,
  );
}

export function syncImmersiveWallpaperStaticSnapshot(snapshot: ImmersiveWallpaperStaticSnapshot) {
  writeSharedValue({
    storageKey: STATIC_STORAGE_KEY,
    channelName: STATIC_CHANNEL_NAME,
    value: snapshot,
    normalize: normalizeStaticSnapshot,
  });
}

export function syncImmersiveWallpaperDynamicSnapshot(
  snapshot: ImmersiveWallpaperDynamicSnapshot,
  options?: { persist?: boolean },
) {
  writeSharedValue({
    storageKey: DYNAMIC_STORAGE_KEY,
    channelName: DYNAMIC_CHANNEL_NAME,
    value: snapshot,
    normalize: normalizeDynamicSnapshot,
    persist: options?.persist,
  });
}

export function subscribeImmersiveWallpaperStaticSnapshot(
  listener: (snapshot: ImmersiveWallpaperStaticSnapshot) => void,
) {
  return subscribeSharedValue({
    storageKey: STATIC_STORAGE_KEY,
    channelName: STATIC_CHANNEL_NAME,
    read: readImmersiveWallpaperStaticSnapshot,
    normalize: normalizeStaticSnapshot,
    listener,
  });
}

export function subscribeImmersiveWallpaperDynamicSnapshot(
  listener: (snapshot: ImmersiveWallpaperDynamicSnapshot) => void,
) {
  return subscribeSharedValue({
    storageKey: DYNAMIC_STORAGE_KEY,
    channelName: DYNAMIC_CHANNEL_NAME,
    read: readImmersiveWallpaperDynamicSnapshot,
    normalize: normalizeDynamicSnapshot,
    listener,
  });
}
