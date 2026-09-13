import type { AppSettings } from "../settings/types";

/**
 * 在线状态层（单一事实来源）
 * ---------------------------------------------------------------------------
 * 应用此前把"在线状态"散落在三层里各自判断：
 *   1. 源开关   settings.network.enabledSources（UI 实为单选）
 *   2. 凭据     neteaseCookie / kugouCookie
 *   3. 运行期   local API 就绪状态、各屏局部 state
 * 于是导航用"网易云 cookie"、工作区用"是否启用酷狗"、请求层只认"源开关"，
 * 三套判据互相独立，同一个状态在不同位置含义不同。
 *
 * 本模块把三层收敛成一个 OnlineSession，并给出三个纯函数：
 *   - resolveVisibleNavIds / resolveNavFallback：显示层判定
 *   - resolveWorkspaceTemplate：分支（离线 / 网易云 / 酷狗）-> 模板
 * 页面显示元素只允许通过 resolveWorkspaceTemplate 的结果来分支；各屏组件
 * 内部不得再从 settings 自行推导在线状态，应使用传入的 session。
 *
 * 本文件不得引入任何运行时依赖（仅允许 type import），以便被 Node 直接执行校验。
 */

export const onlineSourceIds = ["netease", "kugou"] as const;

export type OnlineSourceId = (typeof onlineSourceIds)[number];

/** 在线分支：完全离线 / 网易云在线 / 酷狗在线 */
export type OnlineMode = OnlineSourceId | "offline";

/**
 * 多源同时开启时的优先级。UI 目前是单选（enabledSources 至多一项），
 * 这里给出确定性顺序，与 Rust 侧本地 API 的 netease 优先保持一致。
 */
export const onlineSourcePriority: readonly OnlineSourceId[] = ["netease", "kugou"];

export const navItemIds = [
  "home",
  "explore",
  "favorites",
  "playlist",
  "library",
  "tools",
  "settings",
] as const;

export type NavId = (typeof navItemIds)[number];

/** 导航项对在线状态的要求 */
export type NavOnlineRequirement = "never" | "online" | "authenticated";

export const navOnlineRequirement: Record<NavId, NavOnlineRequirement> = {
  home: "never",
  explore: "online",
  favorites: "authenticated",
  playlist: "authenticated",
  library: "never",
  tools: "never",
  settings: "never",
};

export type OnlineSourceSession = {
  id: OnlineSourceId;
  /** 该源是否在 settings 中被启用（UI 最多一项） */
  enabled: boolean;
  /** 该源是否为当前在线分支 */
  active: boolean;
  cookie: string;
  /** 凭据是否可用（cookie 非空，与旧代码 cookie.trim().length > 0 语义一致） */
  authenticated: boolean;
  apiBaseUrl: string;
  useLocalApiServer: boolean;
};

export type OnlineSession = {
  mode: OnlineMode;
  /** 当前在线分支对应的源；离线下为 null */
  source: OnlineSourceId | null;
  /** settings 中启用的源（已归一化、按优先级排序） */
  enabledSources: OnlineSourceId[];
  /** 是否存在在线分支 */
  online: boolean;
  /** 当前分支的凭据是否可用 */
  authenticated: boolean;
  sources: Record<OnlineSourceId, OnlineSourceSession>;
};

/**
 * 工作区模板：显示层的唯一分支依据。
 * "判定分支（离线 / 网易云 / 酷狗）"发生在 resolveWorkspaceTemplate 内部，
 * 渲染层只做 template id -> 组件的映射。
 */
export type WorkspaceTemplate =
  | { id: "offline-home" }
  | { id: "netease-home" }
  | { id: "netease-explore" }
  | { id: "netease-playlist" }
  | { id: "netease-favorites" }
  | { id: "kugou-home" }
  | { id: "kugou-explore" }
  | { id: "kugou-explore-detail" }
  | { id: "kugou-playlist" }
  | { id: "kugou-favorites" }
  | { id: "library" }
  | { id: "tools" }
  | { id: "settings" }
  | { id: "placeholder"; nav: NavId };

export function isOnlineSourceId(value: string): value is OnlineSourceId {
  return (onlineSourceIds as readonly string[]).includes(
    value.trim().toLowerCase(),
  );
}

