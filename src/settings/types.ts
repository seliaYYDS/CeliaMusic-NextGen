export type AppearanceColorScheme = "light" | "dark";
export type AppearanceBackgroundMode = "theme" | "custom";
export type StartupAnimationMode =
  | "none"
  | "default"
  | "glitch";
export type DynamicIslandStyle = "default" | "soft" | "solid";
export type DynamicIslandColorMode = "follow-theme" | "primary" | "secondary";
export type DynamicIslandDefaultContent = "time" | "date" | "datetime";
export type DynamicIslandPosition = "center" | "left" | "right";
export type GlobalParticleEffectType = "lines" | "dots" | "snow" | "sakura" | "mist" | "bloom" | "rain";
export type GlobalParticleLayer = "top" | "background";
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
export type EqualizerPreset = "rock" | "jazz" | "light" | "pop" | "bass" | "electronic" | "vocal" | "custom";
export type DownloadQualityOption =
  | "standard"
  | "higher"
  | "exhigh"
  | "lossless"
  | "hires"
  | "jyeffect"
  | "sky"
  | "jymaster";
export type KugouDownloadQualityOption = "128" | "320" | "flac" | "high";
export type OnlineDownloadQualityOption =
  | DownloadQualityOption
  | KugouDownloadQualityOption;
export type DownloadLyricsMode = "embedded" | "sidecar";
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
  startupAnimation: StartupAnimationMode;
  startupAnimationDurationMs: number;
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
  globalParticleEffectEnabled: boolean;
  globalParticleEffectType: GlobalParticleEffectType;
  globalParticleEffectLayer: GlobalParticleLayer;
  globalParticleEffectOpacity: number;
  globalParticleEffectWindSpeed: number;
  globalParticleEffectFallSpeed: number;
  globalParticleEffectCount: number;
  globalParticleEffectSize: number;
  globalFilterEffectIntensity: number;
  globalFilterEffectSpeed: number;
  globalFilterEffectRange: number;
  globalBloomEffectIntensity: number;
  globalBloomEffectSpeed: number;
  globalBloomEffectRange: number;
  globalRainEffectIntensity: number;
  globalRainEffectSpeed: number;
  globalRainEffectRange: number;
  globalRainEffectOpacity: number;
  immersiveBackgroundMode: ImmersiveBackgroundMode;
  immersiveBackgroundAnimated: boolean;
  immersiveBackgroundResolution: number;
  immersiveBackgroundSpeed: number;
  immersiveBackgroundSoftness: number;
  immersiveBackgroundBlur: number;
  immersiveBackgroundDim: number;
  immersiveBackgroundMvBlur: number;
  immersiveBackgroundMvDim: number;
};

export type PlaybackSettings = {
  defaultVolume: number;
  muted: boolean;
  playbackMode: PlaybackModeOption;
  cacheMode: PlaybackCacheMode;
  autoClearSongCacheOnExit: boolean;
  systemMediaInfoSync: boolean;
  rememberQueue: boolean;
  songTransitionEnabled: boolean;
  songTransitionMode: SongTransitionMode;
  songTransitionStartMs: number;
  preferRemoteStreaming: boolean;
  preferredQuality: string;
  equalizerEnabled: boolean;
  equalizerPreset: EqualizerPreset;
  equalizerCustomBands: number[];
  resumeQueueTrackIds: string[];
  resumeTrackId: string | null;
};

export type LibrarySettings = {
  scanDirectories: string[];
  watchDirectories: boolean;
  onlineLyricsCompletion: boolean;
  downloadEnabled: boolean;
  downloadSaveDirectory: string;
  downloadQuality: OnlineDownloadQualityOption;
  downloadLyricsEnabled: boolean;
  downloadLyricsMode: DownloadLyricsMode;
};

export type NetworkSettings = {
  enabledSources: string[];
  useLocalApiServer: boolean;
  useLocalKugouApiServer: boolean;
  requestTimeoutMs: number;
  neteaseApiBaseUrl: string;
  neteaseCookie: string;
  neteaseProxy: string;
  neteaseRealIp: string;
  kugouApiBaseUrl: string;
  kugouCookie: string;
  kugouDfid: string;
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
    startupAnimation: "default",
    startupAnimationDurationMs: 2000,
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
    globalParticleEffectEnabled: false,
    globalParticleEffectType: "lines",
    globalParticleEffectLayer: "top",
    globalParticleEffectOpacity: 72,
    globalParticleEffectWindSpeed: 58,
    globalParticleEffectFallSpeed: 66,
    globalParticleEffectCount: 52,
    globalParticleEffectSize: 100,
    globalFilterEffectIntensity: 72,
    globalFilterEffectSpeed: 54,
    globalFilterEffectRange: 62,
    globalBloomEffectIntensity: 32,
    globalBloomEffectSpeed: 24,
    globalBloomEffectRange: 36,
    globalRainEffectIntensity: 80,
    globalRainEffectSpeed: 50,
    globalRainEffectRange: 72,
    globalRainEffectOpacity: 42,
    immersiveBackgroundMode: "flow",
    immersiveBackgroundAnimated: true,
    immersiveBackgroundResolution: 72,
    immersiveBackgroundSpeed: 112,
    immersiveBackgroundSoftness: 58,
    immersiveBackgroundBlur: 36,
    immersiveBackgroundDim: 18,
    immersiveBackgroundMvBlur: 18,
    immersiveBackgroundMvDim: 28,
  },
  playback: {
    defaultVolume: 68,
    muted: false,
    playbackMode: "ordered",
    cacheMode: "stream",
    autoClearSongCacheOnExit: false,
    systemMediaInfoSync: true,
    rememberQueue: true,
    songTransitionEnabled: false,
    songTransitionMode: "simple-mix",
    songTransitionStartMs: 4000,
    preferRemoteStreaming: false,
    preferredQuality: "high",
    equalizerEnabled: false,
    equalizerPreset: "rock",
    equalizerCustomBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    resumeQueueTrackIds: [],
    resumeTrackId: null,
  },
  library: {
    scanDirectories: [],
    watchDirectories: false,
    onlineLyricsCompletion: false,
    downloadEnabled: true,
    downloadSaveDirectory: "",
    downloadQuality: "exhigh",
    downloadLyricsEnabled: false,
    downloadLyricsMode: "embedded",
  },
  network: {
    enabledSources: ["netease"],
    useLocalApiServer: false,
    useLocalKugouApiServer: false,
    requestTimeoutMs: 15000,
    neteaseApiBaseUrl: "http://127.0.0.1:3000",
    neteaseCookie: "",
    neteaseProxy: "",
    neteaseRealIp: "",
    kugouApiBaseUrl: "http://127.0.0.1:3001",
    kugouCookie: "",
    kugouDfid: "",
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
