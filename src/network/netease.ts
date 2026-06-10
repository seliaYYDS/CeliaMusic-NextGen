import { registerRemoteTrack } from "../media/library";
import type { RemoteTrackDraft, TrackRecord } from "../media/types";
import type { AppSettings } from "../settings/types";
import type {
  NeteaseAccountProfile,
  NeteaseAlbumDetail,
  NeteaseAlbumSummary,
  NeteaseArtistDetail,
  NeteaseArtistSummary,
  NeteaseDjRecommendation,
  NeteasePagedResult,
  NeteasePlaylistRecommendation,
  NeteaseQrLoginSession,
  NeteaseQrLoginStatus,
  NeteaseLyricMetadataEntry,
  NeteaseMvStream,
  NeteaseParsedLyricLine,
  NeteaseParsedLyricWord,
  NeteaseResolvedTrack,
  NeteaseSearchHotKeyword,
  NeteaseSearchSuggestions,
  NeteaseSongDetail,
  NeteaseSongLyrics,
  NeteaseSongSearchResult,
  NeteaseSongStream,
} from "./types";

const NETEASE_SOURCE_ID = "netease";
const DEFAULT_NETEASE_BASE_URL = "http://127.0.0.1:3000";

type NeteaseSearchOptions = {
  limit?: number;
  offset?: number;
  type?: number;
  useCloudSearch?: boolean;
};

type NeteaseStreamOptions = {
  level?: string;
};

type NeteaseConnectionResult = {
  baseUrl: string;
  keyword: string | null;
};

type TimedCacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type ResolveNeteaseTrackOptions = {
  detail?: NeteaseSongDetail | null;
  bypassCache?: boolean;
};

const NETEASE_TRACK_CACHE_KEY_PREFIX = "netease:track:";
const NETEASE_RESOLVED_TRACK_CACHE_TTL_MS = 5 * 60 * 1000;
const NETEASE_MV_STREAM_CACHE_TTL_MS = 10 * 60 * 1000;
const NETEASE_RATE_LIMIT_COOLDOWN_MS = 5_000;
const neteaseResolvedTrackCache = new Map<string, TimedCacheEntry<NeteaseResolvedTrack>>();
const neteaseMvStreamCache = new Map<string, TimedCacheEntry<NeteaseMvStream | null>>();
const neteaseResolvedTrackInflight = new Map<string, Promise<NeteaseResolvedTrack>>();
let localNeteaseApiRuntimeBaseUrl: string | null = null;
let neteaseRateLimitCooldownUntil = 0;

export function clearNeteaseMemoryCaches() {
  const summary = {
    resolvedTrackCacheEntries: neteaseResolvedTrackCache.size,
    mvStreamCacheEntries: neteaseMvStreamCache.size,
    inflightTrackRequests: neteaseResolvedTrackInflight.size,
  };
  neteaseResolvedTrackCache.clear();
  neteaseMvStreamCache.clear();
  neteaseResolvedTrackInflight.clear();
  neteaseRateLimitCooldownUntil = 0;
  return summary;
}

export function setLocalNeteaseApiRuntimeBaseUrl(baseUrl: string | null) {
  localNeteaseApiRuntimeBaseUrl = baseUrl?.trim().replace(/\/+$/, "") || null;
}

export function isNeteaseSourceEnabled(settings: AppSettings) {
  return settings.network.enabledSources.some(
    (source) => source.trim().toLowerCase() === NETEASE_SOURCE_ID,
  );
}

export async function testNeteaseApiConnection(
  settings: AppSettings,
): Promise<NeteaseConnectionResult> {
  assertNeteaseEnabled(settings);
  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/search/default",
  );
  const data = asRecord(response.data);

  return {
    baseUrl: getNeteaseBaseUrl(settings),
    keyword:
      asString(data?.realkeyword) ??
      asString(data?.showKeyword) ??
      asString(data?.keyword) ??
      null,
  };
}

export async function createNeteaseQrLoginSession(
  settings: AppSettings,
): Promise<NeteaseQrLoginSession> {
  assertNeteaseEnabled(settings);

  const keyResponse = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/login/qr/key",
    {
      timestamp: Date.now(),
    },
    {
      includeCookie: false,
    },
  );
  const keyData = asRecord(keyResponse.data);
  const key = asString(keyData?.unikey) ?? asString(keyData?.key);

  if (!key) {
    throw new Error("NeteaseMusicAPI did not return a QR login key.");
  }

  const qrResponse = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/login/qr/create",
    {
      key,
      qrimg: "true",
      timestamp: Date.now(),
    },
    {
      includeCookie: false,
    },
  );
  const qrData = asRecord(qrResponse.data);
  const qrUrl = asString(qrData?.qrurl) ?? asString(qrData?.url);

  if (!qrUrl) {
    throw new Error("NeteaseMusicAPI did not return QR login content.");
  }

  return {
    key,
    qrUrl,
    qrImage: normalizeQrImage(asString(qrData?.qrimg)),
  };
}

export async function checkNeteaseQrLoginStatus(
  settings: AppSettings,
  key: string,
): Promise<NeteaseQrLoginStatus> {
  assertNeteaseEnabled(settings);

  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/login/qr/check",
    {
      key,
      noCookie: "true",
      timestamp: Date.now(),
    },
    {
      includeCookie: false,
      allowCodes: [800, 801, 802, 803],
    },
  );

  const code = asNumber(response.code);
  if (code !== 800 && code !== 801 && code !== 802 && code !== 803) {
    throw new Error("NeteaseMusicAPI returned an unknown QR login status.");
  }

  return {
    code,
    message: asString(response.message),
    cookie: asString(response.cookie) ?? asString(asRecord(response.data)?.cookie),
  };
}

export async function getNeteaseLoggedInAccount(
  settings: AppSettings,
): Promise<NeteaseAccountProfile | null> {
  assertNeteaseEnabled(settings);

  const cookie = settings.network.neteaseCookie.trim();
  if (!cookie) {
    return null;
  }

  const statusResponse = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/login/status",
    {
      timestamp: Date.now(),
    },
  );
  const statusData = asRecord(statusResponse.data);
  const statusProfile = toNeteaseAccountProfile(statusData?.profile);

  if (statusProfile) {
    return statusProfile;
  }

  const accountResponse = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/user/account",
    {
      timestamp: Date.now(),
    },
  );
  const profile = toNeteaseAccountProfile(accountResponse.profile);

  if (profile) {
    return profile;
  }

  const account = asRecord(accountResponse.account);
  const userId = asNumber(account?.id) ?? asNumber(account?.userId);

  if (!userId) {
    return null;
  }

  const detailResponse = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/user/detail",
    {
      uid: String(userId),
      timestamp: Date.now(),
    },
  );

  return toNeteaseAccountProfile(detailResponse.profile);
}

export async function searchNeteaseSongs(
  settings: AppSettings,
  keywords: string,
  options: NeteaseSearchOptions = {},
): Promise<NeteaseSongSearchResult[]> {
  const page = await searchNeteaseSongResultsPage(settings, keywords, options);
  return page.items;
}

export async function searchNeteaseSongResultsPage(
  settings: AppSettings,
  keywords: string,
  options: NeteaseSearchOptions = {},
): Promise<NeteasePagedResult<NeteaseSongSearchResult>> {
  assertNeteaseEnabled(settings);

  const trimmedKeywords = keywords.trim();
  const limit = normalizePositiveInteger(options.limit, 20);
  const offset = normalizeNonNegativeInteger(options.offset, 0);
  if (!trimmedKeywords) {
    return createPagedResult([], {
      limit,
      offset,
      total: 0,
      hasMore: false,
    });
  }

  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    options.useCloudSearch === false ? "/search" : "/cloudsearch",
    {
      keywords: trimmedKeywords,
      limit,
      offset,
      type: normalizePositiveInteger(options.type, 1),
    },
  );

  const result = asRecord(response.result);
  const songs = asArray(result?.songs)
    .map((song) => toSongSearchResult(song))
    .filter((song): song is NeteaseSongSearchResult => song !== null);

  return createPagedResult(songs, {
    limit,
    offset,
    total: asNumber(result?.songCount),
    hasMore:
      asBoolean(result?.hasMore) ??
      (asNumber(result?.songCount) !== null
        ? offset + songs.length < (asNumber(result?.songCount) ?? 0)
        : songs.length >= limit),
  });
}

export async function searchNeteaseSongDetailsPage(
  settings: AppSettings,
  keywords: string,
  options: NeteaseSearchOptions = {},
): Promise<NeteasePagedResult<NeteaseSongDetail>> {
  const page = await searchNeteaseSongResultsPage(settings, keywords, options);
  const songIds = page.items.map((song) => song.id);
  const songDetails =
    songIds.length > 0 ? await getNeteaseSongDetail(settings, songIds) : [];
  const detailMap = new Map(songDetails.map((song) => [song.id, song]));
  const items = page.items.map(
    (song) =>
      detailMap.get(song.id) ?? {
        id: song.id,
        name: song.name,
        artists: song.artists,
        artistIds: [],
        album: song.album,
        albumId: null,
        albumArtist: song.artists[0] ?? null,
        durationMs: song.durationMs,
        artworkUrl: song.artworkUrl,
        trackNumber: null,
        discNumber: null,
        year: null,
        mvId: null,
        fee: null,
        requiresVip: false,
        copyrightRestricted: false,
        unavailableMessage: null,
      } satisfies NeteaseSongDetail,
  );

  return {
    ...page,
    items,
  };
}

export async function getNeteaseDefaultSearchKeyword(settings: AppSettings) {
  assertNeteaseEnabled(settings);

  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/search/default",
    {
      timestamp: Date.now(),
    },
    {
      includeCookie: false,
    },
  );
  const data = asRecord(response.data);

  return (
    asString(data?.realkeyword) ??
    asString(data?.showKeyword) ??
    asString(data?.keyword) ??
    ""
  );
}

export async function getNeteaseSearchHotKeywords(
  settings: AppSettings,
  limit = 12,
): Promise<NeteaseSearchHotKeyword[]> {
  assertNeteaseEnabled(settings);

  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/search/hot/detail",
    {
      timestamp: Date.now(),
    },
    {
      includeCookie: false,
    },
  );

  return asArray(response.data)
    .map((item) => toSearchHotKeyword(item))
    .filter((item): item is NeteaseSearchHotKeyword => item !== null)
    .slice(0, normalizePositiveInteger(limit, 12));
}

