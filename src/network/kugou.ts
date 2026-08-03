import { registerRemoteTrack } from "../media/library";
import type { RemoteTrackDraft, TrackRecord } from "../media/types";
import type { AppSettings } from "../settings/types";
import { parseRawLyrics } from "./netease";
import {
  kugouAlbumSongItems,
  kugouArtistAlbumItems,
  kugouArtistDetailRecord,
  kugouArtistSongItems,
  kugouAlbumDetailRecord,
  kugouKrmAudioRecord,
  kugouPage,
  kugouPlaylistDetailItems,
  kugouPlaylistItems,
  kugouRecommendationSongItems,
  kugouResponseData,
  kugouSearchItems,
  kugouTopPlaylistItems,
  kugouTotal,
  kugouUserPlaylistItems,
  mapKugouAlbum,
  mapKugouAlbumDetail,
  mapKugouArtist,
  mapKugouArtistDetail,
  mapKugouPlaylist,
  mapKugouSearchSong,
  mapKugouSong,
  mapKugouArtistSong,
} from "./kugou-schema";
import type {
  KugouAccountProfile,
  KugouAlbumDetail,
  KugouAlbumSummary,
  KugouArtistDetail,
  KugouArtistSummary,
  KugouPagedResult,
  KugouPlaylistSummary,
  KugouQrLoginSession,
  KugouQrLoginStatus,
  KugouResolvedTrack,
  KugouSongDetail,
  KugouSongLyrics,
  KugouSongSearchResult,
  KugouSongStream,
} from "./types";

const KUGOU_SOURCE_ID = "kugou";
const DEFAULT_KUGOU_BASE_URL = "http://127.0.0.1:3001";
const KUGOU_TRACK_CACHE_KEY_PREFIX = "kugou:track:";
const KUGOU_RESOLVED_TRACK_CACHE_TTL_MS = 5 * 60 * 1000;

type KugouSearchOptions = {
  limit?: number;
  offset?: number;
};

type KugouTrackReference = Pick<
  KugouSongDetail,
  "hash" | "albumAudioId" | "albumId"
>;
type TimedCacheEntry<T> = { value: T; expiresAt: number };

const resolvedTrackCache = new Map<
  string,
  TimedCacheEntry<KugouResolvedTrack>
>();
const resolvedTrackInflight = new Map<string, Promise<KugouResolvedTrack>>();
const userPlaylistCache = new Map<
  string,
  TimedCacheEntry<KugouPlaylistSummary[]>
>();
const playlistTracksCache = new Map<
  string,
  TimedCacheEntry<KugouSongDetail[]>
>();
const playlistDetailCache = new Map<
  string,
  TimedCacheEntry<KugouPlaylistSummary | null>
>();
const accountProfileCache = new Map<
  string,
  TimedCacheEntry<KugouAccountProfile | null>
>();
const artistDetailCache = new Map<
  string,
  TimedCacheEntry<KugouArtistDetail | null>
>();
const artistSongsPageCache = new Map<
  string,
  TimedCacheEntry<KugouPagedResult<KugouSongDetail>>
>();
const artistAlbumsPageCache = new Map<
  string,
  TimedCacheEntry<KugouPagedResult<KugouAlbumSummary>>
>();
const albumDetailCache = new Map<
  string,
  TimedCacheEntry<KugouAlbumDetail | null>
>();
const albumSongsPageCache = new Map<
  string,
  TimedCacheEntry<KugouPagedResult<KugouSongDetail>>
>();
const trackDetailsByHash = new Map<string, KugouSongDetail>();
let localKugouApiRuntimeBaseUrl: string | null = null;

export function setLocalKugouApiRuntimeBaseUrl(baseUrl: string | null) {
  localKugouApiRuntimeBaseUrl = baseUrl?.trim().replace(/\/+$/, "") || null;
}

export function isKugouSourceEnabled(settings: AppSettings) {
  return settings.network.enabledSources.some(
    (source) => source.trim().toLowerCase() === KUGOU_SOURCE_ID,
  );
}

export function clearKugouMemoryCaches() {
  const summary = {
    resolvedTrackCacheEntries: resolvedTrackCache.size,
    inflightTrackRequests: resolvedTrackInflight.size,
  };
  resolvedTrackCache.clear();
  resolvedTrackInflight.clear();
  userPlaylistCache.clear();
  playlistTracksCache.clear();
  playlistDetailCache.clear();
  accountProfileCache.clear();
  artistDetailCache.clear();
  artistSongsPageCache.clear();
  artistAlbumsPageCache.clear();
  albumDetailCache.clear();
  albumSongsPageCache.clear();
  trackDetailsByHash.clear();
  return summary;
}

export async function testKugouApiConnection(settings: AppSettings) {
  assertKugouEnabled(settings);
  const response = await requestKugouJson(
    settings,
    "/search",
    {
      keywords: "music",
      type: "song",
      page: 1,
      pagesize: 1,
    },
    { includeCookie: false },
  );
  const data = getPayloadData(response);
  return {
    baseUrl: getKugouBaseUrl(settings),
    keyword: firstString(data, [
      "keyword",
      "show_keyword",
      "search_word",
      "word",
    ]),
  };
}

export async function registerKugouDevice(
  settings: AppSettings,
  cookie = settings.network.kugouCookie,
): Promise<string> {
  return (await registerKugouDeviceSession(settings, cookie)).dfid;
}

async function registerKugouDeviceSession(
  settings: AppSettings,
  cookie: string,
) {
  assertKugouEnabled(settings);
  const response = await requestKugouJson(
    settings,
    "/register/dev",
    {},
    { method: "GET", cookie },
  );
  const data = getPayloadData(response);
  const nextCookie = mergeKugouSessionCookie(cookie, response);
  const dfid =
    getKugouCookieValue(nextCookie, "dfid") ??
    firstString(data, ["dfid", "DFID"]);
  if (!dfid) {
    throw new Error("KuGouMusicApi did not return a device dfid.");
  }
  return { dfid, cookie: mergeKugouLoginCookie(nextCookie, { dfid }) };
}

export function mergeKugouLoginCookie(
  current: string,
  updates: Record<string, string | null | undefined>,
) {
  return mergeKugouCookie(current, updates);
}

export async function createKugouQrLoginSession(
  settings: AppSettings,
): Promise<KugouQrLoginSession> {
  assertKugouEnabled(settings);
  const keyResponse = await requestKugouJson(
    settings,
    "/login/qr/key",
    { timestamp: Date.now() },
    { includeCookie: false },
  );
  const keyData = getPayloadData(keyResponse);
  const key = firstString(keyData, ["qrcode", "key", "qr_key", "qrcode_key"]);
  if (!key) {
    throw new Error("KuGouMusicApi did not return a QR login key.");
  }

  const qrResponse = await requestKugouJson(
    settings,
    "/login/qr/create",
    { key, qrimg: "true", timestamp: Date.now() },
    { includeCookie: false },
  );
  const qrData = getPayloadData(qrResponse);
  const qrUrl = firstString(qrData, ["url", "qrurl", "qr_url"]);
  if (!qrUrl) {
    throw new Error("KuGouMusicApi did not return QR login content.");
  }

  return {
    key,
    qrUrl,
    qrImage: normalizeQrImage(
      firstString(qrData, ["base64", "qrimg", "qr_image"]),
    ),
  };
}