/** 归一化 settings 中的源列表：去空白、去重、只保留已知源、按优先级排序 */
export function normalizeEnabledSources(
  values: readonly string[] | null | undefined,
): OnlineSourceId[] {
  const normalized = (values ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is OnlineSourceId => isOnlineSourceId(value));

  return onlineSourcePriority.filter((source) => normalized.includes(source));
}

function buildSourceSession(
  id: OnlineSourceId,
  settings: AppSettings,
  enabledSources: OnlineSourceId[],
  activeSource: OnlineSourceId | null,
): OnlineSourceSession {
  const isNetease = id === "netease";
  const cookie = (
    isNetease ? settings.network.neteaseCookie : settings.network.kugouCookie
  ).trim();

  return {
    id,
    enabled: enabledSources.includes(id),
    active: activeSource === id,
    cookie,
    authenticated: cookie.length > 0,
    apiBaseUrl: (
      isNetease
        ? settings.network.neteaseApiBaseUrl
        : settings.network.kugouApiBaseUrl
    ).trim(),
    useLocalApiServer: isNetease
      ? settings.network.useLocalApiServer
      : settings.network.useLocalKugouApiServer,
  };
}

/** 由 settings 派生在线状态（唯一的推导入口） */
export function resolveOnlineSession(settings: AppSettings): OnlineSession {
  const enabledSources = normalizeEnabledSources(settings.network.enabledSources);
  const source = enabledSources[0] ?? null;
  const sources: Record<OnlineSourceId, OnlineSourceSession> = {
    netease: buildSourceSession("netease", settings, enabledSources, source),
    kugou: buildSourceSession("kugou", settings, enabledSources, source),
  };

  return {
    mode: source ?? "offline",
    source,
    enabledSources,
    online: source !== null,
    authenticated: source ? sources[source].authenticated : false,
    sources,
  };
}

export function resolveOnlineMode(settings: AppSettings): OnlineMode {
  return resolveOnlineSession(settings).mode;
}

export function isNavAvailable(session: OnlineSession, nav: NavId): boolean {
  switch (navOnlineRequirement[nav]) {
    case "online":
      return session.online;
    case "authenticated":
      return session.online && session.authenticated;
    default:
      return true;
  }
}

/** 当前分支下可见的导航项 */
export function resolveVisibleNavIds(session: OnlineSession): NavId[] {
  return navItemIds.filter((nav) => isNavAvailable(session, nav));
}

/**
 * 当前 activeNav 在当前分支下不可用时，应回落到哪个导航项；可用则返回 null。
 */
export function resolveNavFallback(
  session: OnlineSession,
  activeNav: NavId,
): NavId | null {
  return isNavAvailable(session, activeNav) ? null : "home";
}

/** 判定分支 -> 模板 */
export function resolveWorkspaceTemplate(input: {
  session: OnlineSession;
  nav: NavId;
  hasKugouCatalogDetail: boolean;
}): WorkspaceTemplate {
  const { session, nav, hasKugouCatalogDetail } = input;

  switch (nav) {
    case "home":
      if (session.mode === "offline") {
        return { id: "offline-home" };
      }
      return session.mode === "kugou"
        ? { id: "kugou-home" }
        : { id: "netease-home" };
    case "explore":
      if (session.mode === "kugou") {
        return hasKugouCatalogDetail
          ? { id: "kugou-explore-detail" }
          : { id: "kugou-explore" };
      }
      if (session.mode === "netease") {
        return { id: "netease-explore" };
      }
      return { id: "placeholder", nav };
    case "playlist":
      if (session.mode === "kugou") {
        return { id: "kugou-playlist" };
      }
      if (session.mode === "netease") {
        return { id: "netease-playlist" };
      }
      return { id: "placeholder", nav };
    case "favorites":
      if (session.mode === "kugou") {
        return { id: "kugou-favorites" };
      }
      if (session.mode === "netease") {
        return { id: "netease-favorites" };
      }
      return { id: "placeholder", nav };
    case "library":
      return { id: "library" };
    case "tools":
      return { id: "tools" };
    case "settings":
      return { id: "settings" };
    default:
      return { id: "placeholder", nav };
  }
}

/** 供日志/诊断使用的紧凑摘要 */
export function describeOnlineSession(session: OnlineSession) {
  return {
    mode: session.mode,
    enabledSources: session.enabledSources,
    authenticated: session.authenticated,
    neteaseAuthenticated: session.sources.netease.authenticated,
    kugouAuthenticated: session.sources.kugou.authenticated,
    visibleNav: resolveVisibleNavIds(session),
  };
}