export async function getNeteaseSearchSuggestions(
  settings: AppSettings,
  keywords: string,
): Promise<NeteaseSearchSuggestions> {
  assertNeteaseEnabled(settings);

  const trimmedKeywords = keywords.trim();
  if (!trimmedKeywords) {
    return {
      songs: [],
      artists: [],
      playlists: [],
      albums: [],
    };
  }

  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/search/suggest",
    {
      keywords: trimmedKeywords,
      timestamp: Date.now(),
    },
    {
      includeCookie: false,
    },
  );

  const result = asRecord(response.result);

  return {
    songs: asArray(result?.songs)
      .map((song) => toSongDetail(song))
      .filter((song): song is NeteaseSongDetail => song !== null)
      .slice(0, 5),
    artists: asArray(result?.artists)
      .map((artist) => toArtistSummary(artist))
      .filter((artist): artist is NeteaseArtistSummary => artist !== null)
      .slice(0, 4),
    playlists: asArray(result?.playlists)
      .map((playlist) => toPlaylistRecommendation(playlist))
      .filter((playlist): playlist is NeteasePlaylistRecommendation => playlist !== null)
      .slice(0, 4),
    albums: asArray(result?.albums)
      .map((album) => toAlbumSummary(album))
      .filter((album): album is NeteaseAlbumSummary => album !== null)
      .slice(0, 4),
  };
}

export async function searchNeteaseArtists(
  settings: AppSettings,
  keywords: string,
  options: NeteaseSearchOptions = {},
): Promise<NeteaseArtistSummary[]> {
  assertNeteaseEnabled(settings);

  const trimmedKeywords = keywords.trim();
  if (!trimmedKeywords) {
    return [];
  }

  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    options.useCloudSearch === false ? "/search" : "/cloudsearch",
    {
      keywords: trimmedKeywords,
      limit: normalizePositiveInteger(options.limit, 18),
      offset: normalizeNonNegativeInteger(options.offset, 0),
      type: 100,
    },
  );

  return asArray(asRecord(response.result)?.artists)
    .map((artist) => toArtistSummary(artist))
    .filter((artist): artist is NeteaseArtistSummary => artist !== null);
}

export async function searchNeteaseAlbums(
  settings: AppSettings,
  keywords: string,
  options: NeteaseSearchOptions = {},
): Promise<NeteaseAlbumSummary[]> {
  assertNeteaseEnabled(settings);

  const trimmedKeywords = keywords.trim();
  if (!trimmedKeywords) {
    return [];
  }

  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    options.useCloudSearch === false ? "/search" : "/cloudsearch",
    {
      keywords: trimmedKeywords,
      limit: normalizePositiveInteger(options.limit, 18),
      offset: normalizeNonNegativeInteger(options.offset, 0),
      type: 10,
    },
  );

  return asArray(asRecord(response.result)?.albums)
    .map((album) => toAlbumSummary(album))
    .filter((album): album is NeteaseAlbumSummary => album !== null);
}

export async function searchNeteasePlaylists(
  settings: AppSettings,
  keywords: string,
  options: NeteaseSearchOptions = {},
): Promise<NeteasePlaylistRecommendation[]> {
  const page = await searchNeteasePlaylistsPage(settings, keywords, options);
  return page.items;
}

export async function searchNeteasePlaylistsPage(
  settings: AppSettings,
  keywords: string,
  options: NeteaseSearchOptions = {},
): Promise<NeteasePagedResult<NeteasePlaylistRecommendation>> {
  assertNeteaseEnabled(settings);

  const trimmedKeywords = keywords.trim();
  const limit = normalizePositiveInteger(options.limit, 18);
  const offset = normalizeNonNegativeInteger(options.offset, 0);
  if (!trimmedKeywords) {
    return createPagedResult([], {
      limit,
      offset,
      total: 0,
      hasMore: false,
    });
  }

  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    options.useCloudSearch === false ? "/search" : "/cloudsearch",
    {
      keywords: trimmedKeywords,
      limit,
      offset,
      type: 1000,
    },
  );

  const result = asRecord(response.result);
  const playlists = asArray(result?.playlists)
    .map((playlist) => toPlaylistRecommendation(playlist))
    .filter((playlist): playlist is NeteasePlaylistRecommendation => playlist !== null);

  return createPagedResult(playlists, {
    limit,
    offset,
    total: asNumber(result?.playlistCount),
    hasMore:
      asBoolean(result?.hasMore) ??
      (asNumber(result?.playlistCount) !== null
        ? offset + playlists.length < (asNumber(result?.playlistCount) ?? 0)
        : playlists.length >= limit),
  });
}

export async function getNeteaseArtistDetail(
  settings: AppSettings,
  id: number,
): Promise<NeteaseArtistDetail | null> {
  assertNeteaseEnabled(settings);

  const [artistResponse, detailResponse, descResponse] = await Promise.all([
    requestNeteaseJson<Record<string, unknown>>(
      settings,
      "/artists",
      {
        id: String(id),
        timestamp: Date.now(),
      },
      {
        includeCookie: false,
      },
    ).catch(() => ({})),
    requestNeteaseJson<Record<string, unknown>>(
      settings,
      "/artist/detail",
      {
        id: String(id),
        timestamp: Date.now(),
      },
      {
        includeCookie: false,
      },
    ).catch(() => ({})),
    requestNeteaseJson<Record<string, unknown>>(
      settings,
      "/artist/desc",
      {
        id: String(id),
        timestamp: Date.now(),
      },
      {
        includeCookie: false,
      },
    ).catch(() => ({})),
  ]);

  const artistPayload = asRecord(artistResponse);
  const detailPayload = asRecord(detailResponse);
  const detailData = asRecord(detailPayload?.data);
  const artist =
    asRecord(artistPayload?.artist) ??
    asRecord(detailData?.artist);
  const detail = toArtistDetail(artist, descResponse);

  return detail;
}

export async function getNeteaseArtistSongs(
  settings: AppSettings,
  id: number,
  limit = 500,
): Promise<NeteaseSongDetail[]> {
  const normalizedLimit = normalizePositiveInteger(limit, 500);
  const batchSize = Math.min(100, normalizedLimit);
  const songs: NeteaseSongDetail[] = [];
  let offset = 0;
  let shouldContinue = true;

  while (shouldContinue && songs.length < normalizedLimit) {
    const page = await getNeteaseArtistSongsPage(settings, id, {
      limit: batchSize,
      offset,
    });

    for (const song of page.items) {
      if (!songs.some((item) => item.id === song.id)) {
        songs.push(song);
      }
    }

    offset += page.items.length;
    shouldContinue =
      page.items.length > 0 &&
      offset < normalizedLimit &&
      (page.total === null ? page.hasMore : offset < page.total);
  }

  return songs.slice(0, normalizedLimit);
}

export async function getNeteaseArtistSongsPage(
  settings: AppSettings,
  id: number,
  options: {
    limit?: number;
    offset?: number;
  } = {},
): Promise<NeteasePagedResult<NeteaseSongDetail>> {
  assertNeteaseEnabled(settings);
  const limit = normalizePositiveInteger(options.limit, 50);
  const offset = normalizeNonNegativeInteger(options.offset, 0);

  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/artist/songs",
    {
      id: String(id),
      limit,
      offset,
      timestamp: Date.now(),
    },
    {
      includeCookie: false,
    },
  ).catch(() =>
    requestNeteaseJson<Record<string, unknown>>(
      settings,
      "/artists",
      {
        id: String(id),
        timestamp: Date.now(),
      },
      {
        includeCookie: false,
      },
    ),
  );

  const isHotSongsFallback = Boolean(response.hotSongs && !response.songs);
  const rawItems = asArray(response.songs ?? response.hotSongs)
    .map((song) => toSongDetail(song))
    .filter((song): song is NeteaseSongDetail => song !== null);
  const pagedItems = isHotSongsFallback
    ? rawItems.slice(offset, offset + limit)
    : rawItems;
  const items = await hydrateSongsWithFallbackDetails(settings, pagedItems);
  const total =
    asNumber(response.total) ??
    asNumber(response.num) ??
    (isHotSongsFallback ? rawItems.length : null);

  return createPagedResult(items, {
    limit,
    offset,
    total,
    hasMore:
      isHotSongsFallback
        ? offset + items.length < rawItems.length
        : asBoolean(response.more) ??
          (total !== null ? offset + items.length < total : items.length >= limit),
  });
}

export async function getNeteaseArtistAlbums(
  settings: AppSettings,
  id: number,
  limit = 12,
  offset = 0,
): Promise<NeteaseAlbumSummary[]> {
  const page = await getNeteaseArtistAlbumsPage(settings, id, {
    limit,
    offset,
  });
  return page.items;
}

export async function getNeteaseArtistAlbumsPage(
  settings: AppSettings,
  id: number,
  options: {
    limit?: number;
    offset?: number;
  } = {},
): Promise<NeteasePagedResult<NeteaseAlbumSummary>> {
  assertNeteaseEnabled(settings);
  const limit = normalizePositiveInteger(options.limit, 12);
  const offset = normalizeNonNegativeInteger(options.offset, 0);

  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/artist/album",
    {
      id: String(id),
      limit,
      offset,
      timestamp: Date.now(),
    },
    {
      includeCookie: false,
    },
  );

  const items = asArray(response.hotAlbums ?? response.albums)
    .map((album) => toAlbumSummary(album))
    .filter((album): album is NeteaseAlbumSummary => album !== null);
  const artistRecord = asRecord(response.artist);
  const total =
    asNumber(artistRecord?.albumSize) ??
    asNumber(artistRecord?.albumCount) ??
    null;

  return createPagedResult(items, {
    limit,
    offset,
    total,
    hasMore: asBoolean(response.more) ?? (total !== null ? offset + items.length < total : items.length >= limit),
  });
}

export async function getNeteaseAlbumDetail(
  settings: AppSettings,
  id: number,
): Promise<NeteaseAlbumDetail | null> {
  assertNeteaseEnabled(settings);

  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/album",
    {
      id: String(id),
      timestamp: Date.now(),
    },
    {
      includeCookie: false,
    },
  );

  const detail = toAlbumDetail(response);
  if (!detail) {
    return null;
  }

  return {
    ...detail,
    songs: await hydrateSongsWithFallbackDetails(settings, detail.songs, {
      fallbackArtworkUrl: detail.artworkUrl,
    }),
  };
}

