export type AppearanceColorScheme = "light" | "dark";
export type AppearanceBackgroundMode = "theme" | "custom";
export type DynamicIslandStyle = "default" | "soft" | "solid";
export type DynamicIslandColorMode = "follow-theme" | "primary" | "secondary";
export type DynamicIslandDefaultContent = "time" | "date" | "datetime";
export type DynamicIslandPosition = "center" | "left" | "right";
export type ImmersiveBackgroundMode =
  | "palette-solid"
  | "palette-gradient"
  | "app-background"
  | "background-mv"
  | "cover-blur"
  | "flow";
export type LyricsLineAlignment = "upper" | "center";
export type LyricsTextAlignment = "left" | "center" | "right";
export type LyricsRenderMode = "simple" | "balanced" | "advanced";
export type PlaybackModeOption = "ordered" | "repeat-all" | "repeat-one" | "shuffle";
export type PlaybackCacheMode = "stream" | "complete";
export type SongTransitionMode = "simple-mix" | "auto-mix";
export const SHORTCUT_ACTION_IDS = [
  "togglePlayback",
  "nextTrack",
  "previousTrack",
  "stopPlayback",
  "volumeUp",
  "volumeDown",
  "seekForward",
  "seekBackward",
  "cyclePlaybackMode",
] as const;
export type ShortcutActionId = (typeof SHORTCUT_ACTION_IDS)[number];

export type AppearanceSettings = {
  language: string;
  fontFamily: string;
  fontWeight: number;
  themeMode: string;
  colorScheme: AppearanceColorScheme;
  followSongArtworkTheme: boolean;
  showDynamicIsland: boolean;
  useBackgroundMv: boolean;
  backgroundMode: AppearanceBackgroundMode;
  backgroundBlur: number;
  componentBackdropBlur: number;
  backgroundDim: number;
  backgroundImagePath: string;
  backgroundImageOpacity: number;
  useCompactMode: boolean;
  showAlbumArtwork: boolean;
  customThemePrimary: string;
  customThemeSecondary: string;
  customThemeSurface: string;
  dynamicIslandStyle: DynamicIslandStyle;
  dynamicIslandColorMode: DynamicIslandColorMode;
  dynamicIslandDefaultContent: DynamicIslandDefaultContent;
  dynamicIslandPosition: DynamicIslandPosition;
  dynamicIslandShowLyrics: boolean;
  immersiveBackgroundMode: ImmersiveBackgroundMode;
  immersiveBackgroundAnimated: boolean;
  immersiveBackgroundResolution: number;
  immersiveBackgroundSpeed: number;
  immersiveBackgroundBlur: number;
  immersiveBackgroundSoftness: number;
};

export type PlaybackSettings = {
  defaultVolume: number;
  muted: boolean;
  playbackMode: PlaybackModeOption;
  cacheMode: PlaybackCacheMode;
  rememberQueue: boolean;
  rememberPlaybackPosition: boolean;
  autoplayOnLaunch: boolean;
  songTransitionEnabled: boolean;
  songTransitionMode: SongTransitionMode;
  songTransitionStartMs: number;
  preferRemoteStreaming: boolean;
  preferredQuality: string;
  resumeQueueTrackIds: string[];
  resumeTrackId: string | null;
  resumeTrackPositionMs: number;
  resumeWasPlaying: boolean;
};

export type LibrarySettings = {
  scanDirectories: string[];
  watchDirectories: boolean;
  autoImportArtwork: boolean;
  extractEmbeddedArtwork: boolean;
};

export type NetworkSettings = {
  enabledSources: string[];
  useLocalApiServer: boolean;
  allowMeteredNetwork: boolean;
  preferOnlineMetadata: boolean;
  requestTimeoutMs: number;
  neteaseApiBaseUrl: string;
  neteaseCookie: string;
  neteaseProxy: string;
  neteaseRealIp: string;
};

export type LyricsSettings = {
  delayMs: number;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  lineSpacing: number;
  lineAlignment: LyricsLineAlignment;
  textAlignment: LyricsTextAlignment;
  renderMode: LyricsRenderMode;
  progressBarPreview: boolean;
  textShadow: boolean;
  textShadowIntensity: number;
  textShadowDefinition: number;
  glow: boolean;
  glowIntensity: number;
  glowDefinition: number;
  animationSpeed: number;
  lineAnimationStaggerMs: number;
  blurRange: number;
  curveAmount: number;
};

export type WindowSettings = {
  width: number;
  height: number;
};

export type ShortcutSettings = {
  togglePlayback: string[];
  nextTrack: string[];
  previousTrack: string[];
  stopPlayback: string[];
  volumeUp: string[];
  volumeDown: string[];
  seekForward: string[];
  seekBackward: string[];
  cyclePlaybackMode: string[];
};

export type AppSettings = {
  appearance: AppearanceSettings;
  playback: PlaybackSettings;
  library: LibrarySettings;
  network: NetworkSettings;
  lyrics: LyricsSettings;
  shortcuts: ShortcutSettings;
  window: WindowSettings;
};

export type AppSettingsSnapshot = {
  schemaVersion: number;
  settingsPath: string;
  settings: AppSettings;
};

export const createDefaultAppSettings = (): AppSettings => ({
  appearance: {
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
  },
  playback: {
    defaultVolume: 68,
    muted: false,
    playbackMode: "ordered",
    cacheMode: "stream",
    rememberQueue: true,
    rememberPlaybackPosition: true,
    autoplayOnLaunch: false,
    songTransitionEnabled: false,
    songTransitionMode: "simple-mix",
    songTransitionStartMs: 4000,
    preferRemoteStreaming: false,
    preferredQuality: "high",
    resumeQueueTrackIds: [],
    resumeTrackId: null,
    resumeTrackPositionMs: 0,
    resumeWasPlaying: false,
  },
  library: {
    scanDirectories: [],
    watchDirectories: false,
    autoImportArtwork: true,
    extractEmbeddedArtwork: true,
  },
  network: {
    enabledSources: ["netease"],
    useLocalApiServer: false,
    allowMeteredNetwork: true,
    preferOnlineMetadata: true,
    requestTimeoutMs: 15000,
    neteaseApiBaseUrl: "http://127.0.0.1:3000",
    neteaseCookie: "",
    neteaseProxy: "",
    neteaseRealIp: "",
  },
  lyrics: {
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
  },
  shortcuts: {
    togglePlayback: [],
    nextTrack: [],
    previousTrack: [],
    stopPlayback: [],
    volumeUp: [],
    volumeDown: [],
    seekForward: [],
    seekBackward: [],
    cyclePlaybackMode: [],
  },
  window: {
    width: 960,
    height: 600,
  },
});