export async function checkKugouQrLoginStatus(
  settings: AppSettings,
  key: string,
): Promise<KugouQrLoginStatus> {
  assertKugouEnabled(settings);
  const response = await requestKugouJson(
    settings,
    "/login/qr/check",
    { key, qrcode: key, timestamp: Date.now() },
    { includeCookie: false },
  );
  const data = getPayloadData(response);
  const status = findKugouQrStatus([data, response]);
  const hasToken = Boolean(findKugouSessionString([data, response], ["token"]));
  const code =
    status === 0 || status === 1 || status === 2 || status === 3 || status === 4
      ? status
      : hasToken
        ? 4
        : null;
  const cookie =
    code === 4
      ? mergeKugouSessionCookie(settings.network.kugouCookie, response)
      : null;

  return {
    code,
    message: findKugouSessionString(
      [data, response],
      ["msg", "message", "error_msg"],
    ),
    cookie: cookie && getKugouCookieValue(cookie, "token") ? cookie : null,
  };
}

export async function refreshKugouLogin(
  settings: AppSettings,
): Promise<string> {
  assertKugouEnabled(settings);
  requireKugouCookie(settings);
  const response = await requestKugouJson(settings, "/login/token", {
    timestamp: Date.now(),
  });
  const token = findKugouSessionString(
    [getPayloadData(response), response],
    ["token"],
  );
  if (!token) {
    throw new Error(
      findKugouSessionString(
        [getPayloadData(response), response],
        ["msg", "message"],
      ) ?? "KuGouMusicApi did not refresh the login token.",
    );
  }
  return mergeKugouSessionCookie(settings.network.kugouCookie, response);
}

export async function getKugouLoggedInAccount(
  settings: AppSettings,
): Promise<KugouAccountProfile | null> {
  assertKugouEnabled(settings);
  const cacheKey = `${getKugouBaseUrl(settings)}::${settings.network.kugouCookie}`;
  const cached = getTimedCacheValue(accountProfileCache, cacheKey);
  if (cached !== null) return cached;
  const userId = getKugouCookieValue(settings.network.kugouCookie, "userid");
  const numericUserId = userId ? asNumber(userId) : null;
  if (numericUserId === null) {
    setTimedCacheValue(accountProfileCache, cacheKey, null, 5 * 60 * 1000);
    return null;
  }
  const response = await requestKugouJson(settings, "/user/detail", {
    userid: userId,
    timestamp: Date.now(),
  });
  const account = toKugouAccountProfile(
    getKugouResponseData(response),
    numericUserId,
  );
  if (!account?.nickname)
    throw new Error(
      "KuGouMusicApi did not return account profile information.",
    );
  setTimedCacheValue(accountProfileCache, cacheKey, account, 5 * 60 * 1000);
  return account;
}

export async function getKugouUserPlaylists(
  settings: AppSettings,
  userId: number,
): Promise<KugouPlaylistSummary[]> {
  assertKugouEnabled(settings);
  const cacheKey = `${getKugouBaseUrl(settings)}::${settings.network.kugouCookie}::${userId}`;
  const cached = getTimedCacheValue(userPlaylistCache, cacheKey);
  if (cached) return cached;
  const response = await requestKugouJson(settings, "/user/playlist", {
    userid: userId,
    page: 1,
    pagesize: 100,
    timestamp: Date.now(),
  });
  const playlists = kugouUserPlaylistItems(kugouResponseData(response))
    .map(mapKugouPlaylist)
    .filter(isPresent);
  setTimedCacheValue(userPlaylistCache, cacheKey, playlists, 5 * 60 * 1000);
  return playlists;
}

export async function addKugouSongToPlaylist(
  settings: AppSettings,
  playlistId: number,
  song: KugouSongDetail,
) {
  assertKugouEnabled(settings);
  requireKugouCookie(settings);
  await requestKugouJson(settings, "/playlist/tracks/add", {
    listid: playlistId,
    data: [
      song.name,
      song.hash.toUpperCase(),
      song.albumId ?? "0",
      song.albumAudioId ?? "0",
    ].join("|"),
    timestamp: Date.now(),
  });
  playlistTracksCache.clear();
}

export async function removeKugouSongFromPlaylist(
  settings: AppSettings,
  playlistId: number,
  song: KugouSongDetail,
) {
  assertKugouEnabled(settings);
  requireKugouCookie(settings);
  if (!song.fileId) {
    throw new Error(
      "KuGouMusicApi did not provide a playlist fileid for this track.",
    );
  }
  await requestKugouJson(settings, "/playlist/tracks/del", {
    listid: playlistId,
    fileids: song.fileId,
    timestamp: Date.now(),
  });
  playlistTracksCache.clear();
}

export async function getKugouPlaylistTracks(
  settings: AppSettings,
  playlistId: string | number,
): Promise<KugouSongDetail[]> {
  assertKugouEnabled(settings);
  const cacheKey = `${getKugouBaseUrl(settings)}::${settings.network.kugouCookie}::${playlistId}`;
  const cached = getTimedCacheValue(playlistTracksCache, cacheKey);
  if (cached) return cached;
  const firstResponse = await requestKugouJson(
    settings,
    "/playlist/track/all",
    {
      id: playlistId,
      page: 1,
      pagesize: 300,
      timestamp: Date.now(),
    },
  );
  const firstData = kugouResponseData(firstResponse);
  const tracks = kugouPlaylistItems(firstData)
    .map(mapKugouSong)
    .filter(isPresent);
  const total = kugouTotal(firstData) ?? tracks.length;
  for (let page = 2; (page - 1) * 300 < total; page += 1) {
    const response = await requestKugouJson(settings, "/playlist/track/all", {
      id: playlistId,
      page,
      pagesize: 300,
      timestamp: Date.now(),
    });
    tracks.push(
      ...kugouPlaylistItems(kugouResponseData(response))
        .map(mapKugouSong)
        .filter(isPresent),
    );
  }
  setTimedCacheValue(playlistTracksCache, cacheKey, tracks, 5 * 60 * 1000);
  return tracks;
}