export async function getNeteaseTopPlaylists(
  settings: AppSettings,
  options: {
    limit?: number;
    order?: "hot" | "new";
    category?: string;
  } = {},
): Promise<NeteasePlaylistRecommendation[]> {
  assertNeteaseEnabled(settings);

  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/top/playlist",
    {
      limit: normalizePositiveInteger(options.limit, 8),
      order: options.order ?? "hot",
      cat: options.category?.trim() || "全部",
      timestamp: Date.now(),
    },
    {
      includeCookie: false,
    },
  );

  return asArray(response.playlists)
    .map((playlist) => toPlaylistRecommendation(playlist))
    .filter((playlist): playlist is NeteasePlaylistRecommendation => playlist !== null)
    .slice(0, normalizePositiveInteger(options.limit, 8));
}

export async function getNeteaseHotPlaylistCategories(
  settings: AppSettings,
  limit = 8,
): Promise<string[]> {
  assertNeteaseEnabled(settings);

  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/playlist/hot",
    {
      timestamp: Date.now(),
    },
    {
      includeCookie: false,
    },
  );

  return asArray(response.tags)
    .map((tag) => asString(asRecord(tag)?.name))
    .filter((tag): tag is string => Boolean(tag))
    .slice(0, normalizePositiveInteger(limit, 8));
}

export async function getNeteaseHighQualityPlaylists(
  settings: AppSettings,
  options: {
    limit?: number;
    category?: string;
  } = {},
): Promise<NeteasePlaylistRecommendation[]> {
  assertNeteaseEnabled(settings);

  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/top/playlist/highquality",
    {
      limit: normalizePositiveInteger(options.limit, 6),
      cat: options.category?.trim() || "全部",
      timestamp: Date.now(),
    },
    {
      includeCookie: false,
    },
  );

  return asArray(response.playlists)
    .map((playlist) => toPlaylistRecommendation(playlist))
    .filter((playlist): playlist is NeteasePlaylistRecommendation => playlist !== null)
    .slice(0, normalizePositiveInteger(options.limit, 6));
}

export async function getNeteaseTopArtists(
  settings: AppSettings,
  limit = 8,
): Promise<NeteaseArtistSummary[]> {
  assertNeteaseEnabled(settings);

  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/top/artists",
    {
      limit: normalizePositiveInteger(limit, 8),
      offset: 0,
      timestamp: Date.now(),
    },
    {
      includeCookie: false,
    },
  );

  return asArray(response.artists)
    .map((artist) => toArtistSummary(artist))
    .filter((artist): artist is NeteaseArtistSummary => artist !== null)
    .slice(0, normalizePositiveInteger(limit, 8));
}

export async function getNeteaseNewestAlbums(
  settings: AppSettings,
  limit = 8,
): Promise<NeteaseAlbumSummary[]> {
  assertNeteaseEnabled(settings);

  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/album/newest",
    {
      timestamp: Date.now(),
    },
    {
      includeCookie: false,
    },
  );

  return asArray(response.albums)
    .map((album) => toAlbumSummary(album))
    .filter((album): album is NeteaseAlbumSummary => album !== null)
    .slice(0, normalizePositiveInteger(limit, 8));
}

export async function getNeteaseDailyRecommendedSongs(
  settings: AppSettings,
  limit = 12,
): Promise<NeteaseSongDetail[]> {
  assertNeteaseEnabled(settings);

  const response = await requestNeteaseJson<Record<string, unknown>>(settings, "/recommend/songs", {
    timestamp: Date.now(),
  });
  const data = asRecord(response.data);
  const songs = asArray(data?.dailySongs ?? response.dailySongs ?? response.recommend);

  return songs
    .map((song) => toSongDetail(song))
    .filter((song): song is NeteaseSongDetail => song !== null)
    .slice(0, normalizePositiveInteger(limit, 12));
}

export async function getNeteasePersonalizedNewSongs(
  settings: AppSettings,
  limit = 12,
): Promise<NeteaseSongDetail[]> {
  assertNeteaseEnabled(settings);

  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/personalized/newsong",
    {
      limit: normalizePositiveInteger(limit, 12),
      timestamp: Date.now(),
    },
    {
      includeCookie: false,
    },
  );
  const songs = asArray(response.result)
    .map((item) => {
      const record = asRecord(item);
      return record?.song ?? item;
    })
    .map((song) => toSongDetail(song))
    .filter((song): song is NeteaseSongDetail => song !== null);

  return songs.slice(0, normalizePositiveInteger(limit, 12));
}

export async function getNeteasePersonalFmSongs(
  settings: AppSettings,
  limit = 6,
): Promise<NeteaseSongDetail[]> {
  assertNeteaseEnabled(settings);

  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/personal_fm",
    {
      timestamp: Date.now(),
    },
  );
  const songs = asArray(response.data ?? response.recommend ?? response.list)
    .map((song) => toSongDetail(song))
    .filter((song): song is NeteaseSongDetail => song !== null);

  return songs.slice(0, normalizePositiveInteger(limit, 6));
}

export async function getNeteaseIntelligenceSongs(
  settings: AppSettings,
  playlistId: number,
  trackId: number,
  startTrackId?: number,
): Promise<NeteaseSongDetail[]> {
  assertNeteaseEnabled(settings);

  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/playmode/intelligence/list",
    {
      id: trackId,
      pid: playlistId,
      ...(typeof startTrackId === "number" && Number.isFinite(startTrackId) && startTrackId > 0
        ? { sid: startTrackId }
        : {}),
      timestamp: Date.now(),
    },
  );

  const payload = asRecord(response.data);
  const songs = asArray(payload?.data ?? payload?.songs ?? response.data ?? response.list)
    .map((item) => {
      const record = asRecord(item);
      return record?.songInfo ?? record?.song ?? item;
    })
    .map((song) => toSongDetail(song))
    .filter((song): song is NeteaseSongDetail => song !== null);

  return dedupeSongsById(songs);
}

export async function getNeteaseRecommendedPlaylists(
  settings: AppSettings,
  limit = 6,
): Promise<NeteasePlaylistRecommendation[]> {
  assertNeteaseEnabled(settings);

  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/personalized",
    {
      limit: normalizePositiveInteger(limit, 6),
      timestamp: Date.now(),
    },
    {
      includeCookie: false,
    },
  );

  return asArray(response.result)
    .map((playlist) => toPlaylistRecommendation(playlist))
    .filter((playlist): playlist is NeteasePlaylistRecommendation => playlist !== null)
    .slice(0, normalizePositiveInteger(limit, 6));
}

export async function getNeteaseUserPlaylists(
  settings: AppSettings,
  userId: number,
  limit = 20,
): Promise<NeteasePlaylistRecommendation[]> {
  assertNeteaseEnabled(settings);

  const response = await requestNeteaseJson<Record<string, unknown>>(settings, "/user/playlist", {
    uid: String(userId),
    limit: normalizePositiveInteger(limit, 20),
    timestamp: Date.now(),
  });

  return asArray(response.playlist)
    .map((playlist) => toPlaylistRecommendation(playlist))
    .filter((playlist): playlist is NeteasePlaylistRecommendation => playlist !== null)
    .slice(0, normalizePositiveInteger(limit, 20));
}

export async function getNeteasePlaylistDetail(
  settings: AppSettings,
  playlistId: number,
): Promise<NeteasePlaylistRecommendation | null> {
  assertNeteaseEnabled(settings);

  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/playlist/detail",
    {
      id: String(playlistId),
      timestamp: Date.now(),
    },
  );

  return toPlaylistRecommendation(asRecord(response.playlist));
}

export async function getNeteaseDailyRecommendedPlaylists(
  settings: AppSettings,
  limit = 6,
): Promise<NeteasePlaylistRecommendation[]> {
  assertNeteaseEnabled(settings);

  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/recommend/resource",
    {
      timestamp: Date.now(),
    },
  );

  return asArray(response.recommend)
    .map((playlist) => toPlaylistRecommendation(playlist))
    .filter((playlist): playlist is NeteasePlaylistRecommendation => playlist !== null)
    .slice(0, normalizePositiveInteger(limit, 6));
}

export async function getNeteaseLikedSongIds(
  settings: AppSettings,
  userId: number,
): Promise<number[]> {
  assertNeteaseEnabled(settings);

  const response = await requestNeteaseJson<Record<string, unknown>>(settings, "/likelist", {
    uid: String(userId),
    timestamp: Date.now(),
  });

  return asArray(response.ids)
    .map((id) => asNumber(id))
    .filter((id): id is number => id !== null);
}

export async function getNeteasePlaylistTracks(
  settings: AppSettings,
  playlistId: number,
  limit?: number,
  offset = 0,
): Promise<NeteaseSongDetail[]> {
  assertNeteaseEnabled(settings);

  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/playlist/track/all",
    {
      id: String(playlistId),
      limit: limit === undefined ? undefined : normalizePositiveInteger(limit, 200),
      offset: normalizeNonNegativeInteger(offset, 0),
      timestamp: Date.now(),
    },
  );

  return asArray(response.songs)
    .map((song) => toSongDetail(song))
    .filter((song): song is NeteaseSongDetail => song !== null);
}

export async function getAllNeteasePlaylistTracks(
  settings: AppSettings,
  playlistId: number,
  options: {
    batchSize?: number;
    expectedTotal?: number | null;
  } = {},
): Promise<NeteaseSongDetail[]> {
  assertNeteaseEnabled(settings);

  const batchSize = normalizePositiveInteger(options.batchSize, 200);
  const tracks: NeteaseSongDetail[] = [];
  let offset = 0;

  while (true) {
    const batch = await getNeteasePlaylistTracks(settings, playlistId, batchSize, offset);

    if (batch.length === 0) {
      break;
    }

    for (const track of batch) {
      if (!tracks.some((item) => item.id === track.id)) {
        tracks.push(track);
      }
    }

    offset += batch.length;
    const reachedExpectedTotal =
      options.expectedTotal !== null &&
      options.expectedTotal !== undefined &&
      offset >= options.expectedTotal;

    if (batch.length < batchSize || reachedExpectedTotal) {
      break;
    }
  }

  return tracks;
}

export async function likeNeteaseSong(
  settings: AppSettings,
  songId: number,
  like = true,
): Promise<void> {
  assertNeteaseEnabled(settings);

  await requestNeteaseJson<Record<string, unknown>>(settings, "/like", {
    id: String(songId),
    like: like ? "true" : "false",
    timestamp: Date.now(),
  });
}

