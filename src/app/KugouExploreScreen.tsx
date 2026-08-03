import {
  useEffect,
  useState,
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
  getKugouPlaylistTags,
  getKugouSearchHotKeywords,
  getKugouTopPlaylists,
  isKugouSourceEnabled,
  searchKugouAlbums,
  searchKugouArtists,
  searchKugouSongDetailsPage,
} from "../network/kugou";
import type {
  KugouAlbumSummary,
  KugouArtistSummary,
  KugouPlaylistSummary,
  KugouSongDetail,
} from "../network/types";
import type { AppSettings } from "../settings/types";
import { setBoundedMapValue } from "./cache";
import "./styles.css";

type Props = {
  locale: string;
  settings: AppSettings;
  onPlayTrack: (hash: string, queueSongs: KugouSongDetail[]) => void;
  onSongContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    song: KugouSongDetail,
    queueSongs: KugouSongDetail[],
  ) => void;
  onOpenArtist: (id: string | null, name: string) => void;
  onOpenAlbum: (id: string, name: string) => void;
  onOpenPlaylist: (playlist: KugouPlaylistSummary) => void;
};

type Tab = "all" | "songs" | "artists" | "albums";
const PAGE_SIZE = 30;
const DISCOVERY_CACHE_LIMIT = 12;
const SEARCH_CACHE_LIMIT = 24;
const discoveryCache = new Map<
  string,
  {
    hotKeywords: string[];
    tags: Array<{ id: string; name: string }>;
    playlists: KugouPlaylistSummary[];
  }
>();
const searchCache = new Map<
  string,
  {
    songs: KugouSongDetail[];
    songTotal: number;
    artists: KugouArtistSummary[];
    albums: KugouAlbumSummary[];
  }
>();

function cacheKey(settings: AppSettings, scope: string) {
  const baseUrl =
    settings.network.kugouApiBaseUrl.trim().toLowerCase() || "default";
  const cookie = settings.network.kugouCookie.trim() || "guest";
  return `${baseUrl}::${cookie}::${scope}`;
}

function copy(locale: string) {
  return locale === "en-US"
    ? {
        title: "Music Discovery",
        description:
          "Search songs, artists, playlists, and albums, then browse trending searches, popular playlists, artists, and newest releases.",
        source: "KuGou Music",
        search: "Search",
        searchPlaceholder: "Search songs, artists, albums",
        searchButton: "Search",
        results: "Search Results",
        back: "Back to Explore",
        hot: "Hot Searches",
        categories: "Playlist Categories",
        playlists: "Featured Playlists",
        songs: "Songs",
        artists: "Artists",
        albums: "Albums",
        all: "All",
        loadingDiscovery: "Loading discovery content...",
        loadingSearch: "Searching KuGou Music...",
        empty: "No content available.",
        emptySongs: "No songs found.",
        unknownArtist: "Unknown artist",
        unknownAlbum: "Unknown album",
        tracks: "tracks",
        page: "Page",
      }
    : {
        title: "音乐探索",
        description:
          "搜索歌曲、歌手、歌单与专辑，同时浏览热搜趋势、热门歌单、歌手和最新专辑。",
        source: "酷狗音乐",
        search: "搜索",
        searchPlaceholder: "搜索歌曲、歌手、专辑",
        searchButton: "立即搜索",
        results: "搜索结果",
        back: "返回探索",
        hot: "热搜",
        categories: "歌单分类",
        playlists: "精选歌单",
        songs: "歌曲",
        artists: "歌手",
        albums: "专辑",
        all: "全部",
        loadingDiscovery: "正在加载探索内容...",
        loadingSearch: "正在搜索酷狗音乐...",
        empty: "暂时没有可显示内容。",
        emptySongs: "暂时没有可显示歌曲。",
        unknownArtist: "未知歌手",
        unknownAlbum: "未知专辑",
        tracks: "首歌曲",
        page: "页码",
      };
}