export async function getKugouPlaylistDetail(
  settings: AppSettings,
  collectionId: string,
): Promise<KugouPlaylistSummary | null> {
  assertKugouEnabled(settings);
  const normalizedCollectionId = collectionId.trim();
  if (!normalizedCollectionId) return null;
  const cacheKey = `${getKugouBaseUrl(settings)}::${settings.network.kugouCookie}::${normalizedCollectionId}`;
  const cached = getTimedCacheValue(playlistDetailCache, cacheKey);
  if (cached !== null) return cached;
  const response = await requestKugouJson(settings, "/playlist/detail", {
    ids: normalizedCollectionId,
    timestamp: Date.now(),
  });
  const detail =
    kugouPlaylistDetailItems(kugouResponseData(response))
      .map(mapKugouPlaylist)
      .find(isPresent) ?? null;
  setTimedCacheValue(playlistDetailCache, cacheKey, detail, 5 * 60 * 1000);
  return detail;
}

export async function searchKugouSongs(
  settings: AppSettings,
  keywords: string,
  options: KugouSearchOptions = {},
): Promise<KugouSongSearchResult[]> {
  return (await searchKugouSongResultsPage(settings, keywords, options)).items;
}

export async function getKugouEverydayRecommendations(
  settings: AppSettings,
): Promise<KugouSongDetail[]> {
  assertKugouEnabled(settings);
  const response = await requestKugouJson(settings, "/everyday/recommend", {
    timestamp: Date.now(),
  });
  const songs = kugouRecommendationSongItems(kugouResponseData(response))
    .map(mapKugouSong)
    .filter(isPresent);
  cacheKugouSongDetails(songs);
  return songs;
}

export async function getKugouSearchHotKeywords(
  settings: AppSettings,
  limit = 10,
): Promise<string[]> {
  assertKugouEnabled(settings);
  const response = await requestKugouJson(settings, "/search/hot", {
    timestamp: Date.now(),
  });
  const data = kugouResponseData(response);
  const groups = Array.isArray(data.list) ? data.list : [];
  const keywords = groups
    .flatMap((group) =>
      isRecord(group) && Array.isArray(group.keywords) ? group.keywords : [],
    )
    .map((item) =>
      isRecord(item) ? firstString(item, ["keyword", "name"]) : null,
    )
    .filter(isPresent);
  return Array.from(new Set(keywords)).slice(0, Math.max(1, limit));
}

export async function getKugouPlaylistTags(
  settings: AppSettings,
  limit = 8,
): Promise<Array<{ id: string; name: string }>> {
  assertKugouEnabled(settings);
  const response = await requestKugouJson(settings, "/playlist/tags", {
    timestamp: Date.now(),
  });
  const data = kugouResponseData(response);
  const groups = Array.isArray(data.items) ? data.items : [];
  const tags = groups
    .flatMap((group) =>
      isRecord(group) && Array.isArray(group.son) ? group.son : [],
    )
    .map((item) =>
      isRecord(item)
        ? {
            id: firstString(item, ["tag_id", "id"]),
            name: firstString(item, ["tag_name", "name"]),
          }
        : null,
    )
    .filter((item): item is { id: string; name: string } =>
      Boolean(item?.id && item.name),
    );
  return tags.slice(0, Math.max(1, limit));
}

export async function getKugouTopPlaylists(
  settings: AppSettings,
  categoryId = "0",
  limit = 6,
): Promise<KugouPlaylistSummary[]> {
  assertKugouEnabled(settings);
  const response = await requestKugouJson(settings, "/top/playlist", {
    category_id: categoryId,
    timestamp: Date.now(),
  });
  return kugouTopPlaylistItems(kugouResponseData(response))
    .map(mapKugouPlaylist)
    .filter(isPresent)
    .slice(0, Math.max(1, limit));
}

export async function getKugouDailyRecommendedSongs(
  settings: AppSettings,
  limit = 8,
): Promise<KugouSongDetail[]> {
  assertKugouEnabled(settings);
  const response = await requestKugouJson(settings, "/everyday/recommend", {
    timestamp: Date.now(),
  });
  return kugouRecommendationSongItems(kugouResponseData(response))
    .map(mapKugouSong)
    .filter(isPresent)
    .slice(0, Math.max(1, limit));
}

export async function getKugouPersonalFmSongs(
  settings: AppSettings,
  limit = 6,
): Promise<KugouSongDetail[]> {
  assertKugouEnabled(settings);
  const response = await requestKugouJson(settings, "/personal/fm", {
    timestamp: Date.now(),
  });
  return kugouRecommendationSongItems(kugouResponseData(response))
    .map(mapKugouSong)
    .filter(isPresent)
    .slice(0, Math.max(1, limit));
}

export async function searchKugouSongResultsPage(
  settings: AppSettings,
  keywords: string,
  options: KugouSearchOptions = {},
): Promise<KugouPagedResult<KugouSongSearchResult>> {
  const page = await searchKugou(settings, keywords, "song", options);
  return {
    ...page,
    items: page.items.map(mapKugouSearchSong).filter(isPresent),
  };
}

export async function searchKugouSongDetailsPage(
  settings: AppSettings,
  keywords: string,
  options: KugouSearchOptions = {},
): Promise<KugouPagedResult<KugouSongDetail>> {
  const page = await searchKugou(settings, keywords, "song", options);
  return { ...page, items: page.items.map(mapKugouSong).filter(isPresent) };
}

export async function searchKugouArtists(
  settings: AppSettings,
  keywords: string,
  options: KugouSearchOptions = {},
): Promise<KugouArtistSummary[]> {
  const page = await searchKugou(settings, keywords, "author", options);
  return page.items.map(mapKugouArtist).filter(isPresent);
}

export async function searchKugouAlbums(
  settings: AppSettings,
  keywords: string,
  options: KugouSearchOptions = {},
): Promise<KugouAlbumSummary[]> {
  const page = await searchKugou(settings, keywords, "album", options);
  return page.items.map(mapKugouAlbum).filter(isPresent);
}

export async function getKugouArtistDetail(
  settings: AppSettings,
  id: string,
): Promise<KugouArtistDetail | null> {
  assertKugouEnabled(settings);
  const cacheKey = `${getKugouBaseUrl(settings)}::${id}`;
  const cached = getTimedCacheValue(artistDetailCache, cacheKey);
  if (cached !== null) return cached;
  const response = await requestKugouJson(settings, "/artist/detail", {
    id,
    timestamp: Date.now(),
  });
  const detail = mapKugouArtistDetail(
    kugouArtistDetailRecord(kugouResponseData(response)),
  );
  setTimedCacheValue(artistDetailCache, cacheKey, detail, 5 * 60 * 1000);
  return detail;
}