export async function subscribeNeteasePlaylist(
  settings: AppSettings,
  playlistId: number,
  subscribe = true,
): Promise<void> {
  assertNeteaseEnabled(settings);

  await requestNeteaseJson<Record<string, unknown>>(settings, "/playlist/subscribe", {
    t: subscribe ? 1 : 2,
    id: String(playlistId),
    timestamp: Date.now(),
  });
}

export async function addTracksToNeteasePlaylist(
  settings: AppSettings,
  playlistId: number,
  trackIds: number[],
): Promise<void> {
  await manipulateTracksInNeteasePlaylist(settings, playlistId, trackIds, "add");
}

export async function removeTracksFromNeteasePlaylist(
  settings: AppSettings,
  playlistId: number,
  trackIds: number[],
): Promise<void> {
  await manipulateTracksInNeteasePlaylist(settings, playlistId, trackIds, "del");
}

async function manipulateTracksInNeteasePlaylist(
  settings: AppSettings,
  playlistId: number,
  trackIds: number[],
  operation: "add" | "del",
): Promise<void> {
  assertNeteaseEnabled(settings);

  const normalizedTrackIds = Array.from(
    new Set(trackIds.filter((trackId) => Number.isFinite(trackId))),
  );
  if (normalizedTrackIds.length === 0) {
    return;
  }

  await requestNeteaseJson<Record<string, unknown>>(settings, "/playlist/tracks", {
    op: operation,
    pid: String(playlistId),
    tracks: normalizedTrackIds.join(","),
    timestamp: Date.now(),
  });
}

export async function createNeteasePlaylist(
  settings: AppSettings,
  name: string,
): Promise<number | null> {
  assertNeteaseEnabled(settings);

  const normalizedName = name.trim();
  if (!normalizedName) {
    throw new Error("Playlist name cannot be empty.");
  }

  const response = await requestNeteaseJson<Record<string, unknown>>(settings, "/playlist/create", {
    name: normalizedName,
    timestamp: Date.now(),
  });

  const playlistRecord = asRecord(response.playlist) ?? asRecord(asRecord(response.data)?.playlist);
  return asNumber(playlistRecord?.id) ?? asNumber(asRecord(response.data)?.id) ?? asNumber(response.id) ?? null;
}

export async function deleteNeteasePlaylist(
  settings: AppSettings,
  playlistId: number,
): Promise<void> {
  assertNeteaseEnabled(settings);

  await requestNeteaseJson<Record<string, unknown>>(settings, "/playlist/delete", {
    id: String(playlistId),
    timestamp: Date.now(),
  });
}

export async function updateNeteasePlaylistName(
  settings: AppSettings,
  playlistId: number,
  name: string,
): Promise<void> {
  assertNeteaseEnabled(settings);

  const normalizedName = name.trim();
  if (!normalizedName) {
    throw new Error("Playlist name cannot be empty.");
  }

  await requestNeteaseJson<Record<string, unknown>>(settings, "/playlist/name/update", {
    id: String(playlistId),
    name: normalizedName,
    timestamp: Date.now(),
  });
}

export async function updateNeteasePlaylistDescription(
  settings: AppSettings,
  playlistId: number,
  description: string,
): Promise<void> {
  assertNeteaseEnabled(settings);

  await requestNeteaseJson<Record<string, unknown>>(settings, "/playlist/desc/update", {
    id: String(playlistId),
    desc: description.trim(),
    timestamp: Date.now(),
  });
}

export async function getNeteaseRecommendedDjs(
  settings: AppSettings,
  limit = 6,
): Promise<NeteaseDjRecommendation[]> {
  assertNeteaseEnabled(settings);

  const response = await requestNeteaseJson<Record<string, unknown>>(settings, "/dj/recommend", {
    timestamp: Date.now(),
  });
  const radios = asArray(asRecord(response.data)?.djRadios ?? response.djRadios);

  return radios
    .map((radio) => toDjRecommendation(radio))
    .filter((radio): radio is NeteaseDjRecommendation => radio !== null)
    .slice(0, normalizePositiveInteger(limit, 6));
}

export async function getNeteaseSongDetail(
  settings: AppSettings,
  id: number,
): Promise<NeteaseSongDetail | null>;
export async function getNeteaseSongDetail(
  settings: AppSettings,
  ids: number[],
): Promise<NeteaseSongDetail[]>;
export async function getNeteaseSongDetail(
  settings: AppSettings,
  idsOrId: number | number[],
): Promise<NeteaseSongDetail | null | NeteaseSongDetail[]> {
  assertNeteaseEnabled(settings);

  const ids = (Array.isArray(idsOrId) ? idsOrId : [idsOrId]).filter((value) =>
    Number.isFinite(value),
  );

  if (ids.length === 0) {
    return Array.isArray(idsOrId) ? [] : null;
  }

  const response = await requestNeteaseJson<Record<string, unknown>>(settings, "/song/detail", {
    ids: ids.join(","),
  });
  const details = asArray(response.songs)
    .map((song) => toSongDetail(song))
    .filter((song): song is NeteaseSongDetail => song !== null);

  if (Array.isArray(idsOrId)) {
    return details;
  }

  return details[0] ?? null;
}

export async function getNeteaseSongStream(
  settings: AppSettings,
  id: number,
  options: NeteaseStreamOptions = {},
): Promise<NeteaseSongStream> {
  assertNeteaseEnabled(settings);

  const response = await requestNeteaseJson<Record<string, unknown>>(settings, "/song/url/v1", {
    id: String(id),
    level: options.level ?? getPreferredNeteaseLevel(settings.playback.preferredQuality),
    timestamp: Date.now(),
  });
  const stream = toSongStream(asArray(response.data)[0]);

  if (!stream || !isUsableSongStream(stream)) {
    throw new Error("NeteaseMusicAPI did not return a playable song URL.");
  }

  return stream;
}

export async function getNeteaseSongStreamLegacy(
  settings: AppSettings,
  id: number,
  br: number,
): Promise<NeteaseSongStream | null> {
  assertNeteaseEnabled(settings);

  const response = await requestNeteaseJson<Record<string, unknown>>(settings, "/song/url", {
    id: String(id),
    br: String(br),
    timestamp: Date.now(),
  });

  const stream = toSongStream(asArray(response.data)[0]);
  return isUsableSongStream(stream) ? stream : null;
}

export async function getNeteaseMvStream(
  settings: AppSettings,
  mvId: number,
): Promise<NeteaseMvStream | null> {
  assertNeteaseEnabled(settings);

  if (!Number.isFinite(mvId) || mvId <= 0) {
    return null;
  }

  const cacheKey = buildNeteaseMvStreamProcessCacheKey(settings, mvId);
  const cachedEntry = neteaseMvStreamCache.get(cacheKey);
  if (cachedEntry) {
    if (cachedEntry.expiresAt > Date.now()) {
      return cachedEntry.value;
    }

    neteaseMvStreamCache.delete(cacheKey);
  }

  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/mv/url",
    {
      id: String(mvId),
      r: "1080",
      timestamp: Date.now(),
    },
    {
      includeCookie: false,
    },
  ).catch(() => null);

  const data = asRecord(response?.data);
  const url = asString(data?.url);
  const stream = url
    ? {
        mvId,
        url,
        resolution: asNumber(data?.r) ?? asNumber(data?.resolution),
      }
    : null;

  setTimedCacheValue(neteaseMvStreamCache, cacheKey, stream, NETEASE_MV_STREAM_CACHE_TTL_MS);
  return stream;
}

export async function getNeteaseSongDownloadStream(
  settings: AppSettings,
  id: number,
  br: number,
): Promise<NeteaseSongStream | null> {
  assertNeteaseEnabled(settings);

  const response = await requestNeteaseJson<Record<string, unknown>>(
    settings,
    "/song/download/url",
    {
      id: String(id),
      br: String(br),
      timestamp: Date.now(),
    },
  );
  const data = asRecord(response.data);

  if (!data) {
    return null;
  }

  const url = asString(data.url);
  if (!url) {
    return null;
  }

  return {
    id,
    url,
    br: asNumber(data.br),
    size: asNumber(data.size),
    type: asString(data.type),
    level: "download",
    code: asNumber(data.code),
    fee: asNumber(data.fee),
    isFreeTrial: false,
    trialStart: null,
    trialEnd: null,
  };
}

export async function getNeteaseSongLyrics(
  settings: AppSettings,
  id: number,
): Promise<NeteaseSongLyrics | null> {
  assertNeteaseEnabled(settings);

  const response = await requestNeteaseJson<Record<string, unknown>>(settings, "/lyric/new", {
    id: String(id),
  }).catch(() => null);

  if (!response) {
    return null;
  }

  const lrc = asRecord(response.lrc);
  const tlyric = asRecord(response.tlyric);
  const romalrc = asRecord(response.romalrc);
  const yrc = asRecord(response.yrc);
  const ytlrc = asRecord(response.ytlrc);
  const yromalrc = asRecord(response.yromalrc);
  const rawLyric = asString(lrc?.lyric);
  const rawDynamicLyric = asString(yrc?.lyric);
  const dynamicLines = parseNeteaseDynamicLyricLines(rawDynamicLyric);
  const baseTrackLines = parseTimedLyricTrack(rawLyric);
  const baseReferenceLines =
    dynamicLines.length > 0
      ? dynamicLines.map((line) => ({ startTimeMs: line.startTimeMs, text: line.text }))
      : baseTrackLines.map((line) => ({ startTimeMs: line.startTimeMs, text: line.text }));
  const rawTranslatedLyric = selectBestAuxiliaryLyricTrack(
    baseReferenceLines,
    asString(ytlrc?.lyric),
    asString(tlyric?.lyric),
    "translation",
  );
  const rawRomanizedLyric = selectBestAuxiliaryLyricTrack(
    baseReferenceLines,
    asString(yromalrc?.lyric),
    asString(romalrc?.lyric),
    "romanized",
  );
  const metadataEntries = mergeNeteaseLyricMetadataEntries(rawLyric, rawDynamicLyric);
  const lines = normalizeParsedLyricLines({
    rawLyric,
    rawTranslatedLyric,
    rawRomanizedLyric,
    rawDynamicLyric,
  });
  const lyrics: NeteaseSongLyrics = {
    lyric: rawLyric,
    translatedLyric: rawTranslatedLyric,
    romanizedLyric: rawRomanizedLyric,
    dynamicLyric: rawDynamicLyric,
    metadataEntries,
    lines,
    source: dynamicLines.length > 0 ? "word" : "line",
  };

  if (
    !lyrics.lyric &&
    !lyrics.translatedLyric &&
    !lyrics.romanizedLyric &&
    !lyrics.dynamicLyric
  ) {
    return null;
  }

  return lyrics;
}

