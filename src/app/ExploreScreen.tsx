import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import {
  UIButton,
  UILoadingBlock,
  UIPagination,
  SearchIcon,
} from "../ui/components";
import {
  getNeteaseAlbumDetail,
  getNeteaseArtistAlbumsPage,
  getNeteaseArtistDetail,
  getNeteaseArtistSongsPage,
  getNeteaseDefaultSearchKeyword,
  getNeteaseSearchSuggestions,
  getNeteaseHighQualityPlaylists,
  getNeteaseHotPlaylistCategories,
  getNeteaseNewestAlbums,
  getNeteasePersonalizedNewSongs,
  getNeteaseSearchHotKeywords,
  getNeteaseTopArtists,
  getNeteaseTopPlaylists,
  isNeteaseSourceEnabled,
  searchNeteaseAlbums,
  searchNeteaseArtists,
  searchNeteasePlaylistsPage,
  searchNeteaseSongDetailsPage,
} from "../network/netease";
import type {
  NeteaseAlbumDetail,
  NeteaseAlbumSummary,
  NeteaseArtistDetail,
  NeteaseArtistSummary,
  NeteasePagedResult,
  NeteasePlaylistRecommendation,
  NeteaseSearchHotKeyword,
  NeteaseSearchSuggestions,
  NeteaseSongDetail,
} from "../network/types";
import type { AppSettings } from "../settings/types";
import { setBoundedMapValue } from "./cache";

import "./styles.css";

type ExploreScreenProps = {
  locale: string;
  settings: AppSettings;
  externalDetailRequest?: {
    kind: "artist" | "album";
    id: number;
    name: string;
    key: number;
  } | null;
  externalBackLabel?: string | null;
  onConsumeExternalDetailRequest?: () => void;
  onReturnFromExternalDetail?: () => void;
  onOpenPlaylist: (playlist: { id: number; title: string }) => void;
  onPlayNeteaseTrack: (trackId: number, queueSongs: NeteaseSongDetail[]) => void;
  onSongContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    song: NeteaseSongDetail,
    queueSongs: NeteaseSongDetail[],
  ) => void;
  onPlaylistContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    playlist: NeteasePlaylistRecommendation,
  ) => void;
};

type ExploreTab = "all" | "songs" | "artists" | "playlists" | "albums";
type ExploreDetailView =
  | null
  | {
      kind: "artist";
      id: number;
      name: string;
      summary?: NeteaseArtistSummary | null;
    }
  | {
      kind: "album";
      id: number;
      name: string;
      summary?: NeteaseAlbumSummary | null;
    };

type ExploreNavigationSnapshot = {
  detailView: ExploreDetailView;
  searchKeyword: string;
  activeTab: ExploreTab;
  searchSongPage: number;
  searchPlaylistPage: number;
  externalBackLabel?: string | null;
};

type ExploreDiscoveryCache = {
  defaultKeyword: string;
  hotKeywords: NeteaseSearchHotKeyword[];
  categories: string[];
  featuredSongs: NeteaseSongDetail[];
  topPlaylists: NeteasePlaylistRecommendation[];
  qualityPlaylists: NeteasePlaylistRecommendation[];
  topArtists: NeteaseArtistSummary[];
  newestAlbums: NeteaseAlbumSummary[];
};

type ExploreSearchCache = {
  songs: NeteaseSongDetail[];
  songTotal: number;
  artists: NeteaseArtistSummary[];
  playlists: NeteasePlaylistRecommendation[];
  playlistTotal: number;
  albums: NeteaseAlbumSummary[];
};

type ExploreArtistCache = {
  detail: NeteaseArtistDetail | null;
  songs: NeteaseSongDetail[];
  songTotal: number;
  albums: NeteaseAlbumSummary[];
  albumTotal: number;
};

type ExploreSuggestionItem =
  | { kind: "song"; key: string; song: NeteaseSongDetail }
  | { kind: "artist"; key: string; artist: NeteaseArtistSummary }
  | { kind: "playlist"; key: string; playlist: NeteasePlaylistRecommendation }
  | { kind: "album"; key: string; album: NeteaseAlbumSummary };

const ALL_CATEGORY_KEY = "__all__";
const SEARCH_SONG_PAGE_SIZE = 30;
const SEARCH_PLAYLIST_PAGE_SIZE = 12;
const SEARCH_ARTIST_LIMIT = 12;
const SEARCH_ALBUM_LIMIT = 12;
const DETAIL_SONG_PAGE_SIZE = 50;
const DETAIL_ALBUM_PAGE_SIZE = 12;
const DISCOVERY_CACHE_LIMIT = 12;
const SEARCH_CACHE_LIMIT = 24;
const ARTIST_CACHE_LIMIT = 24;
const ALBUM_CACHE_LIMIT = 24;
const SEARCH_SUGGESTION_CACHE_LIMIT = 40;
const discoveryCache = new Map<string, ExploreDiscoveryCache>();
const searchCache = new Map<string, ExploreSearchCache>();
const artistCache = new Map<string, ExploreArtistCache>();
const albumCache = new Map<string, NeteaseAlbumDetail | null>();
const searchSuggestionCache = new Map<string, NeteaseSearchSuggestions>();

export function clearExploreMemoryCaches() {
  const summary = {
    discoveryCacheEntries: discoveryCache.size,
    searchCacheEntries: searchCache.size,
    artistCacheEntries: artistCache.size,
    albumCacheEntries: albumCache.size,
    searchSuggestionCacheEntries: searchSuggestionCache.size,
  };
  discoveryCache.clear();
  searchCache.clear();
  artistCache.clear();
  albumCache.clear();
  searchSuggestionCache.clear();
  return summary;
}

function getExploreCopy(locale: string) {
  if (locale === "en-US") {
    return {
      eyebrow: "Explore",
      title: "Music Discovery",
      description:
        "Search songs, artists, playlists, and albums, then browse trending searches, popular playlists, artists, and newest releases.",
      searchLabel: "Search",
      searchPlaceholder: "Search songs, artists, playlists, albums",
      searchButton: "Search",
      searchHelper: "Explore uses the Netease Cloud Music online source.",
      searchSuggestionsTitle: "Suggestions",
      searchSuggestionsEmpty: "No suggestions",
      tabs: {
        all: "All",
        songs: "Songs",
        artists: "Artists",
        playlists: "Playlists",
        albums: "Albums",
      } satisfies Record<ExploreTab, string>,
      sections: {
        hot: "Trending Searches",
        songs: "Recommended Songs",
        categories: "Playlist Categories",
        playlists: "Popular Playlists",
        quality: "Featured Playlists",
        artists: "Trending Artists",
        albums: "Latest Albums",
        results: "Search Results",
        artistSongs: "Artist Songs",
        artistAlbums: "Artist Albums",
        albumSongs: "Album Songs",
      },
      actions: {
        backToExplore: "Back to Explore",
        backToResults: "Back to Results",
        prevPage: "Previous",
        nextPage: "Next",
      },
      labels: {
        allCategory: "All",
        defaultKeyword: "Default keyword",
        resultCount: "results",
        source: "Netease",
        tracks: "tracks",
        songs: "songs",
        albums: "albums",
        page: "Page",
        songLimit: "Up to 100 song results",
        noArtistInfo: "No artist profile yet",
        noAlbumInfo: "No album description yet",
        noPlaylistInfo: "No playlist description yet",
        unknownArtist: "Unknown artist",
        unknownAlbum: "Unknown album",
      },
      states: {
        disabled:
          "Enable the Netease online source in settings before using Explore.",
        empty: "No content available right now.",
        emptySongs: "No songs found yet.",
        loadingDiscovery: "Loading discovery content...",
        loadingSearch: "Searching...",
        loadingArtist: "Loading artist details...",
        loadingAlbum: "Loading album details...",
        searchFailed: "Search failed",
        discoveryFailed: "Failed to load discovery content",
        artistFailed: "Failed to load artist details",
        albumFailed: "Failed to load album details",
      },
    };
  }

  return {
    eyebrow: "探索",
    title: "音乐探索",
    description:
      "搜索歌曲、歌手、歌单与专辑，同时浏览热搜趋势、热门歌单、歌手和最新专辑。",
    searchLabel: "搜索",
    searchPlaceholder: "搜索歌曲、歌手、歌单、专辑",
    searchButton: "立即搜索",
    searchHelper: "探索页使用网易云在线音乐源。",
    searchSuggestionsTitle: "搜索建议",
    searchSuggestionsEmpty: "暂无搜索建议",
    tabs: {
      all: "全部",
      songs: "歌曲",
      artists: "歌手",
      playlists: "歌单",
      albums: "专辑",
    } satisfies Record<ExploreTab, string>,
    sections: {
      hot: "热搜趋势",
      songs: "推荐歌曲",
      categories: "歌单分类",
      playlists: "热门歌单",
      quality: "精品歌单",
      artists: "热门歌手",
      albums: "最新专辑",
      results: "搜索结果",
      artistSongs: "歌手歌曲",
      artistAlbums: "歌手专辑",
      albumSongs: "专辑歌曲",
    },
    actions: {
      backToExplore: "返回探索",
      backToResults: "返回搜索结果",
      prevPage: "上一页",
      nextPage: "下一页",
    },
    labels: {
      allCategory: "全部",
      defaultKeyword: "默认关键词",
      resultCount: "条结果",
      source: "网易云",
      tracks: "首",
      songs: "首歌曲",
      albums: "张专辑",
      page: "第",
      songLimit: "歌曲结果最多显示前 100 条",
      noArtistInfo: "暂时没有更多歌手信息",
      noAlbumInfo: "暂时没有更多专辑信息",
      noPlaylistInfo: "暂时没有更多歌单信息",
      unknownArtist: "未知歌手",
      unknownAlbum: "未知专辑",
    },
    states: {
      disabled: "请先在设置中启用网易云在线源后再使用探索页。",
      empty: "当前暂无可展示内容。",
      emptySongs: "暂时没有可显示的歌曲。",
      loadingDiscovery: "正在加载探索内容...",
      loadingSearch: "正在搜索...",
      loadingArtist: "正在加载歌手详情...",
      loadingAlbum: "正在加载专辑详情...",
      searchFailed: "搜索失败",
      discoveryFailed: "探索内容加载失败",
      artistFailed: "歌手详情加载失败",
      albumFailed: "专辑详情加载失败",
    },
  };
}