export async function getKugouArtistSongsPage(
  settings: AppSettings,
  id: string,
  options: KugouSearchOptions = {},
): Promise<KugouPagedResult<KugouSongDetail>> {
  assertKugouEnabled(settings);
  const limit = normalizePositiveInteger(options.limit, 50);
  const offset = normalizeNonNegativeInteger(options.offset, 0);
  const cacheKey = `${getKugouBaseUrl(settings)}::${id}::${limit}::${offset}`;
  const cached = getTimedCacheValue(artistSongsPageCache, cacheKey);
  if (cached) return cached;
  const response = await requestKugouJson(settings, "/artist/audios", {
    id,
    page: Math.floor(offset / limit) + 1,
    pagesize: limit,
    timestamp: Date.now(),
  });
  const data = kugouResponseData(response);
  const page = kugouPage(
    kugouArtistSongItems(data)
      .map((item) => mapKugouArtistSong(item, id))
      .filter(isPresent),
    data,
    limit,
    offset,
  );
  if (page.items.length > 0 || page.hasMore)
    setTimedCacheValue(artistSongsPageCache, cacheKey, page, 5 * 60 * 1000);
  return page;
}

export async function getKugouArtistAlbumsPage(
  settings: AppSettings,
  id: string,
  options: KugouSearchOptions = {},
): Promise<KugouPagedResult<KugouAlbumSummary>> {
  assertKugouEnabled(settings);
  const limit = normalizePositiveInteger(options.limit, 18);
  const offset = normalizeNonNegativeInteger(options.offset, 0);
  const cacheKey = `${getKugouBaseUrl(settings)}::${id}::${limit}::${offset}`;
  const cached = getTimedCacheValue(artistAlbumsPageCache, cacheKey);
  if (cached) return cached;
  const response = await requestKugouJson(settings, "/artist/albums", {
    id,
    page: Math.floor(offset / limit) + 1,
    pagesize: limit,
    timestamp: Date.now(),
  });
  const data = kugouResponseData(response);
  const items = kugouArtistAlbumItems(data)
    .map(mapKugouAlbum)
    .filter(isPresent);
  const page = kugouPage(items, data, limit, offset);
  setTimedCacheValue(artistAlbumsPageCache, cacheKey, page, 5 * 60 * 1000);
  return page;
}

export async function getKugouAlbumDetail(
  settings: AppSettings,
  id: string,
): Promise<KugouAlbumDetail | null> {
  assertKugouEnabled(settings);
  const cacheKey = `${getKugouBaseUrl(settings)}::${id}`;
  const cached = getTimedCacheValue(albumDetailCache, cacheKey);
  if (cached !== null) return cached;
  const detailResponse = await requestKugouJson(settings, "/album/detail", {
    id,
    timestamp: Date.now(),
  });
  const detail = mapKugouAlbumDetail(
    kugouAlbumDetailRecord(kugouResponseData(detailResponse)),
  );
  setTimedCacheValue(albumDetailCache, cacheKey, detail, 5 * 60 * 1000);
  return detail;
}

export async function getKugouAlbumSongsPage(
  settings: AppSettings,
  id: string,
  options: KugouSearchOptions = {},
): Promise<KugouPagedResult<KugouSongDetail>> {
  assertKugouEnabled(settings);
  const limit = Math.min(30, normalizePositiveInteger(options.limit, 30));
  const offset = normalizeNonNegativeInteger(options.offset, 0);
  const cacheKey = `${getKugouBaseUrl(settings)}::${id}::${limit}::${offset}`;
  const cached = getTimedCacheValue(albumSongsPageCache, cacheKey);
  if (cached) return cached;
  const response = await requestKugouJson(settings, "/album/songs", {
    id,
    page: Math.floor(offset / limit) + 1,
    pagesize: limit,
    timestamp: Date.now(),
  });
  const data = kugouResponseData(response);
  const page = kugouPage(
    kugouAlbumSongItems(data).map(mapKugouSong).filter(isPresent),
    data,
    limit,
    offset,
  );
  if (page.items.length > 0 || page.hasMore)
    setTimedCacheValue(albumSongsPageCache, cacheKey, page, 5 * 60 * 1000);
  return page;
}

export async function getKugouSongDetail(
  settings: AppSettings,
  reference: KugouTrackReference,
): Promise<KugouSongDetail | null> {
  assertKugouEnabled(settings);
  if (reference.albumAudioId) {
    const response = await requestKugouJson(settings, "/krm/audio", {
      album_audio_id: reference.albumAudioId,
      timestamp: Date.now(),
    });
    const data = getPayloadData(response);
    const candidate = kugouKrmAudioRecord(data);
    const detail = candidate ? mapKugouSong(candidate) : null;
    if (detail) return mergeTrackReference(detail, reference);
  }

  if (!reference.hash.trim()) return null;
  const response = await requestKugouJson(settings, "/audio", {
    hash: reference.hash,
    timestamp: Date.now(),
  });
  const data = kugouResponseData(response);
  const detail = mapKugouSong(data);
  if (!detail) return null;
  const mergedDetail = mergeTrackReference(detail, reference);
  if (mergedDetail.albumId && mergedDetail.artistIds.some(Boolean))
    return mergedDetail;
  const searchResponse = await requestKugouJson(settings, "/search", {
    keywords: mergedDetail.name,
    type: "song",
    page: 1,
    pagesize: 30,
    timestamp: Date.now(),
  });
  const searchMatch = kugouSearchItems(kugouResponseData(searchResponse))
    .map(mapKugouSong)
    .filter(isPresent)
    .find(
      (item) =>
        item.hash.trim().toUpperCase() === reference.hash.trim().toUpperCase(),
    );
  return searchMatch
    ? mergeSongDetails(searchMatch, mergedDetail)
    : mergedDetail;
}

export function getCachedKugouSongDetail(hash: string) {
  return trackDetailsByHash.get(hash.trim().toUpperCase()) ?? null;
}

export function cacheKugouSongDetails(details: KugouSongDetail[]) {
  for (const detail of details) {
    const hash = detail.hash.trim().toUpperCase();
    if (hash) trackDetailsByHash.set(hash, detail);
  }
}

export async function getKugouSongLyrics(
  settings: AppSettings,
  reference: KugouTrackReference,
  options: { keywords?: string; durationMs?: number | null } = {},
): Promise<KugouSongLyrics | null> {
  assertKugouEnabled(settings);
  const searchResponse = await requestKugouJson(settings, "/search/lyric", {
    hash: reference.hash,
    album_audio_id: reference.albumAudioId ?? "",
    keywords: options.keywords ?? "",
    duration: options.durationMs ? Math.round(options.durationMs / 1000) : "",
    timestamp: Date.now(),
  });
  const searchData = getPayloadData(searchResponse);
  const candidate = findFirstRecord(searchData, [
    "candidates",
    "info",
    "data",
    "list",
  ]);
  const lyricId = candidate && firstString(candidate, ["id"]);
  const accesskey =
    candidate && firstString(candidate, ["accesskey", "access_key"]);
  if (!lyricId || !accesskey) {
    return null;
  }
  const lyricResponse = await requestKugouJson(settings, "/lyric", {
    id: lyricId,
    accesskey,
    fmt: "krc",
    decode: "true",
    timestamp: Date.now(),
  });
  const lyricData = getPayloadData(lyricResponse);
  const rawLyric = firstString(lyricData, [
    "decodeContent",
    "content",
    "lyric",
  ]);
  return parseKugouLyrics(rawLyric);
}