export async function checkNeteaseSongAvailability(
  settings: AppSettings,
  id: number,
): Promise<boolean> {
  const result = await checkNeteaseSongAvailabilityDetail(settings, id);
  return result.success;
}

export async function checkNeteaseSongAvailabilityDetail(
  settings: AppSettings,
  id: number,
): Promise<{ success: boolean; message: string | null }> {
  assertNeteaseEnabled(settings);

  const response = await requestNeteaseJson<Record<string, unknown>>(settings, "/check/music", {
    id: String(id),
  });

  return {
    success: response.success === true,
    message: asString(response.message),
  };
}

export async function resolveNeteaseTrack(
  settings: AppSettings,
  id: number,
  options: ResolveNeteaseTrackOptions = {},
): Promise<NeteaseResolvedTrack> {
  assertNeteaseEnabled(settings);

  const cacheKey = buildNeteaseResolvedTrackProcessCacheKey(settings, id);

  if (!options.bypassCache) {
    const cachedResolvedTrack = getTimedCacheValue(neteaseResolvedTrackCache, cacheKey);
    if (cachedResolvedTrack) {
      return cachedResolvedTrack;
    }

    const inflightRequest = neteaseResolvedTrackInflight.get(cacheKey);
    if (inflightRequest) {
      return inflightRequest;
    }
  }

  const resolutionTask = (async () => {
    const [detail, availability, lyrics] = await Promise.all([
      options.detail && options.detail.artworkUrl
        ? Promise.resolve(options.detail)
        : getNeteaseSongDetail(settings, id).catch(() => options.detail ?? null),
      checkNeteaseSongAvailabilityDetail(settings, id).catch(() => null),
      getNeteaseSongLyrics(settings, id).catch(() => null),
    ]);

    if (!detail) {
      throw new Error(`Failed to load Netease song detail for id ${id}.`);
    }

    const candidates = await collectNeteaseStreamCandidates(settings, id);
    const stream = candidates[0];

    if (!stream?.url) {
      throw new Error(
        availability?.message ??
          detail.unavailableMessage ??
          "NeteaseMusicAPI did not return a playable song URL.",
      );
    }

    const resolvedTrack = {
      detail,
      stream,
      fallbackStreams: candidates.slice(1),
      lyrics,
      availability,
      notice: buildNeteasePlaybackNotice(detail, availability, candidates),
    };

    setTimedCacheValue(
      neteaseResolvedTrackCache,
      cacheKey,
      resolvedTrack,
      NETEASE_RESOLVED_TRACK_CACHE_TTL_MS,
    );

    return resolvedTrack;
  })();

  if (options.bypassCache) {
    return resolutionTask;
  }

  const trackedResolutionTask = resolutionTask.finally(() => {
    neteaseResolvedTrackInflight.delete(cacheKey);
  });
  neteaseResolvedTrackInflight.set(cacheKey, trackedResolutionTask);
  return trackedResolutionTask;
}

export async function registerNeteaseTrackToLibrary(
  settings: AppSettings,
  id: number,
  options: ResolveNeteaseTrackOptions = {},
): Promise<TrackRecord> {
  const resolved = await resolveNeteaseTrack(settings, id, options);
  return registerResolvedNeteaseTrackToLibrary(resolved);
}

export function createNeteaseTrackDraft(
  detail: NeteaseSongDetail,
  resolved?: Pick<NeteaseResolvedTrack, "stream" | "fallbackStreams"> | null,
): RemoteTrackDraft {
  return {
    title: detail.name,
    artist: joinArtists(detail.artists),
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
    cacheKey: buildNeteaseTrackCacheKey(detail.id),
  };
}

export async function registerNeteaseTrackMetadataToLibrary(
  detail: NeteaseSongDetail,
): Promise<TrackRecord> {
  return registerRemoteTrack(createNeteaseTrackDraft(detail));
}

export async function registerResolvedNeteaseTrackToLibrary(
  resolved: NeteaseResolvedTrack,
): Promise<TrackRecord> {
  return registerRemoteTrack(createNeteaseTrackDraft(resolved.detail, resolved));
}

export function buildNeteaseTrackCacheKey(id: number) {
  return `${NETEASE_TRACK_CACHE_KEY_PREFIX}${id}`;
}

export function parseNeteaseTrackIdFromCacheKey(cacheKey: string | null | undefined) {
  if (!cacheKey || !cacheKey.startsWith(NETEASE_TRACK_CACHE_KEY_PREFIX)) {
    return null;
  }

  const rawId = cacheKey.slice(NETEASE_TRACK_CACHE_KEY_PREFIX.length);
  const parsedId = Number(rawId);
  return Number.isFinite(parsedId) ? parsedId : null;
}

function buildNeteaseResolvedTrackProcessCacheKey(settings: AppSettings, id: number) {
  return [
    getNeteaseBaseUrl(settings).trim().toLowerCase(),
    settings.network.neteaseCookie.trim() || "guest",
    settings.network.neteaseProxy.trim() || "direct",
    settings.network.neteaseRealIp.trim() || "default",
    settings.playback.preferredQuality,
    `resolved:${id}`,
  ].join("::");
}

function buildNeteaseMvStreamProcessCacheKey(settings: AppSettings, mvId: number) {
  return [
    getNeteaseBaseUrl(settings).trim().toLowerCase(),
    settings.network.neteaseCookie.trim() || "guest",
    settings.network.neteaseProxy.trim() || "direct",
    settings.network.neteaseRealIp.trim() || "default",
    `mv:${mvId}`,
  ].join("::");
}

function getTimedCacheValue<T>(cache: Map<string, TimedCacheEntry<T>>, key: string) {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
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
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

async function requestNeteaseJson<T>(
  settings: AppSettings,
  path: string,
  query: Record<string, string | number | null | undefined> = {},
  options: {
    includeCookie?: boolean;
    allowCodes?: number[];
  } = {},
): Promise<T> {
  while (true) {
    await waitForNeteaseRateLimitCooldown();

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      controller.abort();
    }, Math.max(1000, settings.network.requestTimeoutMs));

    try {
      const response = await fetch(buildNeteaseRequestUrl(settings, path, query, options), {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      if (response.status === 405) {
        triggerNeteaseRateLimitCooldown();
        continue;
      }

      if (!response.ok) {
        throw new Error(`NeteaseMusicAPI request failed with status ${response.status}.`);
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const code = asNumber(payload.code);

      if (code === 405) {
        triggerNeteaseRateLimitCooldown();
        continue;
      }

      const isAllowedCode = typeof code === "number" && options.allowCodes?.includes(code);
      if (typeof code === "number" && code !== 200 && !isAllowedCode) {
        const message = asString(payload.message) ?? asString(payload.msg) ?? "Unknown API error.";
        throw new Error(`NeteaseMusicAPI error ${code}: ${message}`);
      }

      return payload as T;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("NeteaseMusicAPI request timed out.");
      }

      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }
}

async function waitForNeteaseRateLimitCooldown() {
  const remainingMs = neteaseRateLimitCooldownUntil - Date.now();
  if (remainingMs <= 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, remainingMs);
  });
}

function triggerNeteaseRateLimitCooldown() {
  neteaseRateLimitCooldownUntil = Math.max(
    neteaseRateLimitCooldownUntil,
    Date.now() + NETEASE_RATE_LIMIT_COOLDOWN_MS,
  );
}

function buildNeteaseRequestUrl(
  settings: AppSettings,
  path: string,
  query: Record<string, string | number | null | undefined>,
  options: {
    includeCookie?: boolean;
  } = {},
) {
  const url = new URL(path, `${getNeteaseBaseUrl(settings)}/`);

  Object.entries(query).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") {
      return;
    }

    url.searchParams.set(key, String(value));
  });

  if (options.includeCookie !== false && settings.network.neteaseCookie.trim()) {
    url.searchParams.set("cookie", settings.network.neteaseCookie.trim());
  }

  if (settings.network.neteaseProxy.trim()) {
    url.searchParams.set("proxy", settings.network.neteaseProxy.trim());
  }

  if (settings.network.neteaseRealIp.trim()) {
    url.searchParams.set("realIP", settings.network.neteaseRealIp.trim());
  }

  return url.toString();
}

function getNeteaseBaseUrl(settings: AppSettings) {
  const trimmedBaseUrl = settings.network.neteaseApiBaseUrl.trim().replace(/\/+$/, "");

  if (!settings.network.useLocalApiServer) {
    return trimmedBaseUrl || DEFAULT_NETEASE_BASE_URL;
  }

  if (localNeteaseApiRuntimeBaseUrl) {
    return localNeteaseApiRuntimeBaseUrl;
  }

  try {
    const parsed = new URL(trimmedBaseUrl || DEFAULT_NETEASE_BASE_URL);
    const port = parsed.port || "3000";

    return `http://127.0.0.1:${port}`;
  } catch {
    return DEFAULT_NETEASE_BASE_URL;
  }
}

function assertNeteaseEnabled(settings: AppSettings) {
  if (!isNeteaseSourceEnabled(settings)) {
    throw new Error("The Netease online source is currently disabled.");
  }
}

function getPreferredNeteaseLevel(preferredQuality: string) {
  switch (preferredQuality) {
    case "high":
      return "lossless";
    case "balanced":
      return "higher";
    case "data-saver":
      return "standard";
    default:
      return "lossless";
  }
}

function getPreferredNeteaseLevels(preferredQuality: string) {
  switch (preferredQuality) {
    case "high":
      return ["lossless", "exhigh", "higher", "standard"];
    case "balanced":
      return ["higher", "standard", "exhigh"];
    case "data-saver":
      return ["standard", "higher"];
    default:
      return ["lossless", "exhigh", "higher", "standard"];
  }
}

function getPreferredNeteaseBitrates(preferredQuality: string) {
  switch (preferredQuality) {
    case "high":
      return [999000, 320000, 192000, 128000];
    case "balanced":
      return [320000, 192000, 128000];
    case "data-saver":
      return [128000, 96000];
    default:
      return [999000, 320000, 192000, 128000];
  }
}