function buildCacheKey(settings: AppSettings, scope: string) {
  const baseUrl = settings.network.neteaseApiBaseUrl.trim().toLowerCase() || "default";
  const cookie = settings.network.neteaseCookie.trim() || "guest";
  return `${baseUrl}::${cookie}::${scope}`;
}

function formatCompactCount(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDurationLabel(durationMs: number | null) {
  if (durationMs === null || durationMs <= 0) {
    return "--:--";
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function resolvePlaylistCategory(category: string) {
  return category === ALL_CATEGORY_KEY ? "全部" : category;
}

function resolvePagedTotal<T>(
  page: NeteasePagedResult<T>,
  fallbackTotal = 0,
) {
  const minimumKnownTotal =
    page.offset + page.items.length + (page.hasMore ? 1 : 0);

  return Math.max(
    fallbackTotal,
    page.total ?? minimumKnownTotal,
    minimumKnownTotal,
  );
}

function SongIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 6.5v9.5" />
      <path d="M9 6.5l8-1.5v8.5" />
      <path d="M9 16.5a2.5 2.5 0 11-2.5-2.5A2.5 2.5 0 019 16.5z" />
      <path d="M17 15a2.5 2.5 0 11-2.5-2.5A2.5 2.5 0 0117 15z" />
    </svg>
  );
}

function ArtistIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.5 10a2.5 2.5 0 110-5 2.5 2.5 0 010 5z" />
      <path d="M15.5 11.5a2 2 0 110-4 2 2 0 010 4z" />
      <path d="M4.5 18a4 4 0 018 0" />
      <path d="M12.5 18a3.2 3.2 0 016 0" />
    </svg>
  );
}

function AlbumIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="3" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 8.8v0.01" />
    </svg>
  );
}

function SectionHeader({
  title,
  count,
  extra,
}: {
  title: string;
  count: number;
  extra?: ReactNode;
}) {
  return (
    <div className="explore-section__header">
      <div className="explore-section__heading">
        <strong>{title}</strong>
        <span>{count}</span>
      </div>
      {extra ? <div className="explore-section__extra">{extra}</div> : null}
    </div>
  );
}

function EntityCard({
  title,
  description,
  artworkUrl,
  primaryMeta,
  secondaryMeta,
  fallbackIcon,
  onClick,
}: {
  title: string;
  description: string;
  artworkUrl: string | null;
  primaryMeta: string;
  secondaryMeta: string;
  fallbackIcon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className="home-media-card home-media-card--button explore-entity-card"
      type="button"
      onClick={onClick}
    >
      <div className="home-media-card__artwork" aria-hidden="true">
        {artworkUrl ? (
          <img src={artworkUrl} alt="" loading="lazy" />
        ) : (
          <span className="home-media-card__fallback">{fallbackIcon}</span>
        )}
      </div>
      <div className="home-media-card__copy">
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <div className="home-media-card__meta">
        <span>{primaryMeta}</span>
        <span>{secondaryMeta}</span>
      </div>
    </button>
  );
}

function PlaylistCard({
  playlist,
  locale,
  tracksSuffix,
  fallbackDescription,
  sourceLabel,
  onOpen,
  onContextMenu,
}: {
  playlist: NeteasePlaylistRecommendation;
  locale: string;
  tracksSuffix: string;
  fallbackDescription: string;
  sourceLabel: string;
  onOpen: (playlist: { id: number; title: string }) => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      className="home-media-card home-media-card--button home-media-card--compact playlist-preview-card"
      type="button"
      onClick={() => onOpen({ id: playlist.id, title: playlist.name })}
      onContextMenu={onContextMenu}
    >
      <div className="home-media-card__artwork" aria-hidden="true">
        {playlist.artworkUrl ? (
          <img src={playlist.artworkUrl} alt="" loading="lazy" />
        ) : (
          <span className="home-media-card__fallback">
            <AlbumIcon />
          </span>
        )}
      </div>
      <div className="home-media-card__copy">
        <strong>{playlist.name}</strong>
        <p>{playlist.description || fallbackDescription}</p>
      </div>
      <div className="home-media-card__meta">
        <span>
          {`${playlist.trackCount?.toLocaleString(locale) ?? "--"} ${tracksSuffix}`}
        </span>
        <span>{playlist.creatorName || sourceLabel}</span>
      </div>
    </button>
  );
}

function SongMetaButton({
  label,
  onClick,
  disabled = false,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className="song-meta-link"
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

function SongList({
  songs,
  queueSongs,
  sourceLabel,
  unknownArtistLabel,
  unknownAlbumLabel,
  onPlay,
  onArtistClick,
  onAlbumClick,
  onContextMenu,
  badgeBuilder,
}: {
  songs: NeteaseSongDetail[];
  queueSongs?: NeteaseSongDetail[];
  sourceLabel: string;
  unknownArtistLabel: string;
  unknownAlbumLabel: string;
  onPlay: (trackId: number, queueSongs: NeteaseSongDetail[]) => void;
  onArtistClick: (artistId: number, artistName: string) => void;
  onAlbumClick: (albumId: number, albumName: string) => void;
  onContextMenu?: (
    event: ReactMouseEvent<HTMLElement>,
    song: NeteaseSongDetail,
    queueSongs: NeteaseSongDetail[],
  ) => void;
  badgeBuilder?: (song: NeteaseSongDetail, index: number) => ReactNode;
}) {
  const playbackQueue = queueSongs ?? songs;

  return (
    <div className="home-song-list">
      {songs.map((song, index) => (
        <div
          key={song.id}
          className="home-song-card"
          role="button"
          tabIndex={0}
          onClick={() => onPlay(song.id, playbackQueue)}
          onContextMenu={(event) => onContextMenu?.(event, song, playbackQueue)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onPlay(song.id, playbackQueue);
            }
          }}
        >
          <span className="home-song-card__cover" aria-hidden="true">
            {song.artworkUrl ? (
              <img src={song.artworkUrl} alt="" loading="lazy" />
            ) : (
              <span className="home-song-card__cover-fallback">
                <SongIcon />
              </span>
            )}
          </span>
          <span className="home-song-card__copy">
            <span className="home-song-card__title">{song.name}</span>
            <span className="home-song-card__subtitle">
              <SongArtistLinks
                fallback={unknownArtistLabel}
                artists={song.artists.map((artistName, artistIndex) => ({
                  key: `${song.id}:artist:${artistName}:${artistIndex}`,
                  name: artistName,
                  onClick: song.artistIds[artistIndex]
                    ? () => onArtistClick(song.artistIds[artistIndex]!, artistName)
                    : undefined,
                }))}
              />
            </span>
          </span>
          <span className="home-song-card__meta">
            <SongMetaButton
              label={song.album || unknownAlbumLabel}
              onClick={() =>
                song.albumId ? onAlbumClick(song.albumId, song.album || unknownAlbumLabel) : undefined
              }
              disabled={!song.albumId}
            />
          </span>
          <span className="home-song-card__duration">
            {formatDurationLabel(song.durationMs)}
          </span>
          <span className="home-song-card__badge">
            {badgeBuilder ? badgeBuilder(song, index) : sourceLabel}
          </span>
        </div>
      ))}
    </div>
  );
}

function SearchResultSection({
  visible,
  title,
  count,
  extra,
  children,
}: {
  visible: boolean;
  title: string;
  count: number;
  extra?: ReactNode;
  children: ReactNode;
}) {
  if (!visible) {
    return null;
  }

  return (
    <section className="settings-card settings-card--list">
      <SectionHeader title={title} count={count} extra={extra} />
      {children}
    </section>
  );
}