function parseKugouLyrics(rawLyric: string | null): KugouSongLyrics | null {
  if (!rawLyric) {
    return null;
  }

  const fallback = parseRawLyrics({ rawLyric });
  const embeddedTracks = parseKugouEmbeddedLanguageTracks(rawLyric);
  const lines = rawLyric
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((rawLine) => /^\[\d+,\d+\]/.test(rawLine))
    .map((rawLine, index) => {
      const match = rawLine.match(/^\[(\d+),(\d+)\](.*)$/);
      if (!match) {
        return null;
      }

      const startTimeMs = Number(match[1]);
      const durationMs = Number(match[2]);
      const payload = match[3] ?? "";
      if (!Number.isFinite(startTimeMs) || !Number.isFinite(durationMs)) {
        return null;
      }

      const words = [...payload.matchAll(/<(\d+),(\d+)(?:,\d+)?>([^<]*)/g)]
        .map((word) => {
          const offsetMs = Number(word[1]);
          const wordDurationMs = Number(word[2]);
          if (!Number.isFinite(offsetMs) || !Number.isFinite(wordDurationMs)) {
            return null;
          }
          return {
            text: word[3] ?? "",
            startTimeMs: startTimeMs + offsetMs,
            durationMs: wordDurationMs,
            endTimeMs: startTimeMs + offsetMs + wordDurationMs,
          };
        })
        .filter(isPresent);
      const text = words.length > 0
        ? words.map((word) => word.text).join("")
        : payload.trim();
      if (!text) {
        return null;
      }

      return {
        text,
        startTimeMs,
        durationMs,
        endTimeMs: startTimeMs + durationMs,
        translatedText: embeddedTracks.translations[index] ?? null,
        romanizedText: embeddedTracks.romanizations[index] ?? null,
        words,
      };
    })
    .filter(isPresent);

  if (lines.length === 0) {
    return fallback;
  }

  const timedTrack = (selector: (line: (typeof lines)[number]) => string | null) =>
    lines
      .map((line) => {
        const text = selector(line)?.trim();
        return text ? `[${formatKugouLyricTimestamp(line.startTimeMs)}]${text}` : null;
      })
      .filter(isPresent)
      .join("\n") || null;

  return {
    lyric: rawLyric,
    translatedLyric: timedTrack((line) => line.translatedText),
    romanizedLyric: timedTrack((line) => line.romanizedText),
    dynamicLyric: rawLyric,
    metadataEntries: fallback?.metadataEntries ?? [],
    lines,
    source: "word",
  };
}

function parseKugouEmbeddedLanguageTracks(rawLyric: string) {
  const encoded = rawLyric.match(/\[language:([^\]]+)\]/i)?.[1]?.trim();
  if (!encoded) {
    return { translations: [] as string[], romanizations: [] as string[] };
  }

  try {
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) =>
      character.charCodeAt(0),
    );
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as {
      content?: Array<{ type?: number; lyricContent?: unknown[] }>;
    };
    const readTrack = (type: number) =>
      (payload.content ?? [])
        .find((track) => track.type === type)
        ?.lyricContent?.map((line) =>
          Array.isArray(line) ? line.join("").trim() : String(line).trim(),
        ) ?? [];
    return {
      translations: readTrack(1),
      romanizations: readTrack(0),
    };
  } catch {
    return { translations: [] as string[], romanizations: [] as string[] };
  }
}