function toSongSearchResult(value: unknown): NeteaseSongSearchResult | null {
  const song = asRecord(value);
  const id = asNumber(song?.id);
  const name = asString(song?.name);

  if (!song || !id || !name) {
    return null;
  }

  const album = asRecord(song.al) ?? asRecord(song.album);

  return {
    id,
    name,
    artists: extractArtistNames(song.ar ?? song.artists),
    album: asString(album?.name),
    durationMs: asNumber(song.dt) ?? asNumber(song.duration),
    artworkUrl: resolveSongArtworkUrl(song, album),
  };
}

function toSearchHotKeyword(value: unknown): NeteaseSearchHotKeyword | null {
  const item = asRecord(value);
  const keyword =
    asString(item?.searchWord) ??
    asString(item?.word) ??
    asString(item?.keyword);

  if (!item || !keyword) {
    return null;
  }

  return {
    keyword,
    score: asNumber(item.score),
    iconType: asNumber(item.iconType),
  };
}

function toArtistSummary(value: unknown): NeteaseArtistSummary | null {
  const artist = asRecord(value);
  const id = asNumber(artist?.id);
  const name = asString(artist?.name);
  const alias = asArray(artist?.alias);

  if (!artist || !id || !name) {
    return null;
  }

  return {
    id,
    name,
    avatarUrl: normalizeNeteaseArtworkUrl(
      asString(artist.picUrl) ??
        asString(artist.img1v1Url) ??
        asString(artist.cover),
    ),
    briefDesc:
      asString(artist.briefDesc) ??
      asString(alias[0]) ??
      asString(artist.trans),
    musicCount: asNumber(artist.musicSize) ?? asNumber(artist.songSize),
    albumCount: asNumber(artist.albumSize),
  };
}

function toArtistDetail(
  artistValue: unknown,
  descValue: unknown,
): NeteaseArtistDetail | null {
  const detail = asRecord(artistValue);
  const summary = toArtistSummary(detail);
  const alias = asArray(detail?.alias)
    .map((value) => asString(value))
    .filter((value): value is string => Boolean(value));
  const description = toArtistDescription(descValue);

  if (!summary) {
    return null;
  }

  return {
    ...summary,
    coverUrl:
      normalizeNeteaseArtworkUrl(
        asString(detail?.cover) ??
          asString(detail?.coverUrl) ??
          asString(detail?.avatarImgIdStr),
      ) ?? summary.avatarUrl,
    description: description ?? summary.briefDesc,
    alias,
  };
}

function toAlbumSummary(value: unknown): NeteaseAlbumSummary | null {
  const album = asRecord(value);
  const id = asNumber(album?.id);
  const name = asString(album?.name);

  if (!album || !id || !name) {
    return null;
  }

  const artist =
    asRecord(album.artist) ??
    asRecord(asArray(album.artists)[0]);
  const publishTime = asNumber(album.publishTime);

  return {
    id,
    name,
    artistName: asString(artist?.name),
    artworkUrl: normalizeNeteaseArtworkUrl(
      asString(album.picUrl) ??
        asString(album.blurPicUrl) ??
        asString(album.coverUrl),
    ),
    trackCount: asNumber(album.size) ?? asNumber(album.songCount),
    publishYear: publishTime ? new Date(publishTime).getFullYear() : null,
  };
}

function toAlbumDetail(value: unknown): NeteaseAlbumDetail | null {
  const payload = asRecord(value);
  const albumRecord = asRecord(payload?.album);
  const summary = toAlbumSummary(albumRecord);

  if (!summary || !albumRecord) {
    return null;
  }

  return {
    ...summary,
    description:
      asString(albumRecord.description) ??
      asString(albumRecord.briefDesc),
    company: asString(albumRecord.company),
    type:
      asString(albumRecord.subType) ??
      asString(albumRecord.type),
    songs: asArray(payload?.songs)
      .map((song) => toSongDetail(song))
      .filter((song): song is NeteaseSongDetail => song !== null),
  };
}

function toSongDetail(value: unknown): NeteaseSongDetail | null {
  const song = asRecord(value);
  const id = asNumber(song?.id);
  const name = asString(song?.name);

  if (!song || !id || !name) {
    return null;
  }

  const album = asRecord(song.al) ?? asRecord(song.album);
  const albumArtist = asRecord(album?.artist);
  const privilege = asRecord(song.privilege);
  const noCopyrightRcmd = asRecord(song.noCopyrightRcmd);
  const publishTime = asNumber(song.publishTime) ?? asNumber(album?.publishTime);
  const fee = asNumber(song.fee) ?? asNumber(privilege?.fee);
  const privilegeStatus = asNumber(privilege?.st);
  const songStatus = asNumber(song.st);
  const mvId = asNumber(song.mv);
  const requiresVip = fee === 1 || fee === 8;
  const unavailableMessage =
    asString(noCopyrightRcmd?.typeDesc) ??
    asString(noCopyrightRcmd?.desc) ??
    (songStatus !== null && songStatus < 0 ? "当前歌曲暂时不可播放" : null);
  const copyrightRestricted =
    noCopyrightRcmd !== null || (privilegeStatus !== null && privilegeStatus < 0);

  return {
    id,
    name,
    artists: extractArtistNames(song.ar ?? song.artists),
    artistIds: extractArtistIds(song.ar ?? song.artists),
    album: asString(album?.name),
    albumId: asNumber(album?.id),
    albumArtist: asString(albumArtist?.name),
    durationMs: asNumber(song.dt) ?? asNumber(song.duration),
    artworkUrl: resolveSongArtworkUrl(song, album),
    trackNumber: asNumber(song.no),
    discNumber: normalizeDiscNumber(song.cd),
    year: publishTime ? new Date(publishTime).getFullYear() : null,
    mvId: typeof mvId === "number" && Number.isFinite(mvId) && mvId > 0 ? Math.round(mvId) : null,
    fee,
    requiresVip,
    copyrightRestricted,
    unavailableMessage,
  };
}

function dedupeSongsById(songs: NeteaseSongDetail[]) {
  return songs.reduce<NeteaseSongDetail[]>((collection, song) => {
    if (!collection.some((item) => item.id === song.id)) {
      collection.push(song);
    }

    return collection;
  }, []);
}

async function hydrateSongsWithFallbackDetails(
  settings: AppSettings,
  songs: NeteaseSongDetail[],
  options?: {
    fallbackArtworkUrl?: string | null;
  },
) {
  const normalizedSongs = songs.filter((song) => Number.isFinite(song.id));
  const missingArtworkIds = normalizedSongs
    .filter((song) => !song.artworkUrl)
    .map((song) => song.id);

  if (missingArtworkIds.length === 0) {
    return normalizedSongs.map((song) =>
      !song.artworkUrl && options?.fallbackArtworkUrl
        ? {
            ...song,
            artworkUrl: options.fallbackArtworkUrl,
          }
        : song,
    );
  }

  let detailedSongsById = new Map<number, NeteaseSongDetail>();

  try {
    const hydratedDetails: NeteaseSongDetail[] = [];

    for (let index = 0; index < missingArtworkIds.length; index += 100) {
      const detailBatch = await getNeteaseSongDetail(
        settings,
        missingArtworkIds.slice(index, index + 100),
      );
      hydratedDetails.push(...detailBatch);
    }

    detailedSongsById = new Map(
      hydratedDetails.map((song) => [song.id, song]),
    );
  } catch {
    detailedSongsById = new Map();
  }

  return normalizedSongs.map((song) => {
    const hydratedSong = detailedSongsById.get(song.id);
    const mergedSong = hydratedSong
      ? {
          ...hydratedSong,
          ...song,
          artists: song.artists.length > 0 ? song.artists : hydratedSong.artists,
          album: song.album ?? hydratedSong.album,
          albumArtist: song.albumArtist ?? hydratedSong.albumArtist,
          durationMs: song.durationMs ?? hydratedSong.durationMs,
          artworkUrl:
            song.artworkUrl ??
            hydratedSong.artworkUrl ??
            options?.fallbackArtworkUrl ??
            null,
          trackNumber: song.trackNumber ?? hydratedSong.trackNumber,
          discNumber: song.discNumber ?? hydratedSong.discNumber,
          year: song.year ?? hydratedSong.year,
          fee: song.fee ?? hydratedSong.fee,
          requiresVip: song.requiresVip || hydratedSong.requiresVip,
          copyrightRestricted:
            song.copyrightRestricted || hydratedSong.copyrightRestricted,
          unavailableMessage:
            song.unavailableMessage ?? hydratedSong.unavailableMessage,
        }
      : song;

    if (!mergedSong.artworkUrl && options?.fallbackArtworkUrl) {
      return {
        ...mergedSong,
        artworkUrl: options.fallbackArtworkUrl,
      };
    }

    return mergedSong;
  });
}

function toSongStream(value: unknown): NeteaseSongStream | null {
  const stream = asRecord(value);
  const id = asNumber(stream?.id);
  const url = asString(stream?.url);

  if (!id || !url) {
    return null;
  }

  return {
    id,
    url,
    br: asNumber(stream?.br),
    size: asNumber(stream?.size),
    type: asString(stream?.type),
    level: asString(stream?.level),
    code: asNumber(stream?.code),
    fee: asNumber(stream?.fee),
    isFreeTrial: asRecord(stream?.freeTrialInfo) !== null,
    trialStart: asNumber(asRecord(stream?.freeTrialInfo)?.start),
    trialEnd: asNumber(asRecord(stream?.freeTrialInfo)?.end),
  };
}

function isUsableSongStream(stream: NeteaseSongStream | null) {
  if (!stream?.url) {
    return false;
  }

  if (typeof stream.code === "number" && stream.code !== 200) {
    return false;
  }

  return true;
}

function toPlaylistRecommendation(value: unknown): NeteasePlaylistRecommendation | null {
  const playlist = asRecord(value);
  const id = asNumber(playlist?.id);
  const name = asString(playlist?.name);

  if (!playlist || !id || !name) {
    return null;
  }

  const creator = asRecord(playlist.creator);

  return {
    id,
    name,
    description:
      asString(playlist.copywriter) ??
      asString(playlist.rcmdtext) ??
      asString(playlist.description),
    artworkUrl: normalizeNeteaseArtworkUrl(
      asString(playlist.picUrl) ??
        asString(playlist.coverImgUrl) ??
        asString(playlist.coverUrl),
    ),
    trackCount: asNumber(playlist.trackCount),
    playCount: asNumber(playlist.playCount),
    creatorName: asString(creator?.nickname),
    creatorUserId: asNumber(creator?.userId) ?? asNumber(creator?.uid),
    subscribed: playlist.subscribed === true,
  };
}

