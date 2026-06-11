import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import {
  register as registerGlobalShortcut,
  unregisterAll as unregisterAllGlobalShortcuts,
} from "@tauri-apps/plugin-global-shortcut";

import {
  UIButton,
  CheckIcon,
  UICheckbox,
  UILoadingBlock,
  UIPagination,
  UISelect,
  UISlider,
  UISwitch,
  UITextField,
  SearchIcon,
  type UISelectOption,
} from "../ui/components";
import {
  analyzeLocalAudioTrack,
  type AudioTrackAnalysis,
  cacheRemoteAudio,
  clearCachedRemoteAudio,
  clearMediaLibrary,
  deleteMediaTracks,
  importMediaFiles,
  listMediaLibrary,
} from "../media/library";
import {
  createDefaultSongConfig,
  type ArtworkRecord,
  type MediaLibrarySnapshot,
  type TrackRecord,
} from "../media/types";
import {
  buildNeteaseTrackCacheKey,
  checkNeteaseQrLoginStatus,
  createNeteasePlaylist,
  createNeteaseQrLoginSession,
  deleteNeteasePlaylist,
  getNeteaseDailyRecommendedPlaylists,
  getNeteaseDailyRecommendedSongs,
  getNeteaseLoggedInAccount,
  getNeteaseIntelligenceSongs,
  getNeteasePersonalFmSongs,
  likeNeteaseSong,
  getAllNeteasePlaylistTracks,
  getNeteasePlaylistDetail,
  getNeteasePersonalizedNewSongs,
  getNeteaseRecommendedDjs,
  getNeteaseRecommendedPlaylists,
  getNeteaseMvStream,
  getNeteaseSongDetail,
  getNeteaseSongLyrics,
  getNeteaseUserPlaylists,
  clearNeteaseMemoryCaches,
  isNeteaseSourceEnabled,
  parseNeteaseTrackIdFromCacheKey,
  addTracksToNeteasePlaylist,
  removeTracksFromNeteasePlaylist,
  registerNeteaseTrackMetadataToLibrary,
  registerResolvedNeteaseTrackToLibrary,
  resolveNeteaseTrack,
  searchNeteaseArtists,
  searchNeteaseSongs,
  setLocalNeteaseApiRuntimeBaseUrl,
  subscribeNeteasePlaylist,
  testNeteaseApiConnection,
  updateNeteasePlaylistDescription,
  updateNeteasePlaylistName,
} from "../network/netease";
import type {
  NeteaseAccountProfile,
  NeteaseDjRecommendation,
  NeteaseParsedLyricLine,
  NeteaseParsedLyricWord,
  NeteasePlaylistRecommendation,
  NeteaseQrLoginSession,
  NeteaseResolvedTrack,
  NeteaseSongDetail,
  NeteaseSongLyrics,
  NeteaseSongSearchResult,
} from "../network/types";
import {
  getAppSettings,
  getLocalNeteaseApiServerStatus,
  listSystemFontFamilies,
  resetAppSettings,
  saveAppSettings,
  syncLocalNeteaseApiServer,
  type LocalNeteaseApiServerStatus,
} from "../settings/store";
import {
  createDefaultAppSettings,
  SHORTCUT_ACTION_IDS,
  type AppSettings,
  type AppSettingsSnapshot,
  type ImmersiveBackgroundMode,
  type PlaybackCacheMode,
  type PlaybackModeOption,
  type ShortcutActionId,
} from "../settings/types";
import {
  emitComponentDynamicIslandSettings,
  emitComponentDynamicIslandSnapshot,
  openComponentDynamicIslandWindow,
  readComponentDynamicIslandSettings,
  type ComponentDynamicIslandSnapshot,
} from "./componentDynamicIslandSync";
import {
  findBestKugouTrackMatch,
  parseKugouPlaylistJson,
  readKugouPlaylistFile,
  type KugouTrackMatchStrictness,
  type ParsedKugouPlaylistTrack,
} from "../tools/kugou";
import {
  syncImmersiveWallpaperDynamicSnapshot,
  syncImmersiveWallpaperStaticSnapshot,
  type ImmersiveWallpaperDynamicSnapshot,
  type ImmersiveWallpaperPalette,
  type ImmersiveWallpaperStaticSnapshot,
} from "./immersiveWallpaperSync";
import {
  pruneBoundedRecord,
  setBoundedMapValue,
  setBoundedRecordValue,
} from "./cache";
import { ExploreScreen, clearExploreMemoryCaches } from "./ExploreScreen";
import playerIcon from "../../icon.png";
import "./styles.css";

const navItemIds = ["home", "explore", "favorites", "playlist", "library", "tools", "settings"] as const;
const MIN_WINDOW_WIDTH = 800;
const MIN_WINDOW_HEIGHT = 500;
const PLAYLIST_EDITOR_CLOSE_DURATION_MS = 180;
const KUGOU_MANUAL_RETRY_CLOSE_DURATION_MS = 180;
const SHORTCUT_EDITOR_CLOSE_DURATION_MS = 180;
const IMMERSIVE_PLAYER_CLOSE_DURATION_MS = 560;
const IMMERSIVE_TRACK_TRANSITION_DURATION_MS = 860;
const IMMERSIVE_INSTRUMENTAL_PANEL_COLLAPSE_DURATION_MS = 420;
const APP_GREETING_HOLD_MS = 500;
const APP_GREETING_VISIBLE_MS = 1000;
const APP_GREETING_EXIT_MS = 520;
const PAUSE_FADE_DURATION_MS = 220;
const SONG_TRANSITION_MIN_MS = 1000;
const SONG_TRANSITION_MAX_MS = 12000;
const SONG_TRANSITION_PRELOAD_LEAD_MS = 2000;
const AUTOMIX_NEXT_ENTRY_MIN_MS = 900;
const AUTOMIX_NEXT_ENTRY_DEFAULT_MS = 1800;
const AUTOMIX_NEXT_ENTRY_MAX_MS = 9000;
const AUTOMIX_TRUSTED_INTRO_MAX_MS = 8500;
const VISUAL_PROGRESS_SYNC_INTERVAL_MS = 48;
const IMMERSIVE_LYRIC_STAGGER_MS = 100;
const IMMERSIVE_LYRIC_JUMP_THRESHOLD_MS = 1800;
const IMMERSIVE_LYRIC_JUMP_THRESHOLD_LINES = 2;
const IMMERSIVE_LYRIC_INTERLUDE_THRESHOLD_MS = 3000;
const IMMERSIVE_INSTRUMENTAL_HIDE_DELAY_MS = 2400;
const MAIN_WINDOW_VISIBILITY_EVENT = "app-window-visibility";
const WALLPAPER_LOG_EVENT = "wallpaper-log";
const IMMERSIVE_WALLPAPER_WINDOW_LABEL = "immersive-wallpaper";
const IMMERSIVE_WALLPAPER_DYNAMIC_SYNC_MIN_INTERVAL_MS = 120;
const SHORTCUT_VOLUME_STEP = 6;
const SHORTCUT_SEEK_STEP_SECONDS = 5;
const ENABLE_SHARED_AUDIO_WEB_PROCESSING = false;
const BACKGROUND_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp", "gif"] as const;
const BACKGROUND_VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "m4v", "ogv"] as const;
const NETEASE_HOME_FEED_CACHE_LIMIT = 8;
const NETEASE_PLAYLIST_LIBRARY_CACHE_LIMIT = 12;
const NETEASE_PLAYLIST_DETAIL_CACHE_LIMIT = 24;
const NETEASE_PLAYLIST_TRACKS_CACHE_LIMIT = 24;
const NETEASE_ARTIST_AVATAR_CACHE_LIMIT = 128;
const TRANSIENT_REMOTE_TRACK_CACHE_LIMIT = 240;
const TRACK_ANALYSIS_CACHE_LIMIT = 48;
const AUTO_MIX_DECISION_CACHE_LIMIT = 64;
const LYRICS_CACHE_LIMIT = 120;
const IMMERSIVE_PALETTE_CACHE_LIMIT = 96;

function logWallpaper(message: string, details?: unknown) {
  if (details === undefined) {
    console.info(`[wallpaper] ${message}`);
    return;
  }

  console.info(`[wallpaper] ${message}`, details);
}

function roundTo(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function isSameImmersiveWallpaperDynamicSnapshot(
  previous: ImmersiveWallpaperDynamicSnapshot | null,
  next: ImmersiveWallpaperDynamicSnapshot,
) {
  if (!previous) {
    return false;
  }

  return (
    previous.version === next.version &&
    previous.currentTimeSeconds === next.currentTimeSeconds &&
    previous.durationSeconds === next.durationSeconds &&
    previous.progress === next.progress &&
    previous.isPlaying === next.isPlaying &&
    previous.isPlaybackLoading === next.isPlaybackLoading &&
    previous.isLyricsLoading === next.isLyricsLoading &&
    previous.currentLyricsTimeMs === next.currentLyricsTimeMs &&
    previous.activeLyricLineIndex === next.activeLyricLineIndex
  );
}

type AudioSlot = "primary" | "secondary";
type TimelineOwnerMode = "active" | "playbar";
type PreparedSongTransition = {
  key: string;
  sourceTrackId: string;
  targetTrackId: string;
  slot: AudioSlot;
  preparedTrack: TrackRecord;
  nextCandidates: string[];
  candidateIndex: number;
};
type AutoMixTempoPlan = {
  enabled: boolean;
  fromStartRate: number;
  fromEndRate: number;
  toStartRate: number;
  toEndRate: number;
  fromTargetRate: number;
  toTargetRate: number;
  fromTempoBpm: number | null;
  toTempoBpm: number | null;
  targetTempoBpm: number | null;
  preservePitchDisabled: boolean;
  reason: string;
};
type AutoMixTransitionTimingPlan = {
  durationMs: number;
  reason: string;
  currentOutroWindowMs: number | null;
  nextIntroWindowMs: number | null;
  targetOverlapMs: number;
};
type AutoMixAnalysisSummary = {
  estimatedTempoBpm: number | null;
  beatCount: number;
  barCount: number;
  phraseCount: number;
  firstPhraseTimesMs: number[];
  introPhaseEndMs: number | null;
  outroPhaseStartMs: number | null;
  averageEnergy: number;
  introEnergy: number;
  outroEnergy: number;
  suggestedTransitionStartMs: number | null;
  suggestedTransitionReason: string;
};
type TransitionDecision = {
  durationSeconds: number;
  transitionStartSeconds: number;
  resolvedTransitionStartMs: number | null;
  plannedTransitionDurationMs: number;
  transitionTimingPlan: AutoMixTransitionTimingPlan;
  mode: string;
  source: string;
  suggestedTransitionStartMs: number | null;
  analysis: AutoMixAnalysisSummary | null;
  nextAnalysis: AutoMixAnalysisSummary | null;
  nextTrackId: string | null;
};
type AudioProcessingChain = {
  source: MediaElementAudioSourceNode;
  highpass: BiquadFilterNode;
  lowpass: BiquadFilterNode;
  gain: GainNode;
};
type ShortcutKeyboardKeySpec = {
  key: string;
  width?:
    | "xs"
    | "sm"
    | "md"
    | "lg"
    | "tab"
    | "caps"
    | "shift"
    | "enter"
    | "backspace"
    | "ctrl"
    | "alt"
    | "menu"
    | "space"
    | "arrow";
};

const KEYBOARD_FUNCTION_ROW: ShortcutKeyboardKeySpec[] = [
  { key: "Escape", width: "md" },
  { key: "F1", width: "xs" },
  { key: "F2", width: "xs" },
  { key: "F3", width: "xs" },
  { key: "F4", width: "xs" },
  { key: "F5", width: "xs" },
  { key: "F6", width: "xs" },
  { key: "F7", width: "xs" },
  { key: "F8", width: "xs" },
  { key: "F9", width: "xs" },
  { key: "F10", width: "xs" },
  { key: "F11", width: "xs" },
  { key: "F12", width: "xs" },
];

const KEYBOARD_MAIN_ROWS: ShortcutKeyboardKeySpec[][] = [
  [
    { key: "`", width: "xs" },
    { key: "1", width: "xs" },
    { key: "2", width: "xs" },
    { key: "3", width: "xs" },
    { key: "4", width: "xs" },
    { key: "5", width: "xs" },
    { key: "6", width: "xs" },
    { key: "7", width: "xs" },
    { key: "8", width: "xs" },
    { key: "9", width: "xs" },
    { key: "0", width: "xs" },
    { key: "-", width: "xs" },
    { key: "=", width: "xs" },
    { key: "Backspace", width: "backspace" },
  ],
  [
    { key: "Tab", width: "tab" },
    { key: "Q", width: "xs" },
    { key: "W", width: "xs" },
    { key: "E", width: "xs" },
    { key: "R", width: "xs" },
    { key: "T", width: "xs" },
    { key: "Y", width: "xs" },
    { key: "U", width: "xs" },
    { key: "I", width: "xs" },
    { key: "O", width: "xs" },
    { key: "P", width: "xs" },
    { key: "[", width: "xs" },
    { key: "]", width: "xs" },
    { key: "\\", width: "md" },
  ],
  [
    { key: "CapsLock", width: "caps" },
    { key: "A", width: "xs" },
    { key: "S", width: "xs" },
    { key: "D", width: "xs" },
    { key: "F", width: "xs" },
    { key: "G", width: "xs" },
    { key: "H", width: "xs" },
    { key: "J", width: "xs" },
    { key: "K", width: "xs" },
    { key: "L", width: "xs" },
    { key: ";", width: "xs" },
    { key: "'", width: "xs" },
    { key: "Enter", width: "enter" },
  ],
  [
    { key: "Shift", width: "shift" },
    { key: "Z", width: "xs" },
    { key: "X", width: "xs" },
    { key: "C", width: "xs" },
    { key: "V", width: "xs" },
    { key: "B", width: "xs" },
    { key: "N", width: "xs" },
    { key: "M", width: "xs" },
    { key: ",", width: "xs" },
    { key: ".", width: "xs" },
    { key: "/", width: "xs" },
    { key: "Shift", width: "shift" },
  ],
  [
    { key: "Control", width: "ctrl" },
    { key: "Alt", width: "alt" },
    { key: "Space", width: "space" },
    { key: "Alt", width: "alt" },
    { key: "Menu", width: "menu" },
    { key: "Control", width: "ctrl" },
  ],
];

const KEYBOARD_NAVIGATION_ROWS: ShortcutKeyboardKeySpec[][] = [
  [
    { key: "Insert", width: "lg" },
    { key: "Home", width: "lg" },
    { key: "PageUp", width: "lg" },
  ],
  [
    { key: "Delete", width: "lg" },
    { key: "End", width: "lg" },
    { key: "PageDown", width: "lg" },
  ],
];

const KEYBOARD_ARROW_ROWS: ShortcutKeyboardKeySpec[][] = [
  [{ key: "ArrowUp", width: "arrow" }],
  [
    { key: "ArrowLeft", width: "arrow" },
    { key: "ArrowDown", width: "arrow" },
    { key: "ArrowRight", width: "arrow" },
  ],
];
const IN_APP_SHORTCUT_BINDINGS: Record<ShortcutActionId, string[]> = {
  togglePlayback: ["Space"],
  nextTrack: ["ArrowRight"],
  previousTrack: ["ArrowLeft"],
  stopPlayback: [],
  volumeUp: ["ArrowUp"],
  volumeDown: ["ArrowDown"],
  seekForward: [],
  seekBackward: [],
  cyclePlaybackMode: [],
};

function normalizeShortcutKeyValue(rawKey: string) {
  if (!rawKey) {
    return null;
  }

  if (rawKey === " ") {
    return "Space";
  }

  const trimmed = rawKey.trim();
  if (!trimmed) {
    return null;
  }

  const aliasMap: Record<string, string> = {
    Esc: "Escape",
    Del: "Delete",
    Left: "ArrowLeft",
    Right: "ArrowRight",
    Up: "ArrowUp",
    Down: "ArrowDown",
    Ctrl: "Control",
    Apps: "Menu",
  };
  const aliasedValue = aliasMap[trimmed] ?? trimmed;

  if (aliasedValue.length === 1 && /[a-z]/i.test(aliasedValue)) {
    return aliasedValue.toUpperCase();
  }

  return aliasedValue;
}

function getShortcutKeyLabel(key: string, locale: string) {
  const labelMap =
    locale === "en-US"
      ? {
          Space: "Space",
          ArrowLeft: "Left",
          ArrowRight: "Right",
          ArrowUp: "Up",
          ArrowDown: "Down",
          Backspace: "Backspace",
          CapsLock: "Caps",
          Control: "Ctrl",
          Alt: "Alt",
          Menu: "Menu",
          Escape: "Esc",
          PageUp: "PgUp",
          PageDown: "PgDn",
          Insert: "Ins",
          Delete: "Del",
        }
      : {
          Space: "空格",
          ArrowLeft: "左",
          ArrowRight: "右",
          ArrowUp: "上",
          ArrowDown: "下",
          Backspace: "退格",
          CapsLock: "大写",
          Control: "Ctrl",
          Alt: "Alt",
          Menu: "菜单",
          Escape: "Esc",
          PageUp: "上翻",
          PageDown: "下翻",
          Insert: "插入",
          Delete: "删除",
          Shift: "Shift",
          Tab: "Tab",
          Enter: "回车",
          Home: "Home",
          End: "End",
        };

  return labelMap[key as keyof typeof labelMap] ?? key;
}

function isShortcutArrowKey(key: string) {
  return key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown";
}

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable || target.closest("[contenteditable='true']")) {
    return true;
  }

  return Boolean(
    target.closest(
      "input, textarea, select, [role='textbox'], [data-shortcut-ignore='true']",
    ),
  );
}

function shouldPreventDefaultInAppKeyBehavior(key: string) {
  return key === "Space" || isShortcutArrowKey(key);
}

function shortcutActionAllowsRepeat(actionId: ShortcutActionId) {
  return (
    actionId === "volumeUp" ||
    actionId === "volumeDown" ||
    actionId === "seekForward" ||
    actionId === "seekBackward"
  );
}

function buildGlobalShortcutAccelerator(keys: string[]) {
  const normalizedKeys = Array.from(
    new Set(keys.map((key) => normalizeShortcutKeyValue(key)).filter(Boolean) as string[]),
  );

  if (normalizedKeys.length === 0) {
    return null;
  }

  const modifierOrder = ["Control", "Alt", "Shift", "Meta"];
  const modifierLabelMap: Record<string, string> = {
    Control: "Ctrl",
    Alt: "Alt",
    Shift: "Shift",
    Meta: "Super",
  };
  const keyLabelMap: Record<string, string> = {
    ArrowLeft: "Left",
    ArrowRight: "Right",
    ArrowUp: "Up",
    ArrowDown: "Down",
    Escape: "Esc",
    Space: "Space",
    Backspace: "Backspace",
    Delete: "Delete",
    Insert: "Insert",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    Tab: "Tab",
    Enter: "Enter",
    CapsLock: "CapsLock",
    Menu: "Menu",
  };

  const modifiers = normalizedKeys
    .filter((key) => modifierOrder.includes(key))
    .sort((left, right) => modifierOrder.indexOf(left) - modifierOrder.indexOf(right))
    .map((key) => modifierLabelMap[key] ?? key);
  const primaryKeys = normalizedKeys
    .filter((key) => !modifierOrder.includes(key))
    .map((key) => keyLabelMap[key] ?? key);

  if (primaryKeys.length === 0) {
    return null;
  }

  return [...modifiers, ...primaryKeys].join("+");
}

function normalizeWindowDimension(value: number, minimum: number) {
  return Math.max(minimum, Math.round(value));
}

function buildWindowSizeKey(width: number, height: number) {
  return `${normalizeWindowDimension(width, MIN_WINDOW_WIDTH)}x${normalizeWindowDimension(
    height,
    MIN_WINDOW_HEIGHT,
  )}`;
}

const UI_COPY = {
  "zh-CN": {
    locale: "zh-CN",
    nav: {
      home: "首页",
      explore: "探索",
      favorites: "喜欢歌曲",
      playlist: "歌单",
      library: "资料库",
      tools: "工具",
      settings: "设置",
    },
    options: {
      language: [
        { label: "简体中文", value: "zh-CN", description: "应用界面默认使用简体中文。" },
        { label: "English", value: "en-US", description: "切换到英文界面文案。" },
      ],
      theme: [
        { label: "Celia 默认", value: "celia-default", description: "银蓝白主色的默认主题。" },
        { label: "深海雾蓝", value: "mist-blue", description: "更安静、偏冷一点的观感。" },
      ],
      quality: [
        { label: "高品质优先", value: "high", description: "优先高码率与高质量流。" },
        { label: "均衡", value: "balanced", description: "兼顾网络与播放稳定性。" },
        { label: "节省流量", value: "data-saver", description: "优先更轻量的播放源。" },
      ],
      playbackCacheMode: [
        { label: "边缓存边播放", value: "stream", description: "立即开始播放，并在后台持续缓存当前歌曲。" },
        { label: "完整缓存后播放", value: "complete", description: "先缓存整首歌曲，再从本地缓存开始播放。" },
      ],
    },
    placeholder: {
      title: "\u6682\u65e0\u53ef\u663e\u793a\u5185\u5bb9",
      body: "\u8fd9\u4e2a\u533a\u57df\u76ee\u524d\u4fdd\u6301\u7b80\u6d01\u5c55\u793a\uff0c\u4f60\u53ef\u4ee5\u901a\u8fc7\u4fa7\u8fb9\u680f\u8fdb\u5165\u5176\u4ed6\u9875\u9762\u6d4f\u89c8\u97f3\u4e50\u5185\u5bb9\u3002",
    },
    settings: {
      eyebrow: "设置",
      title: "应用偏好",
      description: "在这里对应用的设置进行调整。",
      autoSaveEnabled: "已启用自动保存",
      autoSaving: "正在自动保存...",
      restore: "恢复默认",
      save: "保存设置",
      saving: "保存中...",
      sections: {
        appearance: {
          eyebrow: "界面",
          title: "外观与语言",
          languageLabel: "界面语言",
          fontLabel: "应用字体",
          fontWeightLabel: "应用字体权重",
          fontWeightHelper: "调整应用界面文本的粗细，400 为常规，700 为偏粗。",
          fontDefaultOption: "跟随系统默认",
          fontHelperLoading: "正在读取系统字体...",
          fontHelperReady: "仅显示当前系统已安装的字体，并按字体本身样式预览。",
          fontSearchPlaceholder: "搜索字体名称",
          fontSearchEmpty: "没有找到匹配的字体。",
          themeLabel: "主题风格",
          followArtworkThemeLabel: "主题跟随歌曲封面",
          followArtworkThemeDescription: "播放时临时跟随封面配色。",
          compactLabel: "紧凑布局",
          compactDescription: "使用更紧凑的界面排布。",
          artworkLabel: "显示专辑封面",
          artworkDescription: "在界面中显示专辑封面。",
        },
        dynamicIsland: {
          eyebrow: "灵动岛",
          title: "灵动岛外观与行为",
          description: "在这里调整灵动岛显示方式。",
          enabledLabel: "显示灵动岛",
          enabledDescription: "关闭后不再显示顶部灵动岛。",
          styleLabel: "外观风格",
          styleDefault: "默认胶囊",
          styleSoft: "柔和轻透",
          styleSolid: "对比指示条",
          colorLabel: "颜色主题",
          colorFollowTheme: "跟随主题",
          colorPrimary: "主色强调",
          colorSecondary: "辅助色强调",
          contentLabel: "默认显示内容",
          contentTime: "时间",
          contentDate: "日期",
          contentDateTime: "日期 + 时间",
          positionLabel: "显示位置",
          positionCenter: "顶部居中",
          positionLeft: "顶部偏左",
          positionRight: "顶部偏右",
          lyricsLabel: "灵动岛歌词显示",
          lyricsDescription: "播放时优先显示当前歌词。",
        },
        lyrics: {
          eyebrow: "歌词",
          title: "歌词显示",
          description: "在这里调整歌词显示效果。",
          delayLabel: "歌词延迟",
          delayHelper: "正值更晚显示，负值更早显示，范围为 -1000ms 到 +1000ms。",
          fontLabel: "歌词字体",
          fontWeightLabel: "歌词字体权重",
          fontWeightHelper: "调整沉浸歌词的字重，数值越高字形越厚实。",
          fontDefaultOption: "跟随系统默认",
          fontHelperLoading: "正在读取系统字体...",
          fontHelperReady: "自动列出当前系统中可用的字体。",
          fontSearchPlaceholder: "搜索字体名称",
          fontSearchEmpty: "没有找到匹配的字体。",
          fontSizeLabel: "歌词字号",
          fontSizeHelper: "基于当前页面的响应式字号进行缩放。",
          lineSpacingLabel: "歌词行间距",
          lineSpacingHelper: "调整歌词行与行之间的垂直间距，100% 为默认间距。",
          lineAlignmentLabel: "歌词行对齐",
          lineAlignmentHelper: "决定当前播放歌词在滚动视图中的纵向停靠位置。",
          lineAlignmentUpper: "偏上",
          lineAlignmentCenter: "中间",
          textAlignmentLabel: "歌词对齐方式",
          textAlignmentHelper: "决定每一行歌词在沉浸播放页中的横向排布方式。",
          textAlignmentLeft: "靠左",
          textAlignmentCenter: "居中",
          textAlignmentRight: "靠右",
          renderModeLabel: "歌词效果模式",
          renderModeHelper: "简单模式使用旧版单层阴影/泛光，均衡模式保留分层效果但降低渲染精度，高级模式使用完整分层阴影与分层泛光。",
          renderModeSimple: "简单模式",
          renderModeBalanced: "均衡模式",
          renderModeAdvanced: "高级模式",
          progressBarPreviewLabel: "进度条歌词",
          progressBarPreviewDescription: "在进度条上显示当前位置歌词。",
          textShadowLabel: "歌词阴影",
          textShadowDescription: "为歌词添加阴影。",
          textShadowIntensityLabel: "阴影强度",
          textShadowIntensityHelper: "控制歌词阴影的存在感和压暗程度，数值越高越明显。",
          textShadowDefinitionLabel: "阴影精度",
          textShadowDefinitionHelper: "控制阴影是贴字收束还是柔和扩散，数值越高越贴近字形。",
          glowLabel: "歌词泛光",
          glowDescription: "为当前歌词添加发光效果。",
          glowIntensityLabel: "泛光强度",
          glowIntensityHelper: "控制歌词发光的亮度和可见度，数值越高越明亮。",
          glowDefinitionLabel: "泛光精度",
          glowDefinitionHelper: "控制发光的收束程度，数值越高越贴字，数值越低越柔和扩散。",
          blurRangeLabel: "歌词模糊长度",
          blurRangeHelper: "控制当前歌词上下两侧保持清晰的范围，数值越大，远处歌词越晚开始虚化。",
          curveAmountLabel: "歌词弯曲程度",
          curveAmountHelper: "正值向一侧弯曲，负值向反方向弯曲，绝对值越大弧度越明显。",
          animationSpeedLabel: "歌词动画速度",
          animationSpeedHelper: "影响逐行滚动与逐字过渡速度，100% 为默认节奏。",
          lineAnimationStaggerLabel: "歌词动画行延时",
          lineAnimationStaggerHelper:
            "控制歌词滚动时从上到下逐行启动的错峰间隔，不改变单行动画速度。0ms 为同时运动，数值越大层次越明显。",
        },
        playback: {
          eyebrow: "播放",
          title: "播放偏好",
          qualityLabel: "音质偏好",
          cacheModeLabel: "缓存类型",
          cacheModeDescription: "选择缓存后播放或边播边缓存。",
          preferRemoteLabel: "优先网络播放",
          preferRemoteDescription: "优先使用在线音源。",
          songTransitionLabel: "歌曲过渡",
          songTransitionDescription: "让歌曲切换更平滑。",
          songTransitionModeLabel: "过渡模式",
          songTransitionModeDescription: "选择歌曲过渡的处理方式。",
          songTransitionModeSimpleMix: "简单混合",
          songTransitionModeAutoMix: "AutoMix",
          songTransitionModeSimpleMixDescription: "使用当前已实现的渐出淡入过渡。",
          songTransitionModeAutoMixDescription: "基于歌曲分析结果决定过渡起点，并复用当前的淡入淡出混音。",
          songTransitionTimingLabel: "过渡开始时间",
          songTransitionTimingHelper: "控制在歌曲结束前多久开始进行过渡。",
          rememberQueueLabel: "记住播放队列",
          rememberQueueDescription: "重新打开后恢复上次队列。",
        },
        shortcuts: {
          eyebrow: "快捷键",
          title: "键盘控制",
          description: "在这里设置播放快捷键。",
          builtInTitle: "应用内默认快捷键",
          builtInDescription: "这些快捷键会在应用内默认启用。",
          customTitle: "自定义按键",
          customDescription: "选择动作后，在下方设置按键。",
          keyboardTitle: "模拟键盘",
          keyboardDescription: "可为当前动作添加多个按键。",
          selectHint: "先选择一个动作，再在下方键盘上设置按键。",
          selectedPrefix: "当前正在编辑：",
          clearAction: "清空当前动作",
          openEditor: "设置按键",
          dialogTitle: "快捷键绑定",
          dialogClose: "关闭",
          unbound: "未绑定",
          actions: {
            togglePlayback: "暂停 / 继续",
            nextTrack: "下一首",
            previousTrack: "上一首",
            stopPlayback: "停止播放",
            volumeUp: "音量增大",
            volumeDown: "音量减小",
            seekForward: "快进",
            seekBackward: "快退",
            cyclePlaybackMode: "切换播放顺序",
          },
        },
        library: {
          eyebrow: "资料库",
          title: "本地资源扫描",
          addDirectory: "添加扫描目录",
          clearLibrary: "清除资料库",
          clearing: "清除中...",
          releaseMemoryCache: "释放缓存",
          releasingMemoryCache: "释放中...",
          releaseMemoryCacheDescription: "清理当前运行中的内存缓存，降低应用内存占用。",
          directoriesLabel: "扫描目录",
          directoriesHelper: "这里保存自动扫描目录。",
          watchLabel: "监听目录变化",
          watchDescription: "自动发现新增或变动的本地文件。",
          importArtworkLabel: "自动导入外部封面",
          importArtworkDescription: "扫描同目录中的封面图片。",
          embeddedLabel: "提取内嵌封面",
          embeddedDescription: "从音频标签中提取封面。",
        },
        network: {
          eyebrow: "网络",
          title: "网易云在线服务",
          sourceLabel: "启用网易云在线源",
          sourceDescription: "启用网易云在线功能。",
          localApiLabel: "使用本地 API 服务器",
          localApiDescription: "启动时自动使用本地 API 服务。",
          localApiStatusTitle: "本地 API 状态",
          localApiOutputTitle: "本地 API 输出",
          localApiOutputEmpty: "等待本地 API 输出...",
          apiBaseUrlLabel: "NeteaseMusicAPI 地址",
          apiBaseUrlHelper: "默认本地服务地址为 http://127.0.0.1:3000。开启本地 API 服务器后会固定使用 127.0.0.1，并沿用这里的端口。",
          cookieLabel: "网易云 Cookie",
          cookieHelper: "用于需要登录态的接口，会随请求一起传给本地 NeteaseMusicAPI 服务。",
          proxyLabel: "代理 Proxy",
          proxyHelper: "可选，按 NeteaseMusicAPI 文档填写。",
          realIpLabel: "realIP",
          realIpHelper: "可选，按 API 文档填写；留空则不传。",
          timeoutLabel: "请求超时",
          timeoutHelper: "单位为毫秒。",
          testLabel: "测试连接",
          testingLabel: "测试中...",
          loginTitle: "二维码登录",
          loginDescription: "通过扫码登录并保存 Cookie。",
          loginStatusLoggedIn: "已保存网易云登录凭据",
          loginStatusLoggedOut: "当前未登录网易云",
          loginStatusCreating: "正在生成二维码...",
          loginStatusWaiting: "等待扫码",
          loginStatusScanned: "已扫码，请在手机上确认登录",
          loginStatusAuthorized: "登录成功，正在保存凭据...",
          loginStatusExpired: "二维码已过期，请重新生成",
          loginStatusFailed: "二维码登录失败，请稍后重试",
          loginGenerate: "生成二维码",
          loginRefresh: "刷新二维码",
          loginStop: "停止轮询",
          loginClear: "退出登录",
          loginHint: "请使用网易云音乐手机客户端扫码。",
          loginCookieLabel: "当前 Cookie",
          loginCookieEmpty: "尚未保存登录 Cookie",
          accountTitle: "登录账号",
          accountDescription: "查看当前登录的网易云账号信息。",
          accountRefresh: "刷新账号信息",
          accountLoading: "正在加载账号信息...",
          accountEmpty: "当前没有可显示的网易云账号信息。",
          accountLoadFailed: "账号信息加载失败",
          accountIdLabel: "账号 ID",
          accountLevelLabel: "等级",
          accountVipLabel: "会员",
          accountVipActive: "已开通",
          accountVipInactive: "未开通",
          accountSignatureEmpty: "这个账号还没有设置个性签名。",
          meteredLabel: "允许计量网络",
          meteredDescription: "允许在受限网络下访问在线源。",
          metadataLabel: "优先在线元数据",
          metadataDescription: "优先补全在线歌曲信息。",
        },
      },
    },
    library: {
      eyebrow: "资料库",
      title: "音乐资料库",
      description: "在这里查看和整理你的本地音乐内容。",
      importCard: {
        eyebrow: "导入",
        title: "导入音乐",
        body: "导入单个音频文件，或直接导入整个文件夹中的所有音频。",
        scanDirectoriesSuffix: "个扫描目录",
        importing: "导入中...",
      },
      songsCard: {
        eyebrow: "歌曲",
        title: "全部歌曲",
        body: "浏览当前媒体库中的所有本地歌曲条目。",
        suffix: "首歌曲",
      },
      artistsCard: {
        eyebrow: "歌手",
        title: "歌手列表",
        body: "\u6309\u6b4c\u624b\u6574\u7406\u672c\u5730\u66f2\u76ee\uff0c\u4fbf\u4e8e\u7edf\u4e00\u67e5\u770b\u548c\u6d4f\u89c8\u3002",
        suffix: "位歌手",
      },
      albumsCard: {
        eyebrow: "专辑",
        title: "专辑列表",
        body: "\u6309\u4e13\u8f91\u6574\u7406\u5df2\u8bc6\u522b\u7684\u66f2\u76ee\u4fe1\u606f\uff0c\u96c6\u4e2d\u67e5\u770b\u4e13\u8f91\u5185\u5bb9\u3002",
        suffix: "张专辑",
      },
      views: {
        import: {
          title: "导入音乐",
          description: "在这里导入本地音频文件或文件夹。",
        },
        songs: {
          title: "全部歌曲",
          description: "在这里查看、筛选和播放资料库中的歌曲。",
        },
        artists: {
          title: "歌手列表",
          description: "在这里按歌手查看资料库中的歌曲。",
        },
        albums: {
          title: "专辑列表",
          description: "在这里按专辑查看资料库中的歌曲。",
        },
      },
      buttons: {
        backToLibrary: "返回资料库",
        backToArtists: "返回歌手列表",
        backToAlbums: "返回专辑列表",
        importDirectory: "导入文件夹",
        importAudio: "导入音频",
      },
      importOverview: {
        eyebrow: "概览",
        title: "当前媒体库状态",
        importedTracks: "已导入歌曲",
        scanDirectories: "扫描目录",
      },
      importDirectories: {
        eyebrow: "目录",
        title: "自动加载目录",
        empty: "还没有配置自动扫描目录。",
      },
      songFields: {
        artist: "作者",
        album: "专辑",
        duration: "时长",
        networkSource: "网络音源",
        unknownArtist: "未知歌手",
        unknownAlbum: "未分类专辑",
      },
      empty: {
        loading: "正在加载媒体库...",
        noTracks: "还没有导入音频文件。",
        noArtists: "还没有可显示的歌手信息。",
        noAlbums: "还没有可显示的专辑信息。",
        noArtistTracks: "这个歌手下还没有可显示的歌曲。",
        noAlbumTracks: "这个专辑下还没有可显示的歌曲。",
      },
    },
    player: {
      prev: "上一首",
      next: "下一首",
      play: "开始播放",
      pause: "暂停播放",
      volume: "调整音量",
      queue: "打开播放列表",
    },
  },
  "en-US": {
    locale: "en-US",
    nav: {
      home: "Home",
      explore: "Explore",
      favorites: "Liked Songs",
      playlist: "Playlist",
      library: "Library",
      tools: "Tools",
      settings: "Settings",
    },
    options: {
      language: [
        { label: "简体中文", value: "zh-CN", description: "Switch to Simplified Chinese UI copy." },
        { label: "English", value: "en-US", description: "Use English UI copy." },
      ],
      theme: [
        { label: "Celia Default", value: "celia-default", description: "Default silver-blue appearance." },
        { label: "Mist Blue", value: "mist-blue", description: "A calmer and cooler visual tone." },
      ],
      quality: [
        { label: "High Quality", value: "high", description: "Prefer higher bitrate and higher quality streams." },
        { label: "Balanced", value: "balanced", description: "Balance network usage and playback stability." },
        { label: "Data Saver", value: "data-saver", description: "Prefer lighter playback sources." },
      ],
      playbackCacheMode: [
        {
          label: "Stream While Caching",
          value: "stream",
          description: "Start playback immediately and keep caching the current track in the background.",
        },
        {
          label: "Play After Full Cache",
          value: "complete",
          description: "Cache the full track first, then start playback from local cache.",
        },
      ],
    },
    placeholder: {
      title: "Nothing To Show Yet",
      body: "This area is currently kept minimal. Use the sidebar to browse your music and settings.",
    },
    settings: {
      eyebrow: "Settings",
      title: "App Preferences",
      description: "Adjust app settings here.",
      autoSaveEnabled: "Auto-save is enabled",
      autoSaving: "Saving changes...",
      restore: "Restore Default",
      save: "Save Settings",
      saving: "Saving...",
      sections: {
        appearance: {
          eyebrow: "Appearance",
          title: "Look and Language",
          languageLabel: "Interface Language",
          fontLabel: "App Font",
          fontWeightLabel: "App Font Weight",
          fontWeightHelper: "Adjust the visual weight of the app UI text. 400 is regular and 700 is bold-ish.",
          fontDefaultOption: "Follow System Default",
          fontHelperLoading: "Reading system fonts...",
          fontHelperReady: "Only installed system fonts are shown, each previewed in its own typeface.",
          fontSearchPlaceholder: "Search fonts",
          fontSearchEmpty: "No matching fonts found.",
          themeLabel: "Theme Style",
          followArtworkThemeLabel: "Follow Song Artwork",
          followArtworkThemeDescription:
            "Temporarily recolor the app from the current cover art while a song is playing without changing the saved theme.",
          compactLabel: "Compact Layout",
          compactDescription: "Use denser spacing for list and information blocks.",
          artworkLabel: "Show Artwork",
          artworkDescription: "Display artwork in the playbar, lists, and detail views.",
        },
        dynamicIsland: {
          eyebrow: "Dynamic Island",
          title: "Appearance and Behavior",
          description: "Adjust the island style, color direction, default content, and position.",
          enabledLabel: "Show Dynamic Island",
          enabledDescription: "Hide the top Dynamic Island entirely.",
          styleLabel: "Style",
          styleDefault: "Default Capsule",
          styleSoft: "Soft Glass",
          styleSolid: "Contrast Rail",
          colorLabel: "Color Theme",
          colorFollowTheme: "Follow Theme",
          colorPrimary: "Primary Accent",
          colorSecondary: "Secondary Accent",
          contentLabel: "Default Content",
          contentTime: "Time",
          contentDate: "Date",
          contentDateTime: "Date and Time",
          positionLabel: "Position",
          positionCenter: "Top Center",
          positionLeft: "Top Left",
          positionRight: "Top Right",
          lyricsLabel: "Show Lyrics in Dynamic Island",
          lyricsDescription:
            "While music is playing, prefer the current lyric line inside the island and fall back to the default content when lyrics are unavailable.",
        },
        lyrics: {
          eyebrow: "Lyrics",
          title: "Lyric Display",
          description: "Adjust timing offset, font, and animation pacing for immersive lyrics.",
          delayLabel: "Lyric Delay",
          delayHelper: "Positive values show lyrics later, negative values show them earlier, from -1000ms to +1000ms.",
          fontLabel: "Lyric Font",
          fontWeightLabel: "Lyric Font Weight",
          fontWeightHelper: "Adjust the weight of immersive lyrics. Higher values make the glyphs feel heavier.",
          fontDefaultOption: "Follow System Default",
          fontHelperLoading: "Reading system fonts...",
          fontHelperReady: "Available system fonts are listed automatically.",
          fontSearchPlaceholder: "Search fonts",
          fontSearchEmpty: "No matching fonts found.",
          fontSizeLabel: "Lyric Size",
          fontSizeHelper: "Scales the responsive lyric typography used by the immersive page.",
          lineSpacingLabel: "Line Spacing",
          lineSpacingHelper: "Adjust the vertical spacing between lyric lines. 100% is the default spacing.",
          lineAlignmentLabel: "Line Alignment",
          lineAlignmentHelper: "Controls where the active line sits vertically inside the scrolling stage.",
          lineAlignmentUpper: "Upper",
          lineAlignmentCenter: "Center",
          textAlignmentLabel: "Text Alignment",
          textAlignmentHelper: "Controls how each lyric line is aligned horizontally in the immersive player.",
          textAlignmentLeft: "Left",
          textAlignmentCenter: "Center",
          textAlignmentRight: "Right",
          renderModeLabel: "Lyric Effect Mode",
          renderModeHelper: "Simple mode uses the original single-layer shadow/glow. Balanced mode keeps layered rendering with reduced precision. Advanced mode uses the full layered shadow and glow.",
          renderModeSimple: "Simple",
          renderModeBalanced: "Balanced",
          renderModeAdvanced: "Advanced",
          progressBarPreviewLabel: "Timeline Lyrics",
          progressBarPreviewDescription: "Show the lyric line above the non-immersive playback timeline on hover.",
          textShadowLabel: "Text Shadow",
          textShadowDescription: "Adds a steadier shadow layer so lyrics stay readable over busy artwork.",
          textShadowIntensityLabel: "Shadow Intensity",
          textShadowIntensityHelper: "Controls how present and dark the lyric shadow feels. Higher values make it more pronounced.",
          textShadowDefinitionLabel: "Shadow Definition",
          textShadowDefinitionHelper: "Controls whether the shadow stays tight to the glyph or diffuses outward. Higher values stay sharper.",
          glowLabel: "Lyric Glow",
          glowDescription: "Adds a soft luminous highlight around the current lyric line.",
          glowIntensityLabel: "Glow Intensity",
          glowIntensityHelper: "Controls how bright and visible the lyric glow appears. Higher values glow more strongly.",
          glowDefinitionLabel: "Glow Definition",
          glowDefinitionHelper: "Controls how tightly the glow hugs the text. Higher values stay crisper, lower values spread more softly.",
          blurRangeLabel: "Lyric Blur Range",
          blurRangeHelper: "Controls how far clarity extends above and below the current line before distant lyrics start to blur.",
          curveAmountLabel: "Lyric Curve",
          curveAmountHelper:
            "Positive values bend one way, negative values bend the opposite way, and larger absolute values create a stronger curve.",
          animationSpeedLabel: "Animation Speed",
          animationSpeedHelper: "Affects both line scrolling and word transitions. 100% is the default pace.",
          lineAnimationStaggerLabel: "Line Animation Delay",
          lineAnimationStaggerHelper:
            "Controls the cascading interval between lyric lines as they start moving from top to bottom, without changing the speed of each line animation.",
        },
        playback: {
          eyebrow: "Playback",
          title: "Playback Preferences",
          qualityLabel: "Preferred Quality",
          cacheModeLabel: "Cache Mode",
          cacheModeDescription: "Choose whether playback should wait for the full track cache.",
          preferRemoteLabel: "Prefer Online Playback",
          preferRemoteDescription: "Prefer network streams when both local and remote sources exist.",
          songTransitionLabel: "Song Transition",
          songTransitionDescription: "Fade out the current song near the end and bring the next song in smoothly.",
          songTransitionModeLabel: "Transition Mode",
          songTransitionModeDescription: "Simple Mix keeps the current fade-based transition. AutoMix prefers analysis results when choosing where the transition should begin.",
          songTransitionModeSimpleMix: "Simple Mix",
          songTransitionModeAutoMix: "AutoMix",
          songTransitionModeSimpleMixDescription: "Use the current fade-out and fade-in transition.",
          songTransitionModeAutoMixDescription: "Use analysis results to choose the transition entry point while keeping the current fade mix engine.",
          songTransitionTimingLabel: "Transition Start",
          songTransitionTimingHelper: "Choose how long before the end of a song the transition should begin.",
          rememberQueueLabel: "Remember Queue",
          rememberQueueDescription: "Restore the previous queue after reopening the app.",
        },
        shortcuts: {
          eyebrow: "Shortcuts",
          title: "Keyboard Controls",
          description: "Set custom keys for common playback actions. Each action can have multiple keys, while built-in in-app shortcuts remain available.",
          builtInTitle: "Built-in In-App Shortcuts",
          builtInDescription: "These shortcuts are always active inside the app and automatically ignore editable fields.",
          customTitle: "Custom Keys",
          customDescription: "Select an action, then use the simulated keyboard below to add or remove keys. Duplicate custom keys are removed from other actions automatically.",
          keyboardTitle: "Simulated Keyboard",
          keyboardDescription: "You can bind multiple fallback keys to the selected action.",
          selectHint: "Choose an action first, then pick keys from the keyboard below.",
          selectedPrefix: "Editing:",
          clearAction: "Clear Action",
          openEditor: "Edit Keys",
          dialogTitle: "Shortcut Binding",
          dialogClose: "Close",
          unbound: "Unbound",
          actions: {
            togglePlayback: "Pause / Resume",
            nextTrack: "Next Track",
            previousTrack: "Previous Track",
            stopPlayback: "Stop Playback",
            volumeUp: "Volume Up",
            volumeDown: "Volume Down",
            seekForward: "Seek Forward",
            seekBackward: "Seek Backward",
            cyclePlaybackMode: "Cycle Playback Mode",
          },
        },
        library: {
          eyebrow: "Library",
          title: "Local Scan",
          addDirectory: "Add Scan Folder",
          clearLibrary: "Clear Library",
          clearing: "Clearing...",
          releaseMemoryCache: "Release Cache",
          releasingMemoryCache: "Releasing...",
          releaseMemoryCacheDescription:
            "Clear runtime in-memory caches to reduce the app's current memory usage.",
          directoriesLabel: "Scan Folders",
          directoriesHelper: "These folders are saved as automatic scan targets. They are scanned on app launch, and updates sync while running if directory watching is enabled.",
          watchLabel: "Watch Folder Changes",
          watchDescription: "Automatically detect newly added or replaced local music files.",
          importArtworkLabel: "Import External Artwork",
          importArtworkDescription: "Scan for cover, folder, and similar artwork files in the same directory.",
          embeddedLabel: "Extract Embedded Artwork",
          embeddedDescription: "Reserve a switch for extracting artwork from audio tags.",
        },
        network: {
          eyebrow: "Network",
          title: "Netease Online Service",
          sourceLabel: "Enable Netease Source",
          sourceDescription: "Only NeteaseMusicAPI is connected for online features right now. Turning this off disables online search, resolving, and streaming.",
          localApiLabel: "Use Local API Server",
          localApiDescription: "When enabled, the app starts a local NeteaseCloudMusicApi server through the system Node.js / npx environment on launch and prefers the local 127.0.0.1 endpoint.",
          localApiStatusTitle: "Local API Status",
          localApiOutputTitle: "Local API Output",
          localApiOutputEmpty: "Waiting for local API output...",
          apiBaseUrlLabel: "NeteaseMusicAPI Base URL",
          apiBaseUrlHelper: "The default local service address is http://127.0.0.1:3000. When the local API server is enabled, the app always uses 127.0.0.1 and keeps the port from this field.",
          cookieLabel: "Netease Cookie",
          cookieHelper: "Used for endpoints that require a login session and passed to the local NeteaseMusicAPI service with each request.",
          proxyLabel: "Proxy",
          proxyHelper: "Optional. Fill it in according to the NeteaseMusicAPI docs.",
          realIpLabel: "realIP",
          realIpHelper: "Optional. Fill it in according to the API docs, or leave it empty.",
          timeoutLabel: "Request Timeout",
          timeoutHelper: "Measured in milliseconds.",
          testLabel: "Test Connection",
          testingLabel: "Testing...",
          loginTitle: "QR Login",
          loginDescription: "Generate a QR code for the Netease Cloud Music app. When login succeeds, the cookie is saved automatically for online playback and API requests.",
          loginStatusLoggedIn: "Saved Netease login cookie",
          loginStatusLoggedOut: "Not logged in to Netease",
          loginStatusCreating: "Generating QR code...",
          loginStatusWaiting: "Waiting for scan",
          loginStatusScanned: "Scanned. Please confirm login on your phone.",
          loginStatusAuthorized: "Login succeeded. Saving credentials...",
          loginStatusExpired: "QR code expired. Please generate a new one.",
          loginStatusFailed: "QR login failed. Please try again.",
          loginGenerate: "Generate QR",
          loginRefresh: "Refresh QR",
          loginStop: "Stop Polling",
          loginClear: "Sign Out",
          loginHint: "Please scan with the Netease Cloud Music mobile app.",
          loginCookieLabel: "Current Cookie",
          loginCookieEmpty: "No login cookie has been saved yet.",
          accountTitle: "Logged-in Account",
          accountDescription: "Show the current Netease account resolved from the saved cookie so you can confirm the login state.",
          accountRefresh: "Refresh Account",
          accountLoading: "Loading account information...",
          accountEmpty: "No Netease account information is available yet.",
          accountLoadFailed: "Failed to load account information",
          accountIdLabel: "Account ID",
          accountLevelLabel: "Level",
          accountVipLabel: "VIP",
          accountVipActive: "Active",
          accountVipInactive: "Inactive",
          accountSignatureEmpty: "This account has not set a signature yet.",
          meteredLabel: "Allow Metered Network",
          meteredDescription: "Allow access to online sources even on limited or metered networks.",
          metadataLabel: "Prefer Online Metadata",
          metadataDescription: "Try online metadata first when local track information is incomplete.",
        },
      },
    },
    library: {
      eyebrow: "Library",
      title: "Music Library",
      description: "Browse and organize your local music here.",
      importCard: {
        eyebrow: "Import",
        title: "Import Music",
        body: "Import single audio files, or import every audio file inside a whole folder.",
        scanDirectoriesSuffix: "scan folders",
        importing: "Importing...",
      },
      songsCard: {
        eyebrow: "Songs",
        title: "All Songs",
        body: "Browse every local track currently inside the media library.",
        suffix: "songs",
      },
      artistsCard: {
        eyebrow: "Artists",
        title: "Artist List",
        body: "Group local tracks by artist for easier browsing.",
        suffix: "artists",
      },
      albumsCard: {
        eyebrow: "Albums",
        title: "Album List",
        body: "Group recognized tracks by album for easier browsing.",
        suffix: "albums",
      },
      views: {
        import: {
          title: "Import Music",
          description: "Import local audio files or folders here.",
        },
        songs: {
          title: "All Songs",
          description: "Browse, filter, and play songs in your library here.",
        },
        artists: {
          title: "Artist List",
          description: "Browse songs in your library by artist here.",
        },
        albums: {
          title: "Album List",
          description: "Browse songs in your library by album here.",
        },
      },
      buttons: {
        backToLibrary: "Back to Library",
        backToArtists: "Back to Artists",
        backToAlbums: "Back to Albums",
        importDirectory: "Import Folder",
        importAudio: "Import Audio",
      },
      importOverview: {
        eyebrow: "Overview",
        title: "Current Library State",
        importedTracks: "Imported Songs",
        scanDirectories: "Scan Folders",
      },
      importDirectories: {
        eyebrow: "Folders",
        title: "Auto Scan Folders",
        empty: "No automatic scan folders have been configured yet.",
      },
      songFields: {
        artist: "Artist",
        album: "Album",
        duration: "Duration",
        networkSource: "Remote Source",
        unknownArtist: "Unknown Artist",
        unknownAlbum: "Unsorted Album",
      },
      empty: {
        loading: "Loading library...",
        noTracks: "No audio files have been imported yet.",
        noArtists: "No artist information is available yet.",
        noAlbums: "No album information is available yet.",
        noArtistTracks: "No songs are available for this artist yet.",
        noAlbumTracks: "No songs are available for this album yet.",
      },
    },
    player: {
      prev: "Previous Track",
      next: "Next Track",
      play: "Play",
      pause: "Pause",
      volume: "Adjust Volume",
      queue: "Open Queue",
    },
  },
} as const;

type UiCopy = (typeof UI_COPY)[keyof typeof UI_COPY];

function getUiCopy(language: string): UiCopy {
  return language === "en-US" ? UI_COPY["en-US"] : UI_COPY["zh-CN"];
}

function getPlaybarQueueCopy(locale: string) {
  if (locale === "en-US") {
    return {
      title: "Current Queue",
      empty: "No tracks in the queue yet.",
      current: "Now Playing",
      reorder: "Drag to Reorder",
      openSourcePlaylist: "Open Source Playlist",
      moveUp: "Move Up",
      moveDown: "Move Down",
      remove: "Remove",
      sourceLocal: "Local",
      sourceOnline: "Online",
    };
  }

  return {
    title: "当前播放列表",
    empty: "当前播放列表还没有歌曲。",
    current: "正在播放",
    reorder: "拖拽调整顺序",
    openSourcePlaylist: "打开来源歌单",
    moveUp: "上移",
    moveDown: "下移",
    remove: "移除",
    sourceLocal: "本地",
    sourceOnline: "在线",
  };
}

export function getImmersivePlayerCopy(locale: string) {
  if (locale === "en-US") {
    return {
      locale: "en-US",
      close: "Close immersive player",
      open: "Open immersive player",
      enableWallpaper: "Enable wallpaper mode",
      disableWallpaper: "Disable wallpaper mode",
      nowPlaying: "Now Playing",
      lyrics: "Lyrics",
      lyricsLoading: "Loading lyrics...",
      lyricsEmpty: "No lyrics are available for this track yet.",
      lyricsHint: "Lyrics will stay in sync here when the track provides them.",
      instrumentalTitle: "Instrumental track, please enjoy.",
      instrumentalHint: "",
      interludeWaiting: "Interlude",
      translation: "Translation",
      romanized: "Romanized",
      localTag: "Local Playback",
      onlineTag: "Online Playback",
      albumFallback: "Single / Unknown Album",
      prev: "Previous track",
      play: "Play",
      pause: "Pause",
      next: "Next track",
      dynamicLyric: "Dynamic",
      lineLyric: "Line",
    };
  }

  return {
    locale: "zh-CN",
    close: "关闭沉浸式播放页",
    open: "打开沉浸式播放页",
    enableWallpaper: "开启壁纸模式",
    disableWallpaper: "关闭壁纸模式",
    nowPlaying: "正在播放",
    lyrics: "歌词",
    lyricsLoading: "正在加载歌词...",
    lyricsEmpty: "这首歌暂时还没有可用歌词。",
    lyricsHint: "当歌曲提供歌词时，这里会保持同步滚动。",
    instrumentalTitle: "纯音乐，请欣赏",
    instrumentalHint: "",
    interludeWaiting: "间奏等待",
    translation: "翻译",
    romanized: "罗马音",
    localTag: "本地播放",
    onlineTag: "在线播放",
    albumFallback: "单曲 / 未知专辑",
    prev: "上一首",
    play: "开始播放",
    pause: "暂停播放",
    next: "下一首",
    dynamicLyric: "逐字",
    lineLyric: "逐行",
  };
}

const INSTRUMENTAL_LYRIC_PATTERN =
  /(纯音乐(?:[，,、 ]*请欣赏)?|此歌曲为没有填词的纯音乐，请您欣赏|请欣赏纯音乐|instrumental|enjoy the music)/i;

function normalizeImmersiveLyricStatusText(value: string | null | undefined) {
  return value?.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim() ?? "";
}

function isInstrumentalLyricText(value: string | null | undefined) {
  const normalized = normalizeImmersiveLyricStatusText(value);
  return normalized.length > 0 && INSTRUMENTAL_LYRIC_PATTERN.test(normalized);
}

function hasDisplayableImmersiveLyrics(lyrics: NeteaseSongLyrics | null) {
  return (lyrics?.lines ?? []).some((line) => {
    const normalized = normalizeImmersiveLyricStatusText(line.text);
    return normalized.length > 0 && !isInstrumentalLyricText(normalized);
  });
}

function resolveInstrumentalLyricState(lyrics: NeteaseSongLyrics | null) {
  if (!lyrics) {
    return false;
  }

  if ((lyrics.lines ?? []).some((line) => isInstrumentalLyricText(line.text))) {
    return true;
  }

  return [
    lyrics.lyric,
    lyrics.dynamicLyric,
    lyrics.translatedLyric,
    lyrics.romanizedLyric,
    ...lyrics.metadataEntries.map((entry) => entry.text),
  ].some((candidate) => isInstrumentalLyricText(candidate));
}

type QueueDragState = {
  trackId: string;
  pointerX: number;
  pointerY: number;
  startPointerX: number;
  startPointerY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  initialIndex: number;
  listScrollTop: number;
  listTop: number;
  listBottom: number;
  queueIds: string[];
  rowTops: Record<string, number>;
  rowCenters: Record<string, number>;
};

type PersistedPlaybackResumeState = {
  queueIds: string[];
  trackId: string | null;
};

type PlaybackRestoreSessionState = {
  status: "scheduled" | "hydrating" | "restoring";
  queueIds: string[];
  trackId: string | null;
  sequence: number;
} | null;

type PlaybackStartIntent = {
  trackId: string;
  source: "restore" | "standard";
};

type ThemePresetId =
  | "celia-default"
  | "mist-blue"
  | "jade-dawn"
  | "graphite"
  | "custom";

type ThemeSeed = {
  primary: string;
  secondary: string;
  surface: string;
};

const THEME_PRESETS: Record<Exclude<ThemePresetId, "custom">, ThemeSeed> = {
  "celia-default": {
    primary: "#7aa2d6",
    secondary: "#b7d7f2",
    surface: "#eef3fa",
  },
  "mist-blue": {
    primary: "#9a6fd8",
    secondary: "#d7b8ff",
    surface: "#f4eefc",
  },
  "jade-dawn": {
    primary: "#4e8f86",
    secondary: "#9fd2c1",
    surface: "#edf5f1",
  },
  graphite: {
    primary: "#c46a3a",
    secondary: "#efb08c",
    surface: "#fbf1ea",
  },
};

const PLAYBACK_RESUME_STORAGE_KEY = "celia.playback-resume";

function getThemePresetOptions(locale: string): UISelectOption[] {
  if (locale === "en-US") {
    return [
      {
        label: "Celia Default",
        value: "celia-default",
        description: "Soft silver-blue with a clean modern feel.",
      },
      {
        label: "Violet Haze",
        value: "mist-blue",
        description: "Soft violet tones with a brighter, airier surface.",
      },
      {
        label: "Jade Dawn",
        value: "jade-dawn",
        description: "A quiet mint-cyan palette with a lighter atmosphere.",
      },
      {
        label: "Amber Glow",
        value: "graphite",
        description: "Warm amber accents with a light cream background.",
      },
      {
        label: "Custom Theme",
        value: "custom",
        description: "Use your own primary, secondary, and surface colors.",
      },
    ];
  }

  return [
    {
      label: "Celia 默认",
      value: "celia-default",
      description: "柔和的银蓝配色，干净而现代。",
    },
    {
      label: "雾紫微光",
      value: "mist-blue",
      description: "柔和偏紫的明亮氛围主题。",
    },
    {
      label: "青玉晨雾",
      value: "jade-dawn",
      description: "偏青绿色的轻盈氛围主题。",
    },
    {
      label: "琥珀暖光",
      value: "graphite",
      description: "偏暖琥珀色的轻盈暖调主题。",
    },
    {
      label: "自定义主题",
      value: "custom",
      description: "使用你自己的主色、副色和背景色。",
    },
  ];
}

function getThemeEditorCopy(locale: string) {
  if (locale === "en-US") {
    return {
      openButton: "Open Theme Editor",
      backButton: "Back to Settings",
      title: "Theme Editor",
      description:
        "Set light or dark mode, switch between preset palettes, and fine-tune your own colors.",
      modeTitle: "Light / Dark Theme",
      modeDescription: "Choose the overall brightness direction for the application.",
      lightMode: "Light",
      darkMode: "Dark",
      presetsTitle: "Application Palette",
      presetsDescription: "Choose an application palette.",
      customTitle: "Custom Colors",
      customDescription:
        "Editing any custom color will switch the theme to Custom automatically.",
      previewTitle: "Theme Preview",
      previewDescription: "Preview the current application palette.",
      primaryLabel: "Primary Color",
      secondaryLabel: "Secondary Color",
      surfaceLabel: "Surface Color",
      backgroundTitle: "Background Modes",
      backgroundDescription: "Choose a theme-following or custom app background.",
      backgroundModeLabel: "App Background",
      backgroundModeTheme: "Follow Theme",
      backgroundModeCustom: "Custom Media",
      backgroundMvLabel: "Background MV",
      backgroundMvDescription:
        "When a Netease track is playing, try using the song MV as a temporary background and keep the current background when no MV is available.",
      customImageTitle: "Background Media",
      customImageDescription:
        "Upload your own image or video for the application background. Videos stay muted and loop automatically.",
      customImageUpload: "Choose Media",
      customImageClear: "Clear Media",
      customImageEmpty: "No background media selected yet.",
      customImageOpacityLabel: "Media Opacity",
      customBlurLabel: "Background Blur",
      customDimLabel: "Background Darken",
      immersiveBackgroundTitle: "Immersive Background",
      immersiveBackgroundDescription: "Choose the background style for the immersive player.",
      immersiveBackgroundModeLabel: "Immersive Background",
      immersiveBackgroundModePaletteSolid: "Palette Solid",
      immersiveBackgroundModePaletteGradient: "Palette Gradient",
      immersiveBackgroundModeAppBackground: "Follow App Background",
      immersiveBackgroundModeBackgroundMv: "Background MV",
      immersiveBackgroundModeCoverBlur: "Blurred Artwork",
      immersiveBackgroundModeFlow: "Fluid",
      immersiveBackgroundAnimatedLabel: "Dynamic Fluid",
      immersiveBackgroundAnimatedDescription:
        "Turn this off to keep the fluid look but freeze it as a static frame.",
      immersiveBackgroundResolutionLabel: "Render Precision",
      immersiveBackgroundResolutionHelper: "Higher precision improves detail but costs more performance.",
      immersiveBackgroundSpeedLabel: "Animation Speed",
      immersiveBackgroundSpeedHelper: "Controls how quickly the fluid background flows and cycles through its motion.",
      immersiveBackgroundBlurLabel: "Fluid Blur",
      immersiveBackgroundBlurHelper: "Increase this to make the fluid background softer and more diffused.",
      immersiveBackgroundSoftnessLabel: "Fluid Softness",
      immersiveBackgroundSoftnessHelper:
        "Lower values keep color boundaries firmer, while higher values make the fluid blend more softly.",
      activateCustom: "Use Custom Theme",
      activePreset: "Active",
      customTag: "Custom",
    };
  }

  return {
    openButton: "打开主题编辑",
    backButton: "返回设置",
    title: "主题编辑",
    description: "在这里调整主题和界面配色。",
    modeTitle: "明暗主题",
    modeDescription: "选择应用整体的亮色或暗色风格。",
    lightMode: "亮色模式",
    darkMode: "暗色模式",
    presetsTitle: "应用配色",
    presetsDescription: "选择一个应用配色。",
    customTitle: "自定义颜色",
    customDescription: "修改任意自定义颜色后，主题会自动切换为“自定义主题”。",
    previewTitle: "主题预览",
    previewDescription: "预览当前应用配色。",
    primaryLabel: "主色",
    secondaryLabel: "辅助色",
    surfaceLabel: "背景色",
    backgroundTitle: "背景模式",
    backgroundDescription: "选择跟随主题或自定义应用背景。",
    backgroundModeLabel: "应用背景",
    backgroundModeTheme: "跟随颜色主题",
    backgroundModeCustom: "自定义",
    backgroundMvLabel: "背景 MV",
    backgroundMvDescription:
      "播放网易云歌曲时自动尝试加载歌曲 MV 作为临时背景，没有 MV 时保持当前背景不变。",
    customImageTitle: "背景媒体",
    customImageDescription: "上传自定义背景图片或视频，并设置它的透明度、模糊和暗化程度。视频会自动静音循环播放。",
    customImageUpload: "选择媒体",
    customImageClear: "清除媒体",
    customImageEmpty: "当前还没有选择背景媒体。",
    customImageOpacityLabel: "媒体透明度",
    customBlurLabel: "背景模糊",
    customDimLabel: "背景暗化",
    immersiveBackgroundTitle: "沉浸式背景",
    immersiveBackgroundDescription: "选择沉浸式播放页的背景样式。",
    immersiveBackgroundModeLabel: "沉浸式背景",
    immersiveBackgroundModePaletteSolid: "背景采色纯色",
    immersiveBackgroundModePaletteGradient: "背景采色渐变",
    immersiveBackgroundModeAppBackground: "跟随应用背景",
    immersiveBackgroundModeBackgroundMv: "背景 MV",
    immersiveBackgroundModeCoverBlur: "封面模糊",
    immersiveBackgroundModeFlow: "流体",
    immersiveBackgroundAnimatedLabel: "动态流体",
    immersiveBackgroundAnimatedDescription: "关闭后保留流体质感，但停止动画并改为静态流体。",
    immersiveBackgroundResolutionLabel: "渲染精度",
    immersiveBackgroundResolutionHelper: "精度越高细节越完整，但性能开销也会更高。",
    immersiveBackgroundSpeedLabel: "动画速度",
    immersiveBackgroundSpeedHelper: "控制流体背景流动与循环推进的速度。",
    immersiveBackgroundBlurLabel: "流体模糊",
    immersiveBackgroundBlurHelper: "提高数值可以让流体背景过渡更柔和、更接近雾化效果。",
    immersiveBackgroundSoftnessLabel: "流体柔和度",
    immersiveBackgroundSoftnessHelper: "数值越低，流体中不同颜色的边界越硬；数值越高，混合越柔和。",
    activateCustom: "使用自定义主题",
    activePreset: "当前使用",
    customTag: "自定义",
  };
}

function sanitizeHexColor(value: string, fallback: string) {
  const normalized = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : fallback;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function smoothApproach(current: number, target: number, amount: number) {
  const normalizedAmount = clamp01(amount);
  if (!Number.isFinite(current)) {
    return target;
  }

  if (!Number.isFinite(target)) {
    return current;
  }

  return current + (target - current) * normalizedAmount;
}

function animatePlaybackRateToOne(
  audio: HTMLAudioElement,
  options?: {
    durationMs?: number;
    onComplete?: () => void;
  },
) {
  const durationMs = Math.max(240, options?.durationMs ?? 720);
  const startRate = Number.isFinite(audio.playbackRate) ? audio.playbackRate : 1;

  if (Math.abs(startRate - 1) < 0.002) {
    audio.playbackRate = 1;
    options?.onComplete?.();
    return;
  }

  const startedAt = performance.now();

  const step = (now: number) => {
    const progress = clamp01((now - startedAt) / durationMs);
    const eased = progress ** 3 * (progress * (progress * 6 - 15) + 10);
    audio.playbackRate = startRate + (1 - startRate) * eased;

    if (progress >= 1) {
      audio.playbackRate = 1;
      options?.onComplete?.();
      return;
    }

    window.requestAnimationFrame(step);
  };

  window.requestAnimationFrame(step);
}

function buildConfiguredFontFamilyValue(fontFamily: string) {
  const normalizedFontFamily = fontFamily.trim();

  if (!normalizedFontFamily || normalizedFontFamily === "system-ui") {
    return 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
  }

  return `"${normalizedFontFamily.replace(/"/g, '\\"')}", system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
}

const COMMON_FONT_FAMILY_PRIORITY = [
  "Microsoft YaHei UI",
  "Microsoft YaHei",
  "微软雅黑",
  "PingFang SC",
  "苹方-简",
  "Source Han Sans SC",
  "Source Han Sans CN",
  "Noto Sans SC",
  "Source Han Serif SC",
  "Noto Serif SC",
  "HarmonyOS Sans SC",
  "MiSans",
  "OPPOSans",
  "Alibaba PuHuiTi 3.0",
  "LXGW WenKai",
  "Sarasa UI SC",
  "Sarasa Gothic SC",
  "SimHei",
  "SimSun",
  "KaiTi",
  "FangSong",
  "Segoe UI",
  "Segoe UI Variable",
  "Arial",
  "Helvetica Neue",
  "Roboto",
  "Inter",
] as const;

function normalizeFontFamilyKey(fontFamily: string) {
  return fontFamily.trim().replace(/\s+/g, " ").toLowerCase();
}

function prioritizeSystemFontFamilies(fontFamilies: string[], locale: string) {
  const priorityLookup = new Map(
    COMMON_FONT_FAMILY_PRIORITY.map((family, index) => [normalizeFontFamilyKey(family), index]),
  );

  return [...fontFamilies].sort((left, right) => {
    const leftPriority = priorityLookup.get(normalizeFontFamilyKey(left));
    const rightPriority = priorityLookup.get(normalizeFontFamilyKey(right));

    if (typeof leftPriority === "number" && typeof rightPriority === "number") {
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
    } else if (typeof leftPriority === "number") {
      return -1;
    } else if (typeof rightPriority === "number") {
      return 1;
    }

    return left.localeCompare(right, locale === "en-US" ? "en" : "zh-Hans-CN", {
      sensitivity: "base",
    });
  });
}

function buildFontOptionLabelStyle(fontFamily: string): CSSProperties {
  return {
    fontFamily: buildConfiguredFontFamilyValue(fontFamily),
  };
}

function buildLyricFontFamilyValue(fontFamily: string) {
  return buildConfiguredFontFamilyValue(fontFamily);
}

function resolveLyricWordFillTiming(
  word: { startTimeMs: number; durationMs: number; endTimeMs: number },
  nextWord: { startTimeMs: number } | null,
  line: { startTimeMs: number; endTimeMs: number; words: Array<{ durationMs: number }> },
) {
  const boundedEndTimeCandidates = [
    word.endTimeMs,
    nextWord?.startTimeMs ?? Number.POSITIVE_INFINITY,
    line.endTimeMs,
  ].filter((candidate) => Number.isFinite(candidate) && candidate > word.startTimeMs);
  const fallbackAverageDuration =
    line.words.length > 0
      ? Math.max(80, Math.round((line.endTimeMs - line.startTimeMs) / line.words.length))
      : 120;
  const rawDurationMs =
    boundedEndTimeCandidates.length > 0
      ? Math.min(...boundedEndTimeCandidates) - word.startTimeMs
      : word.durationMs > 0
        ? word.durationMs
        : nextWord
          ? nextWord.startTimeMs - word.startTimeMs
          : line.endTimeMs - word.startTimeMs;
  const durationMs = Math.max(
    1,
    Math.round(Number.isFinite(rawDurationMs) && rawDurationMs > 0 ? rawDurationMs : fallbackAverageDuration),
  );

  return {
    durationMs,
    endTimeMs: word.startTimeMs + durationMs,
  };
}

function splitLyricWordDisplayText(text: string) {
  const match = text.match(/^(\s*)(.*?)(\s*)$/su);
  const leadingWhitespace = match?.[1] ?? "";
  const trailingWhitespace = match?.[3] ?? "";
  const coreText = (match?.[2] ?? "").trim();

  if (!coreText) {
    return {
      leadingWhitespace: "",
      coreText: text,
      trailingWhitespace: "",
    };
  }

  return {
    leadingWhitespace,
    coreText,
    trailingWhitespace,
  };
}

function resolveLyricWordContextRolls(
  word: { startTimeMs: number; endTimeMs: number; durationMs: number },
  previousWord: { endTimeMs: number } | null,
  nextWord: { startTimeMs: number } | null,
) {
  const previousGapMs = previousWord ? Math.max(0, word.startTimeMs - previousWord.endTimeMs) : 92;
  const nextGapMs = nextWord ? Math.max(0, nextWord.startTimeMs - word.endTimeMs) : 110;
  const preRollMs = Math.round(
    clampNumber(Math.min(word.durationMs * 0.24, 78) + Math.min(previousGapMs * 0.18, 16), 28, 92),
  );
  const postRollMs = Math.round(
    clampNumber(Math.min(word.durationMs * 0.28, 96) + Math.min(nextGapMs * 0.22, 22), 34, 118),
  );

  return {
    preRollMs,
    postRollMs,
  };
}

function resolveLyricWordFillVisuals(text: string, durationMs: number) {
  const characterCount = Math.max(
    1,
    Array.from(text.replace(/\s+/g, "")).length,
  );
  const durationFactor = clamp01((durationMs - 90) / 720);
  const lengthFactor = clamp01((characterCount - 1) / 5);
  const combinedFactor = clamp01(durationFactor * 0.58 + lengthFactor * 0.42);
  const overscanEm = 0.05 + combinedFactor * 0.12;
  const tailEm = 0.045 + combinedFactor * 0.16;
  const tailSoftEm = tailEm * 0.56;
  const tailFadeEm = tailEm * 0.2;
  const glowOpacity = 0.08 + combinedFactor * 0.08;

  return {
    overscanEm: `${overscanEm.toFixed(3)}em`,
    tailEm: `${tailEm.toFixed(3)}em`,
    tailSoftEm: `${tailSoftEm.toFixed(3)}em`,
    tailFadeEm: `${tailFadeEm.toFixed(3)}em`,
    glowOpacity: glowOpacity.toFixed(3),
  };
}

function resolveLyricWordContextVisuals(
  _currentTimeMs: number,
  _word: { startTimeMs: number; endTimeMs: number; durationMs: number },
  _contextRolls: { preRollMs: number; postRollMs: number },
) {
  return {
    baseAlpha: "0.300",
    glowAlpha: "0.000",
  };
}

function parseHexColor(value: string) {
  const normalized = sanitizeHexColor(value, "#000000");
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

function toHexColor({ r, g, b }: { r: number; g: number; b: number }) {
  return `#${[r, g, b]
    .map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function rgbToHsv({ r, g, b }: { r: number; g: number; b: number }) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  let hue = 0;
  if (delta !== 0) {
    if (max === red) {
      hue = ((green - blue) / delta) % 6;
    } else if (max === green) {
      hue = (blue - red) / delta + 2;
    } else {
      hue = (red - green) / delta + 4;
    }
  }

  return {
    h: ((hue * 60) + 360) % 360,
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

function hsvToRgb({ h, s, v }: { h: number; s: number; v: number }) {
  const hue = ((h % 360) + 360) % 360;
  const chroma = v * s;
  const section = hue / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  const match = v - chroma;

  let rgb = { r: 0, g: 0, b: 0 };

  if (section >= 0 && section < 1) {
    rgb = { r: chroma, g: x, b: 0 };
  } else if (section < 2) {
    rgb = { r: x, g: chroma, b: 0 };
  } else if (section < 3) {
    rgb = { r: 0, g: chroma, b: x };
  } else if (section < 4) {
    rgb = { r: 0, g: x, b: chroma };
  } else if (section < 5) {
    rgb = { r: x, g: 0, b: chroma };
  } else {
    rgb = { r: chroma, g: 0, b: x };
  }

  return {
    r: (rgb.r + match) * 255,
    g: (rgb.g + match) * 255,
    b: (rgb.b + match) * 255,
  };
}

function hsvToHexColor(hsv: { h: number; s: number; v: number }) {
  return toHexColor(hsvToRgb(hsv));
}

function mixHexColors(from: string, to: string, weight: number) {
  const left = parseHexColor(from);
  const right = parseHexColor(to);
  const ratio = clamp01(weight);

  return toHexColor({
    r: left.r + (right.r - left.r) * ratio,
    g: left.g + (right.g - left.g) * ratio,
    b: left.b + (right.b - left.b) * ratio,
  });
}

function withHexAlpha(color: string, alpha: number) {
  const { r, g, b } = parseHexColor(color);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha).toFixed(3)})`;
}

type ImmersiveArtworkSample = {
  color: string;
  x: number;
  y: number;
  weight: number;
};

export type ImmersiveArtworkPalette = {
  base: string;
  secondary: string;
  glow: string;
  edge: string;
  samples: ImmersiveArtworkSample[];
};

export function buildImmersiveFallbackPalette(appearance: AppSettings["appearance"]): ImmersiveArtworkPalette {
  const seed = getThemeSeed(appearance.themeMode, appearance);
  const base = mixHexColors(seed.primary, "#09111a", 0.7);
  const secondary = mixHexColors(seed.secondary, "#132031", 0.54);
  const glow = mixHexColors(seed.primary, "#ffffff", 0.24);
  const edge = mixHexColors(seed.surface, "#0a1018", appearance.colorScheme === "dark" ? 0.82 : 0.62);
  const samples: ImmersiveArtworkSample[] = [
    { color: seed.primary, x: 0.2, y: 0.22, weight: 0.92 },
    { color: mixHexColors(seed.primary, seed.secondary, 0.28), x: 0.74, y: 0.2, weight: 0.88 },
    { color: secondary, x: 0.52, y: 0.5, weight: 1 },
    { color: mixHexColors(seed.secondary, seed.surface, 0.22), x: 0.26, y: 0.76, weight: 0.86 },
    { color: glow, x: 0.76, y: 0.74, weight: 0.8 },
    { color: edge, x: 0.5, y: 0.9, weight: 0.72 },
  ];

  return {
    base,
    secondary,
    glow,
    edge,
    samples,
  };
}

function measureHexColorDistance(left: string, right: string) {
  const from = parseHexColor(left);
  const to = parseHexColor(right);
  return Math.hypot(from.r - to.r, from.g - to.g, from.b - to.b);
}

async function sampleImmersiveArtworkPalette(
  artworkUrl: string,
): Promise<ImmersiveArtworkPalette | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.crossOrigin = "anonymous";

    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const width = 40;
        const height = 40;
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });

        if (!context) {
          resolve(null);
          return;
        }

        context.drawImage(image, 0, 0, width, height);
        const { data } = context.getImageData(0, 0, width, height);
        const readPatch = (centerX: number, centerY: number, radius: number) => {
          let pixelCount = 0;
          let redTotal = 0;
          let greenTotal = 0;
          let blueTotal = 0;

          for (
            let y = Math.max(0, Math.floor(centerY - radius));
            y <= Math.min(height - 1, Math.ceil(centerY + radius));
            y += 1
          ) {
            for (
              let x = Math.max(0, Math.floor(centerX - radius));
              x <= Math.min(width - 1, Math.ceil(centerX + radius));
              x += 1
            ) {
              const deltaX = x - centerX;
              const deltaY = y - centerY;
              if ((deltaX * deltaX) + (deltaY * deltaY) > radius * radius) {
                continue;
              }

              const index = ((y * width) + x) * 4;
              const alpha = data[index + 3];
              if (alpha < 24) {
                continue;
              }

              redTotal += data[index];
              greenTotal += data[index + 1];
              blueTotal += data[index + 2];
              pixelCount += 1;
            }
          }

          if (!pixelCount) {
            return null;
          }

          const rgb = {
            r: redTotal / pixelCount,
            g: greenTotal / pixelCount,
            b: blueTotal / pixelCount,
          };
          const hsv = rgbToHsv(rgb);
          return {
            ...rgb,
            luminance: (0.2126 * rgb.r) + (0.7152 * rgb.g) + (0.0722 * rgb.b),
            saturation: hsv.s,
            brightness: hsv.v,
          };
        };

        const sampleAnchors: Array<Omit<ImmersiveArtworkSample, "color">> = [
          { x: 0.18, y: 0.2, weight: 0.88 },
          { x: 0.5, y: 0.18, weight: 0.84 },
          { x: 0.82, y: 0.22, weight: 0.88 },
          { x: 0.24, y: 0.48, weight: 0.94 },
          { x: 0.5, y: 0.5, weight: 1 },
          { x: 0.78, y: 0.5, weight: 0.94 },
          { x: 0.2, y: 0.8, weight: 0.86 },
          { x: 0.5, y: 0.82, weight: 0.82 },
          { x: 0.82, y: 0.78, weight: 0.86 },
        ];
        const patchRadius = Math.max(2.6, Math.round(Math.min(width, height) * 0.12));
        const candidates = sampleAnchors
          .map((anchor) => {
            const sample = readPatch(anchor.x * (width - 1), anchor.y * (height - 1), patchRadius);
            if (!sample) {
              return null;
            }

            return {
              color: toHexColor(sample),
              x: anchor.x,
              y: anchor.y,
              weight: anchor.weight,
              luminance: sample.luminance,
              saturation: sample.saturation,
              brightness: sample.brightness,
            };
          })
          .filter((sample): sample is ImmersiveArtworkSample & {
            luminance: number;
            saturation: number;
            brightness: number;
          } => sample !== null);

        if (!candidates.length) {
          resolve(null);
          return;
        }

        const byCenter = [...candidates].sort(
          (left, right) =>
            Math.hypot(left.x - 0.5, left.y - 0.5) - Math.hypot(right.x - 0.5, right.y - 0.5),
        );
        const centerSample = byCenter[0] ?? candidates[0];
        const brightestSample = [...candidates].sort((left, right) => right.luminance - left.luminance)[0] ?? centerSample;
        const darkestSample = [...candidates].sort((left, right) => left.luminance - right.luminance)[0] ?? centerSample;
        const vibrantSample = [...candidates].sort(
          (left, right) =>
            ((right.saturation * 0.78) + (right.weight * 0.22)) -
            ((left.saturation * 0.78) + (left.weight * 0.22)),
        )[0] ?? centerSample;

        const selectedSamples: ImmersiveArtworkSample[] = [];
        const pushSample = (sample: (typeof candidates)[number]) => {
          if (
            selectedSamples.some((entry) => measureHexColorDistance(entry.color, sample.color) < 26)
          ) {
            return;
          }
          selectedSamples.push({
            color: sample.color,
            x: sample.x,
            y: sample.y,
            weight: sample.weight,
          });
        };

        pushSample(centerSample);
        pushSample(vibrantSample);
        pushSample(brightestSample);
        pushSample(darkestSample);

        [...candidates]
          .sort(
            (left, right) =>
              ((right.saturation * 0.48) + (right.brightness * 0.18) + (right.weight * 0.34)) -
              ((left.saturation * 0.48) + (left.brightness * 0.18) + (left.weight * 0.34)),
          )
          .forEach((sample) => {
            if (selectedSamples.length < 6) {
              pushSample(sample);
            }
          });

        const samples = selectedSamples.length >= 4
          ? selectedSamples
          : candidates.slice(0, 6).map((sample) => ({
            color: sample.color,
            x: sample.x,
            y: sample.y,
            weight: sample.weight,
          }));

        resolve({
          base: centerSample.color,
          secondary: mixHexColors(vibrantSample.color, centerSample.color, 0.24),
          glow: mixHexColors(brightestSample.color, vibrantSample.color, 0.12),
          edge: mixHexColors(darkestSample.color, centerSample.color, 0.18),
          samples,
        });
      } catch (error) {
        console.error("[immersive-player] failed to sample artwork palette", error);
        resolve(null);
      }
    };

    image.onerror = () => resolve(null);
    image.src = artworkUrl;
  });
}

function findActiveLyricLineIndex(lines: NeteaseParsedLyricLine[], currentTimeMs: number) {
  let activeIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextLine = lines[index + 1];
    const lineEnd = line.endTimeMs > line.startTimeMs
      ? line.endTimeMs
      : nextLine?.startTimeMs ?? Number.POSITIVE_INFINITY;

    if (currentTimeMs >= line.startTimeMs && currentTimeMs < lineEnd) {
      return index;
    }

    if (currentTimeMs >= line.startTimeMs) {
      activeIndex = index;
    } else {
      break;
    }
  }

  return activeIndex;
}

function resolveLyricsTimelineTimeMs(options: {
  audioTimeMs: number;
  lyricsOffsetMs: number;
  delayMs: number;
  advanceMs?: number;
}) {
  return Math.max(
    0,
    options.audioTimeMs + options.lyricsOffsetMs - options.delayMs + (options.advanceMs ?? 0),
  );
}

function resolveProgressHoverLyricPreview(
  lines: NeteaseParsedLyricLine[],
  currentTimeMs: number,
) {
  if (lines.length === 0) {
    return null;
  }

  const activeIndex = findActiveLyricLineIndex(lines, currentTimeMs);
  if (activeIndex >= 0) {
    const activeLine = lines[activeIndex];
    const nextLine = lines[activeIndex + 1] ?? null;
    const activeLineLabel = resolveDynamicIslandLyricLine(lines, activeIndex);
    const activeLineEndTimeMs = resolveImmersiveLyricLineEndTime(activeLine, nextLine);
    const activeLineDurationMs = Math.max(1, activeLineEndTimeMs - activeLine.startTimeMs);

    return activeLineLabel
      ? {
          lyricLine: activeLineLabel,
          lineProgress: clamp01((currentTimeMs - activeLine.startTimeMs) / activeLineDurationMs),
        }
      : null;
  }

  for (const line of lines) {
    const candidate = line.text.trim();
    if (candidate) {
      return {
        lyricLine: candidate,
        lineProgress: 0,
      };
    }
  }

  return null;
}

function resolveDynamicIslandLyricLine(
  lines: NeteaseParsedLyricLine[],
  activeIndex: number,
) {
  if (activeIndex < 0 || activeIndex >= lines.length) {
    return null;
  }

  const activeLine = lines[activeIndex];
  const normalizedActiveText = activeLine?.text?.trim();
  if (normalizedActiveText) {
    return normalizedActiveText;
  }

  for (let index = activeIndex - 1; index >= 0; index -= 1) {
    const candidate = lines[index]?.text?.trim();
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

type ImmersiveLyricVisualItem =
  | {
      kind: "line";
      key: string;
      startTimeMs: number;
      endTimeMs: number;
      lineIndex: number;
      line: NeteaseParsedLyricLine;
    }
  | {
      kind: "interlude";
      key: string;
      startTimeMs: number;
      endTimeMs: number;
      durationMs: number;
      previousLineIndex: number;
      nextLineIndex: number;
    };

function resolveImmersiveLyricLineEndTime(
  line: NeteaseParsedLyricLine,
  nextLine: NeteaseParsedLyricLine | null,
) {
  return line.endTimeMs > line.startTimeMs
    ? line.endTimeMs
    : nextLine?.startTimeMs ?? Number.POSITIVE_INFINITY;
}

function buildImmersiveLyricVisualItems(lines: NeteaseParsedLyricLine[]) {
  const items: ImmersiveLyricVisualItem[] = [];

  const firstLine = lines[0] ?? null;
  if (firstLine && firstLine.startTimeMs >= IMMERSIVE_LYRIC_INTERLUDE_THRESHOLD_MS) {
    items.push({
      kind: "interlude",
      key: `interlude:intro:0:${firstLine.startTimeMs}`,
      startTimeMs: 0,
      endTimeMs: firstLine.startTimeMs,
      durationMs: firstLine.startTimeMs,
      previousLineIndex: -1,
      nextLineIndex: 0,
    });
  }

  lines.forEach((line, index) => {
    const nextLine = lines[index + 1] ?? null;
    const resolvedLineEndTimeMs = resolveImmersiveLyricLineEndTime(line, nextLine);

    items.push({
      kind: "line",
      key: `line:${line.startTimeMs}:${index}`,
      startTimeMs: line.startTimeMs,
      endTimeMs: resolvedLineEndTimeMs,
      lineIndex: index,
      line,
    });

    if (!nextLine) {
      return;
    }

    const gapStartTimeMs = Math.min(resolvedLineEndTimeMs, nextLine.startTimeMs);
    const gapDurationMs = nextLine.startTimeMs - gapStartTimeMs;

    if (gapDurationMs < IMMERSIVE_LYRIC_INTERLUDE_THRESHOLD_MS) {
      return;
    }

    items.push({
      kind: "interlude",
      key: `interlude:${gapStartTimeMs}:${nextLine.startTimeMs}:${index}`,
      startTimeMs: gapStartTimeMs,
      endTimeMs: nextLine.startTimeMs,
      durationMs: gapDurationMs,
      previousLineIndex: index,
      nextLineIndex: index + 1,
    });
  });

  return items;
}

function findActiveImmersiveLyricVisualItemIndex(
  items: ImmersiveLyricVisualItem[],
  currentTimeMs: number,
) {
  let activeIndex = -1;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const itemEndTimeMs = item.endTimeMs > item.startTimeMs ? item.endTimeMs : Number.POSITIVE_INFINITY;

    if (currentTimeMs >= item.startTimeMs && currentTimeMs < itemEndTimeMs) {
      return index;
    }

    if (currentTimeMs >= item.startTimeMs) {
      activeIndex = index;
    } else {
      break;
    }
  }

  return activeIndex;
}

function buildImmersiveLyricCenterOffsets(options: {
  items: ImmersiveLyricVisualItem[];
  anchorIndex: number;
  lineGap: number;
  getItemHeight: (item: ImmersiveLyricVisualItem) => number;
}) {
  if (options.items.length === 0) {
    return [] as number[];
  }

  const heights = options.items.map((item) => options.getItemHeight(item));
  const offsets = new Array<number>(options.items.length).fill(0);
  const resolvedAnchorIndex = Math.max(0, Math.min(options.anchorIndex, options.items.length - 1));

  for (let index = resolvedAnchorIndex + 1; index < options.items.length; index += 1) {
    offsets[index] =
      offsets[index - 1] + (heights[index - 1] + heights[index]) / 2 + options.lineGap;
  }

  for (let index = resolvedAnchorIndex - 1; index >= 0; index -= 1) {
    offsets[index] =
      offsets[index + 1] - ((heights[index + 1] + heights[index]) / 2 + options.lineGap);
  }

  return offsets;
}

function getThemeSeed(themeMode: string, appearance: AppSettings["appearance"]): ThemeSeed {
  if (themeMode === "custom") {
    return {
      primary: sanitizeHexColor(appearance.customThemePrimary, "#7aa2d6"),
      secondary: sanitizeHexColor(appearance.customThemeSecondary, "#b7d7f2"),
      surface: sanitizeHexColor(appearance.customThemeSurface, "#eef3fa"),
    };
  }

  return THEME_PRESETS[themeMode as keyof typeof THEME_PRESETS] ?? THEME_PRESETS["celia-default"];
}

function buildArtworkThemeSeed(
  palette: ImmersiveArtworkPalette,
  colorScheme: AppSettings["appearance"]["colorScheme"],
): ThemeSeed {
  if (colorScheme === "dark") {
    return {
      primary: sanitizeHexColor(
        mixHexColors(palette.base, mixHexColors(palette.glow, "#ffffff", 0.22), 0.24),
        "#9bc2df",
      ),
      secondary: sanitizeHexColor(
        mixHexColors(palette.secondary, mixHexColors(palette.glow, "#ffffff", 0.34), 0.22),
        "#d7e7f6",
      ),
      surface: sanitizeHexColor(mixHexColors(palette.edge, "#101824", 0.58), "#101824"),
    };
  }

  return {
    primary: sanitizeHexColor(
      mixHexColors(palette.base, mixHexColors(palette.edge, "#162230", 0.46), 0.34),
      "#4f6f98",
    ),
    secondary: sanitizeHexColor(
      mixHexColors(palette.secondary, mixHexColors(palette.edge, "#24364c", 0.28), 0.26),
      "#7f9dbf",
    ),
    surface: sanitizeHexColor(mixHexColors(palette.glow, "#f4f8fe", 0.82), "#eef3fa"),
  };
}

function resolveBackgroundImageStyle(path: string) {
  if (getBackgroundMediaKind(path) !== "image") {
    return "none";
  }

  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return "none";
  }

  try {
    return `url("${convertFileSrc(trimmedPath)}")`;
  } catch (error) {
    console.error("[theme] failed to resolve background image", error);
    return "none";
  }
}

function resolveBackgroundMediaSrc(path: string) {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return null;
  }

  try {
    return convertFileSrc(trimmedPath);
  } catch (error) {
    console.error("[theme] failed to resolve background media", error);
    return null;
  }
}

function getPathExtension(path: string) {
  const normalizedPath = path.trim().split(/[?#]/)[0] ?? "";
  const lastSegment = normalizedPath.split(/[\\/]/).pop() ?? "";
  const extension = lastSegment.includes(".")
    ? lastSegment.slice(lastSegment.lastIndexOf(".") + 1).toLowerCase()
    : "";
  return extension;
}

function getBackgroundMediaKind(path: string): "none" | "image" | "video" {
  const extension = getPathExtension(path);
  if (!extension) {
    return "none";
  }

  if ((BACKGROUND_IMAGE_EXTENSIONS as readonly string[]).includes(extension)) {
    return "image";
  }

  if ((BACKGROUND_VIDEO_EXTENSIONS as readonly string[]).includes(extension)) {
    return "video";
  }

  return "none";
}

function buildThemeStyle(
  appearance: AppSettings["appearance"],
  backgroundImageStyle = "none",
  backgroundMediaKind: "none" | "image" | "video" = "none",
  themeSeedOverride?: ThemeSeed | null,
) {
  const themeMode = appearance.themeMode as ThemePresetId;
  const colorScheme = appearance.colorScheme === "dark" ? "dark" : "light";
  const backgroundMode = appearance.backgroundMode ?? "theme";
  const seed = themeSeedOverride ?? getThemeSeed(themeMode, appearance);
  const accent = seed.primary;
  const accentSoft = seed.secondary;
  const surface = seed.surface;
  const backgroundBlur = Math.min(48, Math.max(0, appearance.backgroundBlur ?? 18));
  const componentBackdropBlur = Math.min(32, Math.max(0, appearance.componentBackdropBlur ?? 14));
  const componentBlurRatio = clamp01(componentBackdropBlur / 32);
  const backgroundDim = clamp01((appearance.backgroundDim ?? 18) / 100);
  const backgroundImageOpacity = clamp01((appearance.backgroundImageOpacity ?? 82) / 100);
  const hasCustomBackground = backgroundMode === "custom" && backgroundMediaKind !== "none";
  const panelBackdropBlur = `${Math.max(0, Math.round(componentBackdropBlur * 1.18))}px`;
  const cardBackdropBlur = `${Math.max(0, Math.round(componentBackdropBlur * 0.98))}px`;
  const overlayBackdropBlur = `${Math.max(8, Math.round(componentBackdropBlur * 0.7))}px`;
  const appFontFamily = buildConfiguredFontFamilyValue(appearance.fontFamily ?? "system-ui");
  const appFontWeight = clampNumber(appearance.fontWeight ?? 400, 100, 900);

  if (colorScheme === "dark") {
    const surfaceBg = mixHexColors(surface, "#0a1018", 0.84);
    const surfaceBgSoft = withHexAlpha(mixHexColors(surface, "#121b26", 0.8), 0.92);
    const paneBg = withHexAlpha(mixHexColors(surface, "#0f1722", 0.78), 0.95);
    const paneBgSoft = withHexAlpha(mixHexColors(surface, "#131d2a", 0.74), 0.92);
    const paneBgElevated = withHexAlpha(mixHexColors(surface, "#16212e", 0.68), 0.97);
    const panelBg = withHexAlpha(
      mixHexColors(surface, "#111a24", 0.76),
      0.78 - (componentBlurRatio * 0.12),
    );
    const panelBgStrong = withHexAlpha(
      mixHexColors(surface, "#162230", 0.72),
      0.88 - (componentBlurRatio * 0.14),
    );
    const panelBgSoft = withHexAlpha(
      mixHexColors(surface, "#182330", 0.7),
      0.74 - (componentBlurRatio * 0.12),
    );
    const textPrimary = "#e7eef9";
    const textSecondary = mixHexColors(accent, "#b8c3d5", 0.9);
    const textMuted = mixHexColors(accent, "#93a1b8", 0.9);
    const textStrong = mixHexColors(accent, "#dde6f3", 0.94);
    const accentStrong = mixHexColors(accent, "#ffffff", 0.14);

    const style = {
      "--surface-bg": surfaceBg,
      "--surface-bg-soft": surfaceBgSoft,
      "--app-pane-bg": paneBg,
      "--app-pane-bg-soft": paneBgSoft,
      "--app-pane-bg-elevated": paneBgElevated,
      "--sidebar-bg": `linear-gradient(180deg, ${paneBgSoft}, ${paneBg})`,
      "--panel-bg": panelBg,
      "--panel-bg-strong": panelBgStrong,
      "--panel-bg-soft": panelBgSoft,
      "--panel-border": withHexAlpha(accentSoft, 0.16),
      "--panel-border-strong": withHexAlpha(accentSoft, 0.24),
      "--panel-border-accent": withHexAlpha(accent, 0.32),
      "--text-primary": textPrimary,
      "--text-secondary": textSecondary,
      "--text-muted": textMuted,
      "--text-strong": textStrong,
      "--accent": accent,
      "--accent-strong": accentStrong,
      "--accent-soft": accentSoft,
      "--accent-surface": withHexAlpha(accent, 0.16),
      "--accent-surface-strong": withHexAlpha(accent, 0.24),
      "--accent-ring": withHexAlpha(accentSoft, 0.28),
      "--track-bg": withHexAlpha(mixHexColors(accentSoft, surface, 0.5), 0.26),
      "--timeline-fill": `linear-gradient(90deg, ${accent}, ${accentSoft})`,
      "--playbar-bg": paneBgElevated,
      "--thumb-bg": withHexAlpha(mixHexColors(surface, accentSoft, 0.36), 0.32),
      "--dynamic-island-bg": withHexAlpha(mixHexColors(accent, "#06090f", 0.8), 0.96),
      "--dynamic-island-bg-hover": withHexAlpha(mixHexColors(accent, "#0a0f17", 0.72), 0.98),
      "--dynamic-island-dot": accentSoft,
      "--app-font-family": appFontFamily,
      "--app-font-weight": `${appFontWeight}`,
      "--app-shell-surface-bg": paneBg,
      "--app-shell-base-pane-bg": "var(--app-pane-bg)",
      "--app-background-image": "none",
      "--app-background-opacity": "0",
      "--app-background-blur": "0px",
      "--app-background-dim-opacity": "0",
      "--app-component-backdrop-blur": `${componentBackdropBlur}px`,
      "--app-panel-backdrop-blur": panelBackdropBlur,
      "--app-card-backdrop-blur": cardBackdropBlur,
      "--app-overlay-backdrop-blur": overlayBackdropBlur,
    } as CSSProperties;

    if (backgroundMode === "theme") {
      return style;
    }

    return {
      ...style,
      "--surface-bg": withHexAlpha(mixHexColors(surface, "#071019", 0.82), 0.18),
      "--surface-bg-soft": withHexAlpha(mixHexColors(surface, "#0f1722", 0.8), 0.16),
      "--app-pane-bg": withHexAlpha(mixHexColors(surface, "#101925", 0.78), 0.18),
      "--app-pane-bg-soft": withHexAlpha(mixHexColors(surface, "#13202d", 0.76), 0.14),
      "--app-pane-bg-elevated": withHexAlpha(mixHexColors(surface, "#152230", 0.72), 0.28),
      "--sidebar-bg": "linear-gradient(180deg, var(--app-pane-bg-soft), var(--app-pane-bg))",
      "--panel-bg": withHexAlpha(
        mixHexColors(surface, "#111822", 0.74),
        Math.max(0.18, 0.3 - (componentBlurRatio * 0.08)),
      ),
      "--panel-bg-strong": withHexAlpha(
        mixHexColors(surface, "#17212d", 0.68),
        Math.max(0.24, 0.42 - (componentBlurRatio * 0.1)),
      ),
      "--panel-bg-soft": withHexAlpha(
        mixHexColors(surface, "#182432", 0.7),
        Math.max(0.14, 0.24 - (componentBlurRatio * 0.08)),
      ),
      "--playbar-bg": "var(--app-pane-bg-elevated)",
      "--thumb-bg": withHexAlpha(mixHexColors(surface, accentSoft, 0.34), 0.28),
      "--app-shell-surface-bg": "transparent",
      "--app-shell-base-pane-bg": hasCustomBackground ? "transparent" : "var(--app-pane-bg)",
      "--app-background-image":
        hasCustomBackground && backgroundMediaKind === "image" ? backgroundImageStyle : "none",
      "--app-background-opacity": hasCustomBackground ? String(backgroundImageOpacity) : "0",
      "--app-background-blur": hasCustomBackground ? `${backgroundBlur}px` : "0px",
      "--app-background-dim-opacity": String(backgroundDim),
      "--app-component-backdrop-blur": `${componentBackdropBlur}px`,
      "--app-panel-backdrop-blur": panelBackdropBlur,
      "--app-card-backdrop-blur": cardBackdropBlur,
      "--app-overlay-backdrop-blur": overlayBackdropBlur,
    } as CSSProperties;
  }

  const accentStrong = mixHexColors(accent, "#20324d", 0.28);
  const paneBg = withHexAlpha(mixHexColors(surface, "#f7faff", 0.62), 0.98);
  const paneBgSoft = withHexAlpha(mixHexColors(surface, "#f4f8fd", 0.56), 0.96);
  const paneBgElevated = withHexAlpha(mixHexColors(surface, "#ffffff", 0.82), 0.99);
  const style = {
    "--surface-bg": mixHexColors(surface, "#f6f9fe", 0.46),
    "--surface-bg-soft": withHexAlpha(mixHexColors(surface, "#ffffff", 0.78), 0.92),
    "--app-pane-bg": paneBg,
    "--app-pane-bg-soft": paneBgSoft,
    "--app-pane-bg-elevated": paneBgElevated,
    "--sidebar-bg": `linear-gradient(180deg, ${paneBgSoft}, ${paneBg})`,
    "--panel-bg": withHexAlpha(
      mixHexColors(surface, "#ffffff", 0.8),
      0.84 - (componentBlurRatio * 0.12),
    ),
    "--panel-bg-strong": withHexAlpha(
      mixHexColors(surface, "#ffffff", 0.9),
      0.93 - (componentBlurRatio * 0.12),
    ),
    "--panel-bg-soft": withHexAlpha(
      mixHexColors(surface, "#f7faff", 0.62),
      0.86 - (componentBlurRatio * 0.12),
    ),
    "--panel-border": withHexAlpha(accent, 0.14),
    "--panel-border-strong": withHexAlpha(accent, 0.2),
    "--panel-border-accent": withHexAlpha(accent, 0.28),
    "--text-primary": "#1b2340",
    "--text-secondary": mixHexColors(accent, "#6f7988", 0.88),
    "--text-muted": mixHexColors(accent, "#7f8897", 0.9),
    "--text-strong": mixHexColors(accent, "#374252", 0.72),
    "--accent": accent,
    "--accent-strong": accentStrong,
    "--accent-soft": accentSoft,
    "--accent-surface": withHexAlpha(accent, 0.08),
    "--accent-surface-strong": withHexAlpha(accent, 0.14),
    "--accent-ring": withHexAlpha(accentSoft, 0.24),
    "--track-bg": withHexAlpha(mixHexColors(accentSoft, surface, 0.56), 0.54),
    "--timeline-fill": `linear-gradient(90deg, ${accent}, ${accentSoft})`,
    "--playbar-bg": paneBgElevated,
    "--thumb-bg": withHexAlpha(mixHexColors(surface, accentSoft, 0.26), 0.72),
    "--dynamic-island-bg": withHexAlpha(mixHexColors(accent, "#0c1320", 0.78), 0.96),
    "--dynamic-island-bg-hover": withHexAlpha(mixHexColors(accent, "#101a29", 0.72), 0.98),
    "--dynamic-island-dot": accentSoft,
    "--app-font-family": appFontFamily,
    "--app-font-weight": `${appFontWeight}`,
    "--app-shell-surface-bg": paneBg,
    "--app-shell-base-pane-bg": "var(--app-pane-bg)",
    "--app-background-image": "none",
    "--app-background-opacity": "0",
    "--app-background-blur": "0px",
    "--app-background-dim-opacity": "0",
    "--app-component-backdrop-blur": `${componentBackdropBlur}px`,
    "--app-panel-backdrop-blur": panelBackdropBlur,
    "--app-card-backdrop-blur": cardBackdropBlur,
    "--app-overlay-backdrop-blur": overlayBackdropBlur,
  } as CSSProperties;

  if (backgroundMode === "theme") {
    return style;
  }

  return {
    ...style,
    "--surface-bg": withHexAlpha(mixHexColors(surface, "#ffffff", 0.8), 0.14),
    "--surface-bg-soft": withHexAlpha(mixHexColors(surface, "#ffffff", 0.86), 0.08),
    "--app-pane-bg": withHexAlpha(mixHexColors(surface, "#ffffff", 0.82), 0.18),
    "--app-pane-bg-soft": withHexAlpha(mixHexColors(surface, "#f8fbff", 0.78), 0.14),
    "--app-pane-bg-elevated": withHexAlpha(mixHexColors(surface, "#ffffff", 0.88), 0.3),
    "--sidebar-bg": "linear-gradient(180deg, var(--app-pane-bg-soft), var(--app-pane-bg))",
    "--panel-bg": withHexAlpha(
      mixHexColors(surface, "#ffffff", 0.82),
      Math.max(0.18, 0.34 - (componentBlurRatio * 0.08)),
    ),
    "--panel-bg-strong": withHexAlpha(
      mixHexColors(surface, "#ffffff", 0.92),
      Math.max(0.22, 0.46 - (componentBlurRatio * 0.1)),
    ),
    "--panel-bg-soft": withHexAlpha(
      mixHexColors(surface, "#f6f9fe", 0.7),
      Math.max(0.12, 0.22 - (componentBlurRatio * 0.08)),
    ),
    "--playbar-bg": "var(--app-pane-bg-elevated)",
    "--thumb-bg": withHexAlpha(mixHexColors(surface, accentSoft, 0.24), 0.48),
    "--app-shell-surface-bg": "transparent",
    "--app-shell-base-pane-bg": hasCustomBackground ? "transparent" : "var(--app-pane-bg)",
    "--app-background-image":
      hasCustomBackground && backgroundMediaKind === "image" ? backgroundImageStyle : "none",
    "--app-background-opacity": hasCustomBackground ? String(backgroundImageOpacity) : "0",
    "--app-background-blur": hasCustomBackground ? `${backgroundBlur}px` : "0px",
    "--app-background-dim-opacity": String(backgroundDim),
    "--app-component-backdrop-blur": `${componentBackdropBlur}px`,
    "--app-panel-backdrop-blur": panelBackdropBlur,
    "--app-card-backdrop-blur": cardBackdropBlur,
    "--app-overlay-backdrop-blur": overlayBackdropBlur,
  } as CSSProperties;
}

type NavId = (typeof navItemIds)[number];
type PlaylistSelection = {
  id: number;
  title: string;
} | null;
type AppNavigationSnapshot = {
  activeNav: NavId;
  libraryView: LibraryView;
  selectedPlaylist: PlaylistSelection;
};
type LibraryNavigationRequest =
  | {
      target: "artist" | "album";
      name: string;
      key: number;
    }
  | null;
type ExploreDetailRequest =
  | {
      kind: "artist" | "album";
      id: number;
      name: string;
      key: number;
    }
  | null;
type KugouImportLogEntry = {
  sourceIndex: number;
  trackTitle: string;
  artistLabel: string;
  status: "matched" | "skipped" | "duplicate" | "failed";
  detail: string;
};
type KugouImportPhase = "idle" | "running" | "completed";
type KugouImportConfig = {
  errorRetryCount: number;
  unresolvedRetryCount: number;
  timeoutMs: number;
  concurrency: number;
  matchStrictness: KugouTrackMatchStrictness;
};
type KugouManualRetryState = {
  entry: KugouImportLogEntry;
  sourceTrack: ParsedKugouPlaylistTrack;
  playlistId: number;
};
type NeteaseHomeFeedCacheEntry = {
  account: NeteaseAccountProfile | null;
  guestSongs: NeteaseSongDetail[];
  dailySongs: NeteaseSongDetail[];
  personalFmSongs: NeteaseSongDetail[];
  likedPlaylist: NeteasePlaylistRecommendation | null;
  dailyPlaylists: NeteasePlaylistRecommendation[];
  guessPlaylists: NeteasePlaylistRecommendation[];
  recommendedDjs: NeteaseDjRecommendation[];
};
type PlaybackQueueKind = "standard" | "personal-fm" | "intelligence";
type NeteasePlaylistLibraryCacheEntry = {
  account: NeteaseAccountProfile | null;
  userPlaylists: NeteasePlaylistRecommendation[];
};
type SongContextTarget =
  | {
      kind: "track";
      track: TrackRecord;
      queueTracks: TrackRecord[];
    }
  | {
      kind: "netease";
      song: NeteaseSongDetail;
      queueSongs: NeteaseSongDetail[];
    };
type ContextMenuTarget =
  | {
      kind: "blank";
    }
  | {
      kind: "song";
      payload: SongContextTarget;
    }
  | {
      kind: "playlist";
      playlist: NeteasePlaylistRecommendation;
    };
type ContextMenuState = {
  x: number;
  y: number;
  target: ContextMenuTarget;
};
type ContextMenuItemDefinition = {
  id: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  artworkUrl?: string | null;
  submenu?: ContextMenuItemDefinition[];
  onSelect?: () => void;
};
type PlaylistEditorState =
  | {
      mode: "create";
      playlist: null;
    }
  | {
      mode: "edit";
      playlist: NeteasePlaylistRecommendation;
    };
type LibraryView =
  | "hub"
  | "import"
  | "songs"
  | "artists"
  | "albums"
  | "artistSongs"
  | "albumSongs";
type ToolsView = "hub" | "kugouImport";

const neteaseHomeFeedCache = new Map<string, NeteaseHomeFeedCacheEntry>();
const neteasePlaylistLibraryCache = new Map<string, NeteasePlaylistLibraryCacheEntry>();
const neteasePlaylistDetailCache = new Map<string, NeteasePlaylistRecommendation | null>();
const neteasePlaylistTracksCache = new Map<string, NeteaseSongDetail[]>();
const neteaseArtistAvatarCache = new Map<string, string | null>();

function getContextMenuCopy(locale: string) {
  if (locale === "en-US") {
    return {
      refresh: "Refresh Page",
      addToQueue: "Add to Queue",
      playNext: "Play Next",
      startIntelligenceMode: "Start Heart Mode",
      likeSong: "Like Song",
      addToPlaylist: "Add to Playlist",
      removeFromCurrentPlaylist: "Remove from Playlist",
      loadingPlaylists: "Loading playlists...",
      noAvailablePlaylist: "No available playlist",
      loginRequired: "Login required",
      subscribePlaylist: "Save Playlist",
      unsubscribePlaylist: "Remove Saved Playlist",
      ownPlaylist: "Your Playlist",
      deletePlaylist: "Delete Playlist",
      editPlaylist: "Edit Playlist",
      submenuArrow: "Open submenu",
    };
  }

  return {
    refresh: "刷新页面",
    addToQueue: "添加到播放列表",
    playNext: "下一首播放",
    startIntelligenceMode: "开启心动模式",
    likeSong: "收藏歌曲",
    addToPlaylist: "添加到歌单",
    removeFromCurrentPlaylist: "从歌单删除",
    loadingPlaylists: "正在加载歌单...",
    noAvailablePlaylist: "没有可用歌单",
    loginRequired: "需要先登录网易云",
    subscribePlaylist: "收藏歌单",
    unsubscribePlaylist: "取消收藏歌单",
    ownPlaylist: "我的歌单",
    deletePlaylist: "删除歌单",
    editPlaylist: "编辑歌单",
    submenuArrow: "打开子菜单",
  };
}

function buildNeteaseCacheKey(settings: AppSettings, scope: string) {
  const baseUrl = settings.network.neteaseApiBaseUrl.trim().toLowerCase() || "default";
  const cookie = settings.network.neteaseCookie.trim() || "guest";
  return `${baseUrl}::${cookie}::${scope}`;
}

function dedupeNeteaseSongDetailsById(songs: NeteaseSongDetail[]) {
  return songs.reduce<NeteaseSongDetail[]>((collection, song) => {
    if (!collection.some((item) => item.id === song.id)) {
      collection.push(song);
    }

    return collection;
  }, []);
}

function getPlaylistBackLabel(
  locale: string,
  snapshot: AppNavigationSnapshot | null,
) {
  if (!snapshot) {
    return locale === "en-US" ? "Back to Playlists" : "返回歌单";
  }

  switch (snapshot.activeNav) {
    case "home":
      return locale === "en-US" ? "Back to Home" : "返回首页";
    case "explore":
      return locale === "en-US" ? "Back to Explore" : "返回探索";
    case "favorites":
      return locale === "en-US" ? "Back to Liked Songs" : "返回喜欢歌曲";
    case "tools":
      return locale === "en-US" ? "Back to Tools" : "返回工具";
    case "library":
      return locale === "en-US" ? "Back to Library" : "返回资料库";
    case "settings":
      return locale === "en-US" ? "Back to Settings" : "返回设置";
    case "playlist":
    default:
      return locale === "en-US" ? "Back to Playlists" : "返回歌单";
  }
}

function getLibraryBackLabel(locale: string, view: LibraryView) {
  switch (view) {
    case "import":
      return locale === "en-US" ? "Back to Import" : "返回导入";
    case "songs":
      return locale === "en-US" ? "Back to Songs" : "返回歌曲";
    case "artists":
      return locale === "en-US" ? "Back to Artists" : "返回歌手";
    case "albums":
      return locale === "en-US" ? "Back to Albums" : "返回专辑";
    case "artistSongs":
      return locale === "en-US" ? "Back to Artist List" : "返回歌手列表";
    case "albumSongs":
      return locale === "en-US" ? "Back to Album List" : "返回专辑列表";
    case "hub":
    default:
      return locale === "en-US" ? "Back to Library" : "返回资料库";
  }
}

export function getLocaleStrings(locale: string) {
  if (locale === "en-US") {
    return {
      window: {
        controls: "Window Controls",
        minimize: "Minimize Window",
        fullscreen: "Enter Fullscreen",
        exitFullscreen: "Exit Fullscreen",
        maximize: "Maximize Window",
        restore: "Restore Window",
        close: "Close Window",
        exitImmersive: "Exit Immersive Player",
        enableWallpaper: "Enable Wallpaper Mode",
        disableWallpaper: "Disable Wallpaper Mode",
      },
      notifications: {
        settingsLoadFailed: "Failed to load settings",
        libraryLoadFailed: "Failed to load library",
        playbackFailed: "Playback failed",
        trackUnavailable: "The current track cannot be played",
        trackUnsupported: "The current track is not supported yet",
        playbackRecovered: "Refreshed the streaming link and retried playback",
        playbackRestoreFailed: "Failed to restore the previous playback state",
        playbackPositionSaveFailed: "Failed to save playback position",
        importFailed: "Import failed",
        audioImportCompleted: "Audio import completed",
        folderImportCompleted: "Folder import completed",
        scanDirectoriesSaved: "Auto scan folder saved",
        scanDirectoriesSaveFailed: "Failed to save scan folder",
        volumeSaveFailed: "Failed to save volume",
        importTracksFirst: "Import songs first",
        settingsSaved: "Settings saved",
        settingsSaveFailed: "Failed to save settings",
        localApiServerStartFailed: "Failed to start the local Netease API server",
        settingsReset: "Default settings restored",
        settingsResetFailed: "Failed to restore default settings",
        memoryCacheReleased: "Released in-memory cache",
        memoryCacheReleaseFailed: "Failed to release in-memory cache",
        libraryCleared: "Library cleared",
        libraryClearFailed: "Failed to clear library",
        neteaseApiTestSuccess: "Netease API connected",
        neteaseApiTestFailed: "Failed to connect to Netease API",
        neteaseSourceDisabled: "Netease source is disabled",
        neteaseLoginSaved: "Netease login saved",
        neteaseLoginSaveFailed: "Failed to save Netease login",
        neteaseLoginCleared: "Netease login cleared",
        neteaseLoginClearFailed: "Failed to clear Netease login",
        contextSongQueued: "Added to queue",
        contextSongPlayNext: "Will play next",
        intelligenceModeStarted: "Heart Mode started",
        intelligenceModeFailed: "Failed to start Heart Mode",
        contextSongLiked: "Song saved to favorites",
        contextSongLikeFailed: "Failed to save the song",
        contextPlaylistAdded: "Added to playlist",
        contextPlaylistAddFailed: "Failed to add to playlist",
        contextPlaylistTrackRemoved: "Removed from playlist",
        contextPlaylistTrackRemoveFailed: "Failed to remove from playlist",
        contextPlaylistSubscribed: "Playlist saved",
        contextPlaylistSubscribeFailed: "Failed to save playlist",
        contextPlaylistUnsubscribed: "Playlist removed from saved",
        contextPlaylistUnsubscribeFailed: "Failed to remove saved playlist",
        contextPlaylistDeleted: "Playlist deleted",
        contextPlaylistDeleteFailed: "Failed to delete playlist",
        contextPlaylistCreated: "Playlist created",
        contextPlaylistCreateFailed: "Failed to create playlist",
        contextPlaylistUpdated: "Playlist updated",
        contextPlaylistUpdateFailed: "Failed to update playlist",
        contextLoginRequired: "Please log in to Netease first",
        contextPlaylistUnavailable: "No editable playlist is available",
        kugouImportCompleted: "Kugou playlist import completed",
        kugouImportFailed: "Failed to import the Kugou playlist",
        kugouImportInvalidFile: "The selected Kugou JSON file is invalid",
        wallpaperModeEnabled: "Wallpaper mode enabled",
        wallpaperModeDisabled: "Wallpaper mode disabled",
        wallpaperModeFailed: "Failed to enable wallpaper mode",
      },
      library: {
        entityArtist: "Artist",
        entityAlbum: "Album",
        artistAvatarSuffix: "avatar",
        albumCoverSuffix: "cover",
        trackCoverSuffix: "cover",
        artistSongsFallbackTitle: "Artist Songs",
        albumSongsFallbackTitle: "Album Songs",
        artistSongsDescription: "This page shows all songs for the current artist.",
        albumSongsDescription: "This page shows all songs for the current album.",
      },
    player: {
      idleTitle: "Not Playing Yet",
      idleArtist: "Celia Music Next Gen",
      controls: "Playback Controls",
      actions: "Additional Actions",
      volumeLabel: "Volume",
      loadingTrack: "Loading track...",
      restoringPlayback: "Trying to restore playback state...",
    },
  };
  }

  return {
    window: {
      controls: "窗口控制",
      minimize: "最小化窗口",
      fullscreen: "进入全屏",
      exitFullscreen: "退出全屏",
      maximize: "最大化窗口",
      restore: "还原窗口",
      close: "关闭窗口",
      exitImmersive: "退出沉浸播放",
      enableWallpaper: "开启壁纸模式",
      disableWallpaper: "关闭壁纸模式",
    },
    notifications: {
      settingsLoadFailed: "设置加载失败",
      libraryLoadFailed: "资料库加载失败",
      playbackFailed: "播放失败",
      trackUnavailable: "当前歌曲无法播放",
      trackUnsupported: "当前歌曲暂不支持播放",
      playbackRecovered: "已刷新播放链接并重新尝试播放",
      playbackRestoreFailed: "恢复上次播放状态失败",
      playbackPositionSaveFailed: "保存播放进度失败",
      importFailed: "导入失败",
      audioImportCompleted: "音频导入完成",
      folderImportCompleted: "文件夹导入完成",
      scanDirectoriesSaved: "已保存自动扫描目录",
      scanDirectoriesSaveFailed: "扫描目录保存失败",
      volumeSaveFailed: "音量保存失败",
      importTracksFirst: "请先导入歌曲",
      settingsSaved: "设置已保存",
      settingsSaveFailed: "设置保存失败",
      localApiServerStartFailed: "本地网易云 API 服务启动失败",
      settingsReset: "已恢复默认设置",
      settingsResetFailed: "恢复默认设置失败",
      memoryCacheReleased: "已释放内存缓存",
      memoryCacheReleaseFailed: "释放内存缓存失败",
      libraryCleared: "资料库已清除",
      libraryClearFailed: "清除资料库失败",
      neteaseApiTestSuccess: "网易云 API 连接成功",
      neteaseApiTestFailed: "网易云 API 连接失败",
      neteaseSourceDisabled: "网易云在线源已关闭",
      neteaseLoginSaved: "网易云登录已保存",
      neteaseLoginSaveFailed: "网易云登录保存失败",
      neteaseLoginCleared: "已退出网易云登录",
      neteaseLoginClearFailed: "退出网易云登录失败",
      contextSongQueued: "已添加到播放列表",
      contextSongPlayNext: "已设为下一首播放",
      intelligenceModeStarted: "已开启心动模式",
      intelligenceModeFailed: "开启心动模式失败",
      contextSongLiked: "歌曲已收藏",
      contextSongLikeFailed: "收藏歌曲失败",
      contextPlaylistAdded: "已添加到歌单",
      contextPlaylistAddFailed: "添加到歌单失败",
      contextPlaylistTrackRemoved: "已从歌单删除",
      contextPlaylistTrackRemoveFailed: "从歌单删除失败",
      contextPlaylistSubscribed: "歌单已收藏",
      contextPlaylistSubscribeFailed: "收藏歌单失败",
      contextPlaylistUnsubscribed: "已取消收藏歌单",
      contextPlaylistUnsubscribeFailed: "取消收藏歌单失败",
      contextPlaylistDeleted: "歌单已删除",
      contextPlaylistDeleteFailed: "删除歌单失败",
      contextPlaylistUpdated: "歌单已更新",
      contextPlaylistUpdateFailed: "更新歌单失败",
      contextLoginRequired: "请先登录网易云账号",
      contextPlaylistUnavailable: "当前没有可编辑的歌单",
      kugouImportCompleted: "酷狗歌单导入完成",
      kugouImportFailed: "酷狗歌单导入失败",
      kugouImportInvalidFile: "所选酷狗 JSON 文件无效",
      wallpaperModeEnabled: "已开启壁纸模式",
      wallpaperModeDisabled: "已关闭壁纸模式",
      wallpaperModeFailed: "开启壁纸模式失败",
    },
    library: {
      entityArtist: "歌手",
      entityAlbum: "专辑",
      artistAvatarSuffix: "头像",
      albumCoverSuffix: "封面",
      trackCoverSuffix: "封面",
      artistSongsFallbackTitle: "歌手歌曲",
      albumSongsFallbackTitle: "专辑歌曲",
      artistSongsDescription: "这里展示当前歌手名下的全部歌曲。",
      albumSongsDescription: "这里展示当前专辑名下的全部歌曲。",
    },
    player: {
      idleTitle: "未开始播放",
      idleArtist: "Celia Music Next Gen",
      controls: "播放控制",
      actions: "附加操作",
      volumeLabel: "音量",
      loadingTrack: "正在加载歌曲...",
      restoringPlayback: "正在尝试恢复播放状态",
    },
  };
}

function getHomeCopy(locale: string) {
  if (locale === "en-US") {
    return {
      eyebrow: "Home",
      titleLoggedOut: "Offline Home",
      titleLoggedIn: "Welcome Back",
      descriptionLoggedOut: "Browse your local library and recommendations here.",
      descriptionLoggedIn: "Browse recommendations and your library overview here.",
      sourceOffline: "Offline Library",
      sourceOnline: "Netease Cloud",
      statsTracks: "Songs",
      statsLocalTracks: "Local Files",
      statsArtists: "Artists",
      statsAlbums: "Albums",
      statsRemoteTracks: "Online Tracks",
      quickLibrary: "Open Library",
      quickImport: "Import Music",
      sectionOfflinePicks: "Offline Picks",
      sectionRecommendedSongs: "Recommended Songs",
      sectionDailySongs: "Daily Songs",
      sectionPersonalFm: "Private FM",
      sectionDailyPlaylists: "Daily Playlists",
      sectionOnlinePlaylists: "Online Playlists",
      sectionDj: "Radio Picks",
      sectionGuess: "You May Like",
      personalFmHint: "Lean-back recommendations that keep extending before the queue runs out.",
      startPersonalFm: "Start FM",
      refreshPersonalFm: "Refresh",
      refreshingPersonalFm: "Refreshing...",
      loadingPersonalFm: "Loading private FM...",
      personalFmLoadFailed: "Failed to load private FM.",
      emptyLibrary: "No songs in the library yet.",
      emptyOnline: "No online recommendations available yet.",
      loading: "Loading home content...",
      loadingOnline: "Loading online recommendations...",
      loadingAccount: "Loading account status...",
      unavailableOnline: "Enable the Netease source to load online recommendations.",
      accountUnavailable: "Log in to Netease Cloud Music to unlock daily content.",
      accountLoadFailed: "Failed to load account information.",
      loadFailed: "Failed to load the home feed.",
      playNow: "Play",
      creatorPrefix: "By",
      djPrefix: "Host",
      openPlaylist: "Open Playlist",
      localFileTag: "Local",
      onlineTag: "Online",
      dailyTag: "Daily",
      fmTag: "FM",
      remoteCountSuffix: "online",
      playlistCountSuffix: "tracks",
      radioCountSuffix: "episodes",
      playCountSuffix: "plays",
    };
  }

  return {
    eyebrow: "首页",
    titleLoggedOut: "离线主页",
    titleLoggedIn: "欢迎回来",
    descriptionLoggedOut: "在这里查看本地资料库和推荐内容。",
    descriptionLoggedIn: "在这里查看推荐内容和资料库概况。",
    sourceOffline: "离线资料库",
    sourceOnline: "网易云音乐",
    statsTracks: "歌曲总数",
    statsLocalTracks: "本地文件",
    statsArtists: "歌手数量",
    statsAlbums: "专辑数量",
    statsRemoteTracks: "在线歌曲",
    quickLibrary: "打开资料库",
    quickImport: "去导入音乐",
    sectionOfflinePicks: "离线推荐",
    sectionRecommendedSongs: "推荐歌曲",
    sectionDailySongs: "每日推荐",
    sectionPersonalFm: "私人 FM",
    sectionDailyPlaylists: "日推歌单",
    sectionOnlinePlaylists: "在线歌单",
    sectionDj: "推荐电台",
    sectionGuess: "猜你喜欢",
    personalFmHint: "根据你的喜好连续推荐，播放到队尾前会自动补新歌。",
    startPersonalFm: "开始 FM",
    refreshPersonalFm: "换一批",
    refreshingPersonalFm: "刷新中...",
    loadingPersonalFm: "正在加载私人 FM...",
    personalFmLoadFailed: "私人 FM 加载失败。",
    emptyLibrary: "资料库里还没有歌曲，先导入一些音乐吧。",
    emptyOnline: "暂时还没有可展示的在线推荐内容。",
    loading: "正在加载首页内容...",
    loadingOnline: "正在加载在线推荐...",
    loadingAccount: "正在检查登录状态...",
    unavailableOnline: "请先启用网易云在线源，才能加载在线推荐内容。",
    accountUnavailable: "登录网易云音乐后，这里会显示日推、喜欢歌曲、私人 FM 和电台内容。",
    accountLoadFailed: "账号信息加载失败。",
    loadFailed: "首页内容加载失败。",
    playNow: "播放",
    creatorPrefix: "创建者",
    djPrefix: "主播",
    openPlaylist: "打开歌单",
    localFileTag: "本地",
    onlineTag: "在线",
    dailyTag: "日推",
    fmTag: "FM",
    remoteCountSuffix: "首在线歌曲",
    playlistCountSuffix: "首歌曲",
    radioCountSuffix: "期节目",
    playCountSuffix: "次播放",
  };
}

function getPlaylistCopy(locale: string) {
  if (locale === "en-US") {
    return {
      eyebrow: "Playlist",
      title: "My Playlists",
      description: "Browse and open your playlists here.",
      userSection: "Your Playlists",
      dailySection: "Daily Playlists",
      recommendSection: "Recommended Playlists",
      detailTitle: "Playlist Details",
      detailDescription: "Open a playlist to browse all songs and start playback from any track.",
      browseTitle: "Playlist Browser",
      browseDescription: "Select a playlist to open its details page and browse songs by page.",
      backToBrowse: "Back to Browser",
      pageLabel: "Page",
      prevPage: "Previous",
      nextPage: "Next",
      empty: "No playlists available yet.",
      loading: "Loading playlists...",
      loadingTracks: "Loading playlist tracks...",
      startIntelligenceMode: "Heart Mode",
      emptyTracks: "This playlist has no available songs yet.",
      notLoggedIn: "Log in to Netease Cloud Music to view your playlists.",
      notEnabled: "Enable the Netease source to load playlist content.",
      ownerPrefix: "By",
      countSuffix: "tracks",
      openSuffix: "Open",
    };
  }

  return {
    eyebrow: "歌单",
    title: "我的歌单",
    description: "在这里查看和打开你的歌单。",
    userSection: "你的歌单",
    dailySection: "每日推荐歌单",
    recommendSection: "推荐歌单",
    detailTitle: "歌单详情",
    detailDescription: "选择一个歌单后，这里会显示完整歌曲列表，并可以从任意歌曲开始播放。",
    browseTitle: "歌单浏览",
    browseDescription: "先浏览歌单列表，点击任意歌单后进入详情页查看信息和分页歌曲。",
    backToBrowse: "返回歌单浏览",
    pageLabel: "第",
    prevPage: "上一页",
    nextPage: "下一页",
    empty: "暂时还没有可显示的歌单。",
    loading: "正在加载歌单...",
    loadingTracks: "正在加载歌单歌曲...",
    startIntelligenceMode: "心动模式",
    emptyTracks: "这个歌单里暂时没有可显示的歌曲。",
    notLoggedIn: "登录网易云音乐后，这里会显示你的歌单内容。",
    notEnabled: "请先启用网易云在线源，再加载歌单内容。",
    ownerPrefix: "创建者",
    countSuffix: "首歌曲",
    openSuffix: "打开",
  };
}

function getLikedSongsCopy(locale: string) {
  if (locale === "en-US") {
    return {
      eyebrow: "Liked Songs",
      title: "Liked Songs",
      description: "Browse the songs you have saved here.",
      detailTitle: "Liked Songs",
      detailDescription: "This page shows all tracks in your liked playlist.",
      loading: "Loading liked songs...",
      loadingTracks: "Loading liked songs...",
      startIntelligenceMode: "Heart Mode",
      empty: "No liked songs are available yet.",
      emptyTracks: "No songs are available in the liked playlist yet.",
      notLoggedIn: "Log in to Netease Cloud Music to view your liked songs.",
      notEnabled: "Enable the Netease source to load liked songs.",
      ownerPrefix: "By",
      countSuffix: "tracks",
      pageLabel: "Page",
      prevPage: "Previous",
      nextPage: "Next",
    };
  }

  return {
    eyebrow: "喜欢歌曲",
    title: "喜欢歌曲",
    description: "在这里查看你收藏的歌曲。",
    detailTitle: "喜欢歌曲",
    detailDescription: "这里展示你已收藏到“我喜欢的音乐”中的全部歌曲。",
    loading: "正在加载喜欢歌曲...",
    loadingTracks: "正在加载喜欢歌曲...",
    startIntelligenceMode: "心动模式",
    empty: "暂时还没有可显示的喜欢歌曲。",
    emptyTracks: "喜欢歌曲歌单里暂时没有可显示的歌曲。",
    notLoggedIn: "登录网易云音乐后，这里会显示你的喜欢歌曲。",
    notEnabled: "请先启用网易云在线源，再加载喜欢歌曲。",
    ownerPrefix: "创建者",
    countSuffix: "首歌曲",
    pageLabel: "第",
    prevPage: "上一页",
    nextPage: "下一页",
  };
}

function getKugouImportCopy(locale: string) {
  if (locale === "en-US") {
    return {
      eyebrow: "Tools",
      title: "Import Kugou Playlist",
      description: "Import a Kugou playlist into a Netease playlist here.",
      playlistLabel: "Target Playlist",
      playlistHelper: "Only your own Netease playlists can be used as import targets.",
      playlistPlaceholder: "Select a playlist",
      chooseFile: "Choose JSON File",
      replaceFile: "Replace File",
      importAction: "Start Import",
      importing: "Importing...",
      fileLabel: "Selected File",
      fileEmpty: "No Kugou JSON file selected yet.",
      parsedCount: "Parsed Tracks",
      previewTitle: "Preview",
      logTitle: "Import Results",
      loadingPlaylists: "Loading playlists...",
      notEnabled: "Enable the Netease source before using the import tool.",
      notLoggedIn: "Log in to Netease Cloud Music before importing into a playlist.",
      noPlaylists: "You do not have any editable playlists yet.",
      invalidFile: "The selected file could not be parsed as a Kugou playlist JSON.",
      summaryReady: "Ready to import",
      summaryDone: "Import finished",
      matched: "Matched",
      skipped: "Skipped",
      failed: "Failed",
      addedSuffix: "added",
      unresolvedSuffix: "unresolved",
      previewArtistsFallback: "Unknown artist",
      progressLabel: "Progress",
      errorRetryLabel: "Error Retries",
      errorRetryHelper: "Retry count when a request fails.",
      unresolvedRetryLabel: "Unmatched Retries",
      unresolvedRetryHelper: "Retry count when no match is found.",
      timeoutLabel: "Timeout",
      timeoutHelper: "Maximum wait time for each request in milliseconds.",
      concurrencyLabel: "Concurrency",
      concurrencyHelper: "Number of songs processed at the same time.",
      matchStrictnessLabel: "Match Strictness",
      matchStrictnessHelper: "Choose how strict automatic song matching should be.",
      exactTitleArtist: "Exact title + exact artist",
      fuzzyTitleArtist: "Fuzzy title + fuzzy artist",
      titleOnly: "Title only",
      compactMatched: "Imported",
      compactSkipped: "Unmatched",
      compactDuplicate: "Duplicate",
      compactFailed: "Failed",
      retryAction: "Retry",
      retrying: "Retrying...",
      manualRetryTitle: "Manual Retry",
      manualRetryDescription:
        "For unmatched songs, edit the search keywords and pick a result to add manually.",
      manualRetryKeywordsLabel: "Search Keywords",
      manualRetryKeywordsPlaceholder: "Song name artist",
      manualRetrySearchAction: "Search",
      manualRetrySearching: "Searching...",
      manualRetryEmpty: "Search to load candidate songs.",
      manualRetryNoResults: "No songs were found. Try another keyword combination.",
      manualRetryCancel: "Cancel",
      manualRetryAddAction: "Add",
      manualRetryAdding: "Adding...",
      manualRetrySource: "Source Track",
      manualRetryResults: "Search Results",
      manualRetryResultHint: "Choose the correct Netease song and add it into the playlist.",
      duplicateSkipped: "Skipped duplicate track",
      duplicateInPlaylist: "Already exists in the playlist",
      duplicateInImport: "Duplicate track in this import file",
    };
  }

  return {
    eyebrow: "工具",
    title: "导入酷狗歌单",
    description: "在这里将酷狗歌单导入到网易云歌单。",
    playlistLabel: "目标歌单",
    playlistHelper: "仅支持导入到你自己的网易云歌单中。",
    playlistPlaceholder: "请选择歌单",
    chooseFile: "选择 JSON 文件",
    replaceFile: "重新选择文件",
    importAction: "开始导入",
    importing: "正在导入...",
    fileLabel: "已选文件",
    fileEmpty: "暂未选择酷狗歌单 JSON 文件。",
    parsedCount: "已解析歌曲",
    previewTitle: "歌曲预览",
    logTitle: "导入结果",
    loadingPlaylists: "正在加载歌单...",
    notEnabled: "请先启用网易云在线源，再使用导入工具。",
    notLoggedIn: "请先登录网易云音乐，再导入到歌单。",
    noPlaylists: "你还没有可用于导入的自建歌单。",
    invalidFile: "所选文件无法解析为酷狗歌单 JSON。",
    summaryReady: "已准备导入",
    summaryDone: "导入完成",
    matched: "已匹配",
    skipped: "未匹配",
    failed: "失败",
    addedSuffix: "首已添加",
    unresolvedSuffix: "首未匹配",
    previewArtistsFallback: "未知作者",
    progressLabel: "当前进度",
    errorRetryLabel: "错误重试次数",
    errorRetryHelper: "请求报错时的额外重试次数。",
    unresolvedRetryLabel: "未找到重试次数",
    unresolvedRetryHelper: "没有匹配结果时的额外重试次数。",
    timeoutLabel: "响应时间限制",
    timeoutHelper: "单次请求允许等待的最长时间，单位毫秒。",
    concurrencyLabel: "请求并发个数",
    concurrencyHelper: "同时处理的歌曲数量。",
    matchStrictnessLabel: "匹配严格度",
    matchStrictnessHelper: "设置自动匹配时对歌名和作者的校验强度。",
    exactTitleArtist: "仅完全匹配歌名和作者",
    fuzzyTitleArtist: "大致匹配歌名和作者",
    titleOnly: "仅匹配歌名",
    compactMatched: "已导入",
    compactSkipped: "未找到",
    compactDuplicate: "重复跳过",
    compactFailed: "失败",
    retryAction: "重试",
    retrying: "重试中...",
    manualRetryTitle: "手动重试",
    manualRetryDescription: "未匹配歌曲可在这里修改搜索关键词，并从结果中手动添加到歌单。",
    manualRetryKeywordsLabel: "搜索关键词",
    manualRetryKeywordsPlaceholder: "歌曲名 作者",
    manualRetrySearchAction: "搜索",
    manualRetrySearching: "搜索中...",
    manualRetryEmpty: "请先搜索以加载候选歌曲。",
    manualRetryNoResults: "没有搜索到歌曲，可以尝试调整关键词。",
    manualRetryCancel: "取消",
    manualRetryAddAction: "添加",
    manualRetryAdding: "添加中...",
    manualRetrySource: "源歌曲",
    manualRetryResults: "搜索结果",
    manualRetryResultHint: "选择正确的网易云歌曲后即可手动添加到歌单。",
    duplicateSkipped: "已跳过重复歌曲",
    duplicateInPlaylist: "歌单中已存在该歌曲",
    duplicateInImport: "导入文件中存在重复歌曲",
  };
}

function getToolsCopy(locale: string) {
  if (locale === "en-US") {
    return {
      eyebrow: "Tools",
      title: "Toolbox",
      description: "Use import and migration tools here.",
      kugouTitle: "Import Kugou Playlist",
      kugouDescription:
        "Parse a local Kugou JSON file and add matched songs into a selected Netease playlist.",
      open: "Open",
      back: "Back to Tools",
    };
  }

  return {
    eyebrow: "工具",
    title: "工具箱",
    description: "在这里使用导入和迁移等工具。",
    kugouTitle: "导入酷狗歌单",
    kugouDescription: "解析本地酷狗 JSON，并将匹配到的歌曲导入指定网易云歌单。",
    open: "打开",
    back: "返回工具",
  };
}

function getPlaylistEditorCopy(locale: string) {
  if (locale === "en-US") {
    return {
      create: "Create Playlist",
      edit: "Edit Playlist",
      createTitle: "Create Playlist",
      editTitle: "Edit Playlist",
      createDescription: "Set the playlist name and description first. You can refine it later.",
      editDescription: "Update the playlist name and description. Changes will sync to Netease.",
      nameLabel: "Playlist Name",
      namePlaceholder: "Enter playlist name",
      descriptionLabel: "Playlist Description",
      descriptionPlaceholder: "Enter playlist description",
      cancel: "Cancel",
      submitCreate: "Create",
      submitEdit: "Save",
      createSuccess: "Playlist created",
      createFailed: "Failed to create playlist",
      updateSuccess: "Playlist updated",
      updateFailed: "Failed to update playlist",
      nameRequired: "Playlist name cannot be empty",
    };
  }

  return {
    create: "\u65b0\u5efa\u6b4c\u5355",
    edit: "\u7f16\u8f91\u6b4c\u5355",
    createTitle: "\u521b\u5efa\u6b4c\u5355",
    editTitle: "\u7f16\u8f91\u6b4c\u5355",
    createDescription:
      "\u5148\u8bbe\u7f6e\u6b4c\u5355\u540d\u79f0\u4e0e\u63cf\u8ff0\uff0c\u540e\u7eed\u4ecd\u53ef\u4ee5\u7ee7\u7eed\u8c03\u6574\u3002",
    editDescription:
      "\u4fee\u6539\u6b4c\u5355\u540d\u79f0\u4e0e\u63cf\u8ff0\uff0c\u53d8\u66f4\u4f1a\u540c\u6b65\u5230\u7f51\u6613\u4e91\u3002",
    nameLabel: "\u6b4c\u5355\u540d\u79f0",
    namePlaceholder: "\u8f93\u5165\u6b4c\u5355\u540d\u79f0",
    descriptionLabel: "\u6b4c\u5355\u63cf\u8ff0",
    descriptionPlaceholder: "\u8f93\u5165\u6b4c\u5355\u63cf\u8ff0",
    cancel: "\u53d6\u6d88",
    submitCreate: "\u521b\u5efa",
    submitEdit: "\u4fdd\u5b58",
    createSuccess: "\u6b4c\u5355\u5df2\u521b\u5efa",
    createFailed: "\u521b\u5efa\u6b4c\u5355\u5931\u8d25",
    updateSuccess: "\u6b4c\u5355\u5df2\u66f4\u65b0",
    updateFailed: "\u66f4\u65b0\u6b4c\u5355\u5931\u8d25",
    nameRequired: "\u6b4c\u5355\u540d\u79f0\u4e0d\u80fd\u4e3a\u7a7a",
  };
}

function getLibrarySongBrowserCopy(locale: string) {
  if (locale === "en-US") {
    return {
      searchLabel: "Search Songs",
      searchPlaceholder: "Search by title, artist, album, or file name",
      sourceLabel: "Source",
      sortLabel: "Sort",
      sourceAll: "All Sources",
      sourceLocal: "Local Only",
      sourceRemote: "Online Only",
      sortRecent: "Recently Imported",
      sortTitle: "Title A-Z",
      sortArtist: "Artist A-Z",
      sortAlbum: "Album A-Z",
      sortDuration: "Longest First",
      resultLabel: "Results",
      selectedLabel: "selected",
      pageLabel: "Page",
      prevPage: "Previous",
      nextPage: "Next",
      selectAll: "Select Visible",
      clearSelection: "Clear Selection",
      removeSelected: "Remove Selected",
      selectionToggle: "Select track",
      deleteCompleted: "Selected songs removed from the library",
      deleteFailed: "Failed to remove selected songs",
    };
  }

  return {
    searchLabel: "\u641c\u7d22\u6b4c\u66f2",
    searchPlaceholder: "\u6309\u6b4c\u540d\u3001\u6b4c\u624b\u3001\u4e13\u8f91\u6216\u6587\u4ef6\u540d\u641c\u7d22",
    sourceLabel: "\u6765\u6e90",
    sortLabel: "\u6392\u5e8f",
    sourceAll: "\u5168\u90e8\u6765\u6e90",
    sourceLocal: "\u4ec5\u672c\u5730",
    sourceRemote: "\u4ec5\u7f51\u7edc",
    sortRecent: "\u6700\u8fd1\u5bfc\u5165",
    sortTitle: "\u6807\u9898 A-Z",
    sortArtist: "\u6b4c\u624b A-Z",
    sortAlbum: "\u4e13\u8f91 A-Z",
    sortDuration: "\u65f6\u957f\u4ece\u957f\u5230\u77ed",
    resultLabel: "\u5f53\u524d\u7ed3\u679c",
    selectedLabel: "\u5df2\u9009",
    pageLabel: "\u7b2c",
    prevPage: "\u4e0a\u4e00\u9875",
    nextPage: "\u4e0b\u4e00\u9875",
    selectAll: "\u5168\u9009\u5f53\u524d\u7ed3\u679c",
    clearSelection: "\u6e05\u7a7a\u9009\u62e9",
    removeSelected: "\u79fb\u9664\u6240\u9009",
    selectionToggle: "\u9009\u62e9\u6b4c\u66f2",
    deleteCompleted: "\u5df2\u4ece\u8d44\u6599\u5e93\u79fb\u9664\u6240\u9009\u6b4c\u66f2",
    deleteFailed: "\u79fb\u9664\u6240\u9009\u6b4c\u66f2\u5931\u8d25",
  };
}

export function AppShell() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeNav, setActiveNav] = useState<NavId>("home");
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistSelection>(null);
  const [toolsView, setToolsView] = useState<ToolsView>("hub");
  const [playlistReturnSnapshot, setPlaylistReturnSnapshot] =
    useState<AppNavigationSnapshot | null>(null);
  const [exploreReturnSnapshot, setExploreReturnSnapshot] =
    useState<AppNavigationSnapshot | null>(null);
  const [libraryNavigationRequest, setLibraryNavigationRequest] =
    useState<LibraryNavigationRequest>(null);
  const [exploreDetailRequest, setExploreDetailRequest] =
    useState<ExploreDetailRequest>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [libraryView, setLibraryView] = useState<LibraryView>("hub");
  const [librarySelectedArtist, setLibrarySelectedArtist] = useState<string | null>(null);
  const [librarySelectedAlbum, setLibrarySelectedAlbum] = useState<string | null>(null);
  const [librarySelectedArtistDetail, setLibrarySelectedArtistDetail] = useState<{
    artist: string;
    trackCount: number;
    albumCount: number;
    representativeTrack: TrackRecord | null;
    avatarUrl: string | null;
  } | null>(null);
  const [librarySelectedAlbumDetail, setLibrarySelectedAlbumDetail] = useState<{
    album: string;
    trackCount: number;
    artistCount: number;
    representativeTrack: TrackRecord | null;
  } | null>(null);
  const [playbackQueueIds, setPlaybackQueueIds] = useState<string[]>([]);
  const [playbackQueueKind, setPlaybackQueueKind] = useState<PlaybackQueueKind>("standard");
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
  const [visualCurrentTimeSeconds, setVisualCurrentTimeSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [isPlaybackLoading, setIsPlaybackLoading] = useState(false);
  const [isAutoMixTransitionActive, setIsAutoMixTransitionActive] = useState(false);
  const [autoMixBadgePhase, setAutoMixBadgePhase] = useState<"hidden" | "entering" | "visible" | "leaving">("hidden");
  const [playbarDisplayTrackId, setPlaybarDisplayTrackId] = useState<string | null>(null);
  const [playbarDisplayTimeSeconds, setPlaybarDisplayTimeSeconds] = useState(0);
  const [playbarDisplayVisualTimeSeconds, setPlaybarDisplayVisualTimeSeconds] = useState(0);
  const [playbarDisplayDurationSeconds, setPlaybarDisplayDurationSeconds] = useState(0);
  const [playbarMetaAnimationKey, setPlaybarMetaAnimationKey] = useState(0);
  const [playbackMode, setPlaybackMode] = useState<PlaybackModeOption>("ordered");
  const [shuffledQueueIds, setShuffledQueueIds] = useState<string[]>([]);
  const [volume, setVolume] = useState<number>(68);
  const [isVolumePopoverOpen, setIsVolumePopoverOpen] = useState(false);
  const [isQueuePopoverOpen, setIsQueuePopoverOpen] = useState(false);
  const [isImmersivePlayerOpen, setIsImmersivePlayerOpen] = useState(false);
  const [isImmersivePlayerMounted, setIsImmersivePlayerMounted] = useState(false);
  const [isImmersivePlayerVisible, setIsImmersivePlayerVisible] = useState(false);
  const [isWallpaperModeEnabled, setIsWallpaperModeEnabled] = useState(false);
  const [draggingQueueTrackId, setDraggingQueueTrackId] = useState<string | null>(null);
  const [playbackRestoreSession, setPlaybackRestoreSession] =
    useState<PlaybackRestoreSessionState>(null);
  const [queueDropIndex, setQueueDropIndex] = useState<number | null>(null);
  const [queueDragState, setQueueDragState] = useState<QueueDragState | null>(null);
  const [playbackQueueSourcePlaylist, setPlaybackQueueSourcePlaylist] = useState<PlaylistSelection>(null);
  const [mediaLibrary, setMediaLibrary] = useState<MediaLibrarySnapshot | null>(null);
  const [transientRemoteTracks, setTransientRemoteTracks] = useState<Record<string, TrackRecord>>(
    {},
  );
  const [transientRemoteArtworkUrls, setTransientRemoteArtworkUrls] = useState<
    Record<string, string | null>
  >({});
  const [isLibraryLoading, setIsLibraryLoading] = useState(true);
  const [isImportingLibrary, setIsImportingLibrary] = useState(false);
  const [isDeletingLibraryTracks, setIsDeletingLibraryTracks] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => createDefaultAppSettings());
  const [isSettingsLoading, setIsSettingsLoading] = useState(true);
  const [isSettingsSaving, setIsSettingsSaving] = useState(false);
  const [neteaseUiVersion, setNeteaseUiVersion] = useState(0);
  const [toolOwnedPlaylists, setToolOwnedPlaylists] = useState<NeteasePlaylistRecommendation[]>([]);
  const [isToolPlaylistsLoading, setIsToolPlaylistsLoading] = useState(false);
  const [selectedKugouImportPlaylistId, setSelectedKugouImportPlaylistId] = useState("");
  const [kugouImportTracks, setKugouImportTracks] = useState<ParsedKugouPlaylistTrack[]>([]);
  const [kugouImportFileName, setKugouImportFileName] = useState("");
  const [isImportingKugouPlaylist, setIsImportingKugouPlaylist] = useState(false);
  const [kugouImportPhase, setKugouImportPhase] = useState<KugouImportPhase>("idle");
  const [kugouImportErrorRetryCount, setKugouImportErrorRetryCount] = useState(1);
  const [kugouImportUnresolvedRetryCount, setKugouImportUnresolvedRetryCount] = useState(1);
  const [kugouImportTimeoutMs, setKugouImportTimeoutMs] = useState(6000);
  const [kugouImportConcurrency, setKugouImportConcurrency] = useState(3);
  const [kugouImportMatchStrictness, setKugouImportMatchStrictness] =
    useState<KugouTrackMatchStrictness>("fuzzyTitleArtist");
  const [kugouImportProgress, setKugouImportProgress] = useState({
    current: 0,
    total: 0,
    matched: 0,
    skipped: 0,
    duplicate: 0,
    failed: 0,
  });
  const [kugouImportLogs, setKugouImportLogs] = useState<KugouImportLogEntry[]>([]);
  const [retryingKugouImportTrackIndex, setRetryingKugouImportTrackIndex] = useState<number | null>(null);
  const [kugouManualRetryState, setKugouManualRetryState] = useState<KugouManualRetryState | null>(null);
  const [isKugouManualRetryClosing, setIsKugouManualRetryClosing] = useState(false);
  const [isSubmittingKugouManualRetry, setIsSubmittingKugouManualRetry] = useState(false);
  const [contextMenuState, setContextMenuState] = useState<ContextMenuState | null>(null);
  const [isContextMenuClosing, setIsContextMenuClosing] = useState(false);
  const [contextMenuOwnedPlaylists, setContextMenuOwnedPlaylists] = useState<
    NeteasePlaylistRecommendation[]
  >([]);
  const [isContextMenuPlaylistLoading, setIsContextMenuPlaylistLoading] = useState(false);
  const [contextMenuBusyActionId, setContextMenuBusyActionId] = useState<string | null>(null);
  const [playlistEditorState, setPlaylistEditorState] = useState<PlaylistEditorState | null>(null);
  const [isPlaylistEditorClosing, setIsPlaylistEditorClosing] = useState(false);
  const [isSubmittingPlaylistEditor, setIsSubmittingPlaylistEditor] = useState(false);
  const [isTestingNeteaseApi, setIsTestingNeteaseApi] = useState(false);
  const [localNeteaseApiStatus, setLocalNeteaseApiStatus] =
    useState<LocalNeteaseApiServerStatus | null>(null);
  const [appGreetingPhase, setAppGreetingPhase] = useState<"hold" | "expand" | "exit" | "hidden">(
    "hold",
  );
  const [isAppWindowVisible, setIsAppWindowVisible] = useState(true);
  const [isDocumentVisible, setIsDocumentVisible] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState !== "hidden",
  );
  const [currentTimeLabel, setCurrentTimeLabel] = useState(() =>
    formatDynamicIslandPrimaryLabel(
      new Date(),
      createDefaultAppSettings().appearance.dynamicIslandDefaultContent,
    ),
  );
  const [detailedTimeLabel, setDetailedTimeLabel] = useState(() =>
    formatDynamicIslandDetailedLabel(
      new Date(),
      createDefaultAppSettings().appearance.dynamicIslandDefaultContent,
    ),
  );
  const [playbarArtworkOverrideUrl, setPlaybarArtworkOverrideUrl] = useState<string | null>(null);
  const [currentTrackLyrics, setCurrentTrackLyrics] = useState<NeteaseSongLyrics | null>(null);
  const [isCurrentTrackLyricsLoading, setIsCurrentTrackLyricsLoading] = useState(false);
  const [immersiveArtworkPalette, setImmersiveArtworkPalette] =
    useState<ImmersiveArtworkPalette | null>(null);
  const [appBackgroundMvVideoSrc, setAppBackgroundMvVideoSrc] = useState<string | null>(null);
  const [immersiveBackgroundMvVideoSrc, setImmersiveBackgroundMvVideoSrc] = useState<string | null>(null);
  const [dynamicIslandNotification, setDynamicIslandNotification] = useState<{
    id: number;
    message: string;
  } | null>(null);
  const [dynamicIslandNotificationPhase, setDynamicIslandNotificationPhase] = useState<
    "idle" | "enter" | "visible" | "swap" | "exit"
  >("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const primaryAudioRef = useRef<HTMLAudioElement | null>(null);
  const secondaryAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioProcessingChainBySlotRef = useRef<Partial<Record<AudioSlot, AudioProcessingChain>>>({});
  const audioSourceNodeByElementRef = useRef(new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>());
  const backgroundVideoRef = useRef<HTMLVideoElement | null>(null);
  const immersivePlayerCloseTimerRef = useRef<number | null>(null);
  const immersivePlayerOpenFrameRef = useRef<number | null>(null);
  const mediaLibraryRef = useRef<MediaLibrarySnapshot | null>(null);
  const transientRemoteTracksRef = useRef<Record<string, TrackRecord>>({});
  const transientRemoteArtworkUrlsRef = useRef<Record<string, string | null>>({});
  const currentTrackRef = useRef<TrackRecord | null>(null);
  const currentTrackIdRef = useRef<string | null>(null);
  const currentTimeSecondsRef = useRef(0);
  const visualCurrentTimeSecondsRef = useRef(0);
  const playbarDisplayTrackIdRef = useRef<string | null>(null);
  const playbarDisplayTimeSecondsRef = useRef(0);
  const playbarDisplayVisualTimeSecondsRef = useRef(0);
  const playbarDisplayDurationSecondsRef = useRef(0);
  const timelineOwnerModeRef = useRef<TimelineOwnerMode>("active");
  const lastImmersiveWallpaperDynamicSnapshotRef = useRef<ImmersiveWallpaperDynamicSnapshot | null>(
    null,
  );
  const lastImmersiveWallpaperDynamicSyncAtRef = useRef(0);
  const durationSecondsRef = useRef(0);
  const volumeRef = useRef(volume);
  const isPlayingRef = useRef(false);
  const isPlaybackLoadingRef = useRef(false);
  const isMaximizedRef = useRef(false);
  const isFullscreenRef = useRef(false);
  const isImmersivePlayerOpenRef = useRef(false);
  const playbarArtworkOverrideUrlRef = useRef<string | null>(null);
  const currentTrackLyricsRef = useRef<NeteaseSongLyrics | null>(null);
  const immersiveArtworkPaletteRef = useRef<ImmersiveArtworkPalette | null>(null);
  const appBackgroundMvVideoSrcRef = useRef<string | null>(null);
  const immersiveBackgroundMvVideoSrcRef = useRef<string | null>(null);
  const playbackModeRef = useRef<PlaybackModeOption>("ordered");
  const playbackQueueIdsRef = useRef<string[]>([]);
  const playbackQueueKindRef = useRef<PlaybackQueueKind>("standard");
  const lockedQueuePreviousPlaybackModeRef = useRef<PlaybackModeOption | null>(null);
  const currentQueueIdsRef = useRef<string[]>([]);
  const libraryTrackIdsRef = useRef<string[]>([]);
  const personalFmQueueSongsRef = useRef<NeteaseSongDetail[]>([]);
  const isPersonalFmBufferingRef = useRef(false);
  const settingsAutoSaveTimerRef = useRef<number | null>(null);
  const persistedSettingsSerializedRef = useRef(JSON.stringify(createDefaultAppSettings()));
  const persistedScanDirectoriesKeyRef = useRef(
    JSON.stringify(createDefaultAppSettings().library.scanDirectories),
  );
  const settingsSaveRequestIdRef = useRef(0);
  const isTimelineSeekingRef = useRef(false);
  const resumeAfterSeekRef = useRef(false);
  const progressAnimationFrameRef = useRef<number | null>(null);
  const pauseFadeAnimationFrameRef = useRef<number | null>(null);
  const pauseFadeSequenceRef = useRef(0);
  const isPauseFadingRef = useRef(false);
  const songTransitionAnimationFrameRef = useRef<number | null>(null);
  const songTransitionSequenceRef = useRef(0);
  const activeAudioSlotRef = useRef<AudioSlot>("primary");
  const isSongTransitionRunningRef = useRef(false);
  const songTransitionSourceTrackIdRef = useRef<string | null>(null);
  const songTransitionFromAudioRef = useRef<HTMLAudioElement | null>(null);
  const songTransitionToAudioRef = useRef<HTMLAudioElement | null>(null);
  const songTransitionArmedTrackIdRef = useRef<string | null>(null);
  const songTransitionPreparedRef = useRef<PreparedSongTransition | null>(null);
  const songTransitionPreparationKeyRef = useRef<string | null>(null);
  const songTransitionPreparationPromiseRef = useRef<Promise<PreparedSongTransition | null> | null>(null);
  const songTransitionPreparationSequenceRef = useRef(0);
  const pendingAutoplayRef = useRef(false);
  const pendingPlaybackStartIntentRef = useRef<PlaybackStartIntent | null>(null);
  const cancelledAutoMixTrackIdRef = useRef<string | null>(null);
  const playbackCandidateIndexRef = useRef(0);
  const playbackCandidatesRef = useRef<string[]>([]);
  const volumePopoverRef = useRef<HTMLDivElement | null>(null);
  const queuePopoverRef = useRef<HTMLDivElement | null>(null);
  const queueListRef = useRef<HTMLDivElement | null>(null);
  const queueItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const queueDragFrameRef = useRef<number | null>(null);
  const queueDragPointerRef = useRef<{ x: number; y: number } | null>(null);
  const volumeSaveTimerRef = useRef<number | null>(null);
  const playbackModeSaveTimerRef = useRef<number | null>(null);
  const contextMenuCloseTimerRef = useRef<number | null>(null);
  const playlistEditorCloseTimerRef = useRef<number | null>(null);
  const kugouManualRetryCloseTimerRef = useRef<number | null>(null);
  const playlistEditorReopenLockUntilRef = useRef(0);
  const windowSizeSaveTimerRef = useRef<number | null>(null);
  const playbackStateSaveTimerRef = useRef<number | null>(null);
  const playbackLoadTimeoutRef = useRef<number | null>(null);
  const attemptedPlaybackRecoveryKeyRef = useRef<string | null>(null);
  const repairingArtworkTrackKeysRef = useRef<Set<string>>(new Set());
  const repairedArtworkTrackKeysRef = useRef<Set<string>>(new Set());
  const playbackRequestSequenceRef = useRef(0);
  const playbackCachedAudioPathsRef = useRef<Record<string, string>>({});
  const playbackCacheRequestsRef = useRef<Record<string, Promise<string | null>>>({});
  const playbackCacheScheduleTimerRef = useRef<number | null>(null);
  const playbackCacheScheduledTrackIdRef = useRef<string | null>(null);
  const loggedTrackAnalysisKeysRef = useRef<Set<string>>(new Set());
  const trackAnalysisByTrackIdRef = useRef<Record<string, AudioTrackAnalysis>>({});
  const trackAnalysisRequestsRef = useRef<Record<string, Promise<AudioTrackAnalysis | null>>>({});
  const playbackPhaseTrackIdRef = useRef<string | null>(null);
  const playbackPhaseStateRef = useRef<"intro" | "main" | "outro" | null>(null);
  const autoMixDecisionCacheRef = useRef<Record<string, TransitionDecision | null>>({});
  const hasRestoredPlaybackStateRef = useRef(false);
  const playbackRestoreSequenceRef = useRef(0);
  const queueDragStateRef = useRef<QueueDragState | null>(null);
  const queueDropIndexRef = useRef<number | null>(null);
  const lyricsCacheRef = useRef<Record<string, NeteaseSongLyrics | null>>({});
  const immersivePaletteCacheRef = useRef<Record<string, ImmersiveArtworkPalette | null>>({});
  const appBackgroundMvRequestSequenceRef = useRef(0);
  const immersiveBackgroundMvRequestSequenceRef = useRef(0);
  const settingsRef = useRef(settings);
  const isSettingsLoadingRef = useRef(isSettingsLoading);
  const contextMenuStateRef = useRef<ContextMenuState | null>(null);
  const shortcutActionHandlerRef = useRef<(actionId: ShortcutActionId) => void>(() => undefined);
  const savedWindowSizeKeyRef = useRef("");
  const pendingWindowSizeKeyRef = useRef("");
  const isWindowVisibleForUi = isAppWindowVisible && isDocumentVisible;
  const copy = getUiCopy(settings.appearance.language);
  const localeStrings = getLocaleStrings(copy.locale);
  const playlistEditorCopy = getPlaylistEditorCopy(copy.locale);
  const isOnlineFeaturesAvailable = isNeteaseSourceEnabled(settings);
  const navItems = navItemIds
    .filter(
      (id) =>
        isOnlineFeaturesAvailable || (id !== "explore" && id !== "favorites" && id !== "playlist"),
    )
    .map((id) => ({
      id,
      label: copy.nav[id],
    }));
  const languageOptions = [...copy.options.language];
  const themeOptions = getThemePresetOptions(copy.locale);
  const qualityOptions = [...copy.options.quality];
  const playbackCacheModeOptions = [...copy.options.playbackCacheMode] as UISelectOption[];
  const backgroundMediaKind = getBackgroundMediaKind(settings.appearance.backgroundImagePath);
  const backgroundImageStyle =
    backgroundMediaKind === "image"
      ? resolveBackgroundImageStyle(settings.appearance.backgroundImagePath)
      : "none";
  const backgroundVideoSrc =
    backgroundMediaKind === "video"
      ? resolveBackgroundMediaSrc(settings.appearance.backgroundImagePath)
      : null;
  const effectiveBackgroundVideoSrc = appBackgroundMvVideoSrc ?? backgroundVideoSrc;
  const hasCustomAppBackground =
    settings.appearance.backgroundMode === "custom" && backgroundMediaKind !== "none";
  const configuredAppFontFamily = buildConfiguredFontFamilyValue(
    settings.appearance.fontFamily ?? "system-ui",
  );
  const artworkDrivenThemeSeed =
    settings.appearance.followSongArtworkTheme && isPlaying && currentTrackId && immersiveArtworkPalette
      ? buildArtworkThemeSeed(immersiveArtworkPalette, settings.appearance.colorScheme)
      : null;
  const themeStyle = useMemo(() => {
    const baseStyle = buildThemeStyle(
      settings.appearance,
      backgroundImageStyle,
      backgroundMediaKind,
      artworkDrivenThemeSeed,
    );

    if (!appBackgroundMvVideoSrc) {
      return {
        ...baseStyle,
        fontFamily: configuredAppFontFamily,
      } as CSSProperties;
    }

    const backgroundBlur = Math.min(48, Math.max(0, settings.appearance.backgroundBlur ?? 18));
    const backgroundDim = clamp01((settings.appearance.backgroundDim ?? 18) / 100);
    const backgroundOpacity = clamp01((settings.appearance.backgroundImageOpacity ?? 82) / 100);

    return {
      ...baseStyle,
      fontFamily: configuredAppFontFamily,
      "--app-background-opacity": String(backgroundOpacity),
      "--app-background-blur": `${backgroundBlur}px`,
      "--app-background-dim-opacity": String(backgroundDim),
    } as CSSProperties;
  }, [
    artworkDrivenThemeSeed,
    backgroundImageStyle,
    backgroundMediaKind,
    appBackgroundMvVideoSrc,
    configuredAppFontFamily,
    settings.appearance,
  ]);

  useEffect(() => {
    document.documentElement.style.setProperty("--app-font-family", configuredAppFontFamily);
    document.body.style.fontFamily = configuredAppFontFamily;

    return () => {
      document.documentElement.style.removeProperty("--app-font-family");
      document.body.style.removeProperty("font-family");
    };
  }, [configuredAppFontFamily]);

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    let isDisposed = false;
    let unlistenVisibility: (() => void) | undefined;
    let unlistenWallpaperLog: (() => void) | undefined;

    const applyWindowVisibility = (nextVisible: boolean) => {
      if (isDisposed) {
        return;
      }

      setIsAppWindowVisible((current) => (current === nextVisible ? current : nextVisible));

      if (!nextVisible) {
        setIsQueuePopoverOpen(false);
        setIsVolumePopoverOpen(false);
        setContextMenuState(null);
      }
    };

    const handleDocumentVisibilityChange = () => {
      if (isDisposed) {
        return;
      }

      setIsDocumentVisible(document.visibilityState !== "hidden");
    };

    void currentWindow
      .isVisible()
      .then((visible) => {
        applyWindowVisibility(visible);
      })
      .catch(() => undefined);

    void currentWindow
      .listen<boolean>(MAIN_WINDOW_VISIBILITY_EVENT, ({ payload }) => {
        applyWindowVisibility(Boolean(payload));
      })
      .then((unlisten) => {
        if (isDisposed) {
          unlisten();
          return;
        }

        unlistenVisibility = unlisten;
      });

    void currentWindow
      .listen<{ message: string }>(WALLPAPER_LOG_EVENT, ({ payload }) => {
        console.info(`[wallpaper-rust] ${payload.message}`);
      })
      .then((unlisten) => {
        if (isDisposed) {
          unlisten();
          return;
        }

        unlistenWallpaperLog = unlisten;
      });

    document.addEventListener("visibilitychange", handleDocumentVisibilityChange);

    return () => {
      isDisposed = true;
      document.removeEventListener("visibilitychange", handleDocumentVisibilityChange);
      unlistenVisibility?.();
      unlistenWallpaperLog?.();
    };
  }, []);

  const saveCurrentWindowSize = async () => {
    if (isSettingsLoadingRef.current) {
      return;
    }

    const currentWindow = getCurrentWindow();
    const [isMaximizedWindow, isFullscreenWindow, innerSize, scaleFactor] = await Promise.all([
      currentWindow.isMaximized(),
      currentWindow.isFullscreen(),
      currentWindow.innerSize(),
      currentWindow.scaleFactor(),
    ]);

    if (isMaximizedWindow || isFullscreenWindow) {
      return;
    }

    const width = normalizeWindowDimension(innerSize.width / scaleFactor, MIN_WINDOW_WIDTH);
    const height = normalizeWindowDimension(innerSize.height / scaleFactor, MIN_WINDOW_HEIGHT);
    const nextKey = buildWindowSizeKey(width, height);

    if (nextKey === savedWindowSizeKeyRef.current) {
      return;
    }

    const nextSettings: AppSettings = {
      ...settingsRef.current,
      window: {
        width,
        height,
      },
    };

    settingsRef.current = nextSettings;
    setSettings(nextSettings);

    try {
      const snapshot = await saveAppSettings(nextSettings);
      applySavedSettingsSnapshot(nextSettings, snapshot);
    } catch (error) {
      console.error("[window] failed to save current window size", error);
    }
  };

  const handleClose = async () => {
    try {
      if (playbackStateSaveTimerRef.current) {
        window.clearTimeout(playbackStateSaveTimerRef.current);
        playbackStateSaveTimerRef.current = null;
      }
      if (windowSizeSaveTimerRef.current) {
        window.clearTimeout(windowSizeSaveTimerRef.current);
        windowSizeSaveTimerRef.current = null;
      }

      await persistPlaybackResumeSettings();
      await saveCurrentWindowSize();
    } catch (error) {
      console.error("[window] failed to flush playback state before close", error);
    } finally {
      await getCurrentWindow().close();
    }
  };

  const syncWindowFrameStateValue = (nextIsMaximized: boolean, nextIsFullscreen: boolean) => {
    if (isMaximizedRef.current !== nextIsMaximized) {
      isMaximizedRef.current = nextIsMaximized;
      setIsMaximized(nextIsMaximized);
    }

    if (isFullscreenRef.current !== nextIsFullscreen) {
      isFullscreenRef.current = nextIsFullscreen;
      setIsFullscreen(nextIsFullscreen);
    }
  };

  const syncPlaybarArtworkOverrideUrl = (nextUrl: string | null) => {
    const normalizedNextUrl = nextUrl ?? null;
    if (playbarArtworkOverrideUrlRef.current === normalizedNextUrl) {
      return;
    }

    playbarArtworkOverrideUrlRef.current = normalizedNextUrl;
    setPlaybarArtworkOverrideUrl(normalizedNextUrl);
  };

  const syncAppBackgroundMvVideoSrc = (nextUrl: string | null) => {
    const normalizedNextUrl = nextUrl ?? null;
    if (appBackgroundMvVideoSrcRef.current === normalizedNextUrl) {
      return;
    }

    appBackgroundMvVideoSrcRef.current = normalizedNextUrl;
    setAppBackgroundMvVideoSrc(normalizedNextUrl);
  };

  const syncImmersiveBackgroundMvVideoSrc = (nextUrl: string | null) => {
    const normalizedNextUrl = nextUrl ?? null;
    if (immersiveBackgroundMvVideoSrcRef.current === normalizedNextUrl) {
      return;
    }

    immersiveBackgroundMvVideoSrcRef.current = normalizedNextUrl;
    setImmersiveBackgroundMvVideoSrc(normalizedNextUrl);
  };

  const syncImmersivePlayerOpen = (nextOpen: boolean) => {
    if (isImmersivePlayerOpenRef.current === nextOpen) {
      return;
    }

    if (immersivePlayerCloseTimerRef.current !== null) {
      window.clearTimeout(immersivePlayerCloseTimerRef.current);
      immersivePlayerCloseTimerRef.current = null;
    }

    if (immersivePlayerOpenFrameRef.current !== null) {
      window.cancelAnimationFrame(immersivePlayerOpenFrameRef.current);
      immersivePlayerOpenFrameRef.current = null;
    }

    if (nextOpen) {
      setIsImmersivePlayerMounted(true);
      setIsImmersivePlayerVisible(false);
      immersivePlayerOpenFrameRef.current = window.requestAnimationFrame(() => {
        immersivePlayerOpenFrameRef.current = null;
        setIsImmersivePlayerVisible(true);
      });
    } else {
      setIsImmersivePlayerVisible(false);
      immersivePlayerCloseTimerRef.current = window.setTimeout(() => {
        setIsImmersivePlayerMounted(false);
        immersivePlayerCloseTimerRef.current = null;
      }, IMMERSIVE_PLAYER_CLOSE_DURATION_MS);
    }

    isImmersivePlayerOpenRef.current = nextOpen;
    setIsImmersivePlayerOpen(nextOpen);
  };

  const syncCurrentTrackLyrics = (nextLyrics: NeteaseSongLyrics | null) => {
    if (currentTrackLyricsRef.current === nextLyrics) {
      return;
    }

    currentTrackLyricsRef.current = nextLyrics;
    setCurrentTrackLyrics(nextLyrics);
  };

  const syncImmersiveArtworkPalette = (nextPalette: ImmersiveArtworkPalette | null) => {
    if (immersiveArtworkPaletteRef.current === nextPalette) {
      return;
    }

    immersiveArtworkPaletteRef.current = nextPalette;
    setImmersiveArtworkPalette(nextPalette);
  };

  const syncPlaybackVisualState = (nextState: {
    currentTimeSeconds?: number;
    visualCurrentTimeSeconds?: number;
    durationSeconds?: number;
    isPlaying?: boolean;
    isPlaybackLoading?: boolean;
  }) => {
    if (
      typeof nextState.currentTimeSeconds === "number" &&
      currentTimeSecondsRef.current !== nextState.currentTimeSeconds
    ) {
      currentTimeSecondsRef.current = nextState.currentTimeSeconds;
      setCurrentTimeSeconds(nextState.currentTimeSeconds);
    }

    if (
      typeof nextState.visualCurrentTimeSeconds === "number" &&
      visualCurrentTimeSecondsRef.current !== nextState.visualCurrentTimeSeconds
    ) {
      visualCurrentTimeSecondsRef.current = nextState.visualCurrentTimeSeconds;
      setVisualCurrentTimeSeconds(nextState.visualCurrentTimeSeconds);
    }

    if (
      typeof nextState.durationSeconds === "number" &&
      durationSecondsRef.current !== nextState.durationSeconds
    ) {
      durationSecondsRef.current = nextState.durationSeconds;
      setDurationSeconds(nextState.durationSeconds);
    }

    if (typeof nextState.isPlaying === "boolean" && isPlayingRef.current !== nextState.isPlaying) {
      isPlayingRef.current = nextState.isPlaying;
      setIsPlaying(nextState.isPlaying);
    }

    if (
      typeof nextState.isPlaybackLoading === "boolean" &&
      isPlaybackLoadingRef.current !== nextState.isPlaybackLoading
    ) {
      isPlaybackLoadingRef.current = nextState.isPlaybackLoading;
      setIsPlaybackLoading(nextState.isPlaybackLoading);
    }
  };

  const syncPlaybarDisplayState = (nextState: {
    trackId?: string | null;
    currentTimeSeconds?: number;
    visualTimeSeconds?: number;
    durationSeconds?: number;
    animateMeta?: boolean;
  }) => {
    let trackDidChange = false;

    if (
      Object.prototype.hasOwnProperty.call(nextState, "trackId") &&
      playbarDisplayTrackIdRef.current !== nextState.trackId
    ) {
      playbarDisplayTrackIdRef.current = nextState.trackId ?? null;
      setPlaybarDisplayTrackId(nextState.trackId ?? null);
      trackDidChange = true;
    }

    if (
      typeof nextState.currentTimeSeconds === "number" &&
      playbarDisplayTimeSecondsRef.current !== nextState.currentTimeSeconds
    ) {
      playbarDisplayTimeSecondsRef.current = nextState.currentTimeSeconds;
      setPlaybarDisplayTimeSeconds(nextState.currentTimeSeconds);
    }

    if (
      typeof nextState.visualTimeSeconds === "number" &&
      playbarDisplayVisualTimeSecondsRef.current !== nextState.visualTimeSeconds
    ) {
      playbarDisplayVisualTimeSecondsRef.current = nextState.visualTimeSeconds;
      setPlaybarDisplayVisualTimeSeconds(nextState.visualTimeSeconds);
    }

    if (
      typeof nextState.durationSeconds === "number" &&
      playbarDisplayDurationSecondsRef.current !== nextState.durationSeconds
    ) {
      playbarDisplayDurationSecondsRef.current = nextState.durationSeconds;
      setPlaybarDisplayDurationSeconds(nextState.durationSeconds);
    }

    if ((trackDidChange || nextState.animateMeta) && nextState.trackId) {
      setPlaybarMetaAnimationKey((current) => current + 1);
    }
  };

  const syncTimelineOwnerMode = (nextMode: TimelineOwnerMode) => {
    timelineOwnerModeRef.current = nextMode;
  };

  const syncPlaybarProgressFromAudio = (audio: HTMLAudioElement | null, options?: {
    trackId?: string | null;
    animateMeta?: boolean;
    fallbackDurationSeconds?: number;
  }) => {
    const nextTime = audio && Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0;
    const nextDuration =
      audio && Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : (options?.fallbackDurationSeconds ?? 0);

    syncPlaybarDisplayState({
      trackId: options?.trackId,
      currentTimeSeconds: nextTime,
      visualTimeSeconds: nextTime,
      durationSeconds: nextDuration,
      animateMeta: options?.animateMeta,
    });
  };

  const getAudioElementBySlot = (slot: AudioSlot) =>
    slot === "primary" ? primaryAudioRef.current : secondaryAudioRef.current;

  const syncActiveAudioReference = (nextSlot?: AudioSlot) => {
    if (nextSlot) {
      activeAudioSlotRef.current = nextSlot;
    }

    audioRef.current = getAudioElementBySlot(activeAudioSlotRef.current);
    return audioRef.current;
  };

  const getActiveAudioElement = () => syncActiveAudioReference();

  const getInactiveAudioElement = () =>
    getAudioElementBySlot(activeAudioSlotRef.current === "primary" ? "secondary" : "primary");

  const getPlaybarDisplayAudioElement = () => {
    const primaryAudio = primaryAudioRef.current;
    const secondaryAudio = secondaryAudioRef.current;
    const displayTrackId = playbarDisplayTrackIdRef.current;

    if (displayTrackId) {
      if (primaryAudio?.dataset.trackId === displayTrackId) {
        return primaryAudio;
      }
      if (secondaryAudio?.dataset.trackId === displayTrackId) {
        return secondaryAudio;
      }
    }

    return getActiveAudioElement();
  };

  const syncBackgroundMvPosition = (video: HTMLVideoElement | null, force = false) => {
    if (!video || !appBackgroundMvVideoSrc || (!force && !isPlayingRef.current)) {
      return;
    }

    const activeAudio = getActiveAudioElement();
    const audioCurrentTime =
      activeAudio && Number.isFinite(activeAudio.currentTime)
        ? activeAudio.currentTime
        : currentTimeSecondsRef.current;

    if (!Number.isFinite(audioCurrentTime) || audioCurrentTime < 0) {
      return;
    }

    const videoDuration = Number.isFinite(video.duration) ? video.duration : 0;
    const maxSyncTime = videoDuration > 0 ? Math.max(0, videoDuration - 0.12) : audioCurrentTime;
    const targetTime = Math.min(audioCurrentTime, maxSyncTime);
    const currentVideoTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const drift = Math.abs(currentVideoTime - targetTime);

    if (force || drift > 0.08) {
      try {
        video.currentTime = targetTime;
      } catch (error) {
        console.error("[theme] failed to sync background mv position", error);
      }
    }

    if (video.paused && isPlayingRef.current) {
      void video.play().catch(() => undefined);
    }
  };

  useEffect(() => {
    const video = backgroundVideoRef.current;
    if (!video || !effectiveBackgroundVideoSrc) {
      return;
    }

    if (!isWindowVisibleForUi) {
      video.pause();
      return;
    }

    if (appBackgroundMvVideoSrc) {
      syncBackgroundMvPosition(video, true);
      if (!isPlaying) {
        video.pause();
        return;
      }
    }

    if (video.paused) {
      void video.play().catch(() => undefined);
    }
  }, [
    appBackgroundMvVideoSrc,
    currentTrackId,
    effectiveBackgroundVideoSrc,
    isPlaying,
    isWindowVisibleForUi,
  ]);

  const resetAudioElement = (audio: HTMLAudioElement | null) => {
    if (!audio) {
      return;
    }

    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    audio.currentTime = 0;
    resetProcessedAudioChain(audio);
    audio.playbackRate = 1;
    if ("preservesPitch" in audio) {
      audio.preservesPitch = true;
    }
    if ("mozPreservesPitch" in audio) {
      (audio as HTMLAudioElement & { mozPreservesPitch: boolean }).mozPreservesPitch = true;
    }
    if ("webkitPreservesPitch" in audio) {
      (audio as HTMLAudioElement & { webkitPreservesPitch: boolean }).webkitPreservesPitch = true;
    }
    audio.dataset.trackId = "";
  };

  const getRemotePlaybackCacheRequest = (track: TrackRecord) => {
    const remoteUrlCandidates = [
      track.source.kind === "remoteStream" ? track.source.url : null,
      /^https?:\/\//i.test(track.playback.primaryUri) ? track.playback.primaryUri : null,
      track.playback.fallbackUri && /^https?:\/\//i.test(track.playback.fallbackUri)
        ? track.playback.fallbackUri
        : null,
      ...(track.playback.fallbackUris ?? []).filter((value) => /^https?:\/\//i.test(value)),
    ].filter((value): value is string => Boolean(value && value.trim()));

    const remoteUrl = remoteUrlCandidates[0] ?? null;
    if (!remoteUrl) {
      return null;
    }

    return {
      url: remoteUrl,
      mimeType: track.source.kind === "remoteStream" ? track.source.mimeType : null,
      headers: track.source.kind === "remoteStream" ? track.source.headers : null,
      cacheKey: track.playback.cacheKey ?? track.id,
    };
  };

  const clearTrackPlaybackCache = async (trackId: string, path?: string | null) => {
    const resolvedPath = path ?? playbackCachedAudioPathsRef.current[trackId] ?? null;
    delete playbackCachedAudioPathsRef.current[trackId];

    if (!resolvedPath) {
      return;
    }

    try {
      await clearCachedRemoteAudio(resolvedPath);
    } catch (error) {
      console.error("[player] failed to clear cached playback audio", error);
    }
  };

  const ensureTrackPlaybackCache = async (
    track: TrackRecord,
    options?: { waitForCompletion?: boolean },
  ) => {
    const cachedPath = playbackCachedAudioPathsRef.current[track.id];
    if (cachedPath) {
      return cachedPath;
    }

    const existingRequest = playbackCacheRequestsRef.current[track.id];
    if (existingRequest) {
      return options?.waitForCompletion === false ? null : existingRequest;
    }

    const request = getRemotePlaybackCacheRequest(track);
    if (!request) {
      return null;
    }

    const nextRequest = (async () => {
      try {
        const path = await cacheRemoteAudio(request);
        playbackCachedAudioPathsRef.current[track.id] = path;
        return path;
      } catch (error) {
        console.error("[player] failed to cache remote audio for playback", error);
        return null;
      } finally {
        delete playbackCacheRequestsRef.current[track.id];
      }
    })();

    playbackCacheRequestsRef.current[track.id] = nextRequest;
    return options?.waitForCompletion === false ? null : nextRequest;
  };

  const ensureTrackAnalysis = async (track: TrackRecord) => {
    const existingAnalysis = trackAnalysisByTrackIdRef.current[track.id];
    if (existingAnalysis) {
      return existingAnalysis;
    }

    const existingRequest = trackAnalysisRequestsRef.current[track.id];
    if (existingRequest) {
      return existingRequest;
    }

    const nextRequest = (async () => {
      try {
        const readyTrack = await ensureTrackReadyForPlayback(track, {
          announceNotice: false,
        });
        const analysisPath = readyTrack.source.kind === "localFile"
          ? readyTrack.source.path
          : (
              (await ensureTrackPlaybackCache(readyTrack, {
                waitForCompletion: true,
              })) ?? playbackCachedAudioPathsRef.current[readyTrack.id] ?? null
            );

        if (!analysisPath) {
          console.info("[track-analysis] skipped; no local or cached audio path", {
            trackId: readyTrack.id,
            title: readyTrack.title,
            playbackMode: readyTrack.playback.mode,
          });
          return null;
        }

        const analysisKey = `${readyTrack.id}::${analysisPath}`;
        if (loggedTrackAnalysisKeysRef.current.has(analysisKey)) {
          return trackAnalysisByTrackIdRef.current[readyTrack.id] ?? null;
        }

        const analysis = await analyzeLocalAudioTrack(analysisPath);
        loggedTrackAnalysisKeysRef.current.add(analysisKey);
        setBoundedRecordValue(
          trackAnalysisByTrackIdRef.current,
          readyTrack.id,
          analysis,
          TRACK_ANALYSIS_CACHE_LIMIT,
          collectPlaybackCacheProtectedTrackIds(),
        );
        pruneTrackAnalysisCache(collectPlaybackCacheProtectedTrackIds());

        console.groupCollapsed(
          `[track-analysis] ${readyTrack.title}${readyTrack.artist ? ` - ${readyTrack.artist}` : ""}`,
        );
        console.log("track", {
          id: readyTrack.id,
          title: readyTrack.title,
          artist: readyTrack.artist,
          sourcePath: analysis.sourcePath,
          durationMs: analysis.durationMs,
          sampleRate: analysis.sampleRate,
        });
        console.log("analysis", analysis);
        console.groupEnd();

        return analysis;
      } catch (error) {
        console.error("[track-analysis] failed", {
          trackId: track.id,
          title: track.title,
          error,
        });
        return null;
      } finally {
        delete trackAnalysisRequestsRef.current[track.id];
      }
    })();

    trackAnalysisRequestsRef.current[track.id] = nextRequest;
    return nextRequest;
  };

  const prewarmAdjacentTrackAnalysis = async (sourceTrackId: string) => {
    const target = resolveAdjacentPlaybackTarget(1, {
      fromEnded: true,
      allowRepeatOneRestart: false,
    });

    if (!target || target.action !== "play-track" || !target.trackId) {
      return null;
    }

    const targetTrack = findTrackById(target.trackId);
    if (!targetTrack || currentTrackIdRef.current !== sourceTrackId) {
      return null;
    }

    return ensureTrackAnalysis(targetTrack);
  };

  const summarizeAutoMixAnalysis = (analysis: AudioTrackAnalysis | null | undefined) => {
    if (!analysis) {
      return null;
    }

    return {
      estimatedTempoBpm: analysis.estimatedTempoBpm,
      beatCount: analysis.beatTimesMs.length,
      barCount: analysis.barTimesMs.length,
      phraseCount: analysis.phraseTimesMs.length,
      firstPhraseTimesMs: analysis.phraseTimesMs.slice(0, 8),
      introPhaseEndMs: analysis.introPhaseEndMs,
      outroPhaseStartMs: analysis.outroPhaseStartMs,
      averageEnergy: roundTo(analysis.averageEnergy, 4),
      introEnergy: roundTo(analysis.introEnergy, 4),
      outroEnergy: roundTo(analysis.outroEnergy, 4),
      suggestedTransitionStartMs: analysis.suggestedTransitionStartMs,
      suggestedTransitionReason: analysis.suggestedTransitionReason,
    };
  };

  const resolveTrackPlaybackPhase = (
    analysis: AudioTrackAnalysis | null | undefined,
    currentTimeMs: number,
  ): "intro" | "main" | "outro" | null => {
    if (!analysis) {
      return null;
    }

    const introPhaseEndMs = analysis.introPhaseEndMs;
    const outroPhaseStartMs = analysis.outroPhaseStartMs;

    if (typeof outroPhaseStartMs === "number" && outroPhaseStartMs >= 0 && currentTimeMs >= outroPhaseStartMs) {
      return "outro";
    }

    if (typeof introPhaseEndMs === "number" && introPhaseEndMs > 0 && currentTimeMs < introPhaseEndMs) {
      return "intro";
    }

    return "main";
  };

  const setAudioPreservesPitch = (audio: HTMLAudioElement, enabled: boolean) => {
    if ("preservesPitch" in audio) {
      audio.preservesPitch = enabled;
    }
    if ("mozPreservesPitch" in audio) {
      (audio as HTMLAudioElement & { mozPreservesPitch: boolean }).mozPreservesPitch = enabled;
    }
    if ("webkitPreservesPitch" in audio) {
      (audio as HTMLAudioElement & { webkitPreservesPitch: boolean }).webkitPreservesPitch = enabled;
    }
  };

  const clampPlaybackRate = (value: number) => clampNumber(value, 0.94, 1.08);

  const ensureAudioContext = () => {
    if (typeof window === "undefined") {
      return null;
    }

    const AudioContextCtor =
      window.AudioContext ??
      (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextCtor) {
      return null;
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextCtor();
    }

    return audioContextRef.current;
  };

  const isHttpLikeMediaSource = (value: string | null | undefined) =>
    typeof value === "string" && /^https?:\/\//i.test(value.trim());

  const canUseWebAudioProcessingForElement = (audio: HTMLAudioElement | null) => {
    if (!audio) {
      return false;
    }

    if (!ENABLE_SHARED_AUDIO_WEB_PROCESSING) {
      return false;
    }

    const mediaSource = audio.currentSrc || audio.src || "";
    return !isHttpLikeMediaSource(mediaSource);
  };

  const ensureAudioProcessingChain = (slot: AudioSlot, audio: HTMLAudioElement | null) => {
    if (!audio) {
      return null;
    }

    if (!canUseWebAudioProcessingForElement(audio)) {
      return null;
    }

    const existing = audioProcessingChainBySlotRef.current[slot];
    if (existing) {
      return existing;
    }

    const context = ensureAudioContext();
    if (!context) {
      return null;
    }

    let sourceNode = audioSourceNodeByElementRef.current.get(audio) ?? null;
    if (!sourceNode) {
      sourceNode = context.createMediaElementSource(audio);
      audioSourceNodeByElementRef.current.set(audio, sourceNode);
    }

    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 20;
    highpass.Q.value = 0.707;

    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 20000;
    lowpass.Q.value = 0.707;

    const gain = context.createGain();
    gain.gain.value = 1;

    sourceNode.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(context.destination);

    const chain = {
      source: sourceNode,
      highpass,
      lowpass,
      gain,
    };
    audioProcessingChainBySlotRef.current[slot] = chain;
    return chain;
  };

  const setProcessedAudioGain = (audio: HTMLAudioElement | null, value: number) => {
    if (!audio) {
      return;
    }

    const normalizedValue = clamp01(value);

    const slot = audio === primaryAudioRef.current ? "primary" : audio === secondaryAudioRef.current ? "secondary" : null;
    if (!slot) {
      return;
    }

    const chain = ensureAudioProcessingChain(slot, audio);
    if (chain) {
      chain.gain.gain.value = normalizedValue;
      audio.volume = 1;
      return;
    }

    audio.volume = normalizedValue;
  };

  const setProcessedFilterShape = (
    audio: HTMLAudioElement | null,
    options: { highpassHz: number; lowpassHz: number },
  ) => {
    if (!audio) {
      return;
    }

    const slot = audio === primaryAudioRef.current ? "primary" : audio === secondaryAudioRef.current ? "secondary" : null;
    if (!slot) {
      return;
    }

    const chain = ensureAudioProcessingChain(slot, audio);
    if (!chain) {
      return;
    }

    chain.highpass.frequency.value = clampNumber(options.highpassHz, 20, 1200);
    chain.lowpass.frequency.value = clampNumber(options.lowpassHz, 1800, 20000);
  };

  const resetProcessedAudioChain = (audio: HTMLAudioElement | null) => {
    if (!audio) {
      return;
    }

    const slot = audio === primaryAudioRef.current ? "primary" : audio === secondaryAudioRef.current ? "secondary" : null;
    if (!slot) {
      return;
    }

    const chain = ensureAudioProcessingChain(slot, audio);
    if (!chain) {
      audio.volume = volumeRef.current / 100;
      return;
    }

    chain.gain.gain.value = volumeRef.current / 100;
    chain.highpass.frequency.value = 20;
    chain.lowpass.frequency.value = 20000;
    audio.volume = 1;
  };

  const resolveAutoMixEntryPointMs = (
    analysis: AudioTrackAnalysis | null | undefined,
    transitionDurationMs: number,
  ) => {
    if (!analysis) {
      return 0;
    }

    const introEndMs =
      typeof analysis.introPhaseEndMs === "number" && analysis.introPhaseEndMs > 0
        ? analysis.introPhaseEndMs
        : 0;
    const durationMs = analysis.durationMs > 0 ? analysis.durationMs : Number.MAX_SAFE_INTEGER;
    const phraseTimes = analysis.phraseTimesMs.filter((time) => Number.isFinite(time) && time >= 0);
    const barTimes = analysis.barTimesMs.filter((time) => Number.isFinite(time) && time >= 0);
    const beatTimes = analysis.beatTimesMs.filter((time) => Number.isFinite(time) && time >= 0);
    const hasFiniteDuration = Number.isFinite(durationMs) && durationMs > 0;
    const durationBasedCapMs = hasFiniteDuration
      ? Math.max(2200, Math.min(durationMs * 0.06, AUTOMIX_NEXT_ENTRY_MAX_MS))
      : AUTOMIX_NEXT_ENTRY_MAX_MS;
    const baseEntryCapMs = Math.min(AUTOMIX_NEXT_ENTRY_MAX_MS, durationBasedCapMs);
    const trustedIntroEndMs =
      introEndMs > 0 && introEndMs <= Math.min(AUTOMIX_TRUSTED_INTRO_MAX_MS, baseEntryCapMs)
        ? introEndMs
        : 0;
    const softEntryCapMs = Math.min(
      baseEntryCapMs,
      Math.max(
        AUTOMIX_NEXT_ENTRY_DEFAULT_MS + transitionDurationMs * 0.28,
        trustedIntroEndMs + 1800,
      ),
    );
    const hardEntryCapMs = Math.max(
      AUTOMIX_NEXT_ENTRY_MIN_MS,
      Math.min(
        baseEntryCapMs,
        Math.max(softEntryCapMs, trustedIntroEndMs + 2600),
      ),
    );
    const approximateBarSpanMs =
      barTimes.length >= 2
        ? barTimes
            .slice(1)
            .map((time, index) => time - barTimes[index])
            .filter((span) => Number.isFinite(span) && span > 240)
            .slice(0, 6)
            .reduce((sum, span, _, spans) => sum + span / spans.length, 0)
        : analysis.estimatedTempoBpm && analysis.estimatedTempoBpm > 0
          ? (60000 / analysis.estimatedTempoBpm) * 4
          : 2200;
    const entryLeadInMs = clampNumber(
      Math.max(approximateBarSpanMs * 0.45, transitionDurationMs * 0.08),
      350,
      1100,
    );
    const finalizeEntryPoint = (anchorMs: number) =>
      Math.max(
        AUTOMIX_NEXT_ENTRY_MIN_MS,
        Math.min(
          hardEntryCapMs,
          anchorMs - entryLeadInMs,
        ),
      );

    const introCapMs = Math.min(
      hardEntryCapMs,
      Math.max(
        AUTOMIX_NEXT_ENTRY_DEFAULT_MS,
        trustedIntroEndMs + Math.max(700, transitionDurationMs * 0.12),
      ),
    );
    const desiredEntryFloorMs = Math.min(
      Math.max(
        AUTOMIX_NEXT_ENTRY_MIN_MS + transitionDurationMs * 0.08,
        trustedIntroEndMs > 0 ? trustedIntroEndMs - entryLeadInMs : AUTOMIX_NEXT_ENTRY_DEFAULT_MS,
      ),
      hardEntryCapMs,
    );
    const desiredEntryCeilMs = Math.min(
      Math.max(desiredEntryFloorMs + 1400, introCapMs),
      hardEntryCapMs,
    );

    const phraseEntry =
      phraseTimes.find((time) => time >= desiredEntryFloorMs && time <= desiredEntryCeilMs) ??
      phraseTimes.find((time) => time >= AUTOMIX_NEXT_ENTRY_MIN_MS && time <= softEntryCapMs);
    if (typeof phraseEntry === "number") {
      return finalizeEntryPoint(Math.min(phraseEntry, hardEntryCapMs));
    }

    const barEntry =
      barTimes.find((time) => time >= desiredEntryFloorMs && time <= desiredEntryCeilMs) ??
      barTimes.find((time) => time >= AUTOMIX_NEXT_ENTRY_MIN_MS && time <= softEntryCapMs);
    if (typeof barEntry === "number") {
      return finalizeEntryPoint(Math.min(barEntry, hardEntryCapMs));
    }

    const beatEntry =
      beatTimes.find((time) => time >= desiredEntryFloorMs && time <= desiredEntryCeilMs) ??
      beatTimes.find((time) => time >= AUTOMIX_NEXT_ENTRY_MIN_MS && time <= softEntryCapMs);
    if (typeof beatEntry === "number") {
      return finalizeEntryPoint(Math.min(beatEntry, hardEntryCapMs));
    }

    return clampNumber(
      Math.max(
        AUTOMIX_NEXT_ENTRY_DEFAULT_MS,
        trustedIntroEndMs > 0 ? trustedIntroEndMs - entryLeadInMs : 0,
      ),
      AUTOMIX_NEXT_ENTRY_MIN_MS,
      hardEntryCapMs,
    );
  };

  const resolveAutoMixTransitionTimingPlan = (
    currentAnalysis: AudioTrackAnalysis | null | undefined,
    nextAnalysis: AudioTrackAnalysis | null | undefined,
    fallbackDurationMs: number,
  ): AutoMixTransitionTimingPlan => {
    const fallbackPlan: AutoMixTransitionTimingPlan = {
      durationMs: fallbackDurationMs,
      reason: "fallback-transition-duration",
      currentOutroWindowMs: null,
      nextIntroWindowMs: null,
      targetOverlapMs: fallbackDurationMs,
    };

    if (!currentAnalysis || !nextAnalysis) {
      return fallbackPlan;
    }

    const currentDurationMs = currentAnalysis.durationMs > 0 ? currentAnalysis.durationMs : 0;
    const nextDurationMs = nextAnalysis.durationMs > 0 ? nextAnalysis.durationMs : 0;
    const currentOutroWindowMs =
      currentDurationMs > 0 &&
      typeof currentAnalysis.outroPhaseStartMs === "number" &&
      currentAnalysis.outroPhaseStartMs >= 0
        ? Math.max(0, currentDurationMs - currentAnalysis.outroPhaseStartMs)
        : null;
    const nextIntroWindowMs =
      nextDurationMs > 0 &&
      typeof nextAnalysis.introPhaseEndMs === "number" &&
      nextAnalysis.introPhaseEndMs > 0
        ? nextAnalysis.introPhaseEndMs
        : null;
    const structuralOverlapMs = Math.min(
      currentOutroWindowMs ?? fallbackDurationMs,
      nextIntroWindowMs ?? fallbackDurationMs,
    );
    const energyLiftRatio =
      currentAnalysis.outroEnergy > 0
        ? nextAnalysis.introEnergy / currentAnalysis.outroEnergy
        : 1;
    const targetOverlapMs = clampNumber(
      structuralOverlapMs * (energyLiftRatio >= 1.08 ? 1.12 : energyLiftRatio <= 0.9 ? 0.94 : 1),
      5200,
      12000,
    );

    return {
      durationMs: Math.round(targetOverlapMs),
      reason: "structural-overlap-window",
      currentOutroWindowMs,
      nextIntroWindowMs,
      targetOverlapMs: Math.round(targetOverlapMs),
    };
  };

  const resolveAutoMixTempoPlan = (
    currentAnalysis: AudioTrackAnalysis | null | undefined,
    nextAnalysis: AudioTrackAnalysis | null | undefined,
  ): AutoMixTempoPlan => {
    const fromTempoBpm =
      currentAnalysis?.estimatedTempoBpm && currentAnalysis.estimatedTempoBpm > 0
        ? currentAnalysis.estimatedTempoBpm
        : null;
    const toTempoBpm =
      nextAnalysis?.estimatedTempoBpm && nextAnalysis.estimatedTempoBpm > 0
        ? nextAnalysis.estimatedTempoBpm
        : null;

    if (!fromTempoBpm || !toTempoBpm) {
      return {
        enabled: false,
        fromStartRate: 1,
        fromEndRate: 1,
        toStartRate: 1,
        toEndRate: 1,
        fromTargetRate: 1,
        toTargetRate: 1,
        fromTempoBpm,
        toTempoBpm,
        targetTempoBpm: null,
        preservePitchDisabled: false,
        reason: "missing-tempo",
      };
    }

    const tempoRatio = toTempoBpm / fromTempoBpm;
    if (!Number.isFinite(tempoRatio) || tempoRatio <= 0) {
      return {
        enabled: false,
        fromStartRate: 1,
        fromEndRate: 1,
        toStartRate: 1,
        toEndRate: 1,
        fromTargetRate: 1,
        toTargetRate: 1,
        fromTempoBpm,
        toTempoBpm,
        targetTempoBpm: null,
        preservePitchDisabled: false,
        reason: "invalid-tempo-ratio",
      };
    }

    const targetTempoBpm = roundTo(
      fromTempoBpm * 0.34 + toTempoBpm * 0.66,
      3,
    );
    const fromTargetRate = clampPlaybackRate(targetTempoBpm / fromTempoBpm);
    const toTargetRate = clampPlaybackRate(targetTempoBpm / toTempoBpm);
    const rateDelta = Math.max(Math.abs(fromTargetRate - 1), Math.abs(toTargetRate - 1));

    if (rateDelta < 0.01) {
      return {
        enabled: false,
        fromStartRate: 1,
        fromEndRate: 1,
        toStartRate: 1,
        toEndRate: 1,
        fromTargetRate,
        toTargetRate,
        fromTempoBpm,
        toTempoBpm,
        targetTempoBpm,
        preservePitchDisabled: false,
        reason: "tempo-already-close",
      };
    }

    return {
      enabled: true,
      fromStartRate: clampPlaybackRate(1 + (fromTargetRate - 1) * 0.05),
      fromEndRate: clampPlaybackRate(1 + (fromTargetRate - 1) * 0.58),
      toStartRate: clampPlaybackRate(1 + (toTargetRate - 1) * 0.03),
      toEndRate: clampPlaybackRate(1 + (toTargetRate - 1) * 0.32),
      fromTargetRate,
      toTargetRate,
      fromTempoBpm,
      toTempoBpm,
      targetTempoBpm,
      preservePitchDisabled: true,
      reason: "front-loaded-converge-tight",
    };
  };

  const clearSongTransitionAnimation = () => {
    songTransitionSequenceRef.current += 1;
    if (songTransitionAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(songTransitionAnimationFrameRef.current);
      songTransitionAnimationFrameRef.current = null;
    }
  };

  const clearPreparedSongTransition = (options?: { resetAudio?: boolean }) => {
    songTransitionPreparationSequenceRef.current += 1;
    songTransitionPreparationKeyRef.current = null;
    songTransitionPreparationPromiseRef.current = null;

    const prepared = songTransitionPreparedRef.current;
    songTransitionPreparedRef.current = null;

    if (
      options?.resetAudio !== false &&
      prepared &&
      prepared.slot !== activeAudioSlotRef.current
    ) {
      resetAudioElement(getAudioElementBySlot(prepared.slot));
    }
  };

  const resolveTransitionDecision = (trackId: string | null, durationSeconds: number): TransitionDecision => {
    const fallbackDurationMs = Math.max(
      SONG_TRANSITION_MIN_MS,
      Math.min(SONG_TRANSITION_MAX_MS, settingsRef.current.playback.songTransitionStartMs),
    );
    const fallbackSeconds = fallbackDurationMs / 1000;
    const transitionMode = settingsRef.current.playback.songTransitionMode;

    if (
      transitionMode !== "auto-mix" ||
      !trackId ||
      durationSeconds <= 0
    ) {
      return {
        durationSeconds,
        transitionStartSeconds: fallbackSeconds,
        resolvedTransitionStartMs:
          durationSeconds > 0 ? Math.max(0, Math.round((durationSeconds - fallbackSeconds) * 1000)) : null,
        plannedTransitionDurationMs: fallbackDurationMs,
        transitionTimingPlan: {
          durationMs: fallbackDurationMs,
          reason: "simple-mix-fixed-duration",
          currentOutroWindowMs: null,
          nextIntroWindowMs: null,
          targetOverlapMs: fallbackDurationMs,
        },
        mode: transitionMode,
        source: "simple-mix-fallback" as const,
        suggestedTransitionStartMs: null,
        analysis: null,
        nextAnalysis: null,
        nextTrackId: null,
      };
    }

    const currentAnalysis = trackAnalysisByTrackIdRef.current[trackId];
    const nextTarget = resolveAdjacentPlaybackTarget(1, {
      fromEnded: true,
      allowRepeatOneRestart: false,
    });
    const nextTrackId =
      nextTarget && nextTarget.action === "play-track" ? nextTarget.trackId : null;
    const nextAnalysis = nextTrackId
      ? trackAnalysisByTrackIdRef.current[nextTrackId]
      : undefined;
    const transitionTimingPlan = resolveAutoMixTransitionTimingPlan(
      currentAnalysis,
      nextAnalysis,
      fallbackDurationMs,
    );
    const desiredOverlapSeconds = transitionTimingPlan.durationMs / 1000;
    const latestDesiredStartMs =
      durationSeconds > 0
        ? Math.max(0, Math.round((durationSeconds - desiredOverlapSeconds) * 1000))
        : null;
    const suggestedTransitionStartMs = currentAnalysis?.suggestedTransitionStartMs ?? null;
    const outroPhaseStartMs =
      currentAnalysis?.outroPhaseStartMs && currentAnalysis.outroPhaseStartMs > 0
        ? currentAnalysis.outroPhaseStartMs
        : null;
    if (!suggestedTransitionStartMs || suggestedTransitionStartMs <= 0) {
      const resolvedTransitionStartMs =
        latestDesiredStartMs !== null
          ? outroPhaseStartMs !== null
            ? Math.min(outroPhaseStartMs, latestDesiredStartMs)
            : latestDesiredStartMs
          : outroPhaseStartMs;
      return {
        durationSeconds,
        transitionStartSeconds:
          resolvedTransitionStartMs !== null
            ? Math.max(
                SONG_TRANSITION_MIN_MS / 1000,
                Math.min(
                  SONG_TRANSITION_MAX_MS / 1000,
                  durationSeconds - resolvedTransitionStartMs / 1000,
                ),
              )
            : fallbackSeconds,
        resolvedTransitionStartMs,
        plannedTransitionDurationMs: transitionTimingPlan.durationMs,
        transitionTimingPlan,
        mode: transitionMode,
        source: outroPhaseStartMs ? "auto-mix-outro-anchor" as const : "auto-mix-fallback" as const,
        suggestedTransitionStartMs: null,
        analysis: summarizeAutoMixAnalysis(currentAnalysis),
        nextAnalysis: summarizeAutoMixAnalysis(nextAnalysis),
        nextTrackId,
      };
    }

    const primaryStartMs = outroPhaseStartMs
      ? Math.max(outroPhaseStartMs, suggestedTransitionStartMs)
      : suggestedTransitionStartMs;
    const boundedStartMs = Math.max(
      0,
      Math.min(
        Math.round(durationSeconds * 1000) - SONG_TRANSITION_MIN_MS,
        primaryStartMs,
      ),
    );
    const remainingSeconds = durationSeconds - boundedStartMs / 1000;
    if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) {
      return {
        durationSeconds,
        transitionStartSeconds: fallbackSeconds,
        resolvedTransitionStartMs:
          durationSeconds > 0 ? Math.max(0, Math.round((durationSeconds - fallbackSeconds) * 1000)) : null,
        plannedTransitionDurationMs: transitionTimingPlan.durationMs,
        transitionTimingPlan,
        mode: transitionMode,
        source: "auto-mix-fallback" as const,
        suggestedTransitionStartMs,
        analysis: summarizeAutoMixAnalysis(currentAnalysis),
        nextAnalysis: summarizeAutoMixAnalysis(nextAnalysis),
        nextTrackId,
      };
    }

    let resolvedTransitionStartMs = boundedStartMs;
    const latestSafeStartMs = Math.max(
      0,
      Math.round((durationSeconds - SONG_TRANSITION_MIN_MS / 1000) * 1000),
    );
    resolvedTransitionStartMs = Math.min(
      latestSafeStartMs,
      Math.max(resolvedTransitionStartMs, 0),
    );
    if (latestDesiredStartMs !== null) {
      resolvedTransitionStartMs = Math.min(resolvedTransitionStartMs, latestDesiredStartMs);
    }

    if (nextAnalysis) {
      const introToOutroRatio =
        currentAnalysis && currentAnalysis.outroEnergy > 0
          ? nextAnalysis.introEnergy / currentAnalysis.outroEnergy
          : 1;

      if (introToOutroRatio >= 1.08) {
        resolvedTransitionStartMs = Math.max(
          0,
          Math.round(resolvedTransitionStartMs - 2200),
        );
      } else if (introToOutroRatio <= 0.9) {
        resolvedTransitionStartMs = Math.max(
          0,
          Math.round(resolvedTransitionStartMs - 1200),
        );
      }
    }

    resolvedTransitionStartMs = Math.max(
      0,
      Math.min(latestSafeStartMs, resolvedTransitionStartMs),
    );

    const transitionStartSeconds = Math.max(
      SONG_TRANSITION_MIN_MS / 1000,
      Math.min(SONG_TRANSITION_MAX_MS / 1000, durationSeconds - resolvedTransitionStartMs / 1000),
    );

    return {
      durationSeconds,
      transitionStartSeconds,
      resolvedTransitionStartMs,
      plannedTransitionDurationMs: transitionTimingPlan.durationMs,
      transitionTimingPlan,
      mode: transitionMode,
      source: nextAnalysis ? "auto-mix-outro-led-pair-analysis" as const : "auto-mix-outro-led-analysis" as const,
      suggestedTransitionStartMs,
      analysis: summarizeAutoMixAnalysis(currentAnalysis),
      nextAnalysis: summarizeAutoMixAnalysis(nextAnalysis),
      nextTrackId,
    };
  };

  const getTransitionDecision = (trackId: string | null, durationSeconds: number): TransitionDecision => {
    if (!trackId) {
      return resolveTransitionDecision(trackId, durationSeconds);
    }

    const cachedDecision = autoMixDecisionCacheRef.current[trackId];
    if (
      cachedDecision &&
      Math.abs(cachedDecision.durationSeconds - durationSeconds) <= 0.25
    ) {
      return cachedDecision;
    }

    return resolveTransitionDecision(trackId, durationSeconds);
  };

  const shouldPrepareSongTransition = (options: {
    currentTrackId: string;
    currentTimeSeconds: number;
    durationSeconds: number;
  }) => {
    const transitionStartSeconds = getTransitionDecision(
      options.currentTrackId,
      options.durationSeconds,
    ).transitionStartSeconds;
    const preloadStartSeconds = transitionStartSeconds + SONG_TRANSITION_PRELOAD_LEAD_MS / 1000;
    const remainingSeconds = options.durationSeconds - options.currentTimeSeconds;

    return (
      options.currentTimeSeconds >= 1 &&
      options.durationSeconds > 0 &&
      remainingSeconds <= preloadStartSeconds &&
      remainingSeconds > transitionStartSeconds
    );
  };

  const shouldStartSongTransitionNow = (options: {
    currentTrackId: string;
    currentTimeSeconds: number;
    durationSeconds: number;
  }) => {
    const transitionStartSeconds = getTransitionDecision(
      options.currentTrackId,
      options.durationSeconds,
    ).transitionStartSeconds;
    const remainingSeconds = options.durationSeconds - options.currentTimeSeconds;

    return (
      options.currentTimeSeconds >= 1 &&
      options.durationSeconds > 0 &&
      remainingSeconds <= transitionStartSeconds
    );
  };

  const cacheAutoMixDecisionIfReady = (trackId: string, durationSeconds: number) => {
    if (
      settingsRef.current.playback.songTransitionMode !== "auto-mix" ||
      durationSeconds <= 0
    ) {
      return null;
    }

    const target = resolveAdjacentPlaybackTarget(1, {
      fromEnded: true,
      allowRepeatOneRestart: false,
    });
    if (!target || target.action !== "play-track" || !target.trackId) {
      return null;
    }

    const currentAnalysis = trackAnalysisByTrackIdRef.current[trackId];
    const nextAnalysis = trackAnalysisByTrackIdRef.current[target.trackId];
    if (!currentAnalysis || !nextAnalysis) {
      return null;
    }

    const decision = resolveTransitionDecision(trackId, durationSeconds);
    setBoundedRecordValue<TransitionDecision | null>(
      autoMixDecisionCacheRef.current,
      trackId,
      decision,
      AUTO_MIX_DECISION_CACHE_LIMIT,
      collectPlaybackCacheProtectedTrackIds(),
    );
    console.log("[automix]", {
      phase: "decision-ready",
      currentTrackId: trackId,
      mode: decision.mode,
      source: decision.source,
      durationSeconds: roundTo(decision.durationSeconds, 3),
      transitionStartSeconds: roundTo(decision.transitionStartSeconds, 3),
      resolvedTransitionStartMs: decision.resolvedTransitionStartMs,
      suggestedTransitionStartMs: decision.suggestedTransitionStartMs,
      outroPhaseStartMs: decision.analysis?.outroPhaseStartMs ?? null,
      nextTrackId: decision.nextTrackId,
      analysis: decision.analysis,
      nextAnalysis: decision.nextAnalysis,
    });
    return decision;
  };

  const cancelSongTransition = (options?: {
    pauseFadingOut?: boolean;
    resetInactiveAudio?: boolean;
    restoreActiveVolume?: boolean;
    cancelAutoMixForSourceTrack?: boolean;
  }) => {
    clearSongTransitionAnimation();
    clearPreparedSongTransition({ resetAudio: options?.resetInactiveAudio !== false });
    isSongTransitionRunningRef.current = false;
    songTransitionSourceTrackIdRef.current = null;
    syncTimelineOwnerMode("active");
    setIsAutoMixTransitionActive(false);

    const fadingOutAudio = songTransitionFromAudioRef.current;
    const incomingAudio = songTransitionToAudioRef.current;
    const sourceTrackId = songTransitionSourceTrackIdRef.current;

    if (options?.cancelAutoMixForSourceTrack && sourceTrackId) {
      cancelledAutoMixTrackIdRef.current = sourceTrackId;
    }

    songTransitionFromAudioRef.current = null;
    songTransitionToAudioRef.current = null;

    if (fadingOutAudio && sourceTrackId) {
      const sourceSlot: AudioSlot =
        fadingOutAudio === secondaryAudioRef.current ? "secondary" : "primary";
      const sourceTrack = trackLookup.get(sourceTrackId) ?? currentTrackRef.current;

      syncActiveAudioReference(sourceSlot);

      if (sourceTrack && currentTrackIdRef.current !== sourceTrackId) {
        currentTrackRef.current = sourceTrack;
        currentTrackIdRef.current = sourceTrackId;
        setCurrentTrackId(sourceTrackId);
      }

      syncPlaybackVisualState({
        currentTimeSeconds:
          Number.isFinite(fadingOutAudio.currentTime) && fadingOutAudio.currentTime >= 0
            ? fadingOutAudio.currentTime
            : currentTimeSecondsRef.current,
        visualCurrentTimeSeconds:
          Number.isFinite(fadingOutAudio.currentTime) && fadingOutAudio.currentTime >= 0
            ? fadingOutAudio.currentTime
            : visualCurrentTimeSecondsRef.current,
        durationSeconds:
          Number.isFinite(fadingOutAudio.duration) && fadingOutAudio.duration > 0
            ? fadingOutAudio.duration
            : durationSecondsRef.current,
        isPlaybackLoading: false,
      });
      syncPlaybarProgressFromAudio(fadingOutAudio, {
        trackId: sourceTrackId,
        fallbackDurationSeconds:
          Number.isFinite(fadingOutAudio.duration) && fadingOutAudio.duration > 0
            ? fadingOutAudio.duration
            : durationSecondsRef.current,
      });
    }

    if (fadingOutAudio) {
      if (options?.pauseFadingOut !== false) {
        fadingOutAudio.pause();
      }
      resetProcessedAudioChain(fadingOutAudio);
    }

    if (incomingAudio && options?.restoreActiveVolume !== false) {
      resetProcessedAudioChain(incomingAudio);
    }

    if (options?.resetInactiveAudio !== false) {
      resetAudioElement(getInactiveAudioElement());
    }
  };

  useEffect(() => {
    console.log("[automix-ui]", {
      visible: isAutoMixTransitionActive,
      badgePhase: autoMixBadgePhase,
      currentTrackId,
      mode: settings.playback.songTransitionMode,
      transitionEnabled: settings.playback.songTransitionEnabled,
    });
  }, [
    autoMixBadgePhase,
    currentTrackId,
    isAutoMixTransitionActive,
    settings.playback.songTransitionEnabled,
    settings.playback.songTransitionMode,
  ]);

  useEffect(() => {
    if (isAutoMixTransitionActive) {
      setAutoMixBadgePhase((current) =>
        current === "visible" || current === "entering" ? current : "entering",
      );
      const visibleTimer = window.setTimeout(() => {
        setAutoMixBadgePhase((current) => (current === "entering" ? "visible" : current));
      }, 220);

      return () => {
        window.clearTimeout(visibleTimer);
      };
    }

    setAutoMixBadgePhase((current) => {
      if (current === "hidden" || current === "leaving") {
        return current;
      }
      return "leaving";
    });
    const hideTimer = window.setTimeout(() => {
      setAutoMixBadgePhase("hidden");
    }, 260);

    return () => {
      window.clearTimeout(hideTimer);
    };
  }, [isAutoMixTransitionActive]);

  const prepareAudioElementWithCandidates = async (
    audio: HTMLAudioElement,
    trackId: string,
    candidates: string[],
  ) => {
    const timeoutMs = Math.min(
      20000,
      Math.max(2500, settingsRef.current.network.requestTimeoutMs || 10000),
    );

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const didLoad = await new Promise<boolean>((resolve) => {
        let settled = false;

        const cleanup = () => {
          audio.removeEventListener("canplay", handleReady);
          audio.removeEventListener("canplaythrough", handleReady);
          audio.removeEventListener("loadedmetadata", handleReady);
          audio.removeEventListener("error", handleError);
          window.clearTimeout(timeoutId);
        };

        const handleReady = () => {
          if (settled) {
            return;
          }

          settled = true;
          cleanup();
          resolve(true);
        };

        const handleError = () => {
          if (settled) {
            return;
          }

          settled = true;
          cleanup();
          resolve(false);
        };

        const timeoutId = window.setTimeout(handleError, timeoutMs);

        audio.addEventListener("canplay", handleReady);
        audio.addEventListener("canplaythrough", handleReady);
        audio.addEventListener("loadedmetadata", handleReady);
        audio.addEventListener("error", handleError);
        audio.dataset.trackId = trackId;
        audio.src = candidate;
        audio.load();
      });

      if (didLoad) {
        return index;
      }
    }

    return -1;
  };

  const ensureSongTransitionPrepared = async (
    target: NonNullable<ReturnType<typeof resolveAdjacentPlaybackTarget>>,
    sourceTrackId: string,
  ) => {
    if (target.action !== "play-track" || !target.trackId) {
      return null;
    }

    const key = `${sourceTrackId}=>${target.trackId}`;
    const prepared = songTransitionPreparedRef.current;
    if (prepared && prepared.key === key) {
      return prepared;
    }

    if (
      songTransitionPreparationKeyRef.current === key &&
      songTransitionPreparationPromiseRef.current
    ) {
      return songTransitionPreparationPromiseRef.current;
    }

    clearPreparedSongTransition();
    songTransitionPreparationKeyRef.current = key;
    const sequence = songTransitionPreparationSequenceRef.current;

    const promise = (async (): Promise<PreparedSongTransition | null> => {
      try {
        const inactiveSlot: AudioSlot =
          activeAudioSlotRef.current === "primary" ? "secondary" : "primary";
        const targetTrack = findTrackById(target.trackId);
        const toAudio = getAudioElementBySlot(inactiveSlot);

        if (!targetTrack || !toAudio || currentTrackIdRef.current !== sourceTrackId) {
          return null;
        }

        const preparedTrack = await ensureTrackReadyForPlayback(targetTrack, {
          announceNotice: false,
        });

        if (
          songTransitionPreparationSequenceRef.current !== sequence ||
          currentTrackIdRef.current !== sourceTrackId
        ) {
          return null;
        }

        if (settingsRef.current.playback.songTransitionMode === "auto-mix") {
          await ensureTrackAnalysis(preparedTrack);
        }

        const nextCandidates = resolveTrackPlaybackCandidates(
          preparedTrack,
          settingsRef.current,
          playbackCachedAudioPathsRef.current[preparedTrack.id] ?? null,
        );
        if (nextCandidates.length === 0) {
          return null;
        }

        resetAudioElement(toAudio);
        toAudio.volume = 0;

        const candidateIndex = await prepareAudioElementWithCandidates(
          toAudio,
          preparedTrack.id,
          nextCandidates,
        );

        if (
          candidateIndex < 0 ||
          songTransitionPreparationSequenceRef.current !== sequence ||
          currentTrackIdRef.current !== sourceTrackId
        ) {
          resetAudioElement(toAudio);
          return null;
        }

        const nextPrepared: PreparedSongTransition = {
          key,
          sourceTrackId,
          targetTrackId: preparedTrack.id,
          slot: inactiveSlot,
          preparedTrack,
          nextCandidates,
          candidateIndex,
        };

        songTransitionPreparedRef.current = nextPrepared;
        return nextPrepared;
      } finally {
        if (songTransitionPreparationSequenceRef.current === sequence) {
          songTransitionPreparationKeyRef.current = null;
          songTransitionPreparationPromiseRef.current = null;
        }
      }
    })();

    songTransitionPreparationPromiseRef.current = promise;
    return promise;
  };

  useEffect(() => {
    syncActiveAudioReference(activeAudioSlotRef.current);
  }, []);

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    let isDisposed = false;

    const syncMaximizedState = async () => {
      if (isDisposed) {
        return;
      }

      const [nextIsMaximized, nextIsFullscreen] = await Promise.all([
        currentWindow.isMaximized(),
        currentWindow.isFullscreen(),
      ]);
      if (isDisposed) {
        return;
      }
      syncWindowFrameStateValue(nextIsMaximized, nextIsFullscreen);
    };

    const persistWindowSize = async (width: number, height: number, nextKey: string) => {
      const normalizedWidth = normalizeWindowDimension(width, MIN_WINDOW_WIDTH);
      const normalizedHeight = normalizeWindowDimension(height, MIN_WINDOW_HEIGHT);
      const nextSettings: AppSettings = {
        ...settingsRef.current,
        window: {
          width: normalizedWidth,
          height: normalizedHeight,
        },
      };

      settingsRef.current = nextSettings;
      setSettings(nextSettings);

      try {
        const snapshot = await saveAppSettings(nextSettings);
        if (isDisposed) {
          return;
        }

        applySavedSettingsSnapshot(nextSettings, snapshot);
      } catch (error) {
        console.error("[window] failed to save window size", error);
      } finally {
        if (pendingWindowSizeKeyRef.current === nextKey) {
          pendingWindowSizeKeyRef.current = "";
        }
      }
    };

    const queueWindowSizeSave = async () => {
      await syncMaximizedState();

      if (isDisposed || isSettingsLoadingRef.current) {
        return;
      }

      const [isMaximizedWindow, isFullscreenWindow, innerSize, scaleFactor] = await Promise.all([
        currentWindow.isMaximized(),
        currentWindow.isFullscreen(),
        currentWindow.innerSize(),
        currentWindow.scaleFactor(),
      ]);

      if (isDisposed || isMaximizedWindow || isFullscreenWindow) {
        return;
      }

      const width = normalizeWindowDimension(innerSize.width / scaleFactor, MIN_WINDOW_WIDTH);
      const height = normalizeWindowDimension(innerSize.height / scaleFactor, MIN_WINDOW_HEIGHT);
      const nextKey = buildWindowSizeKey(width, height);

      if (
        nextKey === savedWindowSizeKeyRef.current ||
        nextKey === pendingWindowSizeKeyRef.current
      ) {
        return;
      }

      pendingWindowSizeKeyRef.current = nextKey;

      if (windowSizeSaveTimerRef.current) {
        window.clearTimeout(windowSizeSaveTimerRef.current);
      }

      windowSizeSaveTimerRef.current = window.setTimeout(() => {
        windowSizeSaveTimerRef.current = null;
        void persistWindowSize(width, height, nextKey);
      }, 260);
    };

    void syncMaximizedState();

    let unlistenResized: (() => void) | undefined;
    let unlistenMoved: (() => void) | undefined;

    void currentWindow
      .onResized(async () => {
        await queueWindowSizeSave();
      })
      .then((unlisten) => {
        unlistenResized = unlisten;
      });

    void currentWindow
      .onMoved(async () => {
        await syncMaximizedState();
      })
      .then((unlisten) => {
        unlistenMoved = unlisten;
      });

    return () => {
      isDisposed = true;
      if (windowSizeSaveTimerRef.current) {
        window.clearTimeout(windowSizeSaveTimerRef.current);
        windowSizeSaveTimerRef.current = null;
      }
      unlistenResized?.();
      unlistenMoved?.();
    };
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    return () => {
      playbackCachedAudioPathsRef.current = {};
      playbackCacheRequestsRef.current = {};
    };
  }, []);

  useEffect(() => {
    isMaximizedRef.current = isMaximized;
  }, [isMaximized]);

  useEffect(() => {
    isFullscreenRef.current = isFullscreen;
  }, [isFullscreen]);

  useEffect(() => {
    playbarArtworkOverrideUrlRef.current = playbarArtworkOverrideUrl;
  }, [playbarArtworkOverrideUrl]);

  useEffect(() => {
    appBackgroundMvVideoSrcRef.current = appBackgroundMvVideoSrc;
  }, [appBackgroundMvVideoSrc]);

  useEffect(() => {
    immersiveBackgroundMvVideoSrcRef.current = immersiveBackgroundMvVideoSrc;
  }, [immersiveBackgroundMvVideoSrc]);

  useEffect(() => {
    contextMenuStateRef.current = contextMenuState;
  }, [contextMenuState]);

  useEffect(() => {
    isSettingsLoadingRef.current = isSettingsLoading;
  }, [isSettingsLoading]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!volumePopoverRef.current?.contains(event.target as Node)) {
        setIsVolumePopoverOpen(false);
      }
      if (!queuePopoverRef.current?.contains(event.target as Node)) {
        setIsQueuePopoverOpen(false);
      }
      if (!(event.target instanceof HTMLElement) || !event.target.closest(".app-context-menu")) {
        closeContextMenu();
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    if (!contextMenuState) {
      return;
    }

    const handleResize = () => {
      closeContextMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleResize, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleResize, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenuState]);

  useEffect(() => {
    if (!contextMenuState) {
      return;
    }

    if (contextMenuState.target.kind === "blank") {
      return;
    }

    if (
      contextMenuState.target.kind === "song" &&
      getNeteaseTrackIdFromContextSong(contextMenuState.target.payload) === null
    ) {
      return;
    }

    if (
      !isNeteaseSourceEnabled(settingsRef.current) ||
      settingsRef.current.network.neteaseCookie.trim().length === 0
    ) {
      setContextMenuOwnedPlaylists([]);
      return;
    }

    void ensureOwnedPlaylistsForContextMenu().catch((error) => {
      console.error("[context-menu] failed to preload playlists", error);
      setContextMenuOwnedPlaylists([]);
    });
  }, [contextMenuState]);

  useEffect(() => {
    if (isQueuePopoverOpen) {
      return;
    }

    setDraggingQueueTrackId(null);
    setQueueDropIndex(null);
    setQueueDragState(null);
  }, [isQueuePopoverOpen]);

  useEffect(() => {
    queueDragStateRef.current = queueDragState;
  }, [queueDragState]);

  useEffect(() => {
    queueDropIndexRef.current = queueDropIndex;
  }, [queueDropIndex]);

  useEffect(() => {
    if (!isQueuePopoverOpen || !currentTrackId) {
      return;
    }

    let frameId = 0;
    frameId = window.requestAnimationFrame(() => {
      const queueList = queueListRef.current;
      const currentQueueItem = queueItemRefs.current.get(currentTrackId);
      if (!queueList || !currentQueueItem) {
        return;
      }

      const targetScrollTop =
        currentQueueItem.offsetTop -
        Math.max(0, (queueList.clientHeight - currentQueueItem.offsetHeight) / 2);

      queueList.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: "smooth",
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [currentTrackId, isQueuePopoverOpen]);

  useEffect(() => {
    if (!draggingQueueTrackId) {
      return;
    }

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";

    const processQueueDragPointer = (clientX: number, clientY: number) => {
      const activeDrag = queueDragStateRef.current;
      if (!activeDrag) {
        return;
      }

      const dragTop = clientY - activeDrag.offsetY;
      const dragBottom = dragTop + activeDrag.height;
      const queueList = queueListRef.current;

      if (queueList) {
        const edgeThreshold = 36;

        if (dragTop < activeDrag.listTop + edgeThreshold) {
          queueList.scrollTop -= Math.max(8, ((activeDrag.listTop + edgeThreshold) - dragTop) * 0.4);
        } else if (dragBottom > activeDrag.listBottom - edgeThreshold) {
          queueList.scrollTop += Math.max(8, (dragBottom - (activeDrag.listBottom - edgeThreshold)) * 0.4);
        }
      }

      const dragCenterContentY =
        dragTop -
        activeDrag.listTop +
        (queueList?.scrollTop ?? activeDrag.listScrollTop) +
        activeDrag.height / 2;

      setQueueDragState((current) =>
        current
          ? {
              ...current,
              pointerX: clientX,
              pointerY: clientY,
            }
          : current,
      );

      const sourceQueueIds =
        activeDrag.queueIds.length > 0
          ? activeDrag.queueIds
          : currentQueueIdsRef.current.length > 0
            ? currentQueueIdsRef.current
            : playbackQueueIds;
      const visibleQueueIds = sourceQueueIds.filter((trackId) => trackId !== activeDrag.trackId);
      let nextDropIndex = visibleQueueIds.length;

      for (let index = 0; index < visibleQueueIds.length; index += 1) {
        const trackId = visibleQueueIds[index];
        const rowCenter = activeDrag.rowCenters[trackId];
        if (typeof rowCenter === "number" && dragCenterContentY < rowCenter) {
          nextDropIndex = index;
          break;
        }
      }

      setQueueDropIndex((current) => (current === nextDropIndex ? current : nextDropIndex));
    };

    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      queueDragPointerRef.current = {
        x: event.clientX,
        y: event.clientY,
      };

      if (queueDragFrameRef.current !== null) {
        return;
      }

      queueDragFrameRef.current = window.requestAnimationFrame(() => {
        queueDragFrameRef.current = null;
        const nextPointer = queueDragPointerRef.current;
        if (!nextPointer) {
          return;
        }

        processQueueDragPointer(nextPointer.x, nextPointer.y);
      });
    };

    const finishQueueDrag = () => {
      if (queueDragFrameRef.current !== null) {
        window.cancelAnimationFrame(queueDragFrameRef.current);
        queueDragFrameRef.current = null;
      }

      const pendingPointer = queueDragPointerRef.current;
      if (pendingPointer) {
        processQueueDragPointer(pendingPointer.x, pendingPointer.y);
      }
      queueDragPointerRef.current = null;

      const activeDrag = queueDragStateRef.current;
      if (!activeDrag) {
        setDraggingQueueTrackId(null);
        setQueueDropIndex(null);
        setQueueDragState(null);
        return;
      }

      const nextDropIndex = queueDropIndexRef.current ?? activeDrag.initialIndex;
      const sourceQueueIds =
        activeDrag.queueIds.length > 0
          ? activeDrag.queueIds
          : currentQueueIdsRef.current.length > 0
            ? currentQueueIdsRef.current
            : playbackQueueIds;
      const normalizedDropIndex = Math.max(0, Math.min(nextDropIndex, sourceQueueIds.length - 1));
      handleReorderQueueTrack(activeDrag.trackId, normalizedDropIndex);

      setDraggingQueueTrackId(null);
      setQueueDropIndex(null);
      setQueueDragState(null);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", finishQueueDrag);
    window.addEventListener("pointercancel", finishQueueDrag);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      if (queueDragFrameRef.current !== null) {
        window.cancelAnimationFrame(queueDragFrameRef.current);
        queueDragFrameRef.current = null;
      }
      queueDragPointerRef.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishQueueDrag);
      window.removeEventListener("pointercancel", finishQueueDrag);
    };
  }, [draggingQueueTrackId, playbackQueueIds]);

  useEffect(() => {
    return () => {
      if (volumeSaveTimerRef.current) {
        window.clearTimeout(volumeSaveTimerRef.current);
      }

      if (playbackModeSaveTimerRef.current) {
        window.clearTimeout(playbackModeSaveTimerRef.current);
      }

      if (contextMenuCloseTimerRef.current) {
        window.clearTimeout(contextMenuCloseTimerRef.current);
      }

      if (playlistEditorCloseTimerRef.current) {
        window.clearTimeout(playlistEditorCloseTimerRef.current);
      }

      if (kugouManualRetryCloseTimerRef.current) {
        window.clearTimeout(kugouManualRetryCloseTimerRef.current);
      }

      if (settingsAutoSaveTimerRef.current) {
        window.clearTimeout(settingsAutoSaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isWindowVisibleForUi) {
      return;
    }

    const updateLabels = () => {
      const now = new Date();
      setCurrentTimeLabel(
        formatDynamicIslandPrimaryLabel(
          now,
          settings.appearance.dynamicIslandDefaultContent,
          copy.locale,
        ),
      );
      setDetailedTimeLabel(
        formatDynamicIslandDetailedLabel(
          now,
          settings.appearance.dynamicIslandDefaultContent,
          copy.locale,
        ),
      );
    };

    updateLabels();
    const timer = window.setInterval(() => {
      updateLabels();
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [copy.locale, isWindowVisibleForUi, settings.appearance.dynamicIslandDefaultContent]);

  useEffect(() => {
    document.documentElement.lang = copy.locale;
  }, [copy.locale]);

  useEffect(() => {
    const expandTimer = window.setTimeout(() => {
      setAppGreetingPhase("expand");
    }, APP_GREETING_HOLD_MS);

    const exitTimer = window.setTimeout(() => {
      setAppGreetingPhase("exit");
    }, APP_GREETING_HOLD_MS + APP_GREETING_VISIBLE_MS);

    const hideTimer = window.setTimeout(() => {
      setAppGreetingPhase("hidden");
    }, APP_GREETING_HOLD_MS + APP_GREETING_VISIBLE_MS + APP_GREETING_EXIT_MS);

    return () => {
      window.clearTimeout(expandTimer);
      window.clearTimeout(exitTimer);
      window.clearTimeout(hideTimer);
    };
  }, []);

  useEffect(() => {
    if (isSettingsLoading) {
      return;
    }

    let isDisposed = false;
    let pollTimer = 0;
    let hasReportedStartFailure = false;
    const shouldManageLocalApi =
      settings.network.useLocalApiServer && settings.network.enabledSources.includes("netease");
    const disableLocalApiServerSetting = async () => {
      const currentSettings = settingsRef.current;
      if (!currentSettings.network.useLocalApiServer) {
        return;
      }

      const nextSettings: AppSettings = {
        ...currentSettings,
        network: {
          ...currentSettings.network,
          useLocalApiServer: false,
        },
      };

      settingsRef.current = nextSettings;
      setSettings(nextSettings);

      try {
        const snapshot = await saveAppSettings(nextSettings);
        applySavedSettingsSnapshot(nextSettings, snapshot);
      } catch (error) {
        console.error("[network] failed to disable local api server after startup failure", error);
      }
    };

    const updateStatus = async (syncProcess: boolean) => {
      try {
        const status = syncProcess
          ? await syncLocalNeteaseApiServer(settings)
          : await getLocalNeteaseApiServerStatus(settings);
        if (isDisposed) {
          return;
        }

        setLocalNeteaseApiStatus(status);
        setLocalNeteaseApiRuntimeBaseUrl(
          status.enabled ? status.url.replace(/\/+$/, "") : null,
        );
        if (
          shouldManageLocalApi &&
          status.enabled &&
          !status.running &&
          !status.starting &&
          !hasReportedStartFailure
        ) {
          hasReportedStartFailure = true;
          pushDynamicIslandNotification(localeStrings.notifications.localApiServerStartFailed);
          void disableLocalApiServerSetting();
        }
      } catch (error) {
        if (isDisposed) {
          return;
        }

        console.error("[network] failed to sync local netease api server", error);
        setLocalNeteaseApiStatus(null);
        setLocalNeteaseApiRuntimeBaseUrl(null);
        if (shouldManageLocalApi && !hasReportedStartFailure) {
          hasReportedStartFailure = true;
          pushDynamicIslandNotification(localeStrings.notifications.localApiServerStartFailed);
          void disableLocalApiServerSetting();
        }
      }
    };

    if (!isWindowVisibleForUi) {
      return () => {
        isDisposed = true;
      };
    }

    void updateStatus(true);

    if (shouldManageLocalApi) {
      pollTimer = window.setInterval(() => {
        void updateStatus(false);
      }, 1200);
    } else {
      setLocalNeteaseApiStatus(null);
      setLocalNeteaseApiRuntimeBaseUrl(null);
    }

    return () => {
      isDisposed = true;
      if (pollTimer) {
        window.clearInterval(pollTimer);
      }
    };
  }, [
    isWindowVisibleForUi,
    isSettingsLoading,
    settings.network.enabledSources.join("|"),
    settings.network.neteaseApiBaseUrl,
    settings.network.neteaseCookie,
    settings.network.neteaseProxy,
    settings.network.neteaseRealIp,
    settings.network.useLocalApiServer,
  ]);

  useEffect(() => {
    if (!dynamicIslandNotification) {
      setDynamicIslandNotificationPhase("idle");
      return;
    }

    setDynamicIslandNotificationPhase("enter");

    const enterTimer = window.setTimeout(() => {
      setDynamicIslandNotificationPhase((current) =>
        current === "enter" ? "visible" : current,
      );
    }, 360);

    const exitTimer = window.setTimeout(() => {
      setDynamicIslandNotificationPhase((current) =>
        current === "enter" || current === "visible" ? "swap" : current,
      );
    }, 2800);

    return () => {
      window.clearTimeout(enterTimer);
      window.clearTimeout(exitTimer);
    };
  }, [dynamicIslandNotification?.id]);

  useEffect(() => {
    if (!dynamicIslandNotification || dynamicIslandNotificationPhase !== "swap") {
      return;
    }

    const timer = window.setTimeout(() => {
      setDynamicIslandNotificationPhase((current) => (current === "swap" ? "exit" : current));
    }, 240);

    return () => {
      window.clearTimeout(timer);
    };
  }, [dynamicIslandNotification, dynamicIslandNotificationPhase]);

  useEffect(() => {
    if (!dynamicIslandNotification || dynamicIslandNotificationPhase !== "exit") {
      return;
    }

    const timer = window.setTimeout(() => {
      setDynamicIslandNotification((current) =>
        current?.id === dynamicIslandNotification.id ? null : current,
      );
      setDynamicIslandNotificationPhase("idle");
    }, 360);

    return () => {
      window.clearTimeout(timer);
    };
  }, [dynamicIslandNotification, dynamicIslandNotificationPhase]);

  useEffect(() => {
    if (activeNav !== "library") {
      setLibraryView("hub");
    }
  }, [activeNav]);

  useEffect(() => {
    let isMounted = true;

    void getAppSettings()
      .then((snapshot) => {
        if (!isMounted) {
          return;
        }

        setSettings(snapshot.settings);
        settingsRef.current = snapshot.settings;
        syncPersistedSettingsState(snapshot.settings);
        setVolume(snapshot.settings.playback.defaultVolume);
        setPlaybackMode(snapshot.settings.playback.playbackMode);
        savedWindowSizeKeyRef.current = buildWindowSizeKey(
          snapshot.settings.window.width,
          snapshot.settings.window.height,
        );
        pendingWindowSizeKeyRef.current = "";
        if (snapshot.settings.library.scanDirectories.length > 0) {
          void runMediaImport(snapshot.settings.library.scanDirectories, null);
        }
      })
      .catch((error: unknown) => {
        console.error("[settings] failed to load settings", error);
        if (isMounted) {
          pushDynamicIslandNotification(localeStrings.notifications.settingsLoadFailed);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsSettingsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!settings.library.watchDirectories || settings.library.scanDirectories.length === 0) {
      return;
    }

    const timer = window.setInterval(() => {
      void runMediaImport(settings.library.scanDirectories, null);
    }, 30000);

    return () => {
      window.clearInterval(timer);
    };
  }, [settings.library.watchDirectories, settings.library.scanDirectories]);

  useEffect(() => {
    let isMounted = true;

    void listMediaLibrary()
      .then((snapshot) => {
        if (!isMounted) {
          return;
        }

        setMediaLibrary(snapshot);
      })
      .catch((error: unknown) => {
        console.error("[media] failed to load library", error);
        if (isMounted) {
          pushDynamicIslandNotification(localeStrings.notifications.libraryLoadFailed);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLibraryLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const libraryTracks = mediaLibrary?.tracks ?? [];

  useEffect(() => {
    if (isSettingsLoading || isLibraryLoading || hasRestoredPlaybackStateRef.current) {
      return;
    }

    hasRestoredPlaybackStateRef.current = true;

    const persistedState = readPersistedPlaybackResumeState();
    const fallbackQueueIds = settings.playback.rememberQueue
      ? settings.playback.resumeQueueTrackIds.filter((trackId) => Boolean(trackId))
      : [];
    const fallbackTrackId = settings.playback.rememberQueue ? settings.playback.resumeTrackId : null;
    const rawQueueIds =
      persistedState.queueIds.length > 0
        ? persistedState.queueIds
        : fallbackQueueIds;
    const rawTrackIdCandidate = persistedState.trackId ?? fallbackTrackId;
    const hasRestorableQueue = rawQueueIds.length > 0;
    const hasRestorableTrack = Boolean(rawTrackIdCandidate);
    const hasRestorablePlaybackState = hasRestorableQueue || hasRestorableTrack;

    if (!hasRestorablePlaybackState) {
      return;
    }

    setPlaybackRestoreSession({
      status: "scheduled",
      queueIds: rawQueueIds,
      trackId: rawTrackIdCandidate,
      sequence: playbackRestoreSequenceRef.current + 1,
    });
  }, [
    isLibraryLoading,
    isSettingsLoading,
    settings.playback.rememberQueue,
    settings.playback.resumeQueueTrackIds,
    settings.playback.resumeTrackId,
  ]);

  useEffect(() => {
    let isDisposed = false;

    if (isSettingsLoading || isLibraryLoading || !playbackRestoreSession) {
      return;
    }

    const restorePlaybackState = async () => {
      const restoreSession = playbackRestoreSession;
      const restoreSequence = restoreSession.sequence;
      const rawQueueIds = restoreSession.queueIds;
      const rawTrackIdCandidate = restoreSession.trackId;

      if (restoreSession.status === "scheduled") {
        setPlaybackRestoreSession((current) =>
          current && current.sequence === restoreSequence
            ? {
                ...current,
                status: "hydrating",
              }
            : current,
        );
      }
      const missingNeteaseTrackIds = Array.from(
        new Set(
          [...rawQueueIds, rawTrackIdCandidate]
            .filter((trackId): trackId is string => Boolean(trackId))
            .flatMap((trackId) => {
              if (findTrackById(trackId)) {
                return [];
              }

              const neteaseTrackId = parseNeteaseTrackIdFromCacheKey(trackId);
              return neteaseTrackId ? [neteaseTrackId] : [];
            }),
        ),
      );

      if (missingNeteaseTrackIds.length > 0 && isNeteaseSourceEnabled(settings)) {
        try {
          const details = await getNeteaseSongDetail(settings, missingNeteaseTrackIds);
          if (!isDisposed && playbackRestoreSequenceRef.current < restoreSequence) {
            upsertTransientRemoteEntries(
              details.map((detail) => ({
                track: createTransientNeteaseTrack(detail),
                artworkUrl: detail.artworkUrl ?? null,
              })),
            );
          }
        } catch (error) {
          console.error("[player] failed to hydrate restorable remote queue", error);
        }
      }

      if (isDisposed || playbackRestoreSequenceRef.current >= restoreSequence) {
        return;
      }

      const restoredQueueIds = rawQueueIds.filter((trackId) => findTrackById(trackId) !== null);
      const restoredTrackIdCandidate =
        rawTrackIdCandidate && findTrackById(rawTrackIdCandidate) ? rawTrackIdCandidate : null;
      const restoredTrackId = restoredTrackIdCandidate ?? restoredQueueIds[0] ?? null;
      const restoredQueueForPlayback =
        restoredQueueIds.length > 0
          ? restoredQueueIds
          : restoredTrackId
            ? [restoredTrackId]
            : [];

      if (!restoredTrackId && restoredQueueIds.length === 0) {
        setPendingPlaybackStartIntent(null);
        setPlaybackRestoreSession(null);
        pushDynamicIslandNotification(localeStrings.notifications.playbackRestoreFailed);
        return;
      }

      if (restoredTrackId) {
        const requestId = beginPlaybackRequest();
        setPendingPlaybackStartIntent({
          trackId: restoredTrackId,
          source: "restore",
        });
        setPlaybackRestoreSession((current) =>
          current && current.sequence === restoreSequence
            ? {
                ...current,
                status: "restoring",
              }
            : current,
        );
        void requestPreparedPlayback(restoredTrackId, restoredQueueForPlayback, {
          autoplay: false,
          requestId,
          announceNotice: false,
          preserveRestoreState: true,
        }).catch((error) => {
          if (isDisposed) {
            return;
          }

          console.error("[player] failed to restore playback track", error);
        });
      } else if (restoredQueueIds.length > 0) {
        setPlaybackQueueIds(restoredQueueIds);
      }

      if (restoredTrackId || restoredQueueIds.length > 0) {
        if (!restoredTrackId) {
          setPlaybackRestoreSession(null);
        }
      }
    };

    void restorePlaybackState();

    return () => {
      isDisposed = true;
    };
  }, [
    libraryTracks,
    isLibraryLoading,
    isSettingsLoading,
    localeStrings.notifications.playbackRestoreFailed,
    playbackRestoreSession,
    transientRemoteTracks,
  ]);

  useEffect(() => {
    if (isOnlineFeaturesAvailable) {
      return;
    }

    if (activeNav === "explore" || activeNav === "favorites" || activeNav === "playlist") {
      setPlaylistReturnSnapshot(null);
      setExploreReturnSnapshot(null);
      setSelectedPlaylist(null);
      setActiveNav("home");
    }
  }, [activeNav, isOnlineFeaturesAvailable]);

  useEffect(() => {
    schedulePlaybackResumePersistence();

    return () => {
      if (playbackStateSaveTimerRef.current) {
        window.clearTimeout(playbackStateSaveTimerRef.current);
        playbackStateSaveTimerRef.current = null;
      }
    };
  }, [
    currentTrackId,
    playbackQueueIds,
    settings.playback.rememberQueue,
  ]);

  const libraryArtworks = mediaLibrary?.artworks ?? [];
  const libraryArtworksById = useMemo(
    () => new Map(libraryArtworks.map((artwork) => [artwork.id, artwork])),
    [libraryArtworks],
  );
  const trackLookup = useMemo(() => {
    const nextTrackLookup = new Map(libraryTracks.map((track) => [track.id, track]));
    Object.values(transientRemoteTracks).forEach((track) => {
      nextTrackLookup.set(track.id, track);
    });
    return nextTrackLookup;
  }, [libraryTracks, transientRemoteTracks]);
  const resolveDisplayTrackArtworkUrl = (track: TrackRecord | null) => {
    if (!track) {
      return null;
    }

    return (
      resolveTrackArtworkUrl(track, libraryArtworksById) ??
      transientRemoteArtworkUrls[track.id] ??
      null
    );
  };
  const currentTrack = currentTrackId ? (trackLookup.get(currentTrackId) ?? null) : null;
  const playbarDisplayTrack =
    playbarDisplayTrackId ? (trackLookup.get(playbarDisplayTrackId) ?? null) : null;
  const playbarTrackTitle = playbarDisplayTrack?.title ?? localeStrings.player.idleTitle;
  const playbarTrackArtist = playbarDisplayTrack?.artist?.trim() || localeStrings.player.idleArtist;
  const playbarTrackArtists = playbarDisplayTrack
    ? (playbarDisplayTrack.artist ?? "")
        .split(" / ")
        .map((name) => name.trim())
        .filter((name) => name.length > 0)
    : [];
  const isRestoringPlaybackState =
    playbackRestoreSession !== null ||
    (isPlaybackLoading &&
      currentTrack !== null &&
      peekPendingPlaybackStartIntent(currentTrack.id)?.source === "restore");
  const immersivePlayerCopy = getImmersivePlayerCopy(copy.locale);
  const orderedQueueIds = useMemo(
    () => (playbackQueueIds.length > 0 ? playbackQueueIds.filter((id) => trackLookup.has(id)) : []),
    [playbackQueueIds, trackLookup],
  );
  const currentQueueIds = useMemo(
    () =>
      playbackMode === "shuffle"
        ? shuffledQueueIds.filter((id) => orderedQueueIds.includes(id))
        : orderedQueueIds,
    [orderedQueueIds, playbackMode, shuffledQueueIds],
  );
  const currentQueueIndex = currentTrackId ? currentQueueIds.indexOf(currentTrackId) : -1;
  const currentQueueTracks = currentQueueIds
    .map((trackId) => trackLookup.get(trackId) ?? null)
    .filter((track): track is TrackRecord => track !== null);
  const collectPlaybackCacheProtectedTrackIds = () => {
    const protectedTrackIds = new Set<string>();
    const currentWindowStart = currentQueueIndex >= 0 ? Math.max(0, currentQueueIndex - 4) : 0;
    const currentWindowEnd = currentQueueIndex >= 0
      ? Math.min(currentQueueIds.length, currentQueueIndex + 12)
      : Math.min(currentQueueIds.length, 12);

    currentQueueIds.slice(currentWindowStart, currentWindowEnd).forEach((trackId) => {
      protectedTrackIds.add(trackId);
    });

    if (currentTrackId) {
      protectedTrackIds.add(currentTrackId);
    }

    const preparedTrackId = songTransitionPreparedRef.current?.targetTrackId;
    if (preparedTrackId) {
      protectedTrackIds.add(preparedTrackId);
    }

    const transitionSourceTrackId = songTransitionSourceTrackIdRef.current;
    if (transitionSourceTrackId) {
      protectedTrackIds.add(transitionSourceTrackId);
    }

    const primaryMountedTrackId = primaryAudioRef.current?.dataset.trackId?.trim();
    if (primaryMountedTrackId) {
      protectedTrackIds.add(primaryMountedTrackId);
    }

    const secondaryMountedTrackId = secondaryAudioRef.current?.dataset.trackId?.trim();
    if (secondaryMountedTrackId) {
      protectedTrackIds.add(secondaryMountedTrackId);
    }

    return protectedTrackIds;
  };

  const pruneTrackAnalysisCache = (protectedTrackIds?: Iterable<string>) => {
    const removedTrackIds = pruneBoundedRecord(
      trackAnalysisByTrackIdRef.current,
      TRACK_ANALYSIS_CACHE_LIMIT,
      protectedTrackIds,
    );

    if (removedTrackIds.length === 0) {
      return;
    }

    const removedTrackIdSet = new Set(removedTrackIds);
    removedTrackIds.forEach((trackId) => {
      delete autoMixDecisionCacheRef.current[trackId];
    });

    loggedTrackAnalysisKeysRef.current.forEach((analysisKey) => {
      const trackId = analysisKey.split("::", 1)[0] ?? "";
      if (removedTrackIdSet.has(trackId)) {
        loggedTrackAnalysisKeysRef.current.delete(analysisKey);
      }
    });
  };

  const pruneTransientRemoteCaches = (protectedTrackIds?: Iterable<string>) => {
    const removedTrackIds = pruneBoundedRecord(
      transientRemoteTracksRef.current,
      TRANSIENT_REMOTE_TRACK_CACHE_LIMIT,
      protectedTrackIds,
    );
    if (removedTrackIds.length === 0) {
      return false;
    }

    removedTrackIds.forEach((trackId) => {
      delete transientRemoteArtworkUrlsRef.current[trackId];
    });
    Object.keys(transientRemoteArtworkUrlsRef.current).forEach((trackId) => {
      if (!Object.prototype.hasOwnProperty.call(transientRemoteTracksRef.current, trackId)) {
        delete transientRemoteArtworkUrlsRef.current[trackId];
      }
    });

    setTransientRemoteTracks({ ...transientRemoteTracksRef.current });
    setTransientRemoteArtworkUrls({ ...transientRemoteArtworkUrlsRef.current });
    return true;
  };
  const isOrderedPlaybackLockedQueue =
    playbackQueueKind === "personal-fm" || playbackQueueKind === "intelligence";
  const playbackModeDisplayText = isOrderedPlaybackLockedQueue
    ? playbackQueueKind === "personal-fm"
      ? copy.locale === "en-US"
        ? "Ordered Playback (Private FM)"
        : "顺序播放（私人 FM）"
      : copy.locale === "en-US"
        ? "Ordered Playback (Heart Mode)"
        : "顺序播放（心动模式）"
    : playbackModeLabel(playbackMode, copy.locale);
  const queueDraggingTrackId = queueDragState?.trackId ?? draggingQueueTrackId ?? null;
  const queueDraggedSourceIndex = queueDraggingTrackId ? currentQueueIds.indexOf(queueDraggingTrackId) : -1;
  const resolvedQueueDropIndex = queueDraggingTrackId
    ? Math.max(
        0,
        Math.min(
          queueDropIndex ?? queueDragState?.initialIndex ?? 0,
          Math.max(0, currentQueueTracks.length - 1),
        ),
      )
    : null;
  const buildQueueItemDragStyle = (trackId: string): CSSProperties | undefined => {
    if (!queueDragState || !queueDraggingTrackId || resolvedQueueDropIndex === null) {
      return undefined;
    }

    const queueOrder = queueDragState.queueIds;
    const sourceIndex = queueDraggedSourceIndex;
    const itemIndex = queueOrder.indexOf(trackId);
    if (sourceIndex === -1 || itemIndex === -1) {
      return undefined;
    }

    if (trackId === queueDraggingTrackId) {
      const queueList = queueListRef.current;
      const scrollDelta = (queueList?.scrollTop ?? queueDragState.listScrollTop) - queueDragState.listScrollTop;
      const translateX = queueDragState.pointerX - queueDragState.startPointerX;
      const translateY =
        queueDragState.pointerY - queueDragState.startPointerY + scrollDelta;

      return {
        transform: `translate3d(${Math.round(translateX)}px, ${Math.round(translateY)}px, 0) scale(1.02)`,
        zIndex: 3,
      };
    }

    let shiftY = 0;

    if (sourceIndex < resolvedQueueDropIndex && itemIndex > sourceIndex && itemIndex <= resolvedQueueDropIndex) {
      const previousTrackId = queueOrder[itemIndex - 1];
      const currentTop = queueDragState.rowTops[trackId];
      const previousTop = previousTrackId ? queueDragState.rowTops[previousTrackId] : undefined;
      if (typeof currentTop === "number" && typeof previousTop === "number") {
        shiftY = previousTop - currentTop;
      }
    } else if (
      sourceIndex > resolvedQueueDropIndex &&
      itemIndex >= resolvedQueueDropIndex &&
      itemIndex < sourceIndex
    ) {
      const nextTrackId = queueOrder[itemIndex + 1];
      const currentTop = queueDragState.rowTops[trackId];
      const nextTop = nextTrackId ? queueDragState.rowTops[nextTrackId] : undefined;
      if (typeof currentTop === "number" && typeof nextTop === "number") {
        shiftY = nextTop - currentTop;
      }
    }

    if (shiftY === 0) {
      return undefined;
    }

    return {
      transform: `translate3d(0, ${Math.round(shiftY)}px, 0)`,
    };
  };
  const playbarQueueCopy = getPlaybarQueueCopy(copy.locale);
  const canSkipPrevious =
    currentQueueIds.length > 1 &&
    currentQueueIndex !== -1 &&
    (playbackMode === "ordered" ? currentQueueIndex > 0 : true);
  const canSkipNext =
    currentQueueIds.length > 1 &&
    currentQueueIndex !== -1 &&
    (playbackMode === "ordered" ? currentQueueIndex < currentQueueIds.length - 1 : true);
  const activeNavIndex = navItems.findIndex((item) => item.id === activeNav);
  const activeTrackArtworkUrl =
    playbarDisplayTrack === null
      ? null
      : resolveDisplayTrackArtworkUrl(playbarDisplayTrack) ??
        (playbarDisplayTrack.id === currentTrack?.id ? playbarArtworkOverrideUrl : null);

  const cancelPendingPlaybackRestore = () => {
    playbackRestoreSequenceRef.current += 1;
    hasRestoredPlaybackStateRef.current = true;
    setPendingPlaybackStartIntent(null);
    setPlaybackRestoreSession(null);
  };

  const clearPlaybackLoadTimeout = () => {
    if (playbackLoadTimeoutRef.current !== null) {
      window.clearTimeout(playbackLoadTimeoutRef.current);
      playbackLoadTimeoutRef.current = null;
    }
  };

  const getPlaybackLoadTimeoutMs = () =>
    Math.min(20000, Math.max(4000, settingsRef.current.network.requestTimeoutMs || 10000) + 2000);

  const handlePlaybackLoadFailure = (audio: HTMLAudioElement) => {
    clearPlaybackLoadTimeout();

    const candidates = playbackCandidatesRef.current;
    const nextCandidateIndex = playbackCandidateIndexRef.current + 1;

    if (nextCandidateIndex < candidates.length) {
      playbackCandidateIndexRef.current = nextCandidateIndex;
      setIsPlaybackLoading(true);
      audio.src = candidates[nextCandidateIndex];
      audio.load();
      return;
    }

    const activeTrack = currentTrackRef.current;
    const recoveryTrackId = parseNeteaseTrackIdFromCacheKey(activeTrack?.playback.cacheKey);
    const recoveryKey = activeTrack?.playback.cacheKey ?? null;

    if (
      activeTrack &&
      recoveryTrackId &&
      recoveryKey &&
      attemptedPlaybackRecoveryKeyRef.current !== recoveryKey
    ) {
      attemptedPlaybackRecoveryKeyRef.current = recoveryKey;
      const shouldResumeAfterRecovery = pendingAutoplayRef.current || isPlayingRef.current;
      pendingAutoplayRef.current = shouldResumeAfterRecovery;

      void resolveNeteaseTrack(settingsRef.current, recoveryTrackId)
        .then((resolvedTrack) => {
          const refreshedCandidates = [
            resolvedTrack.stream.url,
            ...resolvedTrack.fallbackStreams.map((stream) => stream.url),
          ].filter((candidate, index, collection) => candidate && collection.indexOf(candidate) === index);

          if (refreshedCandidates.length === 0) {
            throw new Error("No refreshed playback candidates were returned.");
          }

          if (resolvedTrack.notice) {
            pushDynamicIslandNotification(resolvedTrack.notice);
          } else {
            pushDynamicIslandNotification(localeStrings.notifications.playbackRecovered);
          }

          playbackCandidatesRef.current = refreshedCandidates;
          playbackCandidateIndexRef.current = 0;
          setIsPlaybackLoading(true);
          audio.dataset.trackId = activeTrack.id;
          audio.src = refreshedCandidates[0];
          audio.load();

          if (isPersistedLibraryTrack(activeTrack.id)) {
            void registerResolvedNeteaseTrackToLibrary(resolvedTrack)
              .then(async (updatedTrack) => {
                const snapshot = await refreshMediaLibrarySnapshot();
                const refreshedTrack =
                  snapshot.tracks.find((item) => item.playback.cacheKey === updatedTrack.playback.cacheKey) ??
                  snapshot.tracks.find((item) => item.id === updatedTrack.id) ??
                  updatedTrack;
                currentTrackRef.current = refreshedTrack;
              })
              .catch((refreshError) => {
                console.error("[player] failed to persist refreshed track", refreshError);
              });
          } else {
            const transientTrack = createTransientNeteaseTrack(resolvedTrack.detail, resolvedTrack);
            upsertTransientRemoteEntries([
              {
                track: transientTrack,
                artworkUrl: resolvedTrack.detail.artworkUrl ?? null,
              },
            ]);
            currentTrackRef.current = transientTrack;
          }
        })
        .catch((error) => {
          console.error("[player] failed to recover audio source", error);
          setIsPlaying(false);
          setIsPlaybackLoading(false);
          pushDynamicIslandNotification(localeStrings.notifications.trackUnavailable);
        });
      return;
    }

    console.error("[player] failed to load audio source", currentTrackRef.current);
    setIsPlaying(false);
    setIsPlaybackLoading(false);
    pushDynamicIslandNotification(localeStrings.notifications.trackUnavailable);
  };

  const schedulePlaybackLoadTimeout = (audio: HTMLAudioElement, trackId: string) => {
    clearPlaybackLoadTimeout();
    const expectedCandidateIndex = playbackCandidateIndexRef.current;
    const timeoutMs = getPlaybackLoadTimeoutMs();

    playbackLoadTimeoutRef.current = window.setTimeout(() => {
      playbackLoadTimeoutRef.current = null;

      if (
        currentTrackIdRef.current !== trackId ||
        audio.dataset.trackId !== trackId ||
        playbackCandidateIndexRef.current !== expectedCandidateIndex ||
        !isPlaybackLoadingRef.current
      ) {
        return;
      }

      console.error("[player] playback load timed out", {
        trackId,
        candidateIndex: expectedCandidateIndex,
      });
      handlePlaybackLoadFailure(audio);
    }, timeoutMs);
  };

  const shouldShowKugouImportProgressInIsland =
    isImportingKugouPlaylist &&
    kugouImportProgress.total > 0 &&
    (activeNav !== "tools" || toolsView !== "kugouImport");
  const dynamicIslandImportProgress = shouldShowKugouImportProgressInIsland
    ? {
        label: getKugouImportCopy(copy.locale).title,
        current: kugouImportProgress.current,
        total: kugouImportProgress.total,
        percent:
          kugouImportProgress.total > 0
            ? Math.max(
                0,
                Math.min(100, Math.round((kugouImportProgress.current / kugouImportProgress.total) * 100)),
              )
            : 0,
      }
    : null;
  const immersiveFallbackPalette = buildImmersiveFallbackPalette(settings.appearance);
  const activeImmersivePalette = immersiveArtworkPalette ?? immersiveFallbackPalette;
  const currentTrackLyricsLines = currentTrackLyrics?.lines ?? [];
  const displayTrackLyricsOffsetMs = playbarDisplayTrack?.config.lyricsOffsetMs ?? 0;
  const configuredImmersiveLyricAdvanceMs = Math.round(
    clampNumber((settings.lyrics.lineAnimationStaggerMs ?? IMMERSIVE_LYRIC_STAGGER_MS) * 5, 0, 1200),
  );
  const shouldComputeRealtimeLyricTimeline =
    isImmersivePlayerOpen || isWallpaperModeEnabled || settings.appearance.dynamicIslandShowLyrics;
  const currentTrackLyricsTimeMs = shouldComputeRealtimeLyricTimeline
    ? resolveLyricsTimelineTimeMs({
        audioTimeMs: playbarDisplayVisualTimeSeconds * 1000,
        lyricsOffsetMs: displayTrackLyricsOffsetMs,
        delayMs: settings.lyrics.delayMs ?? 0,
        advanceMs: configuredImmersiveLyricAdvanceMs,
      })
    : 0;
  const activeLyricLineIndex =
    shouldComputeRealtimeLyricTimeline && currentTrackLyricsLines.length > 0
      ? findActiveLyricLineIndex(currentTrackLyricsLines, currentTrackLyricsTimeMs)
      : -1;
  const dynamicIslandLyricLine =
    settings.appearance.dynamicIslandShowLyrics &&
    shouldComputeRealtimeLyricTimeline &&
    isPlaying &&
    playbarDisplayTrack &&
    currentTrackLyricsLines.length > 0
      ? resolveDynamicIslandLyricLine(currentTrackLyricsLines, activeLyricLineIndex)
      : null;
  const effectiveDurationSeconds =
    playbarDisplayDurationSeconds > 0
      ? playbarDisplayDurationSeconds
      : playbarDisplayTrack?.durationMs
        ? playbarDisplayTrack.durationMs / 1000
        : 0;
  const progress =
    effectiveDurationSeconds > 0
      ? Math.min(100, Math.max(0, (playbarDisplayVisualTimeSeconds / effectiveDurationSeconds) * 100))
      : 0;
  const elapsedTrackSeconds = Math.round(playbarDisplayVisualTimeSeconds);
  const totalTrackSeconds = Math.round(effectiveDurationSeconds);
  const immersiveAppBackgroundOpacity = clamp01((settings.appearance.backgroundImageOpacity ?? 82) / 100);
  const immersiveAppBackgroundBlurPx = Math.min(48, Math.max(0, settings.appearance.backgroundBlur ?? 18));
  const immersiveAppBackgroundDimOpacity = clamp01((settings.appearance.backgroundDim ?? 18) / 100);
  const followAppBackgroundImageStyle =
    appBackgroundMvVideoSrc
      ? "none"
      : hasCustomAppBackground && backgroundMediaKind === "image"
        ? backgroundImageStyle
        : "none";
  const followAppBackgroundVideoSrc =
    appBackgroundMvVideoSrc ??
    (hasCustomAppBackground && backgroundMediaKind === "video" ? backgroundVideoSrc : null);
  const followAppBackgroundVideoLoop = !appBackgroundMvVideoSrc;
  const buildImmersiveWallpaperStaticState = (): ImmersiveWallpaperStaticSnapshot =>
    playbarDisplayTrack
      ? {
          version: 1 as const,
          locale: copy.locale,
          hasTrack: true,
          trackId: playbarDisplayTrack.id,
          title: playbarDisplayTrack.title,
          artist: playbarDisplayTrack.artist?.trim() || null,
          album: playbarDisplayTrack.album?.trim() || null,
          artworkUrl: activeTrackArtworkUrl,
          palette: activeImmersivePalette as ImmersiveWallpaperPalette,
          appearanceSettings: settings.appearance,
          lyricsSettings: settings.lyrics,
          appBackgroundImageStyle: followAppBackgroundImageStyle,
          appBackgroundVideoSrc: followAppBackgroundVideoSrc,
          appBackgroundVideoLoop: followAppBackgroundVideoLoop,
          appBackgroundOpacity: immersiveAppBackgroundOpacity,
          appBackgroundBlurPx: immersiveAppBackgroundBlurPx,
          appBackgroundDimOpacity: immersiveAppBackgroundDimOpacity,
          lyrics: currentTrackLyrics,
          updatedAtMs: Date.now(),
        }
      : {
          version: 1 as const,
          locale: copy.locale,
          hasTrack: false,
          trackId: null,
          title: "",
          artist: null,
          album: null,
          artworkUrl: null,
          palette: null,
          appearanceSettings: settings.appearance,
          lyricsSettings: settings.lyrics,
          appBackgroundImageStyle: followAppBackgroundImageStyle,
          appBackgroundVideoSrc: followAppBackgroundVideoSrc,
          appBackgroundVideoLoop: followAppBackgroundVideoLoop,
          appBackgroundOpacity: immersiveAppBackgroundOpacity,
          appBackgroundBlurPx: immersiveAppBackgroundBlurPx,
          appBackgroundDimOpacity: immersiveAppBackgroundDimOpacity,
          lyrics: null,
          updatedAtMs: Date.now(),
        };
  const buildImmersiveWallpaperDynamicState = () => ({
    version: 1 as const,
    currentTimeSeconds,
    durationSeconds: effectiveDurationSeconds,
    progress,
    isPlaying,
    isPlaybackLoading,
    isLyricsLoading: isCurrentTrackLyricsLoading,
    currentLyricsTimeMs: currentTrackLyricsTimeMs,
    activeLyricLineIndex,
    updatedAtMs: Date.now(),
  });

  useEffect(() => {
    if (!isWallpaperModeEnabled) {
      return;
    }
    syncImmersiveWallpaperStaticSnapshot(buildImmersiveWallpaperStaticState());
  }, [
    activeImmersivePalette,
    activeTrackArtworkUrl,
    backgroundImageStyle,
    appBackgroundMvVideoSrc,
    copy.locale,
    playbarDisplayTrack,
    currentTrackLyrics,
    effectiveBackgroundVideoSrc,
    immersiveAppBackgroundBlurPx,
    immersiveAppBackgroundDimOpacity,
    immersiveAppBackgroundOpacity,
    isWallpaperModeEnabled,
    settings.appearance,
    settings.lyrics,
  ]);

  useEffect(() => {
    const componentDynamicIslandSettings = readComponentDynamicIslandSettings();
    if (!componentDynamicIslandSettings.enabled) {
      return;
    }

    void openComponentDynamicIslandWindow()
      .then(() => emitComponentDynamicIslandSettings(componentDynamicIslandSettings))
      .catch(() => undefined);
  }, []);

  const buildComponentDynamicIslandSnapshot = (): ComponentDynamicIslandSnapshot => {
    const componentIslandThemeStyle = themeStyle as CSSProperties & Record<string, string | undefined>;
    const displayTrackId = playbarDisplayTrackIdRef.current;
    const displayTrack = displayTrackId ? (trackLookup.get(displayTrackId) ?? null) : null;
    const artworkUrl =
      displayTrack === null
        ? null
        : resolveDisplayTrackArtworkUrl(displayTrack) ??
          (displayTrack.id === currentTrackIdRef.current ? playbarArtworkOverrideUrlRef.current : null);
    const displayAudio = getPlaybarDisplayAudioElement();
    const elapsedSeconds =
      displayAudio && Number.isFinite(displayAudio.currentTime) ? Math.max(0, displayAudio.currentTime) : 0;
    const durationSeconds =
      displayAudio && Number.isFinite(displayAudio.duration) && displayAudio.duration > 0
        ? displayAudio.duration
        : displayTrack?.durationMs
          ? displayTrack.durationMs / 1000
          : 0;
    const progressValue =
      durationSeconds > 0 ? Math.min(100, Math.max(0, (elapsedSeconds / durationSeconds) * 100)) : 0;

    return displayTrack
      ? {
          hasTrack: true,
          title: displayTrack.title,
          artist: displayTrack.artist?.trim() || null,
          album: displayTrack.album?.trim() || null,
          artworkUrl,
          isPlaying: isPlayingRef.current,
          progress: progressValue,
          elapsedLabel: formatTimeLabel(Math.round(elapsedSeconds)),
          durationLabel: formatDurationLabelForComponentIsland(displayTrack.durationMs),
          colorScheme: settings.appearance.colorScheme,
          resolvedDynamicIslandBackground: String(
            componentIslandThemeStyle["--dynamic-island-bg"] ?? "",
          ),
          resolvedDynamicIslandBackgroundHover: String(
            componentIslandThemeStyle["--dynamic-island-bg-hover"] ?? "",
          ),
          resolvedDynamicIslandAccent: String(
            componentIslandThemeStyle["--dynamic-island-dot"] ?? "",
          ),
          primaryColor: settings.appearance.customThemePrimary,
          secondaryColor: settings.appearance.customThemeSecondary,
          surfaceColor: settings.appearance.customThemeSurface,
          updatedAtMs: Date.now(),
        }
      : {
          hasTrack: false,
          title: "Celia Music",
          artist: null,
          album: null,
          artworkUrl: null,
          isPlaying: false,
          progress: 0,
          elapsedLabel: "0:00",
          durationLabel: "--:--",
          colorScheme: settings.appearance.colorScheme,
          resolvedDynamicIslandBackground: String(
            componentIslandThemeStyle["--dynamic-island-bg"] ?? "",
          ),
          resolvedDynamicIslandBackgroundHover: String(
            componentIslandThemeStyle["--dynamic-island-bg-hover"] ?? "",
          ),
          resolvedDynamicIslandAccent: String(
            componentIslandThemeStyle["--dynamic-island-dot"] ?? "",
          ),
          primaryColor: settings.appearance.customThemePrimary,
          secondaryColor: settings.appearance.customThemeSecondary,
          surfaceColor: settings.appearance.customThemeSurface,
          updatedAtMs: Date.now(),
        };
  };

  useEffect(() => {
    const componentDynamicIslandSettings = readComponentDynamicIslandSettings();
    if (!componentDynamicIslandSettings.enabled) {
      return;
    }

    void emitComponentDynamicIslandSnapshot(buildComponentDynamicIslandSnapshot()).catch(() => undefined);
  }, [
    activeTrackArtworkUrl,
    elapsedTrackSeconds,
    isPlaying,
    playbarDisplayTrack,
    progress,
    settings.appearance.colorScheme,
    settings.appearance.customThemePrimary,
    settings.appearance.customThemeSecondary,
    settings.appearance.customThemeSurface,
    themeStyle,
  ]);

  useEffect(() => {
    if (!readComponentDynamicIslandSettings().enabled) {
      return;
    }

    const timer = window.setInterval(() => {
      const latestSettings = readComponentDynamicIslandSettings();
      if (!latestSettings.enabled) {
        return;
      }

      void emitComponentDynamicIslandSnapshot(buildComponentDynamicIslandSnapshot()).catch(() => undefined);
    }, 400);

    return () => {
      window.clearInterval(timer);
    };
  }, [
    currentTrackId,
    playbarDisplayTrackId,
    settings.appearance.colorScheme,
    settings.appearance.customThemePrimary,
    settings.appearance.customThemeSecondary,
    settings.appearance.customThemeSurface,
    themeStyle,
    trackLookup,
  ]);

  useEffect(() => {
    if (!isWallpaperModeEnabled) {
      return;
    }

    const baseSnapshot = buildImmersiveWallpaperDynamicState();
    const optimizedSnapshot: ImmersiveWallpaperDynamicSnapshot = {
      ...baseSnapshot,
      // Wallpaper window does not need per-frame precision; lower precision reduces sync churn.
      currentTimeSeconds: roundTo(baseSnapshot.currentTimeSeconds, 1),
      durationSeconds: roundTo(baseSnapshot.durationSeconds, 1),
      progress: roundTo(baseSnapshot.progress, 1),
      currentLyricsTimeMs: Math.round(baseSnapshot.currentLyricsTimeMs / 50) * 50,
      updatedAtMs: Date.now(),
    };
    const previousSnapshot = lastImmersiveWallpaperDynamicSnapshotRef.current;

    if (isSameImmersiveWallpaperDynamicSnapshot(previousSnapshot, optimizedSnapshot)) {
      return;
    }

    const now = performance.now();
    const isStateTransition =
      !previousSnapshot ||
      previousSnapshot.isPlaying !== optimizedSnapshot.isPlaying ||
      previousSnapshot.isPlaybackLoading !== optimizedSnapshot.isPlaybackLoading ||
      previousSnapshot.isLyricsLoading !== optimizedSnapshot.isLyricsLoading ||
      previousSnapshot.activeLyricLineIndex !== optimizedSnapshot.activeLyricLineIndex;
    if (
      !isStateTransition &&
      now - lastImmersiveWallpaperDynamicSyncAtRef.current < IMMERSIVE_WALLPAPER_DYNAMIC_SYNC_MIN_INTERVAL_MS
    ) {
      return;
    }

    lastImmersiveWallpaperDynamicSnapshotRef.current = optimizedSnapshot;
    lastImmersiveWallpaperDynamicSyncAtRef.current = now;
    syncImmersiveWallpaperDynamicSnapshot(optimizedSnapshot, { persist: false });
  }, [
    activeLyricLineIndex,
    currentTrackLyricsTimeMs,
    currentTimeSeconds,
    effectiveDurationSeconds,
    isCurrentTrackLyricsLoading,
    isWallpaperModeEnabled,
    isPlaybackLoading,
    isPlaying,
    progress,
  ]);

  useEffect(() => {
    if (isWallpaperModeEnabled) {
      return;
    }

    lastImmersiveWallpaperDynamicSnapshotRef.current = null;
    lastImmersiveWallpaperDynamicSyncAtRef.current = 0;
  }, [isWallpaperModeEnabled]);

  const createTransientNeteaseTrack = (
    detail: NeteaseSongDetail,
    resolved?: Pick<NeteaseResolvedTrack, "stream" | "fallbackStreams"> | null,
  ): TrackRecord => {
    const cacheKey = buildNeteaseTrackCacheKey(detail.id);
    const now = Date.now();
    const primaryUri = resolved?.stream.url ?? "";
    const fallbackUris =
      resolved?.fallbackStreams
        .map((stream) => stream.url)
        .filter((url, index, collection) => Boolean(url) && collection.indexOf(url) === index) ?? [];

    return {
      id: cacheKey,
      source: {
        kind: "remoteStream",
        url: primaryUri,
        mimeType: inferMimeType(resolved?.stream.type ?? null),
        headers: {},
      },
      playback: {
        mode: "remoteStream",
        primaryUri,
        fallbackUri: fallbackUris[0] ?? null,
        fallbackUris,
        cacheKey,
      },
      title: detail.name,
      artist: detail.artists.join(" / ") || null,
      album: detail.album,
      albumArtist: detail.albumArtist,
      durationMs: detail.durationMs,
      trackNumber: detail.trackNumber,
      discNumber: detail.discNumber,
      year: detail.year,
      genre: null,
      artworkIds: [],
      config: createDefaultSongConfig(),
      importedAtMs: now,
      updatedAtMs: now,
    };
  };

  const upsertTransientRemoteEntries = (
    entries: Array<{ track: TrackRecord; artworkUrl: string | null }>,
  ) => {
    if (entries.length === 0) {
      return;
    }

    const nextTracks = { ...transientRemoteTracksRef.current };
    entries.forEach(({ track }) => {
      const existing = nextTracks[track.id];

      nextTracks[track.id] = existing
        ? {
            ...existing,
            ...track,
            source:
              track.source.kind === "remoteStream" && track.source.url.trim().length > 0
                ? track.source
                : existing.source,
            playback: {
              ...existing.playback,
              ...track.playback,
              primaryUri:
                track.playback.primaryUri.trim().length > 0
                  ? track.playback.primaryUri
                  : existing.playback.primaryUri,
              fallbackUri: track.playback.fallbackUri ?? existing.playback.fallbackUri,
              fallbackUris:
                track.playback.fallbackUris.length > 0
                  ? track.playback.fallbackUris
                  : existing.playback.fallbackUris,
            },
            config: existing.config,
            artworkIds: track.artworkIds.length > 0 ? track.artworkIds : existing.artworkIds,
            importedAtMs: existing.importedAtMs,
          }
        : track;
    });
    transientRemoteTracksRef.current = nextTracks;
    pruneTransientRemoteCaches(collectPlaybackCacheProtectedTrackIds());
    setTransientRemoteTracks({ ...transientRemoteTracksRef.current });

    const nextArtworkUrls = { ...transientRemoteArtworkUrlsRef.current };
    entries.forEach(({ track, artworkUrl }) => {
      setBoundedRecordValue(
        nextArtworkUrls,
        track.id,
        artworkUrl,
        TRANSIENT_REMOTE_TRACK_CACHE_LIMIT,
        collectPlaybackCacheProtectedTrackIds(),
      );
    });
    transientRemoteArtworkUrlsRef.current = nextArtworkUrls;
    setTransientRemoteArtworkUrls({ ...transientRemoteArtworkUrlsRef.current });
  };

  const beginPlaybackRequest = () => {
    playbackRequestSequenceRef.current += 1;
    return playbackRequestSequenceRef.current;
  };

  const isPlaybackRequestCurrent = (requestId: number) =>
    playbackRequestSequenceRef.current === requestId;

  function setPendingPlaybackStartIntent(intent: PlaybackStartIntent | null) {
    pendingPlaybackStartIntentRef.current = intent;
  }

  function consumePendingPlaybackStartIntent(trackId: string) {
    const intent = pendingPlaybackStartIntentRef.current;
    if (!intent || intent.trackId !== trackId) {
      return null;
    }

    pendingPlaybackStartIntentRef.current = null;
    return intent;
  }

  function peekPendingPlaybackStartIntent(trackId: string) {
    const intent = pendingPlaybackStartIntentRef.current;
    return intent && intent.trackId === trackId ? intent : null;
  }

  const findTrackById = (trackId: string) =>
    transientRemoteTracksRef.current[trackId] ??
    mediaLibraryRef.current?.tracks.find((track) => track.id === trackId) ??
    null;

  const buildQueueIds = (queueTracks: TrackRecord[]) =>
    queueTracks
      .map((track) => track.id)
      .filter((trackId, index, collection) => Boolean(trackId) && collection.indexOf(trackId) === index);

  const refreshMediaLibrarySnapshot = async () => {
    const snapshot = await listMediaLibrary();
    mediaLibraryRef.current = snapshot;
    setMediaLibrary(snapshot);
    return snapshot;
  };

  const isPersistedLibraryTrack = (trackId: string) =>
    mediaLibraryRef.current?.tracks.some((track) => track.id === trackId) ?? false;

  const replacePlaybackQueue = (
    nextQueueIds: string[],
    options?: {
      preserveSourcePlaylist?: boolean;
    },
  ) => {
    const deduplicatedQueueIds = nextQueueIds.filter(
      (trackId, index, collection) =>
        Boolean(trackId) && collection.indexOf(trackId) === index && findTrackById(trackId) !== null,
    );
    setPlaybackQueueIds(deduplicatedQueueIds);
    if (deduplicatedQueueIds.length === 0) {
      setPlaybackQueueSourcePlaylist(null);
    } else if (!options?.preserveSourcePlaylist) {
      setPlaybackQueueSourcePlaylist(null);
    }

    if (playbackModeRef.current === "shuffle") {
      setShuffledQueueIds(deduplicatedQueueIds);
      return deduplicatedQueueIds;
    }

    setShuffledQueueIds((current) => current.filter((trackId) => deduplicatedQueueIds.includes(trackId)));
    return deduplicatedQueueIds;
  };

  const previewPlaybarTrackLoading = (track: TrackRecord) => {
    syncPlaybarDisplayState({
      trackId: track.id,
      currentTimeSeconds: 0,
      visualTimeSeconds: 0,
      durationSeconds: (track.durationMs ?? 0) / 1000,
      animateMeta: true,
    });
    syncTimelineOwnerMode("active");
  };

  const appendTrackIdsToPlaybackQueue = (trackIds: string[]) => {
    const orderedQueueIds = playbackQueueIdsRef.current;
    const normalizedTrackIds = trackIds.filter(
      (trackId, index, collection) =>
        Boolean(trackId) &&
        collection.indexOf(trackId) === index &&
        !orderedQueueIds.includes(trackId) &&
        findTrackById(trackId) !== null,
    );

    if (normalizedTrackIds.length === 0) {
      return orderedQueueIds;
    }

    const nextOrderedQueueIds = [...orderedQueueIds, ...normalizedTrackIds];
    playbackQueueIdsRef.current = nextOrderedQueueIds;
    setPlaybackQueueIds(nextOrderedQueueIds);

    if (playbackModeRef.current === "shuffle") {
      const baseQueueIds =
        currentQueueIdsRef.current.length > 0 ? currentQueueIdsRef.current : orderedQueueIds;
      const nextShuffledQueueIds = [
        ...baseQueueIds.filter(
          (trackId, index, collection) =>
            collection.indexOf(trackId) === index && nextOrderedQueueIds.includes(trackId),
        ),
        ...buildShuffledQueue(normalizedTrackIds, null),
      ];
      currentQueueIdsRef.current = nextShuffledQueueIds;
      setShuffledQueueIds(nextShuffledQueueIds);
      return nextOrderedQueueIds;
    }

    currentQueueIdsRef.current = nextOrderedQueueIds;
    return nextOrderedQueueIds;
  };

  const pauseActiveTrackForTransition = (targetAudio?: HTMLAudioElement | null) => {
    const activeTrackId = currentTrackIdRef.current;
    const shouldCancelAutoMix =
      isSongTransitionRunningRef.current ||
      songTransitionArmedTrackIdRef.current === activeTrackId ||
      songTransitionPreparedRef.current?.sourceTrackId === activeTrackId;

    cancelSongTransition({
      cancelAutoMixForSourceTrack: shouldCancelAutoMix,
    });

    const audio = targetAudio ?? getActiveAudioElement();
    if (!audio || audio.paused) {
      return;
    }

    if (pauseFadeAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(pauseFadeAnimationFrameRef.current);
      pauseFadeAnimationFrameRef.current = null;
    }
    pauseFadeSequenceRef.current += 1;
    isPauseFadingRef.current = false;
    setProcessedAudioGain(audio, volumeRef.current / 100);
    audio.pause();
  };

  const cancelPauseFade = (options?: { restoreVolume?: boolean }) => {
    pauseFadeSequenceRef.current += 1;
    if (pauseFadeAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(pauseFadeAnimationFrameRef.current);
      pauseFadeAnimationFrameRef.current = null;
    }

    const wasFading = isPauseFadingRef.current;
    isPauseFadingRef.current = false;

    if (options?.restoreVolume && wasFading && getActiveAudioElement()) {
      const activeAudio = getActiveAudioElement();
      if (activeAudio) {
        setProcessedAudioGain(activeAudio, volumeRef.current / 100);
      }
    }
  };

  const pauseActiveTrackWithFade = async () => {
    const activeTrackId = currentTrackIdRef.current;
    const shouldCancelAutoMix =
      isSongTransitionRunningRef.current ||
      songTransitionArmedTrackIdRef.current === activeTrackId ||
      songTransitionPreparedRef.current?.sourceTrackId === activeTrackId;

    cancelSongTransition({
      cancelAutoMixForSourceTrack: shouldCancelAutoMix,
    });

    const audio = getActiveAudioElement();
    if (!audio) {
      return;
    }

    if (audio.paused) {
      setProcessedAudioGain(audio, volumeRef.current / 100);
      return;
    }

    cancelPauseFade();

    const startVolume = Math.max(0, Math.min(1, volumeRef.current / 100));
    const targetVolume = Math.max(0, Math.min(1, volumeRef.current / 100));

    if (startVolume <= 0.001 || targetVolume <= 0.001) {
      audio.pause();
      setProcessedAudioGain(audio, targetVolume);
      return;
    }

    isPauseFadingRef.current = true;
    const fadeSequence = pauseFadeSequenceRef.current + 1;
    pauseFadeSequenceRef.current = fadeSequence;
    const startedAt = performance.now();

    await new Promise<void>((resolve) => {
      const step = (now: number) => {
        if (fadeSequence !== pauseFadeSequenceRef.current) {
          resolve();
          return;
        }

        const progress = Math.min(1, (now - startedAt) / PAUSE_FADE_DURATION_MS);
        const easedProgress = 1 - (1 - progress) ** 3;
        setProcessedAudioGain(audio, startVolume * (1 - easedProgress));

        if (progress >= 1) {
          pauseFadeAnimationFrameRef.current = null;
          isPauseFadingRef.current = false;
          audio.pause();
          setProcessedAudioGain(audio, targetVolume);
          resolve();
          return;
        }

        pauseFadeAnimationFrameRef.current = window.requestAnimationFrame(step);
      };

      pauseFadeAnimationFrameRef.current = window.requestAnimationFrame(step);
    });
  };

  useEffect(() => {
    if (isLibraryLoading || !mediaLibrary || !isNeteaseSourceEnabled(settingsRef.current)) {
      return;
    }

    const artworksById = new Map(mediaLibrary.artworks.map((artwork) => [artwork.id, artwork]));
    const brokenRemoteTracks = mediaLibrary.tracks
      .filter((track) => {
        if (track.source.kind !== "remoteStream") {
          return false;
        }

        const cacheKey = track.playback.cacheKey ?? "";
        if (!parseNeteaseTrackIdFromCacheKey(cacheKey)) {
          return false;
        }

        if (resolveTrackArtworkUrl(track, artworksById)) {
          return false;
        }

        return (
          !repairingArtworkTrackKeysRef.current.has(cacheKey) &&
          !repairedArtworkTrackKeysRef.current.has(cacheKey)
        );
      })
      .slice(0, 8);

    if (brokenRemoteTracks.length === 0) {
      return;
    }

    let isDisposed = false;
    for (const track of brokenRemoteTracks) {
      if (track.playback.cacheKey) {
        repairingArtworkTrackKeysRef.current.add(track.playback.cacheKey);
      }
    }

    void (async () => {
      const repairResults = await Promise.allSettled(
        brokenRemoteTracks.map(async (track) => {
          const neteaseTrackId = parseNeteaseTrackIdFromCacheKey(track.playback.cacheKey);
          if (!neteaseTrackId) {
            return false;
          }

          const detail = await getNeteaseSongDetail(settingsRef.current, neteaseTrackId);
          if (!detail) {
            return false;
          }
          await registerNeteaseTrackMetadataToLibrary(detail);
          return true;
        }),
      );

      for (let index = 0; index < brokenRemoteTracks.length; index += 1) {
        const track = brokenRemoteTracks[index];
        const cacheKey = track.playback.cacheKey;
        if (!cacheKey) {
          continue;
        }

        repairingArtworkTrackKeysRef.current.delete(cacheKey);
        if (repairResults[index]?.status === "fulfilled") {
          repairedArtworkTrackKeysRef.current.add(cacheKey);
        }
      }

      if (isDisposed) {
        return;
      }

      if (repairResults.some((result) => result.status === "fulfilled")) {
        try {
          await refreshMediaLibrarySnapshot();
        } catch (error) {
          console.error("[library] failed to refresh media library after artwork repair", error);
        }
      }

      for (const result of repairResults) {
        if (result.status === "rejected") {
          console.error("[library] failed to repair remote artwork", result.reason);
        }
      }
    })();

    return () => {
      isDisposed = true;
      for (const track of brokenRemoteTracks) {
        if (track.playback.cacheKey) {
          repairingArtworkTrackKeysRef.current.delete(track.playback.cacheKey);
        }
      }
    };
  }, [isLibraryLoading, mediaLibrary]);

  const commitPlaybackSelection = (
    trackId: string,
    queueIds: string[],
    options?: {
      autoplay?: boolean;
    },
  ) => {
    const nextQueueIds = queueIds.filter(Boolean);
    const committedTrack = findTrackById(trackId);

    if (nextQueueIds.length === 0) {
      return;
    }

    if (!committedTrack || committedTrack.source.kind !== "remoteStream") {
      syncPlaybarArtworkOverrideUrl(null);
    }

    setPlaybackQueueIds(nextQueueIds);
    if (playbackModeRef.current === "shuffle") {
      setShuffledQueueIds(buildShuffledQueue(nextQueueIds, trackId));
    }
    pendingAutoplayRef.current = options?.autoplay ?? true;

    const activeAudio = getActiveAudioElement();

    if (currentTrackIdRef.current === trackId && activeAudio?.src) {
      const pendingStartIntent = consumePendingPlaybackStartIntent(trackId);
      const shouldAutoplayImmediately = pendingAutoplayRef.current;
      if (shouldAutoplayImmediately) {
        pendingAutoplayRef.current = false;
        void activeAudio.play().catch((error) => {
          console.error("[player] failed to resume playback", error);
          setIsPlaying(false);
          setIsPlaybackLoading(false);
          pushDynamicIslandNotification(localeStrings.notifications.playbackFailed);
        });
      }
      if (pendingStartIntent?.source === "restore") {
        setPlaybackRestoreSession(null);
      }
      return;
    }

    currentTrackIdRef.current = trackId;
    setCurrentTrackId(trackId);
  };

  const ensureTrackReadyForPlayback = async (
    track: TrackRecord,
    options?: {
      announceNotice?: boolean;
    },
  ) => {
    const isPersistedTrack = isPersistedLibraryTrack(track.id);
    const cacheMode = settingsRef.current.playback.cacheMode;
    const shouldPreferCachedPlayback =
      settingsRef.current.playback.songTransitionMode === "auto-mix";
    let cachedPlaybackPath = playbackCachedAudioPathsRef.current[track.id] ?? null;

    if (cacheMode === "complete" || shouldPreferCachedPlayback) {
      cachedPlaybackPath =
        (await ensureTrackPlaybackCache(track, {
          waitForCompletion: true,
        })) ?? cachedPlaybackPath;
    }

    const candidates = resolveTrackPlaybackCandidates(
      track,
      settingsRef.current,
      cachedPlaybackPath,
    );
    if (candidates.length > 0) {
      return track;
    }

    const neteaseTrackId = parseNeteaseTrackIdFromCacheKey(track.playback.cacheKey);
    if (!neteaseTrackId || !isNeteaseSourceEnabled(settingsRef.current)) {
      throw new Error("The selected track does not have any playable source.");
    }

    const resolvedTrack = await resolveNeteaseTrack(settingsRef.current, neteaseTrackId);
    syncPlaybarArtworkOverrideUrl(resolvedTrack.detail.artworkUrl ?? null);

    let readyTrack: TrackRecord;
    if (!isPersistedTrack) {
      const transientTrack = createTransientNeteaseTrack(resolvedTrack.detail, resolvedTrack);
      upsertTransientRemoteEntries([
        {
          track: transientTrack,
          artworkUrl: resolvedTrack.detail.artworkUrl ?? null,
        },
      ]);

      if (options?.announceNotice !== false && resolvedTrack.notice) {
        pushDynamicIslandNotification(resolvedTrack.notice);
      }

      readyTrack = transientTrack;
    } else {
      const updatedTrack = await registerResolvedNeteaseTrackToLibrary(resolvedTrack);
      const refreshedLibrary = await refreshMediaLibrarySnapshot();
      readyTrack =
        refreshedLibrary.tracks.find((item) => item.playback.cacheKey === updatedTrack.playback.cacheKey) ??
        refreshedLibrary.tracks.find((item) => item.id === updatedTrack.id) ??
        updatedTrack;
    }

    if (cacheMode === "complete" || shouldPreferCachedPlayback) {
      await ensureTrackPlaybackCache(readyTrack, {
        waitForCompletion: true,
      });
    }

    if (options?.announceNotice !== false && resolvedTrack.notice) {
      pushDynamicIslandNotification(resolvedTrack.notice);
    }

    return readyTrack;
  };

  const requestPreparedPlayback = async (
    trackId: string,
    queueIds: string[],
    options?: {
      autoplay?: boolean;
      requestId?: number;
      announceNotice?: boolean;
      preserveRestoreState?: boolean;
    },
  ) => {
    const requestId = options?.requestId ?? beginPlaybackRequest();
    if (!options?.preserveRestoreState) {
      cancelPendingPlaybackRestore();
    }
    const targetTrack = findTrackById(trackId);

    if (!targetTrack) {
      if (isPlaybackRequestCurrent(requestId)) {
        setIsPlaybackLoading(false);
      }
      return false;
    }

    if (isPlaybackRequestCurrent(requestId)) {
      if (currentTrackIdRef.current !== trackId) {
        pauseActiveTrackForTransition();
      }
      previewPlaybarTrackLoading(targetTrack);
      setIsPlaybackLoading(true);
    }

    try {
      const preparedTrack = await ensureTrackReadyForPlayback(targetTrack, {
        announceNotice: options?.announceNotice,
      });

      if (!isPlaybackRequestCurrent(requestId)) {
        return false;
      }

      commitPlaybackSelection(preparedTrack.id, queueIds, {
        autoplay: options?.autoplay,
      });
      return true;
    } catch (error) {
      if (!isPlaybackRequestCurrent(requestId)) {
        return false;
      }

      console.error("[player] failed to prepare playback track", error);
      setIsPlaying(false);
      setIsPlaybackLoading(false);
      pushDynamicIslandNotification(localeStrings.notifications.playbackFailed);
      return false;
    }
  };

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  useEffect(() => {
    const keepTrackIds = collectPlaybackCacheProtectedTrackIds();

    Object.entries(playbackCachedAudioPathsRef.current).forEach(([trackId, path]) => {
      if (keepTrackIds.has(trackId)) {
        return;
      }

      delete playbackCachedAudioPathsRef.current[trackId];
      void clearTrackPlaybackCache(trackId, path);
    });

    pruneTrackAnalysisCache(keepTrackIds);
    pruneTransientRemoteCaches(keepTrackIds);
    pruneBoundedRecord(
      autoMixDecisionCacheRef.current,
      AUTO_MIX_DECISION_CACHE_LIMIT,
      keepTrackIds,
    );
  }, [currentQueueIds, currentQueueIndex, currentTrackId, isAutoMixTransitionActive]);

  useEffect(() => {
    mediaLibraryRef.current = mediaLibrary;
  }, [mediaLibrary]);

  useEffect(() => {
    transientRemoteTracksRef.current = transientRemoteTracks;
  }, [transientRemoteTracks]);

  useEffect(() => {
    transientRemoteArtworkUrlsRef.current = transientRemoteArtworkUrls;
  }, [transientRemoteArtworkUrls]);

  useEffect(() => {
    if (!currentTrack) {
      syncPlaybarArtworkOverrideUrl(null);
      return;
    }

    const resolvedArtworkUrl = resolveDisplayTrackArtworkUrl(currentTrack);
    if (resolvedArtworkUrl) {
      syncPlaybarArtworkOverrideUrl(resolvedArtworkUrl);
      return;
    }

    if (currentTrack.source.kind !== "remoteStream") {
      syncPlaybarArtworkOverrideUrl(null);
    }
  }, [currentTrack, libraryArtworksById, transientRemoteArtworkUrls]);

  useEffect(() => {
    if (!currentTrack) {
      syncImmersivePlayerOpen(false);
      syncCurrentTrackLyrics(null);
      syncImmersiveArtworkPalette(null);
    }
  }, [currentTrack]);

  useEffect(() => {
    if (playbackCacheScheduleTimerRef.current !== null) {
      window.clearTimeout(playbackCacheScheduleTimerRef.current);
      playbackCacheScheduleTimerRef.current = null;
    }
    playbackCacheScheduledTrackIdRef.current = null;

    if (settings.playback.cacheMode !== "stream" || !currentTrack) {
      return;
    }

    if (
      playbackCachedAudioPathsRef.current[currentTrack.id] ||
      typeof playbackCacheRequestsRef.current[currentTrack.id] !== "undefined"
    ) {
      return;
    }

    if (!getRemotePlaybackCacheRequest(currentTrack)) {
      return;
    }

    const scheduledTrackId = currentTrack.id;
    playbackCacheScheduledTrackIdRef.current = scheduledTrackId;
    playbackCacheScheduleTimerRef.current = window.setTimeout(() => {
      playbackCacheScheduleTimerRef.current = null;

      if (
        playbackCacheScheduledTrackIdRef.current !== scheduledTrackId ||
        currentTrackIdRef.current !== scheduledTrackId
      ) {
        return;
      }

      const trackToCache = currentTrackRef.current;
      if (!trackToCache || trackToCache.id !== scheduledTrackId) {
        return;
      }

      playbackCacheScheduledTrackIdRef.current = null;
      void ensureTrackPlaybackCache(trackToCache, {
        waitForCompletion: false,
      });
    }, 900);

    return () => {
      if (playbackCacheScheduleTimerRef.current !== null) {
        window.clearTimeout(playbackCacheScheduleTimerRef.current);
        playbackCacheScheduleTimerRef.current = null;
      }

      if (playbackCacheScheduledTrackIdRef.current === scheduledTrackId) {
        playbackCacheScheduledTrackIdRef.current = null;
      }
    };
  }, [currentTrack, settings.playback.cacheMode]);

  useEffect(() => {
    if (!currentTrack) {
      return;
    }

    let cancelled = false;
    const sourceTrackId = currentTrack.id;

    const runTrackAnalysis = async () => {
      const currentAnalysis = await ensureTrackAnalysis(currentTrack);
      if (cancelled || currentTrackIdRef.current !== sourceTrackId) {
        return;
      }

      const nextAnalysis = await prewarmAdjacentTrackAnalysis(sourceTrackId);
      if (cancelled || currentTrackIdRef.current !== sourceTrackId) {
        return;
      }

      if (currentAnalysis && nextAnalysis) {
        cacheAutoMixDecisionIfReady(
          sourceTrackId,
          effectiveDurationSeconds > 0
            ? effectiveDurationSeconds
            : (currentTrack.durationMs ?? currentAnalysis.durationMs) / 1000,
        );
      }
    };

    void runTrackAnalysis();

    return () => {
      cancelled = true;
    };
  }, [currentTrack, effectiveDurationSeconds]);

  useEffect(() => {
    const requestId = appBackgroundMvRequestSequenceRef.current + 1;
    appBackgroundMvRequestSequenceRef.current = requestId;

    if (!settings.appearance.useBackgroundMv || !isPlaying) {
      syncAppBackgroundMvVideoSrc(null);
      return;
    }

    if (!currentTrack || !isNeteaseSourceEnabled(settingsRef.current)) {
      syncAppBackgroundMvVideoSrc(null);
      return;
    }

    const neteaseTrackId = parseNeteaseTrackIdFromCacheKey(
      currentTrack.playback.cacheKey ?? currentTrack.id,
    );
    if (!neteaseTrackId) {
      syncAppBackgroundMvVideoSrc(null);
      return;
    }

    let isCancelled = false;

    void getNeteaseSongDetail(settingsRef.current, neteaseTrackId)
      .then(async (detail) => {
        if (isCancelled || appBackgroundMvRequestSequenceRef.current !== requestId) {
          return;
        }

        const mvId = detail?.mvId ?? null;
        if (!mvId) {
          syncAppBackgroundMvVideoSrc(null);
          return;
        }

        const stream = await getNeteaseMvStream(settingsRef.current, mvId).catch(() => null);
        if (isCancelled || appBackgroundMvRequestSequenceRef.current !== requestId) {
          return;
        }

        syncAppBackgroundMvVideoSrc(stream?.url ?? null);
      })
      .catch((error) => {
        if (isCancelled || appBackgroundMvRequestSequenceRef.current !== requestId) {
          return;
        }

        console.error("[theme] failed to resolve background mv", error);
        syncAppBackgroundMvVideoSrc(null);
      });

    return () => {
      isCancelled = true;
    };
  }, [
    currentTrack,
    isPlaying,
    settings.appearance.useBackgroundMv,
    settings.network.enabledSources.join("|"),
    settings.network.neteaseApiBaseUrl,
    settings.network.neteaseCookie,
    settings.network.neteaseProxy,
    settings.network.neteaseRealIp,
    settings.network.requestTimeoutMs,
  ]);

  useEffect(() => {
    const requestId = immersiveBackgroundMvRequestSequenceRef.current + 1;
    immersiveBackgroundMvRequestSequenceRef.current = requestId;

    if (settings.appearance.immersiveBackgroundMode !== "background-mv" || !isPlaying) {
      syncImmersiveBackgroundMvVideoSrc(null);
      return;
    }

    if (!currentTrack || !isNeteaseSourceEnabled(settingsRef.current)) {
      syncImmersiveBackgroundMvVideoSrc(null);
      return;
    }

    const neteaseTrackId = parseNeteaseTrackIdFromCacheKey(
      currentTrack.playback.cacheKey ?? currentTrack.id,
    );
    if (!neteaseTrackId) {
      syncImmersiveBackgroundMvVideoSrc(null);
      return;
    }

    let isCancelled = false;

    void getNeteaseSongDetail(settingsRef.current, neteaseTrackId)
      .then(async (detail) => {
        if (isCancelled || immersiveBackgroundMvRequestSequenceRef.current !== requestId) {
          return;
        }

        const mvId = detail?.mvId ?? null;
        if (!mvId) {
          syncImmersiveBackgroundMvVideoSrc(null);
          return;
        }

        const stream = await getNeteaseMvStream(settingsRef.current, mvId).catch(() => null);
        if (isCancelled || immersiveBackgroundMvRequestSequenceRef.current !== requestId) {
          return;
        }

        syncImmersiveBackgroundMvVideoSrc(stream?.url ?? null);
      })
      .catch((error) => {
        if (isCancelled || immersiveBackgroundMvRequestSequenceRef.current !== requestId) {
          return;
        }

        console.error("[immersive-player] failed to resolve background mv", error);
        syncImmersiveBackgroundMvVideoSrc(null);
      });

    return () => {
      isCancelled = true;
    };
  }, [
    currentTrack,
    isPlaying,
    settings.appearance.immersiveBackgroundMode,
    settings.network.enabledSources.join("|"),
    settings.network.neteaseApiBaseUrl,
    settings.network.neteaseCookie,
    settings.network.neteaseProxy,
    settings.network.neteaseRealIp,
    settings.network.requestTimeoutMs,
  ]);

  useEffect(() => {
    if (!playbarDisplayTrack) {
      syncCurrentTrackLyrics(null);
      if (isCurrentTrackLyricsLoading) {
        setIsCurrentTrackLyricsLoading(false);
      }
      return;
    }

    const neteaseTrackId = parseNeteaseTrackIdFromCacheKey(playbarDisplayTrack.playback.cacheKey);
    if (
      playbarDisplayTrack.source.kind !== "remoteStream" ||
      !neteaseTrackId ||
      !isNeteaseSourceEnabled(settingsRef.current)
    ) {
      syncCurrentTrackLyrics(null);
      if (isCurrentTrackLyricsLoading) {
        setIsCurrentTrackLyricsLoading(false);
      }
      return;
    }

    const cacheKey = `${neteaseTrackId}`;
    if (Object.prototype.hasOwnProperty.call(lyricsCacheRef.current, cacheKey)) {
      syncCurrentTrackLyrics(lyricsCacheRef.current[cacheKey] ?? null);
      if (isCurrentTrackLyricsLoading) {
        setIsCurrentTrackLyricsLoading(false);
      }
      return;
    }

    let isCancelled = false;
    setIsCurrentTrackLyricsLoading(true);

    void getNeteaseSongLyrics(settingsRef.current, neteaseTrackId)
      .then((lyrics) => {
        if (isCancelled) {
          return;
        }

        setBoundedRecordValue<NeteaseSongLyrics | null>(
          lyricsCacheRef.current,
          cacheKey,
          lyrics,
          LYRICS_CACHE_LIMIT,
          [cacheKey],
        );
        syncCurrentTrackLyrics(lyrics);
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }

        console.error("[immersive-player] failed to load lyrics", error);
        setBoundedRecordValue<NeteaseSongLyrics | null>(
          lyricsCacheRef.current,
          cacheKey,
          null,
          LYRICS_CACHE_LIMIT,
          [cacheKey],
        );
        syncCurrentTrackLyrics(null);
      })
      .finally(() => {
        if (!isCancelled) {
          setIsCurrentTrackLyricsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isCurrentTrackLyricsLoading, playbarDisplayTrack]);

  useEffect(() => {
    if (!activeTrackArtworkUrl) {
      syncImmersiveArtworkPalette(null);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(immersivePaletteCacheRef.current, activeTrackArtworkUrl)) {
      syncImmersiveArtworkPalette(immersivePaletteCacheRef.current[activeTrackArtworkUrl] ?? null);
      return;
    }

    let isCancelled = false;
    syncImmersiveArtworkPalette(null);

    void sampleImmersiveArtworkPalette(activeTrackArtworkUrl).then((palette) => {
      if (isCancelled) {
        return;
      }

      setBoundedRecordValue(
        immersivePaletteCacheRef.current,
        activeTrackArtworkUrl,
        palette,
        IMMERSIVE_PALETTE_CACHE_LIMIT,
        [activeTrackArtworkUrl],
      );
      syncImmersiveArtworkPalette(palette);
    });

    return () => {
      isCancelled = true;
    };
  }, [activeTrackArtworkUrl]);

  useEffect(() => {
    if (!isImmersivePlayerOpen) {
      return;
    }

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && !isEditableShortcutTarget(activeElement)) {
      activeElement.blur();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const normalizedKey = normalizeShortcutKeyValue(event.key);
      if (
        normalizedKey &&
        !isEditableShortcutTarget(event.target) &&
        shouldPreventDefaultInAppKeyBehavior(normalizedKey)
      ) {
        event.preventDefault();
      }

      if (event.key === "Escape") {
        event.preventDefault();
        syncImmersivePlayerOpen(false);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const normalizedKey = normalizeShortcutKeyValue(event.key);
      if (
        normalizedKey &&
        !isEditableShortcutTarget(event.target) &&
        shouldPreventDefaultInAppKeyBehavior(normalizedKey)
      ) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [isImmersivePlayerOpen]);

  useEffect(() => {
    currentTrackIdRef.current = currentTrackId;
    attemptedPlaybackRecoveryKeyRef.current = null;
    playbackPhaseTrackIdRef.current = currentTrackId;
    playbackPhaseStateRef.current = null;
  }, [currentTrackId]);

  useEffect(() => {
    currentTimeSecondsRef.current = currentTimeSeconds;
  }, [currentTimeSeconds]);

  useEffect(() => {
    playbarDisplayTrackIdRef.current = playbarDisplayTrackId;
  }, [playbarDisplayTrackId]);

  useEffect(() => {
    playbarDisplayTimeSecondsRef.current = playbarDisplayTimeSeconds;
  }, [playbarDisplayTimeSeconds]);

  useEffect(() => {
    playbarDisplayVisualTimeSecondsRef.current = playbarDisplayVisualTimeSeconds;
  }, [playbarDisplayVisualTimeSeconds]);

  useEffect(() => {
    playbarDisplayDurationSecondsRef.current = playbarDisplayDurationSeconds;
  }, [playbarDisplayDurationSeconds]);

  useEffect(() => {
    if (!currentTrackId) {
      playbackPhaseTrackIdRef.current = null;
      playbackPhaseStateRef.current = null;
      return;
    }

    const analysis = trackAnalysisByTrackIdRef.current[currentTrackId];
    if (!analysis) {
      return;
    }

    const currentTimeMs = Math.max(0, Math.round(currentTimeSeconds * 1000));
    const nextPhase = resolveTrackPlaybackPhase(analysis, currentTimeMs);
    const previousTrackId = playbackPhaseTrackIdRef.current;
    const previousPhase = playbackPhaseStateRef.current;

    playbackPhaseTrackIdRef.current = currentTrackId;

    if (nextPhase === previousPhase && previousTrackId === currentTrackId) {
      return;
    }

    playbackPhaseStateRef.current = nextPhase;

    if (nextPhase !== "intro" && nextPhase !== "outro") {
      return;
    }

    console.log("[track-phase]", {
      trackId: currentTrackId,
      phase: nextPhase,
      currentTimeMs,
      introPhaseEndMs: analysis.introPhaseEndMs,
      outroPhaseStartMs: analysis.outroPhaseStartMs,
      analysis: summarizeAutoMixAnalysis(analysis),
    });
  }, [currentTimeSeconds, currentTrackId]);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    visualCurrentTimeSecondsRef.current = visualCurrentTimeSeconds;
  }, [visualCurrentTimeSeconds]);

  useEffect(() => {
    durationSecondsRef.current = durationSeconds;
  }, [durationSeconds]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    isPlaybackLoadingRef.current = isPlaybackLoading;
  }, [isPlaybackLoading]);

  useEffect(() => {
    isImmersivePlayerOpenRef.current = isImmersivePlayerOpen;
  }, [isImmersivePlayerOpen]);

  useEffect(() => {
    return () => {
      if (immersivePlayerOpenFrameRef.current !== null) {
        window.cancelAnimationFrame(immersivePlayerOpenFrameRef.current);
      }
      if (immersivePlayerCloseTimerRef.current !== null) {
        window.clearTimeout(immersivePlayerCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    currentTrackLyricsRef.current = currentTrackLyrics;
  }, [currentTrackLyrics]);

  useEffect(() => {
    immersiveArtworkPaletteRef.current = immersiveArtworkPalette;
  }, [immersiveArtworkPalette]);

  useEffect(() => {
    playbackModeRef.current = playbackMode;
  }, [playbackMode]);

  useEffect(() => {
    playbackQueueIdsRef.current = playbackQueueIds;
  }, [playbackQueueIds]);

  useEffect(() => {
    if (
      (playbackQueueKind === "personal-fm" || playbackQueueKind === "intelligence") &&
      playbackMode !== "ordered"
    ) {
      applyPlaybackModeLocally("ordered");
    }
  }, [playbackMode, playbackQueueKind]);

  useEffect(() => {
    currentQueueIdsRef.current = currentQueueIds;
  }, [currentQueueIds]);

  useEffect(() => {
    if (
      playbackQueueKind !== "personal-fm" ||
      currentQueueIds.length === 0 ||
      !isNeteaseSourceEnabled(settings) ||
      settings.network.neteaseCookie.trim().length === 0
    ) {
      return;
    }

    const remainingTrackCount =
      currentQueueIndex >= 0 ? currentQueueIds.length - currentQueueIndex - 1 : currentQueueIds.length;
    if (remainingTrackCount > 2) {
      return;
    }

    void bufferPersonalFmQueue(4);
  }, [
    currentQueueIds,
    currentQueueIndex,
    playbackQueueKind,
    settings,
  ]);

  useEffect(() => {
    libraryTrackIdsRef.current = libraryTracks.map((track) => track.id);
  }, [libraryTracks]);

  useEffect(() => {
    if (isTimelineSeekingRef.current) {
      return;
    }

    setVisualCurrentTimeSeconds((current) => {
      if (!isPlaying || Math.abs(currentTimeSeconds - current) > 0.35) {
        return currentTimeSeconds;
      }

      return current;
    });
  }, [currentTimeSeconds, isPlaying]);

  useEffect(() => {
    if (isSongTransitionRunningRef.current || timelineOwnerModeRef.current === "playbar") {
      return;
    }

    const activeAudio = getActiveAudioElement();
    syncTimelineOwnerMode("active");
    syncPlaybarProgressFromAudio(activeAudio, {
      trackId: currentTrackId,
      fallbackDurationSeconds:
        durationSeconds > 0
          ? durationSeconds
          : (currentTrack?.durationMs ?? 0) / 1000,
    });
  }, [currentTrack, currentTrackId, durationSeconds]);

  useEffect(() => {
    const audio =
      timelineOwnerModeRef.current === "playbar"
        ? getPlaybarDisplayAudioElement()
        : getActiveAudioElement();

    if (!audio || !isPlaying || isTimelineSeekingRef.current || !isWindowVisibleForUi) {
      if (progressAnimationFrameRef.current !== null) {
        window.clearTimeout(progressAnimationFrameRef.current);
        progressAnimationFrameRef.current = null;
      }
      return;
    }

    const updateVisualProgress = () => {
      const nextTime = audio.currentTime || 0;
      syncPlaybarDisplayState({
        currentTimeSeconds: nextTime,
        visualTimeSeconds: nextTime,
        durationSeconds:
          Number.isFinite(audio.duration) && audio.duration > 0
            ? audio.duration
            : playbarDisplayDurationSecondsRef.current,
      });
      progressAnimationFrameRef.current = window.setTimeout(
        updateVisualProgress,
        VISUAL_PROGRESS_SYNC_INTERVAL_MS,
      );
    };

    progressAnimationFrameRef.current = window.setTimeout(
      updateVisualProgress,
      VISUAL_PROGRESS_SYNC_INTERVAL_MS,
    );

    return () => {
      if (progressAnimationFrameRef.current !== null) {
        window.clearTimeout(progressAnimationFrameRef.current);
        progressAnimationFrameRef.current = null;
      }
    };
  }, [isPlaying, currentTrackId, playbarDisplayTrackId, isWindowVisibleForUi]);

  useEffect(() => {
    if (!currentTrackId) {
      return;
    }

    if (trackLookup.has(currentTrackId)) {
      return;
    }

    setCurrentTrackId(null);
    syncPlaybackVisualState({
      isPlaying: false,
      currentTimeSeconds: 0,
      visualCurrentTimeSeconds: 0,
      durationSeconds: 0,
    });
  }, [currentTrackId, trackLookup]);

  useEffect(
    () => () => {
      cancelPauseFade();
      cancelSongTransition();
    },
    [],
  );

  useEffect(() => {
    if (isPauseFadingRef.current || isSongTransitionRunningRef.current) {
      return;
    }

    const activeAudio = getActiveAudioElement();
    if (activeAudio) {
      setProcessedAudioGain(activeAudio, volume / 100);
    }

    const inactiveAudio = getInactiveAudioElement();
    if (inactiveAudio && inactiveAudio.paused) {
      setProcessedAudioGain(inactiveAudio, volume / 100);
    }
  }, [volume]);

  useEffect(() => {
    const audioEntries: Array<{ slot: AudioSlot; audio: HTMLAudioElement | null }> = [
      { slot: "primary", audio: primaryAudioRef.current },
      { slot: "secondary", audio: secondaryAudioRef.current },
    ];
    const cleanupTasks: Array<() => void> = [];

    for (const entry of audioEntries) {
      const audio = entry.audio;
      if (!audio) {
        continue;
      }

      const isActiveAudio = () => activeAudioSlotRef.current === entry.slot;

      const handleLoadStart = () => {
        if (!isActiveAudio()) {
          return;
        }

        if (audio.dataset.trackId) {
          schedulePlaybackLoadTimeout(audio, audio.dataset.trackId);
        }
        setIsPlaybackLoading(true);
      };

      const handleCanPlay = () => {
        if (!isActiveAudio()) {
          return;
        }

        clearPlaybackLoadTimeout();
        setIsPlaybackLoading(false);
      };

      const handleLoadedMetadata = () => {
        if (!isActiveAudio()) {
          return;
        }

        clearPlaybackLoadTimeout();
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        syncPlaybackVisualState({
          durationSeconds: duration,
          isPlaybackLoading: false,
        });

        const activeTrackId = audio.dataset.trackId ?? currentTrackIdRef.current ?? "";
        const pendingStartIntent = consumePendingPlaybackStartIntent(activeTrackId);
        if (pendingAutoplayRef.current) {
          pendingAutoplayRef.current = false;
          void audio.play().catch((error) => {
            console.error("[player] failed to start playback", error);
            setIsPlaying(false);
            pushDynamicIslandNotification(localeStrings.notifications.playbackFailed);
          });
        }

        if (pendingStartIntent?.source === "restore") {
          setPlaybackRestoreSession(null);
        }
      };

      const handleTimeUpdate = () => {
        if (!isActiveAudio()) {
          return;
        }

        const nextTime = audio.currentTime || 0;
        syncPlaybackVisualState({
          currentTimeSeconds: nextTime,
        });
        schedulePlaybackResumePersistence(320);

        if (!isTimelineSeekingRef.current && !audio.paused) {
          return;
        }

        syncPlaybackVisualState({
          visualCurrentTimeSeconds: nextTime,
        });
      };

      const handlePlay = () => {
        if (!isActiveAudio()) {
          return;
        }

        clearPlaybackLoadTimeout();
        setIsPlaying(true);
        setIsPlaybackLoading(false);
        schedulePlaybackResumePersistence(80);
      };

      const handlePause = () => {
        if (!isActiveAudio()) {
          return;
        }

        setIsPlaying(false);
        schedulePlaybackResumePersistence(0);
      };

      const handleEnded = () => {
        if (!isActiveAudio() || isSongTransitionRunningRef.current) {
          return;
        }

        setIsPlaybackLoading(false);
        void handleSkipToAdjacentTrack(1, { fromEnded: true });
      };

      const handleWaiting = () => {
        if (!isActiveAudio()) {
          return;
        }

        setIsPlaybackLoading(true);
      };

      const handleError = () => {
        if (!isActiveAudio()) {
          return;
        }
        handlePlaybackLoadFailure(audio);
      };

      audio.addEventListener("loadstart", handleLoadStart);
      audio.addEventListener("canplay", handleCanPlay);
      audio.addEventListener("canplaythrough", handleCanPlay);
      audio.addEventListener("loadedmetadata", handleLoadedMetadata);
      audio.addEventListener("timeupdate", handleTimeUpdate);
      audio.addEventListener("play", handlePlay);
      audio.addEventListener("pause", handlePause);
      audio.addEventListener("ended", handleEnded);
      audio.addEventListener("waiting", handleWaiting);
      audio.addEventListener("stalled", handleWaiting);
      audio.addEventListener("error", handleError);

      cleanupTasks.push(() => {
        audio.removeEventListener("loadstart", handleLoadStart);
        audio.removeEventListener("canplay", handleCanPlay);
        audio.removeEventListener("canplaythrough", handleCanPlay);
        audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
        audio.removeEventListener("timeupdate", handleTimeUpdate);
        audio.removeEventListener("play", handlePlay);
        audio.removeEventListener("pause", handlePause);
        audio.removeEventListener("ended", handleEnded);
        audio.removeEventListener("waiting", handleWaiting);
        audio.removeEventListener("stalled", handleWaiting);
        audio.removeEventListener("error", handleError);
      });
    }

    return () => {
      clearPlaybackLoadTimeout();
      cleanupTasks.forEach((cleanup) => cleanup());
    };
  }, [currentTrackId, playbackQueueIds, localeStrings.notifications.playbackFailed, localeStrings.notifications.playbackRecovered, localeStrings.notifications.trackUnavailable]);

  useEffect(() => {
    const activeAudio = getActiveAudioElement();

    if (!activeAudio) {
      return;
    }

    if (!currentTrack) {
      syncTimelineOwnerMode("active");
      cancelSongTransition();
      activeAudioSlotRef.current = "primary";
      syncActiveAudioReference("primary");
      resetAudioElement(primaryAudioRef.current);
      resetAudioElement(secondaryAudioRef.current);
      playbackCandidatesRef.current = [];
      playbackCandidateIndexRef.current = 0;
      syncPlaybackVisualState({
        currentTimeSeconds: 0,
        visualCurrentTimeSeconds: 0,
        durationSeconds: 0,
        isPlaying: false,
        isPlaybackLoading: false,
      });
      syncPlaybarDisplayState({
        trackId: null,
        currentTimeSeconds: 0,
        visualTimeSeconds: 0,
        durationSeconds: 0,
      });
      return;
    }

    if (activeAudio.dataset.trackId === currentTrack.id && activeAudio.src) {
      if (!isSongTransitionRunningRef.current) {
        resetAudioElement(getInactiveAudioElement());
      }

      syncPlaybackVisualState({
        durationSeconds: Number.isFinite(activeAudio.duration)
          ? activeAudio.duration
          : (currentTrack.durationMs ?? 0) / 1000,
        isPlaybackLoading: false,
      });

      const pendingStartIntent = peekPendingPlaybackStartIntent(currentTrack.id);
      if (pendingAutoplayRef.current && activeAudio.paused) {
        pendingAutoplayRef.current = false;
        consumePendingPlaybackStartIntent(currentTrack.id);
        void activeAudio.play().catch((error) => {
          console.error("[player] failed to resume playback", error);
          setIsPlaying(false);
          pushDynamicIslandNotification(localeStrings.notifications.playbackFailed);
        });
      }
      if (pendingStartIntent?.source === "restore") {
        setPlaybackRestoreSession(null);
      }
      return;
    }

    const nextCandidates = resolveTrackPlaybackCandidates(
      currentTrack,
      settings,
      playbackCachedAudioPathsRef.current[currentTrack.id] ?? null,
    );

    if (nextCandidates.length === 0) {
      syncPlaybackVisualState({
        isPlaying: false,
        isPlaybackLoading: false,
        currentTimeSeconds: 0,
        visualCurrentTimeSeconds: 0,
        durationSeconds: (currentTrack.durationMs ?? 0) / 1000,
      });
      pushDynamicIslandNotification(localeStrings.notifications.trackUnsupported);
      return;
    }

    playbackCandidatesRef.current = nextCandidates;
    playbackCandidateIndexRef.current = 0;
    pauseActiveTrackForTransition();
    activeAudio.dataset.trackId = currentTrack.id;
    setIsPlaybackLoading(true);
    activeAudio.src = nextCandidates[0];
    activeAudio.load();
    schedulePlaybackLoadTimeout(activeAudio, currentTrack.id);
    syncPlaybackVisualState({
      currentTimeSeconds: 0,
      visualCurrentTimeSeconds: 0,
      durationSeconds: (currentTrack.durationMs ?? 0) / 1000,
    });
  }, [
    currentTrackId,
    settings.playback.preferRemoteStreaming,
    localeStrings.notifications.playbackFailed,
    localeStrings.notifications.trackUnsupported,
  ]);

  useEffect(() => {
    if (playbackMode !== "shuffle") {
      setShuffledQueueIds((current) => (current.length === 0 ? current : []));
      return;
    }

    if (orderedQueueIds.length === 0) {
      setShuffledQueueIds((current) => (current.length === 0 ? current : []));
      return;
    }

    setShuffledQueueIds((current) => {
      if (
        current.length === orderedQueueIds.length &&
        orderedQueueIds.every((id) => current.includes(id))
      ) {
        return current;
      }

      return buildShuffledQueue(orderedQueueIds, currentTrackId);
    });
  }, [playbackMode, orderedQueueIds, currentTrackId]);

  const handleMinimize = async () => {
    await getCurrentWindow().minimize();
  };

  const syncWindowFrameState = async () => {
    const currentWindow = getCurrentWindow();
    const [nextIsMaximized, nextIsFullscreen] = await Promise.all([
      currentWindow.isMaximized(),
      currentWindow.isFullscreen(),
    ]);
    syncWindowFrameStateValue(nextIsMaximized, nextIsFullscreen);
  };

  const handleToggleMaximize = async () => {
    const currentWindow = getCurrentWindow();
    await currentWindow.toggleMaximize();
    await syncWindowFrameState();
  };

  const handleToggleFullscreen = async () => {
    try {
      const currentWindow = getCurrentWindow();
      const nextFullscreen = !(await currentWindow.isFullscreen());
      await currentWindow.setFullscreen(nextFullscreen);
      await syncWindowFrameState();
    } catch (error) {
      console.error("[window] failed to toggle fullscreen", error);
    }
  };

  const handleStartDragging = async () => {
    if (isFullscreen) {
      return;
    }

    await getCurrentWindow().startDragging();
  };

  const pushDynamicIslandNotification = (message: string) => {
    setDynamicIslandNotification({
      id: Date.now(),
      message,
    });
  };

  const syncPlaybackQueueKind = (nextKind: PlaybackQueueKind) => {
    if (playbackQueueKindRef.current === nextKind) {
      return;
    }

    playbackQueueKindRef.current = nextKind;
    setPlaybackQueueKind(nextKind);
  };

  const applyPlaybackModeLocally = (nextMode: PlaybackModeOption) => {
    setPlaybackMode(nextMode);
    playbackModeRef.current = nextMode;

    if (nextMode === "shuffle") {
      const baseQueueIds =
        orderedQueueIds.length > 0 ? orderedQueueIds : libraryTracks.map((track) => track.id);
      const nextShuffledQueueIds = buildShuffledQueue(baseQueueIds, currentTrackIdRef.current);
      currentQueueIdsRef.current = nextShuffledQueueIds;
      setShuffledQueueIds(nextShuffledQueueIds);
    } else {
      currentQueueIdsRef.current = orderedQueueIds;
      setShuffledQueueIds([]);
    }
  };

  const enableLockedQueuePlaybackMode = (queueKind: Extract<PlaybackQueueKind, "personal-fm" | "intelligence">) => {
    if (lockedQueuePreviousPlaybackModeRef.current === null) {
      lockedQueuePreviousPlaybackModeRef.current = playbackModeRef.current;
    }

    syncPlaybackQueueKind(queueKind);
    if (playbackModeRef.current !== "ordered") {
      applyPlaybackModeLocally("ordered");
    }
  };

  const disableLockedQueuePlaybackMode = () => {
    const previousMode = lockedQueuePreviousPlaybackModeRef.current;
    lockedQueuePreviousPlaybackModeRef.current = null;
    personalFmQueueSongsRef.current = [];
    syncPlaybackQueueKind("standard");

    if (previousMode && playbackModeRef.current !== previousMode) {
      applyPlaybackModeLocally(previousMode);
    }
  };

  const syncPersistedSettingsState = (nextSettings: AppSettings) => {
    persistedSettingsSerializedRef.current = JSON.stringify(nextSettings);
    persistedScanDirectoriesKeyRef.current = JSON.stringify(nextSettings.library.scanDirectories);
  };

  const readPersistedPlaybackResumeState = (): PersistedPlaybackResumeState => {
    if (typeof window === "undefined") {
      return { queueIds: [], trackId: null };
    }

    try {
      const rawValue = window.localStorage.getItem(PLAYBACK_RESUME_STORAGE_KEY);
      if (!rawValue) {
        return { queueIds: [], trackId: null };
      }

      const parsedValue = JSON.parse(rawValue) as Partial<PersistedPlaybackResumeState> | null;
      const queueIds = Array.isArray(parsedValue?.queueIds)
        ? parsedValue.queueIds.filter((trackId): trackId is string => typeof trackId === "string" && trackId.trim().length > 0)
        : [];
      const trackId =
        typeof parsedValue?.trackId === "string" && parsedValue.trackId.trim().length > 0
          ? parsedValue.trackId
          : null;

      return {
        queueIds,
        trackId,
      };
    } catch (error) {
      console.error("[player] failed to read persisted playback resume state", error);
      return { queueIds: [], trackId: null };
    }
  };

  const writePersistedPlaybackResumeState = (state: PersistedPlaybackResumeState) => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(PLAYBACK_RESUME_STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("[player] failed to write persisted playback resume state", error);
    }
  };

  const applySavedSettingsSnapshot = (
    requestedSettings: AppSettings,
    snapshot: AppSettingsSnapshot,
    options?: {
      syncUiState?: boolean;
      syncPersistedState?: boolean;
    },
  ) => {
    const shouldSyncUiState = options?.syncUiState ?? true;
    const shouldSyncPersistedState = options?.syncPersistedState ?? true;
    const currentSettingsSerialized = JSON.stringify(settingsRef.current);
    const requestedSettingsSerialized = JSON.stringify(requestedSettings);
    const canApplyToUi = shouldSyncUiState && currentSettingsSerialized === requestedSettingsSerialized;

    if (canApplyToUi) {
      setSettings(snapshot.settings);
      settingsRef.current = snapshot.settings;
      setVolume(snapshot.settings.playback.defaultVolume);
      setPlaybackMode(snapshot.settings.playback.playbackMode);
    }

    savedWindowSizeKeyRef.current = buildWindowSizeKey(
      snapshot.settings.window.width,
      snapshot.settings.window.height,
    );
    pendingWindowSizeKeyRef.current = "";

    if (shouldSyncPersistedState) {
      syncPersistedSettingsState(snapshot.settings);
    }

    return {
      appliedToUi: canApplyToUi,
    };
  };

  const stripPlaybackResumeFields = (settingsSnapshot: AppSettings) => ({
    ...settingsSnapshot,
    playback: {
      ...settingsSnapshot.playback,
      resumeQueueTrackIds: [],
      resumeTrackId: null,
    },
  });

  const buildPlaybackResumeSettings = (baseSettings: AppSettings) => {
    const sourceQueueIds =
      currentQueueIdsRef.current.length > 0 ? currentQueueIdsRef.current : playbackQueueIdsRef.current;
    const persistedQueueTrackIds = sourceQueueIds.filter((trackId) =>
      Boolean(trackId) &&
      (findTrackById(trackId) !== null || parseNeteaseTrackIdFromCacheKey(trackId) !== null),
    );
    const persistedCurrentTrackId =
      currentTrackId &&
      (findTrackById(currentTrackId) !== null || parseNeteaseTrackIdFromCacheKey(currentTrackId) !== null)
        ? currentTrackId
        : null;
    const nextPlaybackState = {
      resumeQueueTrackIds: baseSettings.playback.rememberQueue ? persistedQueueTrackIds : [],
      resumeTrackId: baseSettings.playback.rememberQueue ? persistedCurrentTrackId : null,
    };

    return {
      ...baseSettings,
      playback: {
        ...baseSettings.playback,
        ...nextPlaybackState,
      },
    } satisfies AppSettings;
  };

  const persistPlaybackResumeSettings = async () => {
    const baseSettings = settingsRef.current;
    const nextSettings = buildPlaybackResumeSettings(baseSettings);
    writePersistedPlaybackResumeState({
      queueIds: nextSettings.playback.resumeQueueTrackIds,
      trackId: nextSettings.playback.resumeTrackId,
    });

    settingsRef.current = nextSettings;
    setSettings(nextSettings);

    const snapshot = await saveAppSettings(nextSettings);
    const currentSettingsWithoutResume = JSON.stringify(
      stripPlaybackResumeFields(settingsRef.current),
    );
    const savedSettingsWithoutResume = JSON.stringify(
      stripPlaybackResumeFields(snapshot.settings),
    );

    if (currentSettingsWithoutResume !== savedSettingsWithoutResume) {
      console.log("[settings] skip stale playback resume snapshot", {
        currentSongTransitionMode: settingsRef.current.playback.songTransitionMode,
        savedSongTransitionMode: snapshot.settings.playback.songTransitionMode,
      });
      syncPersistedSettingsState(snapshot.settings);
      savedWindowSizeKeyRef.current = buildWindowSizeKey(
        snapshot.settings.window.width,
        snapshot.settings.window.height,
      );
      pendingWindowSizeKeyRef.current = "";
      return snapshot;
    }

    applySavedSettingsSnapshot(nextSettings, snapshot);
    return snapshot;
  };

  const schedulePlaybackResumePersistence = (delayMs = 220) => {
    if (isSettingsLoadingRef.current) {
      return;
    }

    if (playbackStateSaveTimerRef.current) {
      window.clearTimeout(playbackStateSaveTimerRef.current);
    }

    playbackStateSaveTimerRef.current = window.setTimeout(() => {
      playbackStateSaveTimerRef.current = null;
      void persistPlaybackResumeSettings().catch((error) => {
        console.error("[player] failed to save playback queue state", error);
        pushDynamicIslandNotification(localeStrings.notifications.playbackRestoreFailed);
      });
    }, delayMs);
  };

  const persistSettingsSnapshot = async (
    nextSettings: AppSettings,
    options?: {
      notifySuccess?: boolean;
      notifyFailure?: boolean;
      triggerLibraryScan?: boolean;
      successMessage?: string;
      failureMessage?: string;
    },
  ) => {
    const requestId = settingsSaveRequestIdRef.current + 1;
    settingsSaveRequestIdRef.current = requestId;
    setIsSettingsSaving(true);

    try {
      const previousScanDirectoriesKey = persistedScanDirectoriesKeyRef.current;
      const snapshot = await saveAppSettings(nextSettings);

      if (settingsSaveRequestIdRef.current !== requestId) {
        return snapshot;
      }

      applySavedSettingsSnapshot(nextSettings, snapshot);

      if (
        options?.triggerLibraryScan &&
        previousScanDirectoriesKey !== JSON.stringify(snapshot.settings.library.scanDirectories)
      ) {
        await runMediaImport(snapshot.settings.library.scanDirectories, null);
      }

      if (options?.notifySuccess && options.successMessage) {
        pushDynamicIslandNotification(options.successMessage);
      }

      return snapshot;
    } catch (error) {
      console.error("[settings] failed to persist settings", error);

      if (options?.notifyFailure && options.failureMessage) {
        pushDynamicIslandNotification(options.failureMessage);
      }

      throw error;
    } finally {
      if (settingsSaveRequestIdRef.current === requestId) {
        setIsSettingsSaving(false);
      }
    }
  };

  const scheduleSettingsAutoSave = (nextSettings: AppSettings) => {
    if (persistedSettingsSerializedRef.current === JSON.stringify(nextSettings)) {
      return;
    }

    if (settingsAutoSaveTimerRef.current !== null) {
      window.clearTimeout(settingsAutoSaveTimerRef.current);
    }

    settingsAutoSaveTimerRef.current = window.setTimeout(() => {
      settingsAutoSaveTimerRef.current = null;
      void persistSettingsSnapshot(nextSettings, {
        notifyFailure: true,
        notifySuccess: false,
        triggerLibraryScan: true,
        failureMessage: localeStrings.notifications.settingsSaveFailed,
      }).catch(() => undefined);
    }, 720);
  };

  const updateSettings = (updater: (current: AppSettings) => AppSettings) => {
    let nextSettingsSnapshot: AppSettings | null = null;

    setSettings((current) => {
      const nextSettings = updater(current);
      settingsRef.current = nextSettings;
      nextSettingsSnapshot = nextSettings;
      return nextSettings;
    });

    if (nextSettingsSnapshot) {
      scheduleSettingsAutoSave(nextSettingsSnapshot);
    }
  };

  const invalidateNeteaseUiCaches = (options?: { playlistId?: number | null }) => {
    neteaseHomeFeedCache.clear();
    neteasePlaylistLibraryCache.clear();

    if (options?.playlistId) {
      const detailCacheKey = buildNeteaseCacheKey(
        settingsRef.current,
        `playlist:detail:${options.playlistId}`,
      );
      const tracksCacheKey = buildNeteaseCacheKey(
        settingsRef.current,
        `playlist:tracks:${options.playlistId}`,
      );
      neteasePlaylistDetailCache.delete(detailCacheKey);
      neteasePlaylistTracksCache.delete(tracksCacheKey);
    } else {
      neteasePlaylistDetailCache.clear();
      neteasePlaylistTracksCache.clear();
    }

    setNeteaseUiVersion((current) => current + 1);
  };

  const openCreatePlaylistEditor = () => {
    if (
      isPlaylistEditorClosing ||
      (typeof performance !== "undefined" &&
        performance.now() < playlistEditorReopenLockUntilRef.current)
    ) {
      return;
    }

    if (playlistEditorCloseTimerRef.current) {
      window.clearTimeout(playlistEditorCloseTimerRef.current);
      playlistEditorCloseTimerRef.current = null;
    }

    setIsPlaylistEditorClosing(false);
    setPlaylistEditorState({
      mode: "create",
      playlist: null,
    });
  };

  const openEditPlaylistEditor = (playlist: NeteasePlaylistRecommendation) => {
    if (
      isPlaylistEditorClosing ||
      (typeof performance !== "undefined" &&
        performance.now() < playlistEditorReopenLockUntilRef.current)
    ) {
      return;
    }

    if (playlistEditorCloseTimerRef.current) {
      window.clearTimeout(playlistEditorCloseTimerRef.current);
      playlistEditorCloseTimerRef.current = null;
    }

    setIsPlaylistEditorClosing(false);
    setPlaylistEditorState({
      mode: "edit",
      playlist,
    });
  };

  const closePlaylistEditor = (options?: { force?: boolean }) => {
    if (isSubmittingPlaylistEditor && !options?.force) {
      return;
    }

    if (!playlistEditorState) {
      return;
    }

    if (playlistEditorCloseTimerRef.current) {
      window.clearTimeout(playlistEditorCloseTimerRef.current);
    }

    playlistEditorReopenLockUntilRef.current =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) + 320;
    setIsPlaylistEditorClosing(true);
    playlistEditorCloseTimerRef.current = window.setTimeout(() => {
      playlistEditorCloseTimerRef.current = null;
      setPlaylistEditorState(null);
      setIsPlaylistEditorClosing(false);
    }, PLAYLIST_EDITOR_CLOSE_DURATION_MS);
  };

  const closeContextMenu = () => {
    if (!contextMenuStateRef.current) {
      return;
    }

    setIsContextMenuClosing(true);

    if (contextMenuCloseTimerRef.current) {
      window.clearTimeout(contextMenuCloseTimerRef.current);
    }

    contextMenuCloseTimerRef.current = window.setTimeout(() => {
      contextMenuCloseTimerRef.current = null;
      setContextMenuState(null);
      setIsContextMenuClosing(false);
    }, 140);
  };

  const openContextMenu = (event: ReactMouseEvent<HTMLElement>, target: ContextMenuTarget) => {
    event.preventDefault();
    event.stopPropagation();

    if (contextMenuCloseTimerRef.current) {
      window.clearTimeout(contextMenuCloseTimerRef.current);
      contextMenuCloseTimerRef.current = null;
    }

    setIsContextMenuClosing(false);
    setContextMenuState({
      x: event.clientX,
      y: event.clientY,
      target,
    });
  };

  const ensureNeteaseAccount = async () => {
    if (
      !isNeteaseSourceEnabled(settingsRef.current) ||
      settingsRef.current.network.neteaseCookie.trim().length === 0
    ) {
      return null;
    }

    const playlistLibraryCacheKey = buildNeteaseCacheKey(settingsRef.current, "playlist:library");
    const cachedPlaylistLibrary = neteasePlaylistLibraryCache.get(playlistLibraryCacheKey);
    if (cachedPlaylistLibrary?.account) {
      return cachedPlaylistLibrary.account;
    }

    const account = await getNeteaseLoggedInAccount(settingsRef.current).catch(() => null);
    if (cachedPlaylistLibrary || account) {
      setBoundedMapValue(neteasePlaylistLibraryCache, playlistLibraryCacheKey, {
        account,
        userPlaylists: cachedPlaylistLibrary?.userPlaylists ?? [],
      }, NETEASE_PLAYLIST_LIBRARY_CACHE_LIMIT);
    }
    return account;
  };

  const ensureOwnedPlaylistsForContextMenu = async () => {
    setIsContextMenuPlaylistLoading(true);

    try {
      const account = await ensureNeteaseAccount();
      if (!account) {
        setContextMenuOwnedPlaylists([]);
        return {
          account: null,
          playlists: [],
        };
      }

      const playlistLibraryCacheKey = buildNeteaseCacheKey(settingsRef.current, "playlist:library");
      const cachedPlaylistLibrary = neteasePlaylistLibraryCache.get(playlistLibraryCacheKey);

      if (cachedPlaylistLibrary && cachedPlaylistLibrary.userPlaylists.length > 0) {
        const ownPlaylists = cachedPlaylistLibrary.userPlaylists.filter(
          (playlist) => playlist.creatorUserId === account.userId,
        );
        setContextMenuOwnedPlaylists(ownPlaylists);
        return {
          account,
          playlists: ownPlaylists,
        };
      }

      const userPlaylists = await getNeteaseUserPlaylists(settingsRef.current, account.userId, 50);
      setBoundedMapValue(neteasePlaylistLibraryCache, playlistLibraryCacheKey, {
        account,
        userPlaylists,
      }, NETEASE_PLAYLIST_LIBRARY_CACHE_LIMIT);

      const ownPlaylists = userPlaylists.filter((playlist) => playlist.creatorUserId === account.userId);
      setContextMenuOwnedPlaylists(ownPlaylists);
      return {
        account,
        playlists: ownPlaylists,
      };
    } finally {
      setIsContextMenuPlaylistLoading(false);
    }
  };

  const ensureOwnedPlaylistsForToolImport = async () => {
    setIsToolPlaylistsLoading(true);

    try {
      const account = await ensureNeteaseAccount();
      if (!account) {
        setToolOwnedPlaylists([]);
        return {
          account: null,
          playlists: [],
        };
      }

      const playlistLibraryCacheKey = buildNeteaseCacheKey(settingsRef.current, "playlist:library");
      const cachedPlaylistLibrary = neteasePlaylistLibraryCache.get(playlistLibraryCacheKey);
      const cachedOwnPlaylists =
        cachedPlaylistLibrary?.userPlaylists.filter((playlist) => playlist.creatorUserId === account.userId) ??
        [];

      if (cachedOwnPlaylists.length > 0) {
        setToolOwnedPlaylists(cachedOwnPlaylists);
        setSelectedKugouImportPlaylistId((current) =>
          current && cachedOwnPlaylists.some((playlist) => String(playlist.id) === current)
            ? current
            : String(cachedOwnPlaylists[0]?.id ?? ""),
        );
        return {
          account,
          playlists: cachedOwnPlaylists,
        };
      }

      const userPlaylists = await getNeteaseUserPlaylists(settingsRef.current, account.userId, 50);
      setBoundedMapValue(neteasePlaylistLibraryCache, playlistLibraryCacheKey, {
        account,
        userPlaylists,
      }, NETEASE_PLAYLIST_LIBRARY_CACHE_LIMIT);

      const ownPlaylists = userPlaylists.filter((playlist) => playlist.creatorUserId === account.userId);
      setToolOwnedPlaylists(ownPlaylists);
      setSelectedKugouImportPlaylistId((current) =>
        current && ownPlaylists.some((playlist) => String(playlist.id) === current)
          ? current
          : String(ownPlaylists[0]?.id ?? ""),
      );
      return {
        account,
        playlists: ownPlaylists,
      };
    } finally {
      setIsToolPlaylistsLoading(false);
    }
  };

  const handleLoadKugouImportFile = async (file: File | null) => {
    if (!file) {
      return;
    }

    try {
      const text = await readKugouPlaylistFile(file);
      const parsedTracks = parseKugouPlaylistJson(text);
      setKugouImportTracks(parsedTracks);
      setKugouImportFileName(file.name);
      setKugouImportLogs([]);
      setKugouImportPhase("idle");
      setKugouImportProgress({
        current: 0,
        total: parsedTracks.length,
        matched: 0,
        skipped: 0,
        duplicate: 0,
        failed: 0,
      });
    } catch (error) {
      console.error("[kugou-import] failed to parse json file", error);
      setKugouImportTracks([]);
      setKugouImportFileName(file.name);
      setKugouImportLogs([]);
      setKugouImportPhase("idle");
      setKugouImportProgress({
        current: 0,
        total: 0,
        matched: 0,
        skipped: 0,
        duplicate: 0,
        failed: 0,
      });
      pushDynamicIslandNotification(localeStrings.notifications.kugouImportInvalidFile);
    }
  };

  const normalizeKugouImportOption = (
    value: number,
    minimum: number,
    maximum: number,
    fallback: number,
  ) => {
    if (!Number.isFinite(value)) {
      return fallback;
    }

    return clampNumber(Math.round(value), minimum, maximum);
  };

  const getKugouImportConfig = (): KugouImportConfig => ({
    errorRetryCount: normalizeKugouImportOption(kugouImportErrorRetryCount, 0, 5, 1),
    unresolvedRetryCount: normalizeKugouImportOption(kugouImportUnresolvedRetryCount, 0, 5, 1),
    timeoutMs: normalizeKugouImportOption(kugouImportTimeoutMs, 1000, 30000, 6000),
    concurrency: normalizeKugouImportOption(kugouImportConcurrency, 1, 8, 3),
    matchStrictness: kugouImportMatchStrictness,
  });

  const withKugouImportTimeout = async <T,>(
    task: () => Promise<T>,
    timeoutMs: number,
  ): Promise<T> => {
    let timerId: number | null = null;

    return await Promise.race([
      task(),
      new Promise<T>((_, reject) => {
        timerId = window.setTimeout(() => {
          reject(
            new Error(copy.locale === "en-US" ? "Request timed out" : "请求超时"),
          );
        }, timeoutMs);
      }),
    ]).finally(() => {
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    });
  };

  const waitForKugouImportRetryDelay = (delayMs: number) =>
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, delayMs);
    });

  const runKugouImportRequestWithRetry = async <T,>(
    task: () => Promise<T>,
    timeoutMs: number,
    retryCount: number,
    options?: {
      runRetryExclusively?: <R>(retryTask: () => Promise<R>) => Promise<R>;
      retryDelayMs?: number;
    },
  ) => {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      try {
        const currentTask =
          attempt > 0
            ? async () => {
                const retryDelayMs = Math.max(220, options?.retryDelayMs ?? 420);
                await waitForKugouImportRetryDelay(retryDelayMs + (attempt - 1) * 180);
                return await withKugouImportTimeout(task, timeoutMs);
              }
            : () => withKugouImportTimeout(task, timeoutMs);

        if (attempt > 0 && options?.runRetryExclusively) {
          return await options.runRetryExclusively(currentTask);
        }

        return await currentTask();
      } catch (error) {
        lastError = error;
        if (attempt >= retryCount) {
          throw error;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Unknown import request error");
  };

  const buildKugouImportSourceDuplicateKey = (sourceTrack: ParsedKugouPlaylistTrack) =>
    `${sourceTrack.title.trim().toLowerCase()}::${sourceTrack.artists
      .map((artist) => artist.trim().toLowerCase())
      .filter(Boolean)
      .join("|")}`;

  const buildKugouImportProgressSnapshot = (
    logs: KugouImportLogEntry[],
    total: number,
  ) => {
    const nextProgress = {
      current: total > 0 ? Math.min(total, logs.length) : 0,
      total,
      matched: 0,
      skipped: 0,
      duplicate: 0,
      failed: 0,
    };

    for (const entry of logs) {
      if (entry.status === "matched") {
        nextProgress.matched += 1;
      } else if (entry.status === "skipped") {
        nextProgress.skipped += 1;
      } else if (entry.status === "duplicate") {
        nextProgress.duplicate += 1;
      } else if (entry.status === "failed") {
        nextProgress.failed += 1;
      }
    }

    return nextProgress;
  };

  const loadKugouImportTargetTrackIds = async (playlistId: number) => {
    const playlistTracksCacheKey = buildNeteaseCacheKey(
      settingsRef.current,
      `playlist:tracks:${playlistId}`,
    );
    const cachedTracks = neteasePlaylistTracksCache.get(playlistTracksCacheKey);
  const playlistTracks =
      cachedTracks ??
      (await getAllNeteasePlaylistTracks(settingsRef.current, playlistId));

    if (!cachedTracks) {
      setBoundedMapValue(
        neteasePlaylistTracksCache,
        playlistTracksCacheKey,
        playlistTracks,
        NETEASE_PLAYLIST_TRACKS_CACHE_LIMIT,
      );
    }

    return new Set(playlistTracks.map((track) => track.id));
  };

  const resolveKugouTrackMatch = async (
    sourceTrack: ParsedKugouPlaylistTrack,
    timeoutMs: number,
    errorRetryCount: number,
    unresolvedRetryCount: number,
    matchStrictness: KugouTrackMatchStrictness,
    options?: {
      runRetryExclusively?: <R>(retryTask: () => Promise<R>) => Promise<R>;
      retryDelayMs?: number;
    },
  ) => {
    let bestMatch: ReturnType<typeof findBestKugouTrackMatch> = null;

    for (let searchRound = 0; searchRound <= unresolvedRetryCount; searchRound += 1) {
      for (const query of sourceTrack.searchQueries) {
        const searchResults = await runKugouImportRequestWithRetry(
          () =>
            searchNeteaseSongs(settingsRef.current, query, {
              limit: 12,
            }),
          timeoutMs,
          errorRetryCount,
          options,
        );
        const matchedCandidate = findBestKugouTrackMatch(
          sourceTrack,
          query,
          searchResults,
          matchStrictness,
        );

        if (matchedCandidate && (!bestMatch || matchedCandidate.score > bestMatch.score)) {
          bestMatch = matchedCandidate;
        }

        if (bestMatch && bestMatch.score >= 112) {
          return bestMatch;
        }
      }
    }

    return bestMatch;
  };

  const runSingleKugouImportTrack = async ({
    sourceTrack,
    playlistId,
    timeoutMs,
    errorRetryCount,
    unresolvedRetryCount,
    matchStrictness,
    existingTargetTrackIds,
    seenSourceDuplicateKeys,
    reservedMatchedTrackIds,
    runRetryExclusively,
    allowDuplicateRetry,
  }: {
    sourceTrack: ParsedKugouPlaylistTrack;
    playlistId: number;
    timeoutMs: number;
    errorRetryCount: number;
    unresolvedRetryCount: number;
    matchStrictness: KugouTrackMatchStrictness;
    existingTargetTrackIds: Set<number>;
    seenSourceDuplicateKeys: Set<string>;
    reservedMatchedTrackIds: Set<number>;
    runRetryExclusively: <R>(retryTask: () => Promise<R>) => Promise<R>;
    allowDuplicateRetry?: boolean;
  }): Promise<KugouImportLogEntry> => {
    const kugouImportCopy = getKugouImportCopy(copy.locale);
    const artistLabel =
      sourceTrack.artists.join(" / ") || kugouImportCopy.previewArtistsFallback;
    const sourceDuplicateKey = buildKugouImportSourceDuplicateKey(sourceTrack);

    if (!allowDuplicateRetry) {
      if (seenSourceDuplicateKeys.has(sourceDuplicateKey)) {
        return {
          sourceIndex: sourceTrack.index,
          trackTitle: sourceTrack.title,
          artistLabel,
          status: "duplicate",
          detail: kugouImportCopy.duplicateInImport,
        };
      }

      seenSourceDuplicateKeys.add(sourceDuplicateKey);
    }

    const bestMatch = await resolveKugouTrackMatch(
      sourceTrack,
      timeoutMs,
      errorRetryCount,
      unresolvedRetryCount,
      matchStrictness,
      {
        runRetryExclusively,
        retryDelayMs: 480,
      },
    );

    if (!bestMatch) {
      return {
        sourceIndex: sourceTrack.index,
        trackTitle: sourceTrack.title,
        artistLabel,
        status: "skipped",
        detail: copy.locale === "en-US" ? "No Netease match found" : "未找到匹配歌曲",
      };
    }

    if (!allowDuplicateRetry) {
      if (existingTargetTrackIds.has(bestMatch.songId)) {
        return {
          sourceIndex: sourceTrack.index,
          trackTitle: sourceTrack.title,
          artistLabel,
          status: "duplicate",
          detail: kugouImportCopy.duplicateInPlaylist,
        };
      }

      if (reservedMatchedTrackIds.has(bestMatch.songId)) {
        return {
          sourceIndex: sourceTrack.index,
          trackTitle: sourceTrack.title,
          artistLabel,
          status: "duplicate",
          detail: kugouImportCopy.duplicateSkipped,
        };
      }

      reservedMatchedTrackIds.add(bestMatch.songId);
    }

    try {
      await runKugouImportRequestWithRetry(
        () => addTracksToNeteasePlaylist(settingsRef.current, playlistId, [bestMatch.songId]),
        timeoutMs,
        errorRetryCount,
        {
          runRetryExclusively,
          retryDelayMs: 520,
        },
      );

      existingTargetTrackIds.add(bestMatch.songId);
      return {
        sourceIndex: sourceTrack.index,
        trackTitle: sourceTrack.title,
        artistLabel,
        status: "matched",
        detail: `${bestMatch.title} - ${bestMatch.artists.join(" / ") || artistLabel}`,
      };
    } finally {
      if (!allowDuplicateRetry) {
        reservedMatchedTrackIds.delete(bestMatch.songId);
      }
    }
  };

  const handleImportKugouPlaylist = async () => {
    const playlistId = Number(selectedKugouImportPlaylistId);
    if (!Number.isFinite(playlistId) || kugouImportTracks.length === 0) {
      return;
    }

    const { account, playlists } = await ensureOwnedPlaylistsForToolImport();
    if (!account) {
      pushDynamicIslandNotification(localeStrings.notifications.contextLoginRequired);
      return;
    }

    if (!playlists.some((playlist) => playlist.id === playlistId)) {
      pushDynamicIslandNotification(localeStrings.notifications.contextPlaylistUnavailable);
      return;
    }

    setIsImportingKugouPlaylist(true);
    setKugouImportLogs([]);
    setKugouImportPhase("running");
    setKugouImportProgress({
      current: 0,
      total: kugouImportTracks.length,
      matched: 0,
      skipped: 0,
      duplicate: 0,
      failed: 0,
    });

    try {
      const existingTargetTrackIds = await loadKugouImportTargetTrackIds(playlistId);
      const seenSourceDuplicateKeys = new Set<string>();
      const reservedMatchedTrackIds = new Set<number>();
      let completed = 0;
      const finalLogs: KugouImportLogEntry[] = [];
      const importConfig = getKugouImportConfig();
      let nextTrackIndex = 0;
      let retrySequence = Promise.resolve();

      const runRetryExclusively = async <T,>(retryTask: () => Promise<T>) => {
        const currentRetryTurn = retrySequence.then(retryTask);
        retrySequence = currentRetryTurn.then(
          () => undefined,
          () => undefined,
        );
        return await currentRetryTurn;
      };

      const processTrack = async (sourceTrack: ParsedKugouPlaylistTrack) => {
        try {
          const result = await runSingleKugouImportTrack({
            sourceTrack,
            playlistId,
            timeoutMs: importConfig.timeoutMs,
            errorRetryCount: importConfig.errorRetryCount,
            unresolvedRetryCount: importConfig.unresolvedRetryCount,
            matchStrictness: importConfig.matchStrictness,
            existingTargetTrackIds,
            seenSourceDuplicateKeys,
            reservedMatchedTrackIds,
            runRetryExclusively,
          });
          finalLogs.push(result);
        } catch (error) {
          console.error("[kugou-import] failed to import track", sourceTrack, error);
          finalLogs.push({
            sourceIndex: sourceTrack.index,
            trackTitle: sourceTrack.title,
            artistLabel:
              sourceTrack.artists.join(" / ") ||
              getKugouImportCopy(copy.locale).previewArtistsFallback,
            status: "failed",
            detail:
              error instanceof Error && error.message
                ? error.message
                : copy.locale === "en-US"
                  ? "Import failed"
                  : "导入失败",
          });
        } finally {
          completed += 1;
          const nextProgress = buildKugouImportProgressSnapshot(finalLogs, kugouImportTracks.length);
          setKugouImportProgress({
            ...nextProgress,
            current: completed,
          });
        }
      };

      const workers = Array.from(
        { length: Math.min(importConfig.concurrency, kugouImportTracks.length) },
        async () => {
          while (nextTrackIndex < kugouImportTracks.length) {
            const currentIndex = nextTrackIndex;
            nextTrackIndex += 1;
            const sourceTrack = kugouImportTracks[currentIndex];
            if (!sourceTrack) {
              return;
            }

            await processTrack(sourceTrack);
          }
        },
      );

      await Promise.all(workers);

      invalidateNeteaseUiCaches({ playlistId });
      finalLogs.sort((left, right) => left.sourceIndex - right.sourceIndex);
      setKugouImportLogs(finalLogs);
      setKugouImportProgress(buildKugouImportProgressSnapshot(finalLogs, kugouImportTracks.length));
      setKugouImportPhase("completed");
      pushDynamicIslandNotification(localeStrings.notifications.kugouImportCompleted);
    } catch (error) {
      console.error("[kugou-import] failed to import kugou playlist", error);
      setKugouImportPhase("completed");
      pushDynamicIslandNotification(localeStrings.notifications.kugouImportFailed);
    } finally {
      setIsImportingKugouPlaylist(false);
    }
  };

  const updateKugouImportLogEntry = (sourceIndex: number, nextEntry: KugouImportLogEntry) => {
    setKugouImportLogs((current) => {
      const nextLogs = current
        .map((currentEntry) =>
          currentEntry.sourceIndex === sourceIndex ? nextEntry : currentEntry,
        )
        .sort((left, right) => left.sourceIndex - right.sourceIndex);
      setKugouImportProgress(buildKugouImportProgressSnapshot(nextLogs, kugouImportTracks.length));
      return nextLogs;
    });
  };

  const openKugouManualRetryDialog = (state: KugouManualRetryState) => {
    if (kugouManualRetryCloseTimerRef.current !== null) {
      window.clearTimeout(kugouManualRetryCloseTimerRef.current);
      kugouManualRetryCloseTimerRef.current = null;
    }

    setIsKugouManualRetryClosing(false);
    setIsSubmittingKugouManualRetry(false);
    setKugouManualRetryState(state);
  };

  const closeKugouManualRetryDialog = () => {
    if (!kugouManualRetryState) {
      return;
    }

    if (kugouManualRetryCloseTimerRef.current !== null) {
      window.clearTimeout(kugouManualRetryCloseTimerRef.current);
    }

    setIsKugouManualRetryClosing(true);
    kugouManualRetryCloseTimerRef.current = window.setTimeout(() => {
      kugouManualRetryCloseTimerRef.current = null;
      setKugouManualRetryState(null);
      setIsKugouManualRetryClosing(false);
      setIsSubmittingKugouManualRetry(false);
    }, KUGOU_MANUAL_RETRY_CLOSE_DURATION_MS);
  };

  const handleSubmitKugouManualRetry = async (
    state: KugouManualRetryState,
    candidate: NeteaseSongSearchResult,
    query: string,
  ) => {
    if (isSubmittingKugouManualRetry) {
      return;
    }

    setIsSubmittingKugouManualRetry(true);

    try {
      const existingTargetTrackIds = await loadKugouImportTargetTrackIds(state.playlistId);
      const kugouImportCopy = getKugouImportCopy(copy.locale);

      if (existingTargetTrackIds.has(candidate.id)) {
        updateKugouImportLogEntry(state.entry.sourceIndex, {
          ...state.entry,
          status: "duplicate",
          detail: kugouImportCopy.duplicateInPlaylist,
        });
        closeKugouManualRetryDialog();
        return;
      }

      await addTracksToNeteasePlaylist(settingsRef.current, state.playlistId, [candidate.id]);
      existingTargetTrackIds.add(candidate.id);
      updateKugouImportLogEntry(state.entry.sourceIndex, {
        sourceIndex: state.entry.sourceIndex,
        trackTitle: state.sourceTrack.title,
        artistLabel:
          state.sourceTrack.artists.join(" / ") || kugouImportCopy.previewArtistsFallback,
        status: "matched",
        detail: `${candidate.name} - ${candidate.artists.join(" / ")} (${query.trim()})`,
      });
      invalidateNeteaseUiCaches({ playlistId: state.playlistId });
      pushDynamicIslandNotification(localeStrings.notifications.contextPlaylistAdded);
      closeKugouManualRetryDialog();
    } catch (error) {
      console.error("[kugou-import] failed to submit manual retry", state, candidate, error);
      updateKugouImportLogEntry(state.entry.sourceIndex, {
        ...state.entry,
        status: "failed",
        detail:
          error instanceof Error && error.message
            ? error.message
            : copy.locale === "en-US"
              ? "Import failed"
              : "导入失败",
      });
      pushDynamicIslandNotification(localeStrings.notifications.contextPlaylistAddFailed);
    } finally {
      setIsSubmittingKugouManualRetry(false);
    }
  };

  const handleRetrySingleKugouImportTrack = async (entry: KugouImportLogEntry) => {
    if (isImportingKugouPlaylist) {
      return;
    }

    const playlistId = Number(selectedKugouImportPlaylistId);
    if (!Number.isFinite(playlistId)) {
      return;
    }

    const sourceTrack = kugouImportTracks.find((track) => track.index === entry.sourceIndex);
    if (!sourceTrack) {
      return;
    }

    const { account, playlists } = await ensureOwnedPlaylistsForToolImport();
    if (!account) {
      pushDynamicIslandNotification(localeStrings.notifications.contextLoginRequired);
      return;
    }

    if (!playlists.some((playlist) => playlist.id === playlistId)) {
      pushDynamicIslandNotification(localeStrings.notifications.contextPlaylistUnavailable);
      return;
    }

    if (entry.status === "skipped") {
      openKugouManualRetryDialog({
        entry,
        sourceTrack,
        playlistId,
      });
      return;
    }

    const importConfig = getKugouImportConfig();
    let retrySequence = Promise.resolve();

    const runRetryExclusively = async <T,>(retryTask: () => Promise<T>) => {
      const currentRetryTurn = retrySequence.then(retryTask);
      retrySequence = currentRetryTurn.then(
        () => undefined,
        () => undefined,
      );
      return await currentRetryTurn;
    };

    setRetryingKugouImportTrackIndex(entry.sourceIndex);

    try {
      const existingTargetTrackIds = await loadKugouImportTargetTrackIds(playlistId);
      const result = await runSingleKugouImportTrack({
        sourceTrack,
        playlistId,
        timeoutMs: importConfig.timeoutMs,
        errorRetryCount: importConfig.errorRetryCount,
        unresolvedRetryCount: importConfig.unresolvedRetryCount,
        matchStrictness: importConfig.matchStrictness,
        existingTargetTrackIds,
        seenSourceDuplicateKeys: new Set<string>(),
        reservedMatchedTrackIds: new Set<number>(),
        runRetryExclusively,
        allowDuplicateRetry: entry.status === "duplicate",
      });

      updateKugouImportLogEntry(entry.sourceIndex, result);

      if (result.status === "matched") {
        invalidateNeteaseUiCaches({ playlistId });
      }
    } catch (error) {
      console.error("[kugou-import] failed to retry track", entry, error);
      const failedResult: KugouImportLogEntry = {
        ...entry,
        status: "failed",
        detail:
          error instanceof Error && error.message
            ? error.message
            : copy.locale === "en-US"
              ? "Import failed"
              : "导入失败",
      };
      updateKugouImportLogEntry(entry.sourceIndex, failedResult);
    } finally {
      setRetryingKugouImportTrackIndex(null);
    }
  };

  const getNeteaseTrackIdFromContextSong = (payload: SongContextTarget) =>
    payload.kind === "netease"
      ? payload.song.id
      : parseNeteaseTrackIdFromCacheKey(payload.track.playback.cacheKey);

  const ensureTrackRecordForContextSong = (payload: SongContextTarget) => {
    if (payload.kind === "track") {
      return payload.track;
    }

    const trackId = buildNeteaseTrackCacheKey(payload.song.id);
    const existingTrack = findTrackById(trackId);
    if (existingTrack) {
      return existingTrack;
    }

    const transientTrack = createTransientNeteaseTrack(payload.song);
    upsertTransientRemoteEntries([
      {
        track: transientTrack,
        artworkUrl: payload.song.artworkUrl ?? null,
      },
    ]);
    return transientTrack;
  };

  const queueContextSong = (payload: SongContextTarget, mode: "append" | "next") => {
    const track = ensureTrackRecordForContextSong(payload);
    const sourceQueueIds =
      currentQueueIdsRef.current.length > 0
        ? currentQueueIdsRef.current
        : playbackQueueIds.length > 0
          ? playbackQueueIds
          : currentTrackIdRef.current
            ? [currentTrackIdRef.current]
            : [];
    const nextQueueIds = sourceQueueIds.filter((trackId) => trackId !== track.id);

    if (mode === "next") {
      const currentIndex = currentTrackIdRef.current
        ? nextQueueIds.indexOf(currentTrackIdRef.current)
        : -1;
      const insertionIndex = currentIndex === -1 ? nextQueueIds.length : currentIndex + 1;
      nextQueueIds.splice(insertionIndex, 0, track.id);
    } else {
      nextQueueIds.push(track.id);
    }

    replacePlaybackQueue(nextQueueIds.length > 0 ? nextQueueIds : [track.id]);
    pushDynamicIslandNotification(
      mode === "next"
        ? localeStrings.notifications.contextSongPlayNext
        : localeStrings.notifications.contextSongQueued,
    );
    closeContextMenu();
  };

  const withContextMenuAction = async (actionId: string, task: () => Promise<void>) => {
    setContextMenuBusyActionId(actionId);

    try {
      await task();
      closeContextMenu();
    } finally {
      setContextMenuBusyActionId((current) => (current === actionId ? null : current));
    }
  };

  const handleLikeSongFromContext = async (payload: SongContextTarget) => {
    const neteaseTrackId = getNeteaseTrackIdFromContextSong(payload);
    if (!neteaseTrackId) {
      pushDynamicIslandNotification(localeStrings.notifications.contextSongLikeFailed);
      return;
    }

    const account = await ensureNeteaseAccount();
    if (!account) {
      pushDynamicIslandNotification(localeStrings.notifications.contextLoginRequired);
      return;
    }

    await withContextMenuAction("song-like", async () => {
      await likeNeteaseSong(settingsRef.current, neteaseTrackId, true);
      invalidateNeteaseUiCaches();
      pushDynamicIslandNotification(localeStrings.notifications.contextSongLiked);
    }).catch((error) => {
      console.error("[context-menu] failed to like song", error);
      pushDynamicIslandNotification(localeStrings.notifications.contextSongLikeFailed);
    });
  };

  const handleAddSongToPlaylistFromContext = async (
    payload: SongContextTarget,
    playlistId: number,
  ) => {
    const neteaseTrackId = getNeteaseTrackIdFromContextSong(payload);
    if (!neteaseTrackId) {
      pushDynamicIslandNotification(localeStrings.notifications.contextPlaylistAddFailed);
      return;
    }

    const { account, playlists } = await ensureOwnedPlaylistsForContextMenu();
    if (!account) {
      pushDynamicIslandNotification(localeStrings.notifications.contextLoginRequired);
      return;
    }

    if (!playlists.some((playlist) => playlist.id === playlistId)) {
      pushDynamicIslandNotification(localeStrings.notifications.contextPlaylistUnavailable);
      return;
    }

    await withContextMenuAction(`song-add-playlist:${playlistId}`, async () => {
      await addTracksToNeteasePlaylist(settingsRef.current, playlistId, [neteaseTrackId]);
      invalidateNeteaseUiCaches({ playlistId });
      if (activeNav === "playlist" && selectedPlaylist?.id === playlistId) {
        setSelectedPlaylist((current) =>
          current ? { ...current } : current,
        );
      }
      pushDynamicIslandNotification(localeStrings.notifications.contextPlaylistAdded);
    }).catch((error) => {
      console.error("[context-menu] failed to add song to playlist", error);
      pushDynamicIslandNotification(localeStrings.notifications.contextPlaylistAddFailed);
    });
  };

  const handleRemoveSongFromCurrentPlaylistFromContext = async (
    payload: SongContextTarget,
    playlistId: number,
  ) => {
    const neteaseTrackId = getNeteaseTrackIdFromContextSong(payload);
    if (!neteaseTrackId) {
      pushDynamicIslandNotification(localeStrings.notifications.contextPlaylistTrackRemoveFailed);
      return;
    }

    const { account, playlists } = await ensureOwnedPlaylistsForContextMenu();
    if (!account) {
      pushDynamicIslandNotification(localeStrings.notifications.contextLoginRequired);
      return;
    }

    if (!playlists.some((playlist) => playlist.id === playlistId)) {
      pushDynamicIslandNotification(localeStrings.notifications.contextPlaylistUnavailable);
      return;
    }

    await withContextMenuAction(`song-remove-playlist:${playlistId}:${neteaseTrackId}`, async () => {
      await removeTracksFromNeteasePlaylist(settingsRef.current, playlistId, [neteaseTrackId]);
      invalidateNeteaseUiCaches({ playlistId });
      if (activeNav === "playlist" && selectedPlaylist?.id === playlistId) {
        setSelectedPlaylist((current) => (current ? { ...current } : current));
      }
      pushDynamicIslandNotification(localeStrings.notifications.contextPlaylistTrackRemoved);
    }).catch((error) => {
      console.error("[context-menu] failed to remove song from playlist", error);
      pushDynamicIslandNotification(localeStrings.notifications.contextPlaylistTrackRemoveFailed);
    });
  };

  const handleTogglePlaylistSubscriptionFromContext = async (
    playlist: NeteasePlaylistRecommendation,
  ) => {
    const account = await ensureNeteaseAccount();
    if (!account) {
      pushDynamicIslandNotification(localeStrings.notifications.contextLoginRequired);
      return;
    }

    await withContextMenuAction(`playlist-subscribe:${playlist.id}`, async () => {
      const shouldSubscribe = !playlist.subscribed;
      await subscribeNeteasePlaylist(settingsRef.current, playlist.id, shouldSubscribe);
      invalidateNeteaseUiCaches({ playlistId: playlist.id });
      if (activeNav === "playlist" && selectedPlaylist?.id === playlist.id) {
        setSelectedPlaylist({ id: playlist.id, title: playlist.name });
      }
      pushDynamicIslandNotification(
        shouldSubscribe
          ? localeStrings.notifications.contextPlaylistSubscribed
          : localeStrings.notifications.contextPlaylistUnsubscribed,
      );
    }).catch((error) => {
      console.error("[context-menu] failed to subscribe playlist", error);
      pushDynamicIslandNotification(
        playlist.subscribed
          ? localeStrings.notifications.contextPlaylistUnsubscribeFailed
          : localeStrings.notifications.contextPlaylistSubscribeFailed,
      );
    });
  };

  const handleDeletePlaylistFromContext = async (playlist: NeteasePlaylistRecommendation) => {
    const account = await ensureNeteaseAccount();
    if (!account || playlist.creatorUserId !== account.userId) {
      pushDynamicIslandNotification(localeStrings.notifications.contextLoginRequired);
      return;
    }

    const confirmed = window.confirm(
      copy.locale === "en-US"
        ? `Delete playlist "${playlist.name}"?`
        : `确定删除歌单“${playlist.name}”吗？`,
    );
    if (!confirmed) {
      return;
    }

    await withContextMenuAction(`playlist-delete:${playlist.id}`, async () => {
      await deleteNeteasePlaylist(settingsRef.current, playlist.id);
      invalidateNeteaseUiCaches();
      if (selectedPlaylist?.id === playlist.id) {
        setSelectedPlaylist(null);
      }
      pushDynamicIslandNotification(localeStrings.notifications.contextPlaylistDeleted);
    }).catch((error) => {
      console.error("[context-menu] failed to delete playlist", error);
      pushDynamicIslandNotification(localeStrings.notifications.contextPlaylistDeleteFailed);
    });
  };

  const handleSubmitPlaylistEditor = async (payload: {
    mode: "create" | "edit";
    playlist: NeteasePlaylistRecommendation | null;
    name: string;
    description: string;
  }) => {
    const account = await ensureNeteaseAccount();
    if (!account) {
      pushDynamicIslandNotification(localeStrings.notifications.contextLoginRequired);
      return;
    }

    const normalizedName = payload.name.trim();
    const normalizedDescription = payload.description.trim();
    if (!normalizedName) {
      pushDynamicIslandNotification(playlistEditorCopy.nameRequired);
      return;
    }

    setIsSubmittingPlaylistEditor(true);

    try {
      if (payload.mode === "create") {
        let playlistId = await createNeteasePlaylist(settingsRef.current, normalizedName);

        if (playlistId === null) {
          const nextUserPlaylists = await getNeteaseUserPlaylists(settingsRef.current, account.userId, 50);
          const matchedPlaylist =
            nextUserPlaylists.find((playlist) => playlist.name.trim() === normalizedName) ?? null;
          playlistId = matchedPlaylist?.id ?? null;
        }

        if (playlistId !== null && normalizedDescription.length > 0) {
          await updateNeteasePlaylistDescription(
            settingsRef.current,
            playlistId,
            normalizedDescription,
          );
        }

        invalidateNeteaseUiCaches(playlistId ? { playlistId } : undefined);
        if (playlistId !== null) {
          setSelectedPlaylist({
            id: playlistId,
            title: normalizedName,
          });
          setActiveNav("playlist");
        }

        pushDynamicIslandNotification(playlistEditorCopy.createSuccess);
      } else if (payload.playlist) {
        if (payload.playlist.creatorUserId !== account.userId) {
          pushDynamicIslandNotification(localeStrings.notifications.contextLoginRequired);
          return;
        }

        const hasNameChanged = normalizedName !== payload.playlist.name.trim();
        const hasDescriptionChanged =
          normalizedDescription !== (payload.playlist.description?.trim() ?? "");

        if (hasNameChanged) {
          await updateNeteasePlaylistName(settingsRef.current, payload.playlist.id, normalizedName);
        }

        if (hasDescriptionChanged) {
          await updateNeteasePlaylistDescription(
            settingsRef.current,
            payload.playlist.id,
            normalizedDescription,
          );
        }

        invalidateNeteaseUiCaches({ playlistId: payload.playlist.id });
        if (selectedPlaylist?.id === payload.playlist.id) {
          setSelectedPlaylist({
            id: payload.playlist.id,
            title: normalizedName,
          });
        }

        pushDynamicIslandNotification(playlistEditorCopy.updateSuccess);
      }

      setPlaylistEditorState(null);
    } catch (error) {
      console.error("[playlist-editor] failed to submit playlist", error);
      pushDynamicIslandNotification(
        payload.mode === "create"
          ? playlistEditorCopy.createFailed
          : playlistEditorCopy.updateFailed,
      );
    } finally {
      setIsSubmittingPlaylistEditor(false);
    }
  };

  const handleEditPlaylistFromContext = async (playlist: NeteasePlaylistRecommendation) => {
    const account = await ensureNeteaseAccount();
    if (!account || playlist.creatorUserId !== account.userId) {
      pushDynamicIslandNotification(localeStrings.notifications.contextLoginRequired);
      return;
    }
    openEditPlaylistEditor(playlist);
    closeContextMenu();
    return;
    /*

    const nextName = window.prompt(
      copy.locale === "en-US" ? "Playlist name" : "歌单名称",
      playlist.name,
    );
    if (nextName === null) {
      return;
    }

    const normalizedName = nextName.trim();
    if (!normalizedName) {
      pushDynamicIslandNotification(localeStrings.notifications.contextPlaylistUpdateFailed);
      return;
    }

    const nextDescription = window.prompt(
      copy.locale === "en-US" ? "Playlist description" : "歌单描述",
      playlist.description ?? "",
    );
    if (nextDescription === null) {
      return;
    }

    await withContextMenuAction(`playlist-edit:${playlist.id}`, async () => {
      if (normalizedName !== playlist.name.trim()) {
        await updateNeteasePlaylistName(settingsRef.current, playlist.id, normalizedName);
      }

      if ((nextDescription.trim() || "") !== (playlist.description?.trim() || "")) {
        await updateNeteasePlaylistDescription(
          settingsRef.current,
          playlist.id,
          nextDescription,
        );
      }

      invalidateNeteaseUiCaches({ playlistId: playlist.id });
      if (selectedPlaylist?.id === playlist.id) {
        setSelectedPlaylist({ id: playlist.id, title: normalizedName });
      }
      pushDynamicIslandNotification(localeStrings.notifications.contextPlaylistUpdated);
    }).catch((error) => {
      console.error("[context-menu] failed to edit playlist", error);
      pushDynamicIslandNotification(localeStrings.notifications.contextPlaylistUpdateFailed);
    });
    */
  };

  const runMediaImport = async (paths: string[], successMessage?: string | null) => {
    if (paths.length === 0) {
      return;
    }

    setIsImportingLibrary(true);

    try {
      const snapshot = await importMediaFiles({ paths });
      setMediaLibrary(snapshot);
      if (successMessage) {
        pushDynamicIslandNotification(successMessage);
      }
    } catch (error) {
      console.error("[media] failed to import media", error);
      pushDynamicIslandNotification(localeStrings.notifications.importFailed);
    } finally {
      setIsImportingLibrary(false);
    }
  };

  const handleImportAudioFiles = async () => {
    const selection = await open({
      multiple: true,
      directory: false,
      filters: [
        {
          name: "Audio",
          extensions: ["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "wma", "aiff", "alac"],
        },
      ],
    });

    const paths = Array.isArray(selection)
      ? selection.filter((value): value is string => typeof value === "string")
      : typeof selection === "string"
        ? [selection]
        : [];

    await runMediaImport(paths, localeStrings.notifications.audioImportCompleted);
  };

  const handleImportAudioDirectory = async () => {
    const selection = await open({
      multiple: false,
      directory: true,
    });

    if (typeof selection !== "string") {
      return;
    }

    await runMediaImport([selection], localeStrings.notifications.folderImportCompleted);
  };

  const handlePickScanDirectory = async () => {
    const selection = await open({
      multiple: false,
      directory: true,
    });

    if (typeof selection !== "string") {
      return;
    }

    const nextSettings: AppSettings = {
      ...settings,
      library: {
        ...settings.library,
        scanDirectories: Array.from(new Set([...settings.library.scanDirectories, selection])),
      },
    };

    setSettings(nextSettings);
    setIsSettingsSaving(true);

    try {
      const snapshot = await saveAppSettings(nextSettings);
      applySavedSettingsSnapshot(nextSettings, snapshot);
      if (snapshot.settings.library.watchDirectories) {
        await runMediaImport([selection], null);
      }
      pushDynamicIslandNotification(localeStrings.notifications.scanDirectoriesSaved);
    } catch (error) {
      console.error("[settings] failed to save scan directory", error);
      pushDynamicIslandNotification(localeStrings.notifications.scanDirectoriesSaveFailed);
    } finally {
      setIsSettingsSaving(false);
    }
  };

  const handlePickBackgroundImage = async () => {
    const selection = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: "Media",
          extensions: [...BACKGROUND_IMAGE_EXTENSIONS, ...BACKGROUND_VIDEO_EXTENSIONS],
        },
      ],
    });

    if (typeof selection !== "string") {
      return;
    }

    updateSettings((current) => ({
      ...current,
      appearance: {
        ...current.appearance,
        backgroundMode: "custom",
        backgroundImagePath: selection,
      },
    }));
  };

  const handleClearBackgroundImage = () => {
    updateSettings((current) => ({
      ...current,
      appearance: {
        ...current.appearance,
        backgroundImagePath: "",
      },
    }));
  };

  const clearPlaybackState = (options?: { clearQueue?: boolean }) => {
    const shouldClearQueue = options?.clearQueue ?? true;
    syncTimelineOwnerMode("active");
    clearPlaybackLoadTimeout();
    cancelSongTransition();
    cancelPauseFade();
    activeAudioSlotRef.current = "primary";
    syncActiveAudioReference("primary");
    resetAudioElement(primaryAudioRef.current);
    resetAudioElement(secondaryAudioRef.current);

    pendingAutoplayRef.current = false;
    setPendingPlaybackStartIntent(null);
    setPlaybackRestoreSession(null);
    playbackCandidatesRef.current = [];
    playbackCandidateIndexRef.current = 0;
    songTransitionArmedTrackIdRef.current = null;
    currentTrackRef.current = null;
    setCurrentTrackId(null);
    setIsPlaying(false);
    setIsPlaybackLoading(false);
    setCurrentTimeSeconds(0);
    setVisualCurrentTimeSeconds(0);
    setDurationSeconds(0);
    syncPlaybarDisplayState({
      trackId: null,
      currentTimeSeconds: 0,
      visualTimeSeconds: 0,
      durationSeconds: 0,
    });
    syncPlaybarArtworkOverrideUrl(null);
    setCurrentTrackLyrics(null);

    if (shouldClearQueue) {
      setPlaybackQueueIds([]);
      setShuffledQueueIds([]);
      setPlaybackQueueSourcePlaylist(null);
      setIsQueuePopoverOpen(false);
    }
  };

  const handleVolumeChange = (nextVolume: number) => {
    setVolume(nextVolume);

    if (isSettingsLoading) {
      return;
    }

    const nextSettings: AppSettings = {
      ...settings,
      playback: {
        ...settings.playback,
        defaultVolume: nextVolume,
      },
    };

    setSettings(nextSettings);
    settingsRef.current = nextSettings;

    if (volumeSaveTimerRef.current) {
      window.clearTimeout(volumeSaveTimerRef.current);
    }

    volumeSaveTimerRef.current = window.setTimeout(() => {
      volumeSaveTimerRef.current = null;
      const requestedSettings = settingsRef.current;
      void saveAppSettings(settingsRef.current)
        .then((snapshot) => {
          applySavedSettingsSnapshot(requestedSettings, snapshot);
        })
        .catch((error) => {
          console.error("[settings] failed to save volume", error);
          pushDynamicIslandNotification(localeStrings.notifications.volumeSaveFailed);
        });
    }, 220);
  };

  const handleAdjustVolumeBy = (delta: number) => {
    handleVolumeChange(Math.min(100, Math.max(0, volume + delta)));
  };

  const handleSeekBySeconds = (deltaSeconds: number) => {
    const audio = getActiveAudioElement();
    const nextDuration = Number.isFinite(audio?.duration) ? (audio?.duration ?? 0) : effectiveDurationSeconds;

    if (!audio || nextDuration <= 0) {
      return;
    }

    const nextTime = Math.min(nextDuration, Math.max(0, (audio.currentTime || 0) + deltaSeconds));
    audio.currentTime = nextTime;
    setCurrentTimeSeconds(nextTime);
    setVisualCurrentTimeSeconds(nextTime);
  };

  const handleStopPlayback = () => {
    clearPlaybackState();
  };

  const handlePlayNeteaseTrackSelection = async (
    trackId: number,
    queueSongs: NeteaseSongDetail[],
    options?: {
      sourcePlaylist?: PlaylistSelection;
      queueKind?: PlaybackQueueKind;
    },
  ) => {
    if (!isNeteaseSourceEnabled(settingsRef.current)) {
      pushDynamicIslandNotification(localeStrings.notifications.neteaseSourceDisabled);
      return;
    }

    cancelPendingPlaybackRestore();
    const requestId = beginPlaybackRequest();

    try {
      if (options?.queueKind !== "personal-fm" && options?.queueKind !== "intelligence") {
        disableLockedQueuePlaybackMode();
      }

      pauseActiveTrackForTransition();
      setIsPlaybackLoading(true);

      const normalizedQueue = dedupeNeteaseSongDetailsById(queueSongs);
      const targetSeedDetail = normalizedQueue.find((song) => song.id === trackId) ?? null;
      if (targetSeedDetail) {
        const previewTrack = createTransientNeteaseTrack(targetSeedDetail);
        upsertTransientRemoteEntries([
          {
            track: previewTrack,
            artworkUrl: targetSeedDetail.artworkUrl ?? null,
          },
        ]);
        previewPlaybarTrackLoading(previewTrack);
        syncPlaybarArtworkOverrideUrl(targetSeedDetail.artworkUrl ?? null);
      }
      const targetResolution = await resolveNeteaseTrack(
        settingsRef.current,
        trackId,
        targetSeedDetail ? { detail: targetSeedDetail } : undefined,
      );

      if (!isPlaybackRequestCurrent(requestId)) {
        return;
      }

      syncPlaybarArtworkOverrideUrl(targetResolution.detail.artworkUrl ?? null);
      const normalizedPlaybackQueue =
        normalizedQueue.length > 0
          ? normalizedQueue
          : [targetSeedDetail ?? targetResolution.detail].filter(
              (song): song is NeteaseSongDetail => song !== null,
            );
      const transientQueue = normalizedPlaybackQueue.map((song) => ({
        track: createTransientNeteaseTrack(
          song.id === targetResolution.detail.id ? targetResolution.detail : song,
          song.id === targetResolution.detail.id ? targetResolution : undefined,
        ),
        artworkUrl:
          (song.id === targetResolution.detail.id ? targetResolution.detail : song).artworkUrl ??
          null,
      }));
      upsertTransientRemoteEntries(transientQueue);

      const targetTrackId = buildNeteaseTrackCacheKey(targetResolution.detail.id);
      commitPlaybackSelection(
        targetTrackId,
        transientQueue.map((entry) => entry.track.id),
        {
          autoplay: true,
        },
      );
      setPlaybackQueueSourcePlaylist(options?.sourcePlaylist ?? null);
      if (options?.queueKind === "personal-fm") {
        personalFmQueueSongsRef.current = normalizedPlaybackQueue;
        enableLockedQueuePlaybackMode("personal-fm");
      } else if (options?.queueKind === "intelligence") {
        enableLockedQueuePlaybackMode("intelligence");
      }

      void registerResolvedNeteaseTrackToLibrary(targetResolution)
        .then(() => refreshMediaLibrarySnapshot())
        .catch((error) => {
          console.error("[home] failed to persist current netease track", error);
        });

      if (targetResolution.notice) {
        pushDynamicIslandNotification(targetResolution.notice);
      }
    } catch (error) {
      if (!isPlaybackRequestCurrent(requestId)) {
        return;
      }

      console.error("[home] failed to play netease recommendation", error);
      setIsPlaybackLoading(false);
      pushDynamicIslandNotification(localeStrings.notifications.playbackFailed);
    }
  };

  const bufferPersonalFmQueue = async (limit = 4) => {
    if (
      isPersonalFmBufferingRef.current ||
      !isNeteaseSourceEnabled(settingsRef.current) ||
      settingsRef.current.network.neteaseCookie.trim().length === 0
    ) {
      return false;
    }

    isPersonalFmBufferingRef.current = true;

    try {
      const fmSongs = dedupeNeteaseSongDetailsById(
        await getNeteasePersonalFmSongs(settingsRef.current, limit),
      );
      if (fmSongs.length === 0) {
        return false;
      }

      const existingTrackIds = new Set(
        playbackQueueIdsRef.current
          .map((queueId) => parseNeteaseTrackIdFromCacheKey(queueId))
          .filter((trackId): trackId is number => trackId !== null),
      );
      const nextSongs = fmSongs.filter((song) => !existingTrackIds.has(song.id));
      if (nextSongs.length === 0) {
        return false;
      }

      upsertTransientRemoteEntries(
        nextSongs.map((song) => ({
          track: createTransientNeteaseTrack(song),
          artworkUrl: song.artworkUrl ?? null,
        })),
      );
      appendTrackIdsToPlaybackQueue(nextSongs.map((song) => buildNeteaseTrackCacheKey(song.id)));
      personalFmQueueSongsRef.current = dedupeNeteaseSongDetailsById([
        ...personalFmQueueSongsRef.current,
        ...nextSongs,
      ]);
      return true;
    } catch (error) {
      console.error("[player] failed to buffer personal fm queue", error);
      return false;
    } finally {
      isPersonalFmBufferingRef.current = false;
    }
  };

  const handleStartNeteaseIntelligenceMode = async (
    sourcePlaylist: PlaylistSelection,
    seedSong: NeteaseSongDetail,
    queueSongs: NeteaseSongDetail[],
  ) => {
    if (!sourcePlaylist) {
      pushDynamicIslandNotification(localeStrings.notifications.intelligenceModeFailed);
      return;
    }

    if (!isNeteaseSourceEnabled(settingsRef.current)) {
      pushDynamicIslandNotification(localeStrings.notifications.neteaseSourceDisabled);
      return;
    }

    try {
      const intelligenceSongs = dedupeNeteaseSongDetailsById(
        await getNeteaseIntelligenceSongs(
          settingsRef.current,
          sourcePlaylist.id,
          seedSong.id,
          seedSong.id,
        ),
      );

      const fallbackQueue = dedupeNeteaseSongDetailsById([
        seedSong,
        ...queueSongs.filter((song) => song.id !== seedSong.id),
      ]);
      const playbackQueue =
        intelligenceSongs.length > 0
          ? dedupeNeteaseSongDetailsById([
              seedSong,
              ...intelligenceSongs.filter((song) => song.id !== seedSong.id),
            ])
          : fallbackQueue;

      await handlePlayNeteaseTrackSelection(seedSong.id, playbackQueue, {
        sourcePlaylist,
        queueKind: "intelligence",
      });
      pushDynamicIslandNotification(localeStrings.notifications.intelligenceModeStarted);
    } catch (error) {
      console.error("[player] failed to start intelligence mode", error);
      pushDynamicIslandNotification(localeStrings.notifications.intelligenceModeFailed);
    }
  };

  const playTrackSelection = (trackId: string, queueTracks: TrackRecord[]) => {
    cancelPendingPlaybackRestore();
    disableLockedQueuePlaybackMode();
    setPlaybackQueueSourcePlaylist(null);
    pauseActiveTrackForTransition();
    void requestPreparedPlayback(trackId, buildQueueIds(queueTracks), {
        autoplay: true,
        announceNotice: false,
      });
  };

  const resolveAdjacentPlaybackTarget = (
    direction: -1 | 1,
    options?: {
      fromEnded?: boolean;
      allowRepeatOneRestart?: boolean;
    },
  ) => {
    const fromEnded = options?.fromEnded ?? false;
    const allowRepeatOneRestart = options?.allowRepeatOneRestart ?? true;
    const activePlaybackMode = playbackModeRef.current;
    const activeTrackId = currentTrackIdRef.current;
    const queueIds =
      currentQueueIdsRef.current.length > 0 ? currentQueueIdsRef.current : libraryTrackIdsRef.current;

    if (queueIds.length === 0) {
      return null;
    }

    if (fromEnded && allowRepeatOneRestart && activePlaybackMode === "repeat-one" && activeTrackId) {
      return {
        action: "restart-current" as const,
        trackId: activeTrackId,
        queueIds,
      };
    }

    const fallbackIndex = activeTrackId ? queueIds.indexOf(activeTrackId) : -1;
    const baseIndex = fallbackIndex === -1 ? (direction > 0 ? -1 : 1) : fallbackIndex;
    let nextIndex = baseIndex + direction;
    let reshuffledIds: string[] | undefined;

    if (nextIndex < 0 || nextIndex >= queueIds.length) {
      if (activePlaybackMode === "repeat-all") {
        nextIndex = nextIndex < 0 ? queueIds.length - 1 : 0;
      } else if (activePlaybackMode === "shuffle" && direction > 0) {
        reshuffledIds = buildShuffledQueue(queueIds, activeTrackId);
        nextIndex = Math.min(reshuffledIds.length - 1, 1);
        return {
          action: "play-track" as const,
          trackId: reshuffledIds[nextIndex] ?? reshuffledIds[0] ?? null,
          queueIds,
          reshuffledIds,
        };
      } else {
        return {
          action: "stop" as const,
          trackId: null,
          queueIds,
        };
      }
    }

    return {
      action: "play-track" as const,
      trackId: queueIds[nextIndex] ?? null,
      queueIds,
      reshuffledIds,
    };
  };

  const startSongTransition = async (
    target: NonNullable<ReturnType<typeof resolveAdjacentPlaybackTarget>>,
  ) => {
    if (
      target.action !== "play-track" ||
      !target.trackId ||
      isSongTransitionRunningRef.current ||
      !currentTrackRef.current
    ) {
      return false;
    }

    const fromTrack = currentTrackRef.current;
    const sourceTrackId = fromTrack.id;
    const fromAudio = getActiveAudioElement();

    if (!fromAudio) {
      return false;
    }

    const requestId = beginPlaybackRequest();
    isSongTransitionRunningRef.current = true;
    songTransitionSourceTrackIdRef.current = sourceTrackId;
    setIsPlaybackLoading(true);

    try {
      const preparedTransition =
        (await ensureSongTransitionPrepared(target, sourceTrackId)) ??
        null;

      if (
        !preparedTransition ||
        !isPlaybackRequestCurrent(requestId) ||
        currentTrackIdRef.current !== sourceTrackId
      ) {
        cancelSongTransition();
        return false;
      }

      cancelPauseFade();
      const preparedTrack = preparedTransition.preparedTrack;
      const preparedAudio = getAudioElementBySlot(preparedTransition.slot);
      if (!preparedAudio) {
        throw new Error("Prepared transition audio element is missing.");
      }
      setProcessedAudioGain(preparedAudio, 0);

      playbackCandidatesRef.current = preparedTransition.nextCandidates;
      playbackCandidateIndexRef.current = preparedTransition.candidateIndex;
      pendingAutoplayRef.current = false;
      setPendingPlaybackStartIntent(null);

      if (target.reshuffledIds) {
        setShuffledQueueIds(target.reshuffledIds);
      }

      setPlaybackQueueIds(target.queueIds.filter(Boolean));

      songTransitionFromAudioRef.current = fromAudio;
      songTransitionToAudioRef.current = preparedAudio;
      activeAudioSlotRef.current = preparedTransition.slot;
      syncActiveAudioReference(preparedTransition.slot);
      syncTimelineOwnerMode("playbar");
      syncPlaybarProgressFromAudio(fromAudio, {
        trackId: sourceTrackId,
        fallbackDurationSeconds:
          Number.isFinite(fromAudio.duration) && fromAudio.duration > 0
            ? fromAudio.duration
            : (fromTrack.durationMs ?? 0) / 1000,
      });

      songTransitionPreparedRef.current = null;
      await preparedAudio.play();

      const fadeSequence = songTransitionSequenceRef.current + 1;
      songTransitionSequenceRef.current = fadeSequence;
      const startedAt = performance.now();
      const transitionDecision = getTransitionDecision(
        sourceTrackId,
        Number.isFinite(fromAudio.duration) ? fromAudio.duration : effectiveDurationSeconds,
      );
      const fallbackTransitionDurationMs = Math.max(
        SONG_TRANSITION_MIN_MS,
        Math.min(SONG_TRANSITION_MAX_MS, settingsRef.current.playback.songTransitionStartMs || 4000),
      );
      const currentAnalysis = trackAnalysisByTrackIdRef.current[sourceTrackId];
      const nextAnalysis = trackAnalysisByTrackIdRef.current[preparedTrack.id];
      const transitionTimingPlan =
        transitionDecision.transitionTimingPlan ??
        (settingsRef.current.playback.songTransitionMode === "auto-mix"
          ? resolveAutoMixTransitionTimingPlan(
              currentAnalysis,
              nextAnalysis,
              fallbackTransitionDurationMs,
            )
          : {
              durationMs: fallbackTransitionDurationMs,
              reason: "simple-mix-fixed-duration",
              currentOutroWindowMs: null,
              nextIntroWindowMs: null,
              targetOverlapMs: fallbackTransitionDurationMs,
            });
      const transitionDurationMs = transitionTimingPlan.durationMs;
      const nextEntryPointMs =
        settingsRef.current.playback.songTransitionMode === "auto-mix"
          ? resolveAutoMixEntryPointMs(nextAnalysis, transitionDurationMs)
          : 0;
      const usingWebAudioForOutgoing = canUseWebAudioProcessingForElement(fromAudio);
      const usingWebAudioForIncoming = canUseWebAudioProcessingForElement(preparedAudio);
      const tempoPlan =
        settingsRef.current.playback.songTransitionMode === "auto-mix"
          ? resolveAutoMixTempoPlan(currentAnalysis, nextAnalysis)
          : {
              enabled: false,
              fromStartRate: 1,
              fromEndRate: 1,
              toStartRate: 1,
              toEndRate: 1,
              fromTargetRate: 1,
              toTargetRate: 1,
              fromTempoBpm: null,
              toTempoBpm: null,
              targetTempoBpm: null,
              preservePitchDisabled: false,
              reason: "simple-mix",
            };

      if (nextEntryPointMs > 0) {
        const preparedDurationMs = Number.isFinite(preparedAudio.duration)
          ? preparedAudio.duration * 1000
          : (preparedTrack.durationMs ?? 0);
        const boundedEntryPointSeconds = Math.max(
          0,
          Math.min(
            Math.max(0, (preparedDurationMs / 1000) - 0.5),
            nextEntryPointMs / 1000,
          ),
        );

        try {
          preparedAudio.currentTime = boundedEntryPointSeconds;
        } catch (error) {
          console.warn("[automix] failed to seek prepared track to entry point", {
            trackId: preparedTrack.id,
            nextEntryPointMs,
            error,
          });
        }
      }

      if (tempoPlan.preservePitchDisabled) {
        setAudioPreservesPitch(fromAudio, false);
        setAudioPreservesPitch(preparedAudio, false);
      } else {
        setAudioPreservesPitch(fromAudio, true);
        setAudioPreservesPitch(preparedAudio, true);
      }

      fromAudio.playbackRate = tempoPlan.fromStartRate;
      preparedAudio.playbackRate = tempoPlan.toStartRate;

      console.log("[automix]", {
        phase: "tempo-match",
        currentTrackId: sourceTrackId,
        nextTrackId: preparedTrack.id,
        mode: settingsRef.current.playback.songTransitionMode,
        transitionDurationMs,
        transitionTimingPlan,
        resolvedTransitionStartMs: transitionDecision.resolvedTransitionStartMs,
        suggestedTransitionStartMs: transitionDecision.suggestedTransitionStartMs,
        nextEntryPointMs,
        nextEntryPointSeconds: roundTo(nextEntryPointMs / 1000, 3),
        nextEntryLeadInMs:
          nextAnalysis && nextEntryPointMs > 0 && typeof nextAnalysis.introPhaseEndMs === "number"
            ? Math.max(0, nextEntryPointMs - nextAnalysis.introPhaseEndMs)
            : null,
        mixEngine:
          ENABLE_SHARED_AUDIO_WEB_PROCESSING &&
          usingWebAudioForOutgoing &&
          usingWebAudioForIncoming
            ? "web-audio"
            : "native-volume",
        mixProfile:
          settingsRef.current.playback.songTransitionMode === "auto-mix"
            ? "structure-jump-dual-converge"
            : "symmetric-fade",
        tempoPlan,
        tempoMorphProfile:
          settingsRef.current.playback.songTransitionMode === "auto-mix"
            ? "delayed-smootherstep-chase"
            : "linear",
        analysis: summarizeAutoMixAnalysis(currentAnalysis),
        nextAnalysis: summarizeAutoMixAnalysis(nextAnalysis),
      });
      setIsAutoMixTransitionActive(settingsRef.current.playback.songTransitionMode === "auto-mix");

      const step = (now: number) => {
        if (fadeSequence !== songTransitionSequenceRef.current) {
          return;
        }

        const progress = Math.min(1, (now - startedAt) / transitionDurationMs);
        const shouldFlipCanonicalTrack = progress >= 0.22;
        const shouldFlipPlaybarDisplay = progress >= 0.58;
        if (shouldFlipCanonicalTrack && currentTrackIdRef.current !== preparedTrack.id) {
          currentTrackRef.current = preparedTrack;
          currentTrackIdRef.current = preparedTrack.id;
          setCurrentTrackId(preparedTrack.id);
          syncPlaybackVisualState({
            currentTimeSeconds: preparedAudio.currentTime || 0,
            visualCurrentTimeSeconds: preparedAudio.currentTime || 0,
            durationSeconds: Number.isFinite(preparedAudio.duration)
              ? preparedAudio.duration
              : (preparedTrack.durationMs ?? 0) / 1000,
            isPlaybackLoading: false,
          });
        }
        if (shouldFlipPlaybarDisplay && playbarDisplayTrackIdRef.current !== preparedTrack.id) {
          syncTimelineOwnerMode("playbar");
          syncPlaybarProgressFromAudio(preparedAudio, {
            trackId: preparedTrack.id,
            fallbackDurationSeconds: (preparedTrack.durationMs ?? 0) / 1000,
            animateMeta: true,
          });
        }
        const easedProgress = 0.5 - Math.cos(progress * Math.PI) / 2;
        const baseVolume = clamp01(volumeRef.current / 100);
        const isAutoMixMode = settingsRef.current.playback.songTransitionMode === "auto-mix";
        const entryRamp = isAutoMixMode
          ? clamp01((progress - 0.02) / 0.52)
          : 0;
        const entryPresence = isAutoMixMode
          ? 0.08 + 0.92 * (1 - (1 - entryRamp) ** 1.8)
          : 0;
        const outgoingBlend = isAutoMixMode
          ? clamp01(1 - progress ** 1.18)
          : 1 - easedProgress;
        const incomingBlend = isAutoMixMode
          ? clamp01(0.02 + entryPresence * 0.98)
          : easedProgress;
        const overlapLift = isAutoMixMode ? 1.04 : 1;
        const tempoMorphProgress = isAutoMixMode
          ? clamp01((progress - 0.18) / 0.68)
          : easedProgress;
        const smoothedTempoMorphProgress = isAutoMixMode
          ? tempoMorphProgress ** 3 * (tempoMorphProgress * (tempoMorphProgress * 6 - 15) + 10)
          : easedProgress;
        const targetFromRate =
          tempoPlan.fromStartRate +
          (tempoPlan.fromEndRate - tempoPlan.fromStartRate) *
            smoothedTempoMorphProgress;
        const targetToRate =
          tempoPlan.toStartRate +
          (tempoPlan.toEndRate - tempoPlan.toStartRate) *
            smoothedTempoMorphProgress;
        const tempoChaseAmount = isAutoMixMode
          ? clampNumber((transitionDurationMs / 1000) * 0.06, 0.08, 0.18)
          : 1;
        const fromRate = smoothApproach(
          fromAudio.playbackRate || 1,
          clampPlaybackRate(targetFromRate),
          tempoChaseAmount,
        );
        const toRate = smoothApproach(
          preparedAudio.playbackRate || 1,
          clampPlaybackRate(targetToRate),
          tempoChaseAmount,
        );
        const fromHighpassHz = 20 + easedProgress * 180;
        const fromLowpassHz = 20000 - easedProgress * 5000;
        const toHighpassHz = 180 - easedProgress * 160;
        const toLowpassHz = 12000 + easedProgress * 8000;

        setProcessedAudioGain(
          fromAudio,
          baseVolume * outgoingBlend * (isAutoMixMode ? 0.94 : 1),
        );
        setProcessedAudioGain(
          preparedAudio,
          Math.min(baseVolume, baseVolume * incomingBlend * overlapLift),
        );
        setProcessedFilterShape(fromAudio, {
          highpassHz: fromHighpassHz,
          lowpassHz: fromLowpassHz,
        });
        setProcessedFilterShape(preparedAudio, {
          highpassHz: toHighpassHz,
          lowpassHz: toLowpassHz,
        });
        fromAudio.playbackRate = fromRate;
        preparedAudio.playbackRate = toRate;

        if (progress >= 1) {
          songTransitionAnimationFrameRef.current = null;
          isSongTransitionRunningRef.current = false;
          songTransitionSourceTrackIdRef.current = null;
          syncTimelineOwnerMode("active");
          setIsAutoMixTransitionActive(false);
          songTransitionFromAudioRef.current = null;
          songTransitionToAudioRef.current = null;
          fromAudio.playbackRate = 1;
          setAudioPreservesPitch(fromAudio, true);
          resetProcessedAudioChain(fromAudio);
          resetAudioElement(fromAudio);
          setProcessedAudioGain(preparedAudio, baseVolume);
          resetProcessedAudioChain(preparedAudio);
          animatePlaybackRateToOne(preparedAudio, {
            durationMs: Math.max(680, Math.min(1400, transitionDurationMs * 0.42)),
            onComplete: () => {
              setAudioPreservesPitch(preparedAudio, true);
            },
          });
          return;
        }

        songTransitionAnimationFrameRef.current = window.requestAnimationFrame(step);
      };

      songTransitionAnimationFrameRef.current = window.requestAnimationFrame(step);
      return true;
    } catch (error) {
      console.error("[player] failed to start song transition", error);
      cancelSongTransition();

      if (currentTrackIdRef.current === sourceTrackId) {
        pauseActiveTrackForTransition();
        void requestPreparedPlayback(target.trackId, target.queueIds, {
          autoplay: true,
          announceNotice: false,
        });
      }

      return false;
    }
  };

  const handleSkipToAdjacentTrack = async (
    direction: -1 | 1,
    options?: { fromEnded?: boolean },
  ) => {
    const fromEnded = options?.fromEnded ?? false;
    const target = resolveAdjacentPlaybackTarget(direction, { fromEnded });

    if (!target) {
      return;
    }

    if (target.action === "restart-current" && target.trackId) {
      const audio = getActiveAudioElement();

      if (!audio) {
        return;
      }

      audio.currentTime = 0;
      setCurrentTimeSeconds(0);
      setVisualCurrentTimeSeconds(0);
      void audio.play().catch((error) => {
        console.error("[player] failed to restart current track", error);
        setIsPlaying(false);
      });
      return;
    }

    if (target.action === "stop" || !target.trackId) {
      if (
        direction > 0 &&
        playbackQueueKindRef.current === "personal-fm" &&
        (await bufferPersonalFmQueue(4))
      ) {
        const bufferedTarget = resolveAdjacentPlaybackTarget(direction, {
          fromEnded,
          allowRepeatOneRestart: false,
        });
        if (bufferedTarget?.action === "play-track" && bufferedTarget.trackId) {
          if (bufferedTarget.reshuffledIds) {
            setShuffledQueueIds(bufferedTarget.reshuffledIds);
          }

          pauseActiveTrackForTransition();
          void requestPreparedPlayback(bufferedTarget.trackId, bufferedTarget.queueIds, {
            autoplay: true,
            announceNotice: false,
          });
          return;
        }
      }

      if (playbackQueueKindRef.current === "personal-fm" || playbackQueueKindRef.current === "intelligence") {
        disableLockedQueuePlaybackMode();
      }

      if (fromEnded) {
        setIsPlaying(false);
      }
      return;
    }

    if (target.reshuffledIds) {
      setShuffledQueueIds(target.reshuffledIds);
    }

    pauseActiveTrackForTransition();
    void requestPreparedPlayback(target.trackId, target.queueIds, {
      autoplay: true,
      announceNotice: false,
    });
  };

  const handleTogglePlayback = async () => {
    if (isPlaybackLoadingRef.current) {
      return;
    }

    const audio = getActiveAudioElement();

    if (!audio) {
      return;
    }

    if (!currentTrack) {
      if (libraryTracks.length === 0) {
      pushDynamicIslandNotification(localeStrings.notifications.importTracksFirst);
        return;
      }

      playTrackSelection(libraryTracks[0].id, libraryTracks);
      return;
    }

    if (audio.paused) {
      cancelPauseFade({ restoreVolume: true });
      audio.volume = volumeRef.current / 100;
      void audio.play().catch((error) => {
        console.error("[player] failed to resume playback", error);
        setIsPlaying(false);
        pushDynamicIslandNotification(localeStrings.notifications.playbackFailed);
      });
      return;
    }

    await pauseActiveTrackWithFade();
  };

  const handleSeek = (nextProgress: number) => {
    const audio = getPlaybarDisplayAudioElement();
    const nextDuration = Number.isFinite(audio?.duration) ? (audio?.duration ?? 0) : effectiveDurationSeconds;

    if (!audio || nextDuration <= 0) {
      return;
    }

    const nextTime = (Math.min(100, Math.max(0, nextProgress)) / 100) * nextDuration;
    audio.currentTime = nextTime;
    syncPlaybackVisualState({
      currentTimeSeconds: nextTime,
      visualCurrentTimeSeconds: nextTime,
    });
    syncTimelineOwnerMode("playbar");
    syncPlaybarProgressFromAudio(audio, {
      trackId: playbarDisplayTrackIdRef.current,
      fallbackDurationSeconds: nextDuration,
    });

    if (
      settingsRef.current.playback.songTransitionEnabled &&
      settingsRef.current.playback.songTransitionMode === "auto-mix" &&
      currentTrackIdRef.current
    ) {
      const transitionDecision = getTransitionDecision(
        currentTrackIdRef.current,
        nextDuration,
      );
      const resolvedTransitionStartSeconds =
        transitionDecision.resolvedTransitionStartMs !== null
          ? transitionDecision.resolvedTransitionStartMs / 1000
          : Math.max(0, nextDuration - transitionDecision.transitionStartSeconds);

      if (nextTime >= resolvedTransitionStartSeconds) {
        songTransitionArmedTrackIdRef.current = null;
        clearPreparedSongTransition();
        setIsAutoMixTransitionActive(false);
        console.log("[automix]", {
          phase: "seek-cancelled",
          currentTrackId: currentTrackIdRef.current,
          seekTimeSeconds: roundTo(nextTime, 3),
          transitionStartSeconds: roundTo(resolvedTransitionStartSeconds, 3),
          reason: "seeked-past-transition-entry",
        });
      }
    }
  };

  const handleSeekStart = async () => {
    const audio = getPlaybarDisplayAudioElement();
    isTimelineSeekingRef.current = true;
    syncTimelineOwnerMode("playbar");

    if (!audio) {
      resumeAfterSeekRef.current = false;
      return;
    }

    resumeAfterSeekRef.current = !audio.paused;

    if (resumeAfterSeekRef.current) {
      pauseActiveTrackForTransition(audio);
    }
  };

  const handleSeekEnd = async () => {
    const audio = getPlaybarDisplayAudioElement();
    const shouldResumePlayback = resumeAfterSeekRef.current;

    isTimelineSeekingRef.current = false;
    resumeAfterSeekRef.current = false;
    schedulePlaybackResumePersistence(0);

    if (isSongTransitionRunningRef.current) {
      syncTimelineOwnerMode("playbar");
    } else {
      syncTimelineOwnerMode("active");
    }

    if (!audio || !shouldResumePlayback) {
      return;
    }

    syncBackgroundMvPosition(backgroundVideoRef.current, true);
    void audio.play().catch((error) => {
      console.error("[player] failed to resume after seek", error);
      setIsPlaying(false);
      pushDynamicIslandNotification(localeStrings.notifications.playbackFailed);
    });
  };

  const handleSeekToLyricTimeMs = async (lyricTimeMs: number) => {
    const audio = getActiveAudioElement();
    const nextDuration = Number.isFinite(audio?.duration) ? (audio?.duration ?? 0) : effectiveDurationSeconds;

    if (!audio || nextDuration <= 0) {
      return;
    }

    const targetAudioTimeSeconds = Math.min(
      nextDuration,
      Math.max(
        0,
        (
          lyricTimeMs -
          (currentTrack?.config.lyricsOffsetMs ?? 0) +
          (settings.lyrics.delayMs ?? 0) -
          configuredImmersiveLyricAdvanceMs
        ) / 1000,
      ),
    );
    const nextProgress = (targetAudioTimeSeconds / nextDuration) * 100;

    await handleSeekStart();
    handleSeek(nextProgress);
    await handleSeekEnd();
  };

  useEffect(() => {
    cancelledAutoMixTrackIdRef.current = null;
    songTransitionArmedTrackIdRef.current = null;
    clearPreparedSongTransition();
    if (currentTrackId) {
      delete autoMixDecisionCacheRef.current[currentTrackId];
    }
  }, [currentTrackId]);

  useEffect(() => {
    if (settings.playback.songTransitionEnabled) {
      return;
    }

    songTransitionArmedTrackIdRef.current = null;
    clearPreparedSongTransition();
  }, [settings.playback.songTransitionEnabled]);

  useEffect(() => {
    if (
      !settings.playback.songTransitionEnabled ||
      !currentTrackId ||
      !currentTrack ||
      !isPlaying ||
      isPlaybackLoading ||
      isTimelineSeekingRef.current ||
      isPauseFadingRef.current ||
      isSongTransitionRunningRef.current
    ) {
      return;
    }

    if (cancelledAutoMixTrackIdRef.current === currentTrackId) {
      return;
    }

    const activeAudio = getActiveAudioElement();
    if (!activeAudio || activeAudio.paused) {
      return;
    }

    if (!shouldPrepareSongTransition({
      currentTrackId,
      currentTimeSeconds,
      durationSeconds: effectiveDurationSeconds,
    })) {
      return;
    }

    const target = resolveAdjacentPlaybackTarget(1, {
      fromEnded: true,
      allowRepeatOneRestart: false,
    });

    if (!target || target.action !== "play-track" || !target.trackId) {
      return;
    }

    const transitionDecision =
      getTransitionDecision(
        currentTrackId,
        effectiveDurationSeconds,
      );
    if (settings.playback.songTransitionMode === "auto-mix") {
      setIsAutoMixTransitionActive(true);
    }
    console.log("[automix]", {
      phase: "prepare",
      currentTrackId,
      mode: transitionDecision.mode,
      source: transitionDecision.source,
      plannedTransitionDurationMs: transitionDecision.plannedTransitionDurationMs ?? null,
      transitionTimingPlan: transitionDecision.transitionTimingPlan ?? null,
      currentTimeSeconds: roundTo(currentTimeSeconds, 3),
      durationSeconds: roundTo(effectiveDurationSeconds, 3),
      transitionStartSeconds: roundTo(transitionDecision.transitionStartSeconds, 3),
      resolvedTransitionStartMs: transitionDecision.resolvedTransitionStartMs,
      suggestedTransitionStartMs: transitionDecision.suggestedTransitionStartMs,
      nextTrackId: target.trackId,
      analysis: transitionDecision.analysis,
      nextAnalysis: transitionDecision.nextAnalysis,
    });
    void ensureSongTransitionPrepared(target, currentTrackId);
  }, [
    currentTimeSeconds,
    currentTrack,
    currentTrackId,
    effectiveDurationSeconds,
    isPlaybackLoading,
    isPlaying,
    settings.playback.songTransitionEnabled,
    settings.playback.songTransitionMode,
    settings.playback.songTransitionStartMs,
  ]);

  useEffect(() => {
    if (
      !settings.playback.songTransitionEnabled ||
      !currentTrackId ||
      !currentTrack ||
      !isPlaying ||
      isPlaybackLoading ||
      isTimelineSeekingRef.current ||
      isPauseFadingRef.current ||
      isSongTransitionRunningRef.current ||
      songTransitionArmedTrackIdRef.current === currentTrackId
    ) {
      return;
    }

    if (cancelledAutoMixTrackIdRef.current === currentTrackId) {
      return;
    }

    const activeAudio = getActiveAudioElement();
    if (!activeAudio || activeAudio.paused) {
      return;
    }

    if (!shouldStartSongTransitionNow({
      currentTrackId,
      currentTimeSeconds,
      durationSeconds: effectiveDurationSeconds,
    })) {
      return;
    }

    const target = resolveAdjacentPlaybackTarget(1, {
      fromEnded: true,
      allowRepeatOneRestart: false,
    });

    if (!target || target.action !== "play-track" || !target.trackId) {
      return;
    }

    const transitionDecision =
      getTransitionDecision(
        currentTrackId,
        effectiveDurationSeconds,
      );
    console.log("[automix]", {
      phase: "start",
      currentTrackId,
      mode: transitionDecision.mode,
      settingsMode: settings.playback.songTransitionMode,
      source: transitionDecision.source,
      plannedTransitionDurationMs: transitionDecision.plannedTransitionDurationMs ?? null,
      transitionTimingPlan: transitionDecision.transitionTimingPlan ?? null,
      currentTimeSeconds: roundTo(currentTimeSeconds, 3),
      durationSeconds: roundTo(effectiveDurationSeconds, 3),
      transitionStartSeconds: roundTo(transitionDecision.transitionStartSeconds, 3),
      resolvedTransitionStartMs: transitionDecision.resolvedTransitionStartMs,
      suggestedTransitionStartMs: transitionDecision.suggestedTransitionStartMs,
      nextTrackId: target.trackId,
      analysis: transitionDecision.analysis,
      nextAnalysis: transitionDecision.nextAnalysis,
    });
    if (settings.playback.songTransitionMode === "auto-mix") {
      setIsAutoMixTransitionActive(true);
    }
    songTransitionArmedTrackIdRef.current = currentTrackId;
    void startSongTransition(target).then((didStart) => {
      if (!didStart && currentTrackIdRef.current === currentTrackId) {
        songTransitionArmedTrackIdRef.current = null;
      }
      if (!didStart) {
        setIsAutoMixTransitionActive(false);
      }
    });
  }, [
    currentTimeSeconds,
    currentTrack,
    currentTrackId,
    effectiveDurationSeconds,
    isPlaybackLoading,
    isPlaying,
    settings.playback.songTransitionEnabled,
    settings.playback.songTransitionMode,
    settings.playback.songTransitionStartMs,
  ]);

  useEffect(() => {
    if (
      settings.playback.songTransitionEnabled &&
      settings.playback.songTransitionMode === "auto-mix" &&
      currentTrackId &&
      !isSongTransitionRunningRef.current &&
      songTransitionPreparedRef.current &&
      songTransitionPreparedRef.current.sourceTrackId === currentTrackId
    ) {
      setIsAutoMixTransitionActive(true);
      return;
    }

    if (!isSongTransitionRunningRef.current) {
      setIsAutoMixTransitionActive(false);
    }
  }, [
    currentTrackId,
    isPlaybackLoading,
    isPlaying,
    settings.playback.songTransitionEnabled,
    settings.playback.songTransitionMode,
  ]);

  const handleCyclePlaybackMode = () => {
    if (playbackQueueKindRef.current === "personal-fm" || playbackQueueKindRef.current === "intelligence") {
      pushDynamicIslandNotification(
        playbackQueueKindRef.current === "personal-fm"
          ? copy.locale === "en-US"
            ? "Private FM stays in ordered playback."
            : "私人 FM 会暂时保持顺序播放。"
          : copy.locale === "en-US"
            ? "Heart Mode stays in ordered playback."
            : "心动模式会暂时保持顺序播放。",
      );
      return;
    }

    const nextMode = getNextPlaybackMode(playbackModeRef.current);
    applyPlaybackModeLocally(nextMode);

    if (!isSettingsLoadingRef.current) {
      const nextSettings: AppSettings = {
        ...settingsRef.current,
        playback: {
          ...settingsRef.current.playback,
          playbackMode: nextMode,
        },
      };

      settingsRef.current = nextSettings;
      setSettings(nextSettings);

      if (playbackModeSaveTimerRef.current) {
        window.clearTimeout(playbackModeSaveTimerRef.current);
      }

      playbackModeSaveTimerRef.current = window.setTimeout(() => {
        playbackModeSaveTimerRef.current = null;
        const requestedSettings = settingsRef.current;
        void saveAppSettings(settingsRef.current)
          .then((snapshot) => {
            applySavedSettingsSnapshot(requestedSettings, snapshot);
          })
          .catch((error) => {
            console.error("[settings] failed to save playback mode", error);
            pushDynamicIslandNotification(localeStrings.notifications.settingsSaveFailed);
          });
      }, 180);
    }

    pushDynamicIslandNotification(playbackModeLabel(nextMode, copy.locale));
  };

  const handleShortcutAction = (actionId: ShortcutActionId) => {
    switch (actionId) {
      case "togglePlayback":
        void handleTogglePlayback();
        return;
      case "nextTrack":
        void handleSkipToAdjacentTrack(1);
        return;
      case "previousTrack":
        void handleSkipToAdjacentTrack(-1);
        return;
      case "stopPlayback":
        handleStopPlayback();
        return;
      case "volumeUp":
        handleAdjustVolumeBy(SHORTCUT_VOLUME_STEP);
        return;
      case "volumeDown":
        handleAdjustVolumeBy(-SHORTCUT_VOLUME_STEP);
        return;
      case "seekForward":
        handleSeekBySeconds(SHORTCUT_SEEK_STEP_SECONDS);
        return;
      case "seekBackward":
        handleSeekBySeconds(-SHORTCUT_SEEK_STEP_SECONDS);
        return;
      case "cyclePlaybackMode":
        handleCyclePlaybackMode();
        return;
      default:
        return;
    }
  };

  useEffect(() => {
    shortcutActionHandlerRef.current = handleShortcutAction;
  });

  useEffect(() => {
    if (isSettingsLoading) {
      return;
    }

    let isDisposed = false;

    const registerCustomGlobalShortcuts = async () => {
      try {
        await unregisterAllGlobalShortcuts();
      } catch (error) {
        console.error("[shortcut] failed to clear global shortcuts", error);
      }

      const registeredShortcuts = SHORTCUT_ACTION_IDS.reduce<Record<string, ShortcutActionId>>(
        (result, actionId) => {
          const accelerator = buildGlobalShortcutAccelerator(settingsRef.current.shortcuts[actionId]);
          if (!accelerator) {
            return result;
          }

          result[accelerator.toLowerCase()] = actionId;
          return result;
        },
        {},
      );

      const acceleratorEntries = Object.entries(registeredShortcuts);
      if (acceleratorEntries.length === 0 || isDisposed) {
        return;
      }

      for (const [accelerator, actionId] of acceleratorEntries) {
        try {
          await registerGlobalShortcut(accelerator, (event) => {
            if (event.state !== "Pressed") {
              return;
            }

            shortcutActionHandlerRef.current(actionId);
          });
        } catch (error) {
          console.error(`[shortcut] failed to register global shortcut ${accelerator}`, error);
        }
      }
    };

    void registerCustomGlobalShortcuts();

    return () => {
      isDisposed = true;
      void unregisterAllGlobalShortcuts().catch((error) => {
        console.error("[shortcut] failed to unregister global shortcuts", error);
      });
    };
  }, [isSettingsLoading, settings.shortcuts]);

  useEffect(() => {
    const pressedKeys = new Set<string>();
    let activeShortcutSignature = "";

    const findMatchingShortcutAction = () => {
      return SHORTCUT_ACTION_IDS.find((actionId) => {
        const binding = IN_APP_SHORTCUT_BINDINGS[actionId];
        return binding.length > 0 && binding.every((key) => pressedKeys.has(key));
      });
    };

    const buildShortcutSignature = (actionId: ShortcutActionId) => {
      const activeBinding = IN_APP_SHORTCUT_BINDINGS[actionId];

      return `${actionId}:${[...activeBinding].sort().join("+")}`;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      const normalizedKey = normalizeShortcutKeyValue(event.key);
      if (!normalizedKey) {
        return;
      }

      const isEditableTarget = isEditableShortcutTarget(event.target);
      if (!isEditableTarget && shouldPreventDefaultInAppKeyBehavior(normalizedKey)) {
        event.preventDefault();
      }

      if (isEditableTarget) {
        return;
      }

      pressedKeys.add(normalizedKey);
      const customAction = findMatchingShortcutAction();

      if (!customAction) {
        return;
      }

      const shortcutSignature = buildShortcutSignature(customAction);

      if (activeShortcutSignature === shortcutSignature) {
        return;
      }

      if (event.repeat && !shortcutActionAllowsRepeat(customAction)) {
        return;
      }

      activeShortcutSignature = shortcutSignature;
      event.preventDefault();
      shortcutActionHandlerRef.current(customAction);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const normalizedKey = normalizeShortcutKeyValue(event.key);
      if (!normalizedKey) {
        return;
      }

      pressedKeys.delete(normalizedKey);

      if (activeShortcutSignature) {
        const stillMatchedAction = findMatchingShortcutAction();
        const nextSignature = stillMatchedAction ? buildShortcutSignature(stillMatchedAction) : "";
        if (nextSignature !== activeShortcutSignature) {
          activeShortcutSignature = "";
        }
      }
    };

    const handleWindowBlur = () => {
      pressedKeys.clear();
      activeShortcutSignature = "";
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  const handleMoveQueueTrack = (trackId: string, direction: -1 | 1) => {
    const sourceQueueIds = currentQueueIdsRef.current.length > 0 ? currentQueueIdsRef.current : currentQueueIds;
    const currentIndex = sourceQueueIds.indexOf(trackId);

    if (currentIndex === -1) {
      return;
    }

    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= sourceQueueIds.length) {
      return;
    }

    const nextQueueIds = [...sourceQueueIds];
    [nextQueueIds[currentIndex], nextQueueIds[targetIndex]] = [
      nextQueueIds[targetIndex],
      nextQueueIds[currentIndex],
    ];
    replacePlaybackQueue(nextQueueIds, { preserveSourcePlaylist: true });
  };

  const handleRemoveQueueTrack = (trackId: string) => {
    const sourceQueueIds = currentQueueIdsRef.current.length > 0 ? currentQueueIdsRef.current : currentQueueIds;
    const currentIndexInQueue = sourceQueueIds.indexOf(trackId);
    if (currentIndexInQueue === -1) {
      return;
    }

    const nextQueueIds = sourceQueueIds.filter((queueTrackId) => queueTrackId !== trackId);
    const nextSequence = replacePlaybackQueue(nextQueueIds, { preserveSourcePlaylist: true });

    if (nextSequence.length === 0) {
      pauseActiveTrackForTransition();
      setCurrentTrackId(null);
      setIsPlaying(false);
      setIsPlaybackLoading(false);
      setCurrentTimeSeconds(0);
      setVisualCurrentTimeSeconds(0);
      setDurationSeconds(0);
      setIsQueuePopoverOpen(false);
      return;
    }

    if (currentTrackIdRef.current !== trackId) {
      return;
    }

    const fallbackIndex = Math.min(currentIndexInQueue, nextSequence.length - 1);
    const nextTrackId = nextSequence[fallbackIndex] ?? nextSequence[0] ?? null;

    if (!nextTrackId) {
      return;
    }

    pauseActiveTrackForTransition();
    void requestPreparedPlayback(nextTrackId, nextSequence, {
      autoplay: isPlayingRef.current,
      announceNotice: false,
    });
  };

  const handleReorderQueueTrack = (draggingTrackId: string, insertionIndex: number) => {
    const sourceQueueIds = currentQueueIdsRef.current.length > 0 ? currentQueueIdsRef.current : currentQueueIds;
    const draggingIndex = sourceQueueIds.indexOf(draggingTrackId);

    if (draggingIndex === -1) {
      return;
    }

    const nextQueueIds = [...sourceQueueIds];
    nextQueueIds.splice(draggingIndex, 1);
    const normalizedInsertionIndex = Math.max(0, Math.min(insertionIndex, nextQueueIds.length));
    nextQueueIds.splice(normalizedInsertionIndex, 0, draggingTrackId);
    replacePlaybackQueue(nextQueueIds, { preserveSourcePlaylist: true });
  };

  const registerQueueItemRef = (trackId: string, node: HTMLDivElement | null) => {
    if (node) {
      queueItemRefs.current.set(trackId, node);
      return;
    }

    queueItemRefs.current.delete(trackId);
  };

  const handleQueueDragPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    trackId: string,
  ) => {
    if (event.button !== 0) {
      return;
    }

    const queueItem = event.currentTarget.closest(".playbar__queue-item");
    if (!(queueItem instanceof HTMLDivElement)) {
      return;
    }

    const sourceQueueIds = currentQueueIdsRef.current.length > 0 ? currentQueueIdsRef.current : currentQueueIds;
    const draggingIndex = sourceQueueIds.indexOf(trackId);
    if (draggingIndex === -1) {
      return;
    }

    const rect = queueItem.getBoundingClientRect();
    const queueList = queueListRef.current;
    const rowTops = sourceQueueIds.reduce<Record<string, number>>((collection, queueTrackId) => {
      const itemNode = queueItemRefs.current.get(queueTrackId);
      if (itemNode) {
        collection[queueTrackId] = itemNode.offsetTop;
      }
      return collection;
    }, {});
    const rowCenters = sourceQueueIds.reduce<Record<string, number>>((collection, queueTrackId) => {
      const itemNode = queueItemRefs.current.get(queueTrackId);
      if (itemNode) {
        collection[queueTrackId] = itemNode.offsetTop + itemNode.offsetHeight / 2;
      }
      return collection;
    }, {});
    const queueListRect = queueList?.getBoundingClientRect();
    event.preventDefault();
    event.stopPropagation();

    setDraggingQueueTrackId(trackId);
    setQueueDropIndex(draggingIndex);
    setQueueDragState({
      trackId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      initialIndex: draggingIndex,
      listScrollTop: queueList?.scrollTop ?? 0,
      listTop: queueListRect?.top ?? 0,
      listBottom: queueListRect?.bottom ?? 0,
      queueIds: [...sourceQueueIds],
      rowTops,
      rowCenters,
    });
  };

  const handleTestNeteaseApi = async () => {
    if (!settings.network.enabledSources.includes("netease")) {
      pushDynamicIslandNotification(localeStrings.notifications.neteaseSourceDisabled);
      return;
    }

    setIsTestingNeteaseApi(true);

    try {
      if (settings.network.useLocalApiServer) {
        const status = await syncLocalNeteaseApiServer(settings);
        setLocalNeteaseApiStatus(status);
        setLocalNeteaseApiRuntimeBaseUrl(status.enabled ? status.url.replace(/\/+$/, "") : null);
      }
      await testNeteaseApiConnection(settings);
      pushDynamicIslandNotification(localeStrings.notifications.neteaseApiTestSuccess);
    } catch (error) {
      console.error("[network] failed to test netease api", error);
      pushDynamicIslandNotification(localeStrings.notifications.neteaseApiTestFailed);
    } finally {
      setIsTestingNeteaseApi(false);
    }
  };

  const handleSaveNeteaseCookie = async (cookie: string) => {
    try {
      const trimmedCookie = cookie.trim();
      const nextSettings: AppSettings = {
        ...settingsRef.current,
        network: {
          ...settingsRef.current.network,
          enabledSources: settingsRef.current.network.enabledSources.includes("netease")
            ? settingsRef.current.network.enabledSources
            : ["netease"],
          neteaseCookie: trimmedCookie,
        },
      };

      const snapshot = await saveAppSettings(nextSettings);
      applySavedSettingsSnapshot(nextSettings, snapshot);
      pushDynamicIslandNotification(localeStrings.notifications.neteaseLoginSaved);
    } catch (error) {
      console.error("[settings] failed to save netease cookie", error);
      pushDynamicIslandNotification(localeStrings.notifications.neteaseLoginSaveFailed);
      throw error;
    }
  };

  const handleClearNeteaseCookie = async () => {
    try {
      const nextSettings: AppSettings = {
        ...settingsRef.current,
        network: {
          ...settingsRef.current.network,
          neteaseCookie: "",
        },
      };

      const snapshot = await saveAppSettings(nextSettings);
      applySavedSettingsSnapshot(nextSettings, snapshot);
      pushDynamicIslandNotification(localeStrings.notifications.neteaseLoginCleared);
    } catch (error) {
      console.error("[settings] failed to clear netease cookie", error);
      pushDynamicIslandNotification(localeStrings.notifications.neteaseLoginClearFailed);
      throw error;
    }
  };

  const handleSaveSettings = async () => {
    if (settingsAutoSaveTimerRef.current !== null) {
      window.clearTimeout(settingsAutoSaveTimerRef.current);
      settingsAutoSaveTimerRef.current = null;
    }

    try {
      await persistSettingsSnapshot(settingsRef.current, {
        notifySuccess: true,
        notifyFailure: true,
        triggerLibraryScan: true,
        successMessage: localeStrings.notifications.settingsSaved,
        failureMessage: localeStrings.notifications.settingsSaveFailed,
      });
    } catch {
      return;
    }
  };

  const handleResetSettings = async () => {
    setIsSettingsSaving(true);

    try {
      const snapshot = await resetAppSettings();
      setSettings(snapshot.settings);
      settingsRef.current = snapshot.settings;
      syncPersistedSettingsState(snapshot.settings);
      setVolume(snapshot.settings.playback.defaultVolume);
      setPlaybackMode(snapshot.settings.playback.playbackMode);
      savedWindowSizeKeyRef.current = buildWindowSizeKey(
        snapshot.settings.window.width,
        snapshot.settings.window.height,
      );
      pendingWindowSizeKeyRef.current = "";
      setMediaLibrary((current) => current ?? null);
      pushDynamicIslandNotification(localeStrings.notifications.settingsReset);
    } catch (error) {
      console.error("[settings] failed to reset settings", error);
      pushDynamicIslandNotification(localeStrings.notifications.settingsResetFailed);
    } finally {
      setIsSettingsSaving(false);
    }
  };

  const handleClearLibrary = async () => {
    setIsImportingLibrary(true);

    try {
      const snapshot = await clearMediaLibrary();
      setMediaLibrary(snapshot);
      pushDynamicIslandNotification(localeStrings.notifications.libraryCleared);
    } catch (error) {
      console.error("[media] failed to clear library", error);
      pushDynamicIslandNotification(localeStrings.notifications.libraryClearFailed);
    } finally {
      setIsImportingLibrary(false);
    }
  };

  const handleReleaseMemoryCache = async () => {
    try {
      const neteaseCacheSummary = clearNeteaseMemoryCaches();
      const exploreCacheSummary = clearExploreMemoryCaches();
      const appCacheSummary = {
        homeFeedCacheEntries: neteaseHomeFeedCache.size,
        playlistLibraryCacheEntries: neteasePlaylistLibraryCache.size,
        playlistDetailCacheEntries: neteasePlaylistDetailCache.size,
        playlistTracksCacheEntries: neteasePlaylistTracksCache.size,
        artistAvatarCacheEntries: neteaseArtistAvatarCache.size,
      };
      neteaseHomeFeedCache.clear();
      neteasePlaylistLibraryCache.clear();
      neteasePlaylistDetailCache.clear();
      neteasePlaylistTracksCache.clear();
      neteaseArtistAvatarCache.clear();

      const runtimeCacheSummary = {
        repairingArtworkTrackKeys: repairingArtworkTrackKeysRef.current.size,
        repairedArtworkTrackKeys: repairedArtworkTrackKeysRef.current.size,
        loggedTrackAnalysisKeys: loggedTrackAnalysisKeysRef.current.size,
        trackAnalysisEntries: Object.keys(trackAnalysisByTrackIdRef.current).length,
        trackAnalysisRequests: Object.keys(trackAnalysisRequestsRef.current).length,
        autoMixDecisionEntries: Object.keys(autoMixDecisionCacheRef.current).length,
        lyricsCacheEntries: Object.keys(lyricsCacheRef.current).length,
        immersivePaletteCacheEntries: Object.keys(immersivePaletteCacheRef.current).length,
        cachedPlaybackAudioEntries: Object.keys(playbackCachedAudioPathsRef.current).length,
        playbackCacheRequests: Object.keys(playbackCacheRequestsRef.current).length,
      };

      repairingArtworkTrackKeysRef.current.clear();
      repairedArtworkTrackKeysRef.current.clear();
      loggedTrackAnalysisKeysRef.current.clear();
      trackAnalysisByTrackIdRef.current = {};
      trackAnalysisRequestsRef.current = {};
      autoMixDecisionCacheRef.current = {};
      lyricsCacheRef.current = {};
      immersivePaletteCacheRef.current = {};

      const cachedEntries = Object.entries(playbackCachedAudioPathsRef.current);
      playbackCachedAudioPathsRef.current = {};
      playbackCacheRequestsRef.current = {};

      const playbackCacheReleaseResults = await Promise.allSettled(
        cachedEntries.map(([, path]) => clearCachedRemoteAudio(path)),
      );
      const releasedPlaybackCacheFiles = playbackCacheReleaseResults.filter(
        (result) => result.status === "fulfilled",
      ).length;
      const failedPlaybackCacheFiles = playbackCacheReleaseResults.length - releasedPlaybackCacheFiles;

      if (typeof window !== "undefined" && "gc" in window) {
        const maybeGc = (window as Window & { gc?: () => void }).gc;
        maybeGc?.();
      }

      console.groupCollapsed("[cache] released in-memory cache");
      console.log("netease", neteaseCacheSummary);
      console.log("explore", exploreCacheSummary);
      console.log("app", appCacheSummary);
      console.log("runtime", runtimeCacheSummary);
      console.log("playbackCacheFiles", {
        attempted: cachedEntries.length,
        released: releasedPlaybackCacheFiles,
        failed: failedPlaybackCacheFiles,
      });
      console.groupEnd();

      pushDynamicIslandNotification(localeStrings.notifications.memoryCacheReleased);
    } catch (error) {
      console.error("[cache] failed to release in-memory cache", error);
      pushDynamicIslandNotification(localeStrings.notifications.memoryCacheReleaseFailed);
    }
  };

  const handleDeleteLibraryTracks = async (trackIds: string[]) => {
    const nextTrackIds = Array.from(new Set(trackIds.filter(Boolean)));

    if (nextTrackIds.length === 0) {
      return;
    }

    setIsDeletingLibraryTracks(true);

    try {
      const snapshot = await deleteMediaTracks(nextTrackIds);
      setMediaLibrary(snapshot);

      const deletedTrackIds = new Set(nextTrackIds);
      setPlaybackQueueIds((current) => current.filter((trackId) => !deletedTrackIds.has(trackId)));
      setShuffledQueueIds((current) => current.filter((trackId) => !deletedTrackIds.has(trackId)));

      if (currentTrackIdRef.current && deletedTrackIds.has(currentTrackIdRef.current)) {
        pauseActiveTrackForTransition();
        setCurrentTrackId(null);
        setIsPlaying(false);
        setCurrentTimeSeconds(0);
        setVisualCurrentTimeSeconds(0);
        setDurationSeconds(0);
      }

      pushDynamicIslandNotification(getLibrarySongBrowserCopy(copy.locale).deleteCompleted);
    } catch (error) {
      console.error("[media] failed to delete tracks from library", error);
      pushDynamicIslandNotification(getLibrarySongBrowserCopy(copy.locale).deleteFailed);
    } finally {
      setIsDeletingLibraryTracks(false);
    }
  };

  const captureNavigationSnapshot = (): AppNavigationSnapshot => ({
    activeNav,
    libraryView,
    selectedPlaylist,
  });

  const handleOpenPlaylist = (playlist: PlaylistSelection) => {
    setPlaylistReturnSnapshot(captureNavigationSnapshot());
    setSelectedPlaylist(playlist);
    setActiveNav("playlist");
  };

  const handleOpenQueueSourcePlaylist = () => {
    if (!playbackQueueSourcePlaylist) {
      return;
    }

    setIsQueuePopoverOpen(false);

    if (activeNav === "playlist" && selectedPlaylist?.id === playbackQueueSourcePlaylist.id) {
      return;
    }

    handleOpenPlaylist(playbackQueueSourcePlaylist);
  };

  const handleBackFromPlaylist = () => {
    if (playlistReturnSnapshot) {
      setActiveNav(playlistReturnSnapshot.activeNav);
      setLibraryView(playlistReturnSnapshot.libraryView);
      setSelectedPlaylist(playlistReturnSnapshot.selectedPlaylist);
      setPlaylistReturnSnapshot(null);
      return;
    }

    setSelectedPlaylist(null);
  };

  const handleBackFromExploreDetail = () => {
    if (exploreReturnSnapshot) {
      setActiveNav(exploreReturnSnapshot.activeNav);
      setLibraryView(exploreReturnSnapshot.libraryView);
      setSelectedPlaylist(exploreReturnSnapshot.selectedPlaylist);
      setExploreReturnSnapshot(null);
      return;
    }

    setExploreReturnSnapshot(null);
    setActiveNav("explore");
  };

  const openLibraryArtistView = (artistName: string) => {
    const normalizedArtist = artistName.trim();
    if (!normalizedArtist) {
      return;
    }

    setPlaylistReturnSnapshot(null);
    setActiveNav("library");
    setLibraryNavigationRequest({
      target: "artist",
      name: normalizedArtist,
      key: Date.now(),
    });
  };

  const openLibraryAlbumView = (albumName: string) => {
    const normalizedAlbum = albumName.trim();
    if (!normalizedAlbum) {
      return;
    }

    setPlaylistReturnSnapshot(null);
    setActiveNav("library");
    setLibraryNavigationRequest({
      target: "album",
      name: normalizedAlbum,
      key: Date.now(),
    });
  };

  const openExploreArtistView = (artistId: number, artistName: string) => {
    if (!Number.isFinite(artistId)) {
      return;
    }

    setExploreReturnSnapshot(captureNavigationSnapshot());
    setPlaylistReturnSnapshot(null);
    setActiveNav("explore");
    setExploreDetailRequest({
      kind: "artist",
      id: artistId,
      name: artistName,
      key: Date.now(),
    });
  };

  const openExploreAlbumView = (albumId: number, albumName: string) => {
    if (!Number.isFinite(albumId)) {
      return;
    }

    setExploreReturnSnapshot(captureNavigationSnapshot());
    setPlaylistReturnSnapshot(null);
    setActiveNav("explore");
    setExploreDetailRequest({
      kind: "album",
      id: albumId,
      name: albumName,
      key: Date.now(),
    });
  };

  const handleOpenTrackArtist = async (track: TrackRecord) => {
    const artistName = track.artist?.trim() ?? "";
    await handleOpenTrackArtistByIndex(track, 0, artistName);
  };

  const handleOpenTrackArtistByIndex = async (
    track: TrackRecord,
    artistIndex: number,
    fallbackArtistName?: string,
  ) => {
    const artistNames = (track.artist ?? "")
      .split(" / ")
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    const artistName = fallbackArtistName?.trim() || artistNames[artistIndex] || artistNames[0] || "";
    if (!artistName) {
      return;
    }

    if (track.source.kind === "localFile") {
      openLibraryArtistView(artistName);
      return;
    }

    const neteaseTrackId = parseNeteaseTrackIdFromCacheKey(track.playback.cacheKey);
    if (!neteaseTrackId) {
      openLibraryArtistView(artistName);
      return;
    }

    const detail = await getNeteaseSongDetail(settingsRef.current, neteaseTrackId).catch(() => null);
    const targetArtistId = detail?.artistIds[artistIndex] ?? detail?.artistIds[0] ?? null;
    const targetArtistName = detail?.artists[artistIndex] ?? detail?.artists[0] ?? artistName;

    if (targetArtistId) {
      openExploreArtistView(targetArtistId, targetArtistName);
      return;
    }

    openLibraryArtistView(targetArtistName);
  };

  const handleOpenTrackAlbum = async (track: TrackRecord) => {
    const albumName = track.album?.trim() ?? "";
    if (!albumName) {
      return;
    }

    if (track.source.kind === "localFile") {
      openLibraryAlbumView(albumName);
      return;
    }

    const neteaseTrackId = parseNeteaseTrackIdFromCacheKey(track.playback.cacheKey);
    if (!neteaseTrackId) {
      openLibraryAlbumView(albumName);
      return;
    }

    const detail = await getNeteaseSongDetail(settingsRef.current, neteaseTrackId).catch(() => null);
    const targetAlbumId = detail?.albumId ?? null;
    const targetAlbumName = detail?.album ?? albumName;

    if (targetAlbumId) {
      openExploreAlbumView(targetAlbumId, targetAlbumName);
      return;
    }

    openLibraryAlbumView(targetAlbumName);
  };

  const contextMenuCopy = getContextMenuCopy(copy.locale);
  const canUseNeteaseContextActions =
    isNeteaseSourceEnabled(settings) && settings.network.neteaseCookie.trim().length > 0;
  const playlistLibraryCacheKey = buildNeteaseCacheKey(settingsRef.current, "playlist:library");
  const cachedPlaylistLibrary = neteasePlaylistLibraryCache.get(playlistLibraryCacheKey);
  const ownedPlaylistIds = new Set(contextMenuOwnedPlaylists.map((playlist) => playlist.id));
  const accountUserId = cachedPlaylistLibrary?.account?.userId ?? null;
  const likedSongsContextPlaylist =
    cachedPlaylistLibrary?.account && cachedPlaylistLibrary.userPlaylists.length > 0
      ? (() => {
          const playlist = findLikedPlaylist(
            cachedPlaylistLibrary.userPlaylists,
            cachedPlaylistLibrary.account.userId,
          );
          return playlist
            ? {
                id: playlist.id,
                title: playlist.name,
              }
            : null;
        })()
      : null;
  const contextMenuItems: ContextMenuItemDefinition[] = (() => {
    if (!contextMenuState) {
      return [];
    }

    if (contextMenuState.target.kind === "blank") {
      return [
        {
          id: "refresh",
          label: contextMenuCopy.refresh,
          onSelect: () => {
            closeContextMenu();
            window.location.reload();
          },
        },
      ];
    }

    if (contextMenuState.target.kind === "song") {
      const payload = contextMenuState.target.payload;
      const neteasePayload = payload.kind === "netease" ? payload.song : null;
      const contextQueueSongs = payload.kind === "netease" ? payload.queueSongs : [];
      const neteaseTrackId = getNeteaseTrackIdFromContextSong(payload);
      const currentPlaylistId = activeNav === "playlist" ? selectedPlaylist?.id ?? null : null;
      const currentIntelligencePlaylist =
        activeNav === "playlist"
          ? selectedPlaylist
          : activeNav === "favorites"
            ? likedSongsContextPlaylist
            : null;
      const canRemoveFromCurrentPlaylist =
        canUseNeteaseContextActions &&
        currentPlaylistId !== null &&
        neteaseTrackId !== null &&
        ownedPlaylistIds.has(currentPlaylistId);
      const canStartIntelligenceMode =
        canUseNeteaseContextActions &&
        neteaseTrackId !== null &&
        currentIntelligencePlaylist !== null;
      const playlistSubmenu =
        !canUseNeteaseContextActions
          ? [
              {
                id: "login-required",
                label: contextMenuCopy.loginRequired,
                disabled: true,
              },
            ]
          : isContextMenuPlaylistLoading
            ? [
                {
                  id: "loading-playlists",
                  label: contextMenuCopy.loadingPlaylists,
                  disabled: true,
                },
              ]
            : contextMenuOwnedPlaylists.length === 0
              ? [
                  {
                    id: "no-playlists",
                    label: contextMenuCopy.noAvailablePlaylist,
                    disabled: true,
                  },
                ]
              : contextMenuOwnedPlaylists.map((playlist) => ({
                  id: `playlist-choice:${playlist.id}`,
                  label: playlist.name,
                  artworkUrl: playlist.artworkUrl ?? null,
                  disabled:
                    contextMenuBusyActionId !== null ||
                    neteaseTrackId === null,
                  onSelect: () => {
                    void handleAddSongToPlaylistFromContext(payload, playlist.id);
                  },
                }));

      return [
        {
          id: "song-add-queue",
          label: contextMenuCopy.addToQueue,
          disabled: contextMenuBusyActionId !== null,
          onSelect: () => queueContextSong(payload, "append"),
        },
        {
          id: "song-play-next",
          label: contextMenuCopy.playNext,
          disabled: contextMenuBusyActionId !== null,
          onSelect: () => queueContextSong(payload, "next"),
        },
        {
          id: "song-start-intelligence",
          label: contextMenuCopy.startIntelligenceMode,
          disabled: contextMenuBusyActionId !== null || !canStartIntelligenceMode,
          onSelect: () => {
            if (!currentIntelligencePlaylist || !neteasePayload) {
              return;
            }

            void handleStartNeteaseIntelligenceMode(
              currentIntelligencePlaylist,
              neteasePayload,
              contextQueueSongs,
            );
          },
        },
        {
          id: "song-like",
          label: contextMenuCopy.likeSong,
          disabled: !canUseNeteaseContextActions || neteaseTrackId === null,
          onSelect: () => {
            void handleLikeSongFromContext(payload);
          },
        },
        {
          id: "song-add-playlist",
          label: contextMenuCopy.addToPlaylist,
          disabled: !canUseNeteaseContextActions || neteaseTrackId === null,
          submenu: playlistSubmenu,
        },
        ...(currentPlaylistId !== null
          ? [
              {
                id: "song-remove-current-playlist",
                label: contextMenuCopy.removeFromCurrentPlaylist,
                danger: true,
                disabled: !canRemoveFromCurrentPlaylist || contextMenuBusyActionId !== null,
                onSelect: () => {
                  void handleRemoveSongFromCurrentPlaylistFromContext(payload, currentPlaylistId);
                },
              } satisfies ContextMenuItemDefinition,
            ]
          : []),
      ];
    }

    const playlist = contextMenuState.target.playlist;
    const matchingOwnedPlaylist = contextMenuOwnedPlaylists.find((item) => item.id === playlist.id) ?? null;
    const isOwnPlaylist =
      (accountUserId !== null && playlist.creatorUserId === accountUserId) ||
      matchingOwnedPlaylist !== null;
    const matchingUserPlaylist =
      cachedPlaylistLibrary?.userPlaylists.find((item) => item.id === playlist.id) ?? null;
    const isSubscribedPlaylist =
      !isOwnPlaylist &&
      (
        playlist.subscribed ||
        matchingUserPlaylist?.subscribed === true ||
        (
          matchingUserPlaylist !== null &&
          accountUserId !== null &&
          matchingUserPlaylist.creatorUserId !== accountUserId
        )
      );

    return [
      {
        id: "playlist-subscribe",
        label: isOwnPlaylist
          ? contextMenuCopy.ownPlaylist
          : isSubscribedPlaylist
            ? contextMenuCopy.unsubscribePlaylist
            : contextMenuCopy.subscribePlaylist,
        disabled: !canUseNeteaseContextActions || isOwnPlaylist,
        onSelect: () => {
          void handleTogglePlaylistSubscriptionFromContext({
            ...playlist,
            subscribed: isSubscribedPlaylist,
          });
        },
      },
      {
        id: "playlist-delete",
        label: contextMenuCopy.deletePlaylist,
        danger: true,
        disabled: !isOwnPlaylist || contextMenuBusyActionId !== null,
        onSelect: () => {
          void handleDeletePlaylistFromContext(playlist);
        },
      },
      {
        id: "playlist-edit",
        label: contextMenuCopy.editPlaylist,
        disabled: !isOwnPlaylist || contextMenuBusyActionId !== null,
        onSelect: () => {
          void handleEditPlaylistFromContext(playlist);
        },
      },
    ];
  })();

  const handleWorkspaceContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    event.preventDefault();

    if (target.closest(".app-context-menu")) {
      return;
    }

    if (target.closest("button, a, input, textarea, select, [role='button']")) {
      closeContextMenu();
      return;
    }

    openContextMenu(event, { kind: "blank" });
  };

  const handleTrackContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    track: TrackRecord,
    queueTracks: TrackRecord[],
  ) => {
    openContextMenu(event, {
      kind: "song",
      payload: {
        kind: "track",
        track,
        queueTracks,
      },
    });
  };

  const handleNeteaseSongContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    song: NeteaseSongDetail,
    queueSongs: NeteaseSongDetail[],
  ) => {
    openContextMenu(event, {
      kind: "song",
      payload: {
        kind: "netease",
        song,
        queueSongs,
      },
    });
  };

  const handlePlaylistContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    playlist: NeteasePlaylistRecommendation,
  ) => {
    openContextMenu(event, {
      kind: "playlist",
      playlist,
    });
  };

  const handleOpenImmersivePlayer = () => {
    if (!currentTrack) {
      return;
    }

    setIsQueuePopoverOpen(false);
    setIsVolumePopoverOpen(false);
    syncImmersivePlayerOpen(true);
  };

  useEffect(() => {
    logWallpaper("checking existing wallpaper window on AppShell mount", {
      label: IMMERSIVE_WALLPAPER_WINDOW_LABEL,
    });
    void WebviewWindow.getByLabel(IMMERSIVE_WALLPAPER_WINDOW_LABEL)
      .then((windowHandle) => {
        logWallpaper("initial wallpaper window lookup completed", {
          label: IMMERSIVE_WALLPAPER_WINDOW_LABEL,
          found: windowHandle !== null,
        });
        setIsWallpaperModeEnabled(windowHandle !== null);
      })
      .catch((error) => {
        console.error("[wallpaper] failed to check existing wallpaper window", error);
      });
  }, []);

  const attachImmersiveWallpaperWindow = async () => {
    const startedAt = performance.now();
    logWallpaper("invoking open_immersive_wallpaper_window", {
      label: IMMERSIVE_WALLPAPER_WINDOW_LABEL,
    });
    await invoke("open_immersive_wallpaper_window");
    logWallpaper("open_immersive_wallpaper_window resolved", {
      label: IMMERSIVE_WALLPAPER_WINDOW_LABEL,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
    const resolvedWindow = await WebviewWindow.getByLabel(IMMERSIVE_WALLPAPER_WINDOW_LABEL);
    logWallpaper("wallpaper window lookup after Rust creation completed", {
      label: IMMERSIVE_WALLPAPER_WINDOW_LABEL,
      found: resolvedWindow !== null,
    });
    if (resolvedWindow) {
      resolvedWindow.once("tauri://destroyed", () => {
        logWallpaper("received tauri://destroyed for wallpaper window", {
          label: IMMERSIVE_WALLPAPER_WINDOW_LABEL,
        });
        setIsWallpaperModeEnabled(false);
      });
      resolvedWindow.once("tauri://error", (event) => {
        console.error("[wallpaper] received tauri://error for wallpaper window", {
          label: IMMERSIVE_WALLPAPER_WINDOW_LABEL,
          event,
        });
        setIsWallpaperModeEnabled(false);
        pushDynamicIslandNotification(localeStrings.notifications.wallpaperModeFailed);
      });
    }
    setIsWallpaperModeEnabled(resolvedWindow !== null);
  };

  const handleToggleImmersiveWallpaperMode = async () => {
    logWallpaper("wallpaper toggle requested", {
      hasCurrentTrack: currentTrack !== null,
      trackId: currentTrack?.id ?? null,
    });
    const existingWindow = await WebviewWindow.getByLabel(IMMERSIVE_WALLPAPER_WINDOW_LABEL);
    logWallpaper("wallpaper window lookup before toggle completed", {
      label: IMMERSIVE_WALLPAPER_WINDOW_LABEL,
      found: existingWindow !== null,
    });

    if (existingWindow) {
      logWallpaper("closing existing wallpaper window", {
        label: IMMERSIVE_WALLPAPER_WINDOW_LABEL,
      });
      try {
        await existingWindow.close();
        logWallpaper("existing wallpaper window close resolved", {
          label: IMMERSIVE_WALLPAPER_WINDOW_LABEL,
        });
      } finally {
        setIsWallpaperModeEnabled(false);
        pushDynamicIslandNotification(localeStrings.notifications.wallpaperModeDisabled);
      }
      return;
    }

    if (!currentTrack) {
      logWallpaper("wallpaper mode ignored because no track is active");
      return;
    }

    const staticSnapshot = buildImmersiveWallpaperStaticState();
    const dynamicSnapshot = buildImmersiveWallpaperDynamicState();
    logWallpaper("persisting latest wallpaper snapshots before Rust window creation", {
      trackId: currentTrack.id,
      staticHasTrack: staticSnapshot.hasTrack,
      isPlaying,
      currentTimeSeconds: Math.round(dynamicSnapshot.currentTimeSeconds * 1000) / 1000,
    });
    syncImmersiveWallpaperStaticSnapshot(staticSnapshot);
    syncImmersiveWallpaperDynamicSnapshot(dynamicSnapshot, { persist: true });

    try {
      await attachImmersiveWallpaperWindow();
      pushDynamicIslandNotification(localeStrings.notifications.wallpaperModeEnabled);
    } catch (error) {
      console.error("[wallpaper] failed to enable wallpaper mode", error);
      setIsWallpaperModeEnabled(false);
      pushDynamicIslandNotification(localeStrings.notifications.wallpaperModeFailed);
      const createdWindow = await WebviewWindow.getByLabel(IMMERSIVE_WALLPAPER_WINDOW_LABEL);
      await createdWindow?.close().catch(() => undefined);
    }
  };

  useEffect(() => {
    if (activeNav !== "tools" || toolsView !== "kugouImport") {
      return;
    }

    void ensureOwnedPlaylistsForToolImport().catch((error) => {
      console.error("[kugou-import] failed to load owned playlists", error);
      setToolOwnedPlaylists([]);
    });
  }, [
    activeNav,
    toolsView,
    neteaseUiVersion,
    settings.network.enabledSources.join("|"),
    settings.network.neteaseCookie,
    settings.network.neteaseApiBaseUrl,
  ]);

  const workspaceTransitionKey = [
    activeNav,
    activeNav === "tools" ? toolsView : "",
    activeNav === "library" ? libraryView : "",
    activeNav === "playlist" ? selectedPlaylist?.id ?? "browse" : "",
  ]
    .filter(Boolean)
    .join(":");

  const workspaceScreen =
    activeNav === "settings" ? (
      <SettingsScreen
        copy={copy}
        languageOptions={languageOptions}
        themeOptions={themeOptions}
        qualityOptions={qualityOptions}
        playbackCacheModeOptions={playbackCacheModeOptions}
        settings={settings}
        isLoading={isSettingsLoading}
        isSaving={isSettingsSaving}
        isTestingNeteaseApi={isTestingNeteaseApi}
        localNeteaseApiStatus={localNeteaseApiStatus}
        isClearingLibrary={isImportingLibrary}
        onUpdate={updateSettings}
        onSave={() => void handleSaveSettings()}
        onReset={() => void handleResetSettings()}
        onTestNeteaseApi={() => void handleTestNeteaseApi()}
        onSaveNeteaseCookie={(cookie) => handleSaveNeteaseCookie(cookie)}
        onClearNeteaseCookie={() => handleClearNeteaseCookie()}
        onPickScanDirectory={() => void handlePickScanDirectory()}
        onPickBackgroundImage={() => void handlePickBackgroundImage()}
        onClearBackgroundImage={handleClearBackgroundImage}
        onClearLibrary={() => void handleClearLibrary()}
        onReleaseMemoryCache={() => void handleReleaseMemoryCache()}
      />
    ) : activeNav === "home" ? (
      <HomeScreen
        copy={copy}
        settings={settings}
        dataVersion={neteaseUiVersion}
        mediaLibrary={mediaLibrary}
        isLibraryLoading={isLibraryLoading}
        onOpenLibrary={() => setActiveNav("library")}
        onImportMusic={() => {
          setActiveNav("library");
          setLibraryView("import");
        }}
        onPlayLocalTrack={playTrackSelection}
        onPlayNeteaseTrack={(trackId, queueSongs) =>
          void handlePlayNeteaseTrackSelection(trackId, queueSongs)
        }
        onPlayPersonalFmTrack={(trackId, queueSongs) =>
          void handlePlayNeteaseTrackSelection(trackId, queueSongs, {
            queueKind: "personal-fm",
          })
        }
        onOpenTrackArtist={(track) => void handleOpenTrackArtist(track)}
        onOpenTrackAlbum={(track) => void handleOpenTrackAlbum(track)}
        onOpenSongArtist={(artistId, artistName) => openExploreArtistView(artistId, artistName)}
        onOpenSongAlbum={(albumId, albumName) => openExploreAlbumView(albumId, albumName)}
        onOpenPlaylist={handleOpenPlaylist}
        onSongContextMenu={handleNeteaseSongContextMenu}
        onTrackContextMenu={handleTrackContextMenu}
        onPlaylistContextMenu={handlePlaylistContextMenu}
      />
    ) : activeNav === "playlist" ? (
      <PlaylistScreen
        copy={copy}
        settings={settings}
        dataVersion={neteaseUiVersion}
        initialSelection={selectedPlaylist}
        onSelectPlaylist={setSelectedPlaylist}
        onBack={handleBackFromPlaylist}
        backLabel={getPlaylistBackLabel(copy.locale, playlistReturnSnapshot)}
        onPlayNeteaseTrack={(trackId, queueSongs, sourcePlaylist) =>
          void handlePlayNeteaseTrackSelection(trackId, queueSongs, {
            sourcePlaylist,
          })
        }
        onStartIntelligenceMode={(sourcePlaylist, seedSong, queueSongs) => {
          void handleStartNeteaseIntelligenceMode(sourcePlaylist, seedSong, queueSongs);
        }}
        onOpenSongArtist={(artistId, artistName) => openExploreArtistView(artistId, artistName)}
        onOpenSongAlbum={(albumId, albumName) => openExploreAlbumView(albumId, albumName)}
        onSongContextMenu={handleNeteaseSongContextMenu}
        onPlaylistContextMenu={handlePlaylistContextMenu}
        onCreatePlaylist={openCreatePlaylistEditor}
        onEditPlaylist={openEditPlaylistEditor}
      />
    ) : activeNav === "favorites" ? (
      <LikedSongsScreen
        copy={copy}
        settings={settings}
        dataVersion={neteaseUiVersion}
        onPlayNeteaseTrack={(trackId, queueSongs, sourcePlaylist) =>
          void handlePlayNeteaseTrackSelection(trackId, queueSongs, {
            sourcePlaylist,
          })
        }
        onStartIntelligenceMode={(sourcePlaylist, seedSong, queueSongs) => {
          void handleStartNeteaseIntelligenceMode(sourcePlaylist, seedSong, queueSongs);
        }}
        onOpenSongArtist={(artistId, artistName) => openExploreArtistView(artistId, artistName)}
        onOpenSongAlbum={(albumId, albumName) => openExploreAlbumView(albumId, albumName)}
        onSongContextMenu={handleNeteaseSongContextMenu}
        onPlaylistContextMenu={handlePlaylistContextMenu}
      />
    ) : activeNav === "tools" ? (
      toolsView === "kugouImport" ? (
        <KugouImportScreen
          copy={copy}
          settings={settings}
          playlists={toolOwnedPlaylists}
          isLoadingPlaylists={isToolPlaylistsLoading}
          selectedPlaylistId={selectedKugouImportPlaylistId}
          fileName={kugouImportFileName}
          parsedTracks={kugouImportTracks}
          logs={kugouImportLogs}
          progress={kugouImportProgress}
          phase={kugouImportPhase}
          isImporting={isImportingKugouPlaylist}
          retryingTrackIndex={retryingKugouImportTrackIndex}
          errorRetryCount={kugouImportErrorRetryCount}
          unresolvedRetryCount={kugouImportUnresolvedRetryCount}
          timeoutMs={kugouImportTimeoutMs}
          concurrency={kugouImportConcurrency}
          matchStrictness={kugouImportMatchStrictness}
          onSelectPlaylist={setSelectedKugouImportPlaylistId}
          onSelectFile={(file) => void handleLoadKugouImportFile(file)}
          onImport={() => void handleImportKugouPlaylist()}
          onBack={() => setToolsView("hub")}
          onChangeErrorRetryCount={setKugouImportErrorRetryCount}
          onChangeUnresolvedRetryCount={setKugouImportUnresolvedRetryCount}
          onChangeTimeoutMs={setKugouImportTimeoutMs}
          onChangeConcurrency={setKugouImportConcurrency}
          onChangeMatchStrictness={setKugouImportMatchStrictness}
          onRetryEntry={(entry) => void handleRetrySingleKugouImportTrack(entry)}
        />
      ) : (
        <ToolsScreen copy={copy} onOpenKugouImport={() => setToolsView("kugouImport")} />
      )
    ) : activeNav === "library" ? (
      <LibraryScreen
        copy={copy}
        settings={settings}
        mediaLibrary={mediaLibrary}
        scanDirectories={settings.library.scanDirectories}
        showAlbumArtwork={settings.appearance.showAlbumArtwork}
        activeTrackId={currentTrackId}
        isLoading={isLibraryLoading}
        isImporting={isImportingLibrary}
        isDeletingTracks={isDeletingLibraryTracks}
        view={libraryView}
        selectedArtist={librarySelectedArtist}
        selectedAlbum={librarySelectedAlbum}
        selectedArtistDetail={librarySelectedArtistDetail}
        selectedAlbumDetail={librarySelectedAlbumDetail}
        onChangeView={setLibraryView}
        onChangeSelectedArtist={setLibrarySelectedArtist}
        onChangeSelectedAlbum={setLibrarySelectedAlbum}
        onChangeSelectedArtistDetail={setLibrarySelectedArtistDetail}
        onChangeSelectedAlbumDetail={setLibrarySelectedAlbumDetail}
        navigationRequest={libraryNavigationRequest}
        onConsumeNavigationRequest={() => setLibraryNavigationRequest(null)}
        onImportAudioFiles={() => void handleImportAudioFiles()}
        onImportAudioDirectory={() => void handleImportAudioDirectory()}
        onDeleteTracks={(trackIds) => void handleDeleteLibraryTracks(trackIds)}
        onPlayTrack={playTrackSelection}
        onOpenTrackArtist={(track) => void handleOpenTrackArtist(track)}
        onOpenTrackAlbum={(track) => void handleOpenTrackAlbum(track)}
        onTrackContextMenu={handleTrackContextMenu}
      />
    ) : activeNav === "explore" ? (
      <ExploreScreen
        locale={copy.locale}
        settings={settings}
        externalDetailRequest={exploreDetailRequest}
        externalBackLabel={
          exploreReturnSnapshot ? getPlaylistBackLabel(copy.locale, exploreReturnSnapshot) : null
        }
        onConsumeExternalDetailRequest={() => setExploreDetailRequest(null)}
        onReturnFromExternalDetail={handleBackFromExploreDetail}
        onOpenPlaylist={handleOpenPlaylist}
        onPlayNeteaseTrack={(trackId, queueSongs) =>
          void handlePlayNeteaseTrackSelection(trackId, queueSongs)
        }
        onSongContextMenu={handleNeteaseSongContextMenu}
        onPlaylistContextMenu={handlePlaylistContextMenu}
      />
    ) : (
      <section className="workspace-placeholder">
        <div className="workspace-placeholder__eyebrow">
          {navItems.find((item) => item.id === activeNav)?.label ?? copy.placeholder.title}
        </div>
        <h2 className="workspace-placeholder__title">{copy.placeholder.title}</h2>
        <p className="workspace-placeholder__body">{copy.placeholder.body}</p>
      </section>
    );

  const immersiveWallpaperHeaderButton = (
    <button
      className={[
        "immersive-player__chrome-button",
        "immersive-player__chrome-button--wallpaper",
        isWallpaperModeEnabled ? "immersive-player__chrome-button--wallpaper-active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      type="button"
      aria-label={
        isWallpaperModeEnabled
          ? localeStrings.window.disableWallpaper
          : localeStrings.window.enableWallpaper
      }
      title={
        isWallpaperModeEnabled
          ? immersivePlayerCopy.disableWallpaper
          : immersivePlayerCopy.enableWallpaper
      }
      onMouseDown={(event) => {
        event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        void handleToggleImmersiveWallpaperMode();
      }}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2.5" y="3.5" width="11" height="6.75" rx="1.2" />
        <path d="M6.25 12.25h3.5" />
        <path d="M8 10.35v1.9" />
        <path d="M5.75 5.45v2.5" />
        <path d="M5.75 5.45l3-.55v2.15" />
        <path d="M5.75 7.95a.85.85 0 11-.85-.85.85.85 0 01.85.85z" />
        <path d="M8.75 7.4a.85.85 0 11-.85-.85.85.85 0 01.85.85z" />
      </svg>
    </button>
  );

  return (
    <div
      className={[
        "app-shell",
        `app-shell--theme-${settings.appearance.themeMode}`,
        `app-shell--scheme-${settings.appearance.colorScheme}`,
        settings.appearance.useCompactMode ? "app-shell--compact" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={themeStyle}
      onContextMenu={handleWorkspaceContextMenu}
    >
      {appGreetingPhase !== "hidden" ? (
        <div
          className={[
            "app-greeting",
            `app-greeting--${appGreetingPhase}`,
          ].join(" ")}
          aria-hidden="true"
        >
          <div className="app-greeting__mark">
            <span className="app-greeting__line app-greeting__line--primary">CELIA MUSIC</span>
            <span className="app-greeting__line app-greeting__line--secondary">NEXT GEN</span>
          </div>
        </div>
      ) : null}
      <div className="app-shell__surface">
        {effectiveBackgroundVideoSrc ? (
          <video
            ref={backgroundVideoRef}
            key={effectiveBackgroundVideoSrc}
            className="app-shell__background-video"
            src={effectiveBackgroundVideoSrc}
            autoPlay
            muted
            loop={!appBackgroundMvVideoSrc}
            playsInline
            preload="auto"
            aria-hidden="true"
            onLoadedMetadata={() => {
              if (appBackgroundMvVideoSrc) {
                syncBackgroundMvPosition(backgroundVideoRef.current, true);
              }
            }}
          />
        ) : null}
        <div className="titlebar">
          <div
            className="titlebar__drag"
            data-tauri-drag-region={isFullscreen ? undefined : "true"}
            onDoubleClick={(event) => {
              if (event.target instanceof HTMLElement && event.target.closest(".window-controls")) {
                return;
              }

              void handleToggleMaximize();
            }}
          >
            <span className="titlebar__brand">
              <span className="titlebar__label">Celia Music Next Gen</span>
              <span className="titlebar__icon" aria-hidden="true">
                <img src={playerIcon} alt="" />
              </span>
            </span>
          </div>

          <div className="window-controls" aria-label={localeStrings.window.controls}>
            <button
              className="window-controls__button window-controls__button--minimize"
              type="button"
              aria-label={localeStrings.window.minimize}
              onMouseDown={(event) => {
                event.stopPropagation();
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                void handleMinimize();
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path className="chrome-icon__minimize-line" d="M4 8.5h8" />
              </svg>
            </button>
            <button
              className={[
                "window-controls__button",
                "window-controls__button--fullscreen",
                isFullscreen ? "window-controls__button--fullscreen-active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              type="button"
              aria-label={isFullscreen ? localeStrings.window.exitFullscreen : localeStrings.window.fullscreen}
              onMouseDown={(event) => {
                event.stopPropagation();
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                void handleToggleFullscreen();
              }}
            >
              {isFullscreen ? (
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path className="chrome-icon__fs-corner chrome-icon__fs-corner--tl" d="M6.25 3.75H3.75v2.5" />
                  <path className="chrome-icon__fs-corner chrome-icon__fs-corner--tr" d="M9.75 3.75h2.5v2.5" />
                  <path className="chrome-icon__fs-corner chrome-icon__fs-corner--br" d="M12.25 9.75v2.5h-2.5" />
                  <path className="chrome-icon__fs-corner chrome-icon__fs-corner--bl" d="M3.75 9.75v2.5h2.5" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path className="chrome-icon__fs-corner chrome-icon__fs-corner--tl" d="M6.25 3.75H3.75v2.5" />
                  <path className="chrome-icon__fs-corner chrome-icon__fs-corner--tr" d="M9.75 3.75h2.5v2.5" />
                  <path className="chrome-icon__fs-corner chrome-icon__fs-corner--br" d="M12.25 9.75v2.5h-2.5" />
                  <path className="chrome-icon__fs-corner chrome-icon__fs-corner--bl" d="M3.75 9.75v2.5h2.5" />
                  <path className="chrome-icon__fs-ray chrome-icon__fs-ray--tl" d="M6.1 5.9L3.8 3.8" />
                  <path className="chrome-icon__fs-ray chrome-icon__fs-ray--tr" d="M9.9 5.9l2.3-2.1" />
                  <path className="chrome-icon__fs-ray chrome-icon__fs-ray--br" d="M9.9 10.1l2.3 2.1" />
                  <path className="chrome-icon__fs-ray chrome-icon__fs-ray--bl" d="M6.1 10.1l-2.3 2.1" />
                </svg>
              )}
            </button>
            <button
              className={[
                "window-controls__button",
                "window-controls__button--maximize",
                isMaximized ? "window-controls__button--maximize-active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              type="button"
              aria-label={isMaximized ? localeStrings.window.restore : localeStrings.window.maximize}
              onMouseDown={(event) => {
                event.stopPropagation();
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                void handleToggleMaximize();
              }}
            >
              {isMaximized ? (
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path className="chrome-icon__restore-back" d="M6 4.75h5.25V10" />
                  <path className="chrome-icon__restore-front" d="M4.75 6h5.25v5.25H4.75z" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path className="chrome-icon__maximize-frame" d="M4 4h8v8H4z" />
                  <path className="chrome-icon__maximize-top" d="M4 5.35h8" />
                </svg>
              )}
            </button>
            <button
              className="window-controls__button window-controls__button--close"
              type="button"
              aria-label={localeStrings.window.close}
              onMouseDown={(event) => {
                event.stopPropagation();
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                void handleClose();
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path className="chrome-icon__close-line chrome-icon__close-line--a" d="M5 5l6 6" />
                <path className="chrome-icon__close-line chrome-icon__close-line--b" d="M11 5l-6 6" />
              </svg>
            </button>
          </div>
        </div>

        <aside className="sidebar">
          <nav
            className="sidebar__nav"
            aria-label={copy.locale === "en-US" ? "Main Navigation" : "主导航"}
            style={
              {
                "--sidebar-active-index": activeNavIndex,
              } as CSSProperties
            }
          >
            {activeNavIndex >= 0 ? <span className="sidebar__indicator" aria-hidden="true" /> : null}
            {navItems.map((item) => (
              <button
                key={item.id}
                className={[
                  "nav-chip",
                  item.id === activeNav ? "nav-chip--active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                type="button"
                onClick={() => {
                  setPlaylistReturnSnapshot(null);
                  setExploreReturnSnapshot(null);
                  setActiveNav(item.id);
                  if (item.id === "playlist") {
                    setSelectedPlaylist(null);
                  }
                  if (item.id === "tools") {
                    setToolsView("hub");
                  }
                }}
              >
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main
          className="workspace"
          style={
            {
              "--dynamic-island-clearance": settings.appearance.showDynamicIsland ? undefined : "0px",
              paddingTop: settings.appearance.showDynamicIsland ? undefined : "8px",
            } as CSSProperties
          }
        >
          {settings.appearance.showDynamicIsland ? (
            <DynamicIsland
              currentTimeLabel={currentTimeLabel}
              detailedTimeLabel={detailedTimeLabel}
              lyricLine={dynamicIslandLyricLine}
              notification={dynamicIslandNotification}
              notificationPhase={dynamicIslandNotificationPhase}
              importProgress={dynamicIslandImportProgress}
              styleVariant={settings.appearance.dynamicIslandStyle}
              colorMode={settings.appearance.dynamicIslandColorMode}
              position={settings.appearance.dynamicIslandPosition}
            />
          ) : dynamicIslandNotification ? (
            <WorkspaceNotification
              message={dynamicIslandNotification.message}
              phase={dynamicIslandNotificationPhase}
            />
          ) : null}

          <div className="workspace__canvas">
            <div key={workspaceTransitionKey} className="workspace__page">
              {workspaceScreen}
            </div>
          </div>
        </main>

        {isImmersivePlayerMounted ? (
          <ImmersivePlayerOverlay
            isOpen={isImmersivePlayerVisible}
            isWindowVisible={isWindowVisibleForUi}
            trackId={playbarDisplayTrack?.id ?? null}
            artworkUrl={activeTrackArtworkUrl}
            palette={activeImmersivePalette}
            appearanceSettings={settings.appearance}
            appBackgroundImageStyle={followAppBackgroundImageStyle}
            appBackgroundVideoSrc={followAppBackgroundVideoSrc}
            appBackgroundVideoLoop={followAppBackgroundVideoLoop}
            immersiveBackgroundVideoSrc={immersiveBackgroundMvVideoSrc}
            appBackgroundOpacity={immersiveAppBackgroundOpacity}
            appBackgroundBlurPx={immersiveAppBackgroundBlurPx}
            appBackgroundDimOpacity={immersiveAppBackgroundDimOpacity}
            copy={immersivePlayerCopy}
            trackTitle={playbarTrackTitle}
            trackArtist={playbarTrackArtist}
            trackAlbum={playbarDisplayTrack?.album?.trim() || null}
            hasTrackArtist={Boolean(playbarDisplayTrack?.artist?.trim())}
            progress={progress}
            currentTimeSeconds={currentTimeSeconds}
            elapsedLabel={formatTimeLabel(elapsedTrackSeconds)}
            totalLabel={formatTimeLabel(totalTrackSeconds)}
            isAutoMixTransitionActive={autoMixBadgePhase !== "hidden"}
            autoMixBadgePhase={autoMixBadgePhase}
            isPlaying={isPlaying}
            isPlaybackLoading={isPlaybackLoading}
            lyrics={currentTrackLyrics}
            isLyricsLoading={isCurrentTrackLyricsLoading}
            currentLyricsTimeMs={currentTrackLyricsTimeMs}
            activeLyricLineIndex={activeLyricLineIndex}
            lyricsSettings={settings.lyrics}
            volume={volume}
            canSkipPrevious={canSkipPrevious}
            canSkipNext={canSkipNext}
            playbackMode={playbackMode}
            playbackModeText={playbackModeDisplayText}
            isPlaybackModeLocked={isOrderedPlaybackLockedQueue}
            volumeLabel={localeStrings.player.volumeLabel}
            isMaximized={isMaximized}
            isFullscreen={isFullscreen}
            displayMode="interactive"
            headerStartSlot={immersiveWallpaperHeaderButton}
            localeStrings={localeStrings.window}
            onMinimize={handleMinimize}
            onToggleMaximize={handleToggleMaximize}
            onToggleFullscreen={handleToggleFullscreen}
            onCloseWindow={handleClose}
            onStartDragging={handleStartDragging}
            onTogglePlayback={handleTogglePlayback}
            onSkipPrevious={() => handleSkipToAdjacentTrack(-1)}
            onSkipNext={() => handleSkipToAdjacentTrack(1)}
            onCyclePlaybackMode={handleCyclePlaybackMode}
            onSeekStart={() => void handleSeekStart()}
            onSeek={handleSeek}
            onSeekEnd={() => void handleSeekEnd()}
            onLyricSeek={(timeMs) => {
              void handleSeekToLyricTimeMs(timeMs);
            }}
            onVolumeChange={handleVolumeChange}
            onOpenTrackArtist={
              currentTrack
                ? (artistIndex, artistName) => {
                    syncImmersivePlayerOpen(false);
                    void handleOpenTrackArtistByIndex(currentTrack, artistIndex, artistName);
                  }
                : undefined
            }
            onOpenTrackAlbum={
              currentTrack?.album?.trim()
                ? () => {
                    syncImmersivePlayerOpen(false);
                    void handleOpenTrackAlbum(currentTrack);
                  }
                : undefined
            }
            onClose={() => syncImmersivePlayerOpen(false)}
          />
        ) : null}

        <div className="playbar-shell">
          <audio ref={primaryAudioRef} preload="metadata" />
          <audio ref={secondaryAudioRef} preload="metadata" />
          {autoMixBadgePhase !== "hidden" ? (
            <div
              id="playbar-automix-floating-badge"
              className={[
                "playbar__automix-floating-badge",
                `playbar__automix-floating-badge--${autoMixBadgePhase}`,
              ].join(" ")}
              aria-hidden="true"
            >
              <span className="playbar__automix-floating-badge-glow playbar__automix-floating-badge-glow--far">
                AutoMix
              </span>
              <span className="playbar__automix-floating-badge-glow playbar__automix-floating-badge-glow--mid">
                AutoMix
              </span>
              <span className="playbar__automix-floating-badge-glow playbar__automix-floating-badge-glow--near">
                AutoMix
              </span>
              <span className="playbar__automix-floating-badge-core">AutoMix</span>
            </div>
          ) : null}
          <PlaybarTimeline
            progress={progress}
            elapsedLabel={formatTimeLabel(elapsedTrackSeconds)}
            totalLabel={formatTimeLabel(totalTrackSeconds)}
            isAutoMixTransitionActive={autoMixBadgePhase !== "hidden"}
            lyricPreview={{
              enabled: settings.lyrics.progressBarPreview,
              durationSeconds: effectiveDurationSeconds,
              lines: currentTrackLyricsLines,
              lyricsOffsetMs: displayTrackLyricsOffsetMs,
              delayMs: settings.lyrics.delayMs ?? 0,
            }}
            onSeekStart={() => void handleSeekStart()}
            onChange={handleSeek}
            onSeekEnd={() => void handleSeekEnd()}
          />

          <footer className="playbar">
            <div className="playbar__track">
              {currentTrack ? (
                <button
                  className="playbar__thumb-button"
                  type="button"
                  aria-label={immersivePlayerCopy.open}
                  onClick={handleOpenImmersivePlayer}
                >
                  <div
                    className={[
                      "playbar__thumb",
                      isPlaybackLoading ? "playbar__thumb--loading" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-hidden="true"
                    >
                      {activeTrackArtworkUrl ? (
                        <img src={activeTrackArtworkUrl} alt="" />
                      ) : (
                        <span className="playbar__thumb-fallback">
                          <SongsTileIcon />
                        </span>
                      )}
                      <span className="playbar__thumb-overlay" aria-hidden="true">
                        <OpenImmersiveHintIcon />
                      </span>
                      {isPlaybackLoading ? <span className="playbar__loading-indicator" /> : null}
                    </div>
                </button>
              ) : (
                <div className="playbar__thumb" aria-hidden="true">
                  <span className="playbar__thumb-fallback">
                    <SongsTileIcon />
                  </span>
                </div>
              )}
              <div
                key={playbarMetaAnimationKey}
                className="playbar__meta playbar__meta--animated"
                aria-live="polite"
              >
                <strong>{playbarTrackTitle}</strong>
                <p
                  className={isPlaybackLoading || isRestoringPlaybackState ? "playbar__meta-status" : undefined}
                >
                  {isRestoringPlaybackState ? (
                    localeStrings.player.restoringPlayback
                  ) : isPlaybackLoading && playbarDisplayTrack ? (
                    localeStrings.player.loadingTrack
                  ) : playbarDisplayTrack ? (
                    <>
                      <SongArtistLinks
                        fallback={playbarTrackArtist}
                        artists={playbarTrackArtists.map((artistName, artistIndex) => ({
                          key: `${playbarDisplayTrack.id}:playbar-artist:${artistName}:${artistIndex}`,
                          name: artistName,
                          onClick: () =>
                            void handleOpenTrackArtistByIndex(
                              playbarDisplayTrack,
                              artistIndex,
                              artistName,
                            ),
                        }))}
                      />
                      {playbarDisplayTrack.album?.trim() ? (
                        <>
                          <span className="song-meta-links__separator">·</span>
                          <SongMetaButton
                            className="playbar__meta-button"
                            label={playbarDisplayTrack.album}
                            onClick={() => void handleOpenTrackAlbum(playbarDisplayTrack)}
                          />
                        </>
                      ) : null}
                    </>
                  ) : (
                    playbarTrackArtist
                  )}
                </p>
              </div>
            </div>

            <div className="playbar__controls" aria-label={localeStrings.player.controls}>
              <div className="playbar__controls-row">
                <button
                  className="playbar__control-button"
                  type="button"
                  aria-label={copy.player.prev}
                  onClick={() => void handleSkipToAdjacentTrack(-1)}
                  disabled={!canSkipPrevious}
                >
                  <PreviousSmallIcon />
                </button>
                <button
                  className="playbar__control-button playbar__play"
                  type="button"
                  aria-label={isPlaying ? copy.player.pause : copy.player.play}
                  onClick={() => void handleTogglePlayback()}
                  disabled={isPlaybackLoading}
                >
                  <PlayPauseAnimatedIcon isPlaying={isPlaying} />
                </button>
                <button
                  className="playbar__control-button"
                  type="button"
                  aria-label={copy.player.next}
                  onClick={() => void handleSkipToAdjacentTrack(1)}
                  disabled={!canSkipNext}
                >
                  <NextSmallIcon />
                </button>
              </div>
            </div>

            <div className="playbar__actions" aria-label={localeStrings.player.actions}>
              <span className="playbar__status">{volume}%</span>
              <div className="playbar__volume" ref={volumePopoverRef}>
                {isVolumePopoverOpen ? (
                  <div className="playbar__volume-popover">
                    <UISlider
                      label={localeStrings.player.volumeLabel}
                      value={volume}
                      onChange={handleVolumeChange}
                    />
                  </div>
                ) : null}
                <button
                  className={[
                    "playbar__action-button",
                    isVolumePopoverOpen ? "playbar__action-button--active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  type="button"
                  aria-label={copy.player.volume}
                  aria-expanded={isVolumePopoverOpen}
                  onClick={() => {
                    setIsQueuePopoverOpen(false);
                    setIsVolumePopoverOpen((current) => !current);
                  }}
                >
                  <VolumeAnimatedIcon volume={volume} />
                </button>
              </div>
              <button
                className="playbar__action-button"
                type="button"
                aria-label={playbackModeDisplayText}
                title={playbackModeDisplayText}
                onClick={handleCyclePlaybackMode}
                disabled={isOrderedPlaybackLockedQueue}
              >
                <PlaybackModeIcon mode={playbackMode} />
              </button>
              <div className="playbar__queue" ref={queuePopoverRef}>
                {isQueuePopoverOpen ? (
                  <div className="playbar__queue-popover">
                    <div className="playbar__queue-popover-header">
                      <div className="playbar__queue-popover-heading">
                        <strong>{playbarQueueCopy.title}</strong>
                      </div>
                      {playbackQueueSourcePlaylist ? (
                        <button
                          className="playbar__queue-popover-link"
                          type="button"
                          onClick={handleOpenQueueSourcePlaylist}
                        >
                          <QueueOpenPlaylistIcon />
                          <span>{playbarQueueCopy.openSourcePlaylist}</span>
                        </button>
                      ) : null}
                    </div>
                    {currentQueueTracks.length === 0 ? (
                      <p className="playbar__queue-empty">{playbarQueueCopy.empty}</p>
                    ) : (
                      <div className="playbar__queue-list" ref={queueListRef}>
                        {currentQueueTracks.map((track, index) => {
                          const isCurrentTrack = track.id === currentTrackId;
                          const queuePosition = currentQueueIds.indexOf(track.id);
                          const displaySequence =
                            queueDraggingTrackId === track.id && resolvedQueueDropIndex !== null
                              ? resolvedQueueDropIndex + 1
                              : queuePosition >= 0
                                ? queuePosition + 1
                                : index + 1;
                          const isDraggingQueueItem = queueDraggingTrackId === track.id;
                          const queueItemStyle = buildQueueItemDragStyle(track.id);

                          return (
                            <div key={`${track.id}-${index}`}>
                              <div
                                ref={(node) => registerQueueItemRef(track.id, node)}
                                className={[
                                  "playbar__queue-item",
                                  isCurrentTrack ? "playbar__queue-item--active" : "",
                                  isDraggingQueueItem ? "playbar__queue-item--dragging" : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                style={queueItemStyle}
                              >
                              <button
                                className="playbar__queue-drag"
                                type="button"
                                aria-label={playbarQueueCopy.reorder}
                                title={playbarQueueCopy.reorder}
                                onClick={(event) => event.preventDefault()}
                                onPointerDown={(event) => handleQueueDragPointerDown(event, track.id)}
                              >
                                <span className="playbar__queue-sequence">
                                  {displaySequence}
                                </span>
                              </button>
                              <button
                                className="playbar__queue-main"
                                type="button"
                                onClick={() => {
                                  pauseActiveTrackForTransition();
                                  void requestPreparedPlayback(track.id, currentQueueIds, {
                                    autoplay: true,
                                    announceNotice: false,
                                  });
                                }}
                              >
                                <span className="playbar__queue-copy">
                                  <strong>{track.title}</strong>
                                  <span>
                                    {track.artist?.trim() || localeStrings.player.idleArtist}
                                    {" · "}
                                    {track.source.kind === "localFile"
                                      ? playbarQueueCopy.sourceLocal
                                      : playbarQueueCopy.sourceOnline}
                                  </span>
                                </span>
                                {isCurrentTrack ? (
                                  <span className="playbar__queue-badge">
                                    {playbarQueueCopy.current}
                                  </span>
                                ) : null}
                              </button>
                              <div className="playbar__queue-actions">
                                <button
                                  className="playbar__queue-action"
                                  type="button"
                                  aria-label={playbarQueueCopy.moveUp}
                                  title={playbarQueueCopy.moveUp}
                                  onClick={() => handleMoveQueueTrack(track.id, -1)}
                                  disabled={queuePosition <= 0}
                                >
                                  <QueueMoveUpIcon />
                                </button>
                                <button
                                  className="playbar__queue-action"
                                  type="button"
                                  aria-label={playbarQueueCopy.moveDown}
                                  title={playbarQueueCopy.moveDown}
                                  onClick={() => handleMoveQueueTrack(track.id, 1)}
                                  disabled={queuePosition >= currentQueueTracks.length - 1}
                                >
                                  <QueueMoveDownIcon />
                                </button>
                                <button
                                  className="playbar__queue-action"
                                  type="button"
                                  aria-label={playbarQueueCopy.remove}
                                  title={playbarQueueCopy.remove}
                                  onClick={() => handleRemoveQueueTrack(track.id)}
                                >
                                  <QueueRemoveIcon />
                                </button>
                              </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}
                <button
                  className={[
                    "playbar__action-button",
                    isQueuePopoverOpen ? "playbar__action-button--active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  type="button"
                  aria-label={copy.player.queue}
                  aria-expanded={isQueuePopoverOpen}
                  onClick={() => {
                    setIsVolumePopoverOpen(false);
                    setIsQueuePopoverOpen((current) => !current);
                  }}
                >
                  <QueueSmallIcon />
                </button>
              </div>
            </div>
          </footer>
        </div>
        {contextMenuState ? (
          <AppContextMenu
            x={contextMenuState.x}
            y={contextMenuState.y}
            items={contextMenuItems}
            submenuLabel={contextMenuCopy.submenuArrow}
            isClosing={isContextMenuClosing}
            onClose={closeContextMenu}
          />
        ) : null}
        {playlistEditorState ? (
          <PlaylistEditorDialog
            state={playlistEditorState}
            copy={playlistEditorCopy}
            isClosing={isPlaylistEditorClosing}
            isSubmitting={isSubmittingPlaylistEditor}
            onClose={closePlaylistEditor}
            onSubmit={handleSubmitPlaylistEditor}
          />
        ) : null}
        {kugouManualRetryState ? (
          <KugouManualRetryDialog
            state={kugouManualRetryState}
            copy={getKugouImportCopy(copy.locale)}
            isClosing={isKugouManualRetryClosing}
            isSubmitting={isSubmittingKugouManualRetry}
            settings={settings}
            onClose={closeKugouManualRetryDialog}
            onSubmit={(candidate, query) =>
              handleSubmitKugouManualRetry(kugouManualRetryState, candidate, query)
            }
          />
        ) : null}
      </div>
    </div>
  );
}

function KugouManualRetryDialog({
  state,
  copy,
  isClosing,
  isSubmitting,
  settings,
  onClose,
  onSubmit,
}: {
  state: KugouManualRetryState;
  copy: ReturnType<typeof getKugouImportCopy>;
  isClosing: boolean;
  isSubmitting: boolean;
  settings: AppSettings;
  onClose: () => void;
  onSubmit: (candidate: NeteaseSongSearchResult, query: string) => Promise<void>;
}) {
  const buildInitialQuery = (sourceTrack: ParsedKugouPlaylistTrack) =>
    [sourceTrack.title, sourceTrack.artists.join(" ")]
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
  const [query, setQuery] = useState(() => buildInitialQuery(state.sourceTrack));
  const [results, setResults] = useState<NeteaseSongSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const searchRequestIdRef = useRef(0);

  const runSearch = async (keywords: string) => {
    const normalizedKeywords = keywords.trim();
    if (!normalizedKeywords) {
      searchRequestIdRef.current += 1;
      setIsSearching(false);
      setResults([]);
      setHasSearched(false);
      return;
    }

    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    setIsSearching(true);
    setHasSearched(true);

    try {
      const searchResults = await searchNeteaseSongs(settings, normalizedKeywords, {
        limit: 12,
      });
      if (searchRequestIdRef.current === requestId) {
        setResults(searchResults);
      }
    } catch (error) {
      console.error("[kugou-import] failed to search manual retry candidates", error);
      if (searchRequestIdRef.current === requestId) {
        setResults([]);
      }
    } finally {
      if (searchRequestIdRef.current === requestId) {
        setIsSearching(false);
      }
    }
  };

  useEffect(() => {
    const initialQuery = buildInitialQuery(state.sourceTrack);
    setQuery(initialQuery);
    setResults([]);
    setHasSearched(false);
    void runSearch(initialQuery);
  }, [state]);

  const sourceArtistsLabel =
    state.sourceTrack.artists.join(" / ") || copy.previewArtistsFallback;

  return createPortal(
    <div
      className={[
        "kugou-manual-retry-backdrop",
        isClosing ? "kugou-manual-retry-backdrop--closing" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <section
        className={[
          "kugou-manual-retry",
          isClosing ? "kugou-manual-retry--closing" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        role="dialog"
        aria-modal="true"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="kugou-manual-retry__header">
          <div className="kugou-manual-retry__copy">
            <p className="kugou-manual-retry__eyebrow">{copy.manualRetryTitle}</p>
            <h3 className="kugou-manual-retry__title">{state.sourceTrack.title}</h3>
          </div>
          <div className="kugou-manual-retry__actions">
            <UIButton variant="secondary" size="sm" onClick={onClose} disabled={isSubmitting}>
              {copy.manualRetryCancel}
            </UIButton>
          </div>
        </div>

        <div className="kugou-manual-retry__content">
          <section className="kugou-manual-retry__source-panel">
            <div className="kugou-manual-retry__panel-header">
              <span className="kugou-manual-retry__panel-label">{copy.manualRetrySource}</span>
            </div>
            <div className="kugou-manual-retry__source-brief">
              <strong title={state.sourceTrack.title}>{state.sourceTrack.title}</strong>
              <span title={sourceArtistsLabel}>{sourceArtistsLabel}</span>
            </div>
          </section>

          <section className="kugou-manual-retry__search-panel">
            <div className="kugou-manual-retry__search-row">
              <label className="ui-field kugou-manual-retry__field">
                <span className="ui-field__label">{copy.manualRetryKeywordsLabel}</span>
                <span className="ui-input-shell kugou-manual-retry__search-shell">
                  <span className="ui-input-shell__prefix">
                    <SearchIcon />
                  </span>
                  <input
                    type="text"
                    value={query}
                    placeholder={copy.manualRetryKeywordsPlaceholder}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !isSearching) {
                        event.preventDefault();
                        void runSearch(query);
                      }
                    }}
                  />
                </span>
              </label>
              <UIButton
                variant="primary"
                size="sm"
                className="kugou-manual-retry__search-action"
                onClick={() => void runSearch(query)}
                disabled={isSearching || isSubmitting || query.trim().length === 0}
              >
                {isSearching ? copy.manualRetrySearching : copy.manualRetrySearchAction}
              </UIButton>
            </div>
          </section>

          <section className="kugou-manual-retry__results-panel">
            <div className="kugou-manual-retry__results-header">
              <span className="kugou-manual-retry__panel-label">{copy.manualRetryResults}</span>
              <span className="kugou-manual-retry__results-count">
                {isSearching
                  ? copy.manualRetrySearching
                  : settings.appearance.language === "en-US"
                    ? `${results.length} results`
                    : `${results.length} 条结果`}
              </span>
            </div>

            {isSearching ? (
              <div className="kugou-manual-retry__state">
                <UILoadingBlock label={copy.manualRetrySearching} variant="inline" />
              </div>
            ) : results.length > 0 ? (
              <div className="kugou-manual-retry__results-list">
                {results.map((candidate) => {
                  const candidateArtists =
                    candidate.artists.join(" / ") || copy.previewArtistsFallback;

                  return (
                    <div
                      key={`kugou-manual-result:${candidate.id}`}
                      className="kugou-manual-retry__result"
                    >
                      <div className="kugou-manual-retry__result-main">
                        <strong className="kugou-manual-retry__result-title" title={candidate.name}>
                          {candidate.name}
                        </strong>
                        <div
                          className="kugou-manual-retry__result-artists"
                          title={candidateArtists}
                        >
                          {candidateArtists}
                        </div>
                      </div>
                      <UIButton
                        variant="primary"
                        size="sm"
                        className="kugou-manual-retry__add-action"
                        onClick={() => void onSubmit(candidate, query)}
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? copy.manualRetryAdding : copy.manualRetryAddAction}
                      </UIButton>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="kugou-manual-retry__state">
                <p className="kugou-manual-retry__state-copy">
                  {hasSearched ? copy.manualRetryNoResults : copy.manualRetryEmpty}
                </p>
              </div>
            )}
          </section>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function AppContextMenu({
  x,
  y,
  items,
  submenuLabel,
  isClosing,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItemDefinition[];
  submenuLabel: string;
  isClosing: boolean;
  onClose: () => void;
}) {
  const margin = 12;
  const estimatedMenuWidth = 212;
  const estimatedMenuItemHeight = 38;
  const menuStyle: CSSProperties = {
    left: Math.min(
      Math.max(margin, x),
      Math.max(margin, window.innerWidth - estimatedMenuWidth - margin),
    ),
    top: Math.min(
      Math.max(margin, y),
      Math.max(
        margin,
        window.innerHeight - items.length * estimatedMenuItemHeight - margin - 12,
      ),
    ),
  };
  const [activeSubmenu, setActiveSubmenu] = useState<{
    id: string;
    style: CSSProperties;
  } | null>(null);

  const activeSubmenuItem =
    activeSubmenu === null
      ? null
      : items.find(
          (item) =>
            item.id === activeSubmenu.id && item.submenu && item.submenu.length > 0,
        ) ?? null;

  return (
    <>
      <div
        className={[
          "app-context-menu",
          isClosing ? "app-context-menu--closing" : "app-context-menu--open",
        ]
          .filter(Boolean)
          .join(" ")}
        style={menuStyle}
        onContextMenu={(event) => event.preventDefault()}
      >
        {items.map((item) => {
          const hasSubmenu = Boolean(item.submenu && item.submenu.length > 0);

          return (
            <button
              key={item.id}
              data-context-menu-anchor={item.id}
              className={[
                "app-context-menu__item",
                item.danger ? "app-context-menu__item--danger" : "",
                activeSubmenu?.id === item.id ? "app-context-menu__item--active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              type="button"
              disabled={item.disabled}
              onMouseEnter={(event) => {
                if (!hasSubmenu || !item.submenu) {
                  setActiveSubmenu(null);
                  return;
                }

                const rect = event.currentTarget.getBoundingClientRect();
                const estimatedSubmenuWidth = 232;
                const estimatedSubmenuHeight =
                  item.submenu.length * estimatedMenuItemHeight + 12;
                const nextLeft =
                  rect.right + estimatedSubmenuWidth + 8 <= window.innerWidth - margin
                    ? rect.right + 8
                    : Math.max(margin, rect.left - estimatedSubmenuWidth - 8);
                const nextTop = Math.min(
                  Math.max(margin, rect.top - 4),
                  Math.max(margin, window.innerHeight - estimatedSubmenuHeight - margin),
                );

                setActiveSubmenu((current) =>
                  current &&
                  current.id === item.id &&
                  current.style.left === nextLeft &&
                  current.style.top === nextTop
                    ? current
                    : {
                        id: item.id,
                        style: {
                          left: nextLeft,
                          top: nextTop,
                        },
                      },
                );
              }}
              onClick={() => {
                if (hasSubmenu || item.disabled || !item.onSelect) {
                  return;
                }

                item.onSelect();
                onClose();
              }}
            >
              <span className="app-context-menu__item-main">
                {item.artworkUrl !== undefined ? (
                  <span className="app-context-menu__item-artwork" aria-hidden="true">
                    {item.artworkUrl ? <img src={item.artworkUrl} alt="" loading="lazy" /> : <AlbumsTileIcon />}
                  </span>
                ) : null}
                <span className="app-context-menu__item-label">{item.label}</span>
              </span>
              {hasSubmenu ? (
                <span className="app-context-menu__arrow" aria-label={submenuLabel}>
                  <ContextMenuChevronIcon />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {activeSubmenuItem && activeSubmenuItem.submenu && activeSubmenu ? (
        <div
          className={[
            "app-context-menu",
            "app-context-menu--submenu",
            isClosing ? "app-context-menu--closing" : "app-context-menu--open",
            "app-context-menu--submenu-open",
          ]
            .filter(Boolean)
            .join(" ")}
          style={activeSubmenu.style}
          onMouseEnter={() => {
            setActiveSubmenu((current) => current);
          }}
          onMouseLeave={() => {
            setActiveSubmenu(null);
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          {activeSubmenuItem.submenu.map((item) => (
            <button
              key={item.id}
              className={[
                "app-context-menu__item",
                item.danger ? "app-context-menu__item--danger" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              type="button"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled || !item.onSelect) {
                  return;
                }

                item.onSelect();
                onClose();
              }}
            >
              <span className="app-context-menu__item-main">
                {item.artworkUrl !== undefined ? (
                  <span className="app-context-menu__item-artwork" aria-hidden="true">
                    {item.artworkUrl ? <img src={item.artworkUrl} alt="" loading="lazy" /> : <AlbumsTileIcon />}
                  </span>
                ) : null}
                <span className="app-context-menu__item-label">{item.label}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

function PlaylistEditorDialog({
  state,
  copy,
  isClosing,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  state: PlaylistEditorState;
  copy: ReturnType<typeof getPlaylistEditorCopy>;
  isClosing: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    mode: "create" | "edit";
    playlist: NeteasePlaylistRecommendation | null;
    name: string;
    description: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(state.mode === "edit" ? state.playlist.name : "");
  const [description, setDescription] = useState(
    state.mode === "edit" ? state.playlist.description ?? "" : "",
  );

  useEffect(() => {
    setName(state.mode === "edit" ? state.playlist.name : "");
    setDescription(state.mode === "edit" ? state.playlist.description ?? "" : "");
  }, [state]);

  return (
    <div
      className={[
        "playlist-editor-backdrop",
        isClosing ? "playlist-editor-backdrop--closing" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <section
        className={["playlist-editor", isClosing ? "playlist-editor--closing" : ""]
          .filter(Boolean)
          .join(" ")}
        role="dialog"
        aria-modal="true"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="playlist-editor__header">
          <div className="playlist-editor__copy">
            <p className="settings-screen__eyebrow">
              {state.mode === "create" ? copy.createTitle : copy.editTitle}
            </p>
            <h3 className="settings-card__title">
              {state.mode === "create" ? copy.create : copy.edit}
            </h3>
            <p className="settings-screen__description">
              {state.mode === "create" ? copy.createDescription : copy.editDescription}
            </p>
          </div>
        </div>
        <div className="playlist-editor__fields">
          <UITextField
            label={copy.nameLabel}
            placeholder={copy.namePlaceholder}
            value={name}
            onChange={setName}
          />
          <label className="ui-field">
            <span className="ui-field__label">{copy.descriptionLabel}</span>
            <span className="playlist-editor__textarea-shell">
              <textarea
                value={description}
                placeholder={copy.descriptionPlaceholder}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
              />
            </span>
          </label>
        </div>
        <div className="playlist-editor__actions">
          <UIButton
            type="button"
            variant="secondary"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }}
            disabled={isSubmitting}
          >
            {copy.cancel}
          </UIButton>
          <UIButton
            type="button"
            variant="primary"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void onSubmit({
                mode: state.mode,
                playlist: state.playlist,
                name,
                description,
              });
            }}
            disabled={isSubmitting}
          >
            {isSubmitting
              ? state.mode === "create"
                ? copy.submitCreate
                : copy.submitEdit
              : state.mode === "create"
                ? copy.submitCreate
                : copy.submitEdit}
          </UIButton>
        </div>
      </section>
    </div>
  );
}

function ShortcutKeyboardArrowIcon({
  direction,
}: {
  direction: "left" | "right" | "up" | "down";
}) {
  const transforms = {
    up: "rotate(0 8 8)",
    right: "rotate(90 8 8)",
    down: "rotate(180 8 8)",
    left: "rotate(-90 8 8)",
  } as const;

  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="shortcut-keyboard__arrow-icon">
      <path transform={transforms[direction]} d="M8 3.25l4.25 4.5H9.25v5H6.75v-5H3.75z" />
    </svg>
  );
}

function ShortcutKeyboardKeyLabel({ spec, locale }: { spec: ShortcutKeyboardKeySpec; locale: string }) {
  if (isShortcutArrowKey(spec.key)) {
    return (
      <ShortcutKeyboardArrowIcon
        direction={
          spec.key === "ArrowLeft"
            ? "left"
            : spec.key === "ArrowRight"
              ? "right"
              : spec.key === "ArrowDown"
                ? "down"
                : "up"
        }
      />
    );
  }

  return <span>{getShortcutKeyLabel(spec.key, locale)}</span>;
}

function renderShortcutKeyboardRow(
  row: ShortcutKeyboardKeySpec[],
  rowIndex: number,
  selectedKeys: string[],
  locale: string,
  onToggleKey: (key: string) => void,
  rowClassName?: string,
) {
  return (
    <div
      key={`keyboard-row-${rowIndex}`}
      className={["shortcut-keyboard__row", rowClassName].filter(Boolean).join(" ")}
    >
      {row.map((spec, keyIndex) => {
        const isActive = selectedKeys.includes(spec.key);
        return (
          <button
            key={`shortcut-key-${rowIndex}-${keyIndex}-${spec.key}`}
            type="button"
            className={[
              "shortcut-keyboard__key",
              `shortcut-keyboard__key--${spec.width ?? "sm"}`,
              isShortcutArrowKey(spec.key) ? "shortcut-keyboard__key--arrow" : "",
              isActive ? "shortcut-keyboard__key--active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => onToggleKey(spec.key)}
            aria-label={getShortcutKeyLabel(spec.key, locale)}
            title={getShortcutKeyLabel(spec.key, locale)}
          >
            <ShortcutKeyboardKeyLabel spec={spec} locale={locale} />
          </button>
        );
      })}
    </div>
  );
}

function ShortcutKeyboardDialog({
  copy,
  actionLabel,
  selectedKeys,
  isClosing,
  onToggleKey,
  onClear,
  onClose,
}: {
  copy: UiCopy;
  actionLabel: string;
  selectedKeys: string[];
  isClosing: boolean;
  onToggleKey: (key: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const shortcutCopy = copy.settings.sections.shortcuts;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      const normalizedKey = normalizeShortcutKeyValue(event.key);
      if (!normalizedKey) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (event.repeat) {
        return;
      }

      onToggleKey(normalizedKey);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className={[
        "shortcut-keyboard-dialog-backdrop",
        isClosing ? "shortcut-keyboard-dialog-backdrop--closing" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <section
        className={[
          "shortcut-keyboard-dialog",
          isClosing ? "shortcut-keyboard-dialog--closing" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        role="dialog"
        aria-modal="true"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="shortcut-keyboard-dialog__header">
          <div className="shortcut-keyboard-dialog__copy">
            <h3 className="settings-card__title">{shortcutCopy.dialogTitle}</h3>
            <p className="shortcut-keyboard-dialog__action">
              {shortcutCopy.selectedPrefix} {actionLabel}
            </p>
          </div>
          <div className="shortcut-keyboard-dialog__actions">
            <UIButton
              variant="ghost"
              size="sm"
              onClick={onClear}
              disabled={selectedKeys.length === 0}
            >
              {shortcutCopy.clearAction}
            </UIButton>
            <UIButton variant="secondary" size="sm" onClick={onClose}>
              {shortcutCopy.dialogClose}
            </UIButton>
          </div>
        </div>

        <div className="shortcut-keyboard-dialog__selected">
          {selectedKeys.length > 0 ? (
            selectedKeys.map((key) => (
              <span key={key} className="shortcut-key-chip">
                {getShortcutKeyLabel(key, copy.locale)}
              </span>
            ))
          ) : (
            <span className="shortcut-action-card__empty">{shortcutCopy.unbound}</span>
          )}
        </div>

        <div className="shortcut-keyboard shortcut-keyboard--dialog">
          <div className="shortcut-keyboard__layout">
            <div className="shortcut-keyboard__main">
              {renderShortcutKeyboardRow(
                KEYBOARD_FUNCTION_ROW,
                0,
                selectedKeys,
                copy.locale,
                onToggleKey,
                "shortcut-keyboard__row--function",
              )}
              <div className="shortcut-keyboard__rows">
                {KEYBOARD_MAIN_ROWS.map((row, rowIndex) =>
                  renderShortcutKeyboardRow(
                    row,
                    rowIndex + 1,
                    selectedKeys,
                    copy.locale,
                    onToggleKey,
                  ),
                )}
              </div>
            </div>

            <div className="shortcut-keyboard__side">
              <div className="shortcut-keyboard__cluster shortcut-keyboard__cluster--navigation">
                {KEYBOARD_NAVIGATION_ROWS.map((row, rowIndex) =>
                  renderShortcutKeyboardRow(
                    row,
                    rowIndex + 100,
                    selectedKeys,
                    copy.locale,
                    onToggleKey,
                  ),
                )}
              </div>

              <div className="shortcut-keyboard__cluster shortcut-keyboard__cluster--arrows">
                {KEYBOARD_ARROW_ROWS.map((row, rowIndex) =>
                  renderShortcutKeyboardRow(
                    row,
                    rowIndex + 200,
                    selectedKeys,
                    copy.locale,
                    onToggleKey,
                    row.length === 1 ? "shortcut-keyboard__row--centered" : undefined,
                  ),
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function ShortcutSettingsSection({
  copy,
  bindings,
  onUpdate,
}: {
  copy: UiCopy;
  bindings: AppSettings["shortcuts"];
  onUpdate: (updater: (current: AppSettings) => AppSettings) => void;
}) {
  const shortcutCopy = copy.settings.sections.shortcuts;
  const [selectedActionId, setSelectedActionId] = useState<ShortcutActionId>("togglePlayback");
  const [editingActionId, setEditingActionId] = useState<ShortcutActionId | null>(null);
  const [isKeyboardDialogClosing, setIsKeyboardDialogClosing] = useState(false);
  const shortcutDialogCloseTimerRef = useRef<number | null>(null);
  const actionLabels = shortcutCopy.actions as Record<ShortcutActionId, string>;

  useEffect(() => {
    return () => {
      if (shortcutDialogCloseTimerRef.current !== null) {
        window.clearTimeout(shortcutDialogCloseTimerRef.current);
        shortcutDialogCloseTimerRef.current = null;
      }
    };
  }, []);

  const handleToggleKey = (key: string) => {
    const normalizedKey = normalizeShortcutKeyValue(key);
    if (!normalizedKey) {
      return;
    }

    onUpdate((current) => {
      const nextShortcuts = {
        ...current.shortcuts,
        [selectedActionId]: [...current.shortcuts[selectedActionId]],
      };
      const currentActionKeys = nextShortcuts[selectedActionId];

      nextShortcuts[selectedActionId] = currentActionKeys.includes(normalizedKey)
        ? currentActionKeys.filter((boundKey) => boundKey !== normalizedKey)
        : [...currentActionKeys, normalizedKey];

      return {
        ...current,
        shortcuts: nextShortcuts,
      };
    });
  };

  const handleClearAction = (actionId: ShortcutActionId) => {
    onUpdate((current) => ({
      ...current,
      shortcuts: {
        ...current.shortcuts,
        [actionId]: [],
      },
    }));
  };

  const openKeyboardEditor = (actionId: ShortcutActionId) => {
    if (shortcutDialogCloseTimerRef.current !== null) {
      window.clearTimeout(shortcutDialogCloseTimerRef.current);
      shortcutDialogCloseTimerRef.current = null;
    }

    setSelectedActionId(actionId);
    setEditingActionId(actionId);
    setIsKeyboardDialogClosing(false);
  };

  const closeKeyboardEditor = () => {
    if (!editingActionId) {
      return;
    }

    setIsKeyboardDialogClosing(true);
    if (shortcutDialogCloseTimerRef.current !== null) {
      window.clearTimeout(shortcutDialogCloseTimerRef.current);
    }

    shortcutDialogCloseTimerRef.current = window.setTimeout(() => {
      shortcutDialogCloseTimerRef.current = null;
      setEditingActionId(null);
      setIsKeyboardDialogClosing(false);
    }, SHORTCUT_EDITOR_CLOSE_DURATION_MS);
  };

  return (
    <section className="settings-card settings-card--wide">
      <div className="settings-card__header">
        <div>
          <h3 className="settings-card__title">{shortcutCopy.title}</h3>
        </div>
      </div>

      <div className="settings-card__body shortcut-settings">
        <p className="settings-screen__description settings-screen__description--compact shortcut-settings__intro">
          {shortcutCopy.description}
        </p>

        <div className="shortcut-settings__group">
          <div className="shortcut-settings__group-header">
            <div>
              <h4 className="shortcut-settings__group-title">{shortcutCopy.builtInTitle}</h4>
            </div>
          </div>

          <div className="shortcut-settings__actions">
            {SHORTCUT_ACTION_IDS.filter((actionId) => IN_APP_SHORTCUT_BINDINGS[actionId].length > 0).map(
              (actionId) => (
                <div key={actionId} className="shortcut-action-row shortcut-action-row--readonly">
                  <div className="shortcut-action-row__main shortcut-action-row__main--readonly">
                    <div className="shortcut-action-row__info">
                      <span className="shortcut-action-row__label">{actionLabels[actionId]}</span>
                      <div className="shortcut-action-row__keys">
                        {IN_APP_SHORTCUT_BINDINGS[actionId].map((key) => (
                          <span key={`${actionId}-${key}`} className="shortcut-key-chip">
                            {getShortcutKeyLabel(key, copy.locale)}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ),
            )}
          </div>
        </div>

        <div className="shortcut-settings__group">
          <div className="shortcut-settings__group-header">
            <div>
              <h4 className="shortcut-settings__group-title">{shortcutCopy.customTitle}</h4>
            </div>
          </div>

          <div className="shortcut-settings__actions">
            {SHORTCUT_ACTION_IDS.map((actionId) => {
              const isSelected = selectedActionId === actionId;
              const boundKeys = bindings[actionId];

              return (
                <div
                  key={actionId}
                  className={[
                    "shortcut-action-row",
                    isSelected ? "shortcut-action-row--selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <button
                    className="shortcut-action-row__main"
                    type="button"
                    onClick={() => openKeyboardEditor(actionId)}
                  >
                    <div className="shortcut-action-row__info">
                      <span className="shortcut-action-row__label">{actionLabels[actionId]}</span>
                      <div className="shortcut-action-row__keys">
                        {boundKeys.length > 0 ? (
                          boundKeys.map((key) => (
                            <span key={`${actionId}-${key}`} className="shortcut-key-chip">
                              {getShortcutKeyLabel(key, copy.locale)}
                            </span>
                          ))
                        ) : (
                          <span className="shortcut-action-row__empty">{shortcutCopy.unbound}</span>
                        )}
                      </div>
                    </div>
                  </button>
                  <div className="shortcut-action-row__actions">
                    <button
                      type="button"
                      className="shortcut-inline-action shortcut-inline-action--primary"
                      onClick={() => openKeyboardEditor(actionId)}
                    >
                      {shortcutCopy.openEditor}
                    </button>
                    <button
                      type="button"
                      className="shortcut-inline-action"
                      onClick={() => handleClearAction(actionId)}
                      disabled={boundKeys.length === 0}
                    >
                      {shortcutCopy.clearAction}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {editingActionId ? (
        <ShortcutKeyboardDialog
          copy={copy}
          actionLabel={actionLabels[editingActionId]}
          selectedKeys={bindings[editingActionId]}
          isClosing={isKeyboardDialogClosing}
          onToggleKey={handleToggleKey}
          onClear={() => handleClearAction(editingActionId)}
          onClose={closeKeyboardEditor}
        />
      ) : null}
    </section>
  );
}

function SettingsScreen({
  copy,
  languageOptions,
  themeOptions,
  qualityOptions,
  playbackCacheModeOptions,
  settings,
  isLoading,
  isSaving,
  isTestingNeteaseApi,
  localNeteaseApiStatus,
  isClearingLibrary,
  onReleaseMemoryCache,
  onUpdate,
  onSave,
  onReset,
  onTestNeteaseApi,
  onSaveNeteaseCookie,
  onClearNeteaseCookie,
  onPickScanDirectory,
  onPickBackgroundImage,
  onClearBackgroundImage,
  onClearLibrary,
}: {
  copy: UiCopy;
  languageOptions: UISelectOption[];
  themeOptions: UISelectOption[];
  qualityOptions: UISelectOption[];
  playbackCacheModeOptions: UISelectOption[];
  settings: AppSettings;
  isLoading: boolean;
  isSaving: boolean;
  isTestingNeteaseApi: boolean;
  localNeteaseApiStatus: LocalNeteaseApiServerStatus | null;
  isClearingLibrary: boolean;
  onReleaseMemoryCache: () => void;
  onUpdate: (updater: (current: AppSettings) => AppSettings) => void;
  onSave: () => void;
  onReset: () => void;
  onTestNeteaseApi: () => void;
  onSaveNeteaseCookie: (cookie: string) => Promise<void>;
  onClearNeteaseCookie: () => Promise<void>;
  onPickScanDirectory: () => void;
  onPickBackgroundImage: () => void;
  onClearBackgroundImage: () => void;
  onClearLibrary: () => void;
}) {
  const scanDirectoriesText = settings.library.scanDirectories.join(", ");
  const themeEditorCopy = getThemeEditorCopy(copy.locale);
  const [settingsView, setSettingsView] = useState<"main" | "theme">("main");
  const isNeteaseEnabled = settings.network.enabledSources.includes("netease");
  const [qrLoginSession, setQrLoginSession] = useState<NeteaseQrLoginSession | null>(null);
  const [qrLoginState, setQrLoginState] = useState<
    "idle" | "creating" | "waiting" | "scanned" | "authorizing" | "authorized" | "expired" | "failed"
  >("idle");
  const [qrLoginMessage, setQrLoginMessage] = useState<string | null>(null);
  const [isQrLoginBusy, setIsQrLoginBusy] = useState(false);
  const [isClearingNeteaseLogin, setIsClearingNeteaseLogin] = useState(false);
  const [neteaseAccount, setNeteaseAccount] = useState<NeteaseAccountProfile | null>(null);
  const [isLoadingNeteaseAccount, setIsLoadingNeteaseAccount] = useState(false);
  const [neteaseAccountError, setNeteaseAccountError] = useState<string | null>(null);
  const [isReleasingMemoryCache, setIsReleasingMemoryCache] = useState(false);
  const [systemFontFamilies, setSystemFontFamilies] = useState<string[]>([]);
  const [isLoadingSystemFonts, setIsLoadingSystemFonts] = useState(false);
  const prioritizedSystemFontFamilies = useMemo(
    () => prioritizeSystemFontFamilies(systemFontFamilies, copy.locale),
    [copy.locale, systemFontFamilies],
  );
  const hasSavedNeteaseCookie = settings.network.neteaseCookie.trim().length > 0;
  const showLocalApiPanel = isNeteaseEnabled && settings.network.useLocalApiServer;
  const localApiStatusLabel = copy.locale === "en-US"
    ? localNeteaseApiStatus?.starting
      ? "Starting"
      : localNeteaseApiStatus?.running
        ? "Running"
        : "Stopped"
    : localNeteaseApiStatus?.starting
      ? "启动中"
      : localNeteaseApiStatus?.running
        ? "运行中"
        : "已停止";
  const localApiStatusTone = localNeteaseApiStatus?.running
    ? "running"
    : localNeteaseApiStatus?.starting
      ? "starting"
      : "stopped";
  const localApiMessage =
    localNeteaseApiStatus?.message ||
    (copy.locale === "en-US"
      ? "The app will manage the local API process and display its recent output here."
      : "应用会在这里显示本地 API 的启动状态与最近输出。");
  const neteaseCookiePreview = hasSavedNeteaseCookie
    ? maskSensitiveValue(settings.network.neteaseCookie.trim(), 20, 10)
    : copy.settings.sections.network.loginCookieEmpty;
  const backgroundModeOptions: UISelectOption[] = [
    {
      label: themeEditorCopy.backgroundModeTheme,
      value: "theme",
    },
    {
      label: themeEditorCopy.backgroundModeCustom,
      value: "custom",
    },
  ];
  const immersiveBackgroundModeOptions: UISelectOption[] = [
    {
      label: themeEditorCopy.immersiveBackgroundModePaletteSolid,
      value: "palette-solid",
    },
    {
      label: themeEditorCopy.immersiveBackgroundModePaletteGradient,
      value: "palette-gradient",
    },
    {
      label: themeEditorCopy.immersiveBackgroundModeAppBackground,
      value: "app-background",
    },
    {
      label: themeEditorCopy.immersiveBackgroundModeBackgroundMv,
      value: "background-mv",
    },
    {
      label: themeEditorCopy.immersiveBackgroundModeCoverBlur,
      value: "cover-blur",
    },
    {
      label: themeEditorCopy.immersiveBackgroundModeFlow,
      value: "flow",
    },
  ];
  const dynamicIslandStyleOptions: UISelectOption[] = [
    {
      label: copy.settings.sections.dynamicIsland.styleDefault,
      value: "default",
    },
    {
      label: copy.settings.sections.dynamicIsland.styleSoft,
      value: "soft",
    },
    {
      label: copy.settings.sections.dynamicIsland.styleSolid,
      value: "solid",
    },
  ];
  const dynamicIslandColorOptions: UISelectOption[] = [
    {
      label: copy.settings.sections.dynamicIsland.colorFollowTheme,
      value: "follow-theme",
    },
    {
      label: copy.settings.sections.dynamicIsland.colorPrimary,
      value: "primary",
    },
    {
      label: copy.settings.sections.dynamicIsland.colorSecondary,
      value: "secondary",
    },
  ];
  const dynamicIslandContentOptions: UISelectOption[] = [
    {
      label: copy.settings.sections.dynamicIsland.contentTime,
      value: "time",
    },
    {
      label: copy.settings.sections.dynamicIsland.contentDate,
      value: "date",
    },
    {
      label: copy.settings.sections.dynamicIsland.contentDateTime,
      value: "datetime",
    },
  ];
  const dynamicIslandPositionOptions: UISelectOption[] = [
    {
      label: copy.settings.sections.dynamicIsland.positionCenter,
      value: "center",
    },
    {
      label: copy.settings.sections.dynamicIsland.positionLeft,
      value: "left",
    },
    {
      label: copy.settings.sections.dynamicIsland.positionRight,
      value: "right",
    },
  ];
  const appFontOptions: UISelectOption[] = [
    {
      label: copy.settings.sections.appearance.fontDefaultOption,
      value: "system-ui",
      labelStyle: buildFontOptionLabelStyle("system-ui"),
    },
    ...prioritizedSystemFontFamilies.map((family) => ({
      label: family,
      value: family,
      labelStyle: buildFontOptionLabelStyle(family),
    })),
  ];
  const lyricFontOptions: UISelectOption[] = [
    {
      label: copy.settings.sections.lyrics.fontDefaultOption,
      value: "system-ui",
      labelStyle: buildFontOptionLabelStyle("system-ui"),
    },
    ...prioritizedSystemFontFamilies.map((family) => ({
      label: family,
      value: family,
      labelStyle: buildFontOptionLabelStyle(family),
    })),
  ];
  const lyricLineAlignmentOptions: UISelectOption[] = [
    {
      label: copy.settings.sections.lyrics.lineAlignmentUpper,
      value: "upper",
    },
    {
      label: copy.settings.sections.lyrics.lineAlignmentCenter,
      value: "center",
    },
  ];
  const lyricTextAlignmentOptions: UISelectOption[] = [
    {
      label: copy.settings.sections.lyrics.textAlignmentLeft,
      value: "left",
    },
    {
      label: copy.settings.sections.lyrics.textAlignmentCenter,
      value: "center",
    },
    {
      label: copy.settings.sections.lyrics.textAlignmentRight,
      value: "right",
    },
  ];
  const lyricRenderModeOptions: UISelectOption[] = [
    {
      label: copy.settings.sections.lyrics.renderModeSimple,
      value: "simple",
    },
    {
      label: copy.settings.sections.lyrics.renderModeBalanced,
      value: "balanced",
    },
    {
      label: copy.settings.sections.lyrics.renderModeAdvanced,
      value: "advanced",
    },
  ];

  useEffect(() => {
    let isDisposed = false;
    setIsLoadingSystemFonts(true);

    void listSystemFontFamilies()
      .then((families) => {
        if (isDisposed) {
          return;
        }

        setSystemFontFamilies(
          Array.from(
            new Set(
              families
                .map((family) => family.trim())
                .filter(Boolean),
            ),
          ),
        );
      })
      .catch((error) => {
        if (isDisposed) {
          return;
        }

        console.error("[settings] failed to load system fonts", error);
        setSystemFontFamilies([]);
      })
      .finally(() => {
        if (!isDisposed) {
          setIsLoadingSystemFonts(false);
        }
      });

    return () => {
      isDisposed = true;
    };
  }, []);

  useEffect(() => {
    if (isNeteaseEnabled) {
      return;
    }

    setQrLoginSession(null);
    setQrLoginState("idle");
    setQrLoginMessage(null);
    setNeteaseAccount(null);
    setNeteaseAccountError(null);
    setIsLoadingNeteaseAccount(false);
  }, [isNeteaseEnabled]);

  useEffect(() => {
    if (!isNeteaseEnabled || !settings.network.neteaseCookie.trim()) {
      setNeteaseAccount(null);
      setNeteaseAccountError(null);
      setIsLoadingNeteaseAccount(false);
      return;
    }

    let isDisposed = false;
    setIsLoadingNeteaseAccount(true);
    setNeteaseAccountError(null);

    void getNeteaseLoggedInAccount(settings)
      .then((account) => {
        if (isDisposed) {
          return;
        }

        setNeteaseAccount(account);
        setNeteaseAccountError(account ? null : copy.settings.sections.network.accountEmpty);
      })
      .catch((error) => {
        if (isDisposed) {
          return;
        }

        console.error("[network] failed to load netease account", error);
        setNeteaseAccount(null);
        setNeteaseAccountError(
          error instanceof Error && error.message
            ? error.message
            : copy.settings.sections.network.accountLoadFailed,
        );
      })
      .finally(() => {
        if (isDisposed) {
          return;
        }

        setIsLoadingNeteaseAccount(false);
      });

    return () => {
      isDisposed = true;
    };
  }, [
    copy.settings.sections.network.accountEmpty,
    copy.settings.sections.network.accountLoadFailed,
    isNeteaseEnabled,
    settings.network.neteaseApiBaseUrl,
    settings.network.neteaseCookie,
    settings.network.neteaseProxy,
    settings.network.neteaseRealIp,
    settings.network.requestTimeoutMs,
  ]);

  useEffect(() => {
    if (!qrLoginSession || !isNeteaseEnabled) {
      return;
    }

    let isDisposed = false;
    let isRequesting = false;
    let pollTimer = 0;

    const pollStatus = async () => {
      if (isDisposed || isRequesting) {
        return;
      }

      isRequesting = true;

      try {
        const status = await checkNeteaseQrLoginStatus(settings, qrLoginSession.key);

        if (isDisposed) {
          return;
        }

        setQrLoginMessage(status.message);

        if (status.code === 801) {
          setQrLoginState("waiting");
          return;
        }

        if (status.code === 802) {
          setQrLoginState("scanned");
          return;
        }

        if (status.code === 800) {
          setQrLoginState("expired");
          window.clearInterval(pollTimer);
          return;
        }

        setQrLoginState("authorizing");
        window.clearInterval(pollTimer);

        if (!status.cookie) {
          setQrLoginState("failed");
          return;
        }

        await onSaveNeteaseCookie(status.cookie);

        if (isDisposed) {
          return;
        }

        setQrLoginState("authorized");
        setQrLoginSession(null);
      } catch (error) {
        if (isDisposed) {
          return;
        }

        console.error("[network] failed to poll netease qr login", error);
        setQrLoginState("failed");
        setQrLoginMessage(error instanceof Error ? error.message : null);
        window.clearInterval(pollTimer);
      } finally {
        isRequesting = false;
      }
    };

    void pollStatus();
    pollTimer = window.setInterval(() => {
      void pollStatus();
    }, 2500);

    return () => {
      isDisposed = true;
      window.clearInterval(pollTimer);
    };
  }, [
    isNeteaseEnabled,
    qrLoginSession,
    settings.network.neteaseApiBaseUrl,
    settings.network.neteaseProxy,
    settings.network.neteaseRealIp,
    settings.network.requestTimeoutMs,
  ]);

  const handleGenerateQrLogin = async () => {
    if (!isNeteaseEnabled) {
      return;
    }

    setIsQrLoginBusy(true);
    setQrLoginState("creating");
    setQrLoginMessage(null);

    try {
      const session = await createNeteaseQrLoginSession(settings);
      setQrLoginSession(session);
      setQrLoginState("waiting");
    } catch (error) {
      console.error("[network] failed to create netease qr login", error);
      setQrLoginSession(null);
      setQrLoginState("failed");
      setQrLoginMessage(error instanceof Error ? error.message : null);
    } finally {
      setIsQrLoginBusy(false);
    }
  };

  const handleStopQrLoginPolling = () => {
    setQrLoginSession(null);
    setQrLoginState(hasSavedNeteaseCookie ? "authorized" : "idle");
    setQrLoginMessage(null);
  };

  const handleClearSavedNeteaseLogin = async () => {
    setIsClearingNeteaseLogin(true);

    try {
      await onClearNeteaseCookie();
      setQrLoginSession(null);
      setQrLoginState("idle");
      setQrLoginMessage(null);
    } catch (error) {
      console.error("[network] failed to clear netease login", error);
    } finally {
      setIsClearingNeteaseLogin(false);
    }
  };

  const handleReleaseMemoryCacheClick = async () => {
    setIsReleasingMemoryCache(true);
    try {
      await Promise.resolve(onReleaseMemoryCache());
    } finally {
      setIsReleasingMemoryCache(false);
    }
  };

  const qrLoginStatusLabel = resolveNeteaseQrLoginStatusLabel(copy.locale, qrLoginState, {
    loggedIn: hasSavedNeteaseCookie,
  });
  const showNeteaseQrLogin = !hasSavedNeteaseCookie;

  const handleRefreshNeteaseAccount = async () => {
    if (!isNeteaseEnabled || !settings.network.neteaseCookie.trim()) {
      setNeteaseAccount(null);
      setNeteaseAccountError(copy.settings.sections.network.accountEmpty);
      return;
    }

    setIsLoadingNeteaseAccount(true);
    setNeteaseAccountError(null);

    try {
      const account = await getNeteaseLoggedInAccount(settings);
      setNeteaseAccount(account);
      setNeteaseAccountError(account ? null : copy.settings.sections.network.accountEmpty);
    } catch (error) {
      console.error("[network] failed to refresh netease account", error);
      setNeteaseAccount(null);
      setNeteaseAccountError(
        error instanceof Error && error.message
          ? error.message
          : copy.settings.sections.network.accountLoadFailed,
      );
    } finally {
      setIsLoadingNeteaseAccount(false);
    }
  };

  if (settingsView === "theme") {
    return (
      <section className="settings-screen">
        <header className="settings-screen__header">
          <div>
            <h2 className="settings-screen__title">{themeEditorCopy.title}</h2>
            <p className="settings-screen__description">{themeEditorCopy.description}</p>
          </div>

        <div className="settings-screen__actions">
          <span className="settings-screen__autosave">
            {isSaving ? copy.settings.autoSaving : copy.settings.autoSaveEnabled}
          </span>
          <UIButton variant="secondary" onClick={() => setSettingsView("main")}>
            {themeEditorCopy.backButton}
          </UIButton>
            <UIButton variant="secondary" onClick={onReset} disabled={isLoading || isSaving}>
              {copy.settings.restore}
            </UIButton>
            <UIButton variant="primary" onClick={onSave} disabled={isLoading || isSaving}>
              {isSaving ? copy.settings.saving : copy.settings.save}
            </UIButton>
          </div>
        </header>

        <section className="settings-card settings-card--wide">
          <div className="settings-card__header">
            <div>
              <h3 className="settings-card__title">{themeEditorCopy.previewTitle}</h3>
            </div>
          </div>

          <div className="settings-card__body">
            <p className="settings-screen__description settings-screen__description--compact">
              {themeEditorCopy.previewDescription}
            </p>
            <ThemePreviewCard settings={settings} />
          </div>
        </section>

        <div className="settings-grid">
          <section className="settings-card">
            <div className="settings-card__header">
              <div>
                <h3 className="settings-card__title">{themeEditorCopy.modeTitle}</h3>
              </div>
            </div>

            <div className="settings-card__body">
              <p className="settings-screen__description settings-screen__description--compact">
                {themeEditorCopy.modeDescription}
              </p>
              <label
                className="theme-mode-switch"
                aria-label={`${themeEditorCopy.lightMode} / ${themeEditorCopy.darkMode}`}
              >
                <input
                  className="theme-mode-switch__checkbox"
                  type="checkbox"
                  checked={settings.appearance.colorScheme === "dark"}
                  onChange={(event) =>
                    onUpdate((current) => ({
                      ...current,
                      appearance: {
                        ...current.appearance,
                        colorScheme: event.target.checked ? "dark" : "light",
                      },
                    }))
                  }
                />
                <span className="theme-mode-switch__container">
                  <span className="theme-mode-switch__clouds" aria-hidden="true" />
                  <span className="theme-mode-switch__stars" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 55" fill="none">
                      <path
                        fillRule="evenodd"
                        clipRule="evenodd"
                        d="M135.831 3.00688C135.055 3.85027 134.111 4.29946 133 4.35447C134.111 4.40947 135.055 4.85867 135.831 5.71123C136.607 6.55462 136.996 7.56303 136.996 8.72727C136.996 7.95722 137.172 7.25134 137.525 6.59129C137.886 5.93124 138.372 5.39954 138.98 5.00535C139.598 4.60199 140.268 4.39114 141 4.35447C139.88 4.2903 138.936 3.85027 138.16 3.00688C137.384 2.16348 136.996 1.16425 136.996 0C136.996 1.16425 136.607 2.16348 135.831 3.00688ZM31 23.3545C32.1114 23.2995 33.0551 22.8503 33.8313 22.0069C34.6075 21.1635 34.9956 20.1642 34.9956 19C34.9956 20.1642 35.3837 21.1635 36.1599 22.0069C36.9361 22.8503 37.8798 23.2903 39 23.3545C38.2679 23.3911 37.5976 23.602 36.9802 24.0053C36.3716 24.3995 35.8864 24.9312 35.5248 25.5913C35.172 26.2513 34.9956 26.9572 34.9956 27.7273C34.9956 26.563 34.6075 25.5546 33.8313 24.7112C33.0551 23.8587 32.1114 23.4095 31 23.3545ZM0 36.3545C1.11136 36.2995 2.05513 35.8503 2.83131 35.0069C3.6075 34.1635 3.99559 33.1642 3.99559 32C3.99559 33.1642 4.38368 34.1635 5.15987 35.0069C5.93605 35.8503 6.87982 36.2903 8 36.3545C7.26792 36.3911 6.59757 36.602 5.98015 37.0053C5.37155 37.3995 4.88644 37.9312 4.52481 38.5913C4.172 39.2513 3.99559 39.9572 3.99559 40.7273C3.99559 39.563 3.6075 38.5546 2.83131 37.7112C2.05513 36.8587 1.11136 36.4095 0 36.3545ZM56.8313 24.0069C56.0551 24.8503 55.1114 25.2995 54 25.3545C55.1114 25.4095 56.0551 25.8587 56.8313 26.7112C57.6075 27.5546 57.9956 28.563 57.9956 29.7273C57.9956 28.9572 58.172 28.2513 58.5248 27.5913C58.8864 26.9312 59.3716 26.3995 59.9802 26.0053C60.5976 25.602 61.2679 25.3911 62 25.3545C60.8798 25.2903 59.9361 24.8503 59.1599 24.0069C58.3837 23.1635 57.9956 22.1642 57.9956 21C57.9956 22.1642 57.6075 23.1635 56.8313 24.0069ZM81 25.3545C82.1114 25.2995 83.0551 24.8503 83.8313 24.0069C84.6075 23.1635 84.9956 22.1642 84.9956 21C84.9956 22.1642 85.3837 23.1635 86.1599 24.0069C86.9361 24.8503 87.8798 25.2903 89 25.3545C88.2679 25.3911 87.5976 25.602 86.9802 26.0053C86.3716 26.3995 85.8864 26.9312 85.5248 27.5913C85.172 28.2513 84.9956 28.9572 84.9956 29.7273C84.9956 28.563 84.6075 27.5546 83.8313 26.7112C83.0551 25.8587 82.1114 25.4095 81 25.3545ZM136 36.3545C137.111 36.2995 138.055 35.8503 138.831 35.0069C139.607 34.1635 139.996 33.1642 139.996 32C139.996 33.1642 140.384 34.1635 141.16 35.0069C141.936 35.8503 142.88 36.2903 144 36.3545C143.268 36.3911 142.598 36.602 141.98 37.0053C141.372 37.3995 140.886 37.9312 140.525 38.5913C140.172 39.2513 139.996 39.9572 139.996 40.7273C139.996 39.563 139.607 38.5546 138.831 37.7112C138.055 36.8587 137.111 36.4095 136 36.3545ZM101.831 49.0069C101.055 49.8503 100.111 50.2995 99 50.3545C100.111 50.4095 101.055 50.8587 101.831 51.7112C102.607 52.5546 102.996 53.563 102.996 54.7273C102.996 53.9572 103.172 53.2513 103.525 52.5913C103.886 51.9312 104.372 51.3995 104.98 51.0053C105.598 50.602 106.268 50.3911 107 50.3545C105.88 50.2903 104.936 49.8503 104.16 49.0069C103.384 48.1635 102.996 47.1642 102.996 46C102.996 47.1642 102.607 48.1635 101.831 49.0069Z"
                        fill="currentColor"
                      />
                    </svg>
                  </span>
                  <span className="theme-mode-switch__circle">
                    <span className="theme-mode-switch__sun-moon">
                      <span className="theme-mode-switch__moon">
                        <span className="theme-mode-switch__spot" />
                        <span className="theme-mode-switch__spot" />
                        <span className="theme-mode-switch__spot" />
                      </span>
                    </span>
                  </span>
                </span>
              </label>
            </div>
          </section>
        </div>

        <section className="settings-card settings-card--wide">
          <div className="settings-card__header">
            <div>
              <h3 className="settings-card__title">{themeEditorCopy.presetsTitle}</h3>
            </div>
          </div>

          <div className="settings-card__body">
            <p className="settings-screen__description settings-screen__description--compact">
              {themeEditorCopy.presetsDescription}
            </p>
            <div className="theme-preset-grid">
              {themeOptions.map((option) => (
                <ThemePresetButton
                  key={option.value}
                  option={option}
                  settings={settings}
                  active={settings.appearance.themeMode === option.value}
                  activeText={themeEditorCopy.activePreset}
                  customTag={themeEditorCopy.customTag}
                  onClick={() =>
                    onUpdate((current) => ({
                      ...current,
                      appearance: {
                        ...current.appearance,
                        themeMode: option.value,
                      },
                    }))
                  }
                />
              ))}
            </div>
            {settings.appearance.themeMode === "custom" ? (
              <div className="theme-custom-section">
                <div className="theme-color-grid">
                  <ThemeColorField
                    label={themeEditorCopy.primaryLabel}
                    value={settings.appearance.customThemePrimary}
                    onChange={(value) =>
                      onUpdate((current) => ({
                        ...current,
                        appearance: {
                          ...current.appearance,
                          themeMode: "custom",
                          customThemePrimary: sanitizeHexColor(
                            value,
                            current.appearance.customThemePrimary,
                          ),
                        },
                      }))
                    }
                  />
                  <ThemeColorField
                    label={themeEditorCopy.secondaryLabel}
                    value={settings.appearance.customThemeSecondary}
                    onChange={(value) =>
                      onUpdate((current) => ({
                        ...current,
                        appearance: {
                          ...current.appearance,
                          themeMode: "custom",
                          customThemeSecondary: sanitizeHexColor(
                            value,
                            current.appearance.customThemeSecondary,
                          ),
                        },
                      }))
                    }
                  />
                  <ThemeColorField
                    label={themeEditorCopy.surfaceLabel}
                    value={settings.appearance.customThemeSurface}
                    onChange={(value) =>
                      onUpdate((current) => ({
                        ...current,
                        appearance: {
                          ...current.appearance,
                          themeMode: "custom",
                          customThemeSurface: sanitizeHexColor(
                            value,
                            current.appearance.customThemeSurface,
                          ),
                        },
                      }))
                    }
                  />
                </div>
              </div>
            ) : null}
            <UISwitch
              label={copy.settings.sections.appearance.followArtworkThemeLabel}
              description={copy.settings.sections.appearance.followArtworkThemeDescription}
              checked={settings.appearance.followSongArtworkTheme}
              onChange={(checked) =>
                onUpdate((current) => ({
                  ...current,
                  appearance: {
                    ...current.appearance,
                    followSongArtworkTheme: checked,
                  },
                }))
              }
            />
          </div>
        </section>

        <section className="settings-card settings-card--wide">
          <div className="settings-card__header">
            <div>
              <h3 className="settings-card__title">{themeEditorCopy.backgroundTitle}</h3>
            </div>
          </div>

          <div className="settings-card__body">
            <div className="theme-background-panel">
              <div className="theme-background-panel__header">
                <div>
                  <h4 className="theme-background-panel__title">
                    {themeEditorCopy.backgroundModeLabel}
                  </h4>
                </div>
              </div>
              <p className="settings-screen__description settings-screen__description--compact">
                {themeEditorCopy.backgroundDescription}
              </p>
              <div className="theme-background-select theme-background-select--standalone-label">
                <UISelect
                  label={themeEditorCopy.backgroundModeLabel}
                  value={settings.appearance.backgroundMode}
                  options={backgroundModeOptions}
                  onChange={(value) =>
                    onUpdate((current) => ({
                      ...current,
                      appearance: {
                        ...current.appearance,
                        backgroundMode: value as AppSettings["appearance"]["backgroundMode"],
                      },
                    }))
                  }
                />
              </div>
              <UISwitch
                label={themeEditorCopy.backgroundMvLabel}
                description={themeEditorCopy.backgroundMvDescription}
                checked={settings.appearance.useBackgroundMv}
                onChange={(checked) =>
                  onUpdate((current) => ({
                    ...current,
                    appearance: {
                      ...current.appearance,
                      useBackgroundMv: checked,
                    },
                  }))
                }
              />
            </div>

            {settings.appearance.backgroundMode === "custom" ? (
              <div className="theme-background-panel">
                <div className="theme-background-panel__header">
                  <div>
                    <h4 className="theme-background-panel__title">
                      {settings.appearance.backgroundImagePath
                        ? settings.appearance.backgroundImagePath.split(/[\\/]/).pop()
                        : themeEditorCopy.customImageEmpty}
                    </h4>
                  </div>
                  <div className="theme-background-panel__actions">
                    <UIButton variant="secondary" size="sm" onClick={onPickBackgroundImage}>
                      {themeEditorCopy.customImageUpload}
                    </UIButton>
                    <UIButton
                      variant="ghost"
                      size="sm"
                      onClick={onClearBackgroundImage}
                      disabled={!settings.appearance.backgroundImagePath}
                    >
                      {themeEditorCopy.customImageClear}
                    </UIButton>
                  </div>
                </div>
                <p className="settings-screen__description settings-screen__description--compact">
                  {themeEditorCopy.customImageDescription}
                </p>
                <div className="theme-background-path">
                  {settings.appearance.backgroundImagePath || themeEditorCopy.customImageEmpty}
                </div>
                <div className="theme-background-grid">
                  <UISlider
                    label={themeEditorCopy.customImageOpacityLabel}
                    value={settings.appearance.backgroundImageOpacity}
                    min={0}
                    max={100}
                    step={1}
                    valueSuffix="%"
                    onChange={(value) =>
                      onUpdate((current) => ({
                        ...current,
                        appearance: {
                          ...current.appearance,
                          backgroundImageOpacity: value,
                        },
                      }))
                    }
                  />
                  <UISlider
                    label={themeEditorCopy.customBlurLabel}
                    value={settings.appearance.backgroundBlur}
                    min={0}
                    max={48}
                    step={1}
                    valueSuffix="px"
                    onChange={(value) =>
                      onUpdate((current) => ({
                        ...current,
                        appearance: {
                          ...current.appearance,
                          backgroundBlur: value,
                        },
                      }))
                    }
                  />
                  <UISlider
                    label={themeEditorCopy.customDimLabel}
                    value={settings.appearance.backgroundDim}
                    min={0}
                    max={100}
                    step={1}
                    valueSuffix="%"
                    onChange={(value) =>
                      onUpdate((current) => ({
                        ...current,
                        appearance: {
                          ...current.appearance,
                          backgroundDim: value,
                        },
                      }))
                    }
                  />
                </div>
              </div>
            ) : null}

            <div className="theme-background-panel">
              <div className="theme-background-panel__header">
                <div>
                  <h4 className="theme-background-panel__title">
                    {themeEditorCopy.immersiveBackgroundModeLabel}
                  </h4>
                </div>
              </div>
              <p className="settings-screen__description settings-screen__description--compact">
                {themeEditorCopy.immersiveBackgroundDescription}
              </p>
              <div className="theme-background-select theme-background-select--standalone-label">
                <UISelect
                  label={themeEditorCopy.immersiveBackgroundModeLabel}
                  value={settings.appearance.immersiveBackgroundMode}
                  options={immersiveBackgroundModeOptions}
                  onChange={(value) =>
                    onUpdate((current) => ({
                      ...current,
                      appearance: {
                        ...current.appearance,
                        immersiveBackgroundMode: value as ImmersiveBackgroundMode,
                      },
                    }))
                  }
                />
              </div>
              {settings.appearance.immersiveBackgroundMode === "flow" ? (
                <>
                  <UISwitch
                    label={themeEditorCopy.immersiveBackgroundAnimatedLabel}
                    description={themeEditorCopy.immersiveBackgroundAnimatedDescription}
                    checked={settings.appearance.immersiveBackgroundAnimated}
                    onChange={(checked) =>
                      onUpdate((current) => ({
                        ...current,
                        appearance: {
                          ...current.appearance,
                          immersiveBackgroundAnimated: checked,
                        },
                      }))
                    }
                  />
                <div className="theme-background-grid">
                  <div>
                    <UISlider
                      label={themeEditorCopy.immersiveBackgroundResolutionLabel}
                      value={settings.appearance.immersiveBackgroundResolution}
                      min={45}
                      max={100}
                      step={1}
                      valueSuffix="%"
                      onChange={(value) =>
                        onUpdate((current) => ({
                          ...current,
                          appearance: {
                            ...current.appearance,
                            immersiveBackgroundResolution: value,
                          },
                        }))
                      }
                    />
                    <span className="ui-field__helper">
                      {themeEditorCopy.immersiveBackgroundResolutionHelper}
                    </span>
                  </div>
                  <div>
                    <UISlider
                      label={themeEditorCopy.immersiveBackgroundBlurLabel}
                      value={settings.appearance.immersiveBackgroundBlur}
                      min={0}
                      max={36}
                      step={1}
                      valueSuffix="px"
                      onChange={(value) =>
                        onUpdate((current) => ({
                          ...current,
                          appearance: {
                            ...current.appearance,
                            immersiveBackgroundBlur: value,
                          },
                        }))
                      }
                    />
                    <span className="ui-field__helper">
                      {themeEditorCopy.immersiveBackgroundBlurHelper}
                    </span>
                  </div>
                  <div>
                    <UISlider
                      label={themeEditorCopy.immersiveBackgroundSpeedLabel}
                      value={settings.appearance.immersiveBackgroundSpeed}
                      min={40}
                      max={180}
                      step={1}
                      valueSuffix="%"
                      onChange={(value) =>
                        onUpdate((current) => ({
                          ...current,
                          appearance: {
                            ...current.appearance,
                            immersiveBackgroundSpeed: value,
                          },
                        }))
                      }
                    />
                    <span className="ui-field__helper">
                      {themeEditorCopy.immersiveBackgroundSpeedHelper}
                    </span>
                  </div>
                  <div>
                    <UISlider
                      label={themeEditorCopy.immersiveBackgroundSoftnessLabel}
                      value={settings.appearance.immersiveBackgroundSoftness}
                      min={0}
                      max={100}
                      step={1}
                      valueSuffix="%"
                      onChange={(value) =>
                        onUpdate((current) => ({
                          ...current,
                          appearance: {
                            ...current.appearance,
                            immersiveBackgroundSoftness: value,
                          },
                        }))
                      }
                    />
                    <span className="ui-field__helper">
                      {themeEditorCopy.immersiveBackgroundSoftnessHelper}
                    </span>
                  </div>
                </div>
                </>
              ) : null}
            </div>
          </div>
        </section>

      </section>
    );
  }

  return (
    <section className="settings-screen">
      <header className="settings-screen__header">
        <div>
          <h2 className="settings-screen__title">{copy.settings.title}</h2>
          <p className="settings-screen__description">{copy.settings.description}</p>
        </div>

        <div className="settings-screen__actions">
          <span className="settings-screen__autosave">
            {isSaving ? copy.settings.autoSaving : copy.settings.autoSaveEnabled}
          </span>
          <UIButton variant="secondary" onClick={onReset} disabled={isLoading || isSaving}>
            {copy.settings.restore}
          </UIButton>
          <UIButton variant="primary" onClick={onSave} disabled={isLoading || isSaving}>
            {isSaving ? copy.settings.saving : copy.settings.save}
          </UIButton>
        </div>
      </header>
      <div className="settings-grid">
        <section className="settings-card">
          <div className="settings-card__header">
            <div>
              <h3 className="settings-card__title">{copy.settings.sections.appearance.title}</h3>
            </div>
          </div>

          <div className="settings-card__body">
            <UISelect
              label={copy.settings.sections.appearance.languageLabel}
              value={settings.appearance.language}
              options={[...languageOptions]}
              onChange={(value) =>
                onUpdate((current) => ({
                  ...current,
                  appearance: {
                    ...current.appearance,
                    language: value,
                  },
                }))
              }
            />
            <UISelect
              label={copy.settings.sections.appearance.fontLabel}
              helper={
                isLoadingSystemFonts
                  ? copy.settings.sections.appearance.fontHelperLoading
                  : copy.settings.sections.appearance.fontHelperReady
              }
              value={settings.appearance.fontFamily}
              options={appFontOptions}
              searchable
              searchPlaceholder={copy.settings.sections.appearance.fontSearchPlaceholder}
              emptyStateLabel={copy.settings.sections.appearance.fontSearchEmpty}
              onChange={(value) =>
                onUpdate((current) => ({
                  ...current,
                  appearance: {
                    ...current.appearance,
                    fontFamily: value,
                  },
                }))
              }
            />
            <UISlider
              label={copy.settings.sections.appearance.fontWeightLabel}
              value={settings.appearance.fontWeight}
              min={100}
              max={900}
              step={50}
              onChange={(value) =>
                onUpdate((current) => ({
                  ...current,
                  appearance: {
                    ...current.appearance,
                    fontWeight: clampNumber(Math.round(value / 50) * 50, 100, 900),
                  },
                }))
              }
            />
            <span className="ui-field__helper">
              {copy.settings.sections.appearance.fontWeightHelper}
            </span>
            <UIButton
              variant="secondary"
              className="settings-card__jump-button"
              onClick={() => setSettingsView("theme")}
            >
              {themeEditorCopy.openButton}
            </UIButton>
            <UISwitch
              label={copy.settings.sections.appearance.compactLabel}
              description={copy.settings.sections.appearance.compactDescription}
              checked={settings.appearance.useCompactMode}
              onChange={(checked) =>
                onUpdate((current) => ({
                  ...current,
                  appearance: {
                    ...current.appearance,
                    useCompactMode: checked,
                  },
                }))
              }
            />
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card__header">
            <div>
              <h3 className="settings-card__title">{copy.settings.sections.dynamicIsland.title}</h3>
            </div>
          </div>

          <div className="settings-card__body">
            <p className="settings-screen__description settings-screen__description--compact">
              {copy.settings.sections.dynamicIsland.description}
            </p>
            <UISwitch
              label={copy.settings.sections.dynamicIsland.enabledLabel}
              description={copy.settings.sections.dynamicIsland.enabledDescription}
              checked={settings.appearance.showDynamicIsland}
              onChange={(checked) =>
                onUpdate((current) => ({
                  ...current,
                  appearance: {
                    ...current.appearance,
                    showDynamicIsland: checked,
                  },
                }))
              }
            />
            <UISelect
              label={copy.settings.sections.dynamicIsland.styleLabel}
              value={settings.appearance.dynamicIslandStyle}
              options={dynamicIslandStyleOptions}
              onChange={(value) =>
                onUpdate((current) => ({
                  ...current,
                  appearance: {
                    ...current.appearance,
                    dynamicIslandStyle: value as AppSettings["appearance"]["dynamicIslandStyle"],
                  },
                }))
              }
            />
            <UISelect
              label={copy.settings.sections.dynamicIsland.colorLabel}
              value={settings.appearance.dynamicIslandColorMode}
              options={dynamicIslandColorOptions}
              onChange={(value) =>
                onUpdate((current) => ({
                  ...current,
                  appearance: {
                    ...current.appearance,
                    dynamicIslandColorMode:
                      value as AppSettings["appearance"]["dynamicIslandColorMode"],
                  },
                }))
              }
            />
            <UISelect
              label={copy.settings.sections.dynamicIsland.contentLabel}
              value={settings.appearance.dynamicIslandDefaultContent}
              options={dynamicIslandContentOptions}
              onChange={(value) =>
                onUpdate((current) => ({
                  ...current,
                  appearance: {
                    ...current.appearance,
                    dynamicIslandDefaultContent:
                      value as AppSettings["appearance"]["dynamicIslandDefaultContent"],
                  },
                }))
              }
            />
            <UISelect
              label={copy.settings.sections.dynamicIsland.positionLabel}
              value={settings.appearance.dynamicIslandPosition}
              options={dynamicIslandPositionOptions}
              onChange={(value) =>
                onUpdate((current) => ({
                  ...current,
                  appearance: {
                    ...current.appearance,
                    dynamicIslandPosition:
                      value as AppSettings["appearance"]["dynamicIslandPosition"],
                  },
                }))
              }
            />
            <UISwitch
              label={copy.settings.sections.dynamicIsland.lyricsLabel}
              description={copy.settings.sections.dynamicIsland.lyricsDescription}
              checked={settings.appearance.dynamicIslandShowLyrics}
              onChange={(checked) =>
                onUpdate((current) => ({
                  ...current,
                  appearance: {
                    ...current.appearance,
                    dynamicIslandShowLyrics: checked,
                  },
                }))
              }
            />
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card__header">
            <div>
              <h3 className="settings-card__title">{copy.settings.sections.lyrics.title}</h3>
            </div>
          </div>

          <div className="settings-card__body">
            <p className="settings-screen__description settings-screen__description--compact">
              {copy.settings.sections.lyrics.description}
            </p>
            <UISlider
              label={copy.settings.sections.lyrics.delayLabel}
              value={settings.lyrics.delayMs}
              min={-1000}
              max={1000}
              step={10}
              valueSuffix="ms"
              onChange={(value) =>
                onUpdate((current) => ({
                  ...current,
                  lyrics: {
                    ...current.lyrics,
                    delayMs: Math.round(value),
                  },
                }))
              }
            />
            <span className="ui-field__helper">{copy.settings.sections.lyrics.delayHelper}</span>
            <UISelect
              label={copy.settings.sections.lyrics.fontLabel}
              helper={
                isLoadingSystemFonts
                  ? copy.settings.sections.lyrics.fontHelperLoading
                  : copy.settings.sections.lyrics.fontHelperReady
              }
              value={settings.lyrics.fontFamily}
              options={lyricFontOptions}
              searchable
              searchPlaceholder={copy.settings.sections.lyrics.fontSearchPlaceholder}
              emptyStateLabel={copy.settings.sections.lyrics.fontSearchEmpty}
              onChange={(value) =>
                onUpdate((current) => ({
                  ...current,
                  lyrics: {
                    ...current.lyrics,
                    fontFamily: value,
                  },
                }))
              }
            />
            <UISlider
              label={copy.settings.sections.lyrics.fontWeightLabel}
              value={settings.lyrics.fontWeight}
              min={100}
              max={900}
              step={50}
              onChange={(value) =>
                onUpdate((current) => ({
                  ...current,
                  lyrics: {
                    ...current.lyrics,
                    fontWeight: clampNumber(Math.round(value / 50) * 50, 100, 900),
                  },
                }))
              }
            />
            <span className="ui-field__helper">
              {copy.settings.sections.lyrics.fontWeightHelper}
            </span>
            <UISelect
              label={copy.settings.sections.lyrics.lineAlignmentLabel}
              helper={copy.settings.sections.lyrics.lineAlignmentHelper}
              value={settings.lyrics.lineAlignment}
              options={lyricLineAlignmentOptions}
              onChange={(value) =>
                onUpdate((current) => ({
                  ...current,
                  lyrics: {
                    ...current.lyrics,
                    lineAlignment: value === "upper" ? "upper" : "center",
                  },
                }))
              }
            />
            <UISelect
              label={copy.settings.sections.lyrics.textAlignmentLabel}
              helper={copy.settings.sections.lyrics.textAlignmentHelper}
              value={settings.lyrics.textAlignment}
              options={lyricTextAlignmentOptions}
              onChange={(value) =>
                onUpdate((current) => ({
                  ...current,
                  lyrics: {
                    ...current.lyrics,
                    textAlignment:
                      value === "center" ? "center" : value === "right" ? "right" : "left",
                  },
                }))
              }
            />
            <UISelect
              label={copy.settings.sections.lyrics.renderModeLabel}
              helper={copy.settings.sections.lyrics.renderModeHelper}
              value={settings.lyrics.renderMode}
              options={lyricRenderModeOptions}
              onChange={(value) =>
                onUpdate((current) => ({
                  ...current,
                  lyrics: {
                    ...current.lyrics,
                    renderMode:
                      value === "simple"
                        ? "simple"
                        : value === "balanced"
                          ? "balanced"
                          : "advanced",
                  },
                }))
              }
            />
            <UISwitch
              label={copy.settings.sections.lyrics.progressBarPreviewLabel}
              description={copy.settings.sections.lyrics.progressBarPreviewDescription}
              checked={settings.lyrics.progressBarPreview}
              onChange={(checked) =>
                onUpdate((current) => ({
                  ...current,
                  lyrics: {
                    ...current.lyrics,
                    progressBarPreview: checked,
                  },
                }))
              }
            />
            <UISlider
              label={copy.settings.sections.lyrics.fontSizeLabel}
              value={settings.lyrics.fontSize}
              min={80}
              max={160}
              step={1}
              valueSuffix="%"
              onChange={(value) =>
                onUpdate((current) => ({
                  ...current,
                  lyrics: {
                    ...current.lyrics,
                    fontSize: Math.round(value),
                  },
                }))
              }
              />
            <span className="ui-field__helper">{copy.settings.sections.lyrics.fontSizeHelper}</span>
            <UISlider
              label={copy.settings.sections.lyrics.lineSpacingLabel}
              value={settings.lyrics.lineSpacing}
              min={80}
              max={180}
              step={1}
              valueSuffix="%"
              onChange={(value) =>
                onUpdate((current) => ({
                  ...current,
                  lyrics: {
                    ...current.lyrics,
                    lineSpacing: Math.round(value),
                  },
                }))
              }
            />
            <span className="ui-field__helper">
              {copy.settings.sections.lyrics.lineSpacingHelper}
            </span>
            <UISwitch
              label={copy.settings.sections.lyrics.textShadowLabel}
              description={copy.settings.sections.lyrics.textShadowDescription}
              checked={settings.lyrics.textShadow}
              onChange={(checked) =>
                onUpdate((current) => ({
                  ...current,
                  lyrics: {
                    ...current.lyrics,
                    textShadow: checked,
                  },
                }))
              }
            />
            <UISlider
              label={copy.settings.sections.lyrics.textShadowIntensityLabel}
              value={settings.lyrics.textShadowIntensity}
              min={0}
              max={200}
              step={1}
              valueSuffix="%"
              onChange={(value) =>
                onUpdate((current) => ({
                  ...current,
                  lyrics: {
                    ...current.lyrics,
                    textShadowIntensity: clampNumber(Math.round(value), 0, 200),
                  },
                }))
              }
            />
            <span className="ui-field__helper">
              {copy.settings.sections.lyrics.textShadowIntensityHelper}
            </span>
            <UISlider
              label={copy.settings.sections.lyrics.textShadowDefinitionLabel}
              value={settings.lyrics.textShadowDefinition}
              min={0}
              max={100}
              step={1}
              valueSuffix="%"
              onChange={(value) =>
                onUpdate((current) => ({
                  ...current,
                  lyrics: {
                    ...current.lyrics,
                    textShadowDefinition: clampNumber(Math.round(value), 0, 100),
                  },
                }))
              }
            />
            <span className="ui-field__helper">
              {copy.settings.sections.lyrics.textShadowDefinitionHelper}
            </span>
            <UISwitch
              label={copy.settings.sections.lyrics.glowLabel}
              description={copy.settings.sections.lyrics.glowDescription}
              checked={settings.lyrics.glow}
              onChange={(checked) =>
                onUpdate((current) => ({
                  ...current,
                  lyrics: {
                    ...current.lyrics,
                    glow: checked,
                  },
                }))
              }
            />
            <UISlider
              label={copy.settings.sections.lyrics.glowIntensityLabel}
              value={settings.lyrics.glowIntensity}
              min={0}
              max={200}
              step={1}
              valueSuffix="%"
              onChange={(value) =>
                onUpdate((current) => ({
                  ...current,
                  lyrics: {
                    ...current.lyrics,
                    glowIntensity: clampNumber(Math.round(value), 0, 200),
                  },
                }))
              }
            />
            <span className="ui-field__helper">
              {copy.settings.sections.lyrics.glowIntensityHelper}
            </span>
            <UISlider
              label={copy.settings.sections.lyrics.glowDefinitionLabel}
              value={settings.lyrics.glowDefinition}
              min={0}
              max={100}
              step={1}
              valueSuffix="%"
              onChange={(value) =>
                onUpdate((current) => ({
                  ...current,
                  lyrics: {
                    ...current.lyrics,
                    glowDefinition: clampNumber(Math.round(value), 0, 100),
                  },
                }))
              }
            />
            <span className="ui-field__helper">
              {copy.settings.sections.lyrics.glowDefinitionHelper}
            </span>
            <UISlider
              label={copy.settings.sections.lyrics.blurRangeLabel}
              value={settings.lyrics.blurRange}
              min={0}
              max={100}
              step={1}
              valueSuffix="%"
              onChange={(value) =>
                onUpdate((current) => ({
                  ...current,
                  lyrics: {
                    ...current.lyrics,
                    blurRange: clampNumber(Math.round(value), 0, 100),
                  },
                }))
              }
            />
            <span className="ui-field__helper">
              {copy.settings.sections.lyrics.blurRangeHelper}
            </span>
            <UISlider
              label={copy.settings.sections.lyrics.curveAmountLabel}
              value={settings.lyrics.curveAmount}
              min={-100}
              max={100}
              step={1}
              valueSuffix="%"
              onChange={(value) =>
                onUpdate((current) => ({
                  ...current,
                  lyrics: {
                    ...current.lyrics,
                    curveAmount: Math.round(value),
                  },
                }))
              }
            />
            <span className="ui-field__helper">
              {copy.settings.sections.lyrics.curveAmountHelper}
            </span>
            <UISlider
              label={copy.settings.sections.lyrics.animationSpeedLabel}
              value={settings.lyrics.animationSpeed}
              min={50}
              max={200}
              step={5}
              valueSuffix="%"
              onChange={(value) =>
                onUpdate((current) => ({
                  ...current,
                  lyrics: {
                    ...current.lyrics,
                    animationSpeed: Math.round(value),
                  },
                }))
              }
            />
            <span className="ui-field__helper">
              {copy.settings.sections.lyrics.animationSpeedHelper}
            </span>
            <UISlider
              label={copy.settings.sections.lyrics.lineAnimationStaggerLabel}
              value={settings.lyrics.lineAnimationStaggerMs}
              min={0}
              max={240}
              step={5}
              valueSuffix="ms"
              onChange={(value) =>
                onUpdate((current) => ({
                  ...current,
                  lyrics: {
                    ...current.lyrics,
                    lineAnimationStaggerMs: clampNumber(Math.round(value), 0, 240),
                  },
                }))
              }
            />
            <span className="ui-field__helper">
              {copy.settings.sections.lyrics.lineAnimationStaggerHelper}
            </span>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card__header">
            <div>
              <h3 className="settings-card__title">{copy.settings.sections.playback.title}</h3>
            </div>
          </div>

          <div className="settings-card__body">
            {isNeteaseEnabled ? (
              <UISelect
                label={copy.settings.sections.playback.qualityLabel}
                value={settings.playback.preferredQuality}
                options={[...qualityOptions]}
                onChange={(value) =>
                  onUpdate((current) => ({
                    ...current,
                    playback: {
                      ...current.playback,
                      preferredQuality: value,
                    },
                  }))
                }
              />
            ) : null}
            {isNeteaseEnabled ? (
              <>
                <UISelect
                  label={copy.settings.sections.playback.cacheModeLabel}
                  value={settings.playback.cacheMode}
                  options={playbackCacheModeOptions}
                  onChange={(value) =>
                    onUpdate((current) => ({
                      ...current,
                      playback: {
                        ...current.playback,
                        cacheMode: value as PlaybackCacheMode,
                      },
                    }))
                  }
                />
                <span className="ui-field__helper">
                  {copy.settings.sections.playback.cacheModeDescription}
                </span>
              </>
            ) : null}
            {isNeteaseEnabled ? (
              <UISwitch
                label={copy.settings.sections.playback.preferRemoteLabel}
                description={copy.settings.sections.playback.preferRemoteDescription}
                checked={settings.playback.preferRemoteStreaming}
                onChange={(checked) =>
                  onUpdate((current) => ({
                    ...current,
                    playback: {
                      ...current.playback,
                      preferRemoteStreaming: checked,
                    },
                  }))
                }
              />
            ) : null}
            <UISwitch
              label={copy.settings.sections.playback.songTransitionLabel}
              description={copy.settings.sections.playback.songTransitionDescription}
              checked={settings.playback.songTransitionEnabled}
              onChange={(checked) =>
                onUpdate((current) => ({
                  ...current,
                  playback: {
                    ...current.playback,
                    songTransitionEnabled: checked,
                  },
                }))
              }
            />
            {settings.playback.songTransitionEnabled ? (
              <>
                <UISelect
                  label={copy.settings.sections.playback.songTransitionModeLabel}
                  value={settings.playback.songTransitionMode}
                  options={[
                    {
                      label: copy.settings.sections.playback.songTransitionModeSimpleMix,
                      value: "simple-mix",
                      description:
                        copy.settings.sections.playback.songTransitionModeSimpleMixDescription,
                    },
                    {
                      label: copy.settings.sections.playback.songTransitionModeAutoMix,
                      value: "auto-mix",
                      description:
                        copy.settings.sections.playback.songTransitionModeAutoMixDescription,
                    },
                  ]}
                  onChange={(value) =>
                    onUpdate((current) => ({
                      ...current,
                      playback: {
                        ...current.playback,
                        songTransitionMode:
                          value === "auto-mix" ? "auto-mix" : "simple-mix",
                      },
                    }))
                  }
                />
                <span className="ui-field__helper">
                  {copy.settings.sections.playback.songTransitionModeDescription}
                </span>
                <UISlider
                  label={copy.settings.sections.playback.songTransitionTimingLabel}
                  value={settings.playback.songTransitionStartMs}
                  min={SONG_TRANSITION_MIN_MS}
                  max={SONG_TRANSITION_MAX_MS}
                  step={100}
                  valueSuffix="ms"
                  onChange={(value) =>
                    onUpdate((current) => ({
                      ...current,
                      playback: {
                        ...current.playback,
                        songTransitionStartMs: Math.round(value),
                      },
                    }))
                  }
                />
                <span className="ui-field__helper">
                  {copy.settings.sections.playback.songTransitionTimingHelper}
                </span>
              </>
            ) : null}
            <UICheckbox
              label={copy.settings.sections.playback.rememberQueueLabel}
              description={copy.settings.sections.playback.rememberQueueDescription}
              checked={settings.playback.rememberQueue}
              onChange={(checked) =>
                onUpdate((current) => ({
                  ...current,
                  playback: {
                    ...current.playback,
                    rememberQueue: checked,
                  },
                }))
              }
            />
          </div>
        </section>

        <ShortcutSettingsSection copy={copy} bindings={settings.shortcuts} onUpdate={onUpdate} />

        <section className="settings-card">
          <div className="settings-card__header">
            <div>
              <h3 className="settings-card__title">{copy.settings.sections.library.title}</h3>
            </div>
          </div>

          <div className="settings-card__body">
            <div className="settings-inline-actions">
              <UIButton
                variant="secondary"
                size="sm"
                onClick={onPickScanDirectory}
                disabled={isLoading || isSaving}
              >
                {copy.settings.sections.library.addDirectory}
              </UIButton>
              <UIButton
                variant="danger"
                size="sm"
                onClick={onClearLibrary}
                disabled={isLoading || isSaving || isClearingLibrary}
              >
                {isClearingLibrary
                  ? copy.settings.sections.library.clearing
                  : copy.settings.sections.library.clearLibrary}
              </UIButton>
            </div>
            <UITextField
              label={copy.settings.sections.library.directoriesLabel}
              value={scanDirectoriesText}
              placeholder="例如 D:\\Music, E:\\Lossless"
              helper={copy.settings.sections.library.directoriesHelper}
              onChange={(value) =>
                onUpdate((current) => ({
                  ...current,
                  library: {
                    ...current.library,
                    scanDirectories: splitCommaSeparatedValues(value),
                  },
                }))
              }
            />
            <UISwitch
              label={copy.settings.sections.library.watchLabel}
              description={copy.settings.sections.library.watchDescription}
              checked={settings.library.watchDirectories}
              onChange={(checked) =>
                onUpdate((current) => ({
                  ...current,
                  library: {
                    ...current.library,
                    watchDirectories: checked,
                  },
                }))
              }
            />
            <UICheckbox
              label={copy.settings.sections.library.importArtworkLabel}
              description={copy.settings.sections.library.importArtworkDescription}
              checked={settings.library.autoImportArtwork}
              onChange={(checked) =>
                onUpdate((current) => ({
                  ...current,
                  library: {
                    ...current.library,
                    autoImportArtwork: checked,
                  },
                }))
              }
            />
            <UICheckbox
              label={copy.settings.sections.library.embeddedLabel}
              description={copy.settings.sections.library.embeddedDescription}
              checked={settings.library.extractEmbeddedArtwork}
              onChange={(checked) =>
                onUpdate((current) => ({
                  ...current,
                  library: {
                    ...current.library,
                    extractEmbeddedArtwork: checked,
                  },
                }))
              }
            />
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card__header">
            <div>
              <h3 className="settings-card__title">{copy.settings.sections.network.title}</h3>
            </div>
          </div>

          <div className="settings-card__body">
            <UISwitch
              label={copy.settings.sections.network.sourceLabel}
              description={copy.settings.sections.network.sourceDescription}
              checked={isNeteaseEnabled}
              onChange={(checked) =>
                onUpdate((current) => ({
                  ...current,
                  network: {
                    ...current.network,
                    enabledSources: checked ? ["netease"] : [],
                  },
                }))
              }
            />
            {isNeteaseEnabled ? (
              <>
                <UISwitch
                  label={copy.settings.sections.network.localApiLabel}
                  description={copy.settings.sections.network.localApiDescription}
                  checked={settings.network.useLocalApiServer}
                  onChange={(checked) =>
                    onUpdate((current) => ({
                      ...current,
                      network: {
                        ...current.network,
                        useLocalApiServer: checked,
                      },
                    }))
                  }
                />
                {showLocalApiPanel ? (
                  <div className="local-api-console">
                    <div className="local-api-console__header">
                      <div className="local-api-console__status">
                        <span
                          className={`local-api-console__status-dot local-api-console__status-dot--${localApiStatusTone}`}
                        />
                        <strong>{copy.settings.sections.network.localApiStatusTitle}</strong>
                        <span>{localApiStatusLabel}</span>
                      </div>
                      <span className="local-api-console__address">
                        {(localNeteaseApiStatus?.url || "http://127.0.0.1:3000").replace(/\/$/, "")}
                      </span>
                    </div>
                    <p className="local-api-console__message">{localApiMessage}</p>
                    <div
                      className="local-api-console__output"
                      aria-label={copy.settings.sections.network.localApiOutputTitle}
                    >
                      {localNeteaseApiStatus?.logLines.length ? (
                        localNeteaseApiStatus.logLines.map((line, index) => (
                          <div key={`${index}-${line}`} className="local-api-console__line">
                            {line}
                          </div>
                        ))
                      ) : (
                        <div className="local-api-console__placeholder">
                          {copy.settings.sections.network.localApiOutputEmpty}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <UITextField
                      label={copy.settings.sections.network.apiBaseUrlLabel}
                      value={settings.network.neteaseApiBaseUrl}
                      placeholder="http://127.0.0.1:3000"
                      helper={copy.settings.sections.network.apiBaseUrlHelper}
                      onChange={(value) =>
                        onUpdate((current) => ({
                          ...current,
                          network: {
                            ...current.network,
                            neteaseApiBaseUrl: value,
                          },
                        }))
                      }
                    />
                    <UITextField
                      label={copy.settings.sections.network.proxyLabel}
                      value={settings.network.neteaseProxy}
                      placeholder="http://127.0.0.1:7890"
                      helper={copy.settings.sections.network.proxyHelper}
                      onChange={(value) =>
                        onUpdate((current) => ({
                          ...current,
                          network: {
                            ...current.network,
                            neteaseProxy: value,
                          },
                        }))
                      }
                    />
                    <UITextField
                      label={copy.settings.sections.network.realIpLabel}
                      value={settings.network.neteaseRealIp}
                      placeholder="118.88.88.88"
                      helper={copy.settings.sections.network.realIpHelper}
                      onChange={(value) =>
                        onUpdate((current) => ({
                          ...current,
                          network: {
                            ...current.network,
                            neteaseRealIp: value,
                          },
                        }))
                      }
                    />
                  </>
                )}
                <UITextField
                  label={copy.settings.sections.network.cookieLabel}
                  value={settings.network.neteaseCookie}
                  placeholder="MUSIC_U=..."
                  helper={copy.settings.sections.network.cookieHelper}
                  onChange={(value) =>
                    onUpdate((current) => ({
                      ...current,
                      network: {
                        ...current.network,
                        neteaseCookie: value,
                      },
                    }))
                  }
                />
                <UITextField
                  label={copy.settings.sections.network.timeoutLabel}
                  value={String(settings.network.requestTimeoutMs)}
                  placeholder="15000"
                  helper={copy.settings.sections.network.timeoutHelper}
                  onChange={(value) =>
                    onUpdate((current) => ({
                      ...current,
                      network: {
                        ...current.network,
                        requestTimeoutMs: sanitizePositiveNumber(
                          value,
                          current.network.requestTimeoutMs,
                        ),
                      },
                    }))
                  }
                />
                <div className="settings-inline-actions">
                  <UIButton
                    variant="secondary"
                    onClick={onTestNeteaseApi}
                    disabled={isLoading || isSaving || isTestingNeteaseApi || !isNeteaseEnabled}
                  >
                    {isTestingNeteaseApi
                      ? copy.settings.sections.network.testingLabel
                      : copy.settings.sections.network.testLabel}
                  </UIButton>
                </div>
                <UISwitch
                  label={copy.settings.sections.network.meteredLabel}
                  description={copy.settings.sections.network.meteredDescription}
                  checked={settings.network.allowMeteredNetwork}
                  onChange={(checked) =>
                    onUpdate((current) => ({
                      ...current,
                      network: {
                        ...current.network,
                        allowMeteredNetwork: checked,
                      },
                    }))
                  }
                />
                <UICheckbox
                  label={copy.settings.sections.network.metadataLabel}
                  description={copy.settings.sections.network.metadataDescription}
                  checked={settings.network.preferOnlineMetadata}
                  onChange={(checked) =>
                    onUpdate((current) => ({
                      ...current,
                      network: {
                        ...current.network,
                        preferOnlineMetadata: checked,
                      },
                    }))
                  }
                />
              </>
            ) : null}
          </div>
        </section>

        {isNeteaseEnabled ? (
          <section className="settings-card">
            <div className="settings-card__header">
              <div>
                <h3 className="settings-card__title">
                  {showNeteaseQrLogin
                    ? copy.settings.sections.network.loginTitle
                    : copy.settings.sections.network.accountTitle}
                </h3>
              </div>
            </div>

            <div className="settings-card__body">
              <p className="settings-screen__description settings-screen__description--compact">
                {showNeteaseQrLogin
                  ? copy.settings.sections.network.loginDescription
                  : copy.settings.sections.network.accountDescription}
              </p>

              {showNeteaseQrLogin ? (
                <div className="netease-login-panel">
                  <div className="netease-login-panel__preview">
                    {qrLoginSession?.qrImage ? (
                      <img
                        className="netease-login-panel__qr-image"
                        src={qrLoginSession.qrImage}
                        alt={copy.settings.sections.network.loginTitle}
                      />
                    ) : (
                      <div className="netease-login-panel__qr-placeholder">
                        <span>{qrLoginStatusLabel}</span>
                      </div>
                    )}
                  </div>

                  <div className="netease-login-panel__content">
                    <div className="netease-login-panel__status">
                      <strong>{qrLoginStatusLabel}</strong>
                      <span>{qrLoginMessage || copy.settings.sections.network.loginHint}</span>
                    </div>

                    <div className="netease-login-panel__cookie">
                      <span className="netease-login-panel__cookie-label">
                        {copy.settings.sections.network.loginCookieLabel}
                      </span>
                      <div className="netease-login-panel__cookie-value">{neteaseCookiePreview}</div>
                    </div>

                    <div className="settings-inline-actions">
                      <UIButton
                        variant="primary"
                        onClick={() => void handleGenerateQrLogin()}
                        disabled={!isNeteaseEnabled || isQrLoginBusy || isSaving || isLoading}
                      >
                        {qrLoginSession
                          ? copy.settings.sections.network.loginRefresh
                          : copy.settings.sections.network.loginGenerate}
                      </UIButton>
                      <UIButton
                        variant="secondary"
                        onClick={handleStopQrLoginPolling}
                        disabled={!qrLoginSession}
                      >
                        {copy.settings.sections.network.loginStop}
                      </UIButton>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="settings-inline-actions">
                    <UIButton
                      variant="secondary"
                      onClick={() => void handleRefreshNeteaseAccount()}
                      disabled={!isNeteaseEnabled || !hasSavedNeteaseCookie || isLoadingNeteaseAccount}
                    >
                      {copy.settings.sections.network.accountRefresh}
                    </UIButton>
                    <UIButton
                      variant="ghost"
                      onClick={() => void handleClearSavedNeteaseLogin()}
                      disabled={!hasSavedNeteaseCookie || isClearingNeteaseLogin}
                    >
                      {copy.settings.sections.network.loginClear}
                    </UIButton>
                  </div>

                  {isLoadingNeteaseAccount ? (
                    <div className="netease-account-card netease-account-card--empty">
                      <UILoadingBlock
                        label={copy.settings.sections.network.accountLoading}
                        variant="inline"
                      />
                    </div>
                  ) : neteaseAccount ? (
                    <div className="netease-account-card">
                      <div className="netease-account-card__header">
                        <div className="netease-account-card__avatar">
                          {neteaseAccount.avatarUrl ? (
                            <img src={neteaseAccount.avatarUrl} alt={neteaseAccount.nickname} />
                          ) : (
                            <span>{neteaseAccount.nickname.slice(0, 1)}</span>
                          )}
                        </div>
                        <div className="netease-account-card__identity">
                          <strong>{neteaseAccount.nickname}</strong>
                          <span>
                            {copy.settings.sections.network.accountIdLabel}: {neteaseAccount.userId}
                          </span>
                        </div>
                      </div>

                      <div className="netease-account-card__meta">
                        <span className="netease-account-card__chip">
                          {copy.settings.sections.network.accountLevelLabel}:{" "}
                          {neteaseAccount.level ?? "--"}
                        </span>
                        <span className="netease-account-card__chip">
                          {copy.settings.sections.network.accountVipLabel}:{" "}
                          {neteaseAccount.vipType && neteaseAccount.vipType > 0
                            ? copy.settings.sections.network.accountVipActive
                            : copy.settings.sections.network.accountVipInactive}
                        </span>
                      </div>

                      <p className="netease-account-card__signature">
                        {neteaseAccount.signature ||
                          copy.settings.sections.network.accountSignatureEmpty}
                      </p>
                    </div>
                  ) : (
                    <div className="netease-account-card netease-account-card--empty">
                      {neteaseAccountError || copy.settings.sections.network.accountEmpty}
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        ) : null}

        <section className="settings-card settings-card--wide">
          <div className="settings-card__header">
            <div>
              <h3 className="settings-card__title">
                {copy.settings.sections.library.releaseMemoryCache}
              </h3>
            </div>
          </div>

          <div className="settings-card__body">
            <p className="settings-screen__description settings-screen__description--compact">
              {copy.settings.sections.library.releaseMemoryCacheDescription}
            </p>
            <div className="settings-inline-actions">
              <UIButton
                variant="secondary"
                className="settings-memory-release-button"
                onClick={() => void handleReleaseMemoryCacheClick()}
                disabled={isLoading || isSaving || isReleasingMemoryCache}
              >
                <span className="settings-memory-release-button__original">
                  {isReleasingMemoryCache
                    ? copy.settings.sections.library.releasingMemoryCache
                    : copy.settings.sections.library.releaseMemoryCache}
                </span>
                <span className="settings-memory-release-button__letters" aria-hidden="true">
                  {(isReleasingMemoryCache
                    ? copy.settings.sections.library.releasingMemoryCache
                    : copy.settings.sections.library.releaseMemoryCache
                  )
                    .split("")
                    .map((letter, index) => (
                      <span
                        key={`memory-release-letter:${index}:${letter || "space"}`}
                        className="settings-memory-release-button__letter"
                      >
                        {letter === " " ? "\u00A0" : letter}
                      </span>
                    ))}
                </span>
              </UIButton>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

function ThemePreviewCard({ settings }: { settings: AppSettings }) {
  const seed = getThemeSeed(settings.appearance.themeMode, settings.appearance);
  const backgroundMediaKind = getBackgroundMediaKind(settings.appearance.backgroundImagePath);
  const backgroundImageStyle =
    backgroundMediaKind === "image"
      ? resolveBackgroundImageStyle(settings.appearance.backgroundImagePath)
      : "none";
  const backgroundVideoSrc =
    backgroundMediaKind === "video"
      ? resolveBackgroundMediaSrc(settings.appearance.backgroundImagePath)
      : null;
  const previewStyle = buildThemeStyle(
    settings.appearance,
    backgroundImageStyle,
    backgroundMediaKind,
  );

  return (
    <div className="theme-preview" style={previewStyle}>
      {settings.appearance.backgroundMode === "custom" && backgroundVideoSrc ? (
        <video
          key={backgroundVideoSrc}
          className="theme-preview__video"
          src={backgroundVideoSrc}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
        />
      ) : null}
      <div className="theme-preview__chrome">
        <span />
        <span />
        <span />
      </div>
      <div className="theme-preview__hero">
        <div className="theme-preview__island" />
        <div className="theme-preview__heading">
          <strong>CELIA</strong>
          <span>{settings.appearance.colorScheme === "dark" ? "Dark" : "Light"}</span>
        </div>
      </div>
      <div className="theme-preview__content">
        <div className="theme-preview__grid">
          <div className="theme-preview__panel">
            <div className="theme-preview__line theme-preview__line--strong" />
            <div className="theme-preview__line" />
            <div className="theme-preview__line theme-preview__line--short" />
          </div>
          <div className="theme-preview__panel">
            <div className="theme-preview__chips">
              <span style={{ background: seed.primary }} />
              <span style={{ background: seed.secondary }} />
              <span style={{ background: seed.surface }} />
            </div>
            <div className="theme-preview__bar" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ThemePresetButton({
  option,
  settings,
  active,
  activeText,
  customTag,
  onClick,
}: {
  option: UISelectOption;
  settings: AppSettings;
  active: boolean;
  activeText: string;
  customTag: string;
  onClick: () => void;
}) {
  const seed = getThemeSeed(option.value, settings.appearance);

  return (
    <button
      aria-pressed={active}
      className={["theme-preset-card", active ? "theme-preset-card--active" : ""]
        .filter(Boolean)
        .join(" ")}
      type="button"
      onClick={onClick}
    >
      <div className="theme-preset-card__swatches" aria-hidden="true">
        <span style={{ background: seed.primary }} />
        <span style={{ background: seed.secondary }} />
        <span style={{ background: seed.surface }} />
      </div>
      <div className="theme-preset-card__content">
        <div className="theme-preset-card__title-row">
          <strong>{option.label}</strong>
          <span className="theme-preset-card__badge">
            {option.value === "custom" ? customTag : active ? activeText : ""}
          </span>
        </div>
      </div>
    </button>
  );
}

function ThemeColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const spectrumRef = useRef<HTMLDivElement | null>(null);
  const hueRef = useRef<HTMLDivElement | null>(null);
  const [textValue, setTextValue] = useState(value);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [popoverPlacement, setPopoverPlacement] = useState<{
    vertical: "down" | "up";
    horizontal: "start" | "end";
  }>({
    vertical: "down",
    horizontal: "start",
  });
  const normalizedValue = sanitizeHexColor(value, "#7aa2d6");
  const hsv = rgbToHsv(parseHexColor(normalizedValue));

  useEffect(() => {
    setTextValue(value);
  }, [value]);

  useEffect(() => {
    if (!isPickerOpen) {
      return undefined;
    }

    const handleWindowPointerDown = (event: PointerEvent) => {
      if (!fieldRef.current?.contains(event.target as Node)) {
        setIsPickerOpen(false);
      }
    };

    window.addEventListener("pointerdown", handleWindowPointerDown);
    return () => {
      window.removeEventListener("pointerdown", handleWindowPointerDown);
    };
  }, [isPickerOpen]);

  useEffect(() => {
    if (!isPickerOpen) {
      return undefined;
    }

    const updatePopoverPlacement = () => {
      const field = fieldRef.current;
      const popover = popoverRef.current;

      if (!field || !popover) {
        return;
      }

      const viewportPadding = 20;
      const fieldRect = field.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const spaceBelow = window.innerHeight - fieldRect.bottom - viewportPadding;
      const spaceAbove = fieldRect.top - viewportPadding;
      const spaceRight = window.innerWidth - fieldRect.left - viewportPadding;
      const spaceLeft = fieldRect.right - viewportPadding;

      const nextPlacement = {
        vertical:
          spaceBelow >= popoverRect.height || spaceBelow >= spaceAbove ? "down" : "up",
        horizontal:
          spaceRight >= popoverRect.width || spaceRight >= spaceLeft ? "start" : "end",
      } as const;

      setPopoverPlacement((current) =>
        current.vertical === nextPlacement.vertical &&
        current.horizontal === nextPlacement.horizontal
          ? current
          : nextPlacement,
      );
    };

    const frameId = window.requestAnimationFrame(updatePopoverPlacement);
    window.addEventListener("resize", updatePopoverPlacement);
    window.addEventListener("scroll", updatePopoverPlacement, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updatePopoverPlacement);
      window.removeEventListener("scroll", updatePopoverPlacement, true);
    };
  }, [isPickerOpen, normalizedValue]);

  const handleTextChange = (nextValue: string) => {
    setTextValue(nextValue);

    const normalized = nextValue.startsWith("#") ? nextValue : `#${nextValue}`;
    if (/^#[0-9a-f]{6}$/i.test(normalized)) {
      onChange(normalized.toLowerCase());
    }
  };

  const commitTextValue = () => {
    const normalized = sanitizeHexColor(textValue.startsWith("#") ? textValue : `#${textValue}`, value);
    setTextValue(normalized);
    onChange(normalized);
  };

  const updateFromSpectrum = (clientX: number, clientY: number) => {
    const panel = spectrumRef.current;

    if (!panel) {
      return;
    }

    const rect = panel.getBoundingClientRect();
    const nextSaturation = rect.width <= 0 ? 0 : clamp01((clientX - rect.left) / rect.width);
    const nextValue = rect.height <= 0 ? 0 : clamp01(1 - (clientY - rect.top) / rect.height);
    onChange(hsvToHexColor({ h: hsv.h, s: nextSaturation, v: nextValue }));
  };

  const updateFromHue = (clientX: number) => {
    const panel = hueRef.current;

    if (!panel) {
      return;
    }

    const rect = panel.getBoundingClientRect();
    const ratio = rect.width <= 0 ? 0 : clamp01((clientX - rect.left) / rect.width);
    onChange(hsvToHexColor({ h: ratio * 360, s: hsv.s, v: hsv.v }));
  };

  return (
    <div className="theme-color-field" ref={fieldRef}>
      <span className="theme-color-field__label">{label}</span>
      <span className="theme-color-field__control">
        <button
          className="theme-color-field__swatch-button"
          type="button"
          aria-label={`${label} color picker`}
          aria-expanded={isPickerOpen}
          onClick={() => setIsPickerOpen((current) => !current)}
        >
          <span
            className="theme-color-field__swatch"
            style={{
              background: normalizedValue,
              boxShadow: `inset 0 0 0 1px ${withHexAlpha(mixHexColors(normalizedValue, "#ffffff", 0.2), 0.36)}`,
            }}
          />
        </button>
        <input
          className="theme-color-field__text"
          type="text"
          value={textValue}
          inputMode="text"
          spellCheck={false}
          maxLength={7}
          onChange={(event) => handleTextChange(event.target.value)}
          onBlur={commitTextValue}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commitTextValue();
              setIsPickerOpen(false);
            }
          }}
        />
      </span>
      <div
        ref={popoverRef}
        className={[
          "theme-color-field__popover",
          isPickerOpen ? "theme-color-field__popover--open" : "",
          popoverPlacement.vertical === "up" ? "theme-color-field__popover--up" : "",
          popoverPlacement.horizontal === "end" ? "theme-color-field__popover--align-end" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="theme-color-field__popover-top">
          <div
            ref={spectrumRef}
            className="theme-color-field__spectrum"
            style={{ backgroundColor: hsvToHexColor({ h: hsv.h, s: 1, v: 1 }) }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              updateFromSpectrum(event.clientX, event.clientY);
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
                return;
              }

              updateFromSpectrum(event.clientX, event.clientY);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerCancel={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
          >
            <span
              className="theme-color-field__spectrum-thumb"
              style={{
                left: `${hsv.s * 100}%`,
                top: `${(1 - hsv.v) * 100}%`,
              }}
            />
          </div>
          <div className="theme-color-field__meta">
            <span className="theme-color-field__meta-chip">{normalizedValue.toUpperCase()}</span>
            <span
              className="theme-color-field__meta-preview"
              style={{ background: normalizedValue }}
            />
          </div>
        </div>
        <div
          ref={hueRef}
          className="theme-color-field__hue"
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            updateFromHue(event.clientX);
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
              return;
            }

            updateFromHue(event.clientX);
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onPointerCancel={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
        >
          <span
            className="theme-color-field__hue-thumb"
            style={{ left: `${(hsv.h / 360) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function SongMetaButton({
  label,
  onClick,
  disabled = false,
  className,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      className={["song-meta-link", className].filter(Boolean).join(" ")}
      type="button"
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!disabled) {
          onClick?.();
        }
      }}
    >
      {label}
    </button>
  );
}

function SongArtistLinks({
  artists,
  fallback,
}: {
  artists: Array<{
    key: string;
    name: string;
    onClick?: () => void;
  }>;
  fallback: string;
}) {
  const visibleArtists = artists.filter((artist) => artist.name.trim().length > 0);

  if (visibleArtists.length === 0) {
    return <span>{fallback}</span>;
  }

  return (
    <span className="song-meta-links">
      {visibleArtists.map((artist, index) => (
        <span key={artist.key} className="song-meta-links__item">
          <SongMetaButton
            label={artist.name}
            onClick={artist.onClick}
            disabled={!artist.onClick}
          />
          {index < visibleArtists.length - 1 ? (
            <span className="song-meta-links__separator"> / </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}

function HomeScreen({
  copy,
  settings,
  dataVersion,
  mediaLibrary,
  isLibraryLoading,
  onOpenLibrary,
  onImportMusic,
  onPlayLocalTrack,
  onPlayNeteaseTrack,
  onPlayPersonalFmTrack,
  onOpenTrackArtist,
  onOpenTrackAlbum,
  onOpenSongArtist,
  onOpenSongAlbum,
  onOpenPlaylist,
  onTrackContextMenu,
  onSongContextMenu,
  onPlaylistContextMenu,
}: {
  copy: UiCopy;
  settings: AppSettings;
  dataVersion: number;
  mediaLibrary: MediaLibrarySnapshot | null;
  isLibraryLoading: boolean;
  onOpenLibrary: () => void;
  onImportMusic: () => void;
  onPlayLocalTrack: (trackId: string, queueTracks: TrackRecord[]) => void;
  onPlayNeteaseTrack: (trackId: number, queueSongs: NeteaseSongDetail[]) => void;
  onPlayPersonalFmTrack: (trackId: number, queueSongs: NeteaseSongDetail[]) => void;
  onOpenTrackArtist: (track: TrackRecord) => void;
  onOpenTrackAlbum: (track: TrackRecord) => void;
  onOpenSongArtist: (artistId: number, artistName: string) => void;
  onOpenSongAlbum: (albumId: number, albumName: string) => void;
  onOpenPlaylist: (playlist: PlaylistSelection) => void;
  onTrackContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    track: TrackRecord,
    queueTracks: TrackRecord[],
  ) => void;
  onSongContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    song: NeteaseSongDetail,
    queueSongs: NeteaseSongDetail[],
  ) => void;
  onPlaylistContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    playlist: NeteasePlaylistRecommendation,
  ) => void;
}) {
  const homeCopy = getHomeCopy(copy.locale);
  const tracks = mediaLibrary?.tracks ?? [];
  const artworksById = new Map((mediaLibrary?.artworks ?? []).map((artwork) => [artwork.id, artwork]));
  const localTracks = tracks.filter((track) => track.source.kind === "localFile");
  const uniqueArtists = new Set(
    tracks.map((track) => track.artist?.trim()).filter((artist): artist is string => Boolean(artist)),
  );
  const uniqueAlbums = new Set(
    tracks.map((track) => track.album?.trim()).filter((album): album is string => Boolean(album)),
  );
  const offlineRecommendations = buildHomeOfflineRecommendations(localTracks, 8);
  const isNeteaseEnabled = isNeteaseSourceEnabled(settings);
  const hasSavedNeteaseCookie = settings.network.neteaseCookie.trim().length > 0;
  const [neteaseAccount, setNeteaseAccount] = useState<NeteaseAccountProfile | null>(null);
  const [isHomeLoading, setIsHomeLoading] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [guestSongs, setGuestSongs] = useState<NeteaseSongDetail[]>([]);
  const [dailySongs, setDailySongs] = useState<NeteaseSongDetail[]>([]);
  const [personalFmSongs, setPersonalFmSongs] = useState<NeteaseSongDetail[]>([]);
  const [likedPlaylist, setLikedPlaylist] = useState<NeteasePlaylistRecommendation | null>(null);
  const [dailyPlaylists, setDailyPlaylists] = useState<NeteasePlaylistRecommendation[]>([]);
  const [guessPlaylists, setGuessPlaylists] = useState<NeteasePlaylistRecommendation[]>([]);
  const [isPersonalFmRefreshing, setIsPersonalFmRefreshing] = useState(false);
  const [personalFmError, setPersonalFmError] = useState<string | null>(null);
  const applyHomeFeedCache = (entry: NeteaseHomeFeedCacheEntry) => {
    setNeteaseAccount(entry.account);
    setGuestSongs(entry.guestSongs);
    setDailySongs(entry.dailySongs);
    setPersonalFmSongs(entry.personalFmSongs);
    setPersonalFmError(null);
    setIsPersonalFmRefreshing(false);
    setLikedPlaylist(entry.likedPlaylist);
    setDailyPlaylists(entry.dailyPlaylists);
    setGuessPlaylists(entry.guessPlaylists);
  };

  useEffect(() => {
    let isDisposed = false;

    const clearOnlineState = () => {
      setNeteaseAccount(null);
      setGuestSongs([]);
      setDailySongs([]);
      setPersonalFmSongs([]);
      setLikedPlaylist(null);
      setDailyPlaylists([]);
      setGuessPlaylists([]);
      setHomeError(null);
      setPersonalFmError(null);
      setIsPersonalFmRefreshing(false);
      setIsHomeLoading(false);
    };

    if (!isNeteaseEnabled) {
      clearOnlineState();
      return () => {
        isDisposed = true;
      };
    }

    setIsHomeLoading(true);
    setHomeError(null);

    void (async () => {
      try {
        const authenticatedCacheKey = buildNeteaseCacheKey(settings, "home:authenticated");
        const guestCacheKey = buildNeteaseCacheKey(settings, "home:guest");

        if (hasSavedNeteaseCookie) {
          const cachedHomeFeed = neteaseHomeFeedCache.get(authenticatedCacheKey);
          if (cachedHomeFeed) {
            if (isDisposed) {
              return;
            }

            applyHomeFeedCache(cachedHomeFeed);
            setHomeError(null);
            setIsHomeLoading(false);
            return;
          }
        } else {
          const cachedGuestFeed = neteaseHomeFeedCache.get(guestCacheKey);
          if (cachedGuestFeed) {
            if (isDisposed) {
              return;
            }

            applyHomeFeedCache(cachedGuestFeed);
            setHomeError(null);
            setIsHomeLoading(false);
            return;
          }
        }

        const account = hasSavedNeteaseCookie
          ? await getNeteaseLoggedInAccount(settings).catch(() => null)
          : null;

        if (isDisposed) {
          return;
        }

        setNeteaseAccount(account);

        if (account) {
          const [
            nextDailySongs,
            nextPersonalFmSongs,
            nextDailyPlaylists,
            nextGuessPlaylists,
            nextDjs,
            nextUserPlaylists,
          ] = await Promise.all([
            getNeteaseDailyRecommendedSongs(settings, 8),
            getNeteasePersonalFmSongs(settings, 6).catch(() => []),
            getNeteaseDailyRecommendedPlaylists(settings, 4),
            getNeteaseRecommendedPlaylists(settings, 4),
            getNeteaseRecommendedDjs(settings, 4),
            getNeteaseUserPlaylists(settings, account.userId, 24),
          ]);

          if (isDisposed) {
            return;
          }

          const nextHomeFeed: NeteaseHomeFeedCacheEntry = {
            account,
            guestSongs: [],
            dailySongs: nextDailySongs,
            personalFmSongs: nextPersonalFmSongs,
            likedPlaylist: findLikedPlaylist(nextUserPlaylists, account.userId),
            dailyPlaylists: nextDailyPlaylists,
            guessPlaylists: nextGuessPlaylists,
            recommendedDjs: nextDjs,
          };
          setBoundedMapValue(
            neteaseHomeFeedCache,
            authenticatedCacheKey,
            nextHomeFeed,
            NETEASE_HOME_FEED_CACHE_LIMIT,
          );
          applyHomeFeedCache(nextHomeFeed);
          return;
        }

        const nextGuestSongs = await getNeteasePersonalizedNewSongs(settings, 8);

        if (isDisposed) {
          return;
        }

        const nextGuestFeed: NeteaseHomeFeedCacheEntry = {
          account: null,
          guestSongs: nextGuestSongs,
          dailySongs: [],
          personalFmSongs: [],
          likedPlaylist: null,
          dailyPlaylists: [],
          guessPlaylists: [],
          recommendedDjs: [],
        };
        setBoundedMapValue(
          neteaseHomeFeedCache,
          guestCacheKey,
          nextGuestFeed,
          NETEASE_HOME_FEED_CACHE_LIMIT,
        );
        applyHomeFeedCache(nextGuestFeed);
      } catch (error) {
        if (isDisposed) {
          return;
        }

        console.error("[home] failed to load home feed", error);
        setNeteaseAccount(null);
        setGuestSongs([]);
        setDailySongs([]);
        setPersonalFmSongs([]);
        setLikedPlaylist(null);
        setDailyPlaylists([]);
        setGuessPlaylists([]);
        setHomeError(
          error instanceof Error && error.message ? error.message : homeCopy.loadFailed,
        );
      } finally {
        if (!isDisposed) {
          setIsHomeLoading(false);
        }
      }
    })();

    return () => {
      isDisposed = true;
    };
  }, [dataVersion, hasSavedNeteaseCookie, homeCopy.loadFailed, isNeteaseEnabled, settings]);

  const isLoggedIn = neteaseAccount !== null;
  const homeTitle = isLoggedIn
    ? `${homeCopy.titleLoggedIn}${neteaseAccount?.nickname ? `，${neteaseAccount.nickname}` : ""}`
    : homeCopy.titleLoggedOut;
  const localSongItems = offlineRecommendations.map((track) => ({
    id: track.id,
    track,
    title: track.title,
    artistLabel: track.artist?.trim() || copy.library.songFields.unknownArtist,
    albumLabel: track.album?.trim() || copy.library.songFields.unknownAlbum,
    durationLabel: formatDurationMs(track.durationMs),
    artworkUrl:
      settings.appearance.showAlbumArtwork ? resolveTrackArtworkUrl(track, artworksById) : null,
    badge: homeCopy.localFileTag,
    onPlay: () => onPlayLocalTrack(track.id, offlineRecommendations),
  }));
  const guestSongItems = guestSongs.map((song) => ({
    id: String(song.id),
    song,
    title: song.name,
    artistLabel: song.artists.join(" / ") || copy.library.songFields.unknownArtist,
    albumLabel: song.album || copy.library.songFields.unknownAlbum,
    durationLabel: formatDurationMs(song.durationMs),
    artworkUrl: song.artworkUrl,
    badge: homeCopy.onlineTag,
    onPlay: () => onPlayNeteaseTrack(song.id, guestSongs),
  }));
  const dailySongItems = dailySongs.map((song) => ({
    id: String(song.id),
    song,
    title: song.name,
    artistLabel: song.artists.join(" / ") || copy.library.songFields.unknownArtist,
    albumLabel: song.album || copy.library.songFields.unknownAlbum,
    durationLabel: formatDurationMs(song.durationMs),
    artworkUrl: song.artworkUrl,
    badge: homeCopy.dailyTag,
    onPlay: () => onPlayNeteaseTrack(song.id, dailySongs),
  }));
  const personalFmSongItems = personalFmSongs.map((song) => ({
    id: String(song.id),
    song,
    title: song.name,
    artistLabel: song.artists.join(" / ") || copy.library.songFields.unknownArtist,
    albumLabel: song.album || copy.library.songFields.unknownAlbum,
    durationLabel: formatDurationMs(song.durationMs),
    artworkUrl: song.artworkUrl,
    badge: homeCopy.fmTag,
    onPlay: () => onPlayPersonalFmTrack(song.id, personalFmSongs),
  }));
  const personalFmLeadSong = personalFmSongs[0] ?? null;
  const handleRefreshPersonalFm = async () => {
    if (!isLoggedIn || isPersonalFmRefreshing) {
      return;
    }

    setIsPersonalFmRefreshing(true);
    setPersonalFmError(null);

    try {
      const nextPersonalFmSongs = await getNeteasePersonalFmSongs(settings, 6);
      setPersonalFmSongs(nextPersonalFmSongs);
      const authenticatedCacheKey = buildNeteaseCacheKey(settings, "home:authenticated");
      const cachedHomeFeed = neteaseHomeFeedCache.get(authenticatedCacheKey);
      if (cachedHomeFeed) {
        setBoundedMapValue(neteaseHomeFeedCache, authenticatedCacheKey, {
          ...cachedHomeFeed,
          personalFmSongs: nextPersonalFmSongs,
        }, NETEASE_HOME_FEED_CACHE_LIMIT);
      }
    } catch (error) {
      console.error("[home] failed to refresh personal fm", error);
      setPersonalFmError(
        error instanceof Error && error.message ? error.message : homeCopy.personalFmLoadFailed,
      );
    } finally {
      setIsPersonalFmRefreshing(false);
    }
  };
  return (
    <section className="home-screen">
      <header className="home-hero">
        <div className="home-hero__copy">
          <h2 className="settings-screen__title">{homeTitle}</h2>
          <p className="settings-screen__description">
            {isLoggedIn ? homeCopy.descriptionLoggedIn : homeCopy.descriptionLoggedOut}
          </p>
        </div>
        <div className="home-hero__actions">
          <UIButton variant="secondary" onClick={onOpenLibrary}>
            {homeCopy.quickLibrary}
          </UIButton>
          <UIButton variant="primary" onClick={onImportMusic}>
            {homeCopy.quickImport}
          </UIButton>
        </div>
      </header>

      <div className="home-stat-grid">
        <div className="home-stat-card">
          <span>{homeCopy.statsTracks}</span>
          <strong>{tracks.length.toLocaleString(copy.locale)}</strong>
          <small>{homeCopy.sourceOffline}</small>
        </div>
        <div className="home-stat-card">
          <span>{homeCopy.statsLocalTracks}</span>
          <strong>{localTracks.length.toLocaleString(copy.locale)}</strong>
          <small>{homeCopy.sourceOffline}</small>
        </div>
        <div className="home-stat-card">
          <span>{homeCopy.statsArtists}</span>
          <strong>{uniqueArtists.size.toLocaleString(copy.locale)}</strong>
          <small>{homeCopy.sourceOffline}</small>
        </div>
        <div className="home-stat-card">
          <span>{homeCopy.statsAlbums}</span>
          <strong>{uniqueAlbums.size.toLocaleString(copy.locale)}</strong>
          <small>
            {isLoggedIn && likedPlaylist?.trackCount !== null && likedPlaylist?.trackCount !== undefined
              ? `${likedPlaylist.trackCount.toLocaleString(copy.locale)} ${homeCopy.remoteCountSuffix}`
              : homeCopy.sourceOffline}
          </small>
        </div>
      </div>

      {isLoggedIn ? (
        <section className="home-section home-section--fm">
          {isHomeLoading && personalFmSongItems.length === 0 ? (
            <UILoadingBlock label={homeCopy.loadingPersonalFm} variant="grid" />
          ) : personalFmSongItems.length === 0 ? (
            <p className="library-empty">{personalFmError || homeCopy.emptyOnline}</p>
          ) : (
            <div className="home-fm-panel">
              <div className="home-fm-panel__hero">
                <div className="home-fm-panel__copy">
                  <span className="home-fm-panel__eyebrow">{homeCopy.sourceOnline}</span>
                  <h3 className="home-fm-panel__title">{homeCopy.sectionPersonalFm}</h3>
                  <p className="home-fm-panel__description">
                    {isPersonalFmRefreshing
                      ? homeCopy.loadingPersonalFm
                      : personalFmError || homeCopy.personalFmHint}
                  </p>
                  <div className="home-fm-panel__actions">
                    <button
                      className="home-fm-cta home-fm-cta--primary"
                      type="button"
                      onClick={() => {
                        if (!personalFmLeadSong) {
                          return;
                        }

                        onPlayPersonalFmTrack(personalFmLeadSong.id, personalFmSongs);
                      }}
                      disabled={isHomeLoading || isPersonalFmRefreshing || personalFmSongs.length === 0}
                    >
                      <HomeFmArrowIcon className="arr-2" />
                      <span className="text">{homeCopy.startPersonalFm}</span>
                      <span className="circle" />
                      <HomeFmArrowIcon className="arr-1" />
                    </button>
                    <button
                      className="home-fm-cta home-fm-cta--secondary"
                      type="button"
                      onClick={() => void handleRefreshPersonalFm()}
                      disabled={isHomeLoading || isPersonalFmRefreshing}
                    >
                      <HomeFmRefreshIcon className="arr-2" />
                      <span className="text">
                        {isPersonalFmRefreshing ? homeCopy.refreshingPersonalFm : homeCopy.refreshPersonalFm}
                      </span>
                      <span className="circle" />
                      <HomeFmRefreshIcon className="arr-1" />
                    </button>
                  </div>
                </div>
              </div>
              <div className="home-fm-panel__queue">
                {personalFmSongItems.map((item, index) => (
                  <button
                    key={item.id}
                    className={[
                      "home-fm-track",
                      index === 0 ? "home-fm-track--lead" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    type="button"
                    onClick={item.onPlay}
                    onContextMenu={(event) => onSongContextMenu(event, item.song, personalFmSongs)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        item.onPlay();
                      }
                    }}
                  >
                    <span className="home-fm-track__index">{String(index + 1).padStart(2, "0")}</span>
                    <span className="home-fm-track__cover" aria-hidden="true">
                      {item.artworkUrl ? (
                        <img src={item.artworkUrl} alt="" loading="lazy" />
                      ) : (
                        <span className="home-fm-track__cover-fallback">
                          <SongsTileIcon />
                        </span>
                      )}
                    </span>
                    <span className="home-fm-track__copy">
                      <span className="home-fm-track__title">{item.title}</span>
                      <span className="home-fm-track__meta">{item.artistLabel}</span>
                    </span>
                    <span className="home-fm-track__duration">{item.durationLabel}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      ) : null}

      {isLoggedIn ? (
        <section className="home-section">
          <div className="home-section__header">
            <div>
              <p className="settings-screen__eyebrow">{homeCopy.sourceOnline}</p>
              <h3 className="settings-card__title">{homeCopy.sectionDailySongs}</h3>
            </div>
            {isHomeLoading ? <span className="home-section__hint">{homeCopy.loadingOnline}</span> : null}
          </div>
          <div className="home-song-list">
            {!isNeteaseEnabled ? (
              <p className="library-empty">{homeCopy.unavailableOnline}</p>
            ) : homeError ? (
              <p className="library-empty">{homeError}</p>
            ) : isHomeLoading && dailySongItems.length === 0 ? (
              <UILoadingBlock label={homeCopy.loadingOnline} variant="list" />
            ) : dailySongItems.length === 0 ? (
              <p className="library-empty">{homeCopy.emptyOnline}</p>
            ) : (
              dailySongItems.map((item) => (
                <div
                  key={item.id}
                  className="home-song-card"
                  role="button"
                  tabIndex={0}
                  onClick={item.onPlay}
                  onContextMenu={(event) => onSongContextMenu(event, item.song, dailySongs)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      item.onPlay();
                    }
                  }}
                >
                  <span className="home-song-card__cover" aria-hidden="true">
                    {item.artworkUrl ? (
                      <img src={item.artworkUrl} alt="" loading="lazy" />
                    ) : (
                      <span className="home-song-card__cover-fallback">
                        <SongsTileIcon />
                      </span>
                    )}
                  </span>
                  <span className="home-song-card__copy">
                    <span className="home-song-card__title">{item.title}</span>
                    <span className="home-song-card__subtitle">
                      <SongArtistLinks
                        fallback={item.artistLabel}
                        artists={item.song.artists.map((artistName, artistIndex) => ({
                          key: `${item.song.id}:artist:${artistName}:${artistIndex}`,
                          name: artistName,
                          onClick: item.song.artistIds[artistIndex]
                            ? () => onOpenSongArtist(item.song.artistIds[artistIndex]!, artistName)
                            : undefined,
                        }))}
                      />
                    </span>
                  </span>
                  <span className="home-song-card__meta">
                    <SongMetaButton
                      label={item.albumLabel}
                      onClick={() =>
                        item.song.albumId
                          ? onOpenSongAlbum(item.song.albumId, item.song.album || item.albumLabel)
                          : undefined
                      }
                      disabled={!item.song.albumId}
                    />
                  </span>
                  <span className="home-song-card__duration">{item.durationLabel}</span>
                  <span className="home-song-card__badge">{item.badge}</span>
                </div>
              ))
            )}
          </div>
        </section>
      ) : null}

      {isNeteaseEnabled ? (
        <section className="home-section">
          <div className="home-section__header">
            <div>
              <p className="settings-screen__eyebrow">{homeCopy.sourceOnline}</p>
              <h3 className="settings-card__title">
                {isLoggedIn ? homeCopy.sectionOnlinePlaylists : homeCopy.sectionRecommendedSongs}
              </h3>
            </div>
          </div>
          {isLoggedIn ? (
            <div className="playlist-waterfall-grid">
              {isHomeLoading &&
              likedPlaylist === null &&
              dailyPlaylists.length === 0 &&
              guessPlaylists.length === 0 ? (
                <UILoadingBlock label={homeCopy.loadingOnline} variant="grid" />
              ) : null}

              {dailyPlaylists.length > 0 ? (
                <div className="playlist-waterfall-indicator">{homeCopy.sectionDailyPlaylists}</div>
              ) : null}
              {dailyPlaylists.map((playlist) => (
                <PlaylistPreviewCard
                  key={playlist.id}
                  title={playlist.name}
                  description={playlist.description || homeCopy.emptyOnline}
                  artworkUrl={playlist.artworkUrl}
                  primaryMeta={`${playlist.trackCount?.toLocaleString(copy.locale) ?? "--"} ${homeCopy.playlistCountSuffix}`}
                  secondaryMeta={`${homeCopy.creatorPrefix} ${playlist.creatorName || homeCopy.sourceOnline}`}
                  onClick={() => onOpenPlaylist({ id: playlist.id, title: playlist.name })}
                  onContextMenu={(event) => onPlaylistContextMenu(event, playlist)}
                />
              ))}

              {guessPlaylists.length > 0 ? (
                <div className="playlist-waterfall-indicator">{homeCopy.sectionGuess}</div>
              ) : null}
              {guessPlaylists.map((playlist) => (
                <PlaylistPreviewCard
                  key={playlist.id}
                  title={playlist.name}
                  description={playlist.description || homeCopy.emptyOnline}
                  artworkUrl={playlist.artworkUrl}
                  primaryMeta={`${playlist.playCount !== null ? formatHomeCount(playlist.playCount, copy.locale) : "--"} ${homeCopy.playCountSuffix}`}
                  secondaryMeta={`${homeCopy.creatorPrefix} ${playlist.creatorName || homeCopy.sourceOnline}`}
                  onClick={() => onOpenPlaylist({ id: playlist.id, title: playlist.name })}
                  onContextMenu={(event) => onPlaylistContextMenu(event, playlist)}
                />
              ))}

              {!isHomeLoading &&
              dailyPlaylists.length === 0 &&
              guessPlaylists.length === 0 ? (
                <p className="library-empty">{homeCopy.emptyOnline}</p>
              ) : null}
            </div>
          ) : (
            <div className="home-song-list">
              {homeError ? (
                <p className="library-empty">{homeError}</p>
              ) : isHomeLoading && guestSongItems.length === 0 ? (
                <UILoadingBlock label={homeCopy.loadingOnline} variant="list" />
              ) : guestSongItems.length === 0 ? (
                <p className="library-empty">
                  {hasSavedNeteaseCookie ? homeCopy.loadingAccount : homeCopy.accountUnavailable}
                </p>
              ) : (
                guestSongItems.map((item) => (
                  <div
                    key={item.id}
                    className="home-song-card"
                    role="button"
                    tabIndex={0}
                    onClick={item.onPlay}
                    onContextMenu={(event) => onSongContextMenu(event, item.song, guestSongs)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        item.onPlay();
                      }
                    }}
                  >
                    <span className="home-song-card__cover" aria-hidden="true">
                      {item.artworkUrl ? (
                        <img src={item.artworkUrl} alt="" loading="lazy" />
                      ) : (
                        <span className="home-song-card__cover-fallback">
                          <SongsTileIcon />
                        </span>
                      )}
                    </span>
                    <span className="home-song-card__copy">
                      <span className="home-song-card__title">{item.title}</span>
                      <span className="home-song-card__subtitle">
                        <SongArtistLinks
                          fallback={item.artistLabel}
                          artists={item.song.artists.map((artistName, artistIndex) => ({
                            key: `${item.song.id}:artist:${artistName}:${artistIndex}`,
                            name: artistName,
                            onClick: item.song.artistIds[artistIndex]
                              ? () => onOpenSongArtist(item.song.artistIds[artistIndex]!, artistName)
                              : undefined,
                          }))}
                        />
                      </span>
                    </span>
                    <span className="home-song-card__meta">
                      <SongMetaButton
                        label={item.albumLabel}
                        onClick={() =>
                          item.song.albumId
                            ? onOpenSongAlbum(item.song.albumId, item.song.album || item.albumLabel)
                            : undefined
                        }
                        disabled={!item.song.albumId}
                      />
                    </span>
                    <span className="home-song-card__duration">{item.durationLabel}</span>
                    <span className="home-song-card__badge">{item.badge}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </section>
      ) : null}

      <section className="home-section">
        <div className="home-section__header">
          <div>
            <p className="settings-screen__eyebrow">{homeCopy.sourceOffline}</p>
            <h3 className="settings-card__title">{homeCopy.sectionOfflinePicks}</h3>
          </div>
        </div>
        {isLibraryLoading ? (
          <UILoadingBlock label={homeCopy.loading} variant="list" />
        ) : localSongItems.length === 0 ? (
          <p className="library-empty">{homeCopy.emptyLibrary}</p>
        ) : (
          <div className="home-song-list">
            {localSongItems.map((item) => (
              <div
                key={item.id}
                className="home-song-card"
                role="button"
                tabIndex={0}
                onClick={item.onPlay}
                onContextMenu={(event) => onTrackContextMenu(event, item.track, offlineRecommendations)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    item.onPlay();
                  }
                }}
              >
                <span className="home-song-card__cover" aria-hidden="true">
                  {item.artworkUrl ? (
                    <img src={item.artworkUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="home-song-card__cover-fallback">
                      <SongsTileIcon />
                    </span>
                  )}
                </span>
                <span className="home-song-card__copy">
                  <span className="home-song-card__title">{item.title}</span>
                  <span className="home-song-card__subtitle">
                    <SongMetaButton
                      label={item.artistLabel}
                      onClick={() => onOpenTrackArtist(item.track)}
                    />
                  </span>
                </span>
                <span className="home-song-card__meta">
                  <SongMetaButton
                    label={item.albumLabel}
                    onClick={() => onOpenTrackAlbum(item.track)}
                    disabled={!item.track.album?.trim()}
                  />
                </span>
                <span className="home-song-card__duration">{item.durationLabel}</span>
                <span className="home-song-card__badge">{item.badge}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function PlaylistPreviewCard({
  title,
  description,
  artworkUrl,
  primaryMeta,
  secondaryMeta,
  onClick,
  onContextMenu,
}: {
  title: string;
  description: string;
  artworkUrl: string | null;
  primaryMeta: string;
  secondaryMeta: string;
  onClick: () => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const previewDescription = truncateText(description, 96);

  return (
    <button
      className="home-media-card home-media-card--button home-media-card--compact playlist-preview-card"
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <div className="home-media-card__artwork" aria-hidden="true">
        {artworkUrl ? (
          <img src={artworkUrl} alt="" loading="lazy" />
        ) : (
          <span className="home-media-card__fallback">
            <AlbumsTileIcon />
          </span>
        )}
      </div>
      <div className="home-media-card__copy">
        <strong>{title}</strong>
        <p title={description}>{previewDescription}</p>
      </div>
      <div className="home-media-card__meta">
        <span>{primaryMeta}</span>
        <span>{secondaryMeta}</span>
      </div>
    </button>
  );
}

function PlaylistBrowserSection({
  title,
  playlists,
  locale,
  emptyLabel,
  countSuffix,
  ownerPrefix,
  onOpen,
  onPlaylistContextMenu,
}: {
  title: string;
  playlists: NeteasePlaylistRecommendation[];
  locale: string;
  emptyLabel: string;
  countSuffix: string;
  ownerPrefix: string;
  onOpen: (playlist: NeteasePlaylistRecommendation) => void;
  onPlaylistContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    playlist: NeteasePlaylistRecommendation,
  ) => void;
}) {
  return (
    <section className="playlist-browser-section">
      {playlists.length === 0 ? (
        <p className="library-empty">{emptyLabel}</p>
      ) : (
        <div className="playlist-waterfall-grid playlist-browser-grid">
          {title ? <div className="playlist-waterfall-indicator">{title}</div> : null}
          {playlists.map((playlist) => (
            <PlaylistPreviewCard
              key={playlist.id}
              title={playlist.name}
              description={playlist.description || emptyLabel}
              artworkUrl={playlist.artworkUrl}
              primaryMeta={`${playlist.trackCount?.toLocaleString(locale) ?? "--"} ${countSuffix}`}
              secondaryMeta={`${ownerPrefix} ${playlist.creatorName || "--"}`}
              onClick={() => onOpen(playlist)}
              onContextMenu={(event) => onPlaylistContextMenu(event, playlist)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PlaylistScreen({
  copy,
  settings,
  dataVersion,
  initialSelection,
  onSelectPlaylist,
  onBack,
  backLabel,
  onPlayNeteaseTrack,
  onOpenSongArtist,
  onOpenSongAlbum,
  onSongContextMenu,
  onPlaylistContextMenu,
  onCreatePlaylist,
  onEditPlaylist,
  onStartIntelligenceMode,
}: {
  copy: UiCopy;
  settings: AppSettings;
  dataVersion: number;
  initialSelection: PlaylistSelection;
  onSelectPlaylist: (playlist: PlaylistSelection) => void;
  onBack: () => void;
  backLabel: string;
  onPlayNeteaseTrack: (
    trackId: number,
    queueSongs: NeteaseSongDetail[],
    sourcePlaylist: PlaylistSelection,
  ) => void;
  onOpenSongArtist: (artistId: number, artistName: string) => void;
  onOpenSongAlbum: (albumId: number, albumName: string) => void;
  onSongContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    song: NeteaseSongDetail,
    queueSongs: NeteaseSongDetail[],
  ) => void;
  onPlaylistContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    playlist: NeteasePlaylistRecommendation,
  ) => void;
  onCreatePlaylist: () => void;
  onEditPlaylist: (playlist: NeteasePlaylistRecommendation) => void;
  onStartIntelligenceMode: (
    sourcePlaylist: PlaylistSelection,
    seedSong: NeteaseSongDetail,
    queueSongs: NeteaseSongDetail[],
  ) => void;
}) {
  const homeCopy = getHomeCopy(copy.locale);
  const playlistCopy = getPlaylistCopy(copy.locale);
  const playlistEditorCopy = getPlaylistEditorCopy(copy.locale);
  const isNeteaseEnabled = isNeteaseSourceEnabled(settings);
  const hasSavedNeteaseCookie = settings.network.neteaseCookie.trim().length > 0;
  const [neteaseAccount, setNeteaseAccount] = useState<NeteaseAccountProfile | null>(null);
  const [userPlaylists, setUserPlaylists] = useState<NeteasePlaylistRecommendation[]>([]);
  const [isLoadingCollections, setIsLoadingCollections] = useState(false);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [playlistDetail, setPlaylistDetail] = useState<NeteasePlaylistRecommendation | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<NeteaseSongDetail[]>([]);
  const [isLoadingTracks, setIsLoadingTracks] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [playlistPage, setPlaylistPage] = useState(1);
  const applyPlaylistLibraryCache = (entry: NeteasePlaylistLibraryCacheEntry) => {
    setNeteaseAccount(entry.account);
    setUserPlaylists(entry.userPlaylists);
  };

  useEffect(() => {
    let isDisposed = false;

    if (!isNeteaseEnabled) {
      setNeteaseAccount(null);
      setUserPlaylists([]);
      setCollectionError(null);
      setIsLoadingCollections(false);
      return () => {
        isDisposed = true;
      };
    }

    setIsLoadingCollections(true);
    setCollectionError(null);

    void (async () => {
      try {
        const playlistLibraryCacheKey = buildNeteaseCacheKey(settings, "playlist:library");
        const cachedPlaylistLibrary = neteasePlaylistLibraryCache.get(playlistLibraryCacheKey);

        if (cachedPlaylistLibrary) {
          if (isDisposed) {
            return;
          }

          applyPlaylistLibraryCache(cachedPlaylistLibrary);
          setCollectionError(null);
          setIsLoadingCollections(false);
          return;
        }

        const account = hasSavedNeteaseCookie
          ? await getNeteaseLoggedInAccount(settings).catch(() => null)
          : null;

        if (isDisposed) {
          return;
        }

        setNeteaseAccount(account);

        if (!account) {
          applyPlaylistLibraryCache({
            account: null,
            userPlaylists: [],
          });
          return;
        }

        const nextUserPlaylists = await getNeteaseUserPlaylists(settings, account.userId, 30);

        if (isDisposed) {
          return;
        }

        const likedPlaylist = findLikedPlaylist(nextUserPlaylists, account.userId);
        const orderedUserPlaylists = prioritizePlaylist(nextUserPlaylists, likedPlaylist?.id ?? null);
        const allPlaylists = mergePlaylistRecommendations(orderedUserPlaylists);
        const matchedSelection = initialSelection
          ? allPlaylists.find((playlist) => playlist.id === initialSelection.id) ?? null
          : null;

        const nextPlaylistLibrary: NeteasePlaylistLibraryCacheEntry = {
          account,
          userPlaylists: orderedUserPlaylists,
        };
        setBoundedMapValue(
          neteasePlaylistLibraryCache,
          playlistLibraryCacheKey,
          nextPlaylistLibrary,
          NETEASE_PLAYLIST_LIBRARY_CACHE_LIMIT,
        );
        applyPlaylistLibraryCache(nextPlaylistLibrary);

        if (!initialSelection) {
          return;
        }

        if (
          matchedSelection &&
          (initialSelection.id !== matchedSelection.id || initialSelection.title !== matchedSelection.name)
        ) {
          onSelectPlaylist({ id: matchedSelection.id, title: matchedSelection.name });
        }
      } catch (error) {
        if (isDisposed) {
          return;
        }

        console.error("[playlist] failed to load playlists", error);
        setNeteaseAccount(null);
        setUserPlaylists([]);
        setCollectionError(
          error instanceof Error && error.message ? error.message : playlistCopy.loading,
        );
      } finally {
        if (!isDisposed) {
          setIsLoadingCollections(false);
        }
      }
    })();

    return () => {
      isDisposed = true;
    };
  }, [
    dataVersion,
    hasSavedNeteaseCookie,
    initialSelection,
    isNeteaseEnabled,
    onSelectPlaylist,
    playlistCopy.loading,
    settings,
  ]);

  useEffect(() => {
    let isDisposed = false;

    if (!isNeteaseEnabled || !initialSelection?.id) {
      setPlaylistDetail(null);
      return () => {
        isDisposed = true;
      };
    }

    const allPlaylists = mergePlaylistRecommendations(userPlaylists);
    const matchedPlaylist =
      allPlaylists.find((playlist) => playlist.id === initialSelection.id) ?? null;

    if (matchedPlaylist) {
      setPlaylistDetail(matchedPlaylist);
      return () => {
        isDisposed = true;
      };
    }

    const playlistDetailCacheKey = buildNeteaseCacheKey(
      settings,
      `playlist:detail:${initialSelection.id}`,
    );
    const cachedPlaylistDetail = neteasePlaylistDetailCache.get(playlistDetailCacheKey);

    if (cachedPlaylistDetail !== undefined) {
      setPlaylistDetail(cachedPlaylistDetail);
      return () => {
        isDisposed = true;
      };
    }

    setPlaylistDetail((current) =>
      current?.id === initialSelection.id ? current : null,
    );

    void (async () => {
      try {
        const detail = await getNeteasePlaylistDetail(settings, initialSelection.id);

        if (isDisposed) {
          return;
        }

        if (detail) {
          setBoundedMapValue(
            neteasePlaylistDetailCache,
            playlistDetailCacheKey,
            detail,
            NETEASE_PLAYLIST_DETAIL_CACHE_LIMIT,
          );
        }
        setPlaylistDetail(detail);
      } catch (error) {
        if (isDisposed) {
          return;
        }

        console.error("[playlist] failed to load playlist detail", error);
        setPlaylistDetail(null);
      }
    })();

    return () => {
      isDisposed = true;
    };
  }, [dataVersion, initialSelection?.id, isNeteaseEnabled, settings, userPlaylists]);

  useEffect(() => {
    let isDisposed = false;

    if (!isNeteaseEnabled || !neteaseAccount || !initialSelection?.id) {
      setPlaylistTracks([]);
      setTrackError(null);
      setIsLoadingTracks(false);
      return () => {
        isDisposed = true;
      };
    }

    setIsLoadingTracks(true);
    setTrackError(null);

    void (async () => {
      try {
        const playlistTracksCacheKey = buildNeteaseCacheKey(
          settings,
          `playlist:tracks:${initialSelection.id}`,
        );
        const cachedTracks = neteasePlaylistTracksCache.get(playlistTracksCacheKey);

        if (cachedTracks) {
          if (isDisposed) {
            return;
          }

          setPlaylistTracks(cachedTracks);
          setTrackError(null);
          setIsLoadingTracks(false);
          return;
        }

        const nextTracks = await getAllNeteasePlaylistTracks(settings, initialSelection.id);

        if (isDisposed) {
          return;
        }

        setBoundedMapValue(
          neteasePlaylistTracksCache,
          playlistTracksCacheKey,
          nextTracks,
          NETEASE_PLAYLIST_TRACKS_CACHE_LIMIT,
        );
        setPlaylistTracks(nextTracks);
      } catch (error) {
        if (isDisposed) {
          return;
        }

        console.error("[playlist] failed to load playlist tracks", error);
        setPlaylistTracks([]);
        setTrackError(
          error instanceof Error && error.message ? error.message : playlistCopy.loadingTracks,
        );
      } finally {
        if (!isDisposed) {
          setIsLoadingTracks(false);
        }
      }
    })();

    return () => {
      isDisposed = true;
    };
  }, [
    dataVersion,
    initialSelection?.id,
    isNeteaseEnabled,
    neteaseAccount,
    playlistCopy.loadingTracks,
    settings,
  ]);

  const allPlaylists = mergePlaylistRecommendations(userPlaylists);
  const selectedPlaylist =
    playlistDetail ??
    (initialSelection
      ? allPlaylists.find((playlist) => playlist.id === initialSelection.id) ?? null
      : null) ??
    (initialSelection
      ? {
          id: initialSelection.id,
          name: initialSelection.title,
          description: null,
          artworkUrl: null,
          trackCount: null,
          playCount: null,
          creatorName: null,
          creatorUserId: null,
          subscribed: false,
        }
      : null);
  const tracksPerPage = 50;
  const totalTrackPages = Math.max(1, Math.ceil(playlistTracks.length / tracksPerPage));
  const visiblePlaylistTracks = playlistTracks.slice(
    (playlistPage - 1) * tracksPerPage,
    playlistPage * tracksPerPage,
  );
  const selectedPlaylistDescription = truncateText(
    selectedPlaylist?.description || playlistCopy.detailDescription,
    220,
  );
  const canEditSelectedPlaylist = Boolean(
    neteaseAccount &&
      selectedPlaylist &&
      selectedPlaylist.creatorUserId === neteaseAccount.userId,
  );

  useEffect(() => {
    setPlaylistPage(1);
  }, [initialSelection?.id]);

  useEffect(() => {
    if (playlistPage > totalTrackPages) {
      setPlaylistPage(totalTrackPages);
    }
  }, [playlistPage, totalTrackPages]);

  return (
    <section className="playlist-screen">
      {!isNeteaseEnabled ? (
        <p className="library-empty">{playlistCopy.notEnabled}</p>
      ) : !hasSavedNeteaseCookie || neteaseAccount === null ? (
        isLoadingCollections ? (
          <UILoadingBlock label={playlistCopy.loading} variant="grid" />
        ) : (
          <p className="library-empty">{playlistCopy.notLoggedIn}</p>
        )
      ) : collectionError ? (
        <p className="library-empty">{collectionError}</p>
      ) : initialSelection === null ? (
        <div className="playlist-browser">
          <div className="playlist-browser__toolbar">
            <UIButton variant="primary" onClick={onCreatePlaylist}>
              {playlistEditorCopy.create}
            </UIButton>
          </div>
          {isLoadingCollections ? (
            <UILoadingBlock label={playlistCopy.loading} variant="grid" />
          ) : (
            <PlaylistBrowserSection
              title={playlistCopy.userSection}
              playlists={userPlaylists}
              locale={copy.locale}
              emptyLabel={playlistCopy.empty}
              countSuffix={playlistCopy.countSuffix}
              ownerPrefix={playlistCopy.ownerPrefix}
              onOpen={(playlist) => onSelectPlaylist({ id: playlist.id, title: playlist.name })}
              onPlaylistContextMenu={onPlaylistContextMenu}
            />
          )}
        </div>
      ) : (
        <div className="playlist-detail-view">
          <UIButton variant="secondary" onClick={onBack}>
            {backLabel}
          </UIButton>
          {selectedPlaylist ? (
            <section
              className="playlist-detail-card"
              onContextMenu={(event) => onPlaylistContextMenu(event, selectedPlaylist)}
            >
                <div className="playlist-detail-card__hero">
                  <div className="playlist-detail-card__artwork" aria-hidden="true">
                    {selectedPlaylist.artworkUrl ? (
                      <img src={selectedPlaylist.artworkUrl} alt="" loading="lazy" />
                    ) : (
                      <span className="playlist-detail-card__fallback">
                        <AlbumsTileIcon />
                      </span>
                    )}
                  </div>
                  <div className="playlist-detail-card__meta">
                    <h3 className="settings-screen__title">{selectedPlaylist.name}</h3>
                    <p
                      className="settings-screen__description playlist-detail-card__description"
                      title={selectedPlaylist.description || playlistCopy.detailDescription}
                    >
                      {selectedPlaylistDescription}
                    </p>
                    <div className="playlist-detail-card__stats">
                      <div className="home-stat-card">
                        <span>{playlistCopy.ownerPrefix}</span>
                        <strong>{selectedPlaylist.creatorName || "--"}</strong>
                      </div>
                      <div className="home-stat-card">
                        <span>{playlistCopy.countSuffix}</span>
                        <strong>{selectedPlaylist.trackCount?.toLocaleString(copy.locale) ?? "--"}</strong>
                      </div>
                      <div className="home-stat-card">
                        <span>{homeCopy.playCountSuffix}</span>
                        <strong>
                          {selectedPlaylist.playCount !== null
                            ? formatHomeCount(selectedPlaylist.playCount, copy.locale)
                            : "--"}
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="home-section__header">
                  <div>
                    <h3 className="settings-card__title">{selectedPlaylist.name}</h3>
                  </div>
                    <div className="playlist-detail-card__toolbar">
                      {!isLoadingTracks && playlistTracks.length > 0 ? (
                        <IntelligenceModeButton
                          label={playlistCopy.startIntelligenceMode}
                          onClick={() =>
                            onStartIntelligenceMode(initialSelection, playlistTracks[0], playlistTracks)}
                        />
                      ) : null}
                    {canEditSelectedPlaylist ? (
                      <UIButton
                        variant="secondary"
                        onClick={() => onEditPlaylist(selectedPlaylist)}
                      >
                        {playlistEditorCopy.edit}
                      </UIButton>
                    ) : null}
                    {isLoadingTracks ? <span className="home-section__hint">{playlistCopy.loadingTracks}</span> : null}
                    {!isLoadingTracks && playlistTracks.length > 0 ? (
                      <span className="home-section__hint">
                        {playlistCopy.pageLabel} {playlistPage} / {totalTrackPages}
                      </span>
                    ) : null}
                  </div>
                </div>

                {trackError ? (
                  <p className="library-empty">{trackError}</p>
                ) : isLoadingTracks ? (
                  <UILoadingBlock label={playlistCopy.loadingTracks} variant="list" items={5} />
                ) : playlistTracks.length === 0 ? (
                  <p className="library-empty">{playlistCopy.emptyTracks}</p>
                ) : (
                  <>
                    <div className="home-song-list">
                    {visiblePlaylistTracks.map((track, index) => (
                      <div
                        key={track.id}
                        className="home-song-card"
                        role="button"
                        tabIndex={0}
                        onClick={() =>
                          onPlayNeteaseTrack(track.id, playlistTracks, {
                            id: selectedPlaylist.id,
                            title: selectedPlaylist.name,
                          })
                        }
                        onContextMenu={(event) => onSongContextMenu(event, track, playlistTracks)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onPlayNeteaseTrack(track.id, playlistTracks, {
                              id: selectedPlaylist.id,
                              title: selectedPlaylist.name,
                            });
                          }
                        }}
                      >
                        <span className="home-song-card__cover" aria-hidden="true">
                          {track.artworkUrl ? (
                            <img src={track.artworkUrl} alt="" loading="lazy" />
                          ) : (
                            <span className="home-song-card__cover-fallback">
                              <SongsTileIcon />
                            </span>
                          )}
                        </span>
                        <span className="home-song-card__copy">
                          <span className="home-song-card__title">{track.name}</span>
                          <span className="home-song-card__subtitle">
                            <SongArtistLinks
                              fallback={copy.library.songFields.unknownArtist}
                              artists={track.artists.map((artistName, artistIndex) => ({
                                key: `${track.id}:artist:${artistName}:${artistIndex}`,
                                name: artistName,
                                onClick: track.artistIds[artistIndex]
                                  ? () => onOpenSongArtist(track.artistIds[artistIndex]!, artistName)
                                  : undefined,
                              }))}
                            />
                          </span>
                        </span>
                        <span className="home-song-card__meta">
                          <SongMetaButton
                            label={track.album || copy.library.songFields.unknownAlbum}
                            onClick={() =>
                              track.albumId
                                ? onOpenSongAlbum(
                                    track.albumId,
                                    track.album || copy.library.songFields.unknownAlbum,
                                  )
                                : undefined
                            }
                            disabled={!track.albumId}
                          />
                        </span>
                        <span className="home-song-card__duration">
                          {formatDurationMs(track.durationMs)}
                        </span>
                        <span className="home-song-card__badge">
                          #{(playlistPage - 1) * tracksPerPage + index + 1}
                        </span>
                      </div>
                    ))}
                    </div>
                    <UIPagination
                      currentPage={playlistPage}
                      totalPages={totalTrackPages}
                      pageLabel={playlistCopy.pageLabel}
                      firstPageLabel={copy.locale === "en-US" ? "First page" : "首页"}
                      previousPageLabel={playlistCopy.prevPage}
                      nextPageLabel={playlistCopy.nextPage}
                      lastPageLabel={copy.locale === "en-US" ? "Last page" : "尾页"}
                      onPageChange={setPlaylistPage}
                    />
                  </>
                )}
            </section>
          ) : (
            <p className="library-empty">{playlistCopy.empty}</p>
          )}
        </div>
      )}
    </section>
  );
}

function LikedSongsScreen({
  copy,
  settings,
  dataVersion,
  onPlayNeteaseTrack,
  onStartIntelligenceMode,
  onOpenSongArtist,
  onOpenSongAlbum,
  onSongContextMenu,
  onPlaylistContextMenu,
}: {
  copy: UiCopy;
  settings: AppSettings;
  dataVersion: number;
  onPlayNeteaseTrack: (
    trackId: number,
    queueSongs: NeteaseSongDetail[],
    sourcePlaylist: PlaylistSelection,
  ) => void;
  onStartIntelligenceMode: (
    sourcePlaylist: PlaylistSelection,
    seedSong: NeteaseSongDetail,
    queueSongs: NeteaseSongDetail[],
  ) => void;
  onOpenSongArtist: (artistId: number, artistName: string) => void;
  onOpenSongAlbum: (albumId: number, albumName: string) => void;
  onSongContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    song: NeteaseSongDetail,
    queueSongs: NeteaseSongDetail[],
  ) => void;
  onPlaylistContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    playlist: NeteasePlaylistRecommendation,
  ) => void;
}) {
  const homeCopy = getHomeCopy(copy.locale);
  const likedSongsCopy = getLikedSongsCopy(copy.locale);
  const isNeteaseEnabled = isNeteaseSourceEnabled(settings);
  const hasSavedNeteaseCookie = settings.network.neteaseCookie.trim().length > 0;
  const [neteaseAccount, setNeteaseAccount] = useState<NeteaseAccountProfile | null>(null);
  const [likedPlaylist, setLikedPlaylist] = useState<NeteasePlaylistRecommendation | null>(null);
  const [isLoadingCollections, setIsLoadingCollections] = useState(false);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [playlistDetail, setPlaylistDetail] = useState<NeteasePlaylistRecommendation | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<NeteaseSongDetail[]>([]);
  const [isLoadingTracks, setIsLoadingTracks] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [playlistPage, setPlaylistPage] = useState(1);

  useEffect(() => {
    let isDisposed = false;

    if (!isNeteaseEnabled) {
      setNeteaseAccount(null);
      setLikedPlaylist(null);
      setCollectionError(null);
      setIsLoadingCollections(false);
      return () => {
        isDisposed = true;
      };
    }

    setIsLoadingCollections(true);
    setCollectionError(null);

    void (async () => {
      try {
        const playlistLibraryCacheKey = buildNeteaseCacheKey(settings, "playlist:library");
        const cachedPlaylistLibrary = neteasePlaylistLibraryCache.get(playlistLibraryCacheKey);

        if (cachedPlaylistLibrary) {
          if (isDisposed) {
            return;
          }

          setNeteaseAccount(cachedPlaylistLibrary.account);
          setLikedPlaylist(
            cachedPlaylistLibrary.account
              ? findLikedPlaylist(
                  cachedPlaylistLibrary.userPlaylists,
                  cachedPlaylistLibrary.account.userId,
                )
              : null,
          );
          setCollectionError(null);
          setIsLoadingCollections(false);
          return;
        }

        const account = hasSavedNeteaseCookie
          ? await getNeteaseLoggedInAccount(settings).catch(() => null)
          : null;

        if (isDisposed) {
          return;
        }

        setNeteaseAccount(account);

        if (!account) {
          setBoundedMapValue(neteasePlaylistLibraryCache, playlistLibraryCacheKey, {
            account: null,
            userPlaylists: [],
          }, NETEASE_PLAYLIST_LIBRARY_CACHE_LIMIT);
          setLikedPlaylist(null);
          return;
        }

        const nextUserPlaylists = await getNeteaseUserPlaylists(settings, account.userId, 30);

        if (isDisposed) {
          return;
        }

        const nextLikedPlaylist = findLikedPlaylist(nextUserPlaylists, account.userId);
        setBoundedMapValue(neteasePlaylistLibraryCache, playlistLibraryCacheKey, {
          account,
          userPlaylists: prioritizePlaylist(nextUserPlaylists, nextLikedPlaylist?.id ?? null),
        }, NETEASE_PLAYLIST_LIBRARY_CACHE_LIMIT);
        setLikedPlaylist(nextLikedPlaylist);
      } catch (error) {
        if (isDisposed) {
          return;
        }

        console.error("[liked-songs] failed to load liked playlist", error);
        setNeteaseAccount(null);
        setLikedPlaylist(null);
        setCollectionError(
          error instanceof Error && error.message ? error.message : likedSongsCopy.loading,
        );
      } finally {
        if (!isDisposed) {
          setIsLoadingCollections(false);
        }
      }
    })();

    return () => {
      isDisposed = true;
    };
  }, [dataVersion, hasSavedNeteaseCookie, isNeteaseEnabled, likedSongsCopy.loading, settings]);

  useEffect(() => {
    let isDisposed = false;

    if (!isNeteaseEnabled || !likedPlaylist?.id) {
      setPlaylistDetail(null);
      return () => {
        isDisposed = true;
      };
    }

    const playlistDetailCacheKey = buildNeteaseCacheKey(settings, `playlist:detail:${likedPlaylist.id}`);
    const cachedPlaylistDetail = neteasePlaylistDetailCache.get(playlistDetailCacheKey);

    if (cachedPlaylistDetail !== undefined) {
      setPlaylistDetail(cachedPlaylistDetail);
      return () => {
        isDisposed = true;
      };
    }

    setPlaylistDetail((current) => (current?.id === likedPlaylist.id ? current : likedPlaylist));

    void (async () => {
      try {
        const detail = await getNeteasePlaylistDetail(settings, likedPlaylist.id);

        if (isDisposed) {
          return;
        }

        if (detail) {
          setBoundedMapValue(
            neteasePlaylistDetailCache,
            playlistDetailCacheKey,
            detail,
            NETEASE_PLAYLIST_DETAIL_CACHE_LIMIT,
          );
        }
        setPlaylistDetail(detail);
      } catch (error) {
        if (isDisposed) {
          return;
        }

        console.error("[liked-songs] failed to load liked playlist detail", error);
        setPlaylistDetail(likedPlaylist);
      }
    })();

    return () => {
      isDisposed = true;
    };
  }, [dataVersion, isNeteaseEnabled, likedPlaylist, settings]);

  useEffect(() => {
    let isDisposed = false;

    if (!isNeteaseEnabled || !neteaseAccount || !likedPlaylist?.id) {
      setPlaylistTracks([]);
      setTrackError(null);
      setIsLoadingTracks(false);
      return () => {
        isDisposed = true;
      };
    }

    setIsLoadingTracks(true);
    setTrackError(null);

    void (async () => {
      try {
        const playlistTracksCacheKey = buildNeteaseCacheKey(
          settings,
          `playlist:tracks:${likedPlaylist.id}`,
        );
        const cachedTracks = neteasePlaylistTracksCache.get(playlistTracksCacheKey);

        if (cachedTracks) {
          if (isDisposed) {
            return;
          }

          setPlaylistTracks(cachedTracks);
          setTrackError(null);
          setIsLoadingTracks(false);
          return;
        }

        const nextTracks = await getAllNeteasePlaylistTracks(settings, likedPlaylist.id);

        if (isDisposed) {
          return;
        }

        setBoundedMapValue(
          neteasePlaylistTracksCache,
          playlistTracksCacheKey,
          nextTracks,
          NETEASE_PLAYLIST_TRACKS_CACHE_LIMIT,
        );
        setPlaylistTracks(nextTracks);
      } catch (error) {
        if (isDisposed) {
          return;
        }

        console.error("[liked-songs] failed to load liked playlist tracks", error);
        setPlaylistTracks([]);
        setTrackError(
          error instanceof Error && error.message ? error.message : likedSongsCopy.loadingTracks,
        );
      } finally {
        if (!isDisposed) {
          setIsLoadingTracks(false);
        }
      }
    })();

    return () => {
      isDisposed = true;
    };
  }, [
    dataVersion,
    isNeteaseEnabled,
    likedPlaylist?.id,
    likedSongsCopy.loadingTracks,
    neteaseAccount,
    settings,
  ]);

  useEffect(() => {
    setPlaylistPage(1);
  }, [likedPlaylist?.id]);

  const selectedPlaylist =
    playlistDetail && likedPlaylist && playlistDetail.id === likedPlaylist.id
      ? {
          ...playlistDetail,
          subscribed: likedPlaylist.subscribed,
          creatorUserId: likedPlaylist.creatorUserId,
          creatorName: likedPlaylist.creatorName ?? playlistDetail.creatorName,
        }
      : playlistDetail ?? likedPlaylist;
  const tracksPerPage = 50;
  const totalTrackPages = Math.max(1, Math.ceil(playlistTracks.length / tracksPerPage));
  const visiblePlaylistTracks = playlistTracks.slice(
    (playlistPage - 1) * tracksPerPage,
    playlistPage * tracksPerPage,
  );
  const likedPlaylistDescription = truncateText(
    selectedPlaylist?.description || likedSongsCopy.detailDescription,
    220,
  );

  useEffect(() => {
    if (playlistPage > totalTrackPages) {
      setPlaylistPage(totalTrackPages);
    }
  }, [playlistPage, totalTrackPages]);

  return (
    <section className="playlist-screen">
      {!isNeteaseEnabled ? (
        <p className="library-empty">{likedSongsCopy.notEnabled}</p>
      ) : !hasSavedNeteaseCookie || neteaseAccount === null ? (
        isLoadingCollections ? (
          <UILoadingBlock label={likedSongsCopy.loading} variant="grid" />
        ) : (
          <p className="library-empty">{likedSongsCopy.notLoggedIn}</p>
        )
      ) : collectionError ? (
        <p className="library-empty">{collectionError}</p>
      ) : isLoadingCollections && !selectedPlaylist ? (
        <UILoadingBlock label={likedSongsCopy.loading} variant="grid" />
      ) : !selectedPlaylist ? (
        <p className="library-empty">{likedSongsCopy.empty}</p>
      ) : (
        <div className="playlist-detail-view">
          <section
            className="playlist-detail-card"
            onContextMenu={(event) => onPlaylistContextMenu(event, selectedPlaylist)}
          >
            <div className="playlist-detail-card__hero">
              <div className="playlist-detail-card__artwork" aria-hidden="true">
                {selectedPlaylist.artworkUrl ? (
                  <img src={selectedPlaylist.artworkUrl} alt="" loading="lazy" />
                ) : (
                  <span className="playlist-detail-card__fallback">
                    <AlbumsTileIcon />
                  </span>
                )}
              </div>
              <div className="playlist-detail-card__meta">
                <h3 className="settings-screen__title">{selectedPlaylist.name}</h3>
                <p
                  className="settings-screen__description playlist-detail-card__description"
                  title={selectedPlaylist.description || likedSongsCopy.detailDescription}
                >
                  {likedPlaylistDescription}
                </p>
                <div className="playlist-detail-card__stats">
                  <div className="home-stat-card">
                    <span>{likedSongsCopy.ownerPrefix}</span>
                    <strong>{selectedPlaylist.creatorName || "--"}</strong>
                  </div>
                  <div className="home-stat-card">
                    <span>{likedSongsCopy.countSuffix}</span>
                    <strong>{selectedPlaylist.trackCount?.toLocaleString(copy.locale) ?? "--"}</strong>
                  </div>
                  <div className="home-stat-card">
                    <span>{homeCopy.playCountSuffix}</span>
                    <strong>
                      {selectedPlaylist.playCount !== null
                        ? formatHomeCount(selectedPlaylist.playCount, copy.locale)
                        : "--"}
                    </strong>
                  </div>
                </div>
              </div>
            </div>

            <div className="home-section__header">
              <div>
                <h3 className="settings-card__title">{likedSongsCopy.title}</h3>
              </div>
              <div className="playlist-detail-card__toolbar">
                {!isLoadingTracks && playlistTracks.length > 0 && selectedPlaylist ? (
                  <IntelligenceModeButton
                    label={likedSongsCopy.startIntelligenceMode}
                    onClick={() =>
                      onStartIntelligenceMode(
                        {
                          id: selectedPlaylist.id,
                          title: selectedPlaylist.name,
                        },
                        playlistTracks[0],
                        playlistTracks,
                      )}
                  />
                ) : null}
                {isLoadingTracks ? (
                  <span className="home-section__hint">{likedSongsCopy.loadingTracks}</span>
                ) : null}
                {!isLoadingTracks && playlistTracks.length > 0 ? (
                  <span className="home-section__hint">
                    {likedSongsCopy.pageLabel} {playlistPage} / {totalTrackPages}
                  </span>
                ) : null}
              </div>
            </div>

            {trackError ? (
              <p className="library-empty">{trackError}</p>
            ) : isLoadingTracks ? (
              <UILoadingBlock label={likedSongsCopy.loadingTracks} variant="list" items={5} />
            ) : playlistTracks.length === 0 ? (
              <p className="library-empty">{likedSongsCopy.emptyTracks}</p>
            ) : (
              <>
                <div className="home-song-list">
                  {visiblePlaylistTracks.map((track, index) => (
                    <div
                      key={track.id}
                      className="home-song-card"
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        onPlayNeteaseTrack(track.id, playlistTracks, {
                          id: selectedPlaylist.id,
                          title: selectedPlaylist.name,
                        })
                      }
                      onContextMenu={(event) => onSongContextMenu(event, track, playlistTracks)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onPlayNeteaseTrack(track.id, playlistTracks, {
                            id: selectedPlaylist.id,
                            title: selectedPlaylist.name,
                          });
                        }
                      }}
                    >
                      <span className="home-song-card__cover" aria-hidden="true">
                        {track.artworkUrl ? (
                          <img src={track.artworkUrl} alt="" loading="lazy" />
                        ) : (
                          <span className="home-song-card__cover-fallback">
                            <SongsTileIcon />
                          </span>
                        )}
                      </span>
                      <span className="home-song-card__copy">
                        <span className="home-song-card__title">{track.name}</span>
                        <span className="home-song-card__subtitle">
                          <SongArtistLinks
                            fallback={copy.library.songFields.unknownArtist}
                            artists={track.artists.map((artistName, artistIndex) => ({
                              key: `${track.id}:artist:${artistName}:${artistIndex}`,
                              name: artistName,
                              onClick: track.artistIds[artistIndex]
                                ? () => onOpenSongArtist(track.artistIds[artistIndex]!, artistName)
                                : undefined,
                            }))}
                          />
                        </span>
                      </span>
                      <span className="home-song-card__meta">
                        <SongMetaButton
                          label={track.album || copy.library.songFields.unknownAlbum}
                          onClick={() =>
                            track.albumId
                              ? onOpenSongAlbum(
                                  track.albumId,
                                  track.album || copy.library.songFields.unknownAlbum,
                                )
                              : undefined
                          }
                          disabled={!track.albumId}
                        />
                      </span>
                      <span className="home-song-card__duration">
                        {formatDurationMs(track.durationMs)}
                      </span>
                      <span className="home-song-card__badge">
                        #{(playlistPage - 1) * tracksPerPage + index + 1}
                      </span>
                    </div>
                  ))}
                </div>
                <UIPagination
                  currentPage={playlistPage}
                  totalPages={totalTrackPages}
                  pageLabel={likedSongsCopy.pageLabel}
                  firstPageLabel={copy.locale === "en-US" ? "First page" : "首页"}
                  previousPageLabel={likedSongsCopy.prevPage}
                  nextPageLabel={likedSongsCopy.nextPage}
                  lastPageLabel={copy.locale === "en-US" ? "Last page" : "尾页"}
                  onPageChange={setPlaylistPage}
                />
              </>
            )}
          </section>
        </div>
      )}
    </section>
  );
}

function ToolsScreen({
  copy,
  onOpenKugouImport,
}: {
  copy: UiCopy;
  onOpenKugouImport: () => void;
}) {
  const toolsCopy = getToolsCopy(copy.locale);

  return (
    <section className="settings-screen tools-screen">
      <header className="settings-screen__hero">
        <h2 className="settings-screen__title">{toolsCopy.title}</h2>
        <p className="settings-screen__description">{toolsCopy.description}</p>
      </header>

      <div className="settings-grid tools-screen__grid">
        <section
          className="settings-card tools-screen__card tools-screen__entry-card"
          role="button"
          tabIndex={0}
          onClick={onOpenKugouImport}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpenKugouImport();
            }
          }}
        >
          <div className="tools-screen__entry-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M5 6.5h14" />
              <path d="M5 12h14" />
              <path d="M5 17.5h9" />
              <path d="M15.5 15.5l3 3 4-5" />
            </svg>
          </div>
          <div className="tools-screen__entry-copy">
            <p className="settings-card__eyebrow">{toolsCopy.eyebrow}</p>
            <h3 className="settings-card__title">{toolsCopy.kugouTitle}</h3>
            <p className="settings-card__description">{toolsCopy.kugouDescription}</p>
          </div>
          <UIButton variant="secondary" className="tools-screen__entry-action" onClick={onOpenKugouImport}>
            {toolsCopy.open}
          </UIButton>
        </section>
      </div>
    </section>
  );
}

function KugouImportScreen({
  copy,
  settings,
  playlists,
  isLoadingPlaylists,
  selectedPlaylistId,
  fileName,
  parsedTracks,
  logs,
  progress,
  phase,
  isImporting,
  retryingTrackIndex,
  errorRetryCount,
  unresolvedRetryCount,
  timeoutMs,
  concurrency,
  matchStrictness,
  onSelectPlaylist,
  onSelectFile,
  onImport,
  onBack,
  onChangeErrorRetryCount,
  onChangeUnresolvedRetryCount,
  onChangeTimeoutMs,
  onChangeConcurrency,
  onChangeMatchStrictness,
  onRetryEntry,
}: {
  copy: UiCopy;
  settings: AppSettings;
  playlists: NeteasePlaylistRecommendation[];
  isLoadingPlaylists: boolean;
  selectedPlaylistId: string;
  fileName: string;
  parsedTracks: ParsedKugouPlaylistTrack[];
  logs: KugouImportLogEntry[];
  progress: {
    current: number;
    total: number;
    matched: number;
    skipped: number;
    duplicate: number;
    failed: number;
  };
  phase: KugouImportPhase;
  isImporting: boolean;
  retryingTrackIndex: number | null;
  errorRetryCount: number;
  unresolvedRetryCount: number;
  timeoutMs: number;
  concurrency: number;
  matchStrictness: KugouTrackMatchStrictness;
  onSelectPlaylist: (value: string) => void;
  onSelectFile: (file: File | null) => void;
  onImport: () => void;
  onBack: () => void;
  onChangeErrorRetryCount: (value: number) => void;
  onChangeUnresolvedRetryCount: (value: number) => void;
  onChangeTimeoutMs: (value: number) => void;
  onChangeConcurrency: (value: number) => void;
  onChangeMatchStrictness: (value: KugouTrackMatchStrictness) => void;
  onRetryEntry: (entry: KugouImportLogEntry) => void;
}) {
  const kugouImportCopy = getKugouImportCopy(copy.locale);
  const toolsCopy = getToolsCopy(copy.locale);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isNeteaseEnabled = isNeteaseSourceEnabled(settings);
  const hasSavedNeteaseCookie = settings.network.neteaseCookie.trim().length > 0;
  const playlistOptions: UISelectOption[] =
    playlists.length > 0
      ? playlists.map((playlist) => ({
          value: String(playlist.id),
          label: playlist.name,
          description:
            playlist.description ||
            `${playlist.trackCount?.toLocaleString(copy.locale) ?? "--"} ${
              copy.locale === "en-US" ? "tracks" : "首歌曲"
            }`,
        }))
      : [
          {
            value: "",
            label: kugouImportCopy.playlistPlaceholder,
          },
        ];
  const strictnessOptions: UISelectOption[] = [
    { value: "exactTitleArtist", label: kugouImportCopy.exactTitleArtist },
    { value: "fuzzyTitleArtist", label: kugouImportCopy.fuzzyTitleArtist },
    { value: "titleOnly", label: kugouImportCopy.titleOnly },
  ];
  const previewTracks = parsedTracks.slice(0, 8);
  const progressPercent =
    progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const hasPreview = fileName.length > 0 && previewTracks.length > 0;
  const showResults = phase === "completed";
  const summaryItems = [
    progress.matched > 0
      ? { key: "matched", label: kugouImportCopy.compactMatched, value: progress.matched }
      : null,
    progress.skipped > 0
      ? { key: "skipped", label: kugouImportCopy.compactSkipped, value: progress.skipped }
      : null,
    progress.duplicate > 0
      ? { key: "duplicate", label: kugouImportCopy.compactDuplicate, value: progress.duplicate }
      : null,
    progress.failed > 0
      ? { key: "failed", label: kugouImportCopy.compactFailed, value: progress.failed }
      : null,
  ].filter((item): item is { key: string; label: string; value: number } => item !== null);
  const canImport =
    isNeteaseEnabled &&
    hasSavedNeteaseCookie &&
    playlists.length > 0 &&
    selectedPlaylistId.length > 0 &&
    parsedTracks.length > 0 &&
    !isImporting;

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    void onSelectFile(file);
    event.target.value = "";
  };

  return (
    <section className="settings-screen tools-screen">
      <div className="tools-screen__toolbar">
        <UIButton variant="secondary" onClick={onBack}>
          {toolsCopy.back}
        </UIButton>
      </div>
      <header className="settings-screen__hero">
        <h2 className="settings-screen__title">{kugouImportCopy.title}</h2>
        <p className="settings-screen__description">{kugouImportCopy.description}</p>
      </header>

      {!isNeteaseEnabled ? (
        <p className="library-empty">{kugouImportCopy.notEnabled}</p>
      ) : !hasSavedNeteaseCookie ? (
        <p className="library-empty">{kugouImportCopy.notLoggedIn}</p>
      ) : (
        <div className="settings-grid tools-screen__grid">
          <section className="settings-card tools-screen__card">
            <p className="settings-card__eyebrow">{toolsCopy.eyebrow}</p>
            <h3 className="settings-card__title">{kugouImportCopy.title}</h3>

            <UISelect
              label={kugouImportCopy.playlistLabel}
              helper={
                isLoadingPlaylists ? kugouImportCopy.loadingPlaylists : kugouImportCopy.playlistHelper
              }
              options={playlistOptions}
              value={selectedPlaylistId || playlistOptions[0]?.value || ""}
              onChange={onSelectPlaylist}
            />

            <div className="tools-screen__options-grid">
              <div>
                <UISlider
                  label={kugouImportCopy.errorRetryLabel}
                  value={errorRetryCount}
                  min={0}
                  max={5}
                  step={1}
                  valueSuffix={copy.locale === "en-US" ? "" : " 次"}
                  onChange={onChangeErrorRetryCount}
                />
                <span className="ui-field__helper">{kugouImportCopy.errorRetryHelper}</span>
              </div>
              <div>
                <UISlider
                  label={kugouImportCopy.unresolvedRetryLabel}
                  value={unresolvedRetryCount}
                  min={0}
                  max={5}
                  step={1}
                  valueSuffix={copy.locale === "en-US" ? "" : " 次"}
                  onChange={onChangeUnresolvedRetryCount}
                />
                <span className="ui-field__helper">{kugouImportCopy.unresolvedRetryHelper}</span>
              </div>
              <div>
                <UISlider
                  label={kugouImportCopy.timeoutLabel}
                  value={timeoutMs}
                  min={1000}
                  max={30000}
                  step={500}
                  valueSuffix=" ms"
                  onChange={onChangeTimeoutMs}
                />
                <span className="ui-field__helper">{kugouImportCopy.timeoutHelper}</span>
              </div>
              <div>
                <UISlider
                  label={kugouImportCopy.concurrencyLabel}
                  value={concurrency}
                  min={1}
                  max={8}
                  step={1}
                  valueSuffix={copy.locale === "en-US" ? "" : " 个"}
                  onChange={onChangeConcurrency}
                />
                <span className="ui-field__helper">{kugouImportCopy.concurrencyHelper}</span>
              </div>
              <div className="tools-screen__option-span">
                <UISelect
                  label={kugouImportCopy.matchStrictnessLabel}
                  helper={kugouImportCopy.matchStrictnessHelper}
                  options={strictnessOptions}
                  value={matchStrictness}
                  onChange={(value) => onChangeMatchStrictness(value as KugouTrackMatchStrictness)}
                />
              </div>
            </div>

            <div className="tools-screen__actions">
              <UIButton
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
              >
                {fileName ? kugouImportCopy.replaceFile : kugouImportCopy.chooseFile}
              </UIButton>
              <UIButton variant="primary" onClick={onImport} disabled={!canImport}>
                {isImporting ? kugouImportCopy.importing : kugouImportCopy.importAction}
              </UIButton>
              <input
                ref={fileInputRef}
                className="tools-screen__file-input"
                type="file"
                accept=".json,application/json"
                onChange={handleFileChange}
              />
            </div>

            <div className="tools-screen__summary">
              <div className="tools-screen__summary-row">
                <span>{kugouImportCopy.fileLabel}</span>
                <strong>{fileName || kugouImportCopy.fileEmpty}</strong>
              </div>
              <div className="tools-screen__summary-row">
                <span>{kugouImportCopy.parsedCount}</span>
                <strong>{parsedTracks.length.toLocaleString(copy.locale)}</strong>
              </div>
              <div className="tools-screen__summary-row">
                <span>{kugouImportCopy.progressLabel}</span>
                <strong>
                  {progress.current} / {progress.total}
                </strong>
              </div>
            </div>

            <div
              className="tools-screen__progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent}
            >
              <span
                className="tools-screen__progress-fill"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {summaryItems.length > 0 ? (
              <div className="tools-screen__stats">
                {summaryItems.map((item) => (
                  <span
                    key={item.key}
                    className={[
                      "tools-screen__status",
                      `tools-screen__status--${
                        item.key === "matched"
                          ? "matched"
                          : item.key === "failed"
                            ? "failed"
                            : item.key === "duplicate"
                              ? "duplicate"
                              : "skipped"
                      }`,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {item.label} {item.value}
                  </span>
                ))}
              </div>
            ) : null}

            {!isLoadingPlaylists && playlists.length === 0 ? (
              <p className="library-empty">{kugouImportCopy.noPlaylists}</p>
            ) : null}
          </section>

          {hasPreview ? (
            <section className="settings-card tools-screen__card">
              <p className="settings-card__eyebrow">{kugouImportCopy.previewTitle}</p>
              <h3 className="settings-card__title">{kugouImportCopy.summaryReady}</h3>
              <div className="tools-screen__list">
                {previewTracks.map((track) => (
                  <div
                    key={`kugou-preview:${track.index}`}
                    className="tools-screen__list-item tools-screen__list-item--compact tools-screen__list-item--dense"
                  >
                    <div className="tools-screen__list-copy tools-screen__list-copy--dense">
                      <strong>{track.title}</strong>
                      <span>{track.artists.join(" / ") || kugouImportCopy.previewArtistsFallback}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {showResults ? (
            <section className="settings-card tools-screen__card tools-screen__card--logs">
              <p className="settings-card__eyebrow">{kugouImportCopy.logTitle}</p>
              <h3 className="settings-card__title">{kugouImportCopy.summaryDone}</h3>
              <div className="tools-screen__list tools-screen__list--logs">
                {logs.map((entry) => (
                  <div
                    key={`kugou-log:${entry.sourceIndex}:${entry.status}`}
                    className={[
                      "tools-screen__list-item",
                      "tools-screen__list-item--compact",
                      "tools-screen__list-item--dense",
                      entry.status !== "matched" ? "tools-screen__list-item--retryable" : "",
                      retryingTrackIndex === entry.sourceIndex ? "tools-screen__list-item--retrying" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    role={entry.status !== "matched" ? "button" : undefined}
                    tabIndex={entry.status !== "matched" ? 0 : -1}
                    onClick={() => {
                      if (entry.status !== "matched" && retryingTrackIndex === null) {
                        onRetryEntry(entry);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (
                        entry.status !== "matched" &&
                        retryingTrackIndex === null &&
                        (event.key === "Enter" || event.key === " ")
                      ) {
                        event.preventDefault();
                        onRetryEntry(entry);
                      }
                    }}
                  >
                    <div className="tools-screen__list-copy tools-screen__list-copy--dense">
                      <strong>{entry.trackTitle}</strong>
                      <span
                        className={[
                          "tools-screen__status",
                          `tools-screen__status--${entry.status}`,
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {retryingTrackIndex === entry.sourceIndex
                          ? kugouImportCopy.retrying
                          : entry.status === "matched"
                            ? kugouImportCopy.matched
                            : entry.status === "skipped"
                              ? kugouImportCopy.skipped
                              : entry.status === "duplicate"
                                ? kugouImportCopy.compactDuplicate
                                : kugouImportCopy.failed}
                      </span>
                    </div>
                    {entry.status === "failed" || entry.status === "duplicate" ? (
                      <div className="tools-screen__log-meta tools-screen__log-meta--dense">
                        <span className="tools-screen__log-detail">{entry.detail}</span>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </section>
  );
}

function findLikedPlaylist(playlists: NeteasePlaylistRecommendation[], userId: number) {
  const ownPlaylists = playlists.filter(
    (playlist) => playlist.creatorUserId === userId || playlist.subscribed === false,
  );
  const isLikedPlaylist = (playlist: NeteasePlaylistRecommendation) => {
    const normalizedName = playlist.name.trim().toLowerCase();
    return normalizedName.includes("喜欢") ||
      normalizedName.includes("liked") ||
      normalizedName.includes("favorite");
  };

  return (
    ownPlaylists.find(isLikedPlaylist) ??
    playlists.find(isLikedPlaylist) ??
    ownPlaylists[0] ??
    playlists[0] ??
    null
  );
}

function prioritizePlaylist(
  playlists: NeteasePlaylistRecommendation[],
  targetPlaylistId: number | null,
) {
  if (!targetPlaylistId) {
    return playlists;
  }

  const targetPlaylist = playlists.find((playlist) => playlist.id === targetPlaylistId);
  return targetPlaylist
    ? [targetPlaylist, ...playlists.filter((playlist) => playlist.id !== targetPlaylistId)]
    : playlists;
}

function mergePlaylistRecommendations(
  ...playlistGroups: NeteasePlaylistRecommendation[][]
) {
  const uniquePlaylists = new Map<number, NeteasePlaylistRecommendation>();

  for (const playlistGroup of playlistGroups) {
    for (const playlist of playlistGroup) {
      if (!uniquePlaylists.has(playlist.id)) {
        uniquePlaylists.set(playlist.id, playlist);
      }
    }
  }

  return Array.from(uniquePlaylists.values());
}

function LibraryScreen({
  copy,
  settings,
  mediaLibrary,
  scanDirectories,
  showAlbumArtwork,
  activeTrackId,
  isLoading,
  isImporting,
  isDeletingTracks,
  view,
  selectedArtist,
  selectedAlbum,
  selectedArtistDetail,
  selectedAlbumDetail,
  onChangeView,
  onChangeSelectedArtist,
  onChangeSelectedAlbum,
  onChangeSelectedArtistDetail,
  onChangeSelectedAlbumDetail,
  navigationRequest,
  onConsumeNavigationRequest,
  onImportAudioFiles,
  onImportAudioDirectory,
  onDeleteTracks,
  onPlayTrack,
  onOpenTrackArtist,
  onOpenTrackAlbum,
  onTrackContextMenu,
}: {
  copy: UiCopy;
  settings: AppSettings;
  mediaLibrary: MediaLibrarySnapshot | null;
  scanDirectories: string[];
  showAlbumArtwork: boolean;
  activeTrackId: string | null;
  isLoading: boolean;
  isImporting: boolean;
  isDeletingTracks: boolean;
  view: LibraryView;
  selectedArtist: string | null;
  selectedAlbum: string | null;
  selectedArtistDetail: {
    artist: string;
    trackCount: number;
    albumCount: number;
    representativeTrack: TrackRecord | null;
    avatarUrl: string | null;
  } | null;
  selectedAlbumDetail: {
    album: string;
    trackCount: number;
    artistCount: number;
    representativeTrack: TrackRecord | null;
  } | null;
  onChangeView: (view: LibraryView) => void;
  onChangeSelectedArtist: (artist: string | null) => void;
  onChangeSelectedAlbum: (album: string | null) => void;
  onChangeSelectedArtistDetail: (detail: {
    artist: string;
    trackCount: number;
    albumCount: number;
    representativeTrack: TrackRecord | null;
    avatarUrl: string | null;
  } | null) => void;
  onChangeSelectedAlbumDetail: (detail: {
    album: string;
    trackCount: number;
    artistCount: number;
    representativeTrack: TrackRecord | null;
  } | null) => void;
  navigationRequest: LibraryNavigationRequest;
  onConsumeNavigationRequest: () => void;
  onImportAudioFiles: () => void;
  onImportAudioDirectory: () => void;
  onDeleteTracks: (trackIds: string[]) => Promise<void> | void;
  onPlayTrack: (trackId: string, queueTracks: TrackRecord[]) => void;
  onOpenTrackArtist: (track: TrackRecord) => void;
  onOpenTrackAlbum: (track: TrackRecord) => void;
  onTrackContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    track: TrackRecord,
    queueTracks: TrackRecord[],
  ) => void;
}) {
  const selectedArtistRef = useRef<string | null>(null);
  const selectedAlbumRef = useRef<string | null>(null);
  const selectedArtistDetailRef = useRef<{
    artist: string;
    trackCount: number;
    albumCount: number;
    representativeTrack: TrackRecord | null;
    avatarUrl: string | null;
  } | null>(null);
  const selectedAlbumDetailRef = useRef<{
    album: string;
    trackCount: number;
    artistCount: number;
    representativeTrack: TrackRecord | null;
  } | null>(null);
  const viewHistoryRef = useRef<LibraryView[]>([]);
  const artistAvatarRequestsRef = useRef<Set<string>>(new Set());
  const [artistAvatarUrls, setArtistAvatarUrls] = useState<Record<string, string | null>>({});
  const [songQuery, setSongQuery] = useState("");
  const [songSourceFilter, setSongSourceFilter] = useState<"all" | "local" | "remote">("all");
  const [songSort, setSongSort] = useState<"recent" | "title" | "artist" | "album" | "duration">(
    "recent",
  );
  const [songPage, setSongPage] = useState(1);
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([]);
  const localeStrings = getLocaleStrings(copy.locale);
  const songBrowserCopy = getLibrarySongBrowserCopy(copy.locale);
  const viewCopy = copy.library.views;
  const unknownArtistLabel = copy.library.songFields.unknownArtist;
  const unknownAlbumLabel = copy.library.songFields.unknownAlbum;
  const tracks = mediaLibrary?.tracks ?? [];
  const artworksById = new Map((mediaLibrary?.artworks ?? []).map((artwork) => [artwork.id, artwork]));
  const isLibraryBusy = isImporting || isDeletingTracks;
  const artists = Array.from(
    new Map(
      tracks.map((track) => [
        track.artist?.trim() || unknownArtistLabel,
        track.artist?.trim() || unknownArtistLabel,
      ]),
    ).values(),
  ).sort((left, right) => left.localeCompare(right, copy.locale));
  const albums = Array.from(
    new Map(
      tracks.map((track) => [
        track.album?.trim() || unknownAlbumLabel,
        track.album?.trim() || unknownAlbumLabel,
      ]),
    ).values(),
  ).sort((left, right) => left.localeCompare(right, copy.locale));
  const artistSummaries = artists.map((artist) => {
    const artistTracks = tracks.filter(
      (track) => (track.artist?.trim() || unknownArtistLabel) === artist,
    );
    const representativeTrack =
      artistTracks.find((track) => resolveTrackArtworkUrl(track, artworksById) !== null) ??
      artistTracks[0] ??
      null;

    return {
      artist,
      trackCount: artistTracks.length,
      albumCount: new Set(
        artistTracks.map((track) => track.album?.trim() || unknownAlbumLabel),
      ).size,
      representativeTrack,
      avatarUrl: artistAvatarUrls[artist] ?? null,
    };
  });
  const albumSummaries = albums.map((album) => {
    const albumTracks = tracks.filter(
      (track) => (track.album?.trim() || unknownAlbumLabel) === album,
    );
    const representativeTrack =
      albumTracks.find((track) => resolveTrackArtworkUrl(track, artworksById) !== null) ??
      albumTracks[0] ??
      null;

    return {
      album,
      trackCount: albumTracks.length,
      artistCount: new Set(
        albumTracks.map((track) => track.artist?.trim() || unknownArtistLabel),
      ).size,
      representativeTrack,
    };
  });
  const selectedArtistSummary =
    (selectedArtist ?? selectedArtistRef.current) === null
      ? null
      : artistSummaries.find(
          (summary) => summary.artist === (selectedArtist ?? selectedArtistRef.current),
        ) ?? null;
  const selectedAlbumSummary =
    (selectedAlbum ?? selectedAlbumRef.current) === null
      ? null
      : albumSummaries.find(
          (summary) => summary.album === (selectedAlbum ?? selectedAlbumRef.current),
        ) ?? null;
  const resolvedSelectedArtistDetail =
    selectedArtistSummary ?? selectedArtistDetail ?? selectedArtistDetailRef.current;
  const resolvedSelectedAlbumDetail =
    selectedAlbumSummary ?? selectedAlbumDetail ?? selectedAlbumDetailRef.current;
  const selectedArtistTracks =
    resolvedSelectedArtistDetail === null
      ? []
      : tracks.filter(
          (track) =>
            (track.artist?.trim() || unknownArtistLabel) === resolvedSelectedArtistDetail.artist,
        );
  const selectedAlbumTracks =
    resolvedSelectedAlbumDetail === null
      ? []
      : tracks.filter(
          (track) =>
            (track.album?.trim() || unknownAlbumLabel) === resolvedSelectedAlbumDetail.album,
        );
  const normalizedSongQuery = songQuery.trim().toLocaleLowerCase(copy.locale);
  const songSourceOptions: UISelectOption[] = [
    {
      label: songBrowserCopy.sourceAll,
      value: "all",
    },
    {
      label: songBrowserCopy.sourceLocal,
      value: "local",
    },
    {
      label: songBrowserCopy.sourceRemote,
      value: "remote",
    },
  ];
  const songSortOptions: UISelectOption[] = [
    {
      label: songBrowserCopy.sortRecent,
      value: "recent",
    },
    {
      label: songBrowserCopy.sortTitle,
      value: "title",
    },
    {
      label: songBrowserCopy.sortArtist,
      value: "artist",
    },
    {
      label: songBrowserCopy.sortAlbum,
      value: "album",
    },
    {
      label: songBrowserCopy.sortDuration,
      value: "duration",
    },
  ];
  const filteredSongTracks = tracks.filter((track) => {
    if (songSourceFilter === "local" && track.source.kind !== "localFile") {
      return false;
    }

    if (songSourceFilter === "remote" && track.source.kind !== "remoteStream") {
      return false;
    }

    if (normalizedSongQuery.length === 0) {
      return true;
    }

    const searchValues = [
      track.title,
      track.artist,
      track.album,
      track.albumArtist,
      track.genre,
      track.source.kind === "localFile" ? track.source.fileName : copy.library.songFields.networkSource,
    ];

    return searchValues
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .some((value) => value.toLocaleLowerCase(copy.locale).includes(normalizedSongQuery));
  });
  const visibleSongTracks = [...filteredSongTracks].sort((left, right) => {
    const leftArtist = left.artist?.trim() || unknownArtistLabel;
    const rightArtist = right.artist?.trim() || unknownArtistLabel;
    const leftAlbum = left.album?.trim() || unknownAlbumLabel;
    const rightAlbum = right.album?.trim() || unknownAlbumLabel;

    switch (songSort) {
      case "title":
        return left.title.localeCompare(right.title, copy.locale);
      case "artist":
        return (
          leftArtist.localeCompare(rightArtist, copy.locale) ||
          left.title.localeCompare(right.title, copy.locale)
        );
      case "album":
        return (
          leftAlbum.localeCompare(rightAlbum, copy.locale) ||
          (left.trackNumber ?? Number.MAX_SAFE_INTEGER) -
            (right.trackNumber ?? Number.MAX_SAFE_INTEGER) ||
          left.title.localeCompare(right.title, copy.locale)
        );
      case "duration":
        return (
          (right.durationMs ?? -1) - (left.durationMs ?? -1) ||
          left.title.localeCompare(right.title, copy.locale)
        );
      case "recent":
      default:
        return (
          (right.importedAtMs ?? 0) - (left.importedAtMs ?? 0) ||
          (right.updatedAtMs ?? 0) - (left.updatedAtMs ?? 0)
        );
      }
  });
  const songsPerPage = 50;
  const totalSongPages = Math.max(1, Math.ceil(visibleSongTracks.length / songsPerPage));
  const pagedSongTracks = visibleSongTracks.slice(
    (songPage - 1) * songsPerPage,
    songPage * songsPerPage,
  );
  const visibleSongTrackIds = visibleSongTracks.map((track) => track.id);
  const selectedVisibleSongTrackCount = visibleSongTrackIds.filter((trackId) =>
    selectedTrackIds.includes(trackId),
  ).length;

  useEffect(() => {
    setSongPage(1);
  }, [songQuery, songSourceFilter, songSort]);

  useEffect(() => {
    if (songPage > totalSongPages) {
      setSongPage(totalSongPages);
    }
  }, [songPage, totalSongPages]);

  useEffect(() => {
    if (view === "hub") {
      viewHistoryRef.current = [];
    }
  }, [view]);

  useEffect(() => {
    selectedArtistRef.current = selectedArtist;
  }, [selectedArtist]);

  useEffect(() => {
    selectedAlbumRef.current = selectedAlbum;
  }, [selectedAlbum]);

  useEffect(() => {
    selectedArtistDetailRef.current = selectedArtistDetail;
  }, [selectedArtistDetail]);

  useEffect(() => {
    selectedAlbumDetailRef.current = selectedAlbumDetail;
  }, [selectedAlbumDetail]);

  useEffect(() => {
    if (!navigationRequest) {
      return;
    }

    if (navigationRequest.target === "artist") {
      onChangeSelectedArtist(navigationRequest.name);
      selectedArtistRef.current = navigationRequest.name;
      onChangeSelectedArtistDetail(null);
      selectedArtistDetailRef.current = null;
      viewHistoryRef.current = ["hub", "artists"];
      onChangeView("artistSongs");
      onConsumeNavigationRequest();
      return;
    }

    onChangeSelectedAlbum(navigationRequest.name);
    selectedAlbumRef.current = navigationRequest.name;
    onChangeSelectedAlbumDetail(null);
    selectedAlbumDetailRef.current = null;
    viewHistoryRef.current = ["hub", "albums"];
    onChangeView("albumSongs");
    onConsumeNavigationRequest();
  }, [
    navigationRequest,
    onChangeSelectedAlbum,
    onChangeSelectedAlbumDetail,
    onChangeSelectedArtist,
    onChangeSelectedArtistDetail,
    onChangeView,
    onConsumeNavigationRequest,
  ]);

  useEffect(() => {
    if (!isNeteaseSourceEnabled(settings)) {
      return;
    }

    const cachedEntries = artistSummaries
      .map((summary) => {
        const cacheKey = `${summary.artist.trim().toLocaleLowerCase(copy.locale)}`;
        return {
          artist: summary.artist,
          avatarUrl: neteaseArtistAvatarCache.get(cacheKey),
        };
      })
      .filter(
        (entry): entry is { artist: string; avatarUrl: string | null } =>
          entry.avatarUrl !== undefined,
      );

    if (cachedEntries.length > 0) {
      setArtistAvatarUrls((current) => {
        const next = { ...current };
        let hasChanged = false;

        cachedEntries.forEach((entry) => {
          if (next[entry.artist] !== entry.avatarUrl) {
            next[entry.artist] = entry.avatarUrl;
            hasChanged = true;
          }
        });

        return hasChanged ? next : current;
      });
    }

    const pendingArtists = artistSummaries.filter((summary) => {
      const normalizedArtist = summary.artist.trim();
      if (!normalizedArtist || normalizedArtist === unknownArtistLabel) {
        return false;
      }

      const cacheKey = normalizedArtist.toLocaleLowerCase(copy.locale);
      return (
        !neteaseArtistAvatarCache.has(cacheKey) &&
        !artistAvatarRequestsRef.current.has(cacheKey)
      );
    });

    if (pendingArtists.length === 0) {
      return;
    }

    let isDisposed = false;

    void (async () => {
      const resolvedEntries = await Promise.all(
        pendingArtists.map(async (summary) => {
          const normalizedArtist = summary.artist.trim();
          const cacheKey = normalizedArtist.toLocaleLowerCase(copy.locale);
          artistAvatarRequestsRef.current.add(cacheKey);

          try {
            const candidates = await searchNeteaseArtists(settings, normalizedArtist, {
              limit: 5,
            });
            const matchedArtist =
              candidates.find(
                (artist) =>
                  artist.name.trim().toLocaleLowerCase(copy.locale) ===
                  normalizedArtist.toLocaleLowerCase(copy.locale),
              ) ??
              candidates[0] ??
              null;
            const avatarUrl = matchedArtist?.avatarUrl ?? null;
            setBoundedMapValue(
              neteaseArtistAvatarCache,
              cacheKey,
              avatarUrl,
              NETEASE_ARTIST_AVATAR_CACHE_LIMIT,
            );
            return {
              artist: summary.artist,
              avatarUrl,
            };
          } catch {
            setBoundedMapValue(
              neteaseArtistAvatarCache,
              cacheKey,
              null,
              NETEASE_ARTIST_AVATAR_CACHE_LIMIT,
            );
            return {
              artist: summary.artist,
              avatarUrl: null,
            };
          } finally {
            artistAvatarRequestsRef.current.delete(cacheKey);
          }
        }),
      );

      if (isDisposed) {
        return;
      }

      setArtistAvatarUrls((current) => {
        const next = { ...current };
        let hasChanged = false;

        resolvedEntries.forEach((entry) => {
          if (next[entry.artist] !== entry.avatarUrl) {
            next[entry.artist] = entry.avatarUrl;
            hasChanged = true;
          }
        });

        return hasChanged ? next : current;
      });
    })();

    return () => {
      isDisposed = true;
    };
  }, [artistSummaries, copy.locale, settings, unknownArtistLabel]);

  const navigateLibraryView = (nextView: LibraryView) => {
    if (nextView === view) {
      return;
    }

    viewHistoryRef.current = [...viewHistoryRef.current, view];
    onChangeView(nextView);
  };

  const handleBackNavigation = () => {
    if (viewHistoryRef.current.length === 0) {
      onChangeView("hub");
      return;
    }

    const nextHistory = [...viewHistoryRef.current];
    const previousView = nextHistory.pop() ?? "hub";
    viewHistoryRef.current = nextHistory;
    onChangeView(previousView);
  };

  const previousLibraryView =
    viewHistoryRef.current[viewHistoryRef.current.length - 1] ?? "hub";
  const backButtonLabel = getLibraryBackLabel(copy.locale, previousLibraryView);

  useEffect(() => {
    if (view !== "artists" && view !== "artistSongs") {
      onChangeSelectedArtist(null);
      onChangeSelectedArtistDetail(null);
      selectedArtistRef.current = null;
      selectedArtistDetailRef.current = null;
    }

    if (view !== "albums" && view !== "albumSongs") {
      onChangeSelectedAlbum(null);
      onChangeSelectedAlbumDetail(null);
      selectedAlbumRef.current = null;
      selectedAlbumDetailRef.current = null;
    }

    if (view !== "songs") {
      setSelectedTrackIds([]);
    }
  }, [
    onChangeSelectedAlbum,
    onChangeSelectedAlbumDetail,
    onChangeSelectedArtist,
    onChangeSelectedArtistDetail,
    view,
  ]);

  useEffect(() => {
    const knownTrackIds = new Set(tracks.map((track) => track.id));
    setSelectedTrackIds((current) => current.filter((trackId) => knownTrackIds.has(trackId)));
  }, [tracks]);

  useEffect(() => {
    if (view !== "songs") {
      return;
    }

    const visibleTrackIdSet = new Set(visibleSongTrackIds);
    setSelectedTrackIds((current) => {
      const nextSelection = current.filter((trackId) => visibleTrackIdSet.has(trackId));
      return nextSelection.length === current.length &&
        nextSelection.every((trackId, index) => trackId === current[index])
        ? current
        : nextSelection;
    });
  }, [view, visibleSongTrackIds]);

  const handleToggleSongSelection = (trackId: string) => {
    setSelectedTrackIds((current) =>
      current.includes(trackId)
        ? current.filter((candidateId) => candidateId !== trackId)
        : [...current, trackId],
    );
  };

  const handleSelectVisibleSongs = () => {
    setSelectedTrackIds((current) => Array.from(new Set([...current, ...visibleSongTrackIds])));
  };

  const handleClearSongSelection = () => {
    setSelectedTrackIds([]);
  };

  const handleDeleteSelectedSongs = async () => {
    if (selectedTrackIds.length === 0) {
      return;
    }

    await onDeleteTracks(selectedTrackIds);
    setSelectedTrackIds([]);
  };

  const selectedArtistAlbums = resolvedSelectedArtistDetail
    ? albumSummaries.filter((summary) =>
        selectedArtistTracks.some(
          (track) =>
            (track.album?.trim() || unknownAlbumLabel) === summary.album &&
            (track.artist?.trim() || unknownArtistLabel) === resolvedSelectedArtistDetail.artist,
        ),
      )
    : [];

  if (view === "hub") {
    return (
      <section className="settings-screen">
        <header className="settings-screen__header">
          <div>
            <h2 className="settings-screen__title">{copy.library.title}</h2>
            <p className="settings-screen__description">{copy.library.description}</p>
          </div>
        </header>

        <div className="library-entry-grid">
          <button
            className="library-entry-card library-entry-card--import"
            type="button"
            onClick={() => navigateLibraryView("import")}
          >
            <span className="library-entry-card__icon" aria-hidden="true">
              <ImportTileIcon />
            </span>
            <span className="library-entry-card__eyebrow">{copy.library.importCard.eyebrow}</span>
            <strong className="library-entry-card__title">{copy.library.importCard.title}</strong>
            <span className="library-entry-card__details">
              <span className="library-entry-card__body">
                {copy.library.importCard.body}
              </span>
              <span className="library-entry-card__meta">
                {isImporting
                  ? copy.library.importCard.importing
                  : `${scanDirectories.length} ${copy.library.importCard.scanDirectoriesSuffix}`}
              </span>
            </span>
          </button>

          <button
            className="library-entry-card"
            type="button"
            onClick={() => navigateLibraryView("songs")}
          >
            <span className="library-entry-card__icon" aria-hidden="true">
              <SongsTileIcon />
            </span>
            <span className="library-entry-card__eyebrow">{copy.library.songsCard.eyebrow}</span>
            <strong className="library-entry-card__title">{copy.library.songsCard.title}</strong>
            <span className="library-entry-card__details">
              <span className="library-entry-card__body">
                {copy.library.songsCard.body}
              </span>
              <span className="library-entry-card__meta">
                {tracks.length} {copy.library.songsCard.suffix}
              </span>
            </span>
          </button>

          <button
            className="library-entry-card"
            type="button"
            onClick={() => navigateLibraryView("artists")}
          >
            <span className="library-entry-card__icon" aria-hidden="true">
              <ArtistsTileIcon />
            </span>
            <span className="library-entry-card__eyebrow">{copy.library.artistsCard.eyebrow}</span>
            <strong className="library-entry-card__title">{copy.library.artistsCard.title}</strong>
            <span className="library-entry-card__details">
              <span className="library-entry-card__body">
                {copy.library.artistsCard.body}
              </span>
              <span className="library-entry-card__meta">
                {artists.length} {copy.library.artistsCard.suffix}
              </span>
            </span>
          </button>

          <button
            className="library-entry-card"
            type="button"
            onClick={() => navigateLibraryView("albums")}
          >
            <span className="library-entry-card__icon" aria-hidden="true">
              <AlbumsTileIcon />
            </span>
            <span className="library-entry-card__eyebrow">{copy.library.albumsCard.eyebrow}</span>
            <strong className="library-entry-card__title">{copy.library.albumsCard.title}</strong>
            <span className="library-entry-card__details">
              <span className="library-entry-card__body">
                {copy.library.albumsCard.body}
              </span>
              <span className="library-entry-card__meta">
                {albums.length} {copy.library.albumsCard.suffix}
              </span>
            </span>
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="settings-screen">
      <header className="settings-screen__header">
        <div>
          <h2 className="settings-screen__title">
            {view === "import"
              ? viewCopy.import.title
              : view === "songs"
                ? viewCopy.songs.title
                : view === "artists"
                  ? viewCopy.artists.title
                  : view === "albums"
                    ? viewCopy.albums.title
                    : view === "artistSongs"
                      ? selectedArtistSummary?.artist ?? localeStrings.library.artistSongsFallbackTitle
                      : selectedAlbumSummary?.album ?? localeStrings.library.albumSongsFallbackTitle}
          </h2>
          <p className="settings-screen__description">
            {view === "import"
              ? viewCopy.import.description
              : view === "songs"
                ? viewCopy.songs.description
                : view === "artists"
                  ? viewCopy.artists.description
                  : view === "albums"
                    ? viewCopy.albums.description
                    : view === "artistSongs"
                      ? localeStrings.library.artistSongsDescription
                      : localeStrings.library.albumSongsDescription}
          </p>
        </div>

        <div className="settings-screen__actions">
          <UIButton variant="secondary" onClick={handleBackNavigation}>
            {backButtonLabel}
          </UIButton>
          {view === "import" ? (
            <>
              <UIButton
                variant="secondary"
                onClick={onImportAudioDirectory}
                disabled={isLoading || isImporting}
              >
                {copy.library.buttons.importDirectory}
              </UIButton>
              <UIButton
                variant="primary"
                onClick={onImportAudioFiles}
                disabled={isLoading || isImporting}
              >
                {isImporting ? copy.library.importCard.importing : copy.library.buttons.importAudio}
              </UIButton>
            </>
          ) : null}
        </div>
      </header>

      {view === "import" ? (
        <div className="settings-grid">
          <section className="settings-card">
            <div className="settings-card__header">
              <div>
                <p className="settings-card__eyebrow">{copy.library.importOverview.eyebrow}</p>
                <h3 className="settings-card__title">{copy.library.importOverview.title}</h3>
              </div>
            </div>

            {isLoading ? (
              <UILoadingBlock label={copy.library.empty.loading} variant="inline" />
            ) : (
              <div className="library-stats">
                <div className="library-stat">
                  <strong>{tracks.length}</strong>
                  <span>{copy.library.importOverview.importedTracks}</span>
                </div>
                <div className="library-stat">
                  <strong>{scanDirectories.length}</strong>
                  <span>{copy.library.importOverview.scanDirectories}</span>
                </div>
              </div>
            )}
          </section>

          <section className="settings-card">
            <div className="settings-card__header">
              <div>
                <p className="settings-card__eyebrow">{copy.library.importDirectories.eyebrow}</p>
                <h3 className="settings-card__title">{copy.library.importDirectories.title}</h3>
              </div>
            </div>

            <div className="library-directory-list">
              {isLoading ? (
                <UILoadingBlock label={copy.library.empty.loading} variant="list" items={3} />
              ) : scanDirectories.length === 0 ? (
                <p className="library-empty">{copy.library.importDirectories.empty}</p>
              ) : (
                scanDirectories.map((directory) => (
                  <div key={directory} className="library-directory-item">
                    {directory}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      ) : null}

      {view === "songs" ? (
        <section className="settings-card settings-card--list library-song-browser">
          <div className="library-song-toolbar">
            <div className="library-song-toolbar__search">
              <UITextField
                label={songBrowserCopy.searchLabel}
                placeholder={songBrowserCopy.searchPlaceholder}
                value={songQuery}
                onChange={setSongQuery}
                prefix={<SearchIcon />}
              />
            </div>
            <div className="library-song-toolbar__field">
              <UISelect
                label={songBrowserCopy.sourceLabel}
                options={songSourceOptions}
                value={songSourceFilter}
                onChange={(value) => setSongSourceFilter(value as "all" | "local" | "remote")}
              />
            </div>
            <div className="library-song-toolbar__field">
              <UISelect
                label={songBrowserCopy.sortLabel}
                options={songSortOptions}
                value={songSort}
                onChange={(value) =>
                  setSongSort(value as "recent" | "title" | "artist" | "album" | "duration")
                }
              />
            </div>
          </div>

          <div className="library-song-toolbar library-song-toolbar--meta">
            <div className="library-song-toolbar__meta">
              <span className="library-song-toolbar__chip">
                {songBrowserCopy.resultLabel} {visibleSongTracks.length}
              </span>
              <span className="library-song-toolbar__chip">
                {songBrowserCopy.selectedLabel} {selectedTrackIds.length}
              </span>
              {visibleSongTracks.length > 0 ? (
                <span className="library-song-toolbar__chip">
                  {songBrowserCopy.pageLabel} {songPage} / {totalSongPages}
                </span>
              ) : null}
            </div>
            <div className="library-song-toolbar__actions">
              <UIButton
                variant="secondary"
                size="sm"
                onClick={handleSelectVisibleSongs}
                disabled={
                  isLoading ||
                  isLibraryBusy ||
                  visibleSongTrackIds.length === 0 ||
                  selectedVisibleSongTrackCount === visibleSongTrackIds.length
                }
              >
                {songBrowserCopy.selectAll}
              </UIButton>
              <UIButton
                variant="secondary"
                size="sm"
                onClick={handleClearSongSelection}
                disabled={isLoading || isLibraryBusy || selectedTrackIds.length === 0}
              >
                {songBrowserCopy.clearSelection}
              </UIButton>
              <UIButton
                variant="danger"
                size="sm"
                onClick={() => void handleDeleteSelectedSongs()}
                disabled={isLoading || isLibraryBusy || selectedTrackIds.length === 0}
              >
                {songBrowserCopy.removeSelected}
              </UIButton>
            </div>
          </div>

          <LibrarySongList
            tracks={pagedSongTracks}
            artworksById={artworksById}
            showAlbumArtwork={showAlbumArtwork}
            activeTrackId={activeTrackId}
            isLoading={isLoading}
            copy={copy}
            emptyMessage={copy.library.empty.noTracks}
            enableSelection
            selectionLabel={songBrowserCopy.selectionToggle}
            selectedTrackIds={selectedTrackIds}
            onToggleTrackSelection={handleToggleSongSelection}
            onPlayTrack={onPlayTrack}
            onOpenArtist={onOpenTrackArtist}
            onOpenAlbum={onOpenTrackAlbum}
            onTrackContextMenu={onTrackContextMenu}
          />
          <UIPagination
            currentPage={songPage}
            totalPages={totalSongPages}
            pageLabel={songBrowserCopy.pageLabel}
            firstPageLabel={copy.locale === "en-US" ? "First page" : "首页"}
            previousPageLabel={songBrowserCopy.prevPage}
            nextPageLabel={songBrowserCopy.nextPage}
            lastPageLabel={copy.locale === "en-US" ? "Last page" : "尾页"}
            onPageChange={setSongPage}
          />
        </section>
      ) : null}

      {view === "artists" ? (
        <section className="settings-card settings-card--list">
          <div className="library-entity-grid">
            {isLoading ? (
              <UILoadingBlock label={copy.library.empty.loading} variant="grid" />
            ) : artistSummaries.length === 0 ? (
              <p className="library-empty">{copy.library.empty.noArtists}</p>
            ) : (
              artistSummaries.map((summary) => {
                return (
                  <button
                    key={summary.artist}
                    className={[
                      "library-entity-card",
                      selectedArtistSummary?.artist === summary.artist
                        ? "library-entity-card--active"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    type="button"
                    onClick={() => {
                      selectedArtistRef.current = summary.artist;
                      selectedArtistDetailRef.current = summary;
                      onChangeSelectedArtist(summary.artist);
                      onChangeSelectedArtistDetail(summary);
                      navigateLibraryView("artistSongs");
                    }}
                  >
                    <div className="library-entity-card__media library-entity-card__media--artist">
                      {showAlbumArtwork ? (
                        summary.avatarUrl ? (
                          <img
                            src={summary.avatarUrl}
                            alt={`${summary.artist} ${localeStrings.library.artistAvatarSuffix}`}
                            loading="lazy"
                          />
                        ) : (
                          <span className="library-entity-card__fallback-icon">
                            <ArtistsTileIcon />
                          </span>
                        )
                      ) : (
                        <span className="library-entity-card__fallback-icon">
                          <ArtistsTileIcon />
                        </span>
                      )}
                    </div>
                    <div className="library-entity-card__eyebrow">{localeStrings.library.entityArtist}</div>
                    <div className="library-entity-card__title">{summary.artist}</div>
                    <div className="library-entity-card__meta">
                      {summary.trackCount} 首歌曲
                    </div>
                    <div className="library-entity-card__submeta">
                      {summary.albumCount} {copy.library.albumsCard.suffix}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>
      ) : null}

      {view === "albums" ? (
        <section className="settings-card settings-card--list">
          <div className="library-entity-grid">
            {isLoading ? (
              <UILoadingBlock label={copy.library.empty.loading} variant="grid" />
            ) : albumSummaries.length === 0 ? (
              <p className="library-empty">{copy.library.empty.noAlbums}</p>
            ) : (
              albumSummaries.map((summary) => {
                return (
                  <button
                    key={summary.album}
                    className={[
                      "library-entity-card",
                      selectedAlbumSummary?.album === summary.album
                        ? "library-entity-card--active"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    type="button"
                    onClick={() => {
                      selectedAlbumRef.current = summary.album;
                      selectedAlbumDetailRef.current = summary;
                      onChangeSelectedAlbum(summary.album);
                      onChangeSelectedAlbumDetail(summary);
                      navigateLibraryView("albumSongs");
                    }}
                  >
                    <div className="library-entity-card__media">
                      {showAlbumArtwork ? (
                        <EntityArtwork
                          track={summary.representativeTrack}
                          artworksById={artworksById}
                          alt={`${summary.album} ${localeStrings.library.albumCoverSuffix}`}
                          fallback={<AlbumsTileIcon />}
                        />
                      ) : (
                        <span className="library-entity-card__fallback-icon">
                          <AlbumsTileIcon />
                        </span>
                      )}
                    </div>
                    <div className="library-entity-card__eyebrow">{localeStrings.library.entityAlbum}</div>
                    <div className="library-entity-card__title">{summary.album}</div>
                    <div className="library-entity-card__meta">
                      {summary.trackCount} 首歌曲
                    </div>
                    <div className="library-entity-card__submeta">
                      {summary.artistCount} {copy.library.artistsCard.suffix}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>
      ) : null}

      {view === "artistSongs" ? (
        <>
          {resolvedSelectedArtistDetail ? (
            <section className="library-hero-card">
              <div className="library-hero-card__media library-hero-card__media--artist">
                {showAlbumArtwork ? (
                  resolvedSelectedArtistDetail.avatarUrl ? (
                    <img
                      src={resolvedSelectedArtistDetail.avatarUrl}
                      alt={`${resolvedSelectedArtistDetail.artist} ${localeStrings.library.artistAvatarSuffix}`}
                      loading="lazy"
                    />
                  ) : (
                    <span className="library-entity-card__fallback-icon">
                      <ArtistsTileIcon />
                    </span>
                  )
                ) : (
                  <span className="library-entity-card__fallback-icon">
                    <ArtistsTileIcon />
                  </span>
                )}
              </div>
              <div className="library-hero-card__content">
                <p className="settings-card__eyebrow">{localeStrings.library.entityArtist}</p>
                <h3 className="settings-card__title">{resolvedSelectedArtistDetail.artist}</h3>
                <p className="library-hero-card__meta">
                  {resolvedSelectedArtistDetail.trackCount} {copy.library.songsCard.suffix} /{" "}
                  {resolvedSelectedArtistDetail.albumCount} {copy.library.albumsCard.suffix}
                </p>
              </div>
            </section>
          ) : null}
          {selectedArtistAlbums.length > 0 ? (
            <section className="settings-card settings-card--list">
              <header className="settings-card__header">
                <div>
                  <p className="settings-card__eyebrow">{localeStrings.library.entityAlbum}</p>
                  <h3 className="settings-card__title">{copy.library.albumsCard.title}</h3>
                </div>
              </header>
              <div className="library-entity-grid">
                {selectedArtistAlbums.map((summary) => (
                  <button
                    key={summary.album}
                    className={[
                      "library-entity-card",
                      selectedAlbumSummary?.album === summary.album
                        ? "library-entity-card--active"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    type="button"
                    onClick={() => {
                      selectedAlbumRef.current = summary.album;
                      selectedAlbumDetailRef.current = summary;
                      onChangeSelectedAlbum(summary.album);
                      onChangeSelectedAlbumDetail(summary);
                      navigateLibraryView("albumSongs");
                    }}
                  >
                    <div className="library-entity-card__media">
                      {showAlbumArtwork ? (
                        <EntityArtwork
                          track={summary.representativeTrack}
                          artworksById={artworksById}
                          alt={`${summary.album} ${localeStrings.library.albumCoverSuffix}`}
                          fallback={<AlbumsTileIcon />}
                        />
                      ) : (
                        <span className="library-entity-card__fallback-icon">
                          <AlbumsTileIcon />
                        </span>
                      )}
                    </div>
                    <div className="library-entity-card__eyebrow">{localeStrings.library.entityAlbum}</div>
                    <div className="library-entity-card__title">{summary.album}</div>
                    <div className="library-entity-card__meta">
                      {summary.trackCount} 首歌曲
                    </div>
                    <div className="library-entity-card__submeta">
                      {summary.artistCount} {copy.library.artistsCard.suffix}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          <section className="settings-card settings-card--list">
            <LibrarySongList
              tracks={selectedArtistTracks}
              artworksById={artworksById}
              showAlbumArtwork={showAlbumArtwork}
              activeTrackId={activeTrackId}
              isLoading={isLoading}
              copy={copy}
              emptyMessage={copy.library.empty.noArtistTracks}
              onPlayTrack={onPlayTrack}
              onOpenArtist={onOpenTrackArtist}
              onOpenAlbum={onOpenTrackAlbum}
              onTrackContextMenu={onTrackContextMenu}
            />
          </section>
        </>
      ) : null}

      {view === "albumSongs" ? (
        <>
          {resolvedSelectedAlbumDetail ? (
            <section className="library-hero-card">
              <div className="library-hero-card__media">
                {showAlbumArtwork ? (
                  <EntityArtwork
                    track={resolvedSelectedAlbumDetail.representativeTrack}
                    artworksById={artworksById}
                    alt={`${resolvedSelectedAlbumDetail.album} ${localeStrings.library.albumCoverSuffix}`}
                    fallback={<AlbumsTileIcon />}
                  />
                ) : (
                  <span className="library-entity-card__fallback-icon">
                    <AlbumsTileIcon />
                  </span>
                )}
              </div>
              <div className="library-hero-card__content">
                <p className="settings-card__eyebrow">{localeStrings.library.entityAlbum}</p>
                <h3 className="settings-card__title">{resolvedSelectedAlbumDetail.album}</h3>
                <p className="library-hero-card__meta">
                  {resolvedSelectedAlbumDetail.trackCount} {copy.library.songsCard.suffix} /{" "}
                  {resolvedSelectedAlbumDetail.artistCount} {copy.library.artistsCard.suffix}
                </p>
              </div>
            </section>
          ) : null}
          <section className="settings-card settings-card--list">
            <LibrarySongList
              tracks={selectedAlbumTracks}
              artworksById={artworksById}
              showAlbumArtwork={showAlbumArtwork}
              activeTrackId={activeTrackId}
              isLoading={isLoading}
              copy={copy}
              emptyMessage={copy.library.empty.noAlbumTracks}
              onPlayTrack={onPlayTrack}
              onOpenArtist={onOpenTrackArtist}
              onOpenAlbum={onOpenTrackAlbum}
              onTrackContextMenu={onTrackContextMenu}
            />
          </section>
        </>
      ) : null}
    </section>
  );
}

function LibrarySongList({
  copy,
  tracks,
  artworksById,
  showAlbumArtwork,
  activeTrackId,
  isLoading,
  emptyMessage,
  enableSelection = false,
  selectionLabel,
  selectedTrackIds = [],
  onToggleTrackSelection,
  onPlayTrack,
  onOpenArtist,
  onOpenAlbum,
  onTrackContextMenu,
}: {
  copy: UiCopy;
  tracks: TrackRecord[];
  artworksById: Map<string, ArtworkRecord>;
  showAlbumArtwork: boolean;
  activeTrackId: string | null;
  isLoading: boolean;
  emptyMessage: string;
  enableSelection?: boolean;
  selectionLabel?: string;
  selectedTrackIds?: string[];
  onToggleTrackSelection?: (trackId: string) => void;
  onPlayTrack: (trackId: string, queueTracks: TrackRecord[]) => void;
  onOpenArtist: (track: TrackRecord) => void;
  onOpenAlbum: (track: TrackRecord) => void;
  onTrackContextMenu?: (
    event: ReactMouseEvent<HTMLElement>,
    track: TrackRecord,
    queueTracks: TrackRecord[],
  ) => void;
}) {
  const localeStrings = getLocaleStrings(copy.locale);

  return (
    <div className="library-track-list">
      {isLoading ? (
        <UILoadingBlock label={copy.library.empty.loading} variant="list" />
      ) : tracks.length === 0 ? (
        <p className="library-empty">{emptyMessage}</p>
      ) : (
        tracks.map((track) => (
          <div
            key={track.id}
            className={[
              "library-song-item",
              enableSelection ? "library-song-item--selectable" : "",
              activeTrackId === track.id ? "library-song-item--active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            role="button"
            tabIndex={0}
            onClick={() => onPlayTrack(track.id, tracks)}
            onContextMenu={(event) => onTrackContextMenu?.(event, track, tracks)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onPlayTrack(track.id, tracks);
              }
            }}
          >
            {enableSelection ? (
              <div className="library-song-item__selection">
                <button
                  className={[
                    "library-song-select",
                    selectedTrackIds.includes(track.id) ? "library-song-select--checked" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  type="button"
                  aria-label={selectionLabel ?? "Select"}
                  aria-pressed={selectedTrackIds.includes(track.id)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleTrackSelection?.(track.id);
                  }}
                >
                  <span className="library-song-select__mark" aria-hidden="true">
                    <CheckIcon />
                  </span>
                </button>
              </div>
            ) : null}
            <div className="library-song-item__identity">
              <div className="library-song-item__cover" aria-hidden="true">
                {showAlbumArtwork ? (
                  <SongArtwork
                    track={track}
                    artworksById={artworksById}
                    alt={`${track.title} ${localeStrings.library.trackCoverSuffix}`}
                  />
                ) : (
                  <span className="library-song-item__cover-fallback">
                    <SongsTileIcon />
                  </span>
                )}
              </div>
              <div className="library-song-item__identity-text">
                <div className="library-song-item__title">{track.title}</div>
                <div className="library-song-item__meta">
                  {track.source.kind === "localFile"
                    ? track.source.fileName
                    : copy.library.songFields.networkSource}
                </div>
              </div>
            </div>
            <div className="library-song-item__field library-song-item__field--artist">
              <div className="library-song-item__field-label">{copy.library.songFields.artist}</div>
              <div className="library-song-item__field-value">
                <SongMetaButton
                  className="library-song-item__field-button"
                  label={track.artist?.trim() || copy.library.songFields.unknownArtist}
                  onClick={() => onOpenArtist(track)}
                  disabled={!track.artist?.trim()}
                />
              </div>
            </div>
            <div className="library-song-item__field library-song-item__field--album">
              <div className="library-song-item__field-label">{copy.library.songFields.album}</div>
              <div className="library-song-item__field-value">
                <SongMetaButton
                  className="library-song-item__field-button"
                  label={track.album?.trim() || copy.library.songFields.unknownAlbum}
                  onClick={() => onOpenAlbum(track)}
                  disabled={!track.album?.trim()}
                />
              </div>
            </div>
            <div className="library-song-item__field library-song-item__field--duration">
              <div className="library-song-item__field-label">{copy.library.songFields.duration}</div>
              <div className="library-song-item__field-value">
                {formatDurationMs(track.durationMs)}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function buildHomeOfflineRecommendations(tracks: TrackRecord[], limit: number) {
  return [...tracks]
    .sort((left, right) => {
      const artworkScore = Number(right.artworkIds.length > 0) - Number(left.artworkIds.length > 0);
      if (artworkScore !== 0) {
        return artworkScore;
      }

      return right.importedAtMs - left.importedAtMs;
    })
    .slice(0, limit);
}

function formatHomeCount(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function SongArtwork({
  track,
  artworksById,
  alt,
}: {
  track: TrackRecord;
  artworksById: Map<string, ArtworkRecord>;
  alt: string;
}) {
  const artworkUrl = resolveTrackArtworkUrl(track, artworksById);

  if (!artworkUrl) {
    return (
      <span className="library-song-item__cover-fallback">
        <SongsTileIcon />
      </span>
    );
  }

  return <img src={artworkUrl} alt={alt} loading="lazy" />;
}

function EntityArtwork({
  track,
  artworksById,
  alt,
  fallback,
}: {
  track: TrackRecord | null;
  artworksById: Map<string, ArtworkRecord>;
  alt: string;
  fallback: ReactNode;
}) {
  if (!track) {
    return <span className="library-entity-card__fallback-icon">{fallback}</span>;
  }

  const artworkUrl = resolveTrackArtworkUrl(track, artworksById);

  if (!artworkUrl) {
    return <span className="library-entity-card__fallback-icon">{fallback}</span>;
  }

  return <img src={artworkUrl} alt={alt} loading="lazy" />;
}

function splitCommaSeparatedValues(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function maskSensitiveValue(value: string, head = 16, tail = 8) {
  if (value.length <= head + tail + 3) {
    return value;
  }

  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function truncateText(value: string | null | undefined, maxLength: number) {
  const normalizedValue = value?.trim() ?? "";
  if (!normalizedValue) {
    return "";
  }

  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function resolveNeteaseQrLoginStatusLabel(
  locale: string,
  state:
    | "idle"
    | "creating"
    | "waiting"
    | "scanned"
    | "authorizing"
    | "authorized"
    | "expired"
    | "failed",
  options: {
    loggedIn: boolean;
  },
) {
  const copy = locale === "en-US"
    ? {
        loggedIn: "Saved Netease login cookie",
        loggedOut: "Not logged in to Netease",
        creating: "Generating QR code...",
        waiting: "Waiting for scan",
        scanned: "Scanned. Please confirm login on your phone.",
        authorizing: "Login succeeded. Saving credentials...",
        authorized: "Saved Netease login cookie",
        expired: "QR code expired. Please generate a new one.",
        failed: "QR login failed. Please try again.",
      }
    : {
        loggedIn: "已保存网易云登录凭据",
        loggedOut: "当前未登录网易云",
        creating: "正在生成二维码...",
        waiting: "等待扫码",
        scanned: "已扫码，请在手机上确认登录",
        authorizing: "登录成功，正在保存凭据...",
        authorized: "已保存网易云登录凭据",
        expired: "二维码已过期，请重新生成",
        failed: "二维码登录失败，请稍后重试",
      };

  switch (state) {
    case "creating":
      return copy.creating;
    case "waiting":
      return copy.waiting;
    case "scanned":
      return copy.scanned;
    case "authorizing":
      return copy.authorizing;
    case "authorized":
      return copy.authorized;
    case "expired":
      return copy.expired;
    case "failed":
      return copy.failed;
    case "idle":
    default:
      return options.loggedIn ? copy.loggedIn : copy.loggedOut;
  }
}

function sanitizePositiveNumber(value: string, fallback: number) {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.round(parsed);
}

function DynamicIsland({
  currentTimeLabel,
  detailedTimeLabel,
  lyricLine,
  notification,
  notificationPhase,
  importProgress,
  styleVariant,
  colorMode,
  position,
}: {
  currentTimeLabel: string;
  detailedTimeLabel: string;
  lyricLine: string | null;
  notification: {
    id: number;
    message: string;
  } | null;
  notificationPhase: "idle" | "enter" | "visible" | "swap" | "exit";
  importProgress: {
    label: string;
    current: number;
    total: number;
    percent: number;
  } | null;
  styleVariant: AppSettings["appearance"]["dynamicIslandStyle"];
  colorMode: AppSettings["appearance"]["dynamicIslandColorMode"];
  position: AppSettings["appearance"]["dynamicIslandPosition"];
}) {
  type DynamicIslandPanel = "default" | "expanded" | "notification" | "progress" | "lyric";
  const DEFAULT_MIN_WIDTH = 74;
  const DEFAULT_MAX_WIDTH = 224;
  const DEFAULT_HEIGHT = 34;
  const EXPANDED_WIDTH = 176;
  const EXPANDED_HEIGHT = 56;
  const LYRIC_MIN_WIDTH = 148;
  const LYRIC_MAX_WIDTH = 360;
  const LYRIC_MIN_HEIGHT = 42;
  const PROGRESS_MIN_WIDTH = 214;
  const PROGRESS_MAX_WIDTH = 296;
  const PROGRESS_MIN_HEIGHT = 46;
  const NOTIFICATION_MIN_WIDTH = 208;
  const NOTIFICATION_MAX_WIDTH = 420;
  const NOTIFICATION_MIN_HEIGHT = 56;
  const PANEL_TRANSITION_DURATION_MS = 280;
  const isNotificationMounted = notification !== null;
  const isNotificationActive =
    isNotificationMounted &&
    (notificationPhase === "enter" ||
      notificationPhase === "visible" ||
      notificationPhase === "swap");
  const defaultMeasureRef = useRef<HTMLDivElement | null>(null);
  const lyricMeasureRef = useRef<HTMLDivElement | null>(null);
  const notificationMeasureRef = useRef<HTMLDivElement | null>(null);
  const progressMeasureRef = useRef<HTMLDivElement | null>(null);
  const previousVisiblePanelRef = useRef<DynamicIslandPanel>("default");
  const lyricTransitionTimerRef = useRef<number | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isExpandedContentVisible, setIsExpandedContentVisible] = useState(false);
  const [isNotificationContentVisible, setIsNotificationContentVisible] = useState(false);
  const [leavingPanel, setLeavingPanel] = useState<DynamicIslandPanel | null>(null);
  const [defaultWidth, setDefaultWidth] = useState(DEFAULT_MIN_WIDTH);
  const normalizedLyricLine = lyricLine?.trim() ?? "";
  const [displayedLyricLine, setDisplayedLyricLine] = useState(normalizedLyricLine);
  const [leavingLyricLine, setLeavingLyricLine] = useState<string | null>(null);
  const [isLyricLineAnimating, setIsLyricLineAnimating] = useState(false);
  const [lyricAnimationCycle, setLyricAnimationCycle] = useState(0);
  const displayedLyricLineRef = useRef(normalizedLyricLine);
  const [lyricSize, setLyricSize] = useState({
    width: LYRIC_MIN_WIDTH,
    height: LYRIC_MIN_HEIGHT,
  });
  const [notificationMessage, setNotificationMessage] = useState(notification?.message ?? "");
  const [notificationSize, setNotificationSize] = useState({
    width: NOTIFICATION_MIN_WIDTH,
    height: NOTIFICATION_MIN_HEIGHT,
  });
  const [progressSize, setProgressSize] = useState({
    width: PROGRESS_MIN_WIDTH,
    height: PROGRESS_MIN_HEIGHT,
  });

  const effectiveLyricLine = displayedLyricLine || normalizedLyricLine;
  const isProgressActive = !isNotificationActive && importProgress !== null;
  const isLyricActive = !isNotificationActive && !isProgressActive && Boolean(effectiveLyricLine);
  const activePanel = isNotificationActive
    ? "notification"
    : isProgressActive
      ? "progress"
      : isLyricActive
        ? "lyric"
      : isHovered
        ? "expanded"
        : "default";
  const visiblePanel = isNotificationContentVisible
    ? "notification"
    : isProgressActive
      ? "progress"
      : isLyricActive
        ? "lyric"
        : isExpandedContentVisible
          ? "expanded"
          : "default";
  const shouldRenderNotificationPanel = Boolean(notificationMessage);
  const shouldRenderProgressPanel = importProgress !== null;
  const shouldRenderLyricPanel = Boolean(effectiveLyricLine);

  useEffect(() => {
    if (lyricTransitionTimerRef.current !== null) {
      window.clearTimeout(lyricTransitionTimerRef.current);
      lyricTransitionTimerRef.current = null;
    }

    const previousDisplayedLyricLine = displayedLyricLineRef.current;

    if (!normalizedLyricLine) {
      displayedLyricLineRef.current = "";
      setDisplayedLyricLine("");
      setLeavingLyricLine(null);
      setIsLyricLineAnimating(false);
      return;
    }

    if (!previousDisplayedLyricLine) {
      displayedLyricLineRef.current = normalizedLyricLine;
      setDisplayedLyricLine(normalizedLyricLine);
      setLeavingLyricLine(null);
      setIsLyricLineAnimating(false);
      return;
    }

    if (previousDisplayedLyricLine === normalizedLyricLine) {
      return;
    }

    displayedLyricLineRef.current = normalizedLyricLine;
    setLeavingLyricLine(previousDisplayedLyricLine);
    setDisplayedLyricLine(normalizedLyricLine);
    setIsLyricLineAnimating(true);
    setLyricAnimationCycle((current) => current + 1);
    lyricTransitionTimerRef.current = window.setTimeout(() => {
      setLeavingLyricLine(null);
      setIsLyricLineAnimating(false);
      lyricTransitionTimerRef.current = null;
    }, 360);
  }, [normalizedLyricLine]);

  useEffect(() => {
    if (notification?.message) {
      setNotificationMessage(notification.message);
    }
  }, [notification?.id, notification?.message]);

  useEffect(() => {
    if (notificationPhase === "idle" && !notification) {
      setNotificationMessage("");
    }
  }, [notification, notificationPhase]);

  useEffect(() => {
    if (!notification || notificationPhase === "idle") {
      setIsNotificationContentVisible(false);
      return;
    }

    if (notificationPhase === "enter") {
      setIsNotificationContentVisible(false);

      let frameA = 0;
      let frameB = 0;
      frameA = window.requestAnimationFrame(() => {
        frameB = window.requestAnimationFrame(() => {
          setIsNotificationContentVisible(true);
        });
      });

      return () => {
        window.cancelAnimationFrame(frameA);
        window.cancelAnimationFrame(frameB);
      };
    }

    if (notificationPhase === "visible" || notificationPhase === "swap") {
      setIsNotificationContentVisible(true);
      return;
    }

    setIsNotificationContentVisible(false);
  }, [notification, notificationPhase]);

  useEffect(() => {
    if (isNotificationActive || isProgressActive || isLyricActive) {
      setIsExpandedContentVisible(false);
      return;
    }

    if (!isHovered) {
      setIsExpandedContentVisible(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setIsExpandedContentVisible(true);
    }, 140);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isHovered, isLyricActive, isNotificationActive, isProgressActive]);

  useEffect(() => {
    const previousPanel = previousVisiblePanelRef.current;
    if (previousPanel === visiblePanel) {
      return;
    }

    setLeavingPanel(previousPanel);
    previousVisiblePanelRef.current = visiblePanel;

    const timer = window.setTimeout(() => {
      setLeavingPanel((current) => (current === previousPanel ? null : current));
    }, PANEL_TRANSITION_DURATION_MS + 60);

    return () => {
      window.clearTimeout(timer);
    };
  }, [visiblePanel, PANEL_TRANSITION_DURATION_MS]);

  useEffect(() => {
    const defaultMeasure = defaultMeasureRef.current;
    if (!defaultMeasure) {
      return;
    }

    const rect = defaultMeasure.getBoundingClientRect();
    const nextDefaultWidth = Math.min(
      DEFAULT_MAX_WIDTH,
      Math.max(DEFAULT_MIN_WIDTH, Math.ceil(rect.width)),
    );

    setDefaultWidth((current) => (current === nextDefaultWidth ? current : nextDefaultWidth));
  }, [DEFAULT_MAX_WIDTH, DEFAULT_MIN_WIDTH, currentTimeLabel]);

  useEffect(() => {
    const lyricMeasure = lyricMeasureRef.current;
    if (!lyricMeasure || !effectiveLyricLine) {
      return;
    }

    const rect = lyricMeasure.getBoundingClientRect();
    const nextLyricSize = {
      width: Math.min(LYRIC_MAX_WIDTH, Math.max(LYRIC_MIN_WIDTH, Math.ceil(rect.width))),
      height: Math.max(LYRIC_MIN_HEIGHT, Math.ceil(rect.height)),
    };

    setLyricSize((current) =>
      current.width === nextLyricSize.width && current.height === nextLyricSize.height
        ? current
        : nextLyricSize,
    );
  }, [LYRIC_MAX_WIDTH, LYRIC_MIN_HEIGHT, LYRIC_MIN_WIDTH, effectiveLyricLine]);

  useEffect(() => {
    const notificationMeasure = notificationMeasureRef.current;
    if (!notificationMeasure) {
      return;
    }

    const rect = notificationMeasure.getBoundingClientRect();
    const nextNotificationSize = {
      width: Math.min(
        NOTIFICATION_MAX_WIDTH,
        Math.max(NOTIFICATION_MIN_WIDTH, Math.ceil(rect.width)),
      ),
      height: Math.max(NOTIFICATION_MIN_HEIGHT, Math.ceil(rect.height)),
    };

    setNotificationSize((current) =>
      current.width === nextNotificationSize.width &&
      current.height === nextNotificationSize.height
        ? current
        : nextNotificationSize,
    );
  }, [
    detailedTimeLabel,
    NOTIFICATION_MAX_WIDTH,
    NOTIFICATION_MIN_HEIGHT,
    NOTIFICATION_MIN_WIDTH,
    notificationMessage,
  ]);

  useEffect(() => {
    const progressMeasure = progressMeasureRef.current;
    if (!progressMeasure || !importProgress) {
      return;
    }

    const rect = progressMeasure.getBoundingClientRect();
    const nextProgressSize = {
      width: Math.min(PROGRESS_MAX_WIDTH, Math.max(PROGRESS_MIN_WIDTH, Math.ceil(rect.width))),
      height: Math.max(PROGRESS_MIN_HEIGHT, Math.ceil(rect.height)),
    };

    setProgressSize((current) =>
      current.width === nextProgressSize.width && current.height === nextProgressSize.height
        ? current
        : nextProgressSize,
    );
  }, [
    PROGRESS_MAX_WIDTH,
    PROGRESS_MIN_HEIGHT,
    PROGRESS_MIN_WIDTH,
    importProgress?.current,
    importProgress?.label,
    importProgress?.percent,
    importProgress?.total,
  ]);

  useEffect(() => {
    return () => {
      if (lyricTransitionTimerRef.current !== null) {
        window.clearTimeout(lyricTransitionTimerRef.current);
      }
    };
  }, []);

  const coreInlineWidth =
    activePanel === "notification"
      ? notificationSize.width
      : activePanel === "progress"
        ? progressSize.width
        : activePanel === "lyric"
          ? lyricSize.width
          : activePanel === "expanded"
            ? Math.max(EXPANDED_WIDTH, defaultWidth)
            : defaultWidth;
  const coreInlineHeight =
    activePanel === "notification"
      ? notificationSize.height
      : activePanel === "progress"
        ? progressSize.height
        : activePanel === "lyric"
          ? lyricSize.height
          : activePanel === "expanded"
            ? EXPANDED_HEIGHT
            : DEFAULT_HEIGHT;

  return (
    <div
      className={[
        "dynamic-island",
        `dynamic-island--${position}`,
        `dynamic-island--style-${styleVariant}`,
        `dynamic-island--color-${colorMode}`,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className={[
          "dynamic-island__core",
          activePanel === "notification" ? "dynamic-island__core--notification" : "",
          activePanel === "progress" ? "dynamic-island__core--progress" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={
          {
            width: `${coreInlineWidth}px`,
            minHeight: `${coreInlineHeight}px`,
          } satisfies CSSProperties
        }
        onPointerEnter={() => setIsHovered(true)}
        onPointerLeave={() => setIsHovered(false)}
      >
        <span
          className={[
            "dynamic-island__dot",
            activePanel === "notification" ? "dynamic-island__dot--notification" : "",
            activePanel === "progress" ? "dynamic-island__dot--progress" : "",
            activePanel === "lyric" ? "dynamic-island__dot--lyric" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        />
        <div className="dynamic-island__viewport">
          <div
            className={[
              "dynamic-island__panel",
              "dynamic-island__panel--default",
              visiblePanel === "default" ? "dynamic-island__panel--active" : "",
              leavingPanel === "default" ? "dynamic-island__panel--leaving" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="dynamic-island__panel-stack dynamic-island__panel-stack--center">
              <span className="dynamic-island__primary">{currentTimeLabel}</span>
            </div>
          </div>
          <div
            className={[
              "dynamic-island__panel",
              "dynamic-island__panel--expanded",
              visiblePanel === "expanded" ? "dynamic-island__panel--active" : "",
              leavingPanel === "expanded" ? "dynamic-island__panel--leaving" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="dynamic-island__panel-stack dynamic-island__panel-stack--center">
              <span className="dynamic-island__expanded-label">{currentTimeLabel}</span>
              <span className="dynamic-island__expanded-detail">{detailedTimeLabel}</span>
            </div>
          </div>
          {shouldRenderLyricPanel ? (
            <div
              className={[
                "dynamic-island__panel",
                "dynamic-island__panel--lyric",
                visiblePanel === "lyric" ? "dynamic-island__panel--active" : "",
                leavingPanel === "lyric" ? "dynamic-island__panel--leaving" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="dynamic-island__panel-stack dynamic-island__panel-stack--lyric">
                <div className="dynamic-island__lyric-viewport">
                  {leavingLyricLine ? (
                    <span
                      key={`leaving-${lyricAnimationCycle}-${leavingLyricLine}`}
                      className="dynamic-island__lyric-line dynamic-island__lyric-line--leaving"
                    >
                      {leavingLyricLine}
                    </span>
                  ) : null}
                  <span
                    key={`current-${lyricAnimationCycle}-${effectiveLyricLine}`}
                    className={[
                      "dynamic-island__lyric-line",
                      isLyricLineAnimating ? "dynamic-island__lyric-line--entering" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {effectiveLyricLine}
                  </span>
                </div>
              </div>
            </div>
          ) : null}
          {shouldRenderNotificationPanel ? (
            <div
              className={[
                "dynamic-island__panel",
                "dynamic-island__panel--notification",
                visiblePanel === "notification" ? "dynamic-island__panel--active" : "",
                leavingPanel === "notification" ? "dynamic-island__panel--leaving" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="dynamic-island__panel-stack dynamic-island__panel-stack--notification">
                <span className="dynamic-island__notification-message">
                  {notificationMessage}
                </span>
                <span className="dynamic-island__notification-meta">{detailedTimeLabel}</span>
              </div>
            </div>
          ) : null}
          {shouldRenderProgressPanel ? (
            <div
              className={[
                "dynamic-island__panel",
                "dynamic-island__panel--progress",
                visiblePanel === "progress" ? "dynamic-island__panel--active" : "",
                leavingPanel === "progress" ? "dynamic-island__panel--leaving" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="dynamic-island__panel-stack dynamic-island__panel-stack--progress">
                <div className="dynamic-island__progress-head">
                  <span className="dynamic-island__progress-label">{importProgress?.label}</span>
                  <span className="dynamic-island__progress-meta">
                    {importProgress?.current} / {importProgress?.total}
                  </span>
                </div>
                <div className="dynamic-island__progress-track" aria-hidden="true">
                  <span
                    className="dynamic-island__progress-fill"
                    style={{ width: `${importProgress?.percent ?? 0}%` }}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="dynamic-island__measure" aria-hidden="true">
        <div ref={defaultMeasureRef} className="dynamic-island__measure-frame">
          <span className="dynamic-island__dot" />
          <div className="dynamic-island__measure-body">
            <div className="dynamic-island__panel-stack dynamic-island__panel-stack--center">
              <span className="dynamic-island__primary">{currentTimeLabel}</span>
            </div>
          </div>
        </div>
        <div
          ref={lyricMeasureRef}
          className="dynamic-island__measure-frame dynamic-island__measure-frame--lyric"
        >
          <span className="dynamic-island__dot dynamic-island__dot--lyric" />
          <div className="dynamic-island__measure-body dynamic-island__measure-body--lyric">
            <div className="dynamic-island__panel-stack dynamic-island__panel-stack--lyric">
              <span className="dynamic-island__lyric-line">{effectiveLyricLine}</span>
            </div>
          </div>
        </div>
        <div
          ref={notificationMeasureRef}
          className="dynamic-island__measure-frame dynamic-island__measure-frame--notification"
        >
          <span className="dynamic-island__dot dynamic-island__dot--notification" />
          <div className="dynamic-island__measure-body dynamic-island__measure-body--notification">
            <div className="dynamic-island__panel-stack dynamic-island__panel-stack--notification">
              <span className="dynamic-island__notification-message">
                {notificationMessage}
              </span>
              <span className="dynamic-island__notification-meta">{detailedTimeLabel}</span>
            </div>
          </div>
        </div>
        <div
          ref={progressMeasureRef}
          className="dynamic-island__measure-frame dynamic-island__measure-frame--progress"
        >
          <span className="dynamic-island__dot dynamic-island__dot--progress" />
          <div className="dynamic-island__measure-body dynamic-island__measure-body--progress">
            <div className="dynamic-island__panel-stack dynamic-island__panel-stack--progress">
              <div className="dynamic-island__progress-head">
                <span className="dynamic-island__progress-label">{importProgress?.label ?? ""}</span>
                <span className="dynamic-island__progress-meta">
                  {importProgress ? `${importProgress.current} / ${importProgress.total}` : ""}
                </span>
              </div>
              <div className="dynamic-island__progress-track">
                <span
                  className="dynamic-island__progress-fill"
                  style={{ width: `${importProgress?.percent ?? 0}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkspaceNotification({
  message,
  phase,
}: {
  message: string;
  phase: "idle" | "enter" | "visible" | "swap" | "exit";
}) {
  const isVisible = phase !== "idle" && message.trim().length > 0;

  return (
    <div
      className={[
        "workspace-notification",
        isVisible ? "workspace-notification--visible" : "",
        phase === "enter" ? "workspace-notification--enter" : "",
        phase === "visible" ? "workspace-notification--active" : "",
        phase === "swap" ? "workspace-notification--swap" : "",
        phase === "exit" ? "workspace-notification--exit" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-live="polite"
      aria-hidden={!isVisible}
      role="status"
    >
      <div className="workspace-notification__body">
        <span className="workspace-notification__text">{message}</span>
      </div>
    </div>
  );
}

export type ImmersivePlayerOverlayProps = {
  isOpen: boolean;
  isWindowVisible: boolean;
  trackId: string | null;
  artworkUrl: string | null;
  palette: ImmersiveArtworkPalette;
  appearanceSettings: AppSettings["appearance"];
  appBackgroundImageStyle: string;
  appBackgroundVideoSrc: string | null;
  appBackgroundVideoLoop: boolean;
  immersiveBackgroundVideoSrc: string | null;
  appBackgroundOpacity: number;
  appBackgroundBlurPx: number;
  appBackgroundDimOpacity: number;
  copy: ReturnType<typeof getImmersivePlayerCopy>;
  trackTitle: string;
  trackArtist: string;
  trackAlbum: string | null;
  hasTrackArtist: boolean;
  progress: number;
  currentTimeSeconds: number;
  elapsedLabel: string;
  totalLabel: string;
  isAutoMixTransitionActive: boolean;
  autoMixBadgePhase?: "hidden" | "entering" | "visible" | "leaving";
  isPlaying: boolean;
  isPlaybackLoading: boolean;
  lyrics: NeteaseSongLyrics | null;
  isLyricsLoading: boolean;
  currentLyricsTimeMs: number;
  activeLyricLineIndex: number;
  lyricsSettings: AppSettings["lyrics"];
  volume: number;
  canSkipPrevious: boolean;
  canSkipNext: boolean;
  playbackMode: PlaybackModeOption;
  playbackModeText: string;
  isPlaybackModeLocked: boolean;
  volumeLabel: string;
  isMaximized: boolean;
  isFullscreen: boolean;
  displayMode?: "interactive" | "wallpaper";
  headerStartSlot?: ReactNode;
  localeStrings: {
    controls: string;
    minimize: string;
    fullscreen: string;
    exitFullscreen: string;
    maximize: string;
    restore: string;
    close: string;
    exitImmersive: string;
  };
  onMinimize: () => Promise<void>;
  onToggleMaximize: () => Promise<void>;
  onToggleFullscreen: () => Promise<void>;
  onCloseWindow: () => Promise<void>;
  onStartDragging: () => Promise<void>;
  onTogglePlayback: () => Promise<void>;
  onSkipPrevious: () => Promise<void>;
  onSkipNext: () => Promise<void>;
  onCyclePlaybackMode: () => void;
  onSeekStart: () => void;
  onSeek: (value: number) => void;
  onSeekEnd: () => void;
  onLyricSeek: (timeMs: number) => void;
  onVolumeChange: (value: number) => void;
  onOpenTrackArtist?: (artistIndex: number, artistName: string) => void;
  onOpenTrackAlbum?: () => void;
  onClose: () => void;
};

export function ImmersivePlayerOverlay({
  isOpen,
  isWindowVisible,
  trackId,
  artworkUrl,
  palette,
  appearanceSettings,
  appBackgroundImageStyle,
  appBackgroundVideoSrc,
  appBackgroundVideoLoop,
  immersiveBackgroundVideoSrc,
  appBackgroundOpacity,
  appBackgroundBlurPx,
  appBackgroundDimOpacity,
  copy,
  trackTitle,
  trackArtist,
  trackAlbum,
  hasTrackArtist,
  progress,
  currentTimeSeconds,
  elapsedLabel,
  totalLabel,
  isAutoMixTransitionActive,
  autoMixBadgePhase = "hidden",
  isPlaying,
  isPlaybackLoading,
  lyrics,
  isLyricsLoading,
  currentLyricsTimeMs,
  activeLyricLineIndex,
  lyricsSettings,
  volume,
  canSkipPrevious,
  canSkipNext,
  playbackMode,
  playbackModeText,
  isPlaybackModeLocked,
  volumeLabel,
  isMaximized,
  isFullscreen,
  displayMode = "interactive",
  headerStartSlot = null,
  localeStrings,
  onMinimize,
  onToggleMaximize,
  onToggleFullscreen,
  onCloseWindow,
  onStartDragging,
  onTogglePlayback,
  onSkipPrevious,
  onSkipNext,
  onCyclePlaybackMode,
  onSeekStart,
  onSeek,
  onSeekEnd,
  onLyricSeek,
  onVolumeChange,
  onOpenTrackArtist,
  onOpenTrackAlbum,
  onClose,
}: ImmersivePlayerOverlayProps) {
  const isOverlayActive = isOpen && isWindowVisible;
  const isWallpaperDisplayMode = displayMode === "wallpaper";
  const [isVolumeSliderOpen, setIsVolumeSliderOpen] = useState(false);
  const [collapsingLyricsPanelTrackId, setCollapsingLyricsPanelTrackId] = useState<string | null>(null);
  const [hiddenLyricsPanelTrackId, setHiddenLyricsPanelTrackId] = useState<string | null>(null);
  const [outgoingTrackSnapshot, setOutgoingTrackSnapshot] = useState<{
    transitionKey: number;
    trackId: string | null;
    artworkUrl: string | null;
    trackTitle: string;
    trackArtist: string;
    trackAlbum: string | null;
    hasTrackArtist: boolean;
    lyrics: NeteaseSongLyrics | null;
    isLyricsLoading: boolean;
    currentLyricsTimeMs: number;
    activeLyricLineIndex: number;
  } | null>(null);
  const appBackgroundVideoRef = useRef<HTMLVideoElement | null>(null);
  const immersivePreviousTrackSnapshotRef = useRef<{
    trackId: string | null;
    artworkUrl: string | null;
    trackTitle: string;
    trackArtist: string;
    trackAlbum: string | null;
    hasTrackArtist: boolean;
    lyrics: NeteaseSongLyrics | null;
    isLyricsLoading: boolean;
    currentLyricsTimeMs: number;
    activeLyricLineIndex: number;
  } | null>(null);
  const immersiveTrackTransitionKeyRef = useRef(0);
  const immersiveTrackTransitionTimerRef = useRef<number | null>(null);
  const interactiveArtistNames = trackArtist
    .split(" / ")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  const renderImmersiveArtworkNode = (
    artworkSource: string | null,
    loading: boolean,
  ) => (
    <div
      className={[
        "immersive-player__artwork",
        loading ? "immersive-player__artwork--loading" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {artworkSource ? (
        <img src={artworkSource} alt="" />
      ) : (
        <span className="immersive-player__artwork-fallback">
          <SongsTileIcon />
        </span>
      )}
    </div>
  );

  const renderImmersiveMetaNode = (options: {
    artist: string;
    album: string | null;
    hasArtist: boolean;
    interactive: boolean;
  }) => (
    <div className="immersive-player__meta-links">
      {isWallpaperDisplayMode || !options.interactive ? (
        <span className="immersive-player__meta-button">{options.artist}</span>
      ) : (
        <SongArtistLinks
          fallback={options.artist}
          artists={interactiveArtistNames.map((artistName, artistIndex) => ({
            key: `${trackId ?? "immersive"}:immersive-artist:${artistName}:${artistIndex}`,
            name: artistName,
            onClick:
              options.hasArtist && onOpenTrackArtist
                ? () => onOpenTrackArtist(artistIndex, artistName)
                : undefined,
          }))}
        />
      )}
      {options.album?.trim() ? (
        <>
          <span className="immersive-player__meta-divider">·</span>
          {isWallpaperDisplayMode || !options.interactive ? (
            <span className="immersive-player__meta-button">{options.album}</span>
          ) : (
            <SongMetaButton
              className="immersive-player__meta-button"
              label={options.album}
              disabled={!onOpenTrackAlbum}
              onClick={onOpenTrackAlbum}
            />
          )}
        </>
      ) : null}
    </div>
  );

  useEffect(() => {
    if (!isOpen) {
      setIsVolumeSliderOpen(false);
    }
  }, [isOpen]);

  const immersiveBackgroundModeClass = `immersive-player__fluid--${appearanceSettings.immersiveBackgroundMode}`;
  const showFluidBackground = appearanceSettings.immersiveBackgroundMode === "flow";
  const showAppBackground = appearanceSettings.immersiveBackgroundMode === "app-background";
  const showBackgroundMvMode = appearanceSettings.immersiveBackgroundMode === "background-mv";
  const showBackgroundMvVideo = showBackgroundMvMode && Boolean(immersiveBackgroundVideoSrc);
  const showArtworkBlurBackground =
    (appearanceSettings.immersiveBackgroundMode === "cover-blur" ||
      (showBackgroundMvMode && !showBackgroundMvVideo)) &&
    Boolean(artworkUrl);
  const showAppBackgroundVideo = showAppBackground && Boolean(appBackgroundVideoSrc);
  const showAppBackgroundImage =
    showAppBackground && !showAppBackgroundVideo && appBackgroundImageStyle !== "none";
  const shouldSyncAppBackgroundMv = showAppBackgroundVideo && !appBackgroundVideoLoop;
  const shouldSyncImmersiveBackgroundMv = showBackgroundMvVideo;
  const hasDisplayableLyrics = hasDisplayableImmersiveLyrics(lyrics);
  const isInstrumentalTrack = resolveInstrumentalLyricState(lyrics) && !hasDisplayableLyrics;
  const isCollapsingLyricsPanel =
    collapsingLyricsPanelTrackId !== null &&
    collapsingLyricsPanelTrackId === trackId &&
    hiddenLyricsPanelTrackId !== trackId;
  const shouldHideLyricsPanel = hiddenLyricsPanelTrackId !== null && hiddenLyricsPanelTrackId === trackId;
  const shouldCenterPanel = (isCollapsingLyricsPanel || shouldHideLyricsPanel) && !isLyricsLoading;

  const syncImmersiveBackgroundMvPosition = (force = false) => {
    const video = appBackgroundVideoRef.current;
    if (!video || (!shouldSyncAppBackgroundMv && !shouldSyncImmersiveBackgroundMv)) {
      return;
    }

    const audioCurrentTime = currentTimeSeconds;
    if (!Number.isFinite(audioCurrentTime) || audioCurrentTime < 0) {
      return;
    }

    const videoDuration = Number.isFinite(video.duration) ? video.duration : 0;
    const maxSyncTime = videoDuration > 0 ? Math.max(0, videoDuration - 0.12) : audioCurrentTime;
    const targetTime = Math.min(audioCurrentTime, maxSyncTime);
    const currentVideoTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const drift = Math.abs(currentVideoTime - targetTime);

    if (force || drift > 0.08) {
      try {
        video.currentTime = targetTime;
      } catch (error) {
        console.error("[immersive-player] failed to sync background mv position", error);
      }
    }
  };

  useEffect(() => {
    if (!isOverlayActive || !trackId || isLyricsLoading || hasDisplayableLyrics) {
      setCollapsingLyricsPanelTrackId(null);
      setHiddenLyricsPanelTrackId(null);
      return;
    }

    if (isInstrumentalTrack) {
      setCollapsingLyricsPanelTrackId(null);
      setHiddenLyricsPanelTrackId(null);
      const collapseTimer = window.setTimeout(() => {
        setCollapsingLyricsPanelTrackId(trackId);
      }, IMMERSIVE_INSTRUMENTAL_HIDE_DELAY_MS);
      const hideTimer = window.setTimeout(() => {
        setCollapsingLyricsPanelTrackId(trackId);
        setHiddenLyricsPanelTrackId(trackId);
      }, IMMERSIVE_INSTRUMENTAL_HIDE_DELAY_MS + IMMERSIVE_INSTRUMENTAL_PANEL_COLLAPSE_DURATION_MS);
      return () => {
        window.clearTimeout(collapseTimer);
        window.clearTimeout(hideTimer);
      };
    }

    setCollapsingLyricsPanelTrackId(null);
    setHiddenLyricsPanelTrackId(trackId);
    return;
  }, [trackId, hasDisplayableLyrics, isInstrumentalTrack, isLyricsLoading, isOverlayActive]);

  useEffect(() => {
    const previousSnapshot = immersivePreviousTrackSnapshotRef.current;
    if (
      isOverlayActive &&
      previousSnapshot &&
      previousSnapshot.trackId !== trackId
    ) {
      if (immersiveTrackTransitionTimerRef.current !== null) {
        window.clearTimeout(immersiveTrackTransitionTimerRef.current);
      }

      immersiveTrackTransitionKeyRef.current += 1;
      setOutgoingTrackSnapshot({
        transitionKey: immersiveTrackTransitionKeyRef.current,
        ...previousSnapshot,
      });
      immersiveTrackTransitionTimerRef.current = window.setTimeout(() => {
        setOutgoingTrackSnapshot(null);
        immersiveTrackTransitionTimerRef.current = null;
      }, IMMERSIVE_TRACK_TRANSITION_DURATION_MS);
    }

    immersivePreviousTrackSnapshotRef.current = {
      trackId,
      artworkUrl,
      trackTitle,
      trackArtist,
      trackAlbum,
      hasTrackArtist,
      lyrics,
      isLyricsLoading,
      currentLyricsTimeMs,
      activeLyricLineIndex,
    };
  }, [
    activeLyricLineIndex,
    artworkUrl,
    currentLyricsTimeMs,
    hasTrackArtist,
    isLyricsLoading,
    isOverlayActive,
    lyrics,
    trackAlbum,
    trackArtist,
    trackId,
    trackTitle,
  ]);

  useEffect(() => {
    return () => {
      if (immersiveTrackTransitionTimerRef.current !== null) {
        window.clearTimeout(immersiveTrackTransitionTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOverlayActive || (!shouldSyncAppBackgroundMv && !shouldSyncImmersiveBackgroundMv)) {
      return;
    }

    syncImmersiveBackgroundMvPosition(true);
  }, [
    appBackgroundVideoSrc,
    isOverlayActive,
    shouldSyncAppBackgroundMv,
    shouldSyncImmersiveBackgroundMv,
  ]);

  useEffect(() => {
    const video = appBackgroundVideoRef.current;
    if (!video || (!showAppBackgroundVideo && !showBackgroundMvVideo) || !isOverlayActive) {
      if (video) {
        video.pause();
      }
      return;
    }

    if (shouldSyncAppBackgroundMv || shouldSyncImmersiveBackgroundMv) {
      syncImmersiveBackgroundMvPosition(!isPlaying);

      if (!isPlaying) {
        video.pause();
        return;
      }
    }

    if (video.paused) {
      void video.play().catch(() => undefined);
    }
  }, [
    currentTimeSeconds,
    isOverlayActive,
    isPlaying,
    shouldSyncAppBackgroundMv,
    shouldSyncImmersiveBackgroundMv,
    showAppBackgroundVideo,
    showBackgroundMvVideo,
  ]);

  if (!trackId) {
    return null;
  }

  return (
    <section
      className={[
        "immersive-player",
        isOpen ? "immersive-player--open" : "",
        isWallpaperDisplayMode ? "immersive-player--wallpaper" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden={!isOpen}
      style={
        ({
          "--immersive-color-base": withHexAlpha(palette.base, 0.96),
          "--immersive-color-secondary": withHexAlpha(palette.secondary, 0.9),
          "--immersive-color-glow": withHexAlpha(palette.glow, 0.86),
          "--immersive-color-edge": withHexAlpha(palette.edge, 0.98),
          "--immersive-color-highlight": withHexAlpha(mixHexColors(palette.glow, "#ffffff", 0.22), 0.5),
          "--immersive-backdrop-blur": `${clampNumber(appearanceSettings.immersiveBackgroundBlur * 1.4, 0, 72).toFixed(1)}px`,
          "--immersive-backdrop-saturate": `${clampNumber(114 + ((appearanceSettings.immersiveBackgroundResolution - 45) * 0.75), 114, 160).toFixed(0)}%`,
          "--immersive-artwork-backdrop-blur": `${clampNumber((appearanceSettings.backgroundBlur * 1.15) + 20, 18, 64).toFixed(1)}px`,
          "--immersive-app-background-opacity": `${clamp01(appBackgroundOpacity)}`,
          "--immersive-app-background-blur": `${Math.max(0, appBackgroundBlurPx).toFixed(1)}px`,
          "--immersive-app-background-dim": `${clamp01(appBackgroundDimOpacity)}`,
        } as CSSProperties)
      }
    >
      <div className={["immersive-player__fluid", immersiveBackgroundModeClass].join(" ")} aria-hidden="true">
        {showAppBackground ? (
          <div className="immersive-player__app-background-shell">
            {showAppBackgroundVideo ? (
              <video
                ref={appBackgroundVideoRef}
                key={appBackgroundVideoSrc ?? "none"}
                className="immersive-player__app-background-video"
                src={appBackgroundVideoSrc ?? undefined}
                autoPlay
                muted
                loop={appBackgroundVideoLoop}
                playsInline
                preload="auto"
                onLoadedMetadata={() => {
                  syncImmersiveBackgroundMvPosition(true);
                }}
              />
            ) : null}
            {showAppBackgroundImage ? (
              <div
                className="immersive-player__app-background-image"
                style={{ backgroundImage: appBackgroundImageStyle }}
              />
            ) : null}
            <div className="immersive-player__app-background-dim" />
          </div>
        ) : null}
        {showBackgroundMvMode ? (
          <div className="immersive-player__app-background-shell">
            {showBackgroundMvVideo ? (
              <video
                ref={appBackgroundVideoRef}
                key={immersiveBackgroundVideoSrc ?? "none"}
                className="immersive-player__app-background-video"
                src={immersiveBackgroundVideoSrc ?? undefined}
                autoPlay
                muted
                loop={false}
                playsInline
                preload="auto"
                onLoadedMetadata={() => {
                  syncImmersiveBackgroundMvPosition(true);
                }}
              />
            ) : null}
            <div className="immersive-player__app-background-dim" />
          </div>
        ) : null}
        {showArtworkBlurBackground ? (
          <div
            className="immersive-player__artwork-background"
            style={{ backgroundImage: `url("${artworkUrl}")` }}
          />
        ) : null}
        {showFluidBackground ? (
          <ImmersiveFluidCanvas
            palette={palette}
            isActive={isOverlayActive}
            appearanceSettings={appearanceSettings}
          />
        ) : null}
      </div>
      <div className="immersive-player__veil" aria-hidden="true" />
      {!isWallpaperDisplayMode ? (
        <header
          className="immersive-player__header"
          data-tauri-drag-region={isFullscreen ? undefined : "true"}
          onClick={(event) => {
            event.stopPropagation();
          }}
          onMouseDown={(event) => {
            if (event.button !== 0 || isFullscreen) {
              return;
            }

            if (
              event.target instanceof HTMLElement &&
              event.target.closest("[data-immersive-window-control='true']")
            ) {
              return;
            }

            void onStartDragging();
          }}
          onDoubleClick={(event) => {
            if (isFullscreen) {
              return;
            }

            if (
              event.target instanceof HTMLElement &&
              event.target.closest("[data-immersive-window-control='true']")
            ) {
              return;
            }

            void onToggleMaximize();
          }}
        >
          <div
            className="immersive-player__header-actions"
            data-immersive-window-control="true"
          >
            <button
              className="immersive-player__chrome-button immersive-player__chrome-button--exit"
              type="button"
              aria-label={localeStrings.exitImmersive}
              onMouseDown={(event) => {
                event.stopPropagation();
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                onClose();
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path className="chrome-icon__back-shaft" d="M10.9 8H5.7" />
                <path className="chrome-icon__back-head" d="M7.7 5.25L4.95 8l2.75 2.75" />
              </svg>
            </button>
            {headerStartSlot}
          </div>
          <div className="immersive-player__header-drag" aria-hidden="true" />
          <div
            className="immersive-player__window-controls"
            aria-label={localeStrings.controls}
            data-immersive-window-control="true"
          >
            <button
              className="immersive-player__chrome-button immersive-player__chrome-button--minimize"
              type="button"
              aria-label={localeStrings.minimize}
              onMouseDown={(event) => {
                event.stopPropagation();
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                void onMinimize();
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path className="chrome-icon__minimize-line" d="M4 8.5h8" />
              </svg>
            </button>
            <button
              className={[
                "immersive-player__chrome-button",
                "immersive-player__chrome-button--fullscreen",
                isFullscreen ? "immersive-player__chrome-button--fullscreen-active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              type="button"
              aria-label={isFullscreen ? localeStrings.exitFullscreen : localeStrings.fullscreen}
              onMouseDown={(event) => {
                event.stopPropagation();
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                void onToggleFullscreen();
              }}
            >
              {isFullscreen ? (
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path className="chrome-icon__fs-corner chrome-icon__fs-corner--tl" d="M6.25 3.75H3.75v2.5" />
                  <path className="chrome-icon__fs-corner chrome-icon__fs-corner--tr" d="M9.75 3.75h2.5v2.5" />
                  <path className="chrome-icon__fs-corner chrome-icon__fs-corner--br" d="M12.25 9.75v2.5h-2.5" />
                  <path className="chrome-icon__fs-corner chrome-icon__fs-corner--bl" d="M3.75 9.75v2.5h2.5" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path className="chrome-icon__fs-corner chrome-icon__fs-corner--tl" d="M6.25 3.75H3.75v2.5" />
                  <path className="chrome-icon__fs-corner chrome-icon__fs-corner--tr" d="M9.75 3.75h2.5v2.5" />
                  <path className="chrome-icon__fs-corner chrome-icon__fs-corner--br" d="M12.25 9.75v2.5h-2.5" />
                  <path className="chrome-icon__fs-corner chrome-icon__fs-corner--bl" d="M3.75 9.75v2.5h2.5" />
                  <path className="chrome-icon__fs-ray chrome-icon__fs-ray--tl" d="M6.1 5.9L3.8 3.8" />
                  <path className="chrome-icon__fs-ray chrome-icon__fs-ray--tr" d="M9.9 5.9l2.3-2.1" />
                  <path className="chrome-icon__fs-ray chrome-icon__fs-ray--br" d="M9.9 10.1l2.3 2.1" />
                  <path className="chrome-icon__fs-ray chrome-icon__fs-ray--bl" d="M6.1 10.1l-2.3 2.1" />
                </svg>
              )}
            </button>
            <button
              className={[
                "immersive-player__chrome-button",
                "immersive-player__chrome-button--maximize",
                isMaximized ? "immersive-player__chrome-button--maximize-active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              type="button"
              aria-label={isMaximized ? localeStrings.restore : localeStrings.maximize}
              onMouseDown={(event) => {
                event.stopPropagation();
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                void onToggleMaximize();
              }}
            >
              {isMaximized ? (
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path className="chrome-icon__restore-back" d="M6 4.75h5.25V10" />
                  <path className="chrome-icon__restore-front" d="M4.75 6h5.25v5.25H4.75z" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path className="chrome-icon__maximize-frame" d="M4 4h8v8H4z" />
                  <path className="chrome-icon__maximize-top" d="M4 5.35h8" />
                </svg>
              )}
            </button>
            <button
              className="immersive-player__chrome-button immersive-player__chrome-button--close"
              type="button"
              aria-label={localeStrings.close}
              onMouseDown={(event) => {
                event.stopPropagation();
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                void onCloseWindow();
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path className="chrome-icon__close-line chrome-icon__close-line--a" d="M5 5l6 6" />
                <path className="chrome-icon__close-line chrome-icon__close-line--b" d="M11 5l-6 6" />
              </svg>
            </button>
          </div>
        </header>
      ) : null}
      <div
        className="immersive-player__content"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div
          className={[
            "immersive-player__layout",
            isCollapsingLyricsPanel ? "immersive-player__layout--lyrics-collapsing" : "",
            shouldCenterPanel ? "immersive-player__layout--lyrics-hidden" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <section
            className={[
              "immersive-player__panel",
              "immersive-player__panel--left",
              isCollapsingLyricsPanel ? "immersive-player__panel--left-centering" : "",
              shouldCenterPanel ? "immersive-player__panel--left-centered" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div
              className={[
                "immersive-player__stack",
                isCollapsingLyricsPanel ? "immersive-player__stack--centering" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="immersive-player__artwork-stack">
                {outgoingTrackSnapshot ? (
                  <div
                    key={`immersive-artwork-outgoing-${outgoingTrackSnapshot.transitionKey}`}
                    className="immersive-player__artwork-shell immersive-player__artwork-shell--outgoing"
                    aria-hidden="true"
                  >
                    {renderImmersiveArtworkNode(outgoingTrackSnapshot.artworkUrl, false)}
                  </div>
                ) : null}
                <div key={`immersive-artwork-${trackId}`} className="immersive-player__artwork-shell immersive-player__artwork-shell--animated">
                  {renderImmersiveArtworkNode(artworkUrl, isPlaybackLoading)}
                </div>
              </div>

              <div className="immersive-player__meta-stack">
                {outgoingTrackSnapshot ? (
                  <div
                    key={`immersive-meta-outgoing-${outgoingTrackSnapshot.transitionKey}`}
                    className="immersive-player__meta immersive-player__meta--outgoing"
                    aria-hidden="true"
                  >
                    <h2>{outgoingTrackSnapshot.trackTitle}</h2>
                    {renderImmersiveMetaNode({
                      artist: outgoingTrackSnapshot.trackArtist,
                      album: outgoingTrackSnapshot.trackAlbum,
                      hasArtist: outgoingTrackSnapshot.hasTrackArtist,
                      interactive: false,
                    })}
                  </div>
                ) : null}
                <div key={`immersive-meta-${trackId}`} className="immersive-player__meta immersive-player__meta--animated">
                  <h2>{trackTitle}</h2>
                  {renderImmersiveMetaNode({
                    artist: trackArtist,
                    album: trackAlbum,
                    hasArtist: hasTrackArtist,
                    interactive: true,
                  })}
                </div>
              </div>

              <ImmersiveProgressTimeline
                progress={progress}
                elapsedLabel={elapsedLabel}
                totalLabel={totalLabel}
                isAutoMixTransitionActive={isAutoMixTransitionActive}
                autoMixBadgePhase={autoMixBadgePhase}
                isInteractive={!isWallpaperDisplayMode}
                onSeekStart={onSeekStart}
                onChange={onSeek}
                onSeekEnd={onSeekEnd}
              />

              {!isWallpaperDisplayMode ? (
                <div className="immersive-player__controls-shell" aria-label={copy.nowPlaying}>
                  <div className="immersive-player__controls">
                    <button
                      className="immersive-player__side-control"
                      type="button"
                      aria-label={playbackModeText}
                      title={playbackModeText}
                      onClick={onCyclePlaybackMode}
                      disabled={isPlaybackModeLocked}
                    >
                      <PlaybackModeIcon mode={playbackMode} />
                    </button>
                    <button
                      className="immersive-player__control"
                      type="button"
                      aria-label={copy.prev}
                      onClick={() => {
                        void onSkipPrevious();
                      }}
                      disabled={!canSkipPrevious}
                    >
                      <PreviousSmallIcon />
                    </button>
                    <button
                      className="immersive-player__control immersive-player__control--play"
                      type="button"
                      aria-label={isPlaying ? copy.pause : copy.play}
                      onClick={() => {
                        void onTogglePlayback();
                      }}
                    >
                      <PlayPauseAnimatedIcon isPlaying={isPlaying} />
                    </button>
                    <button
                      className="immersive-player__control"
                      type="button"
                      aria-label={copy.next}
                      onClick={() => {
                        void onSkipNext();
                      }}
                      disabled={!canSkipNext}
                    >
                      <NextSmallIcon />
                    </button>
                    <button
                      className={[
                        "immersive-player__side-control",
                        isVolumeSliderOpen ? "immersive-player__side-control--active" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      type="button"
                      aria-label={volumeLabel}
                      aria-expanded={isVolumeSliderOpen}
                      onClick={() => {
                        setIsVolumeSliderOpen((current) => !current);
                      }}
                    >
                      <VolumeAnimatedIcon volume={volume} />
                    </button>
                  </div>
                  <div
                    className={[
                      "immersive-player__volume-reveal",
                      isVolumeSliderOpen ? "immersive-player__volume-reveal--open" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <div className="immersive-player__volume-reveal-inner">
                      <ImmersiveVolumeSlider
                        ariaLabel={volumeLabel}
                        value={volume}
                        onChange={onVolumeChange}
                      />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
          <section
            className={[
              "immersive-player__panel",
              "immersive-player__panel--right",
              isCollapsingLyricsPanel ? "immersive-player__panel--right-collapsing" : "",
              shouldCenterPanel ? "immersive-player__panel--right-hidden" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-hidden={shouldCenterPanel}
          >
            <div className="immersive-player__lyrics-transition-stage">
              {outgoingTrackSnapshot ? (
                <div
                  key={`immersive-lyrics-outgoing-${outgoingTrackSnapshot.transitionKey}`}
                  className="immersive-player__lyrics-transition-shell immersive-player__lyrics-transition-shell--outgoing"
                  aria-hidden="true"
                >
                  <ImmersiveLyricsPanel
                    copy={copy}
                    lyrics={outgoingTrackSnapshot.lyrics}
                    isLoading={outgoingTrackSnapshot.isLyricsLoading}
                    currentTimeMs={outgoingTrackSnapshot.currentLyricsTimeMs}
                    activeLineIndex={outgoingTrackSnapshot.activeLyricLineIndex}
                    settings={lyricsSettings}
                    isPlaying={false}
                    emptyState={isInstrumentalTrack ? "instrumental" : "lyrics-unavailable"}
                    showControls={false}
                    onLyricSeek={onLyricSeek}
                  />
                </div>
              ) : null}
              <div
                key={`immersive-lyrics-${trackId}`}
                className="immersive-player__lyrics-transition-shell immersive-player__lyrics-transition-shell--incoming"
              >
              <ImmersiveLyricsPanel
                copy={copy}
                lyrics={lyrics}
                isLoading={isLyricsLoading}
                currentTimeMs={currentLyricsTimeMs}
                activeLineIndex={activeLyricLineIndex}
                settings={lyricsSettings}
                isPlaying={isOverlayActive && isPlaying && !isPlaybackLoading}
                emptyState={isInstrumentalTrack ? "instrumental" : "lyrics-unavailable"}
                showControls={!isWallpaperDisplayMode}
                onLyricSeek={onLyricSeek}
              />
              </div>
            </div>
          </section>
        </div>
      </div>
      {artworkUrl ? <img className="immersive-player__artwork-proxy" src={artworkUrl} alt="" /> : null}
    </section>
  );
}

function SecondaryLyricDisplayModeIcon({
  mode,
}: {
  mode: "none" | "translation" | "romanized" | "both";
}) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3.5 5.5h8.5" className="immersive-player__lyrics-icon-line immersive-player__lyrics-icon-line--top" />
      <path d="M3.5 9.5h8.5" className="immersive-player__lyrics-icon-line immersive-player__lyrics-icon-line--middle" />
      <path d="M3.5 13.5h5.5" className="immersive-player__lyrics-icon-line immersive-player__lyrics-icon-line--bottom" />
      <path d="M12.8 4.25h3.7v3.7h-3.7z" className="immersive-player__lyrics-icon-badge" />
      <path
        d="M13.7 5.15v1.8"
        className="immersive-player__lyrics-icon-translation immersive-player__lyrics-icon-translation--left"
      />
      <path
        d="M14.6 5.15v1.8"
        className="immersive-player__lyrics-icon-translation immersive-player__lyrics-icon-translation--right"
      />
      <path
        d="M13.4 6.05h1.5"
        className="immersive-player__lyrics-icon-translation immersive-player__lyrics-icon-translation--cross"
      />
      <path
        d="M12.9 12.3c.8-1.25 1.8-1.9 3-1.9 1 0 1.75.34 2.1.72"
        className="immersive-player__lyrics-icon-romanized immersive-player__lyrics-icon-romanized--curve"
      />
      <circle
        cx="13.2"
        cy="14.7"
        r="0.7"
        className="immersive-player__lyrics-icon-romanized-dot immersive-player__lyrics-icon-romanized-dot--first"
      />
      <circle
        cx="15"
        cy="14.1"
        r="0.7"
        className="immersive-player__lyrics-icon-romanized-dot immersive-player__lyrics-icon-romanized-dot--second"
      />
      <circle
        cx="16.7"
        cy="13.4"
        r="0.7"
        className="immersive-player__lyrics-icon-romanized-dot immersive-player__lyrics-icon-romanized-dot--third"
      />
      {mode === "none" ? (
        <path d="M12.7 16.2l4.3-4.3" className="immersive-player__lyrics-icon-off" />
      ) : null}
    </svg>
  );
}

function WordLyricModeIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 14.5h12" className="immersive-player__word-icon-baseline" />
      <path d="M6 11.8l1.8-4.6 1.8 4.6" className="immersive-player__word-icon-letter" />
      <path d="M6.7 10.2h2.2" className="immersive-player__word-icon-letter-crossbar" />
      <path d="M12.2 7.2v6.1" className="immersive-player__word-icon-stem immersive-player__word-icon-stem--short" />
      <path d="M15.5 6.6v8.3" className="immersive-player__word-icon-stem immersive-player__word-icon-stem--tall" />
      <path d="M12.2 7.2l3.3-.6" className="immersive-player__word-icon-connector" />
    </svg>
  );
}

const ImmersiveLyricWord = memo(function ImmersiveLyricWord({
  line,
  word,
  previousWord,
  nextWord,
  currentTimeMs,
}: {
  line: NeteaseParsedLyricLine;
  word: NeteaseParsedLyricWord;
  previousWord: NeteaseParsedLyricWord | null;
  nextWord: NeteaseParsedLyricWord | null;
  currentTimeMs: number;
}) {
  const wordFillTiming = resolveLyricWordFillTiming(word, nextWord, line);
  const { leadingWhitespace, coreText, trailingWhitespace } = splitLyricWordDisplayText(word.text);
  const wordFillVisuals = resolveLyricWordFillVisuals(coreText, wordFillTiming.durationMs);
  const contextRolls = resolveLyricWordContextRolls(word, previousWord, nextWord);
  const wordContextVisuals = resolveLyricWordContextVisuals(
    currentTimeMs,
    word,
    contextRolls,
  );
  const initialProgress = clamp01((currentTimeMs - word.startTimeMs) / Math.max(wordFillTiming.durationMs, 1));
  const initialState =
    currentTimeMs >= wordFillTiming.endTimeMs ? "past" : currentTimeMs >= word.startTimeMs ? "active" : "future";
  const animatedWordNode = (
    <span
      className="immersive-player__lyric-word"
      data-word-start={word.startTimeMs}
      data-word-end={wordFillTiming.endTimeMs}
      data-word-duration={wordFillTiming.durationMs}
      data-word-pre-roll={contextRolls.preRollMs}
      data-word-post-roll={contextRolls.postRollMs}
      data-word-state={initialState}
      style={
        {
          "--immersive-lyric-word-fill-overscan": wordFillVisuals.overscanEm,
          "--immersive-lyric-word-fill-tail": wordFillVisuals.tailEm,
          "--immersive-lyric-word-fill-tail-soft": wordFillVisuals.tailSoftEm,
          "--immersive-lyric-word-fill-tail-fade": wordFillVisuals.tailFadeEm,
          "--immersive-lyric-word-fill-glow": wordContextVisuals.glowAlpha,
          "--immersive-lyric-word-base-alpha": wordContextVisuals.baseAlpha,
          "--immersive-lyric-word-fill-progress": `${initialProgress}`,
        } as CSSProperties
      }
    >
      <span className="immersive-player__lyric-word-base">{coreText}</span>
      <span className="immersive-player__lyric-word-fill" aria-hidden="true">
        <span className="immersive-player__lyric-word-fill-glow">{coreText}</span>
        <span className="immersive-player__lyric-word-fill-ink">{coreText}</span>
      </span>
    </span>
  );

  if (!leadingWhitespace && !trailingWhitespace) {
    return animatedWordNode;
  }

  return (
    <span className="immersive-player__lyric-word-shell">
      {leadingWhitespace ? (
        <span className="immersive-player__lyric-word-spacing">{leadingWhitespace}</span>
      ) : null}
      {animatedWordNode}
      {trailingWhitespace ? (
        <span className="immersive-player__lyric-word-spacing">{trailingWhitespace}</span>
      ) : null}
    </span>
  );
}, (previousProps, nextProps) => {
  return (
    previousProps.line.startTimeMs === nextProps.line.startTimeMs &&
    previousProps.word.startTimeMs === nextProps.word.startTimeMs &&
    previousProps.word.endTimeMs === nextProps.word.endTimeMs &&
    previousProps.previousWord?.endTimeMs === nextProps.previousWord?.endTimeMs &&
    previousProps.nextWord?.startTimeMs === nextProps.nextWord?.startTimeMs
  );
});

function renderImmersiveLyricWordStaticFragments(line: NeteaseParsedLyricLine) {
  return line.words.map((word, wordIndex) => {
    const { leadingWhitespace, coreText, trailingWhitespace } = splitLyricWordDisplayText(word.text);
    const staticWordNode = (
      <span className="immersive-player__lyric-word-static">
        {coreText}
      </span>
    );

    if (!leadingWhitespace && !trailingWhitespace) {
      return (
        <span key={`${line.startTimeMs}-${word.startTimeMs}-${wordIndex}`} className="immersive-player__lyric-word-shell">
          {staticWordNode}
        </span>
      );
    }

    return (
      <span key={`${line.startTimeMs}-${word.startTimeMs}-${wordIndex}`} className="immersive-player__lyric-word-shell">
        {leadingWhitespace ? (
          <span className="immersive-player__lyric-word-spacing">{leadingWhitespace}</span>
        ) : null}
        {staticWordNode}
        {trailingWhitespace ? (
          <span className="immersive-player__lyric-word-spacing">{trailingWhitespace}</span>
        ) : null}
      </span>
    );
  });
}

function ImmersiveInterludeIndicator({
  progress,
}: {
  progress: number;
}) {
  const clampedProgress = clamp01(progress);
  const resolvePopLift = (dotProgress: number) => {
    const completionPhase = clamp01((dotProgress - 0.82) / 0.18);
    const easedPhase = 1 - (1 - completionPhase) ** 3;
    return 3.4 * easedPhase;
  };

  return (
    <span className="immersive-player__interlude" aria-hidden="true">
      {[0, 1, 2].map((dotIndex) => {
        const dotProgress = clamp01(clampedProgress * 3 - dotIndex);
        const dotLift = resolvePopLift(dotProgress);

        return (
          <span
            key={dotIndex}
            className="immersive-player__interlude-dot"
            style={{ transform: `translate3d(0, ${(-dotLift).toFixed(3)}px, 0)` }}
          >
            <span
              className="immersive-player__interlude-dot-fill"
              style={{ transform: `scaleX(${dotProgress})` }}
            />
          </span>
        );
      })}
    </span>
  );
}

function ImmersiveLyricsPanel({
  copy,
  lyrics,
  isLoading,
  currentTimeMs,
  activeLineIndex,
  settings,
  isPlaying,
  emptyState,
  showControls = true,
  onLyricSeek,
}: {
  copy: ReturnType<typeof getImmersivePlayerCopy>;
  lyrics: NeteaseSongLyrics | null;
  isLoading: boolean;
  currentTimeMs: number;
  activeLineIndex: number;
  settings: AppSettings["lyrics"];
  isPlaying: boolean;
  emptyState: "instrumental" | "lyrics-unavailable";
  showControls?: boolean;
  onLyricSeek: (timeMs: number) => void;
}) {
  const lines = lyrics?.lines ?? [];
  const visualItems = buildImmersiveLyricVisualItems(lines);
  const hasRenderableLyrics = hasDisplayableImmersiveLyrics(lyrics);
  const hasTranslatedLyrics = lines.some((line) => Boolean(line.translatedText?.trim()));
  const hasRomanizedLyrics = lines.some((line) => Boolean(line.romanizedText?.trim()));
  const hasWordLyrics = lines.some((line) => line.words.length > 0);
  const lyricFontScale = clampNumber(settings.fontSize / 100, 0.8, 1.6);
  const lyricFontWeight = clampNumber(settings.fontWeight, 100, 900);
  const lyricLineSpacingScale = clampNumber(settings.lineSpacing / 100, 0.8, 1.8);
  const lyricAnimationFactor = clampNumber(settings.animationSpeed / 100, 0.5, 2);
  const lyricBlurRangeFactor = clampNumber(settings.blurRange / 100, 0, 1);
  const lyricCurveFactor = clampNumber(settings.curveAmount / 100, -1, 1);
  const lyricCurveMagnitude = Math.abs(lyricCurveFactor);
  const lyricCurveDirection = lyricCurveFactor === 0 ? 0 : lyricCurveFactor > 0 ? 1 : -1;
  const lyricLineFallbackHeight = Math.round(
    92 * clampNumber(lyricFontScale, 0.92, 1.18) * lyricLineSpacingScale,
  );
  const lyricLineGap = Math.round(24 * clampNumber(lyricLineSpacingScale, 0.85, 1.85));
  const lyricLineContentGap = Math.round(8 * clampNumber(lyricLineSpacingScale, 0.85, 1.65));
  const lyricClearWindow = 1.35 + lyricBlurRangeFactor * 4.85;
  const lyricVisibilityDistance = Math.max(6, Math.ceil(lyricClearWindow + 3));
  const lyricMaxBlurPx = clampNumber(6.6 - lyricBlurRangeFactor * 3.8, 2.2, 6.6);
  const lyricCurveRadiusPx = Math.round(
    clampNumber(2100 - lyricCurveMagnitude * 1680, 420, 2100),
  );
  const baseLyricLineShiftDurationMs = Math.round(clampNumber(560 / lyricAnimationFactor, 260, 920));
  const baseLyricLineStaggerMs = Math.round(
    clampNumber(settings.lineAnimationStaggerMs ?? IMMERSIVE_LYRIC_STAGGER_MS, 0, 240),
  );
  const lyricJumpDurationMs = Math.round(clampNumber(300 / lyricAnimationFactor, 190, 360));
  const lyricJumpLineDurationMs = Math.round(clampNumber(lyricJumpDurationMs * 0.74, 150, 280));
  const lyricJumpShapeDurationMs = Math.round(clampNumber(lyricJumpDurationMs * 0.9, 180, 320));
  const lyricPreviewDurationMs = Math.round(clampNumber(220 / lyricAnimationFactor, 150, 280));
  const lyricOverflowSpacePx = Math.round(
    clampNumber(36 + lyricCurveMagnitude * 228, 36, 264),
  );
  const lyricAnchorYPercent = settings.lineAlignment === "upper" ? 38 : 50;
  const lyricTextAlign =
    settings.textAlignment === "center"
      ? "center"
      : settings.textAlignment === "right"
        ? "right"
        : "left";
  const lyricInlineJustify =
    settings.textAlignment === "center"
      ? "center"
      : settings.textAlignment === "right"
        ? "flex-end"
        : "flex-start";
  const lyricEmptyJustify =
    settings.textAlignment === "center"
      ? "center"
      : settings.textAlignment === "right"
        ? "end"
        : "start";
  const lyricTransformOrigin =
    settings.textAlignment === "center"
      ? "center center"
      : settings.textAlignment === "right"
        ? "right center"
        : "left center";
  const lyricRenderMode =
    settings.renderMode === "simple"
      ? "simple"
      : settings.renderMode === "balanced"
        ? "balanced"
        : "advanced";
  const lyricShadowIntensityFactor = clampNumber(settings.textShadowIntensity / 100, 0, 2);
  const lyricShadowDefinitionFactor = clampNumber(settings.textShadowDefinition / 100, 0, 1);
  const lyricGlowIntensityFactor = clampNumber(settings.glowIntensity / 100, 0, 2);
  const lyricGlowDefinitionFactor = clampNumber(settings.glowDefinition / 100, 0, 1);
  const lyricShadowAlpha = settings.textShadow ? 0.48 * lyricShadowIntensityFactor : 0;
  const lyricSecondaryShadowAlpha = settings.textShadow ? 0.3 * lyricShadowIntensityFactor : 0;
  const lyricGlowAlpha = settings.glow ? 0.22 * lyricGlowIntensityFactor : 0;
  const lyricActiveGlowAlpha = settings.glow ? 0.42 * lyricGlowIntensityFactor : 0;
  const lyricWordExtraGlowAlpha = settings.glow ? 0.24 * lyricGlowIntensityFactor : 0;
  const lyricShadowBlurPx = 0.06 + ((1 - lyricShadowDefinitionFactor) * 0.06);
  const lyricShadowOffsetEm = 0.012 + ((1 - lyricShadowDefinitionFactor) * 0.02);
  const lyricGlowBlurEm = 0.03 + ((1 - lyricGlowDefinitionFactor) * 0.04);
  const lyricGlowSpreadScale = 0.72 + ((1 - lyricGlowDefinitionFactor) * 0.7);
  const lyricGlowCoreScale = 0.8 + (lyricGlowDefinitionFactor * 0.32);
  const baseLyricScrollLeadMs = Math.round(
    clampNumber(((200 - settings.animationSpeed) / 150) * 1000, 0, 1000),
  );
  const playbackVisualItemIndex =
    visualItems.length > 0
      ? findActiveImmersiveLyricVisualItemIndex(visualItems, currentTimeMs)
      : activeLineIndex;
  const resolvedPlaybackVisualItemIndex =
    playbackVisualItemIndex >= 0
      ? playbackVisualItemIndex
      : visualItems.length > 0
        ? 0
        : -1;
  const playbackVisualItem =
    resolvedPlaybackVisualItemIndex >= 0 ? visualItems[resolvedPlaybackVisualItemIndex] ?? null : null;
  const nextPlaybackVisualItem =
    resolvedPlaybackVisualItemIndex >= 0
      ? visualItems[resolvedPlaybackVisualItemIndex + 1] ?? null
      : null;
  const playbackVisualItemDurationMs = playbackVisualItem
    ? Math.max(1, playbackVisualItem.endTimeMs - playbackVisualItem.startTimeMs)
    : Number.POSITIVE_INFINITY;
  const playbackVisualTransitionWindowMs = playbackVisualItem
    ? Math.min(
        playbackVisualItemDurationMs,
        nextPlaybackVisualItem
          ? Math.max(1, nextPlaybackVisualItem.startTimeMs - playbackVisualItem.startTimeMs)
          : playbackVisualItemDurationMs,
      )
    : Number.POSITIVE_INFINITY;
  const adaptiveLyricWindowMs = Number.isFinite(playbackVisualTransitionWindowMs)
    ? clampNumber(playbackVisualTransitionWindowMs, 120, 1600)
    : Number.POSITIVE_INFINITY;
  const lyricScrollLeadMs = Number.isFinite(adaptiveLyricWindowMs)
    ? Math.round(Math.min(baseLyricScrollLeadMs, Math.max(0, adaptiveLyricWindowMs * 0.42)))
    : baseLyricScrollLeadMs;
  const lyricLineShiftDurationMs = Number.isFinite(adaptiveLyricWindowMs)
    ? Math.round(
        Math.min(
          baseLyricLineShiftDurationMs,
          clampNumber(adaptiveLyricWindowMs * 0.72, 120, baseLyricLineShiftDurationMs),
        ),
      )
    : baseLyricLineShiftDurationMs;
  const lyricLineStaggerMs = Number.isFinite(adaptiveLyricWindowMs)
    ? Math.round(
        Math.min(
          baseLyricLineStaggerMs,
          clampNumber(
            lyricLineShiftDurationMs * 0.16,
            12,
            Math.max(baseLyricLineStaggerMs, 12),
          ),
        ),
      )
    : baseLyricLineStaggerMs;
  const lineScrollTimeMs = currentTimeMs + lyricScrollLeadMs;
  const scrolledActiveVisualItemIndex =
    visualItems.length > 0
      ? findActiveImmersiveLyricVisualItemIndex(visualItems, lineScrollTimeMs)
      : activeLineIndex;
  type SecondaryLyricsMode = "none" | "translation" | "romanized" | "both";
  const lyricToggleSignature = `${lyrics?.source ?? "none"}:${lines.length}:${lines[0]?.startTimeMs ?? -1}:${
    lines[0]?.text ?? ""
  }:${lines[lines.length - 1]?.startTimeMs ?? -1}:${lines[lines.length - 1]?.text ?? ""}`;
  const hasSecondaryLyrics = hasTranslatedLyrics || hasRomanizedLyrics;
  const availableSecondaryModes: SecondaryLyricsMode[] = [
    "none",
    ...(hasTranslatedLyrics ? (["translation"] as const) : []),
    ...(hasRomanizedLyrics ? (["romanized"] as const) : []),
    ...(hasTranslatedLyrics && hasRomanizedLyrics ? (["both"] as const) : []),
  ];
  const [secondaryLyricsMode, setSecondaryLyricsMode] = useState<SecondaryLyricsMode>(
    hasTranslatedLyrics ? "translation" : hasRomanizedLyrics ? "romanized" : "none",
  );
  const [showWordLyrics, setShowWordLyrics] = useState(hasWordLyrics);
  const [previewAnchorIndex, setPreviewAnchorIndex] = useState<number | null>(null);
  const [pendingSeekAnchorIndex, setPendingSeekAnchorIndex] = useState<number | null>(null);
  const playbackAnchorIndex = scrolledActiveVisualItemIndex >= 0 ? scrolledActiveVisualItemIndex : 0;
  const anchorIndex = previewAnchorIndex ?? pendingSeekAnchorIndex ?? playbackAnchorIndex;
  const highlightedVisualItemIndex = scrolledActiveVisualItemIndex;
  const useVisualAnchorHighlight = !showWordLyrics && (previewAnchorIndex !== null || pendingSeekAnchorIndex !== null);
  const effectiveHighlightedVisualItemIndex = useVisualAnchorHighlight
    ? anchorIndex
    : highlightedVisualItemIndex;
  const [isJumpingLyrics, setIsJumpingLyrics] = useState(false);
  const [jumpViewportOffsetY, setJumpViewportOffsetY] = useState(0);
  const previousAnchorIndexRef = useRef(anchorIndex);
  const previousLyricsTimeRef = useRef(lineScrollTimeMs);
  const jumpResetTimerRef = useRef<number | null>(null);
  const previewResetTimerRef = useRef<number | null>(null);
  const pendingSeekResetTimerRef = useRef<number | null>(null);
  const viewportShiftAnimationFrameRef = useRef<number | null>(null);
  const suppressNextViewportJumpRef = useRef(false);
  const pendingSeekReleaseAtRef = useRef<number | null>(null);
  const previewWheelCarryRef = useRef(0);
  const lyricsPanelRef = useRef<HTMLDivElement | null>(null);
  const lyricsBodyRef = useRef<HTMLDivElement | null>(null);
  const lyricLineNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const lyricLineHeightsRef = useRef<Record<string, number>>({});
  const [lyricLayoutVersion, setLyricLayoutVersion] = useState(0);
  const wordNodesRef = useRef<HTMLElement[]>([]);
  const lyricLayoutMeasurementSignature = `${visualItems.map((item) => item.key).join("|")}:${showWordLyrics}:${
    secondaryLyricsMode
  }:${Math.round(lyricFontScale * 100)}:${Math.round(lyricLineSpacingScale * 100)}`;
  const wordPlayheadTimeRef = useRef(currentTimeMs);
  const wordPlayheadAnchorRef = useRef({
    timeMs: currentTimeMs,
    performanceNow: performance.now(),
  });
  const wordPlayheadLastFrameRef = useRef(performance.now());
  const wordPlayheadRafRef = useRef<number | null>(null);
  const wordPlayheadNeedsSyncRef = useRef(false);

  useEffect(() => {
    setSecondaryLyricsMode(hasTranslatedLyrics ? "translation" : hasRomanizedLyrics ? "romanized" : "none");
  }, [hasRomanizedLyrics, hasTranslatedLyrics, lyricToggleSignature]);

  useEffect(() => {
    setShowWordLyrics(hasWordLyrics);
  }, [hasWordLyrics, lyricToggleSignature]);

  useEffect(() => {
    setPreviewAnchorIndex(null);
    setPendingSeekAnchorIndex(null);
    setJumpViewportOffsetY(0);
    setIsJumpingLyrics(false);
    suppressNextViewportJumpRef.current = false;
    pendingSeekReleaseAtRef.current = null;
    previewWheelCarryRef.current = 0;
    if (previewResetTimerRef.current !== null) {
      window.clearTimeout(previewResetTimerRef.current);
      previewResetTimerRef.current = null;
    }
    if (pendingSeekResetTimerRef.current !== null) {
      window.clearTimeout(pendingSeekResetTimerRef.current);
      pendingSeekResetTimerRef.current = null;
    }
  }, [lyricToggleSignature]);

  const showTranslatedLyrics = secondaryLyricsMode === "translation" || secondaryLyricsMode === "both";
  const showRomanizedLyrics = secondaryLyricsMode === "romanized" || secondaryLyricsMode === "both";
  const isPreviewingLyrics = previewAnchorIndex !== null;
  const isSeekingLyrics = pendingSeekAnchorIndex !== null;

  const updateWordNodes = (playheadTimeMs: number) => {
    for (const node of wordNodesRef.current) {
      const wordStartMs = Number(node.dataset.wordStart ?? 0);
      const wordEndMs = Number(node.dataset.wordEnd ?? wordStartMs);
      const wordDurationMs = Math.max(1, Number(node.dataset.wordDuration ?? Math.max(1, wordEndMs - wordStartMs)));
      const wordPreRollMs = Math.max(0, Number(node.dataset.wordPreRoll ?? 0));
      const wordPostRollMs = Math.max(0, Number(node.dataset.wordPostRoll ?? 0));
      const progress = clamp01((playheadTimeMs - wordStartMs) / wordDurationMs);
      const state =
        playheadTimeMs >= wordEndMs ? "past" : playheadTimeMs >= wordStartMs ? "active" : "future";
      const wordContextVisuals = resolveLyricWordContextVisuals(
        playheadTimeMs,
        {
          startTimeMs: wordStartMs,
          endTimeMs: wordEndMs,
          durationMs: wordDurationMs,
        },
        {
          preRollMs: wordPreRollMs,
          postRollMs: wordPostRollMs,
        },
      );

      if (node.dataset.wordState !== state) {
        node.dataset.wordState = state;
      }

      node.style.setProperty("--immersive-lyric-word-fill-progress", progress.toFixed(4));
      node.style.setProperty("--immersive-lyric-word-fill-glow", wordContextVisuals.glowAlpha);
      node.style.setProperty("--immersive-lyric-word-base-alpha", wordContextVisuals.baseAlpha);
    }
  };

  const clearPendingSeekResetTimer = () => {
    if (pendingSeekResetTimerRef.current !== null) {
      window.clearTimeout(pendingSeekResetTimerRef.current);
      pendingSeekResetTimerRef.current = null;
    }
  };

  const schedulePendingSeekReset = (
    delayMs: number,
    options?: {
      suppressViewportJump?: boolean;
    },
  ) => {
    clearPendingSeekResetTimer();
    pendingSeekResetTimerRef.current = window.setTimeout(() => {
      if (options?.suppressViewportJump) {
        suppressNextViewportJumpRef.current = true;
      }
      pendingSeekReleaseAtRef.current = null;
      setPendingSeekAnchorIndex(null);
      pendingSeekResetTimerRef.current = null;
    }, delayMs);
  };

  const estimateLyricItemHeight = (item: (typeof visualItems)[number]) => {
    const measuredHeight = lyricLineHeightsRef.current[item.key];
    if (typeof measuredHeight === "number" && Number.isFinite(measuredHeight) && measuredHeight > 0) {
      return measuredHeight;
    }

    if (item.kind === "interlude") {
      return Math.round(34 * clampNumber(lyricLineSpacingScale, 0.88, 1.6));
    }

    const secondaryCount =
      Number(showTranslatedLyrics && Boolean(item.line.translatedText?.trim())) +
      Number(showRomanizedLyrics && Boolean(item.line.romanizedText?.trim()));
    return lyricLineFallbackHeight + secondaryCount * Math.round(18 * lyricLineSpacingScale);
  };

  const resolveLyricCenterOffsets = (resolvedAnchorIndex: number) =>
    buildImmersiveLyricCenterOffsets({
      items: visualItems,
      anchorIndex: resolvedAnchorIndex,
      lineGap: lyricLineGap,
      getItemHeight: estimateLyricItemHeight,
    });

  useEffect(() => {
    const previousAnchorIndex = previousAnchorIndexRef.current;
    const previousLyricsTime = previousLyricsTimeRef.current;
    const shouldSuppressViewportJump =
      suppressNextViewportJumpRef.current && previousAnchorIndex !== anchorIndex;
    const hasLargeLineJump =
      previousAnchorIndex >= 0 &&
      anchorIndex >= 0 &&
      Math.abs(anchorIndex - previousAnchorIndex) > IMMERSIVE_LYRIC_JUMP_THRESHOLD_LINES;
    const hasLargeTimeJump =
      previousLyricsTime > 0 &&
      Math.abs(lineScrollTimeMs - previousLyricsTime) > IMMERSIVE_LYRIC_JUMP_THRESHOLD_MS;
    const shouldAnimateViewportJump =
      visualItems.length > 0 &&
      previousAnchorIndex !== anchorIndex &&
      (pendingSeekAnchorIndex !== null || hasLargeLineJump || hasLargeTimeJump);

    if (shouldSuppressViewportJump) {
      suppressNextViewportJumpRef.current = false;
      setIsJumpingLyrics(false);
      setJumpViewportOffsetY(0);
      wordPlayheadNeedsSyncRef.current = true;
      if (viewportShiftAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportShiftAnimationFrameRef.current);
        viewportShiftAnimationFrameRef.current = null;
      }
      if (jumpResetTimerRef.current !== null) {
        window.clearTimeout(jumpResetTimerRef.current);
        jumpResetTimerRef.current = null;
      }
    } else if (shouldAnimateViewportJump) {
      const previousOffsets = resolveLyricCenterOffsets(previousAnchorIndex);
      const nextJumpOffsetY = previousOffsets[anchorIndex] ?? 0;

      setIsJumpingLyrics(true);
      wordPlayheadNeedsSyncRef.current = true;
      setJumpViewportOffsetY(nextJumpOffsetY);
      if (viewportShiftAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportShiftAnimationFrameRef.current);
      }
      viewportShiftAnimationFrameRef.current = window.requestAnimationFrame(() => {
        setJumpViewportOffsetY(0);
        viewportShiftAnimationFrameRef.current = null;
      });
      if (jumpResetTimerRef.current !== null) {
        window.clearTimeout(jumpResetTimerRef.current);
      }
      jumpResetTimerRef.current = window.setTimeout(() => {
        setIsJumpingLyrics(false);
        setJumpViewportOffsetY(0);
        jumpResetTimerRef.current = null;
      }, lyricJumpDurationMs + 72);
    }

    previousAnchorIndexRef.current = anchorIndex;
    previousLyricsTimeRef.current = lineScrollTimeMs;
  }, [
    anchorIndex,
    lineScrollTimeMs,
    lyricJumpDurationMs,
    pendingSeekAnchorIndex,
    lyricLayoutMeasurementSignature,
    lyricLayoutVersion,
  ]);

  useEffect(() => {
    if (
      pendingSeekAnchorIndex === null ||
      scrolledActiveVisualItemIndex < 0 ||
      Math.abs(scrolledActiveVisualItemIndex - pendingSeekAnchorIndex) > 1
    ) {
      return;
    }

    const releaseAt = pendingSeekReleaseAtRef.current;
    const remainingLockMs = releaseAt === null ? 0 : Math.max(0, releaseAt - performance.now());
    schedulePendingSeekReset(Math.max(remainingLockMs + 80, lyricJumpDurationMs + 36), {
      suppressViewportJump: true,
    });
  }, [lyricJumpDurationMs, pendingSeekAnchorIndex, scrolledActiveVisualItemIndex]);

  useEffect(() => {
    return () => {
      if (jumpResetTimerRef.current !== null) {
        window.clearTimeout(jumpResetTimerRef.current);
      }
      if (previewResetTimerRef.current !== null) {
        window.clearTimeout(previewResetTimerRef.current);
      }
      if (pendingSeekResetTimerRef.current !== null) {
        window.clearTimeout(pendingSeekResetTimerRef.current);
      }
      if (viewportShiftAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportShiftAnimationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const panel = lyricsPanelRef.current;
    if (!panel || !showWordLyrics) {
      wordNodesRef.current = [];
      return;
    }

    wordNodesRef.current = Array.from(panel.querySelectorAll<HTMLElement>(".immersive-player__lyric-word"));
    updateWordNodes(wordPlayheadTimeRef.current);
  }, [lyricToggleSignature, showWordLyrics]);

  useEffect(() => {
    wordPlayheadAnchorRef.current = {
      timeMs: currentTimeMs,
      performanceNow: performance.now(),
    };

    if (!isPlaying || Math.abs(currentTimeMs - wordPlayheadTimeRef.current) > 680) {
      wordPlayheadNeedsSyncRef.current = true;
    }

    if (!isPlaying || wordPlayheadNeedsSyncRef.current) {
      wordPlayheadTimeRef.current = currentTimeMs;
      updateWordNodes(currentTimeMs);
      wordPlayheadNeedsSyncRef.current = false;
    }

    return () => {
      updateWordNodes(currentTimeMs);
    };
  }, [currentTimeMs, isPlaying]);

  useEffect(() => {
    if (!showWordLyrics) {
      if (wordPlayheadRafRef.current !== null) {
        window.cancelAnimationFrame(wordPlayheadRafRef.current);
        wordPlayheadRafRef.current = null;
      }
      return;
    }

    const tick = (frameNow: number) => {
      const currentAnchor = wordPlayheadAnchorRef.current;
      const targetTimeMs = isPlaying
        ? currentAnchor.timeMs + (frameNow - currentAnchor.performanceNow)
        : currentAnchor.timeMs;
      const previousFrameNow = wordPlayheadLastFrameRef.current;
      const frameDelta = clampNumber(frameNow - previousFrameNow, 0, 34);
      const currentPlayheadTimeMs = wordPlayheadTimeRef.current;
      const driftMs = targetTimeMs - currentPlayheadTimeMs;
      let nextPlayheadTimeMs = currentPlayheadTimeMs;

      if (!isPlaying || wordPlayheadNeedsSyncRef.current || Math.abs(driftMs) > 680) {
        nextPlayheadTimeMs = targetTimeMs;
        wordPlayheadNeedsSyncRef.current = false;
      } else {
        const baseForwardStepMs = frameDelta;
        const forwardCorrectionMs =
          driftMs > 0 ? Math.min(driftMs * 0.06, frameDelta * 0.22) : 0;
        const backwardCorrectionMs =
          driftMs < -32 ? Math.max(driftMs * 0.02, -frameDelta * 0.08) : 0;
        const totalStepMs = clampNumber(
          baseForwardStepMs + forwardCorrectionMs + backwardCorrectionMs,
          frameDelta * 0.72,
          frameDelta * 1.24,
        );

        nextPlayheadTimeMs = currentPlayheadTimeMs + totalStepMs;

        if (Math.abs(targetTimeMs - nextPlayheadTimeMs) < 1.2) {
          nextPlayheadTimeMs = targetTimeMs;
        }
      }

      wordPlayheadLastFrameRef.current = frameNow;
      wordPlayheadTimeRef.current = nextPlayheadTimeMs;
      updateWordNodes(nextPlayheadTimeMs);
      wordPlayheadRafRef.current = window.requestAnimationFrame(tick);
    };

    wordPlayheadLastFrameRef.current = performance.now();
    wordPlayheadRafRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (wordPlayheadRafRef.current !== null) {
        window.cancelAnimationFrame(wordPlayheadRafRef.current);
        wordPlayheadRafRef.current = null;
      }
    };
  }, [isPlaying, showWordLyrics]);
  const lyricCenterOffsets = useMemo(() => {
    return resolveLyricCenterOffsets(anchorIndex);
  }, [anchorIndex, lyricLayoutMeasurementSignature, lyricLayoutVersion]);
  const lyricsPanelStyle = {
    "--immersive-lyric-font-family": buildLyricFontFamilyValue(settings.fontFamily),
    "--immersive-lyric-font-weight": `${lyricFontWeight}`,
    "--immersive-lyric-render-mode": lyricRenderMode,
    "--immersive-lyric-font-scale": `${lyricFontScale}`,
    "--immersive-lyric-line-gap": `${lyricLineContentGap}px`,
    "--immersive-lyric-anchor-y": `${lyricAnchorYPercent}%`,
    "--immersive-lyric-text-align": lyricTextAlign,
    "--immersive-lyric-inline-justify": lyricInlineJustify,
    "--immersive-lyric-empty-justify": lyricEmptyJustify,
    "--immersive-lyric-transform-origin": lyricTransformOrigin,
    "--immersive-lyric-shadow-alpha": `${lyricShadowAlpha}`,
    "--immersive-lyric-secondary-shadow-alpha": `${lyricSecondaryShadowAlpha}`,
    "--immersive-lyric-shadow-blur": `${lyricShadowBlurPx.toFixed(3)}em`,
    "--immersive-lyric-shadow-offset": `${lyricShadowOffsetEm.toFixed(3)}em`,
    "--immersive-lyric-glow-alpha": `${lyricGlowAlpha}`,
    "--immersive-lyric-active-glow-alpha": `${lyricActiveGlowAlpha}`,
    "--immersive-lyric-word-extra-glow-alpha": `${lyricWordExtraGlowAlpha}`,
    "--immersive-lyric-glow-blur": `${lyricGlowBlurEm.toFixed(3)}em`,
    "--immersive-lyric-glow-spread-scale": `${lyricGlowSpreadScale.toFixed(3)}`,
    "--immersive-lyric-glow-core-scale": `${lyricGlowCoreScale.toFixed(3)}`,
    "--immersive-lyric-shift-duration": `${lyricLineShiftDurationMs}ms`,
    "--immersive-lyric-shift-curve": "cubic-bezier(0.2, 0.82, 0.18, 1)",
    "--immersive-lyric-word-curve": "cubic-bezier(0.24, 0.76, 0.22, 1)",
    "--immersive-lyric-overflow-space": `${lyricOverflowSpacePx}px`,
  } as CSSProperties;
  const lyricsViewportStyle = {
    "--immersive-lyric-viewport-shift-duration": `${lyricJumpDurationMs}ms`,
    "--immersive-lyric-viewport-shift-curve":
      isSeekingLyrics
        ? "cubic-bezier(0.22, 0.72, 0.18, 1)"
        : "cubic-bezier(0.24, 0.68, 0.2, 1)",
    "--immersive-lyric-viewport-shift-offset": `${jumpViewportOffsetY.toFixed(2)}px`,
  } as CSSProperties;
  const secondaryLyricsLabel =
    secondaryLyricsMode === "translation"
      ? copy.translation
      : secondaryLyricsMode === "romanized"
        ? copy.romanized
        : secondaryLyricsMode === "both"
          ? `${copy.translation} / ${copy.romanized}`
          : copy.lyrics;
  const emptyTitle = emptyState === "instrumental" ? copy.instrumentalTitle : copy.lyricsEmpty;
  const emptyHint = emptyState === "instrumental" ? copy.instrumentalHint : copy.lyricsHint;
  const handleCycleSecondaryLyricsMode = () => {
    if (availableSecondaryModes.length <= 1) {
      return;
    }

    const currentIndex = availableSecondaryModes.indexOf(secondaryLyricsMode);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % availableSecondaryModes.length;
    setSecondaryLyricsMode(availableSecondaryModes[nextIndex] ?? "none");
  };

  const schedulePreviewReset = () => {
    if (previewResetTimerRef.current !== null) {
      window.clearTimeout(previewResetTimerRef.current);
    }

    previewResetTimerRef.current = window.setTimeout(() => {
      setPreviewAnchorIndex(null);
      previewWheelCarryRef.current = 0;
      previewResetTimerRef.current = null;
    }, 1800);
  };

  const handlePreviewWheel = (event: Pick<WheelEvent, "deltaMode" | "deltaY" | "preventDefault" | "stopPropagation" | "cancelable">) => {
    if (!showControls) {
      return;
    }
    if (visualItems.length === 0) {
      return;
    }

    if (event.cancelable) {
      event.preventDefault();
    }
    event.stopPropagation();
    setPendingSeekAnchorIndex(null);
    clearPendingSeekResetTimer();

    const deltaFactor =
      event.deltaMode === 1 ? 34 : event.deltaMode === 2 ? window.innerHeight * 0.28 : 1;
    const normalizedDeltaY = event.deltaY * deltaFactor;

    if (!Number.isFinite(normalizedDeltaY) || normalizedDeltaY === 0) {
      return;
    }

    previewWheelCarryRef.current += normalizedDeltaY;
    const stepThreshold = 42;
    const stepCount =
      previewWheelCarryRef.current > 0
        ? Math.floor(previewWheelCarryRef.current / stepThreshold)
        : Math.ceil(previewWheelCarryRef.current / stepThreshold);

    if (stepCount !== 0) {
      previewWheelCarryRef.current -= stepCount * stepThreshold;
      const baseAnchorIndex = anchorIndex;
      setPreviewAnchorIndex((current) =>
        Math.max(0, Math.min(visualItems.length - 1, (current ?? baseAnchorIndex) + stepCount)),
      );
    }

    schedulePreviewReset();
  };

  useEffect(() => {
    const body = lyricsBodyRef.current;
    if (!body) {
      return;
    }

    const handleNativeWheel = (event: WheelEvent) => {
      handlePreviewWheel(event);
    };

    body.addEventListener("wheel", handleNativeWheel, { passive: false });
    return () => {
      body.removeEventListener("wheel", handleNativeWheel);
    };
  }, [showControls, visualItems.length, anchorIndex]);

  const handleLyricSelect = (startTimeMs: number, itemIndex: number) => {
    if (!showControls) {
      return;
    }
    setPreviewAnchorIndex(null);
    setPendingSeekAnchorIndex(itemIndex);
    pendingSeekReleaseAtRef.current = performance.now() + lyricJumpDurationMs + 140;
    suppressNextViewportJumpRef.current = false;
    previewWheelCarryRef.current = 0;
    if (previewResetTimerRef.current !== null) {
      window.clearTimeout(previewResetTimerRef.current);
      previewResetTimerRef.current = null;
    }
    schedulePendingSeekReset(Math.max(1100, lyricJumpDurationMs * 4));
    wordPlayheadNeedsSyncRef.current = true;
    onLyricSeek(startTimeMs);
  };

  useLayoutEffect(() => {
    if (visualItems.length === 0) {
      if (Object.keys(lyricLineHeightsRef.current).length > 0) {
        lyricLineHeightsRef.current = {};
        setLyricLayoutVersion((current) => current + 1);
      }
      return;
    }

    const collectMeasurements = () => {
      const nextHeights: Record<string, number> = {};
      let hasChanged =
        Object.keys(lyricLineHeightsRef.current).length !== lyricLineNodesRef.current.size;

      lyricLineNodesRef.current.forEach((node, key) => {
        const nextHeight = Math.max(24, Math.ceil(node.offsetHeight));
        nextHeights[key] = nextHeight;
        if (lyricLineHeightsRef.current[key] !== nextHeight) {
          hasChanged = true;
        }
      });

      if (hasChanged) {
        lyricLineHeightsRef.current = nextHeights;
        setLyricLayoutVersion((current) => current + 1);
      }
    };

    collectMeasurements();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    let frameId = 0;
    const observer = new ResizeObserver(() => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        collectMeasurements();
      });
    });

    lyricLineNodesRef.current.forEach((node) => {
      observer.observe(node);
    });

    return () => {
      observer.disconnect();
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [lyricLayoutMeasurementSignature]);

  return (
    <div className="immersive-player__lyrics-panel" style={lyricsPanelStyle} ref={lyricsPanelRef}>
      {showControls ? (
        <div className="immersive-player__lyrics-header">
          <div className="immersive-player__lyrics-toggles">
            <button
              type="button"
              className={[
                "immersive-player__lyrics-toggle",
                secondaryLyricsMode !== "none" ? "immersive-player__lyrics-toggle--active" : "",
                `immersive-player__lyrics-toggle--mode-${secondaryLyricsMode}`,
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={!hasSecondaryLyrics}
              aria-pressed={secondaryLyricsMode !== "none"}
              aria-label={secondaryLyricsLabel}
              title={secondaryLyricsLabel}
              onClick={handleCycleSecondaryLyricsMode}
            >
              <SecondaryLyricDisplayModeIcon mode={secondaryLyricsMode} />
            </button>
            <button
              type="button"
              className={[
                "immersive-player__lyrics-toggle",
                "immersive-player__lyrics-toggle--word",
                showWordLyrics ? "immersive-player__lyrics-toggle--active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={!hasWordLyrics}
              aria-pressed={showWordLyrics}
              aria-label={copy.dynamicLyric}
              title={copy.dynamicLyric}
              onClick={() => {
                if (hasWordLyrics) {
                  setShowWordLyrics((current) => !current);
                }
              }}
            >
              <WordLyricModeIcon />
            </button>
          </div>
        </div>
      ) : null}
      <div className="immersive-player__lyrics-body" ref={lyricsBodyRef}>
        {isLoading ? (
          <div className="immersive-player__lyrics-empty immersive-player__lyrics-empty--loading">
            <div className="immersive-player__lyrics-loading-indicator" aria-hidden="true" />
            <p>{copy.lyricsLoading}</p>
          </div>
        ) : hasRenderableLyrics && visualItems.length > 0 ? (
          <div
            className={[
              "immersive-player__lyrics-viewport",
              isJumpingLyrics ? "immersive-player__lyrics-viewport--jumping" : "",
              pendingSeekAnchorIndex !== null ? "immersive-player__lyrics-viewport--seeking" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={lyricsViewportStyle}
          >
            {visualItems.map((item, index) => {
              const isCurrentPlaybackLine = index === effectiveHighlightedVisualItemIndex;
              const isPlaybackPastLine =
                highlightedVisualItemIndex >= 0 && index < highlightedVisualItemIndex;
              const isActive = useVisualAnchorHighlight ? isCurrentPlaybackLine : isPreviewingLyrics ? false : isCurrentPlaybackLine;
              const isPast = isPreviewingLyrics ? false : isPlaybackPastLine;
              const isInterlude = item.kind === "interlude";
              const line = item.kind === "line" ? item.line : null;
              const translatedText =
                item.kind === "line" && showTranslatedLyrics ? item.line.translatedText?.trim() || "" : "";
              const romanizedText =
                item.kind === "line" && showRomanizedLyrics ? item.line.romanizedText?.trim() || "" : "";
              const relativeIndex = index - anchorIndex;
              const absDistance = Math.abs(relativeIndex);
              const offsetY = lyricCenterOffsets[index] ?? 0;
              const blurProgress =
                isPreviewingLyrics || isActive
                  ? 0
                  : clamp01(Math.max(0, absDistance - 0.45) / lyricClearWindow);
              const scale = isPreviewingLyrics
                ? 1
                : clampNumber(1 - Math.pow(blurProgress, 1.08) * 0.18, 0.82, 1);
              const opacity = isPreviewingLyrics
                ? 1
                : isActive
                  ? 1
                  : clampNumber(1 - Math.pow(blurProgress, 1.18) * 0.9, 0.08, 0.94);
              const blur =
                isPreviewingLyrics || isActive
                  ? 0
                  : Math.pow(blurProgress, 1.45) * lyricMaxBlurPx;
              const visibility = absDistance > lyricVisibilityDistance ? "hidden" : "visible";
              const zIndex = Math.max(1, 20 - absDistance);
              const staggerIndex = Math.max(0, Math.min(10, relativeIndex + 5));
              const transitionDelayMs =
                isJumpingLyrics
                  ? isSeekingLyrics
                    ? 0
                    : Math.min(42, Math.max(0, absDistance - 0.5) * 8)
                  : isPreviewingLyrics
                    ? 0
                    : staggerIndex * lyricLineStaggerMs;
              const transitionDuration = isJumpingLyrics
                ? `${lyricJumpLineDurationMs}ms`
                : isPreviewingLyrics
                  ? `${lyricPreviewDurationMs}ms`
                : "var(--immersive-lyric-shift-duration)";
              const transitionCurve = isJumpingLyrics
                ? isSeekingLyrics
                  ? "cubic-bezier(0.22, 0.72, 0.2, 1)"
                  : "cubic-bezier(0.24, 0.68, 0.2, 1)"
                : isPreviewingLyrics
                  ? "cubic-bezier(0.22, 0.9, 0.2, 1)"
                : "var(--immersive-lyric-shift-curve)";
              const curveTransitionDelayMs =
                isJumpingLyrics
                  ? isSeekingLyrics
                    ? 0
                    : Math.min(20, Math.max(0, absDistance - 0.5) * 4)
                  : isPreviewingLyrics
                    ? 0
                    : transitionDelayMs +
                      (lyricLineStaggerMs > 0
                        ? Math.round(clampNumber(lyricLineStaggerMs * 0.22, 10, 28))
                        : 0);
              const curveTransitionDuration = isJumpingLyrics
                ? `${lyricJumpShapeDurationMs}ms`
                : isPreviewingLyrics
                  ? `${Math.round(lyricPreviewDurationMs * 1.08)}ms`
                  : `${Math.round(lyricLineShiftDurationMs * 1.18)}ms`;
              const curveTransitionCurve = isJumpingLyrics
                ? isSeekingLyrics
                  ? "cubic-bezier(0.2, 0.74, 0.18, 1)"
                  : "cubic-bezier(0.22, 0.7, 0.18, 1)"
                : isPreviewingLyrics
                  ? "cubic-bezier(0.16, 0.92, 0.2, 1)"
                  : "cubic-bezier(0.14, 0.82, 0.16, 1.02)";
              const curveOffsetY = clampNumber(offsetY, -lyricCurveRadiusPx * 0.96, lyricCurveRadiusPx * 0.96);
              const curveProgress =
                lyricCurveMagnitude > 0
                  ? clampNumber(curveOffsetY / lyricCurveRadiusPx, -0.96, 0.96)
                  : 0;
              const normalizedCurveDistance = clamp01(
                Math.max(0, absDistance - 0.2) / Math.max(1, lyricVisibilityDistance - 1),
              );
              const curveArcTranslateX =
                lyricCurveMagnitude > 0
                  ? (lyricCurveRadiusPx -
                      Math.sqrt(
                        Math.max(
                          0,
                          lyricCurveRadiusPx * lyricCurveRadiusPx - curveOffsetY * curveOffsetY,
                        ),
                      )) *
                    (1.08 + lyricCurveMagnitude * 2.4)
                  : 0;
              const curveDistanceTranslateX =
                lyricCurveMagnitude > 0
                  ? Math.pow(normalizedCurveDistance, 1.28) * (18 + lyricCurveMagnitude * 150)
                  : 0;
              const curveTranslateX =
                lyricCurveMagnitude > 0
                  ? clampNumber(curveArcTranslateX + curveDistanceTranslateX, 0, 240)
                  : 0;
              const signedCurveTranslateX = curveTranslateX * lyricCurveDirection;
              const curveRotateDeg =
                lyricCurveMagnitude > 0
                  ? (((Math.asin(curveProgress) * 180) / Math.PI) *
                      (0.92 + lyricCurveMagnitude * 0.22) *
                      lyricCurveDirection)
                  : 0;
              const interludeProgress = isInterlude
                ? clamp01((currentTimeMs - item.startTimeMs) / Math.max(item.durationMs, 1))
                : 0;
              const interactionLabel = item.kind === "line" ? item.line.text : copy.interludeWaiting;

              return (
                <div
                  key={item.key}
                  ref={(node) => {
                    if (node) {
                      lyricLineNodesRef.current.set(item.key, node);
                    } else {
                      lyricLineNodesRef.current.delete(item.key);
                    }
                  }}
                  data-lyric-key={item.key}
                  className={[
                    "immersive-player__lyric-line",
                    isInterlude ? "immersive-player__lyric-line--interlude" : "",
                    isPast ? "immersive-player__lyric-line--past" : "",
                    isActive ? "immersive-player__lyric-line--active" : "",
                    isPreviewingLyrics && index === anchorIndex
                      ? "immersive-player__lyric-line--preview-anchor"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  role={showControls ? "button" : undefined}
                  tabIndex={showControls ? 0 : -1}
                  aria-label={interactionLabel}
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => {
                    if (showControls) {
                      handleLyricSelect(item.startTimeMs, index);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (!showControls) {
                      return;
                    }
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleLyricSelect(item.startTimeMs, index);
                    }
                  }}
                  style={
                    {
                      "--immersive-lyric-line-position-delay": `${transitionDelayMs}ms`,
                      "--immersive-lyric-line-position-duration": transitionDuration,
                      "--immersive-lyric-line-position-curve": transitionCurve,
                      transform: `translate3d(0, ${offsetY.toFixed(2)}px, 0) translateY(-50%)`,
                      visibility,
                      zIndex,
                    } as CSSProperties &
                      Record<
                        | "--immersive-lyric-line-position-delay"
                        | "--immersive-lyric-line-position-duration"
                        | "--immersive-lyric-line-position-curve",
                        string
                      >
                  }
                >
                  <div
                    className="immersive-player__lyric-line-shape"
                    style={
                      {
                        "--immersive-lyric-line-shape-delay": `${curveTransitionDelayMs}ms`,
                        "--immersive-lyric-line-shape-duration": curveTransitionDuration,
                        "--immersive-lyric-line-shape-curve": curveTransitionCurve,
                        transform: `translate3d(${(-signedCurveTranslateX).toFixed(2)}px, 0, 0) rotate(${curveRotateDeg.toFixed(3)}deg) scale(${scale.toFixed(4)})`,
                        opacity: Number(opacity.toFixed(3)),
                        filter: `blur(${blur.toFixed(2)}px)`,
                      } as CSSProperties &
                        Record<
                          | "--immersive-lyric-line-shape-delay"
                          | "--immersive-lyric-line-shape-duration"
                          | "--immersive-lyric-line-shape-curve",
                          string
                        >
                    }
                  >
                    {isInterlude ? (
                      <div className="immersive-player__lyric-interlude">
                        <ImmersiveInterludeIndicator progress={interludeProgress} />
                      </div>
                    ) : line ? (
                      <>
                        <strong
                          className={[
                            "immersive-player__lyric-primary",
                            showWordLyrics && line.words.length > 0 ? "immersive-player__lyric-primary--word" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          data-lyric-text={line.text}
                        >
                          <span className="immersive-player__lyric-primary-shadow" aria-hidden="true">
                            {showWordLyrics && line.words.length > 0
                              ? renderImmersiveLyricWordStaticFragments(line)
                              : line.text}
                          </span>
                          <span className="immersive-player__lyric-primary-glow" aria-hidden="true">
                            {showWordLyrics && line.words.length > 0
                              ? renderImmersiveLyricWordStaticFragments(line)
                              : line.text}
                          </span>
                          <span className="immersive-player__lyric-primary-content">
                            {showWordLyrics && line.words.length > 0 ? (
                              line.words.map((word, wordIndex) => {
                                const previousWord = line.words[wordIndex - 1] ?? null;
                                const nextWord = line.words[wordIndex + 1] ?? null;
                                return (
                                  <ImmersiveLyricWord
                                    key={`${line.startTimeMs}-${word.startTimeMs}-${wordIndex}`}
                                    line={line}
                                    word={word}
                                    previousWord={previousWord}
                                    nextWord={nextWord}
                                    currentTimeMs={currentTimeMs}
                                  />
                                );
                              })
                            ) : (
                              line.text
                            )}
                          </span>
                        </strong>
                        {translatedText ? (
                          <span className="immersive-player__lyric-secondary" data-lyric-text={translatedText}>
                            <span className="immersive-player__lyric-secondary-shadow" aria-hidden="true">
                              {translatedText}
                            </span>
                            <span className="immersive-player__lyric-secondary-glow" aria-hidden="true">
                              {translatedText}
                            </span>
                            <span className="immersive-player__lyric-secondary-content">{translatedText}</span>
                          </span>
                        ) : null}
                        {romanizedText ? (
                          <span
                            className="immersive-player__lyric-secondary immersive-player__lyric-secondary--romanized"
                            data-lyric-text={romanizedText}
                          >
                            <span className="immersive-player__lyric-secondary-shadow" aria-hidden="true">
                              {romanizedText}
                            </span>
                            <span className="immersive-player__lyric-secondary-glow" aria-hidden="true">
                              {romanizedText}
                            </span>
                            <span className="immersive-player__lyric-secondary-content">{romanizedText}</span>
                          </span>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            className={[
              "immersive-player__lyrics-empty",
              emptyState === "instrumental" ? "immersive-player__lyrics-empty--instrumental" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <p>{emptyTitle}</p>
            {emptyHint ? <span>{emptyHint}</span> : null}
          </div>
        )}
      </div>
    </div>
  );
}

function ImmersiveFluidCanvas({
  palette,
  isActive,
  appearanceSettings,
}: {
  palette: ImmersiveArtworkPalette;
  isActive: boolean;
  appearanceSettings: AppSettings["appearance"];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sampleSignature = palette.samples
    .map((sample) => `${sample.color}:${sample.x.toFixed(3)}:${sample.y.toFixed(3)}:${sample.weight.toFixed(3)}`)
    .join("|");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d", { alpha: true });
    if (!context) {
      return;
    }

    type FlowLobe = {
      angle: number;
      distance: number;
      scaleX: number;
      scaleY: number;
      alpha: number;
      rotationOffset: number;
    };

    type FlowNode = {
      anchorX: number;
      anchorY: number;
      orbitX: number;
      orbitY: number;
      radius: number;
      stretch: number;
      color: string;
      alpha: number;
      phase: number;
      speed: number;
      rotation: number;
      weight: number;
      lobes: FlowLobe[];
    };

    const precisionScale = clampNumber(appearanceSettings.immersiveBackgroundResolution / 100, 0.45, 1);
    const speedScale = clampNumber(appearanceSettings.immersiveBackgroundSpeed / 100, 0.55, 2.4);
    const blurAmount = clampNumber(appearanceSettings.immersiveBackgroundBlur, 0, 36);
    const softnessScale = clampNumber(appearanceSettings.immersiveBackgroundSoftness / 100, 0, 1);
    const isAnimated = appearanceSettings.immersiveBackgroundAnimated;
    const targetFrameIntervalMs = precisionScale >= 0.76 ? 20 : 16;
    const overscanRatio = 0.14;
    const samplePool = palette.samples.length
      ? palette.samples
      : [
        { color: palette.base, x: 0.22, y: 0.22, weight: 0.88 },
        { color: palette.secondary, x: 0.74, y: 0.26, weight: 0.9 },
        { color: palette.glow, x: 0.68, y: 0.72, weight: 0.82 },
        { color: palette.edge, x: 0.3, y: 0.8, weight: 0.76 },
      ];
    const colorPool = Array.from(
      new Set([
        ...samplePool.map((sample) => sample.color),
        palette.base,
        palette.secondary,
        palette.glow,
        palette.edge,
      ]),
    );

    let width = 0;
    let height = 0;
    let renderWidth = 0;
    let renderHeight = 0;
    let flowNodes: FlowNode[] = [];
    let frameId = 0;
    let resizeFrameId = 0;
    const fieldCanvas = document.createElement("canvas");
    const meshCanvas = document.createElement("canvas");
    const backdropCanvas = document.createElement("canvas");
    const fieldContext = fieldCanvas.getContext("2d", { alpha: true });
    const meshContext = meshCanvas.getContext("2d", { alpha: true });
    const backdropContext = backdropCanvas.getContext("2d", { alpha: true });
    if (!fieldContext || !meshContext || !backdropContext) {
      return;
    }
    let lastRenderTimeMs = 0;

    const createSeededRandom = (seed: number) => {
      let state = seed;
      return () => {
        const value = Math.sin(state) * 10000;
        state += 1;
        return value - Math.floor(value);
      };
    };

    const buildFlowNodes = (canvasWidth: number, canvasHeight: number) => {
      const minDimension = Math.min(canvasWidth, canvasHeight);
      const baseSeed =
        (canvasWidth * 0.017) +
        (canvasHeight * 0.013) +
        colorPool.reduce((sum, color, index) => sum + ((parseInt(color.slice(1), 16) % 97) * (index + 1)), 0);
      const random = createSeededRandom(baseSeed);
      const generatedNodes: FlowNode[] = [];
      const createBlobLobes = (count: number, spread = 1) =>
        Array.from({ length: count }, (_, index) => {
          const distribution = count === 1 ? 0 : index / count;
          return {
            angle: (distribution * Math.PI * 2) + (random() * 0.76),
            distance: (0.24 + (random() * 0.22)) * spread,
            scaleX: 0.52 + (random() * 0.34),
            scaleY: 0.54 + (random() * 0.38),
            alpha: 0.42 + (random() * 0.26),
            rotationOffset: (random() - 0.5) * 0.85,
          };
        });

      samplePool.forEach((sample, index) => {
        generatedNodes.push({
          anchorX: canvasWidth * sample.x,
          anchorY: canvasHeight * sample.y,
          orbitX: minDimension * (0.082 + (sample.weight * 0.072)),
          orbitY: minDimension * (0.074 + (sample.weight * 0.064)),
          radius: minDimension * (0.32 + (sample.weight * (0.16 + (softnessScale * 0.08)))),
          stretch: 1.02 + (random() * 0.44),
          color: sample.color,
          alpha: 0.42 + (sample.weight * 0.16),
          phase: random() * Math.PI * 2,
          speed: 0.46 + (random() * 0.22) + (index * 0.03),
          rotation: random() * Math.PI * 2,
          weight: sample.weight,
          lobes: createBlobLobes(3 + (index % 2), 1 + (sample.weight * 0.12)),
        });
      });

      const sortedSamples = [...samplePool].sort((left, right) => (left.x + left.y) - (right.x + right.y));
      for (let index = 0; index < sortedSamples.length; index += 2) {
        const from = sortedSamples[index];
        const to = sortedSamples[(index + 1) % sortedSamples.length];
        generatedNodes.push({
          anchorX: canvasWidth * ((from.x + to.x) * 0.5),
          anchorY: canvasHeight * ((from.y + to.y) * 0.5),
          orbitX: minDimension * (0.058 + (((from.weight + to.weight) * 0.5) * 0.036)),
          orbitY: minDimension * (0.05 + (((from.weight + to.weight) * 0.5) * 0.032)),
          radius: minDimension * (0.22 + (((from.weight + to.weight) * 0.5) * (0.1 + (softnessScale * 0.05)))),
          stretch: 0.96 + (random() * 0.28),
          color: mixHexColors(from.color, to.color, 0.5),
          alpha: 0.22 + (((from.weight + to.weight) * 0.5) * 0.1),
          phase: random() * Math.PI * 2,
          speed: 0.36 + (random() * 0.18) + (index * 0.02),
          rotation: random() * Math.PI * 2,
          weight: (from.weight + to.weight) * 0.5,
          lobes: createBlobLobes(2, 0.76),
        });
      }

      return generatedNodes;
    };

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect() ?? canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        return;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 1.18);
      width = rect.width;
      height = rect.height;
      const overscanX = width * overscanRatio;
      const overscanY = height * overscanRatio;
      const expandedWidth = width + (overscanX * 2);
      const expandedHeight = height + (overscanY * 2);
      renderWidth = Math.max(96, Math.round(expandedWidth * dpr * clampNumber(precisionScale, 0.42, 0.92)));
      renderHeight = Math.max(96, Math.round(expandedHeight * dpr * clampNumber(precisionScale, 0.42, 0.92)));
      canvas.width = renderWidth;
      canvas.height = renderHeight;
      fieldCanvas.width = renderWidth;
      fieldCanvas.height = renderHeight;
      meshCanvas.width = renderWidth;
      meshCanvas.height = renderHeight;
      backdropCanvas.width = renderWidth;
      backdropCanvas.height = renderHeight;
      canvas.style.width = `${expandedWidth}px`;
      canvas.style.height = `${expandedHeight}px`;
      canvas.style.transform = `translate3d(${-overscanX.toFixed(2)}px, ${-overscanY.toFixed(2)}px, 0)`;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      fieldContext.setTransform(1, 0, 0, 1, 0, 0);
      fieldContext.imageSmoothingEnabled = true;
      fieldContext.imageSmoothingQuality = "high";
      meshContext.setTransform(1, 0, 0, 1, 0, 0);
      meshContext.imageSmoothingEnabled = true;
      meshContext.imageSmoothingQuality = "high";
      backdropContext.setTransform(1, 0, 0, 1, 0, 0);
      backdropContext.imageSmoothingEnabled = true;
      backdropContext.imageSmoothingQuality = "high";
      flowNodes = buildFlowNodes(renderWidth, renderHeight);
    };

    const drawBackdrop = () => {
      backdropContext.clearRect(0, 0, renderWidth, renderHeight);

      const baseGradient = backdropContext.createLinearGradient(0, 0, renderWidth, renderHeight);
      const backdropStops = [...samplePool].sort((left, right) => (left.x + left.y) - (right.x + right.y));
      backdropStops.forEach((sample, index) => {
        const stop = backdropStops.length === 1 ? 0 : index / (backdropStops.length - 1);
        baseGradient.addColorStop(stop, sample.color);
      });
      backdropContext.fillStyle = baseGradient;
      backdropContext.fillRect(0, 0, renderWidth, renderHeight);

      samplePool.forEach((sample, index) => {
        const radius = Math.max(renderWidth, renderHeight) * (0.44 + (sample.weight * (0.2 + (softnessScale * 0.08))));
        const glow = backdropContext.createRadialGradient(
          renderWidth * sample.x,
          renderHeight * sample.y,
          0,
          renderWidth * sample.x,
          renderHeight * sample.y,
          radius,
        );
        glow.addColorStop(0, withHexAlpha(mixHexColors(sample.color, "#ffffff", 0.08), 0.22 + (sample.weight * 0.1)));
        glow.addColorStop(0.42, withHexAlpha(sample.color, 0.12 + (sample.weight * 0.04)));
        glow.addColorStop(1, "rgba(0, 0, 0, 0)");
        backdropContext.globalCompositeOperation = index % 2 === 0 ? "screen" : "soft-light";
        backdropContext.fillStyle = glow;
        backdropContext.fillRect(0, 0, renderWidth, renderHeight);
      });

      const diagonalWash = backdropContext.createLinearGradient(renderWidth * 0.12, 0, renderWidth, renderHeight);
      diagonalWash.addColorStop(0, withHexAlpha(mixHexColors(palette.glow, "#ffffff", 0.12), 0.1));
      diagonalWash.addColorStop(0.48, "rgba(255, 255, 255, 0)");
      diagonalWash.addColorStop(1, withHexAlpha(palette.base, 0.14));
      backdropContext.globalCompositeOperation = "soft-light";
      backdropContext.fillStyle = diagonalWash;
      backdropContext.fillRect(0, 0, renderWidth, renderHeight);
      backdropContext.globalCompositeOperation = "source-over";
    };

    const renderBackdropSnapshot = () => {
      drawBackdrop();
    };

    const drawSoftEllipse = (
      targetContext: CanvasRenderingContext2D,
      x: number,
      y: number,
      radiusX: number,
      radiusY: number,
      color: string,
      alpha: number,
      rotation: number,
      innerMix = 0.14,
    ) => {
      const edgeSoftness = 0.14 + (softnessScale * 0.3);
      const midSoftness = 0.44 + (softnessScale * 0.18);
      const outerSoftness = 0.72 + (softnessScale * 0.12);
      targetContext.save();
      targetContext.translate(x, y);
      targetContext.rotate(rotation);
      targetContext.scale(1, radiusY / Math.max(radiusX, 1));
      const gradient = targetContext.createRadialGradient(0, 0, 0, 0, 0, radiusX);
      gradient.addColorStop(0, withHexAlpha(mixHexColors(color, "#ffffff", innerMix), alpha));
      gradient.addColorStop(midSoftness, withHexAlpha(color, alpha * (0.62 + (softnessScale * 0.12))));
      gradient.addColorStop(outerSoftness, withHexAlpha(color, alpha * (0.12 + (softnessScale * 0.12))));
      gradient.addColorStop(Math.min(0.98, edgeSoftness + 0.72), withHexAlpha(color, alpha * 0.04));
      gradient.addColorStop(1, withHexAlpha(color, 0));
      targetContext.fillStyle = gradient;
      targetContext.beginPath();
      targetContext.arc(0, 0, radiusX, 0, Math.PI * 2);
      targetContext.fill();
      targetContext.restore();
    };

    const drawSoftBlob = (
      targetContext: CanvasRenderingContext2D,
      node: ReturnType<typeof resolveAnimatedNodes>[number],
      color: string,
      alphaScale: number,
      innerMix = 0.14,
    ) => {
      drawSoftEllipse(
        targetContext,
        node.x,
        node.y,
        node.radiusX,
        node.radiusY,
        color,
        node.alpha * alphaScale,
        node.rotation,
        innerMix,
      );

      node.lobes.forEach((lobe, index) => {
        const lobeAngle = node.rotation + lobe.angle + (Math.sin(node.phase + index) * 0.16);
        const offsetX = Math.cos(lobeAngle) * node.radiusX * lobe.distance;
        const offsetY = Math.sin(lobeAngle) * node.radiusY * lobe.distance;
        drawSoftEllipse(
          targetContext,
          node.x + offsetX,
          node.y + offsetY,
          node.radiusX * lobe.scaleX,
          node.radiusY * lobe.scaleY,
          color,
          node.alpha * alphaScale * lobe.alpha,
          node.rotation + lobe.rotationOffset,
          innerMix,
        );
      });
    };

    const resolveAnimatedNodes = (timeMs: number) =>
      flowNodes.map((node, index) => {
        const localTime = timeMs * 0.00028 * speedScale;
        const orbitPhase = node.phase + (index * 0.58);
        const animatedX =
          node.anchorX +
          (Math.sin((localTime * node.speed) + orbitPhase) * node.orbitX) +
          (Math.cos((localTime * (node.speed * 0.42)) + (orbitPhase * 0.74)) * node.orbitX * 0.44);
        const animatedY =
          node.anchorY +
          (Math.cos((localTime * (node.speed * 0.7)) + (orbitPhase * 1.08)) * node.orbitY) +
          (Math.sin((localTime * (node.speed * 0.36)) + (orbitPhase * 0.54)) * node.orbitY * 0.42);
        const pulse = Math.sin((localTime * (node.speed * 0.72)) + orbitPhase);
        const secondaryPulse = Math.cos((localTime * (node.speed * 0.46)) + (orbitPhase * 0.62));
        return {
          ...node,
          x: animatedX,
          y: animatedY,
          radiusX: node.radius * (1 + (pulse * (0.09 + (softnessScale * 0.06)))),
          radiusY: node.radius * node.stretch * (1 + (secondaryPulse * (0.08 + (softnessScale * 0.05)))),
          rotation: node.rotation + (pulse * 0.18),
        };
      });

    const drawFieldMask = (nodes: ReturnType<typeof resolveAnimatedNodes>) => {
      const fieldBlur =
        blurAmount <= 0
          ? 0
          : (blurAmount * (0.3 + (softnessScale * 0.52)) * precisionScale) + 1.2;
      fieldContext.clearRect(0, 0, renderWidth, renderHeight);
      fieldContext.save();
      fieldContext.filter = fieldBlur > 0 ? `blur(${fieldBlur.toFixed(1)}px)` : "none";
      fieldContext.globalCompositeOperation = "source-over";

      nodes.forEach((node) => {
        drawSoftBlob(fieldContext, node, "#ffffff", 1.08 + (node.weight * 0.12), 0);
      });

      fieldContext.restore();
    };

    const drawColorMesh = (nodes: ReturnType<typeof resolveAnimatedNodes>) => {
      meshContext.clearRect(0, 0, renderWidth, renderHeight);

      const baseGradient = meshContext.createLinearGradient(
        renderWidth * 0.06,
        renderHeight * 0.04,
        renderWidth * 0.94,
        renderHeight * 0.96,
      );
      const orderedSamples = [...samplePool].sort((left, right) => (left.x + left.y) - (right.x + right.y));
      orderedSamples.forEach((sample, index) => {
        const stop = orderedSamples.length === 1 ? 0 : index / (orderedSamples.length - 1);
        baseGradient.addColorStop(stop, mixHexColors(sample.color, palette.base, 0.08));
      });
      meshContext.fillStyle = baseGradient;
      meshContext.fillRect(0, 0, renderWidth, renderHeight);

      nodes.forEach((node, index) => {
        const radius = Math.max(node.radiusX, node.radiusY) * (1.82 + (node.weight * 0.26));
        const glow = meshContext.createRadialGradient(node.x, node.y, 0, node.x, node.y, radius);
        glow.addColorStop(0, withHexAlpha(mixHexColors(node.color, "#ffffff", 0.08), 0.42 + (node.weight * 0.08)));
        glow.addColorStop(0.3, withHexAlpha(node.color, 0.34 + (node.weight * 0.08)));
        glow.addColorStop(0.68, withHexAlpha(mixHexColors(node.color, palette.secondary, 0.3), 0.18));
        glow.addColorStop(1, "rgba(0, 0, 0, 0)");
        meshContext.globalCompositeOperation = index % 2 === 0 ? "screen" : "lighten";
        meshContext.fillStyle = glow;
        meshContext.fillRect(0, 0, renderWidth, renderHeight);
      });

      meshContext.globalCompositeOperation = "soft-light";
      const lightSheet = meshContext.createLinearGradient(
        renderWidth * 0.08,
        renderHeight * 0.12,
        renderWidth,
        renderHeight * 0.84,
      );
      lightSheet.addColorStop(0, withHexAlpha(mixHexColors(palette.glow, "#ffffff", 0.2), 0.2));
      lightSheet.addColorStop(0.52, "rgba(255, 255, 255, 0)");
      lightSheet.addColorStop(1, withHexAlpha(mixHexColors(palette.edge, palette.base, 0.42), 0.18));
      meshContext.fillStyle = lightSheet;
      meshContext.fillRect(0, 0, renderWidth, renderHeight);

      meshContext.globalCompositeOperation = "source-over";
    };

    const drawFluidLayers = (nodes: ReturnType<typeof resolveAnimatedNodes>) => {
      const baseBlur =
        blurAmount <= 0
          ? 0
          : (blurAmount * (0.5 + (softnessScale * 0.72)) * precisionScale) + 1.8;

      drawFieldMask(nodes);
      drawColorMesh(nodes);

      fieldContext.save();
      fieldContext.globalCompositeOperation = "source-in";
      fieldContext.drawImage(meshCanvas, 0, 0);
      fieldContext.restore();

      context.save();
      context.filter =
        baseBlur > 0
          ? `blur(${baseBlur.toFixed(1)}px) saturate(${(132 + (softnessScale * 22)).toFixed(0)}%)`
          : `saturate(${(132 + (softnessScale * 22)).toFixed(0)}%)`;
      context.globalCompositeOperation = "screen";
      context.globalAlpha = 0.96;
      context.drawImage(fieldCanvas, 0, 0, renderWidth, renderHeight);
      context.restore();

      context.save();
      context.filter =
        baseBlur > 0
          ? `blur(${(baseBlur * 0.52).toFixed(1)}px) saturate(${(148 + (softnessScale * 20)).toFixed(0)}%)`
          : `saturate(${(148 + (softnessScale * 20)).toFixed(0)}%)`;
      context.globalCompositeOperation = "lighter";
      context.globalAlpha = 0.3 + (softnessScale * 0.08);
      context.drawImage(fieldCanvas, 0, 0, renderWidth, renderHeight);
      context.restore();
    };

    const applyBlendingEffect = () => {
      context.save();

      context.globalCompositeOperation = "overlay";
      context.globalAlpha = 0.12;
      const balanceGradient = context.createLinearGradient(0, 0, renderWidth, renderHeight);
      colorPool.forEach((color, index) => {
        const stop = colorPool.length === 1 ? 0 : index / (colorPool.length - 1);
        balanceGradient.addColorStop(stop, color);
      });
      context.fillStyle = balanceGradient;
      context.fillRect(0, 0, renderWidth, renderHeight);

      context.globalCompositeOperation = "soft-light";
      context.globalAlpha = 0.16;
      const softGradient = context.createRadialGradient(
        renderWidth * 0.5,
        renderHeight * 0.5,
        0,
        renderWidth * 0.5,
        renderHeight * 0.5,
        Math.max(renderWidth, renderHeight) * 0.72,
      );
      softGradient.addColorStop(0, withHexAlpha(palette.base, 0.24));
      softGradient.addColorStop(0.5, withHexAlpha(palette.secondary, 0.16));
      softGradient.addColorStop(1, withHexAlpha(palette.glow, 0.08));
      context.fillStyle = softGradient;
      context.fillRect(0, 0, renderWidth, renderHeight);

      const finalGlowBlur =
        blurAmount <= 0
          ? 0
          : ((blurAmount * (0.18 + (softnessScale * 0.2)) * precisionScale) + 2.4);
      context.filter = finalGlowBlur > 0 ? `blur(${finalGlowBlur.toFixed(1)}px)` : "none";
      context.globalCompositeOperation = "screen";
      context.globalAlpha = 0.08;
      const finalGradient = context.createLinearGradient(renderWidth, 0, 0, renderHeight);
      finalGradient.addColorStop(0, withHexAlpha(palette.glow, 0.18));
      finalGradient.addColorStop(1, withHexAlpha(palette.base, 0.18));
      context.fillStyle = finalGradient;
      context.fillRect(0, 0, renderWidth, renderHeight);

      const causticBlur =
        blurAmount <= 0
          ? 0
          : ((blurAmount * (0.22 + (softnessScale * 0.18)) * precisionScale) + 2.8);
      context.filter = causticBlur > 0 ? `blur(${causticBlur.toFixed(1)}px)` : "none";
      context.globalCompositeOperation = "soft-light";
      context.globalAlpha = 0.12;
      const causticGradient = context.createRadialGradient(
        renderWidth * 0.5,
        renderHeight * 0.24,
        0,
        renderWidth * 0.5,
        renderHeight * 0.24,
        Math.max(renderWidth, renderHeight) * 0.76,
      );
      causticGradient.addColorStop(0, withHexAlpha(mixHexColors(palette.glow, "#ffffff", 0.14), 0.16));
      causticGradient.addColorStop(0.42, withHexAlpha(palette.secondary, 0.1));
      causticGradient.addColorStop(1, "rgba(0, 0, 0, 0)");
      context.fillStyle = causticGradient;
      context.fillRect(0, 0, renderWidth, renderHeight);

      context.restore();
    };

    const renderFrame = (timeMs: number) => {
      context.clearRect(0, 0, renderWidth, renderHeight);
      context.drawImage(backdropCanvas, 0, 0, renderWidth, renderHeight);
      const animatedNodes = resolveAnimatedNodes(timeMs);
      drawFluidLayers(animatedNodes);
      applyBlendingEffect();
    };

    const drawLoop = (timeMs: number) => {
      if (!isAnimated) {
        renderFrame(0);
        return;
      }

      if (timeMs - lastRenderTimeMs < targetFrameIntervalMs) {
        frameId = window.requestAnimationFrame(drawLoop);
        return;
      }

      lastRenderTimeMs = timeMs;
      renderFrame(timeMs);
      if (isActive && isAnimated) {
        frameId = window.requestAnimationFrame(drawLoop);
      }
    };

    const rerenderForResize = () => {
      resize();
      if (renderWidth && renderHeight) {
        renderBackdropSnapshot();
        renderFrame(isAnimated ? performance.now() : 0);
      }
    };

    const scheduleResize = () => {
      if (resizeFrameId) {
        return;
      }

      resizeFrameId = window.requestAnimationFrame(() => {
        resizeFrameId = 0;
        rerenderForResize();
      });
    };

    resize();
    renderBackdropSnapshot();
    const resizeTarget = canvas.parentElement ?? canvas;
    const resizeObserver = new ResizeObserver(() => {
      scheduleResize();
    });
    resizeObserver.observe(resizeTarget);
    window.addEventListener("resize", scheduleResize);

    if (renderWidth && renderHeight) {
      if (isActive && isAnimated) {
        lastRenderTimeMs = 0;
        frameId = window.requestAnimationFrame(drawLoop);
      } else {
        renderFrame(0);
      }
    }

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      if (resizeFrameId) {
        window.cancelAnimationFrame(resizeFrameId);
      }
      window.removeEventListener("resize", scheduleResize);
      resizeObserver.disconnect();
    };
  }, [
    appearanceSettings.immersiveBackgroundBlur,
    appearanceSettings.immersiveBackgroundAnimated,
    appearanceSettings.immersiveBackgroundResolution,
    appearanceSettings.immersiveBackgroundSpeed,
    appearanceSettings.immersiveBackgroundSoftness,
    isActive,
    palette.base,
    palette.edge,
    palette.glow,
    palette.secondary,
    sampleSignature,
  ]);

  return <canvas ref={canvasRef} className="immersive-player__fluid-canvas" />;
}

function ImmersivePillSlider({
  value,
  ariaLabel,
  className,
  isInteractive = true,
  onChange,
  onChangeStart,
  onChangeEnd,
}: {
  value: number;
  ariaLabel: string;
  className?: string;
  isInteractive?: boolean;
  onChange: (value: number) => void;
  onChangeStart?: () => void;
  onChangeEnd?: () => void;
}) {
  const [isSeeking, setIsSeeking] = useState(false);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const seekCompletionHandledRef = useRef(false);
  const displayedValue = dragValue ?? value;

  const finishSeek = () => {
    if (seekCompletionHandledRef.current) {
      return;
    }

    seekCompletionHandledRef.current = true;
    setIsSeeking(false);
    setDragValue(null);
    onChangeEnd?.();
  };

  const updateFromClientX = (clientX: number) => {
    const track = trackRef.current;
    if (!track) {
      return;
    }

    const rect = track.getBoundingClientRect();
    const nextValue = rect.width <= 0 ? 0 : ((clientX - rect.left) / rect.width) * 100;
    const clampedValue = Math.min(100, Math.max(0, nextValue));
    setDragValue(clampedValue);
    onChange(Number(clampedValue.toFixed(2)));
  };

  return (
    <div
      ref={trackRef}
      className={[
        "immersive-player__pill-slider",
        className ?? "",
        isSeeking ? "immersive-player__pill-slider--seeking" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(displayedValue)}
      aria-disabled={!isInteractive}
      tabIndex={isInteractive ? 0 : -1}
      onPointerDown={(event) => {
        if (!isInteractive) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        seekCompletionHandledRef.current = false;
        setIsSeeking(true);
        onChangeStart?.();
        updateFromClientX(event.clientX);
        const target = event.currentTarget;
        if (!target.hasPointerCapture?.(event.pointerId)) {
          target.setPointerCapture?.(event.pointerId);
        }
      }}
      onPointerMove={(event) => {
        if (!isInteractive || !isSeeking) {
          return;
        }
        updateFromClientX(event.clientX);
      }}
      onPointerUp={(event) => {
        if (!isInteractive) {
          return;
        }
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        finishSeek();
      }}
      onPointerCancel={(event) => {
        if (!isInteractive) {
          return;
        }
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        finishSeek();
      }}
      onKeyDown={(event) => {
        if (!isInteractive) {
          return;
        }
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
          return;
        }
        event.preventDefault();
        const delta = event.key === "ArrowRight" ? 2 : -2;
        onChange(Math.min(100, Math.max(0, value + delta)));
      }}
    >
      <span className="immersive-player__pill-slider-track" />
      <span className="immersive-player__pill-slider-fill" style={{ width: `${displayedValue}%` }} />
      <span className="immersive-player__pill-slider-thumb" style={{ left: `${displayedValue}%` }} />
    </div>
  );
}

function ImmersiveProgressTimeline({
  progress,
  elapsedLabel,
  totalLabel,
  isAutoMixTransitionActive,
  autoMixBadgePhase = "hidden",
  isInteractive = true,
  onSeekStart,
  onChange,
  onSeekEnd,
}: {
  progress: number;
  elapsedLabel: string;
  totalLabel: string;
  isAutoMixTransitionActive: boolean;
  autoMixBadgePhase?: "hidden" | "entering" | "visible" | "leaving";
  isInteractive?: boolean;
  onSeekStart: () => void;
  onChange: (value: number) => void;
  onSeekEnd: () => void;
}) {
  return (
    <div className="immersive-player__timeline">
      <ImmersivePillSlider
        ariaLabel={`${elapsedLabel} / ${totalLabel}`}
        value={progress}
        className={[
          "immersive-player__pill-slider--progress",
          isAutoMixTransitionActive ? "immersive-player__pill-slider--automix-active" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        isInteractive={isInteractive}
        onChangeStart={onSeekStart}
        onChange={onChange}
        onChangeEnd={onSeekEnd}
      />
      {isAutoMixTransitionActive ? (
        <>
          <span className="immersive-player__progress-shimmer" aria-hidden="true" />
          <div
            className={[
              "immersive-player__automix-hint",
              `immersive-player__automix-hint--${autoMixBadgePhase}`,
            ].join(" ")}
            aria-hidden="true"
          >
            <span className="immersive-player__automix-hint-glow immersive-player__automix-hint-glow--far">
              AutoMix
            </span>
            <span className="immersive-player__automix-hint-glow immersive-player__automix-hint-glow--near">
              AutoMix
            </span>
            <span className="immersive-player__automix-hint-core">AutoMix</span>
          </div>
        </>
      ) : null}
      <div className="immersive-player__timeline-meta">
        <span>{elapsedLabel}</span>
        <span>{totalLabel}</span>
      </div>
    </div>
  );
}

function ImmersiveVolumeSlider({
  value,
  ariaLabel,
  onChange,
}: {
  value: number;
  ariaLabel: string;
  onChange: (value: number) => void;
}) {
  return (
    <ImmersivePillSlider
      ariaLabel={ariaLabel}
      value={value}
      className="immersive-player__pill-slider--volume"
      onChange={onChange}
    />
  );
}

function PlaybarTimeline({
  progress,
  elapsedLabel,
  totalLabel,
  isAutoMixTransitionActive,
  lyricPreview,
  onSeekStart,
  onChange,
  onSeekEnd,
}: {
  progress: number;
  elapsedLabel: string;
  totalLabel: string;
  isAutoMixTransitionActive: boolean;
  lyricPreview: {
    enabled: boolean;
    durationSeconds: number;
    lines: NeteaseParsedLyricLine[];
    lyricsOffsetMs: number;
    delayMs: number;
  };
  onSeekStart: () => void;
  onChange: (value: number) => void;
  onSeekEnd: () => void;
}) {
  const [isSeeking, setIsSeeking] = useState(false);
  const [dragProgress, setDragProgress] = useState<number | null>(null);
  const [hoverPreview, setHoverPreview] = useState<{
    anchorPx: number;
    leftPx: number;
    lyricLine: string;
    lineProgress: number;
  } | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLSpanElement | null>(null);
  const seekCompletionHandledRef = useRef(false);
  const displayedProgress = dragProgress ?? progress;

  useEffect(() => {
    setHoverPreview(null);
  }, [lyricPreview.delayMs, lyricPreview.durationSeconds, lyricPreview.enabled, lyricPreview.lines]);

  const resolveHoverPreviewLeftPx = (anchorPx: number) => {
    const track = trackRef.current;

    if (!track) {
      return anchorPx;
    }

    const trackWidth = track.clientWidth;
    const safeInsetPx = 8;

    if (trackWidth <= 0) {
      return anchorPx;
    }

    const previewWidth = previewRef.current?.offsetWidth ?? 0;

    if (previewWidth <= 0) {
      return clampNumber(anchorPx, safeInsetPx, Math.max(safeInsetPx, trackWidth - safeInsetPx));
    }

    const halfPreviewWidth = previewWidth / 2;
    const minLeftPx = halfPreviewWidth + safeInsetPx;
    const maxLeftPx = Math.max(minLeftPx, trackWidth - halfPreviewWidth - safeInsetPx);
    return clampNumber(anchorPx, minLeftPx, maxLeftPx);
  };

  useLayoutEffect(() => {
    if (!hoverPreview) {
      return;
    }

    const nextLeftPx = resolveHoverPreviewLeftPx(hoverPreview.anchorPx);

    if (Math.abs(nextLeftPx - hoverPreview.leftPx) < 0.5) {
      return;
    }

    setHoverPreview((current) => {
      if (!current || current.anchorPx !== hoverPreview.anchorPx || current.lyricLine !== hoverPreview.lyricLine) {
        return current;
      }

      return {
        ...current,
        leftPx: nextLeftPx,
      };
    });
  }, [hoverPreview]);

  useEffect(() => {
    if (!hoverPreview) {
      return;
    }

    const handleResize = () => {
      setHoverPreview((current) => {
        if (!current) {
          return current;
        }

        const nextLeftPx = resolveHoverPreviewLeftPx(current.anchorPx);
        if (Math.abs(nextLeftPx - current.leftPx) < 0.5) {
          return current;
        }

        return {
          ...current,
          leftPx: nextLeftPx,
        };
      });
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [hoverPreview]);

  const finishSeek = () => {
    if (seekCompletionHandledRef.current) {
      return;
    }

    seekCompletionHandledRef.current = true;
    setIsSeeking(false);
    setDragProgress(null);
    onSeekEnd();
  };

  const updateHoverPreviewFromClientX = (clientX: number) => {
    const track = trackRef.current;

    if (
      !track ||
      !lyricPreview.enabled ||
      lyricPreview.durationSeconds <= 0 ||
      lyricPreview.lines.length === 0
    ) {
      setHoverPreview(null);
      return;
    }

    const rect = track.getBoundingClientRect();
    const clampedRatio = rect.width <= 0 ? 0 : Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const previewAudioTimeMs = clampedRatio * lyricPreview.durationSeconds * 1000;
    const previewLyricsTimeMs = resolveLyricsTimelineTimeMs({
      audioTimeMs: previewAudioTimeMs,
      lyricsOffsetMs: lyricPreview.lyricsOffsetMs,
      delayMs: lyricPreview.delayMs,
    });
    const previewLyric = resolveProgressHoverLyricPreview(lyricPreview.lines, previewLyricsTimeMs);

    if (!previewLyric) {
      setHoverPreview(null);
      return;
    }

    const anchorPx = clampNumber(clientX - rect.left, 0, rect.width);
    const nextLeftPx = resolveHoverPreviewLeftPx(anchorPx);

    setHoverPreview({
      anchorPx,
      leftPx: nextLeftPx,
      lyricLine: previewLyric.lyricLine,
      lineProgress: previewLyric.lineProgress,
    });
  };

  const updateFromClientX = (clientX: number) => {
    const track = trackRef.current;

    if (!track) {
      return;
    }

    const rect = track.getBoundingClientRect();
    const nextProgress = rect.width <= 0 ? 0 : ((clientX - rect.left) / rect.width) * 100;
    const clampedProgress = Math.min(100, Math.max(0, nextProgress));
    setDragProgress(clampedProgress);
    onChange(Number(clampedProgress.toFixed(2)));
  };

  return (
    <div className="playbar__timeline">
      <div
        ref={trackRef}
        className={[
          "playbar__progress",
          isAutoMixTransitionActive ? "playbar__progress--automix-active" : "",
          isSeeking ? "playbar__progress--seeking" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onPointerDown={(event) => {
          event.preventDefault();
          seekCompletionHandledRef.current = false;
          event.currentTarget.setPointerCapture(event.pointerId);
          setIsSeeking(true);
          onSeekStart();
          updateHoverPreviewFromClientX(event.clientX);
          updateFromClientX(event.clientX);
        }}
        onPointerEnter={(event) => {
          updateHoverPreviewFromClientX(event.clientX);
        }}
        onPointerMove={(event) => {
          updateHoverPreviewFromClientX(event.clientX);

          if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
            return;
          }

          updateFromClientX(event.clientX);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }

          updateHoverPreviewFromClientX(event.clientX);
          finishSeek();
        }}
        onPointerCancel={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }

          setHoverPreview(null);
          finishSeek();
        }}
        onPointerLeave={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            return;
          }

          setHoverPreview(null);
        }}
        onLostPointerCapture={finishSeek}
      >
        {hoverPreview ? (
          <span
            ref={previewRef}
            className="playbar__progress-preview"
            style={{ left: `${hoverPreview.leftPx}px` }}
          >
            <strong>{hoverPreview.lyricLine}</strong>
            <span className="playbar__progress-preview-line-progress" aria-hidden="true">
              <span
                className="playbar__progress-preview-line-progress-fill"
                style={{ width: `${Math.round(hoverPreview.lineProgress * 100)}%` }}
              />
            </span>
          </span>
        ) : null}
        {isAutoMixTransitionActive ? (
          <span className="playbar__progress-shimmer" aria-hidden="true" />
        ) : null}
        <span className="playbar__progress-fill" style={{ width: `${displayedProgress}%` }} />
        <span className="playbar__progress-thumb" style={{ left: `${displayedProgress}%` }} />
      </div>
      <div className="playbar__time">
        <span>{elapsedLabel}</span>
        <span>/</span>
        <span>{totalLabel}</span>
      </div>
    </div>
  );
}

export function formatTimeLabel(totalSeconds: number) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDurationLabelForComponentIsland(durationMs: number | null) {
  if (durationMs === null || durationMs <= 0) {
    return "--:--";
  }

  return formatTimeLabel(Math.round(durationMs / 1000));
}

function formatDurationMs(durationMs: number | null) {
  if (durationMs === null || durationMs <= 0) {
    return "--:--";
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function inferMimeType(type: string | null) {
  switch ((type ?? "").toLowerCase()) {
    case "mp3":
      return "audio/mpeg";
    case "flac":
      return "audio/flac";
    case "m4a":
      return "audio/mp4";
    case "aac":
      return "audio/aac";
    case "ogg":
      return "audio/ogg";
    case "opus":
      return "audio/opus";
    case "wav":
      return "audio/wav";
    default:
      return type ? `audio/${type.toLowerCase()}` : null;
  }
}

function resolveTrackPlaybackCandidates(
  track: TrackRecord,
  settings: AppSettings,
  cachedLocalPath?: string | null,
) {
  const candidates: string[] = [];
  const resolveLocalPlaybackUrl = (value: string) => {
    const trimmedValue = value.trim();
    const normalizedPath = trimmedValue.replace(/\\/g, "/");
    return convertFileSrc(normalizedPath);
  };
  const pushCandidate = (value: string | null | undefined, options?: { file?: boolean }) => {
    if (!value) {
      return;
    }

    const normalizedValue =
      options?.file === true || !/^https?:\/\//i.test(value)
        ? resolveLocalPlaybackUrl(value)
        : value;

    if (!candidates.includes(normalizedValue)) {
      candidates.push(normalizedValue);
    }
  };
  const hasRemoteHeaders =
    track.source.kind === "remoteStream" && Object.keys(track.source.headers ?? {}).length > 0;
  const remoteCandidates = [
    track.source.kind === "remoteStream" && !hasRemoteHeaders ? track.source.url : null,
    track.playback.primaryUri,
    ...(track.playback.fallbackUris ?? []),
  ];
  const localFallbackCandidate =
    track.playback.fallbackUri && !/^https?:\/\//i.test(track.playback.fallbackUri)
      ? track.playback.fallbackUri
      : null;
  const remoteFallbackCandidate =
    track.playback.fallbackUri && /^https?:\/\//i.test(track.playback.fallbackUri)
      ? track.playback.fallbackUri
      : null;

  pushCandidate(cachedLocalPath, { file: true });

  if (track.source.kind === "localFile") {
    pushCandidate(track.source.path, { file: true });
  }

  if (track.playback.mode === "localFile") {
    pushCandidate(track.playback.primaryUri, { file: true });
    return candidates;
  }

  if (track.playback.mode === "hybrid" && !settings.playback.preferRemoteStreaming) {
    pushCandidate(localFallbackCandidate, { file: true });
  }

  remoteCandidates.forEach((candidate) => {
    pushCandidate(candidate, { file: false });
  });
  pushCandidate(remoteFallbackCandidate, { file: false });

  if (track.playback.mode === "hybrid" && settings.playback.preferRemoteStreaming) {
    pushCandidate(localFallbackCandidate, { file: true });
  }

  return candidates;
}

function buildShuffledQueue(queueIds: string[], currentTrackId: string | null) {
  const deduplicated = Array.from(new Set(queueIds));
  const remainingIds = deduplicated.filter((id) => id !== currentTrackId);

  for (let index = remainingIds.length - 1; index > 0; index -= 1) {
    const targetIndex = Math.floor(Math.random() * (index + 1));
    [remainingIds[index], remainingIds[targetIndex]] = [remainingIds[targetIndex], remainingIds[index]];
  }

  if (currentTrackId && deduplicated.includes(currentTrackId)) {
    return [currentTrackId, ...remainingIds];
  }

  return remainingIds;
}

function getNextPlaybackMode(currentMode: PlaybackModeOption): PlaybackModeOption {
  const playbackModes: PlaybackModeOption[] = [
    "ordered",
    "repeat-all",
    "repeat-one",
    "shuffle",
  ];
  const currentIndex = playbackModes.indexOf(currentMode);
  return playbackModes[(currentIndex + 1) % playbackModes.length];
}

function playbackModeLabel(mode: PlaybackModeOption, locale = "zh-CN") {
  switch (mode) {
    case "ordered":
      return locale === "en-US" ? "Ordered Playback" : "顺序播放";
    case "repeat-all":
      return locale === "en-US" ? "Repeat All" : "列表循环";
    case "repeat-one":
      return locale === "en-US" ? "Repeat One" : "单曲循环";
    case "shuffle":
      return locale === "en-US" ? "Shuffle" : "随机播放";
    default:
      return locale === "en-US" ? "Ordered Playback" : "顺序播放";
  }
}

function resolveTrackArtworkUrl(
  track: TrackRecord,
  artworksById: Map<string, ArtworkRecord>,
) {
  const candidateIds = [
    track.config.preferredArtworkId,
    ...track.artworkIds,
  ].filter((id): id is string => typeof id === "string" && id.length > 0);

  for (const artworkId of candidateIds) {
    const artwork = artworksById.get(artworkId);

    if (!artwork) {
      continue;
    }

    if (artwork.source.kind === "remoteUrl") {
      return normalizeArtworkUrl(artwork.source.url);
    }

    return convertFileSrc(artwork.source.path);
  }

  return null;
}

function normalizeArtworkUrl(url: string) {
  if (/^http:\/\/p\d+\.music\.126\.net\//i.test(url)) {
    return url.replace(/^http:\/\//i, "https://");
  }

  return url;
}

function formatClockTime(date: Date, locale = "zh-CN") {
  return date.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDetailedClockTime(date: Date, locale = "zh-CN") {
  return date.toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatDynamicIslandPrimaryLabel(
  date: Date,
  content: AppSettings["appearance"]["dynamicIslandDefaultContent"],
  locale = "zh-CN",
) {
  switch (content) {
    case "date":
      return date.toLocaleDateString(locale, {
        month: "2-digit",
        day: "2-digit",
      });
    case "datetime":
      return date.toLocaleString(locale, {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    case "time":
    default:
      return formatClockTime(date, locale);
  }
}

function formatDynamicIslandDetailedLabel(
  date: Date,
  content: AppSettings["appearance"]["dynamicIslandDefaultContent"],
  locale = "zh-CN",
) {
  switch (content) {
    case "date":
      return date.toLocaleDateString(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "short",
      });
    case "datetime":
      return date.toLocaleString(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    case "time":
    default:
      return formatDetailedClockTime(date, locale);
  }
}

function PlayPauseAnimatedIcon({ isPlaying }: { isPlaying: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={[
        "playbar-icon",
        "playbar-icon--play-pause",
        isPlaying ? "is-playing" : "is-paused",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <path className="playbar-icon__play" d="M5.5 4.5l6 3.5-6 3.5z" />
      <path className="playbar-icon__pause-left" d="M5.75 4.75v6.5" />
      <path className="playbar-icon__pause-right" d="M10.25 4.75v6.5" />
    </svg>
  );
}

function PreviousSmallIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5.5 8l6-4.5v9z" />
      <path d="M4 4v8" />
    </svg>
  );
}

function NextSmallIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10.5 8l-6-4.5v9z" />
      <path d="M12 4v8" />
    </svg>
  );
}

function QueueSmallIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4.5h7" />
      <path d="M3 8h7" />
      <path d="M3 11.5h5" />
      <path d="M11.5 10v3" />
      <path d="M10 11.5h3" />
    </svg>
  );
}

function HomeFmArrowIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className}>
      <path d="M9.25 3.75L13 8l-3.75 4.25" />
      <path d="M12.5 8H3.5" />
    </svg>
  );
}

function HomeFmRefreshIcon({
  spinning = false,
  className,
}: {
  spinning?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={[
        className,
        "home-fm-cta__refresh-icon",
        spinning ? "home-fm-cta__refresh-icon--spinning" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <path d="M12.5 6A4.75 4.75 0 1 0 13 8" />
      <path d="M10.75 3.75H13.5V6.5" />
    </svg>
  );
}

function QueueOpenPlaylistIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 4.5h4.75" />
      <path d="M4 8h4.75" />
      <path d="M4 11.5h6.5" />
      <path d="M8.75 3.75h3.5v3.5" />
      <path d="M12.25 3.75L7.5 8.5" />
    </svg>
  );
}

function ContextMenuChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 3.75L10 8l-4 4.25" />
    </svg>
  );
}

function QueueMoveUpIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 4.25l-2.5 2.5" />
      <path d="M8 4.25l2.5 2.5" />
      <path d="M8 4.5v7" />
    </svg>
  );
}

function QueueMoveDownIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 11.75l-2.5-2.5" />
      <path d="M8 11.75l2.5-2.5" />
      <path d="M8 4.5v7" />
    </svg>
  );
}

function QueueRemoveIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 5l6 6" />
      <path d="M11 5l-6 6" />
    </svg>
  );
}

function PlaybackModeIcon({ mode }: { mode: PlaybackModeOption }) {
  if (mode === "shuffle") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 4.5h1.5c1.2 0 2 .35 2.75 1.2l4.5 5.1c.42.47.9.7 1.75.7H13" />
        <path d="M11 3.5h2v2" />
        <path d="M13 3.5l-2.25 2.25" />
        <path d="M3 11.5h1.5c1.16 0 1.92-.3 2.65-1.02l1.4-1.38" />
      </svg>
    );
  }

  if (mode === "ordered") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 4.5h6.5" />
        <path d="M3 8h5" />
        <path d="M3 11.5h3.5" />
        <path d="M11 4.5v5.75" />
        <path d="M9.5 8.75L11 10.25l1.5-1.5" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4.5h7.5" />
      <path d="M11.5 3l1.5 1.5-1.5 1.5" />
      <path d="M13 11.5H5.5" />
      <path d="M4.5 10L3 11.5 4.5 13" />
      {mode === "repeat-one" ? (
        <path d="M7.9 6.2v3.6" />
      ) : null}
      {mode === "repeat-one" ? (
        <path d="M7.1 7h.8V6.2h-.6" />
      ) : null}
    </svg>
  );
}

function ImportTileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v10" />
      <path d="M8.5 10.5L12 14l3.5-3.5" />
      <path d="M5 18h14" />
    </svg>
  );
}

function SongsTileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 6.5v9.5" />
      <path d="M9 6.5l8-1.5v8.5" />
      <path d="M9 16.5a2.5 2.5 0 11-2.5-2.5A2.5 2.5 0 019 16.5z" />
      <path d="M17 15a2.5 2.5 0 11-2.5-2.5A2.5 2.5 0 0117 15z" />
    </svg>
  );
}

function OpenImmersiveHintIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4.75H4.75V8" />
      <path d="M16 4.75h3.25V8" />
      <path d="M19.25 16V19.25H16" />
      <path d="M8 19.25H4.75V16" />
      <path d="M9.2 9.2l5.6 5.6" />
      <path d="M10.2 14.8h4.6v-4.6" />
    </svg>
  );
}

function ArtistsTileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.5 10a2.5 2.5 0 110-5 2.5 2.5 0 010 5z" />
      <path d="M15.5 11.5a2 2 0 110-4 2 2 0 010 4z" />
      <path d="M4.5 18a4 4 0 018 0" />
      <path d="M12.5 18a3.2 3.2 0 016 0" />
    </svg>
  );
}

function AlbumsTileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="3" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 8.8v0.01" />
    </svg>
  );
}

function VolumeAnimatedIcon({ volume }: { volume: number }) {
  const level =
    volume <= 0 ? "mute" : volume < 34 ? "low" : volume < 67 ? "medium" : "high";

  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={["playbar-icon", "playbar-icon--volume", `is-${level}`].join(" ")}
    >
      <path className="playbar-icon__speaker" d="M3 6.5h2.5L8.5 4v8L5.5 9.5H3z" />
      <path className="playbar-icon__wave playbar-icon__wave--1" d="M10 6.75a2 2 0 010 2.5" />
      <path className="playbar-icon__wave playbar-icon__wave--2" d="M11.25 5.75a3.5 3.5 0 010 4.5" />
      <path className="playbar-icon__wave playbar-icon__wave--3" d="M12.5 4.75a5 5 0 010 6" />
      <path className="playbar-icon__mute" d="M10.25 5.25l3.25 5.5" />
    </svg>
  );
}

function IntelligenceModeHeart() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54z" />
    </svg>
  );
}

function IntelligenceModeButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className="playlist-intelligence-button"
      type="button"
      onClick={onClick}
      disabled={disabled}
    >
      <span className="playlist-intelligence-button__label">{label}</span>
      <span className="playlist-intelligence-button__star playlist-intelligence-button__star--1">
        <IntelligenceModeHeart />
      </span>
      <span className="playlist-intelligence-button__star playlist-intelligence-button__star--2">
        <IntelligenceModeHeart />
      </span>
      <span className="playlist-intelligence-button__star playlist-intelligence-button__star--3">
        <IntelligenceModeHeart />
      </span>
      <span className="playlist-intelligence-button__star playlist-intelligence-button__star--4">
        <IntelligenceModeHeart />
      </span>
      <span className="playlist-intelligence-button__star playlist-intelligence-button__star--5">
        <IntelligenceModeHeart />
      </span>
      <span className="playlist-intelligence-button__star playlist-intelligence-button__star--6">
        <IntelligenceModeHeart />
      </span>
    </button>
  );
}