function formatKugouLyricTimestamp(timeMs: number) {
  const minutes = Math.floor(timeMs / 60_000);
  const seconds = Math.floor((timeMs % 60_000) / 1_000);
  const centiseconds = Math.floor((timeMs % 1_000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

export async function getKugouSongStreams(
  settings: AppSettings,
  reference: KugouTrackReference,
  preferredQuality = settings.playback.preferredQuality,
): Promise<KugouSongStream[]> {
  assertKugouEnabled(settings);
  const trackHash = summarizeKugouHash(reference.hash);
  const variants =
    reference.albumId || reference.albumAudioId
      ? [
          {
            album_id: reference.albumId ?? "",
            album_audio_id: reference.albumAudioId ?? "",
          },
          { album_id: "", album_audio_id: "" },
        ]
      : [{ album_id: "", album_audio_id: "" }];
  let lastError: unknown = null;
  for (const quality of getKugouPlaybackQualityCandidates(
    preferredQuality,
  )) {
    for (const variant of variants) {
      try {
        console.warn("[kugou-playback] requesting song URL", {
          hash: trackHash,
          quality,
          hasAlbumId: Boolean(variant.album_id),
          hasAlbumAudioId: Boolean(variant.album_audio_id),
        });
        const response = await requestKugouJson(settings, "/song/url", {
          hash: reference.hash.toUpperCase(),
          quality,
          ...variant,
          timestamp: Date.now(),
        });
        const streams = parseKugouSongUrlStreams(
          response,
          reference.hash,
          quality,
        );
        console.warn("[kugou-playback] song URL response parsed", {
          hash: trackHash,
          quality,
          apiStatus: asNumber(
            firstValue(getPayloadData(response), ["status", "code"]),
          ),
          streamCount: streams.length,
          streams: streams.map(summarizeKugouStream),
        });
        if (streams.length > 0) return streams;
      } catch (error) {
        console.warn("[kugou-playback] song URL request failed", {
          hash: trackHash,
          quality,
          hasAlbumId: Boolean(variant.album_id),
          hasAlbumAudioId: Boolean(variant.album_audio_id),
          error: error instanceof Error ? error.message : String(error),
        });
        if (error instanceof Error && error.message.includes("20028"))
          throw error;
        lastError = error;
      }
    }
  }
  if (lastError instanceof Error) throw lastError;
  console.warn("[kugou-playback] no playable stream returned", {
    hash: trackHash,
  });
  return [];
}

export async function resolveKugouTrack(
  settings: AppSettings,
  detail: KugouSongDetail,
  options: { bypassCache?: boolean; preferredQuality?: string } = {},
): Promise<KugouResolvedTrack> {
  assertKugouEnabled(settings);
  const queueDetail = getCachedKugouSongDetail(detail.hash) ?? detail;
  const reference = toTrackReference(queueDetail);
  const trackHash = summarizeKugouHash(reference.hash);
  const preferredQuality =
    options.preferredQuality ?? settings.playback.preferredQuality;
  const cacheKey = `${getKugouBaseUrl(settings)}::${settings.network.kugouCookie}::${preferredQuality}::${detail.hash}`;
  if (!options.bypassCache) {
    const cached = getTimedCacheValue(resolvedTrackCache, cacheKey);
    if (cached) {
      console.warn("[kugou-playback] resolved track cache hit", {
        hash: trackHash,
        stream: summarizeKugouStream(cached.stream),
      });
      return cached;
    }
    const inflight = resolvedTrackInflight.get(cacheKey);
    if (inflight) {
      console.warn("[kugou-playback] joining inflight track resolution", {
        hash: trackHash,
      });
      return inflight;
    }
  }
  const task = (async () => {
    console.warn("[kugou-playback] resolving track", {
      hash: trackHash,
      bypassCache: Boolean(options.bypassCache),
    });
    const [hydratedDetail, streams, lyrics] = await Promise.all([
      getKugouSongDetail(settings, reference).catch(() => null),
      getKugouSongStreams(settings, reference, preferredQuality),
      getKugouSongLyrics(settings, reference, {
        keywords: queueDetail.name,
        durationMs: queueDetail.durationMs,
      }).catch(() => null),
    ]);
    const stream = streams[0];
    if (!stream) {
      console.warn("[kugou-playback] track resolution has no primary stream", {
        hash: trackHash,
      });
      throw new Error(
        queueDetail.unavailableMessage ??
          "KuGouMusicApi did not return a playable song URL.",
      );
    }
    const resolvedDetail = hydratedDetail
      ? mergeSongDetails(hydratedDetail, queueDetail)
      : queueDetail;
    trackDetailsByHash.set(reference.hash.trim().toUpperCase(), resolvedDetail);
    const resolved: KugouResolvedTrack = {
      detail: resolvedDetail,
      stream,
      fallbackStreams: streams.slice(1),
      lyrics,
      availability: { success: true, message: null },
      notice: stream.isFreeTrial ? "KuGou returned a preview stream." : null,
    };
    console.warn("[kugou-playback] track resolved", {
      hash: trackHash,
      usedHydratedDetail: Boolean(hydratedDetail),
      hasLyrics: Boolean(lyrics),
      primary: summarizeKugouStream(stream),
      fallbackCount: streams.length - 1,
    });
    setTimedCacheValue(
      resolvedTrackCache,
      cacheKey,
      resolved,
      KUGOU_RESOLVED_TRACK_CACHE_TTL_MS,
    );
    return resolved;
  })();
  if (options.bypassCache) return task;
  const tracked = task.finally(() => resolvedTrackInflight.delete(cacheKey));
  resolvedTrackInflight.set(cacheKey, tracked);
  return tracked;
}

export async function registerKugouTrackToLibrary(
  settings: AppSettings,
  detail: KugouSongDetail,
): Promise<TrackRecord> {
  return registerResolvedKugouTrackToLibrary(
    await resolveKugouTrack(settings, detail),
  );
}

export function createKugouTrackDraft(
  detail: KugouSongDetail,
  resolved?: Pick<KugouResolvedTrack, "stream" | "fallbackStreams"> | null,
): RemoteTrackDraft {
  return {
    title: detail.name,
    artist: detail.artists.join(" / ") || null,
    album: detail.album,
    albumArtist: detail.albumArtist,
    durationMs: detail.durationMs,
    genre: null,
    streamUrl: resolved?.stream.url ?? "",
    artworkUrl: detail.artworkUrl,
    fallbackLocalPath: null,
    fallbackUrls: resolved?.fallbackStreams.map((stream) => stream.url) ?? [],
    mimeType: inferMimeType(resolved?.stream.type ?? null),
    headers: null,
    cacheKey: buildKugouTrackCacheKey(detail.hash),
  };
}

export async function registerResolvedKugouTrackToLibrary(
  resolved: KugouResolvedTrack,
): Promise<TrackRecord> {
  return registerRemoteTrack(createKugouTrackDraft(resolved.detail, resolved));
}

export function buildKugouTrackCacheKey(hash: string) {
  return `${KUGOU_TRACK_CACHE_KEY_PREFIX}${hash.trim().toLowerCase()}`;
}

export function parseKugouTrackHashFromCacheKey(
  cacheKey: string | null | undefined,
) {
  const value = cacheKey?.trim() ?? "";
  if (!value.toLowerCase().startsWith(KUGOU_TRACK_CACHE_KEY_PREFIX))
    return null;
  const hash = value.slice(KUGOU_TRACK_CACHE_KEY_PREFIX.length).trim();
  return hash || null;
}

async function searchKugou(
  settings: AppSettings,
  keywords: string,
  type: "song" | "author" | "album",
  options: KugouSearchOptions,
) {
  assertKugouEnabled(settings);
  const limit = normalizePositiveInteger(
    options.limit,
    type === "song" ? 20 : 18,
  );
  const offset = normalizeNonNegativeInteger(options.offset, 0);
  if (!keywords.trim())
    return createPagedResult<unknown>([], limit, offset, 0, false);
  const response = await requestKugouJson(settings, "/search", {
    keywords: keywords.trim(),
    type,
    page: Math.floor(offset / limit) + 1,
    pagesize: limit,
    timestamp: Date.now(),
  });
  const data = kugouResponseData(response);
  return kugouPage(kugouSearchItems(data), data, limit, offset);
}

async function requestKugouJson(
  settings: AppSettings,
  path: string,
  query: Record<string, string | number | null | undefined>,
  options: {
    includeCookie?: boolean;
    method?: "GET" | "POST";
    cookie?: string;
    allowHttpError?: boolean;
    allowApiError?: boolean;
  } = {},
): Promise<Record<string, unknown>> {
  const url = new URL(path, `${getKugouBaseUrl(settings)}/`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== "")
      url.searchParams.set(key, String(value));
  }
  const cookie =
    options.includeCookie !== false
      ? (options.cookie ?? settings.network.kugouCookie).trim()
      : "";
  if (cookie) url.searchParams.set("cookie", cookie);
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    Math.max(1000, settings.network.requestTimeoutMs),
  );
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (cookie) {
      headers.Authorization = cookie;
    }
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      credentials: "include",
      signal: controller.signal,
    });
    const payload = (await response.json()) as unknown;
    if (!isRecord(payload))
      throw new Error("KuGouMusicApi returned an invalid JSON payload.");
    if (!response.ok && !options.allowHttpError)
      throw new Error(
        `KuGouMusicApi request failed with status ${response.status}.`,
      );
    const errorCode = asNumber(payload.error_code) ?? asNumber(payload.errcode);
    if (
      !options.allowApiError &&
      errorCode !== null &&
      errorCode !== 0 &&
      errorCode !== 200
    ) {
      throw new Error(
        `KuGouMusicApi error ${errorCode}: ${firstString(payload, ["msg", "message", "error_msg", "error"]) ?? "Unknown API error."}`,
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw new Error("KuGouMusicApi request timed out.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function getKugouBaseUrl(settings: AppSettings) {
  if (settings.network.useLocalKugouApiServer && localKugouApiRuntimeBaseUrl) {
    return localKugouApiRuntimeBaseUrl;
  }

  return (
    settings.network.kugouApiBaseUrl.trim().replace(/\/+$/, "") ||
    DEFAULT_KUGOU_BASE_URL
  );
}

function assertKugouEnabled(settings: AppSettings) {
  if (!isKugouSourceEnabled(settings))
    throw new Error("The KuGou online source is currently disabled.");
}

function requireKugouCookie(settings: AppSettings) {
  if (!settings.network.kugouCookie.trim())
    throw new Error("KuGou login is required for this request.");
}

function getPayloadData(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (isRecord(payload.data)) {
    return payload.data;
  }

  if (Array.isArray(payload.data)) {
    return { data: payload.data };
  }

  return payload;
}

function getKugouResponseData(payload: Record<string, unknown>): unknown {
  if (isRecord(payload.data) || Array.isArray(payload.data))
    return payload.data;
  if (
    isRecord(payload.body) &&
    (isRecord(payload.body.data) || Array.isArray(payload.body.data))
  )
    return payload.body.data;
  return isRecord(payload.body) || Array.isArray(payload.body)
    ? payload.body
    : payload;
}

function toKugouAccountProfile(
  value: unknown,
  fallbackUserId: number,
): KugouAccountProfile | null {
  const records = collectRecords(value);
  const idRecord =
    records.find(
      (candidate) =>
        asNumber(firstValue(candidate, ["userid", "user_id", "uid"])) !== null,
    ) ?? null;
  const profileRecord = records
    .filter((candidate) => scoreKugouAccountRecord(candidate) > 0)
    .sort(
      (left, right) =>
        scoreKugouAccountRecord(right) - scoreKugouAccountRecord(left),
    )[0];
  const record =
    profileRecord ??
    idRecord ??
    firstRecord(value, ["data", "userinfo", "user"]) ??
    (isRecord(value) ? value : null);
  const userId =
    asNumber(firstValue(record, ["userid", "user_id", "id", "uid"])) ??
    asNumber(firstValue(idRecord, ["userid", "user_id", "id", "uid"])) ??
    fallbackUserId;
  if (!record) return null;
  return {
    userId,
    nickname:
      firstString(record, ["nickname", "nick_name", "username", "name"]) ?? "",
    avatarUrl: normalizeArtworkUrl(
      firstString(record, [
        "user_pic",
        "avatar",
        "avatar_url",
        "imgurl",
        "pic",
        "head_pic",
      ]),
    ),
    backgroundUrl: normalizeArtworkUrl(
      firstString(record, ["background", "background_url", "bgurl", "bg_pic"]),
    ),
    signature: firstString(record, ["signature", "intro", "description"]),
    level: asNumber(firstValue(record, ["level", "user_level"])),
    vipType: asNumber(firstValue(record, ["vip_type", "viptype", "is_vip"])),
  };
}

function scoreKugouAccountRecord(record: Record<string, unknown>) {
  return [
    "nickname",
    "nick_name",
    "username",
    "name",
    "user_pic",
    "avatar",
    "avatar_url",
    "imgurl",
    "pic",
    "head_pic",
  ].reduce((score, key) => score + (asString(record[key]) ? 1 : 0), 0);
}

function parseKugouSongUrlStreams(
  response: Record<string, unknown>,
  hash: string,
  quality: string,
): KugouSongStream[] {
  const data = getPayloadData(response);
  const rawUrlCounts = {
    url: countKugouUrlCandidates(data.url),
    playUrl:
      countKugouUrlCandidates(data.play_url) +
      countKugouUrlCandidates(data.playUrl),
    fileUrl: countKugouUrlCandidates(data.file_url),
    backupUrl:
      countKugouUrlCandidates(data.backupUrl) +
      countKugouUrlCandidates(data.backup_url),
  };
  const urls = [
    data.url,
    data.play_url,
    data.playUrl,
    data.file_url,
    data.backupUrl,
    data.backup_url,
  ]
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .flatMap((value) =>
      typeof value === "string" ? value.split(/,\s*(?=https?:\/\/)/i) : [],
    )
    .map((url) => url.trim())
    .filter(
      (url, index, values) =>
        /^https?:\/\//i.test(url) && values.indexOf(url) === index,
    );
  const type = firstString(data, ["extName", "extname", "type", "file_type"]);
  console.warn("[kugou-playback] parsing song URL payload", {
    hash: summarizeKugouHash(hash),
    quality,
    payloadStatus: asNumber(firstValue(data, ["status", "code"])),
    rawUrlCounts,
    urlCount: urls.length,
    type,
  });
  return urls.map((url) => ({
    id: hash,
    url,
    br: asNumber(firstValue(data, ["bitRate", "bitrate", "br"])),
    size: asNumber(firstValue(data, ["fileSize", "filesize", "size"])),
    type: type ?? extensionFromUrl(url),
    level: quality,
    code: asNumber(firstValue(data, ["status", "code"])),
    fee: asNumber(firstValue(data, ["fee"])),
    isFreeTrial: Boolean(firstValue(data, ["free_part", "is_free_part"])),
    trialStart: null,
    trialEnd: null,
  }));
}

function countKugouUrlCandidates(value: unknown) {
  return Array.isArray(value)
    ? value.length
    : typeof value === "string" && value.trim()
      ? 1
      : 0;
}
function summarizeKugouHash(hash: string) {
  const normalized = hash.trim();
  return normalized.length <= 14
    ? normalized
    : `${normalized.slice(0, 8)}...${normalized.slice(-6)}`;
}
function summarizeKugouUrl(url: string) {
  try {
    return new URL(url).host || "unknown";
  } catch {
    return "invalid";
  }
}
function summarizeKugouStream(stream: KugouSongStream) {
  return {
    host: summarizeKugouUrl(stream.url),
    type: stream.type,
    bitrate: stream.br,
    size: stream.size,
    level: stream.level,
    code: stream.code,
  };
}

function mergeSongDetails(
  primary: KugouSongDetail,
  fallback: KugouSongDetail,
): KugouSongDetail {
  return {
    ...fallback,
    ...primary,
    id: fallback.id || primary.id,
    hash: fallback.hash || primary.hash,
    artists: primary.artists.length ? primary.artists : fallback.artists,
    artistIds: primary.artistIds.length
      ? primary.artistIds
      : fallback.artistIds,
    album: primary.album ?? fallback.album,
    albumArtist: primary.albumArtist ?? fallback.albumArtist,
    durationMs: primary.durationMs ?? fallback.durationMs,
    artworkUrl: primary.artworkUrl ?? fallback.artworkUrl,
  };
}

function mergeTrackReference(
  detail: KugouSongDetail,
  reference: KugouTrackReference,
): KugouSongDetail {
  return {
    ...detail,
    hash: detail.hash || reference.hash,
    id: detail.id || reference.hash,
    albumAudioId: detail.albumAudioId ?? reference.albumAudioId,
    albumId: detail.albumId ?? reference.albumId,
  };
}

function toTrackReference(detail: KugouSongDetail): KugouTrackReference {
  return {
    hash: detail.hash,
    albumAudioId: detail.albumAudioId,
    albumId: detail.albumId,
  };
}
function normalizeArtworkUrl(value: string | null) {
  return value?.replace("{size}", "400").replace(/^http:/i, "https:") ?? null;
}
function getKugouPlaybackQualityCandidates(quality: string) {
  switch (quality) {
    case "hires":
      return ["high", "flac", "320", "128"];
    case "lossless":
      return ["flac", "320", "128"];
    case "high":
    case "320":
      return ["320", "128"];
    case "flac":
      return ["flac", "320", "128"];
    default:
      return ["128"];
  }
}
function inferMimeType(type: string | null) {
  const extension = type?.toLowerCase();
  return extension === "mp3"
    ? "audio/mpeg"
    : extension === "flac"
      ? "audio/flac"
      : extension === "m4a"
        ? "audio/mp4"
        : extension
          ? `audio/${extension}`
          : null;
}
function extensionFromUrl(url: string) {
  const match = url.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i);
  return match?.[1] ?? null;
}
function normalizeQrImage(value: string | null) {
  return value && value.startsWith("data:image")
    ? value
    : value
      ? `data:image/png;base64,${value}`
      : null;
}
function mergeKugouSessionCookie(current: string, payload: unknown) {
  let cookie = current;
  const records = collectRecords(payload);
  for (const record of records) {
    const value = record.cookie;
    if (typeof value === "string")
      cookie = mergeKugouCookie(cookie, parseKugouCookie(value));
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string")
          cookie = mergeKugouCookie(cookie, parseKugouCookie(entry));
        if (isRecord(entry)) {
          const name = firstString(entry, ["name", "key"]);
          const entryValue = firstString(entry, ["value"]);
          if (name && entryValue)
            cookie = mergeKugouCookie(cookie, { [name]: entryValue });
        }
      }
    }
  }
  const values = {
    token: findKugouSessionString([payload], ["token"]),
    userid: findKugouSessionString([payload], ["userid", "user_id", "uid"]),
    dfid: findKugouSessionString([payload], ["dfid"]),
    t1: findKugouSessionString([payload], ["t1"]),
    vip_type: findKugouSessionString([payload], ["vip_type"]),
    vip_token: findKugouSessionString([payload], ["vip_token"]),
    mid: findKugouSessionString([payload], ["mid"]),
    uuid: findKugouSessionString([payload], ["uuid"]),
  };
  return mergeKugouCookie(cookie, values);
}
function parseKugouCookie(cookie: string) {
  return Object.fromEntries(
    cookie
      .split(";")
      .map((entry) => entry.trim().split(/=(.*)/s))
      .filter(([key, value]) => key && value !== undefined),
  );
}
function findKugouSessionString(values: unknown[], keys: string[]) {
  for (const value of values) {
    for (const record of collectRecords(value)) {
      const candidate = firstString(record, keys);
      if (candidate) return candidate;
    }
  }
  return null;
}
function findKugouQrStatus(values: unknown[]) {
  const codes = new Set<number>();
  for (const value of values) {
    for (const record of collectRecords(value)) {
      const code = asNumber(firstValue(record, ["status", "code"]));
      if (code !== null) codes.add(code);
    }
  }
  return [4, 3, 2, 0, 1].find((code) => codes.has(code)) ?? null;
}
function mergeKugouCookie(
  current: string,
  updates: Record<string, string | null | undefined>,
) {
  const values = new Map(
    current
      .split(";")
      .map((entry) => entry.trim().split(/=(.*)/s))
      .filter(([key, value]) => key && value !== undefined)
      .map(([key, value]) => [key, value]),
  );
  Object.entries(updates).forEach(([key, value]) => {
    if (value) values.set(key, value);
  });
  return Array.from(values, ([key, value]) => `${key}=${value}`).join("; ");
}
function getKugouCookieValue(cookie: string, targetKey: string) {
  return (
    cookie
      .split(";")
      .map((entry) => entry.trim().split(/=(.*)/s))
      .find(([key]) => key === targetKey)?.[1]
      ?.trim() || null
  );
}
function findCollection(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key] as unknown[];
    if (isRecord(value[key])) {
      const nested = findCollection(value[key], keys);
      if (nested.length) return nested;
    }
  }
  return [];
}
function firstRecord(value: unknown, keys: string[]) {
  if (!isRecord(value)) return null;
  for (const key of keys) {
    const candidate = value[key];
    if (isRecord(candidate)) return candidate;
  }
  return null;
}
function findFirstRecord(value: unknown, keys: string[]) {
  const collection = findCollection(value, keys);
  return (
    collection.map((item) => (isRecord(item) ? item : null)).find(isPresent) ??
    firstRecord(value, keys)
  );
}
function collectRecords(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value) && !Array.isArray(value)) return [];
  const records: Record<string, unknown>[] = [];
  const visit = (entry: unknown) => {
    if (Array.isArray(entry)) entry.forEach(visit);
    else if (isRecord(entry)) {
      records.push(entry);
      Object.values(entry).forEach((child) => {
        if (isRecord(child) || Array.isArray(child)) visit(child);
      });
    }
  };
  visit(value);
  return records;
}
function createPagedResult<T>(
  items: T[],
  limit: number,
  offset: number,
  total: number | null,
  hasMore: boolean,
): KugouPagedResult<T> {
  return { items, limit, offset, total, hasMore };
}
function getTimedCacheValue<T>(
  cache: Map<string, TimedCacheEntry<T>>,
  key: string,
) {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    if (entry) cache.delete(key);
    return null;
  }
  return entry.value;
}
function setTimedCacheValue<T>(
  cache: Map<string, TimedCacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number,
) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}
function normalizePositiveInteger(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && (value ?? 0) > 0
    ? Math.round(value ?? fallback)
    : fallback;
}
function normalizeNonNegativeInteger(
  value: number | undefined,
  fallback: number,
) {
  return Number.isFinite(value) && (value ?? -1) >= 0
    ? Math.round(value ?? fallback)
    : fallback;
}
function firstValue(record: Record<string, unknown> | null, keys: string[]) {
  if (!record) return undefined;
  for (const key of keys)
    if (record[key] !== undefined && record[key] !== null) return record[key];
  return undefined;
}
function firstString(record: Record<string, unknown> | null, keys: string[]) {
  return asString(firstValue(record, keys));
}
function asString(value: unknown) {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}
function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() &&
    Number.isFinite(Number(value))
  )
    return Number(value);
  return null;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