function toDjRecommendation(value: unknown): NeteaseDjRecommendation | null {
  const radio = asRecord(value);
  const id = asNumber(radio?.id);
  const name = asString(radio?.name);

  if (!radio || !id || !name) {
    return null;
  }

  const dj = asRecord(radio.dj);

  return {
    id,
    name,
    description:
      asString(radio.rcmdtext) ??
      asString(radio.copywriter) ??
      asString(radio.desc) ??
      asString(radio.description),
    artworkUrl: normalizeNeteaseArtworkUrl(
      asString(radio.picUrl) ??
        asString(radio.intervenePicUrl) ??
        asString(radio.programPic) ??
        asString(radio.coverUrl),
    ),
    djName: asString(dj?.nickname),
    programCount: asNumber(radio.programCount),
    subscribedCount: asNumber(radio.subCount),
  };
}

function toArtistDescription(value: unknown) {
  const record = asRecord(value);
  const introduction = asArray(record?.introduction)
    .map((item) => {
      const section = asRecord(item);
      return asString(section?.txt);
    })
    .filter((item): item is string => Boolean(item))
    .join("\n\n");

  return (
    asString(record?.briefDesc) ??
    (introduction.trim() ? introduction.trim() : null)
  );
}

function extractArtistNames(value: unknown) {
  return asArray(value)
    .map((artist) => asString(asRecord(artist)?.name))
    .filter((artist): artist is string => Boolean(artist));
}

function extractArtistIds(value: unknown) {
  return asArray(value)
    .map((artist) => asNumber(asRecord(artist)?.id))
    .filter((artistId): artistId is number => Boolean(artistId));
}

function resolveSongArtworkUrl(
  song: Record<string, unknown> | null,
  album: Record<string, unknown> | null,
) {
  return normalizeNeteaseArtworkUrl(
    asString(album?.picUrl) ??
      asString(album?.blurPicUrl) ??
      asString(album?.coverUrl) ??
      asString(song?.picUrl) ??
      asString(song?.coverUrl) ??
      asString(song?.img80x80),
  );
}

function normalizeNeteaseArtworkUrl(url: string | null) {
  if (!url) {
    return null;
  }

  if (/^http:\/\/p\d+\.music\.126\.net\//i.test(url)) {
    return url.replace(/^http:\/\//i, "https://");
  }

  return url;
}

function normalizeDiscNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.split("/")[0]?.trim() ?? "";
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
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

function normalizeQrImage(value: string | null) {
  if (!value) {
    return null;
  }

  if (value.startsWith("data:image")) {
    return value;
  }

  return `data:image/png;base64,${value}`;
}

function parseNeteaseLyricMetadataEntries(rawDynamicLyric: string | null) {
  if (!rawDynamicLyric) {
    return [] as NeteaseLyricMetadataEntry[];
  }

  return rawDynamicLyric
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"))
    .map((line) => {
      try {
        const parsed = JSON.parse(line) as {
          t?: unknown;
          c?: Array<{ tx?: unknown; li?: unknown; or?: unknown }>;
        };
        const timeMs = asNumber(parsed.t) ?? 0;
        const chunks = Array.isArray(parsed.c) ? parsed.c : [];
        const text = chunks
          .map((chunk) => (typeof chunk?.tx === "string" ? chunk.tx : ""))
          .join("")
          .trim();
        const artworkUrl =
          chunks
            .map((chunk) => (typeof chunk?.li === "string" ? chunk.li : ""))
            .find(Boolean) || null;
        const target =
          chunks
            .map((chunk) => (typeof chunk?.or === "string" ? chunk.or : ""))
            .find(Boolean) || null;

        if (!text) {
          return null;
        }

        return {
          timeMs,
          text,
          artworkUrl,
          target,
        } satisfies NeteaseLyricMetadataEntry;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is NeteaseLyricMetadataEntry => entry !== null);
}

type ParsedTimedLyricLine = {
  startTimeMs: number;
  text: string;
  isEmpty: boolean;
  rawLine: string;
  sequence: number;
};

const NETEASE_LYRIC_TIME_TAG_PATTERN = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const NETEASE_LYRIC_OFFSET_TAG_PATTERN = /^\[offset:([+-]?\d+)\]$/i;
const NETEASE_LYRIC_METADATA_TAG_PATTERN =
  /^\[(?:ar|al|ti|by|offset|re|ve|au|length|kana|language|id|hash|sign|total|composer|lyricist|trans):.*\]$/i;
const LYRIC_INVISIBLE_CHARACTER_PATTERN = /[\u200b-\u200d\u2060\ufeff]/g;

function sanitizeLyricPrimaryText(text: string | null | undefined) {
  return (text ?? "")
    .replace(/\r?\n/g, "")
    .replace(LYRIC_INVISIBLE_CHARACTER_PATTERN, "")
    .replace(/\u00a0/g, " ")
    .replace(/\u3000/g, " ")
    .trim();
}

function hasMeaningfulLyricPrimaryText(text: string | null | undefined) {
  return sanitizeLyricPrimaryText(text).length > 0;
}

function compactParsedLyricLines(lines: NeteaseParsedLyricLine[]) {
  const visibleLines = lines.filter((line) => {
    if (hasMeaningfulLyricPrimaryText(line.text)) {
      return true;
    }

    return line.words.some((word) => hasMeaningfulLyricPrimaryText(word.text));
  });

  return visibleLines.map((line, index) => {
    const nextLine = visibleLines[index + 1] ?? null;
    const rawEndTimeMs =
      line.endTimeMs > line.startTimeMs
        ? line.endTimeMs
        : nextLine?.startTimeMs ?? line.startTimeMs;
    const resolvedEndTimeMs = nextLine
      ? Math.min(rawEndTimeMs, nextLine.startTimeMs)
      : rawEndTimeMs;
    const resolvedDurationMs = Math.max(0, resolvedEndTimeMs - line.startTimeMs);

    if (
      resolvedDurationMs === line.durationMs &&
      resolvedEndTimeMs === line.endTimeMs
    ) {
      return line;
    }

    return {
      ...line,
      durationMs: resolvedDurationMs,
      endTimeMs: resolvedEndTimeMs,
    } satisfies NeteaseParsedLyricLine;
  });
}

function mergeNeteaseLyricMetadataEntries(...rawTracks: Array<string | null>) {
  const mergedEntries = rawTracks.flatMap((rawTrack) => parseNeteaseLyricMetadataEntries(rawTrack));
  const dedupedEntries = new Map<string, NeteaseLyricMetadataEntry>();

  mergedEntries.forEach((entry) => {
    dedupedEntries.set(`${entry.timeMs}:${entry.text}`, entry);
  });

  return [...dedupedEntries.values()].sort((left, right) => left.timeMs - right.timeMs);
}

function parseLyricTimeTagToMs(match: RegExpMatchArray) {
  const minute = Number(match[1] ?? 0);
  const second = Number(match[2] ?? 0);
  const fractionRaw = match[3] ?? "0";
  const fractionMs =
    fractionRaw.length >= 3
      ? Number(fractionRaw.slice(0, 3))
      : fractionRaw.length === 2
        ? Number(fractionRaw) * 10
        : Number(fractionRaw) * 100;

  return minute * 60 * 1000 + second * 1000 + fractionMs;
}

function extractLyricOffsetMs(rawLyric: string | null) {
  if (!rawLyric) {
    return 0;
  }

  for (const rawLine of rawLyric.split(/\r?\n/)) {
    const match = rawLine.trim().match(NETEASE_LYRIC_OFFSET_TAG_PATTERN);
    if (match) {
      return Number(match[1] ?? 0) || 0;
    }
  }

  return 0;
}

function parseTimedLyricTrack(rawLyric: string | null) {
  if (!rawLyric) {
    return [] as ParsedTimedLyricLine[];
  }

  const entries: ParsedTimedLyricLine[] = [];
  const offsetMs = extractLyricOffsetMs(rawLyric);
  let sequence = 0;

  rawLyric.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      return;
    }

    if (line.startsWith("{") && line.endsWith("}")) {
      return;
    }

    if (NETEASE_LYRIC_METADATA_TAG_PATTERN.test(line) && !line.match(/\[\d{1,3}:\d{2}/)) {
      return;
    }

    const matches = [...line.matchAll(NETEASE_LYRIC_TIME_TAG_PATTERN)];
    if (matches.length === 0) {
      return;
    }

    const text = sanitizeLyricPrimaryText(line.replace(NETEASE_LYRIC_TIME_TAG_PATTERN, ""));
    matches.forEach((match) => {
      entries.push({
        startTimeMs: Math.max(0, parseLyricTimeTagToMs(match) + offsetMs),
        text,
        isEmpty: !hasMeaningfulLyricPrimaryText(text),
        rawLine: line,
        sequence: sequence,
      });
      sequence += 1;
    });
  });

  return entries.sort(
    (left, right) =>
      left.startTimeMs - right.startTimeMs || left.sequence - right.sequence,
  );
}

function parseNeteaseDynamicLyricLines(rawDynamicLyric: string | null) {
  if (!rawDynamicLyric) {
    return [] as NeteaseParsedLyricLine[];
  }

  const lines: NeteaseParsedLyricLine[] = [];

  rawDynamicLyric.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("{")) {
      return;
    }

    const lineMatch = line.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!lineMatch) {
      return;
    }

    const startTimeMs = Number(lineMatch[1] ?? 0);
    const durationMs = Number(lineMatch[2] ?? 0);
    const payload = lineMatch[3] ?? "";
    const words: NeteaseParsedLyricWord[] = [];
    const wordPattern = /\((\d+),(\d+),\d+\)([^()]*)/g;
    let wordMatch: RegExpExecArray | null;

    while ((wordMatch = wordPattern.exec(payload)) !== null) {
      const wordStartTimeMs = Number(wordMatch[1] ?? 0);
      const wordDurationMs = Number(wordMatch[2] ?? 0);
      const text = (wordMatch[3] ?? "").replace(/\r?\n/g, "");

      words.push({
        text,
        startTimeMs: wordStartTimeMs,
        durationMs: wordDurationMs,
        endTimeMs: wordStartTimeMs + wordDurationMs,
      });
    }

    const text =
      words.length > 0
        ? words.map((word) => word.text).join("")
        : sanitizeLyricPrimaryText(payload.replace(/\((\d+),(\d+),\d+\)/g, ""));

    if (!hasMeaningfulLyricPrimaryText(text)) {
      return;
    }

    lines.push({
      text,
      startTimeMs,
      durationMs,
      endTimeMs: startTimeMs + durationMs,
      translatedText: null,
      romanizedText: null,
      words,
    });
  });

  return lines.sort((left, right) => left.startTimeMs - right.startTimeMs);
}