function duration(value: number | null) {
  if (!value || value <= 0) return "--:--";
  const seconds = Math.round(value / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
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
    </svg>
  );
}
function Header({ title, count }: { title: string; count: number }) {
  return (
    <div className="explore-section__header">
      <div className="explore-section__heading">
        <strong>{title}</strong>
        <span>{count}</span>
      </div>
    </div>
  );
}
function MetaButton({
  label,
  action,
  disabled,
}: {
  label: string;
  action?: () => void;
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
        action?.();
      }}
    >
      {label}
    </button>
  );
}
function Card({
  title,
  description,
  artwork,
  primary,
  secondary,
  icon,
  action,
}: {
  title: string;
  description: string;
  artwork: string | null;
  primary: string;
  secondary: string;
  icon: ReactNode;
  action: () => void;
}) {
  return (
    <button
      className="home-media-card home-media-card--button explore-entity-card"
      type="button"
      onClick={action}
    >
      <div className="home-media-card__artwork" aria-hidden="true">
        {artwork ? (
          <img src={artwork} alt="" loading="lazy" />
        ) : (
          <span className="home-media-card__fallback">{icon}</span>
        )}
      </div>
      <div className="home-media-card__copy">
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <div className="home-media-card__meta">
        <span>{primary}</span>
        <span>{secondary}</span>
      </div>
    </button>
  );
}