function DetailHero({
  eyebrow,
  title,
  description,
  artworkUrl,
  fallbackIcon,
  stats,
}: {
  eyebrow: string;
  title: string;
  description: string;
  artworkUrl: string | null;
  fallbackIcon: ReactNode;
  stats: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="playlist-detail-card__hero">
      <div className="playlist-detail-card__artwork" aria-hidden="true">
        {artworkUrl ? (
          <img src={artworkUrl} alt="" loading="lazy" />
        ) : (
          <span className="playlist-detail-card__fallback">{fallbackIcon}</span>
        )}
      </div>
      <div className="playlist-detail-card__meta">
        <p className="settings-screen__eyebrow">{eyebrow}</p>
        <h3 className="settings-screen__title">{title}</h3>
        <p className="settings-screen__description">{description}</p>
        <div className="playlist-detail-card__stats">
          {stats.map((item) => (
            <div key={item.label} className="home-stat-card">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ExploreScreen({
  locale,
  settings,
  externalDetailRequest,
  externalBackLabel,
  onConsumeExternalDetailRequest,
  onReturnFromExternalDetail,
  onOpenPlaylist,
  onPlayNeteaseTrack,
  onSongContextMenu,
  onPlaylistContextMenu,
}: ExploreScreenProps) {
  const copy = getExploreCopy(locale);
  const isEnabled = isNeteaseSourceEnabled(settings);

  const [detailView, setDetailView] = useState<ExploreDetailView>(null);
  const [navigationStack, setNavigationStack] = useState<ExploreNavigationSnapshot[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchSuggestions, setSearchSuggestions] = useState<NeteaseSearchSuggestions>({
    songs: [],
    artists: [],
    playlists: [],
    albums: [],
  });
  const [isSearchSuggestionsLoading, setIsSearchSuggestionsLoading] = useState(false);
  const [isSearchSuggestionsOpen, setIsSearchSuggestionsOpen] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [activeTab, setActiveTab] = useState<ExploreTab>("all");
  const [searchSongPage, setSearchSongPage] = useState(1);
  const [searchPlaylistPage, setSearchPlaylistPage] = useState(1);
  const [artistSongPage, setArtistSongPage] = useState(1);
  const [artistAlbumPage, setArtistAlbumPage] = useState(1);
  const [albumSongPage, setAlbumSongPage] = useState(1);
  const [defaultKeyword, setDefaultKeyword] = useState("");
  const [hotKeywords, setHotKeywords] = useState<NeteaseSearchHotKeyword[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORY_KEY);
  const [featuredSongs, setFeaturedSongs] = useState<NeteaseSongDetail[]>([]);
  const [topPlaylists, setTopPlaylists] = useState<NeteasePlaylistRecommendation[]>([]);
  const [qualityPlaylists, setQualityPlaylists] = useState<NeteasePlaylistRecommendation[]>(
    [],
  );
  const [topArtists, setTopArtists] = useState<NeteaseArtistSummary[]>([]);
  const [newestAlbums, setNewestAlbums] = useState<NeteaseAlbumSummary[]>([]);
  const [songs, setSongs] = useState<NeteaseSongDetail[]>([]);
  const [songTotal, setSongTotal] = useState(0);
  const [artists, setArtists] = useState<NeteaseArtistSummary[]>([]);
  const [playlists, setPlaylists] = useState<NeteasePlaylistRecommendation[]>([]);
  const [playlistTotal, setPlaylistTotal] = useState(0);
  const [albums, setAlbums] = useState<NeteaseAlbumSummary[]>([]);
  const [artistDetail, setArtistDetail] = useState<NeteaseArtistDetail | null>(null);
  const [artistSongs, setArtistSongs] = useState<NeteaseSongDetail[]>([]);
  const [artistSongTotal, setArtistSongTotal] = useState(0);
  const [artistAlbums, setArtistAlbums] = useState<NeteaseAlbumSummary[]>([]);
  const [artistAlbumTotal, setArtistAlbumTotal] = useState(0);
  const [albumDetail, setAlbumDetail] = useState<NeteaseAlbumDetail | null>(null);
  const [isDiscoveryLoading, setIsDiscoveryLoading] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isSearchSongsLoading, setIsSearchSongsLoading] = useState(false);
  const [isSearchArtistsLoading, setIsSearchArtistsLoading] = useState(false);
  const [isSearchPlaylistsLoading, setIsSearchPlaylistsLoading] = useState(false);
  const [isSearchAlbumsLoading, setIsSearchAlbumsLoading] = useState(false);
  const [isArtistSongsLoading, setIsArtistSongsLoading] = useState(false);
  const [isArtistAlbumsLoading, setIsArtistAlbumsLoading] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const searchFieldRef = useRef<HTMLFormElement | null>(null);
  const lastSearchKeywordRef = useRef("");
  const lastArtistDetailKeyRef = useRef<number | null>(null);
  const songTotalRef = useRef(0);
  const playlistTotalRef = useRef(0);
  const artistSongTotalRef = useRef(0);
  const artistAlbumTotalRef = useRef(0);

  useEffect(() => {
    songTotalRef.current = songTotal;
  }, [songTotal]);

  useEffect(() => {
    playlistTotalRef.current = playlistTotal;
  }, [playlistTotal]);

  useEffect(() => {
    artistSongTotalRef.current = artistSongTotal;
  }, [artistSongTotal]);

  useEffect(() => {
    artistAlbumTotalRef.current = artistAlbumTotal;
  }, [artistAlbumTotal]);

  const visibleCategories = Array.from(
    new Set([ALL_CATEGORY_KEY, ...categories.filter((category) => category !== "全部")]),
  );
  const suggestionItems = useMemo<ExploreSuggestionItem[]>(
    () => [
      ...searchSuggestions.songs.map((song) => ({
        kind: "song" as const,
        key: `song:${song.id}`,
        song,
      })),
      ...searchSuggestions.artists.map((artist) => ({
        kind: "artist" as const,
        key: `artist:${artist.id}`,
        artist,
      })),
      ...searchSuggestions.playlists.map((playlist) => ({
        kind: "playlist" as const,
        key: `playlist:${playlist.id}`,
        playlist,
      })),
      ...searchSuggestions.albums.map((album) => ({
        kind: "album" as const,
        key: `album:${album.id}`,
        album,
      })),
    ],
    [searchSuggestions],
  );
  const hasSearchSuggestions = suggestionItems.length > 0;
  const totalResults = songTotal + artists.length + playlistTotal + albums.length;
  const isSearchMode = searchKeyword.trim().length > 0 && detailView === null;
  const isArtistMode = detailView?.kind === "artist";
  const isAlbumMode = detailView?.kind === "album";
  const totalSongPages = Math.max(1, Math.ceil(songTotal / SEARCH_SONG_PAGE_SIZE));
  const totalPlaylistPages = Math.max(
    1,
    Math.ceil(playlistTotal / SEARCH_PLAYLIST_PAGE_SIZE),
  );
  const totalArtistSongPages = Math.max(
    1,
    Math.ceil(artistSongTotal / DETAIL_SONG_PAGE_SIZE),
  );
  const totalArtistAlbumPages = Math.max(
    1,
    Math.ceil(artistAlbumTotal / DETAIL_ALBUM_PAGE_SIZE),
  );
  const visibleAlbumSongs = useMemo(() => {
    const start = (albumSongPage - 1) * DETAIL_SONG_PAGE_SIZE;
    return (albumDetail?.songs ?? []).slice(start, start + DETAIL_SONG_PAGE_SIZE);
  }, [albumDetail?.songs, albumSongPage]);
  const totalAlbumSongPages = Math.max(
    1,
    Math.ceil((albumDetail?.songs.length ?? 0) / DETAIL_SONG_PAGE_SIZE),
  );

  useEffect(() => {
    if (!visibleCategories.includes(selectedCategory)) {
      setSelectedCategory(ALL_CATEGORY_KEY);
    }
  }, [selectedCategory, visibleCategories]);

  useEffect(() => {
    setSearchSongPage(1);
    setSearchPlaylistPage(1);
  }, [searchKeyword]);

  useEffect(() => {
    if (searchSongPage > totalSongPages) {
      setSearchSongPage(totalSongPages);
    }
  }, [searchSongPage, totalSongPages]);

  useEffect(() => {
    if (searchPlaylistPage > totalPlaylistPages) {
      setSearchPlaylistPage(totalPlaylistPages);
    }
  }, [searchPlaylistPage, totalPlaylistPages]);

  useEffect(() => {
    setArtistSongPage(1);
  }, [detailView?.kind, detailView?.id]);

  useEffect(() => {
    if (artistSongPage > totalArtistSongPages) {
      setArtistSongPage(totalArtistSongPages);
    }
  }, [artistSongPage, totalArtistSongPages]);

  useEffect(() => {
    setArtistAlbumPage(1);
  }, [detailView?.kind, detailView?.id]);

  useEffect(() => {
    if (artistAlbumPage > totalArtistAlbumPages) {
      setArtistAlbumPage(totalArtistAlbumPages);
    }
  }, [artistAlbumPage, totalArtistAlbumPages]);

  useEffect(() => {
    setAlbumSongPage(1);
  }, [detailView?.kind, detailView?.id, albumDetail?.songs.length]);

  useEffect(() => {
    if (albumSongPage > totalAlbumSongPages) {
      setAlbumSongPage(totalAlbumSongPages);
    }
  }, [albumSongPage, totalAlbumSongPages]);

  useEffect(() => {
    if (!externalDetailRequest) {
      return;
    }

    setNavigationStack(
      externalBackLabel
        ? [
            {
              detailView: null,
              searchKeyword: "",
              activeTab: "all",
              searchSongPage: 1,
              searchPlaylistPage: 1,
              externalBackLabel,
            },
          ]
        : [],
    );
    setSearchKeyword("");
    setSearchInput("");
    setActiveTab("all");
    setSearchSongPage(1);
    setSearchPlaylistPage(1);
    setDetailView({
      kind: externalDetailRequest.kind,
      id: externalDetailRequest.id,
      name: externalDetailRequest.name,
    });
    onConsumeExternalDetailRequest?.();
  }, [externalBackLabel, externalDetailRequest, onConsumeExternalDetailRequest]);

  useEffect(() => {
    let cancelled = false;

    if (!isEnabled) {
      setDefaultKeyword("");
      setHotKeywords([]);
      setCategories([]);
      setFeaturedSongs([]);
      setTopPlaylists([]);
      setQualityPlaylists([]);
      setTopArtists([]);
      setNewestAlbums([]);
      setDiscoveryError(null);
      setIsDiscoveryLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsDiscoveryLoading(true);
    setDiscoveryError(null);

    void (async () => {
      try {
        const category = resolvePlaylistCategory(selectedCategory);
        const key = buildCacheKey(settings, `explore:discovery:${category}`);
        const cached = discoveryCache.get(key);

        if (cached) {
          if (cancelled) {
            return;
          }

          setDefaultKeyword(cached.defaultKeyword);
          setHotKeywords(cached.hotKeywords);
          setCategories(cached.categories);
          setFeaturedSongs(cached.featuredSongs);
          setTopPlaylists(cached.topPlaylists);
          setQualityPlaylists(cached.qualityPlaylists);
          setTopArtists(cached.topArtists);
          setNewestAlbums(cached.newestAlbums);
          setIsDiscoveryLoading(false);
          return;
        }

        const [
          nextDefaultKeyword,
          nextHotKeywords,
          nextCategories,
          nextFeaturedSongs,
          nextTopPlaylists,
          nextQualityPlaylists,
          nextTopArtists,
          nextNewestAlbums,
        ] = await Promise.all([
          getNeteaseDefaultSearchKeyword(settings).catch(() => ""),
          getNeteaseSearchHotKeywords(settings, 10).catch(() => []),
          getNeteaseHotPlaylistCategories(settings, 8).catch(() => []),
          getNeteasePersonalizedNewSongs(settings, 8).catch(() => []),
          getNeteaseTopPlaylists(settings, {
            category,
            limit: 6,
            order: "hot",
          }).catch(() => []),
          getNeteaseHighQualityPlaylists(settings, {
            category,
            limit: 6,
          }).catch(() => []),
          getNeteaseTopArtists(settings, 8).catch(() => []),
          getNeteaseNewestAlbums(settings, 8).catch(() => []),
        ]);

        const bundle: ExploreDiscoveryCache = {
          defaultKeyword: nextDefaultKeyword,
          hotKeywords: nextHotKeywords,
          categories: nextCategories,
          featuredSongs: nextFeaturedSongs,
          topPlaylists: nextTopPlaylists,
          qualityPlaylists: nextQualityPlaylists,
          topArtists: nextTopArtists,
          newestAlbums: nextNewestAlbums,
        };

        setBoundedMapValue(discoveryCache, key, bundle, DISCOVERY_CACHE_LIMIT);

        if (cancelled) {
          return;
        }

        setDefaultKeyword(bundle.defaultKeyword);
        setHotKeywords(bundle.hotKeywords);
        setCategories(bundle.categories);
        setFeaturedSongs(bundle.featuredSongs);
        setTopPlaylists(bundle.topPlaylists);
        setQualityPlaylists(bundle.qualityPlaylists);
        setTopArtists(bundle.topArtists);
        setNewestAlbums(bundle.newestAlbums);
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error("[explore] failed to load discovery content", error);
        setDiscoveryError(
          error instanceof Error && error.message
            ? error.message
            : copy.states.discoveryFailed,
        );
      } finally {
        if (!cancelled) {
          setIsDiscoveryLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [copy.states.discoveryFailed, isEnabled, selectedCategory, settings]);

  useEffect(() => {
    let cancelled = false;
    const keyword = searchKeyword.trim();
    const isKeywordChanged = lastSearchKeywordRef.current !== keyword;

    if (!isEnabled || keyword.length === 0) {
      lastSearchKeywordRef.current = "";
      songTotalRef.current = 0;
      playlistTotalRef.current = 0;
      setSongs([]);
      setSongTotal(0);
      setArtists([]);
      setPlaylists([]);
      setPlaylistTotal(0);
      setAlbums([]);
      setIsSearchSongsLoading(false);
      setIsSearchArtistsLoading(false);
      setIsSearchPlaylistsLoading(false);
      setIsSearchAlbumsLoading(false);
      setSearchError(null);
      return () => {
        cancelled = true;
      };
    }

    lastSearchKeywordRef.current = keyword;
    setIsSearchSongsLoading(true);
    setIsSearchArtistsLoading(true);
    setIsSearchPlaylistsLoading(true);
    setIsSearchAlbumsLoading(true);
    setSearchError(null);

    if (isKeywordChanged) {
      songTotalRef.current = 0;
      playlistTotalRef.current = 0;
      setSongs([]);
      setSongTotal(0);
      setArtists([]);
      setPlaylists([]);
      setPlaylistTotal(0);
      setAlbums([]);
    }

    void (async () => {
      try {
        const key = buildCacheKey(
          settings,
          `explore:search:${keyword.toLocaleLowerCase(locale)}:songs:${searchSongPage}:playlists:${searchPlaylistPage}`,
        );
        const cached = searchCache.get(key);

        if (cached) {
          if (cancelled) {
            return;
          }

          setSongs(cached.songs);
          songTotalRef.current = cached.songTotal;
          setSongTotal(cached.songTotal);
          setArtists(cached.artists);
          setPlaylists(cached.playlists);
          playlistTotalRef.current = cached.playlistTotal;
          setPlaylistTotal(cached.playlistTotal);
          setAlbums(cached.albums);
          setIsSearchSongsLoading(false);
          setIsSearchArtistsLoading(false);
          setIsSearchPlaylistsLoading(false);
          setIsSearchAlbumsLoading(false);
          return;
        }

        const partialBundle: ExploreSearchCache = {
          songs: [],
          songTotal: 0,
          artists: [],
          playlists: [],
          playlistTotal: 0,
          albums: [],
        };
        let completedCount = 0;
        let failedCount = 0;

        const finalizeRequest = () => {
          completedCount += 1;

          if (completedCount < 4 || cancelled) {
            return;
          }

          setBoundedMapValue(searchCache, key, partialBundle, SEARCH_CACHE_LIMIT);
          setSearchError(failedCount >= 4 ? copy.states.searchFailed : null);
        };

        void searchNeteaseSongDetailsPage(settings, keyword, {
          limit: SEARCH_SONG_PAGE_SIZE,
          offset: (searchSongPage - 1) * SEARCH_SONG_PAGE_SIZE,
        })
          .then((songPage) => {
            if (cancelled) {
              return;
            }

            partialBundle.songs = songPage.items;
            partialBundle.songTotal = resolvePagedTotal(songPage, songTotalRef.current);
            setSongs(partialBundle.songs);
            songTotalRef.current = partialBundle.songTotal;
            setSongTotal(partialBundle.songTotal);
          })
          .catch((error) => {
            failedCount += 1;
            console.error("[explore] failed to search songs", error);
          })
          .finally(() => {
            if (!cancelled) {
              setIsSearchSongsLoading(false);
            }
            finalizeRequest();
          });

        void searchNeteaseArtists(settings, keyword, { limit: SEARCH_ARTIST_LIMIT })
          .then((nextArtists) => {
            if (cancelled) {
              return;
            }

            partialBundle.artists = nextArtists;
            setArtists(nextArtists);
          })
          .catch((error) => {
            failedCount += 1;
            console.error("[explore] failed to search artists", error);
          })
          .finally(() => {
            if (!cancelled) {
              setIsSearchArtistsLoading(false);
            }
            finalizeRequest();
          });

        void searchNeteasePlaylistsPage(settings, keyword, {
          limit: SEARCH_PLAYLIST_PAGE_SIZE,
          offset: (searchPlaylistPage - 1) * SEARCH_PLAYLIST_PAGE_SIZE,
        })
          .then((playlistPage) => {
            if (cancelled) {
              return;
            }

            partialBundle.playlists = playlistPage.items;
            partialBundle.playlistTotal = resolvePagedTotal(
              playlistPage,
              playlistTotalRef.current,
            );
            setPlaylists(partialBundle.playlists);
            playlistTotalRef.current = partialBundle.playlistTotal;
            setPlaylistTotal(partialBundle.playlistTotal);
          })
          .catch((error) => {
            failedCount += 1;
            console.error("[explore] failed to search playlists", error);
          })
          .finally(() => {
            if (!cancelled) {
              setIsSearchPlaylistsLoading(false);
            }
            finalizeRequest();
          });

        void searchNeteaseAlbums(settings, keyword, { limit: SEARCH_ALBUM_LIMIT })
          .then((nextAlbums) => {
            if (cancelled) {
              return;
            }

            partialBundle.albums = nextAlbums;
            setAlbums(nextAlbums);
          })
          .catch((error) => {
            failedCount += 1;
            console.error("[explore] failed to search albums", error);
          })
          .finally(() => {
            if (!cancelled) {
              setIsSearchAlbumsLoading(false);
            }
            finalizeRequest();
          });
      } catch (error) {
        if (!cancelled) {
          console.error("[explore] failed to initialize search", error);
          setSearchError(
            error instanceof Error && error.message
              ? error.message
              : copy.states.searchFailed,
          );
          setIsSearchSongsLoading(false);
          setIsSearchArtistsLoading(false);
          setIsSearchPlaylistsLoading(false);
          setIsSearchAlbumsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    copy.states.searchFailed,
    isEnabled,
    locale,
    searchKeyword,
    searchPlaylistPage,
    searchSongPage,
    settings,
  ]);

  useEffect(() => {
    let cancelled = false;
    const artistDetailKey = detailView?.kind === "artist" ? detailView.id : null;
    const isArtistChanged = lastArtistDetailKeyRef.current !== artistDetailKey;

    if (detailView?.kind !== "artist") {
      lastArtistDetailKeyRef.current = null;
      artistSongTotalRef.current = 0;
      artistAlbumTotalRef.current = 0;
      setArtistDetail(null);
      setArtistSongs([]);
      setArtistSongTotal(0);
      setArtistAlbums([]);
      setArtistAlbumTotal(0);
      setIsArtistSongsLoading(false);
      setIsArtistAlbumsLoading(false);
      setDetailError(null);
      setIsDetailLoading(false);
      return () => {
        cancelled = true;
      };
    }

    lastArtistDetailKeyRef.current = detailView.id;
    setIsDetailLoading(true);
    setIsArtistSongsLoading(true);
    setIsArtistAlbumsLoading(true);
    setDetailError(null);

    if (isArtistChanged) {
      artistSongTotalRef.current = 0;
      artistAlbumTotalRef.current = 0;
      setArtistSongs([]);
      setArtistSongTotal(0);
      setArtistAlbums([]);
      setArtistAlbumTotal(0);
    }

    void (async () => {
      try {
        const key = buildCacheKey(
          settings,
          `explore:artist:${detailView.id}:songs:${artistSongPage}:albums:${artistAlbumPage}`,
        );
        const cached = artistCache.get(key);

        if (cached) {
          if (cancelled) {
            return;
          }

          setArtistDetail(cached.detail);
          setArtistSongs(cached.songs);
          artistSongTotalRef.current = cached.songTotal;
          setArtistSongTotal(cached.songTotal);
          setArtistAlbums(cached.albums);
          artistAlbumTotalRef.current = cached.albumTotal;
          setArtistAlbumTotal(cached.albumTotal);
          setIsArtistSongsLoading(false);
          setIsArtistAlbumsLoading(false);
          setIsDetailLoading(false);
          return;
        }

        const bundle: ExploreArtistCache = {
          detail: null,
          songs: [],
          songTotal: 0,
          albums: [],
          albumTotal: 0,
        };
        let completedCount = 0;

        const finalizeRequest = () => {
          completedCount += 1;

          if (completedCount < 3 || cancelled) {
            return;
          }

          setBoundedMapValue(artistCache, key, bundle, ARTIST_CACHE_LIMIT);
          setIsDetailLoading(false);
        };

        void getNeteaseArtistDetail(settings, detailView.id)
          .then((detail) => {
            if (cancelled) {
              return;
            }

            bundle.detail = detail;
            bundle.songTotal = Math.max(bundle.songTotal, detail?.musicCount ?? 0);
            bundle.albumTotal = Math.max(bundle.albumTotal, detail?.albumCount ?? 0);
            setArtistDetail(detail);
            artistSongTotalRef.current = bundle.songTotal;
            artistAlbumTotalRef.current = bundle.albumTotal;
            setArtistSongTotal(bundle.songTotal);
            setArtistAlbumTotal(bundle.albumTotal);
          })
          .catch((error) => {
            console.error("[explore] failed to load artist profile", error);
            if (!cancelled && !detailView.summary) {
              setDetailError(
                error instanceof Error && error.message
                  ? error.message
                  : copy.states.artistFailed,
              );
            }
          })
          .finally(() => {
            finalizeRequest();
          });

        void getNeteaseArtistSongsPage(settings, detailView.id, {
          limit: DETAIL_SONG_PAGE_SIZE,
          offset: (artistSongPage - 1) * DETAIL_SONG_PAGE_SIZE,
        })
          .then((songsPage) => {
            if (cancelled) {
              return;
            }

            bundle.songs = songsPage.items;
            bundle.songTotal = resolvePagedTotal(
              songsPage,
              Math.max(artistSongTotalRef.current, bundle.songTotal),
            );
            setArtistSongs(bundle.songs);
            artistSongTotalRef.current = bundle.songTotal;
            setArtistSongTotal(bundle.songTotal);
          })
          .catch((error) => {
            console.error("[explore] failed to load artist songs", error);
          })
          .finally(() => {
            if (!cancelled) {
              setIsArtistSongsLoading(false);
            }
            finalizeRequest();
          });

        void getNeteaseArtistAlbumsPage(settings, detailView.id, {
          limit: DETAIL_ALBUM_PAGE_SIZE,
          offset: (artistAlbumPage - 1) * DETAIL_ALBUM_PAGE_SIZE,
        })
          .then((albumsPage) => {
            if (cancelled) {
              return;
            }

            bundle.albums = albumsPage.items;
            bundle.albumTotal = resolvePagedTotal(
              albumsPage,
              Math.max(artistAlbumTotalRef.current, bundle.albumTotal),
            );
            setArtistAlbums(bundle.albums);
            artistAlbumTotalRef.current = bundle.albumTotal;
            setArtistAlbumTotal(bundle.albumTotal);
          })
          .catch((error) => {
            console.error("[explore] failed to load artist albums", error);
          })
          .finally(() => {
            if (!cancelled) {
              setIsArtistAlbumsLoading(false);
            }
            finalizeRequest();
          });
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error("[explore] failed to initialize artist detail", error);
        setDetailError(
          error instanceof Error && error.message
            ? error.message
            : copy.states.artistFailed,
        );
        setIsDetailLoading(false);
        setIsArtistSongsLoading(false);
        setIsArtistAlbumsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    artistAlbumPage,
    artistSongPage,
    copy.states.artistFailed,
    detailView,
    settings,
  ]);

  useEffect(() => {
    let cancelled = false;

    if (detailView?.kind !== "album") {
      setAlbumDetail(null);
      setDetailError(null);
      setIsDetailLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsDetailLoading(true);
    setDetailError(null);

    void (async () => {
      try {
        const key = buildCacheKey(settings, `explore:album:${detailView.id}`);
        const cached = albumCache.get(key);

        if (cached !== undefined) {
          if (cancelled) {
            return;
          }

          setAlbumDetail(cached);
          setIsDetailLoading(false);
          return;
        }

        const detail = await getNeteaseAlbumDetail(settings, detailView.id);
        setBoundedMapValue(albumCache, key, detail, ALBUM_CACHE_LIMIT);

        if (cancelled) {
          return;
        }

        setAlbumDetail(detail);
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error("[explore] failed to load album detail", error);
        setDetailError(
          error instanceof Error && error.message
            ? error.message
            : copy.states.albumFailed,
        );
      } finally {
        if (!cancelled) {
          setIsDetailLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [copy.states.albumFailed, detailView, settings]);

  useEffect(() => {
    const canShowSearchForm = detailView === null && searchKeyword.trim().length === 0;

    if (!canShowSearchForm) {
      setIsSearchSuggestionsOpen(false);
      setActiveSuggestionIndex(-1);
      return;
    }

    const trimmedKeyword = searchInput.trim();
    if (!trimmedKeyword) {
      setSearchSuggestions({
        songs: [],
        artists: [],
        playlists: [],
        albums: [],
      });
      setIsSearchSuggestionsLoading(false);
      setActiveSuggestionIndex(-1);
      return;
    }

    const cacheKey = buildCacheKey(settings, `suggest:${trimmedKeyword.toLowerCase()}`);
    const cachedSuggestions = searchSuggestionCache.get(cacheKey);
    if (cachedSuggestions) {
      setSearchSuggestions(cachedSuggestions);
      setIsSearchSuggestionsLoading(false);
      setActiveSuggestionIndex(-1);
      return;
    }

    let isCancelled = false;
    const timerId = window.setTimeout(() => {
      setIsSearchSuggestionsLoading(true);

      void getNeteaseSearchSuggestions(settings, trimmedKeyword)
        .then((nextSuggestions) => {
          if (isCancelled) {
            return;
          }

          setBoundedMapValue(
            searchSuggestionCache,
            cacheKey,
            nextSuggestions,
            SEARCH_SUGGESTION_CACHE_LIMIT,
          );
          setSearchSuggestions(nextSuggestions);
          setActiveSuggestionIndex(-1);
        })
        .catch((error) => {
          if (isCancelled) {
            return;
          }

          console.error("[explore] failed to load search suggestions", error);
          setSearchSuggestions({
            songs: [],
            artists: [],
            playlists: [],
            albums: [],
          });
          setActiveSuggestionIndex(-1);
        })
        .finally(() => {
          if (!isCancelled) {
            setIsSearchSuggestionsLoading(false);
          }
        });
    }, 180);

    return () => {
      isCancelled = true;
      window.clearTimeout(timerId);
    };
  }, [detailView, searchInput, searchKeyword, settings]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!searchFieldRef.current?.contains(event.target as Node)) {
        setIsSearchSuggestionsOpen(false);
        setActiveSuggestionIndex(-1);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, []);

  const closeSearchSuggestions = () => {
    setIsSearchSuggestionsOpen(false);
    setActiveSuggestionIndex(-1);
  };

  const performSearch = (keyword: string, nextTab: ExploreTab = "all") => {
    const normalizedKeyword = keyword.trim();
    setSearchInput(normalizedKeyword);
    setSearchKeyword(normalizedKeyword);
    setDetailView(null);
    setNavigationStack([]);
    setActiveTab(nextTab);
    setSearchSongPage(1);
    setSearchPlaylistPage(1);
    closeSearchSuggestions();
  };

  const submitSearch = () => {
    const keyword = searchInput.trim() || defaultKeyword.trim();
    performSearch(keyword, "all");
  };

  const applyKeyword = (keyword: string) => {
    performSearch(keyword, "all");
  };

  const handleSelectSuggestion = (item: ExploreSuggestionItem) => {
    switch (item.kind) {
      case "song":
        performSearch(item.song.name, "songs");
        break;
      case "artist":
        closeSearchSuggestions();
        setSearchInput(item.artist.name);
        openArtistDetail(item.artist);
        break;
      case "playlist":
        closeSearchSuggestions();
        setSearchInput(item.playlist.name);
        onOpenPlaylist({ id: item.playlist.id, title: item.playlist.name });
        break;
      case "album":
        closeSearchSuggestions();
        setSearchInput(item.album.name);
        openAlbumDetail(item.album);
        break;
    }
  };

  const captureNavigationSnapshot = (): ExploreNavigationSnapshot => ({
    detailView,
    searchKeyword,
    activeTab,
    searchSongPage,
    searchPlaylistPage,
  });

  const openArtistDetail = (artist: NeteaseArtistSummary) => {
    setNavigationStack((current) => [...current, captureNavigationSnapshot()]);
    setDetailView({
      kind: "artist",
      id: artist.id,
      name: artist.name,
      summary: artist,
    });
  };

  const openArtistDetailById = (artistId: number, artistName: string) => {
    openArtistDetail({
      id: artistId,
      name: artistName,
      avatarUrl: null,
      briefDesc: null,
      musicCount: null,
      albumCount: null,
    });
  };

  const openAlbumDetail = (album: NeteaseAlbumSummary) => {
    setNavigationStack((current) => [...current, captureNavigationSnapshot()]);
    setDetailView({
      kind: "album",
      id: album.id,
      name: album.name,
      summary: album,
    });
  };

  const openAlbumDetailById = (albumId: number, albumName: string) => {
    openAlbumDetail({
      id: albumId,
      name: albumName,
      artistName: null,
      artworkUrl: null,
      trackCount: null,
      publishYear: null,
    });
  };

  const leaveSearchMode = () => {
    closeSearchSuggestions();
    setDetailView(null);
    setNavigationStack([]);
    setSearchKeyword("");
    setActiveTab("all");
    setSearchSongPage(1);
    setSearchPlaylistPage(1);
  };

  const leaveDetailMode = () => {
    closeSearchSuggestions();
    const previousSnapshot = navigationStack[navigationStack.length - 1] ?? null;

    if (!previousSnapshot) {
      setDetailView(null);
      return;
    }

    if (previousSnapshot.externalBackLabel) {
      setNavigationStack([]);
      setDetailView(null);
      onReturnFromExternalDetail?.();
      return;
    }

    setNavigationStack((current) => current.slice(0, -1));
    setDetailView(previousSnapshot.detailView);
    setSearchKeyword(previousSnapshot.searchKeyword);
    setActiveTab(previousSnapshot.activeTab);
    setSearchSongPage(previousSnapshot.searchSongPage);
    setSearchPlaylistPage(previousSnapshot.searchPlaylistPage);
  };

  const shouldShowTab = (tab: Exclude<ExploreTab, "all">) =>
    activeTab === "all" || activeTab === tab;
  const isDetailMode = isArtistMode || isAlbumMode;
  const shouldShowExploreHeader = !isDetailMode && !isSearchMode;
  const shouldShowSearchForm = !isDetailMode && !isSearchMode;
  const shouldRenderSearchSuggestions =
    shouldShowSearchForm && isSearchSuggestionsOpen && searchInput.trim().length > 0;
  const artistSummary = detailView?.kind === "artist" ? detailView.summary ?? null : null;
  const albumSummary = detailView?.kind === "album" ? detailView.summary ?? null : null;
  const artistHero = isArtistMode
    ? {
        name: artistDetail?.name ?? artistSummary?.name ?? detailView?.name ?? "",
        description:
          artistDetail?.description ??
          artistSummary?.briefDesc ??
          copy.labels.noArtistInfo,
        artworkUrl: artistDetail?.coverUrl ?? artistDetail?.avatarUrl ?? artistSummary?.avatarUrl ?? null,
        musicCount: artistDetail?.musicCount ?? artistSummary?.musicCount ?? artistSongTotal,
        albumCount: artistDetail?.albumCount ?? artistSummary?.albumCount ?? artistAlbumTotal,
        alias: artistDetail?.alias ?? [],
      }
    : null;
  const albumHero = isAlbumMode
    ? {
        name: albumDetail?.name ?? albumSummary?.name ?? detailView?.name ?? "",
        description:
          albumDetail?.description ??
          albumDetail?.artistName ??
          albumSummary?.artistName ??
          copy.labels.noAlbumInfo,
        artworkUrl: albumDetail?.artworkUrl ?? albumSummary?.artworkUrl ?? null,
        artistName: albumDetail?.artistName ?? albumSummary?.artistName ?? copy.labels.unknownArtist,
        trackCount: albumDetail?.trackCount ?? albumSummary?.trackCount ?? null,
        info:
          albumDetail?.type ??
          albumDetail?.company ??
          (albumDetail?.publishYear !== null && albumDetail?.publishYear !== undefined
            ? String(albumDetail.publishYear)
            : albumSummary?.publishYear !== null && albumSummary?.publishYear !== undefined
              ? String(albumSummary.publishYear)
              : copy.labels.source),
      }
    : null;
  const showSearchSections =
    isSearchSongsLoading ||
    isSearchArtistsLoading ||
    isSearchPlaylistsLoading ||
    isSearchAlbumsLoading ||
    totalResults > 0;

  const previousSnapshot = navigationStack[navigationStack.length - 1] ?? null;
  const detailBackLabel = previousSnapshot?.detailView?.kind === "artist"
    ? locale === "en-US"
      ? "Back to Artist"
      : "返回歌手"
    : previousSnapshot?.detailView?.kind === "album"
      ? locale === "en-US"
        ? "Back to Album"
        : "返回专辑"
      : previousSnapshot?.externalBackLabel
        ? previousSnapshot.externalBackLabel
      : previousSnapshot?.searchKeyword.trim()
        ? copy.actions.backToResults
        : copy.actions.backToExplore;

  const firstPageLabel = locale === "en-US" ? "First page" : "首页";
  const lastPageLabel = locale === "en-US" ? "Last page" : "尾页";

  const handleSearchInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!shouldRenderSearchSuggestions || suggestionItems.length === 0) {
      if (event.key === "Escape") {
        closeSearchSuggestions();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestionIndex((current) => (current + 1) % suggestionItems.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestionIndex((current) =>
        current <= 0 ? suggestionItems.length - 1 : current - 1,
      );
      return;
    }

    if (event.key === "Enter" && activeSuggestionIndex >= 0) {
      event.preventDefault();
      handleSelectSuggestion(suggestionItems[activeSuggestionIndex]);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeSearchSuggestions();
    }
  };

  return (
    <section className="settings-screen explore-screen">
      {shouldShowExploreHeader ? (
        <header className="settings-screen__header">
          <div>
            <h2 className="settings-screen__title">{copy.title}</h2>
            <p className="settings-screen__description">{copy.description}</p>
          </div>
        </header>
      ) : null}

      {!isEnabled ? (
        <p className="library-empty">{copy.states.disabled}</p>
      ) : (
        <>
          {shouldShowSearchForm ? (
            <form
              className="explore-search"
              ref={searchFieldRef}
              onSubmit={(event) => {
                event.preventDefault();
                submitSearch();
              }}
            >
              <div className="explore-search__field">
                <label className="ui-field">
                  <span className="ui-field__label">{copy.searchLabel}</span>
                  <div className="explore-search__input-stack">
                    <span className="ui-input-shell">
                      <span className="ui-input-shell__prefix">
                        <SearchIcon />
                      </span>
                      <input
                        type="text"
                        value={searchInput}
                        placeholder={defaultKeyword || copy.searchPlaceholder}
                        onFocus={() => {
                          if (searchInput.trim()) {
                            setIsSearchSuggestionsOpen(true);
                          }
                        }}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setSearchInput(nextValue);
                          setIsSearchSuggestionsOpen(nextValue.trim().length > 0);
                          setActiveSuggestionIndex(-1);
                        }}
                        onKeyDown={handleSearchInputKeyDown}
                      />
                    </span>
                    {shouldRenderSearchSuggestions ? (
                      <div className="explore-search-suggestions">
                        <div className="explore-search-suggestions__header">
                          <span>{copy.searchSuggestionsTitle}</span>
                        </div>
                        {isSearchSuggestionsLoading ? (
                          <div className="explore-search-suggestions__state">
                            <UILoadingBlock label={copy.states.loadingSearch} variant="inline" />
                          </div>
                        ) : hasSearchSuggestions ? (
                          <div className="explore-search-suggestions__list">
                            {searchSuggestions.songs.length > 0 ? (
                              <div className="explore-search-suggestions__group">
                                <span className="explore-search-suggestions__group-title">
                                  {copy.tabs.songs}
                                </span>
                                {searchSuggestions.songs.map((song) => {
                                  const itemKey = `song:${song.id}`;
                                  const itemIndex = suggestionItems.findIndex((item) => item.key === itemKey);
                                  return (
                                    <button
                                      key={itemKey}
                                      type="button"
                                      className={[
                                        "explore-search-suggestion",
                                        activeSuggestionIndex === itemIndex
                                          ? "explore-search-suggestion--active"
                                          : "",
                                      ]
                                        .filter(Boolean)
                                        .join(" ")}
                                      onMouseDown={(event) => {
                                        event.preventDefault();
                                      }}
                                      onClick={() =>
                                        handleSelectSuggestion({
                                          kind: "song",
                                          key: itemKey,
                                          song,
                                        })
                                      }
                                    >
                                      <span className="explore-search-suggestion__title">
                                        {song.name}
                                      </span>
                                      <span className="explore-search-suggestion__meta">
                                        {song.artists.join(" / ") || copy.labels.unknownArtist}
                                        {song.album ? ` · ${song.album}` : ""}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            ) : null}
                            {searchSuggestions.artists.length > 0 ? (
                              <div className="explore-search-suggestions__group">
                                <span className="explore-search-suggestions__group-title">
                                  {copy.tabs.artists}
                                </span>
                                {searchSuggestions.artists.map((artist) => {
                                  const itemKey = `artist:${artist.id}`;
                                  const itemIndex = suggestionItems.findIndex((item) => item.key === itemKey);
                                  return (
                                    <button
                                      key={itemKey}
                                      type="button"
                                      className={[
                                        "explore-search-suggestion",
                                        activeSuggestionIndex === itemIndex
                                          ? "explore-search-suggestion--active"
                                          : "",
                                      ]
                                        .filter(Boolean)
                                        .join(" ")}
                                      onMouseDown={(event) => {
                                        event.preventDefault();
                                      }}
                                      onClick={() =>
                                        handleSelectSuggestion({
                                          kind: "artist",
                                          key: itemKey,
                                          artist,
                                        })
                                      }
                                    >
                                      <span className="explore-search-suggestion__title">
                                        {artist.name}
                                      </span>
                                      <span className="explore-search-suggestion__meta">
                                        {artist.briefDesc || copy.labels.source}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            ) : null}
                            {searchSuggestions.playlists.length > 0 ? (
                              <div className="explore-search-suggestions__group">
                                <span className="explore-search-suggestions__group-title">
                                  {copy.tabs.playlists}
                                </span>
                                {searchSuggestions.playlists.map((playlist) => {
                                  const itemKey = `playlist:${playlist.id}`;
                                  const itemIndex = suggestionItems.findIndex((item) => item.key === itemKey);
                                  return (
                                    <button
                                      key={itemKey}
                                      type="button"
                                      className={[
                                        "explore-search-suggestion",
                                        activeSuggestionIndex === itemIndex
                                          ? "explore-search-suggestion--active"
                                          : "",
                                      ]
                                        .filter(Boolean)
                                        .join(" ")}
                                      onMouseDown={(event) => {
                                        event.preventDefault();
                                      }}
                                      onClick={() =>
                                        handleSelectSuggestion({
                                          kind: "playlist",
                                          key: itemKey,
                                          playlist,
                                        })
                                      }
                                    >
                                      <span className="explore-search-suggestion__title">
                                        {playlist.name}
                                      </span>
                                      <span className="explore-search-suggestion__meta">
                                        {playlist.creatorName || copy.labels.source}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            ) : null}
                            {searchSuggestions.albums.length > 0 ? (
                              <div className="explore-search-suggestions__group">
                                <span className="explore-search-suggestions__group-title">
                                  {copy.tabs.albums}
                                </span>
                                {searchSuggestions.albums.map((album) => {
                                  const itemKey = `album:${album.id}`;
                                  const itemIndex = suggestionItems.findIndex((item) => item.key === itemKey);
                                  return (
                                    <button
                                      key={itemKey}
                                      type="button"
                                      className={[
                                        "explore-search-suggestion",
                                        activeSuggestionIndex === itemIndex
                                          ? "explore-search-suggestion--active"
                                          : "",
                                      ]
                                        .filter(Boolean)
                                        .join(" ")}
                                      onMouseDown={(event) => {
                                        event.preventDefault();
                                      }}
                                      onClick={() =>
                                        handleSelectSuggestion({
                                          kind: "album",
                                          key: itemKey,
                                          album,
                                        })
                                      }
                                    >
                                      <span className="explore-search-suggestion__title">
                                        {album.name}
                                      </span>
                                      <span className="explore-search-suggestion__meta">
                                        {album.artistName || copy.labels.source}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div className="explore-search-suggestions__state">
                            <span>{copy.searchSuggestionsEmpty}</span>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <span className="ui-field__helper">
                    {defaultKeyword
                      ? `${copy.searchHelper} ${copy.labels.defaultKeyword}: ${defaultKeyword}`
                      : copy.searchHelper}
                  </span>
                </label>
              </div>
              <div className="explore-search__action">
                <button className="explore-search__button" type="submit">
                  <span className="explore-search__button-icon" aria-hidden="true">
                    <svg viewBox="0 0 16 16" width="18" height="18">
                      <circle
                        cx="7"
                        cy="7"
                        r="4.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      />
                      <path
                        d="M10.5 10.5l3 3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                  <span className="explore-search__button-label">{copy.searchButton}</span>
                </button>
              </div>
            </form>
          ) : null}

          {isArtistMode ? (
            <div className="playlist-detail-view explore-detail-view">
              <UIButton variant="secondary" onClick={leaveDetailMode}>
                {detailBackLabel}
              </UIButton>
              {detailError && !artistHero ? (
                <section className="playlist-detail-card">
                  <p className="library-empty">{detailError}</p>
                </section>
              ) : artistHero ? (
                <>
                  <section className="playlist-detail-card">
                    <DetailHero
                      eyebrow={copy.tabs.artists}
                      title={artistHero.name}
                      description={artistHero.description}
                      artworkUrl={artistHero.artworkUrl}
                      fallbackIcon={<ArtistIcon />}
                      stats={[
                        {
                          label: copy.tabs.songs,
                          value: artistHero.musicCount?.toLocaleString(locale) ?? "--",
                        },
                        {
                          label: copy.tabs.albums,
                          value: artistHero.albumCount?.toLocaleString(locale) ?? "--",
                        },
                        {
                          label: "Alias",
                          value: artistHero.alias.join(" / ") || artistHero.name,
                        },
                      ]}
                    />
                  </section>

                  <section className="playlist-detail-card">
                    <SectionHeader
                      title={copy.sections.artistSongs}
                      count={artistSongTotal}
                    />
                    {isArtistSongsLoading && artistSongs.length === 0 ? (
                      <UILoadingBlock label={copy.states.loadingArtist} variant="list" items={5} />
                    ) : artistSongs.length === 0 ? (
                      <p className="library-empty">{copy.states.emptySongs}</p>
                    ) : (
                      <>
                        <SongList
                          songs={artistSongs}
                          queueSongs={artistSongs}
                          sourceLabel={copy.labels.source}
                          unknownArtistLabel={copy.labels.unknownArtist}
                          unknownAlbumLabel={copy.labels.unknownAlbum}
                          onPlay={onPlayNeteaseTrack}
                          onArtistClick={openArtistDetailById}
                          onAlbumClick={openAlbumDetailById}
                          onContextMenu={onSongContextMenu}
                          badgeBuilder={(_, index) =>
                            `#${(artistSongPage - 1) * DETAIL_SONG_PAGE_SIZE + index + 1}`
                          }
                        />
                        {totalArtistSongPages > 1 ? (
                          <UIPagination
                            currentPage={artistSongPage}
                            totalPages={totalArtistSongPages}
                            pageLabel={copy.labels.page}
                            firstPageLabel={firstPageLabel}
                            previousPageLabel={copy.actions.prevPage}
                            nextPageLabel={copy.actions.nextPage}
                            lastPageLabel={lastPageLabel}
                            onPageChange={setArtistSongPage}
                          />
                        ) : null}
                      </>
                    )}
                  </section>

                  <section className="playlist-detail-card">
                    <SectionHeader
                      title={copy.sections.artistAlbums}
                      count={artistAlbumTotal}
                    />
                    {isArtistAlbumsLoading && artistAlbums.length === 0 ? (
                      <UILoadingBlock label={copy.states.loadingArtist} variant="grid" items={4} />
                    ) : artistAlbums.length === 0 ? (
                      <p className="library-empty">{copy.states.empty}</p>
                    ) : (
                      <>
                        <div className="explore-entity-grid">
                          {artistAlbums.map((album) => (
                            <EntityCard
                              key={album.id}
                              title={album.name}
                              description={album.artistName || artistHero.name}
                              artworkUrl={album.artworkUrl}
                              primaryMeta={
                                album.trackCount !== null
                                  ? `${album.trackCount} ${copy.labels.tracks}`
                                  : copy.labels.source
                              }
                              secondaryMeta={
                                album.publishYear !== null
                                  ? String(album.publishYear)
                                  : copy.labels.source
                              }
                              fallbackIcon={<AlbumIcon />}
                              onClick={() => openAlbumDetail(album)}
                            />
                          ))}
                        </div>
                        {totalArtistAlbumPages > 1 ? (
                          <UIPagination
                            currentPage={artistAlbumPage}
                            totalPages={totalArtistAlbumPages}
                            pageLabel={copy.labels.page}
                            firstPageLabel={firstPageLabel}
                            previousPageLabel={copy.actions.prevPage}
                            nextPageLabel={copy.actions.nextPage}
                            lastPageLabel={lastPageLabel}
                            onPageChange={setArtistAlbumPage}
                          />
                        ) : null}
                      </>
                    )}
                  </section>
                </>
              ) : (
                <>
                  <section className="playlist-detail-card">
                    <UILoadingBlock label={copy.states.loadingArtist} variant="list" items={5} />
                  </section>
                  <section className="playlist-detail-card">
                    <SectionHeader title={copy.sections.artistSongs} count={artistSongTotal} />
                    <UILoadingBlock label={copy.states.loadingArtist} variant="list" items={5} />
                  </section>
                  <section className="playlist-detail-card">
                    <SectionHeader title={copy.sections.artistAlbums} count={artistAlbumTotal} />
                    <UILoadingBlock label={copy.states.loadingArtist} variant="grid" items={4} />
                  </section>
                </>
              )}
            </div>
          ) : isAlbumMode ? (
            <div className="playlist-detail-view explore-detail-view">
              <UIButton variant="secondary" onClick={leaveDetailMode}>
                {detailBackLabel}
              </UIButton>
              {detailError && !albumHero ? (
                <p className="library-empty">{detailError}</p>
              ) : albumHero ? (
                <>
                  <section className="playlist-detail-card">
                    <DetailHero
                      eyebrow={copy.tabs.albums}
                      title={albumHero.name}
                      description={albumHero.description}
                      artworkUrl={albumHero.artworkUrl}
                      fallbackIcon={<AlbumIcon />}
                      stats={[
                        {
                          label: copy.tabs.artists,
                          value: albumHero.artistName,
                        },
                        {
                          label: copy.tabs.songs,
                          value: albumHero.trackCount?.toLocaleString(locale) ?? "--",
                        },
                        {
                          label: "Info",
                          value: albumHero.info,
                        },
                      ]}
                    />
                  </section>

                  <section className="playlist-detail-card">
                    <SectionHeader
                      title={copy.sections.albumSongs}
                      count={albumDetail?.songs.length ?? albumHero.trackCount ?? 0}
                    />
                    {isDetailLoading && !albumDetail ? (
                      <UILoadingBlock label={copy.states.loadingAlbum} variant="list" items={5} />
                    ) : (albumDetail?.songs.length ?? 0) === 0 ? (
                      <p className="library-empty">{copy.states.emptySongs}</p>
                    ) : (
                      <>
                        <SongList
                          songs={visibleAlbumSongs}
                          queueSongs={albumDetail?.songs ?? []}
                          sourceLabel={copy.labels.source}
                          unknownArtistLabel={copy.labels.unknownArtist}
                          unknownAlbumLabel={copy.labels.unknownAlbum}
                          onPlay={onPlayNeteaseTrack}
                          onArtistClick={openArtistDetailById}
                          onAlbumClick={openAlbumDetailById}
                          onContextMenu={onSongContextMenu}
                          badgeBuilder={(song, index) =>
                            song.trackNumber !== null
                              ? `#${song.trackNumber}`
                              : `#${(albumSongPage - 1) * DETAIL_SONG_PAGE_SIZE + index + 1}`
                          }
                        />
                        {totalAlbumSongPages > 1 ? (
                          <UIPagination
                            currentPage={albumSongPage}
                            totalPages={totalAlbumSongPages}
                            pageLabel={copy.labels.page}
                            firstPageLabel={firstPageLabel}
                            previousPageLabel={copy.actions.prevPage}
                            nextPageLabel={copy.actions.nextPage}
                            lastPageLabel={lastPageLabel}
                            onPageChange={setAlbumSongPage}
                          />
                        ) : null}
                      </>
                    )}
                  </section>
                </>
              ) : (
                <UILoadingBlock label={copy.states.loadingAlbum} variant="list" items={5} />
              )}
            </div>
          ) : isSearchMode ? (
            <section className="settings-card settings-card--list">
              <div className="explore-results-header">
                <UIButton variant="secondary" onClick={leaveSearchMode}>
                  {copy.actions.backToExplore}
                </UIButton>
                <div className="settings-card__header explore-results-header__copy">
                  <div>
                    <p className="settings-card__eyebrow">{copy.sections.results}</p>
                    <h3 className="settings-card__title">{`“${searchKeyword}”`}</h3>
                  </div>
                  <span className="explore-summary">
                    {totalResults} {copy.labels.resultCount}
                  </span>
                </div>
              </div>

              <div className="explore-tabs">
                {(["all", "songs", "artists", "playlists", "albums"] as const).map((tab) => (
                  <button
                    key={tab}
                    className={[
                      "explore-tab",
                      activeTab === tab ? "explore-tab--active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                  >
                    {copy.tabs[tab]}
                  </button>
                ))}
              </div>

              {searchError && !showSearchSections ? (
                <p className="library-empty">{searchError}</p>
              ) : !showSearchSections ? (
                <p className="library-empty">{copy.states.empty}</p>
              ) : (
                <div className="explore-results">
                  <SearchResultSection
                    visible={shouldShowTab("songs")}
                    title={copy.tabs.songs}
                    count={songTotal}
                  >
                    {isSearchSongsLoading && songs.length === 0 ? (
                      <UILoadingBlock label={copy.states.loadingSearch} variant="list" items={5} />
                    ) : songs.length === 0 ? (
                      <p className="library-empty">{copy.states.emptySongs}</p>
                    ) : (
                      <>
                        <SongList
                          songs={songs}
                          queueSongs={songs}
                          sourceLabel={copy.labels.source}
                          unknownArtistLabel={copy.labels.unknownArtist}
                          unknownAlbumLabel={copy.labels.unknownAlbum}
                          onPlay={onPlayNeteaseTrack}
                          onArtistClick={openArtistDetailById}
                          onAlbumClick={openAlbumDetailById}
                          onContextMenu={onSongContextMenu}
                          badgeBuilder={(_, index) =>
                            `#${(searchSongPage - 1) * SEARCH_SONG_PAGE_SIZE + index + 1}`
                          }
                        />
                        {totalSongPages > 1 ? (
                          <UIPagination
                            currentPage={searchSongPage}
                            totalPages={totalSongPages}
                            pageLabel={copy.labels.page}
                            firstPageLabel={firstPageLabel}
                            previousPageLabel={copy.actions.prevPage}
                            nextPageLabel={copy.actions.nextPage}
                            lastPageLabel={lastPageLabel}
                            onPageChange={setSearchSongPage}
                          />
                        ) : null}
                      </>
                    )}
                  </SearchResultSection>

                  <SearchResultSection
                    visible={shouldShowTab("artists")}
                    title={copy.tabs.artists}
                    count={artists.length}
                  >
                    {isSearchArtistsLoading && artists.length === 0 ? (
                      <UILoadingBlock label={copy.states.loadingSearch} variant="grid" items={4} />
                    ) : artists.length === 0 ? (
                      <p className="library-empty">{copy.states.empty}</p>
                    ) : (
                      <div className="explore-entity-grid">
                        {artists.map((artist) => (
                          <EntityCard
                            key={artist.id}
                            title={artist.name}
                            description={artist.briefDesc || copy.labels.noArtistInfo}
                            artworkUrl={artist.avatarUrl}
                            primaryMeta={
                              artist.musicCount !== null
                                ? `${artist.musicCount} ${copy.labels.songs}`
                                : copy.labels.source
                            }
                            secondaryMeta={
                              artist.albumCount !== null
                                ? `${artist.albumCount} ${copy.labels.albums}`
                                : copy.labels.source
                            }
                            fallbackIcon={<ArtistIcon />}
                            onClick={() => openArtistDetail(artist)}
                          />
                        ))}
                      </div>
                    )}
                  </SearchResultSection>

                  <SearchResultSection
                    visible={shouldShowTab("playlists")}
                    title={copy.tabs.playlists}
                    count={playlistTotal}
                  >
                    {isSearchPlaylistsLoading && playlists.length === 0 ? (
                      <UILoadingBlock label={copy.states.loadingSearch} variant="grid" items={4} />
                    ) : playlists.length === 0 ? (
                      <p className="library-empty">{copy.states.empty}</p>
                    ) : (
                      <>
                        <div className="playlist-waterfall-grid playlist-browser-grid">
                          {playlists.map((playlist) => (
                            <PlaylistCard
                              key={playlist.id}
                              playlist={playlist}
                              locale={locale}
                              tracksSuffix={copy.labels.tracks}
                              fallbackDescription={copy.labels.noPlaylistInfo}
                              sourceLabel={copy.labels.source}
                              onOpen={onOpenPlaylist}
                              onContextMenu={(event) => onPlaylistContextMenu(event, playlist)}
                            />
                          ))}
                        </div>
                        {totalPlaylistPages > 1 ? (
                          <UIPagination
                            currentPage={searchPlaylistPage}
                            totalPages={totalPlaylistPages}
                            pageLabel={copy.labels.page}
                            firstPageLabel={firstPageLabel}
                            previousPageLabel={copy.actions.prevPage}
                            nextPageLabel={copy.actions.nextPage}
                            lastPageLabel={lastPageLabel}
                            onPageChange={setSearchPlaylistPage}
                          />
                        ) : null}
                      </>
                    )}
                  </SearchResultSection>

                  <SearchResultSection
                    visible={shouldShowTab("albums")}
                    title={copy.tabs.albums}
                    count={albums.length}
                  >
                    {isSearchAlbumsLoading && albums.length === 0 ? (
                      <UILoadingBlock label={copy.states.loadingSearch} variant="grid" items={4} />
                    ) : albums.length === 0 ? (
                      <p className="library-empty">{copy.states.empty}</p>
                    ) : (
                      <div className="explore-entity-grid">
                        {albums.map((album) => (
                          <EntityCard
                            key={album.id}
                            title={album.name}
                            description={album.artistName || copy.labels.noAlbumInfo}
                            artworkUrl={album.artworkUrl}
                            primaryMeta={
                              album.trackCount !== null
                                ? `${album.trackCount} ${copy.labels.tracks}`
                                : copy.labels.source
                            }
                            secondaryMeta={
                              album.publishYear !== null
                                ? String(album.publishYear)
                                : copy.labels.source
                            }
                            fallbackIcon={<AlbumIcon />}
                            onClick={() => openAlbumDetail(album)}
                          />
                        ))}
                      </div>
                    )}
                  </SearchResultSection>
                </div>
              )}
            </section>
          ) : (
            <>
              <section className="settings-card settings-card--list">
                <SectionHeader title={copy.sections.hot} count={hotKeywords.length} />
                {isDiscoveryLoading && hotKeywords.length === 0 ? (
                  <UILoadingBlock label={copy.states.loadingDiscovery} variant="inline" />
                ) : discoveryError ? (
                  <p className="library-empty">{discoveryError}</p>
                ) : hotKeywords.length === 0 ? (
                  <p className="library-empty">{copy.states.empty}</p>
                ) : (
                  <div className="explore-keywords">
                    {hotKeywords.map((item) => (
                      <button
                        key={item.keyword}
                        className="explore-keyword"
                        type="button"
                        onClick={() => applyKeyword(item.keyword)}
                      >
                        <span>{item.keyword}</span>
                        {item.score !== null ? (
                          <small>{formatCompactCount(item.score, locale)}</small>
                        ) : null}
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="settings-card settings-card--list">
                <SectionHeader title={copy.sections.songs} count={featuredSongs.length} />
                {isDiscoveryLoading && featuredSongs.length === 0 ? (
                  <UILoadingBlock label={copy.states.loadingDiscovery} variant="list" />
                ) : featuredSongs.length === 0 ? (
                  <p className="library-empty">{copy.states.empty}</p>
                ) : (
                    <SongList
                      songs={featuredSongs}
                      sourceLabel={copy.labels.source}
                      unknownArtistLabel={copy.labels.unknownArtist}
                      unknownAlbumLabel={copy.labels.unknownAlbum}
                      onPlay={onPlayNeteaseTrack}
                      onArtistClick={openArtistDetailById}
                      onAlbumClick={openAlbumDetailById}
                      onContextMenu={onSongContextMenu}
                    />
                )}
              </section>

              <section className="settings-card settings-card--list">
                <SectionHeader
                  title={copy.sections.categories}
                  count={visibleCategories.length}
                />
                <div className="explore-keywords">
                  {visibleCategories.map((category) => (
                    <button
                      key={category}
                      className={[
                        "explore-keyword",
                        selectedCategory === category ? "explore-keyword--active" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      type="button"
                      onClick={() => setSelectedCategory(category)}
                    >
                      <span>
                        {category === ALL_CATEGORY_KEY ? copy.labels.allCategory : category}
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="settings-card settings-card--list">
                <SectionHeader title={copy.sections.playlists} count={topPlaylists.length} />
                {isDiscoveryLoading && topPlaylists.length === 0 ? (
                  <UILoadingBlock label={copy.states.loadingDiscovery} variant="grid" items={4} />
                ) : topPlaylists.length === 0 ? (
                  <p className="library-empty">{copy.states.empty}</p>
                ) : (
                  <div className="playlist-waterfall-grid playlist-browser-grid">
                    {topPlaylists.map((playlist) => (
                      <PlaylistCard
                        key={playlist.id}
                        playlist={playlist}
                        locale={locale}
                        tracksSuffix={copy.labels.tracks}
                        fallbackDescription={copy.labels.noPlaylistInfo}
                        sourceLabel={copy.labels.source}
                        onOpen={onOpenPlaylist}
                        onContextMenu={(event) => onPlaylistContextMenu(event, playlist)}
                      />
                    ))}
                  </div>
                )}
              </section>

              <section className="settings-card settings-card--list">
                <SectionHeader title={copy.sections.quality} count={qualityPlaylists.length} />
                {isDiscoveryLoading && qualityPlaylists.length === 0 ? (
                  <UILoadingBlock label={copy.states.loadingDiscovery} variant="grid" items={4} />
                ) : qualityPlaylists.length === 0 ? (
                  <p className="library-empty">{copy.states.empty}</p>
                ) : (
                  <div className="playlist-waterfall-grid playlist-browser-grid">
                    {qualityPlaylists.map((playlist) => (
                      <PlaylistCard
                        key={playlist.id}
                        playlist={playlist}
                        locale={locale}
                        tracksSuffix={copy.labels.tracks}
                        fallbackDescription={copy.labels.noPlaylistInfo}
                        sourceLabel={copy.labels.source}
                        onOpen={onOpenPlaylist}
                        onContextMenu={(event) => onPlaylistContextMenu(event, playlist)}
                      />
                    ))}
                  </div>
                )}
              </section>

              <section className="settings-card settings-card--list">
                <SectionHeader title={copy.sections.artists} count={topArtists.length} />
                {isDiscoveryLoading && topArtists.length === 0 ? (
                  <UILoadingBlock label={copy.states.loadingDiscovery} variant="grid" items={4} />
                ) : topArtists.length === 0 ? (
                  <p className="library-empty">{copy.states.empty}</p>
                ) : (
                  <div className="explore-entity-grid">
                    {topArtists.map((artist) => (
                      <EntityCard
                        key={artist.id}
                        title={artist.name}
                        description={artist.briefDesc || copy.labels.noArtistInfo}
                        artworkUrl={artist.avatarUrl}
                        primaryMeta={
                          artist.musicCount !== null
                            ? `${artist.musicCount} ${copy.labels.songs}`
                            : copy.labels.source
                        }
                        secondaryMeta={
                          artist.albumCount !== null
                            ? `${artist.albumCount} ${copy.labels.albums}`
                            : copy.labels.source
                        }
                        fallbackIcon={<ArtistIcon />}
                        onClick={() => openArtistDetail(artist)}
                      />
                    ))}
                  </div>
                )}
              </section>

              <section className="settings-card settings-card--list">
                <SectionHeader title={copy.sections.albums} count={newestAlbums.length} />
                {isDiscoveryLoading && newestAlbums.length === 0 ? (
                  <UILoadingBlock label={copy.states.loadingDiscovery} variant="grid" items={4} />
                ) : newestAlbums.length === 0 ? (
                  <p className="library-empty">{copy.states.empty}</p>
                ) : (
                  <div className="explore-entity-grid">
                    {newestAlbums.map((album) => (
                      <EntityCard
                        key={album.id}
                        title={album.name}
                        description={album.artistName || copy.labels.noAlbumInfo}
                        artworkUrl={album.artworkUrl}
                        primaryMeta={
                          album.trackCount !== null
                            ? `${album.trackCount} ${copy.labels.tracks}`
                            : copy.labels.source
                        }
                        secondaryMeta={
                          album.publishYear !== null
                            ? String(album.publishYear)
                            : copy.labels.source
                        }
                        fallbackIcon={<AlbumIcon />}
                        onClick={() => openAlbumDetail(album)}
                      />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
    </section>
  );
}