function findBestTimedLyricMatch(
  baseLine: { startTimeMs: number; text: string },
  candidates: ParsedTimedLyricLine[],
) {
  let exactMatch: ParsedTimedLyricLine | null = null;
  let nearestMatch: ParsedTimedLyricLine | null = null;
  let nearestDifference = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (candidate.isEmpty) {
      continue;
    }

    const timeDifference = Math.abs(candidate.startTimeMs - baseLine.startTimeMs);
    if (timeDifference <= 90) {
      exactMatch = candidate;
      break;
    }

    if (timeDifference < nearestDifference && timeDifference <= 450) {
      nearestMatch = candidate;
      nearestDifference = timeDifference;
    }
  }

  return exactMatch ?? nearestMatch;
}

function normalizeLyricComparisonText(text: string | null) {
  if (!text) {
    return "";
  }

  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.,!?;:'"`~\-_=+*\\/|()[\]{}<>@#$%^&，。！？；：、·・「」『』【】《》〈〉]/g, "");
}

function sanitizeAuxiliaryLyricText(
  baseText: string,
  auxiliaryText: string | null,
  kind: "translation" | "romanized",
) {
  const trimmedText = auxiliaryText?.trim() ?? "";
  if (!trimmedText) {
    return null;
  }

  const normalizedBaseText = normalizeLyricComparisonText(baseText);
  const normalizedAuxiliaryText = normalizeLyricComparisonText(trimmedText);

  if (!normalizedAuxiliaryText) {
    return null;
  }

  if (normalizedAuxiliaryText === normalizedBaseText) {
    return null;
  }

  if (kind === "romanized" && !/[a-z]/i.test(trimmedText)) {
    return null;
  }

  return trimmedText;
}

function scoreAuxiliaryLyricTrack(
  baseLines: Array<{ startTimeMs: number; text: string }>,
  auxiliaryTrackLines: ParsedTimedLyricLine[],
  kind: "translation" | "romanized",
) {
  if (baseLines.length === 0 || auxiliaryTrackLines.length === 0) {
    return 0;
  }

  return baseLines.reduce((score, baseLine) => {
    if (!baseLine.text.trim()) {
      return score;
    }

    const matchedLine = findBestTimedLyricMatch(baseLine, auxiliaryTrackLines);
    const sanitizedText = sanitizeAuxiliaryLyricText(
      baseLine.text,
      matchedLine?.text ?? null,
      kind,
    );
    return sanitizedText ? score + 1 : score;
  }, 0);
}

function selectBestAuxiliaryLyricTrack(
  baseLines: Array<{ startTimeMs: number; text: string }>,
  primaryRawLyric: string | null,
  fallbackRawLyric: string | null,
  kind: "translation" | "romanized",
) {
  if (!primaryRawLyric && !fallbackRawLyric) {
    return null;
  }

  if (!primaryRawLyric) {
    return fallbackRawLyric;
  }

  if (!fallbackRawLyric) {
    return primaryRawLyric;
  }

  const primaryScore = scoreAuxiliaryLyricTrack(baseLines, parseTimedLyricTrack(primaryRawLyric), kind);
  const fallbackScore = scoreAuxiliaryLyricTrack(baseLines, parseTimedLyricTrack(fallbackRawLyric), kind);

  return primaryScore >= fallbackScore ? primaryRawLyric : fallbackRawLyric;
}

function normalizeParsedLyricLines(options: {
  rawLyric: string | null;
  rawTranslatedLyric: string | null;
  rawRomanizedLyric: string | null;
  rawDynamicLyric: string | null;
}) {
  const dynamicLines = parseNeteaseDynamicLyricLines(options.rawDynamicLyric);
  const baseTrackLines = parseTimedLyricTrack(options.rawLyric);
  const translatedTrackLines = parseTimedLyricTrack(options.rawTranslatedLyric);
  const romanizedTrackLines = parseTimedLyricTrack(options.rawRomanizedLyric);

  if (dynamicLines.length > 0) {
    return compactParsedLyricLines(dynamicLines.map((line) => {
      const translatedLine = findBestTimedLyricMatch(line, translatedTrackLines);
      const romanizedLine = findBestTimedLyricMatch(line, romanizedTrackLines);

      return {
        ...line,
        translatedText: sanitizeAuxiliaryLyricText(
          line.text,
          translatedLine?.text ?? null,
          "translation",
        ),
        romanizedText: sanitizeAuxiliaryLyricText(
          line.text,
          romanizedLine?.text ?? null,
          "romanized",
        ),
      } satisfies NeteaseParsedLyricLine;
    }));
  }

  return compactParsedLyricLines(baseTrackLines.map((line, index) => {
    const nextLine = baseTrackLines[index + 1] ?? null;
    const durationMs = nextLine ? Math.max(0, nextLine.startTimeMs - line.startTimeMs) : 0;
    const translatedLine = findBestTimedLyricMatch(line, translatedTrackLines);
    const romanizedLine = findBestTimedLyricMatch(line, romanizedTrackLines);

    return {
      text: line.text,
      startTimeMs: line.startTimeMs,
      durationMs,
      endTimeMs: line.startTimeMs + durationMs,
      translatedText: sanitizeAuxiliaryLyricText(
        line.text,
        translatedLine?.text ?? null,
        "translation",
      ),
      romanizedText: sanitizeAuxiliaryLyricText(
        line.text,
        romanizedLine?.text ?? null,
        "romanized",
      ),
      words: [],
    } satisfies NeteaseParsedLyricLine;
  }));
}

function toNeteaseAccountProfile(value: unknown): NeteaseAccountProfile | null {
  const profile = asRecord(value);
  const userId = asNumber(profile?.userId) ?? asNumber(profile?.uid);
  const nickname = asString(profile?.nickname);

  if (!profile || !userId || !nickname) {
    return null;
  }

  return {
    userId,
    nickname,
    avatarUrl: asString(profile.avatarUrl),
    backgroundUrl: asString(profile.backgroundUrl),
    signature: asString(profile.signature),
    level: asNumber(profile.level),
    vipType: asNumber(profile.vipType),
  };
}

function joinArtists(artists: string[]) {
  return artists.length > 0 ? artists.join(" / ") : null;
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.round(value);
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.round(value);
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function asBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }

    if (normalized === "false" || normalized === "0") {
      return false;
    }
  }

  return null;
}

function createPagedResult<T>(
  items: T[],
  options: {
    limit: number;
    offset: number;
    total?: number | null;
    hasMore?: boolean;
  },
): NeteasePagedResult<T> {
  const total = options.total ?? null;
  const hasMore =
    typeof options.hasMore === "boolean"
      ? options.hasMore
      : total !== null
        ? options.offset + items.length < total
        : items.length >= options.limit;

  return {
    items,
    total,
    limit: options.limit,
    offset: options.offset,
    hasMore,
  };
}

async function collectNeteaseStreamCandidates(
  settings: AppSettings,
  id: number,
): Promise<NeteaseSongStream[]> {
  const candidates: NeteaseSongStream[] = [];
  const seenUrls = new Set<string>();
  const primaryLevel = getPreferredNeteaseLevels(settings.playback.preferredQuality)[0] ?? "standard";

  const pushCandidate = (candidate: NeteaseSongStream | null) => {
    if (!candidate?.url || seenUrls.has(candidate.url)) {
      return;
    }

    seenUrls.add(candidate.url);
    candidates.push(candidate);
  };

  for (const level of getPreferredNeteaseLevels(settings.playback.preferredQuality)) {
    try {
      const candidate = await getNeteaseSongStream(settings, id, { level });
      pushCandidate(candidate);
      break;
    } catch {
      // Fall through to lower quality and alternative endpoints.
    }
  }

  if (candidates.length === 0) {
    for (const br of getPreferredNeteaseBitrates(settings.playback.preferredQuality)) {
      try {
        const candidate = await getNeteaseSongStreamLegacy(settings, id, br);
        pushCandidate(candidate);
        if (candidate?.url) {
          break;
        }
      } catch {
        // Continue trying lower bitrate fallbacks.
      }
    }
  }

  if (candidates.length === 0) {
    for (const br of getPreferredNeteaseBitrates(settings.playback.preferredQuality)) {
      try {
        const candidate = await getNeteaseSongDownloadStream(settings, id, br);
        pushCandidate(candidate);
        if (candidate?.url) {
          break;
        }
      } catch {
        // Download URL is a late-stage fallback and can fail independently.
      }
    }
  }

  if (candidates.length === 0) {
    pushCandidate({
      id,
      url: `https://music.163.com/song/media/outer/url?id=${id}.mp3`,
      br: null,
      size: null,
      type: "mp3",
      level: "outer",
      code: 200,
      fee: null,
      isFreeTrial: false,
      trialStart: null,
      trialEnd: null,
    });
  }

  if (candidates.length > 0 && candidates[0].level !== "outer" && candidates[0].level !== primaryLevel) {
    pushCandidate({
      id,
      url: `https://music.163.com/song/media/outer/url?id=${id}.mp3`,
      br: null,
      size: null,
      type: "mp3",
      level: "outer",
      code: 200,
      fee: null,
      isFreeTrial: false,
      trialStart: null,
      trialEnd: null,
    });
  }

  return candidates;
}

function buildNeteasePlaybackNotice(
  detail: NeteaseSongDetail,
  availability: { success: boolean; message: string | null } | null,
  candidates: NeteaseSongStream[],
) {
  const selectedCandidate = candidates[0] ?? null;

  if (selectedCandidate?.isFreeTrial && detail.requiresVip) {
    return "当前歌曲为会员曲目，已自动尝试试听或降级音质。";
  }

  if (
    selectedCandidate &&
    selectedCandidate.level === "outer" &&
    detail.requiresVip
  ) {
    return "当前歌曲可能需要会员或单曲购买，已切换兼容播放链接。";
  }

  if (
    selectedCandidate &&
    selectedCandidate.level === "outer" &&
    availability &&
    !availability.success &&
    availability.message
  ) {
    return availability.message;
  }

  if (
    selectedCandidate &&
    selectedCandidate.level === "outer" &&
    detail.copyrightRestricted &&
    detail.unavailableMessage
  ) {
    return detail.unavailableMessage;
  }

  return null;
}