function Songs({
  songs,
  queue,
  labels,
  onPlay,
  onArtist,
  onAlbum,
  onContextMenu,
  indexOffset = 0,
}: {
  songs: KugouSongDetail[];
  queue?: KugouSongDetail[];
  labels: { source: string; unknownArtist: string; unknownAlbum: string };
  onPlay: Props["onPlayTrack"];
  onArtist: Props["onOpenArtist"];
  onAlbum: Props["onOpenAlbum"];
  onContextMenu: Props["onSongContextMenu"];
  indexOffset?: number;
}) {
  const playbackQueue = queue ?? songs;
  return (
    <div className="home-song-list">
      {songs.map((song, index) => (
        <div
          key={`${song.hash}:${index}`}
          className="home-song-card"
          role="button"
          tabIndex={0}
          onClick={() => onPlay(song.hash, playbackQueue)}
          onContextMenu={(event) => onContextMenu(event, song, playbackQueue)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onPlay(song.hash, playbackQueue);
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
              <span className="song-meta-links">
                {song.artists.length
                  ? song.artists.map((name, artistIndex) => (
                      <span
                        key={`${song.hash}:${artistIndex}`}
                        className="song-meta-links__item"
                      >
                        <MetaButton
                          label={name}
                          action={() =>
                            onArtist(song.artistIds[artistIndex] ?? null, name)
                          }
                        />
                        {artistIndex < song.artists.length - 1 ? (
                          <span className="song-meta-links__separator">
                            {" "}
                            /{" "}
                          </span>
                        ) : null}
                      </span>
                    ))
                  : labels.unknownArtist}
              </span>
            </span>
          </span>
          <span className="home-song-card__meta">
            <MetaButton
              label={song.album || labels.unknownAlbum}
              disabled={!song.albumId}
              action={() =>
                song.albumId &&
                onAlbum(song.albumId, song.album || labels.unknownAlbum)
              }
            />
          </span>
          <span className="home-song-card__duration">
            {duration(song.durationMs)}
          </span>
          <span className="home-song-card__badge">
            {indexOffset ? `#${indexOffset + index + 1}` : labels.source}
          </span>
        </div>
      ))}
    </div>
  );
}

export function KugouExploreScreen({
  locale,
  settings,
  onPlayTrack,
  onSongContextMenu,
  onOpenArtist,
  onOpenAlbum,
  onOpenPlaylist,
}: Props) {
  const text = copy(locale);
  const enabled = isKugouSourceEnabled(settings);
  const [searchInput, setSearchInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [songPage, setSongPage] = useState(1);
  const [hotKeywords, setHotKeywords] = useState<string[]>([]);
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([]);
  const [category, setCategory] = useState("0");
  const [playlists, setPlaylists] = useState<KugouPlaylistSummary[]>([]);
  const [songs, setSongs] = useState<KugouSongDetail[]>([]);
  const [songTotal, setSongTotal] = useState(0);
  const [artists, setArtists] = useState<KugouArtistSummary[]>([]);
  const [albums, setAlbums] = useState<KugouAlbumSummary[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searching = Boolean(keyword.trim());
  const totalPages = Math.max(1, Math.ceil(songTotal / PAGE_SIZE));
  const show = (target: Exclude<Tab, "all">) => tab === "all" || tab === target;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setDiscoverLoading(true);
    setDiscoverError(null);
    const key = cacheKey(settings, `explore:discovery:${category}`);
    const cached = discoveryCache.get(key);
    if (cached) {
      setHotKeywords(cached.hotKeywords);
      setTags(cached.tags);
      setPlaylists(cached.playlists);
      setDiscoverLoading(false);
      return () => {
        cancelled = true;
      };
    }
    void Promise.all([
      getKugouSearchHotKeywords(settings),
      getKugouPlaylistTags(settings),
      getKugouTopPlaylists(settings, category),
    ])
      .then(([nextHot, nextTags, nextPlaylists]) => {
        if (!cancelled) {
          const bundle = {
            hotKeywords: nextHot,
            tags: nextTags,
            playlists: nextPlaylists,
          };
          setBoundedMapValue(
            discoveryCache,
            key,
            bundle,
            DISCOVERY_CACHE_LIMIT,
          );
          setHotKeywords(bundle.hotKeywords);
          setTags(bundle.tags);
          setPlaylists(bundle.playlists);
        }
      })
      .catch((error) => {
        if (!cancelled)
          setDiscoverError(error instanceof Error ? error.message : text.empty);
      })
      .finally(() => {
        if (!cancelled) setDiscoverLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [category, enabled, settings, text.empty]);

  useEffect(() => {
    if (!enabled || !keyword.trim()) {
      setSongs([]);
      setArtists([]);
      setAlbums([]);
      setSongTotal(0);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    setSearchError(null);
    const key = cacheKey(
      settings,
      `explore:search:${keyword.toLocaleLowerCase(locale)}:songs:${songPage}`,
    );
    const cached = searchCache.get(key);
    if (cached) {
      setSongs(cached.songs);
      setSongTotal(cached.songTotal);
      setArtists(cached.artists);
      setAlbums(cached.albums);
      setSearchLoading(false);
      return () => {
        cancelled = true;
      };
    }
    void Promise.allSettled([
      searchKugouSongDetailsPage(settings, keyword, {
        limit: PAGE_SIZE,
        offset: (songPage - 1) * PAGE_SIZE,
      }),
      searchKugouArtists(settings, keyword, { limit: 12 }),
      searchKugouAlbums(settings, keyword, { limit: 12 }),
    ])
      .then(([songResult, artistResult, albumResult]) => {
        if (cancelled) return;
        let failures = 0;
        const bundle = {
          songs: [] as KugouSongDetail[],
          songTotal: 0,
          artists: [] as KugouArtistSummary[],
          albums: [] as KugouAlbumSummary[],
        };
        if (songResult.status === "fulfilled") {
          bundle.songs = songResult.value.items;
          bundle.songTotal = Math.max(
            songResult.value.total ?? 0,
            songResult.value.offset +
              songResult.value.items.length +
              (songResult.value.hasMore ? 1 : 0),
          );
          setSongs(bundle.songs);
          setSongTotal(bundle.songTotal);
        } else failures += 1;
        if (artistResult.status === "fulfilled") {
          bundle.artists = artistResult.value;
          setArtists(bundle.artists);
        } else failures += 1;
        if (albumResult.status === "fulfilled") {
          bundle.albums = albumResult.value;
          setAlbums(bundle.albums);
        } else failures += 1;
        if (failures === 3) setSearchError(text.empty);
        else setBoundedMapValue(searchCache, key, bundle, SEARCH_CACHE_LIMIT);
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, keyword, locale, settings, songPage, text.empty]);

  const executeSearch = (next: string) => {
    const normalized = next.trim();
    if (!normalized) return;
    setSearchInput(normalized);
    setKeyword(normalized);
    setSongPage(1);
    setTab("all");
  };
  const clearSearch = () => {
    setKeyword("");
    setSearchInput("");
    setSongPage(1);
  };
  const first = locale === "en-US" ? "First page" : "首页";
  const previous = locale === "en-US" ? "Previous page" : "上一页";
  const next = locale === "en-US" ? "Next page" : "下一页";
  const last = locale === "en-US" ? "Last page" : "尾页";

  return (
    <section className="settings-screen explore-screen">
      {!searching ? (
        <header className="settings-screen__header">
          <div>
            <h2 className="settings-screen__title">{text.title}</h2>
            <p className="settings-screen__description">{text.description}</p>
          </div>
        </header>
      ) : null}
      {!enabled ? (
        <p className="library-empty">
          {locale === "en-US"
            ? "Enable the KuGou online source to explore music."
            : "请先启用酷狗在线音源。"}
        </p>
      ) : (
        <>
          {!searching ? (
            <form
              className="explore-search"
              onSubmit={(event) => {
                event.preventDefault();
                executeSearch(searchInput);
              }}
            >
              <div className="explore-search__field">
                <label className="ui-field">
                  <span className="ui-field__label">{text.search}</span>
                  <span className="ui-input-shell">
                    <span className="ui-input-shell__prefix">
                      <SearchIcon />
                    </span>
                    <input
                      value={searchInput}
                      placeholder={text.searchPlaceholder}
                      onChange={(event) => setSearchInput(event.target.value)}
                    />
                  </span>
                </label>
              </div>
              <div className="explore-search__action">
                <button className="explore-search__button" type="submit">
                  <span className="explore-search__button-icon">
                    <SearchIcon />
                  </span>
                  <span className="explore-search__button-label">
                    {text.searchButton}
                  </span>
                </button>
              </div>
            </form>
          ) : null}
          {searching ? (
            <section className="settings-card settings-card--list">
              <div className="explore-results-header">
                <UIButton variant="secondary" onClick={clearSearch}>
                  {text.back}
                </UIButton>
                <div className="settings-card__header explore-results-header__copy">
                  <div>
                    <p className="settings-card__eyebrow">{text.results}</p>
                    <h3 className="settings-card__title">{`“${keyword}”`}</h3>
                  </div>
                  <span className="explore-summary">
                    {songTotal + artists.length + albums.length}
                  </span>
                </div>
              </div>
              <div className="explore-tabs">
                {(["all", "songs", "artists", "albums"] as const).map(
                  (item) => (
                    <button
                      key={item}
                      className={[
                        "explore-tab",
                        tab === item ? "explore-tab--active" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      type="button"
                      onClick={() => setTab(item)}
                    >
                      {text[item]}
                    </button>
                  ),
                )}
              </div>
              {searchLoading &&
              !songs.length &&
              !artists.length &&
              !albums.length ? (
                <UILoadingBlock
                  label={text.loadingSearch}
                  variant="list"
                  items={5}
                />
              ) : searchError ? (
                <p className="library-empty">{searchError}</p>
              ) : (
                <div className="explore-results">
                  {show("songs") ? (
                    <section className="settings-card settings-card--list">
                      <Header title={text.songs} count={songTotal} />
                      {songs.length ? (
                        <>
                          <Songs
                            songs={songs}
                            labels={text}
                            onPlay={onPlayTrack}
                            onArtist={onOpenArtist}
                            onAlbum={onOpenAlbum}
                            onContextMenu={onSongContextMenu}
                            indexOffset={(songPage - 1) * PAGE_SIZE}
                          />
                          {totalPages > 1 ? (
                            <UIPagination
                              currentPage={songPage}
                              totalPages={totalPages}
                              pageLabel={text.page}
                              firstPageLabel={first}
                              previousPageLabel={previous}
                              nextPageLabel={next}
                              lastPageLabel={last}
                              onPageChange={setSongPage}
                            />
                          ) : null}
                        </>
                      ) : (
                        <p className="library-empty">{text.emptySongs}</p>
                      )}
                    </section>
                  ) : null}
                  {show("artists") ? (
                    <section className="settings-card settings-card--list">
                      <Header title={text.artists} count={artists.length} />
                      {artists.length ? (
                        <div className="explore-entity-grid">
                          {artists.map((artist) => (
                            <Card
                              key={artist.id}
                              title={artist.name}
                              description={artist.briefDesc || text.source}
                              artwork={artist.avatarUrl}
                              primary={
                                artist.musicCount === null
                                  ? text.source
                                  : `${artist.musicCount} ${text.songs}`
                              }
                              secondary={
                                artist.albumCount === null
                                  ? text.source
                                  : `${artist.albumCount} ${text.albums}`
                              }
                              icon={<ArtistIcon />}
                              action={() =>
                                onOpenArtist(artist.id, artist.name)
                              }
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="library-empty">{text.empty}</p>
                      )}
                    </section>
                  ) : null}
                  {show("albums") ? (
                    <section className="settings-card settings-card--list">
                      <Header title={text.albums} count={albums.length} />
                      {albums.length ? (
                        <div className="explore-entity-grid">
                          {albums.map((album) => (
                            <Card
                              key={album.id}
                              title={album.name}
                              description={
                                album.artistName || text.unknownArtist
                              }
                              artwork={album.artworkUrl}
                              primary={
                                album.trackCount === null
                                  ? text.source
                                  : `${album.trackCount} ${text.tracks}`
                              }
                              secondary={
                                album.publishYear === null
                                  ? text.source
                                  : String(album.publishYear)
                              }
                              icon={<AlbumIcon />}
                              action={() => onOpenAlbum(album.id, album.name)}
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="library-empty">{text.empty}</p>
                      )}
                    </section>
                  ) : null}
                </div>
              )}
            </section>
          ) : (
            <>
              {
                <section className="settings-card settings-card--list">
                  <Header title={text.hot} count={hotKeywords.length} />
                  {discoverLoading && !hotKeywords.length ? (
                    <UILoadingBlock
                      label={text.loadingDiscovery}
                      variant="inline"
                    />
                  ) : (
                    <div className="explore-keywords">
                      {hotKeywords.map((item) => (
                        <button
                          key={item}
                          className="explore-keyword"
                          type="button"
                          onClick={() => executeSearch(item)}
                        >
                          <span>{item}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              }
              <section className="settings-card settings-card--list">
                <Header title={text.categories} count={tags.length + 1} />
                {discoverLoading && !tags.length ? (
                  <UILoadingBlock
                    label={text.loadingDiscovery}
                    variant="inline"
                  />
                ) : (
                  <div className="explore-keywords">
                    <button
                      className={[
                        "explore-keyword",
                        category === "0" ? "explore-keyword--active" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      type="button"
                      onClick={() => setCategory("0")}
                    >
                      <span>{text.all}</span>
                    </button>
                    {tags.map((item) => (
                      <button
                        key={item.id}
                        className={[
                          "explore-keyword",
                          category === item.id ? "explore-keyword--active" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        type="button"
                        onClick={() => setCategory(item.id)}
                      >
                        <span>{item.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
              <section className="settings-card settings-card--list">
                <Header title={text.playlists} count={playlists.length} />
                {discoverLoading && !playlists.length ? (
                  <UILoadingBlock
                    label={text.loadingDiscovery}
                    variant="grid"
                    items={4}
                  />
                ) : discoverError ? (
                  <p className="library-empty">{discoverError}</p>
                ) : playlists.length ? (
                  <div className="playlist-waterfall-grid playlist-browser-grid">
                    {playlists.map((playlist) => (
                      <button
                        key={`${playlist.collectionId}:${playlist.id}`}
                        className="home-media-card home-media-card--button home-media-card--compact playlist-preview-card"
                        type="button"
                        onClick={() => onOpenPlaylist(playlist)}
                      >
                        <div
                          className="home-media-card__artwork"
                          aria-hidden="true"
                        >
                          {playlist.artworkUrl ? (
                            <img
                              src={playlist.artworkUrl}
                              alt=""
                              loading="lazy"
                            />
                          ) : (
                            <span className="home-media-card__fallback">
                              <AlbumIcon />
                            </span>
                          )}
                        </div>
                        <div className="home-media-card__copy">
                          <strong>{playlist.name}</strong>
                          <p>{playlist.description || text.source}</p>
                        </div>
                        <div className="home-media-card__meta">
                          <span>{playlist.creatorName || text.source}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="library-empty">{text.empty}</p>
                )}
              </section>
            </>
          )}
        </>
      )}
    </section>
  );
}
