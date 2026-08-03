import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { UIButton, UILoadingBlock } from "../ui/components";
import {
  getKugouDailyRecommendedSongs,
  getKugouLoggedInAccount,
  getKugouPersonalFmSongs,
  getKugouTopPlaylists,
  isKugouSourceEnabled,
} from "../network/kugou";
import type {
  KugouAccountProfile,
  KugouPlaylistSummary,
  KugouSongDetail,
} from "../network/types";
import type { AppSettings } from "../settings/types";
import type { MediaLibrarySnapshot, TrackRecord } from "../media/types";
import { setBoundedMapValue } from "./cache";
import "./styles.css";

type Props = {
  locale: string;
  settings: AppSettings;
  mediaLibrary: MediaLibrarySnapshot | null;
  isLibraryLoading: boolean;
  onPlayTrack: (hash: string, queueSongs: KugouSongDetail[]) => void;
  onPlayPersonalFmTrack: (hash: string, queueSongs: KugouSongDetail[]) => void;
  onSongContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    song: KugouSongDetail,
    queueSongs: KugouSongDetail[],
  ) => void;
  onPlayLocalTrack: (trackId: string, queueTracks: TrackRecord[]) => void;
  onOpenTrackArtist: (track: TrackRecord) => void;
  onOpenTrackAlbum: (track: TrackRecord) => void;
  onOpenArtist: (id: string | null, name: string) => void;
  onOpenAlbum: (id: string, name: string) => void;
  onOpenPlaylist: (playlist: KugouPlaylistSummary) => void;
};

type HomeFeed = {
  account: KugouAccountProfile | null;
  dailySongs: KugouSongDetail[];
  personalFmSongs: KugouSongDetail[];
  playlists: KugouPlaylistSummary[];
};

const feedCache = new Map<string, HomeFeed>();

function getCopy(locale: string) {
  return locale === "en-US"
    ? {
        title: "Welcome Back",
        description: "Browse recommendations and your library overview here.",
        source: "KuGou Music",
        fm: "Personal FM",
        fmHint:
          "Continuous recommendations based on your listening preferences.",
        startFm: "Start Personal FM",
        refreshFm: "Refresh",
        refreshingFm: "Refreshing...",
        dailySongs: "Daily Recommendations",
        playlists: "Recommended Playlists",
        loading: "Loading recommendations...",
        loadingFm: "Loading Personal FM...",
        empty: "No recommendations are available yet.",
        retry: "Retry",
        unknownArtist: "Unknown artist",
        unknownAlbum: "Unknown album",
        dailyTag: "Daily",
        fmTag: "FM",
        creatorPrefix: "By",
        playCount: "plays",
        unavailable: "Enable the KuGou online source to load the home feed.",
        offlineSource: "Offline Library",
        offlinePicks: "Offline Picks",
        emptyLibrary: "No songs in the library yet.",
        localTag: "Local",
      }
    : {
        title: "欢迎回来",
        description: "在这里查看推荐内容和资料库概况。",
        source: "酷狗音乐",
        fm: "私人 FM",
        fmHint: "根据你的听歌偏好连续推荐。",
        startFm: "开始私人 FM",
        refreshFm: "换一批",
        refreshingFm: "正在刷新...",
        dailySongs: "每日推荐歌曲",
        playlists: "推荐歌单",
        loading: "正在加载推荐内容...",
        loadingFm: "正在加载私人 FM...",
        empty: "暂时没有可显示的推荐内容。",
        retry: "重试",
        unknownArtist: "未知歌手",
        unknownAlbum: "未知专辑",
        dailyTag: "日推",
        fmTag: "FM",
        creatorPrefix: "创建者",
        playCount: "次播放",
        unavailable: "请先启用酷狗在线音源，再加载首页内容。",
        offlineSource: "离线资料库",
        offlinePicks: "离线推荐",
        emptyLibrary: "资料库里还没有歌曲，先导入一些音乐吧。",
        localTag: "本地",
      };
}

function getCacheKey(settings: AppSettings) {
  const baseUrl =
    settings.network.kugouApiBaseUrl.trim().toLowerCase() || "default";
  const cookie = settings.network.kugouCookie.trim() || "guest";
  return `${baseUrl}::${cookie}::home`;
}

function formatDuration(value: number | null) {
  if (!value || value <= 0) return "--:--";
  const seconds = Math.round(value / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function getOfflineRecommendations(tracks: TrackRecord[]) {
  return [...tracks]
    .sort((left, right) => {
      const artworkScore =
        Number(right.artworkIds.length > 0) -
        Number(left.artworkIds.length > 0);
      return artworkScore || right.importedAtMs - left.importedAtMs;
    })
    .slice(0, 8);
}

function getArtworkUrl(
  track: TrackRecord,
  library: MediaLibrarySnapshot | null,
) {
  const artworksById = new Map(
    (library?.artworks ?? []).map((artwork) => [artwork.id, artwork]),
  );
  const artworkIds = [
    track.config.preferredArtworkId,
    ...track.artworkIds,
  ].filter((id): id is string => Boolean(id));
  for (const artworkId of artworkIds) {
    const artwork = artworksById.get(artworkId);
    if (!artwork) continue;
    return artwork.source.kind === "remoteUrl"
      ? artwork.source.url
      : convertFileSrc(artwork.source.path);
  }
  return null;
}

function NoteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 6.5v9.5" />
      <path d="M9 6.5l8-1.5v8.5" />
      <path d="M9 16.5a2.5 2.5 0 11-2.5-2.5A2.5 2.5 0 019 16.5z" />
      <path d="M17 15a2.5 2.5 0 11-2.5-2.5A2.5 2.5 0 0117 15z" />
    </svg>
  );
}

function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className}>
      <path d="M9.25 3.75L13 8l-3.75 4.25" />
      <path d="M12.5 8H3.5" />
    </svg>
  );
}

function RefreshIcon({
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

function SongRow({
  song,
  queue,
  badge,
  text,
  onPlayTrack,
  onOpenArtist,
  onOpenAlbum,
  onContextMenu,
}: {
  song: KugouSongDetail;
  queue: KugouSongDetail[];
  badge: string;
  text: ReturnType<typeof getCopy>;
  onPlayTrack: Props["onPlayTrack"];
  onOpenArtist: Props["onOpenArtist"];
  onOpenAlbum: Props["onOpenAlbum"];
  onContextMenu: Props["onSongContextMenu"];
}) {
  return (
    <div
      className="home-song-card"
      role="button"
      tabIndex={0}
      onClick={() => onPlayTrack(song.hash, queue)}
      onContextMenu={(event) => onContextMenu(event, song, queue)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPlayTrack(song.hash, queue);
        }
      }}
    >
      <span className="home-song-card__cover" aria-hidden="true">
        {song.artworkUrl ? (
          <img src={song.artworkUrl} alt="" loading="lazy" />
        ) : (
          <span className="home-song-card__cover-fallback">
            <NoteIcon />
          </span>
        )}
      </span>
      <span className="home-song-card__copy">
        <span className="home-song-card__title">{song.name}</span>
        <span className="home-song-card__subtitle song-meta-links">
          {song.artists.length
            ? song.artists.map((artist, index) => (
                <span
                  key={`${song.hash}:${artist}:${index}`}
                  className="song-meta-links__item"
                >
                  <button
                    className="song-meta-link"
                    type="button"
                    disabled={!song.artistIds[index]}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onOpenArtist(song.artistIds[index] ?? null, artist);
                    }}
                  >
                    {artist}
                  </button>
                  {index < song.artists.length - 1 ? (
                    <span className="song-meta-links__separator"> / </span>
                  ) : null}
                </span>
              ))
            : text.unknownArtist}
        </span>
      </span>
      <span className="home-song-card__meta">
        <button
          className="song-meta-link"
          type="button"
          disabled={!song.albumId}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (song.albumId)
              onOpenAlbum(song.albumId, song.album || text.unknownAlbum);
          }}
        >
          {song.album || text.unknownAlbum}
        </button>
      </span>
      <span className="home-song-card__duration">
        {formatDuration(song.durationMs)}
      </span>
      <span className="home-song-card__badge">{badge}</span>
    </div>
  );
}

export function KugouHomeScreen({
  settings,
  locale,
  mediaLibrary,
  isLibraryLoading,
  onPlayTrack,
  onPlayPersonalFmTrack,
  onSongContextMenu,
  onPlayLocalTrack,
  onOpenTrackArtist,
  onOpenTrackAlbum,
  onOpenArtist,
  onOpenAlbum,
  onOpenPlaylist,
}: Props) {
  const text = getCopy(locale);
  const enabled = isKugouSourceEnabled(settings);
  const offlineRecommendations = getOfflineRecommendations(
    (mediaLibrary?.tracks ?? []).filter(
      (track) => track.source.kind === "localFile",
    ),
  );
  const [feed, setFeed] = useState<HomeFeed>({
    account: null,
    dailySongs: [],
    personalFmSongs: [],
    playlists: [],
  });
  const [loading, setLoading] = useState(false);
  const [refreshingFm, setRefreshingFm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setFeed({
        account: null,
        dailySongs: [],
        personalFmSongs: [],
        playlists: [],
      });
      setError(null);
      return;
    }
    let cancelled = false;
    const cacheKey = getCacheKey(settings);
    const cached = feedCache.get(cacheKey);
    if (cached) {
      setFeed(cached);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    void Promise.all([
      getKugouDailyRecommendedSongs(settings, 8),
      getKugouPersonalFmSongs(settings, 3),
      getKugouTopPlaylists(settings, "0", 8),
      getKugouLoggedInAccount(settings).catch(() => null),
    ])
      .then(([dailySongs, personalFmSongs, playlists, account]) => {
        if (cancelled) return;
        const nextFeed = { account, dailySongs, personalFmSongs, playlists };
        setBoundedMapValue(feedCache, cacheKey, nextFeed, 12);
        setFeed(nextFeed);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : text.empty);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, reloadKey, settings, text.empty]);

  const refreshFm = async () => {
    if (refreshingFm) return;
    setRefreshingFm(true);
    try {
      const personalFmSongs = await getKugouPersonalFmSongs(settings, 3);
      setFeed((current) => {
        const nextFeed = { ...current, personalFmSongs };
        setBoundedMapValue(feedCache, getCacheKey(settings), nextFeed, 12);
        return nextFeed;
      });
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text.empty);
    } finally {
      setRefreshingFm(false);
    }
  };

  return (
    <section className="home-screen">
      <header className="home-hero">
        <div className="home-hero__copy">
          <h2 className="settings-screen__title">
            {`${text.title}${feed.account?.nickname ? `，${feed.account.nickname}` : ""}`}
          </h2>
          <p className="settings-screen__description">{text.description}</p>
        </div>
      </header>
      {!enabled ? <p className="library-empty">{text.unavailable}</p> : null}
      {enabled ? (
        <>
          <section className="home-section home-section--fm">
            {loading && !feed.personalFmSongs.length ? (
              <UILoadingBlock label={text.loadingFm} variant="grid" />
            ) : null}
            {!loading && error && !feed.personalFmSongs.length ? (
              <div className="network-section-error">
                <p className="library-empty">{error}</p>
                <UIButton
                  variant="secondary"
                  size="sm"
                  onClick={() => setReloadKey((value) => value + 1)}
                >
                  {text.retry}
                </UIButton>
              </div>
            ) : null}
            {!loading && !error && !feed.personalFmSongs.length ? (
              <p className="library-empty">{text.empty}</p>
            ) : null}
            {feed.personalFmSongs.length ? (
              <div className="home-fm-panel">
                <div className="home-fm-panel__hero">
                  <div className="home-fm-panel__copy">
                    <span className="home-fm-panel__eyebrow">
                      {text.source}
                    </span>
                    <h3 className="home-fm-panel__title">{text.fm}</h3>
                    <p className="home-fm-panel__description">
                      {refreshingFm ? text.refreshingFm : text.fmHint}
                    </p>
                    <div className="home-fm-panel__actions">
                      <button
                        className="home-fm-cta home-fm-cta--primary"
                        type="button"
                        onClick={() =>
                          onPlayPersonalFmTrack(
                            feed.personalFmSongs[0].hash,
                            feed.personalFmSongs,
                          )
                        }
                        disabled={refreshingFm}
                      >
                        <ArrowIcon className="arr-2" />
                        <span className="text">{text.startFm}</span>
                        <span className="circle" />
                        <ArrowIcon className="arr-1" />
                      </button>
                      <button
                        className="home-fm-cta home-fm-cta--secondary"
                        type="button"
                        onClick={() => void refreshFm()}
                        disabled={refreshingFm}
                      >
                        <RefreshIcon
                          className="arr-2"
                          spinning={refreshingFm}
                        />
                        <span className="text">
                          {refreshingFm ? text.refreshingFm : text.refreshFm}
                        </span>
                        <span className="circle" />
                        <RefreshIcon
                          className="arr-1"
                          spinning={refreshingFm}
                        />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="home-fm-panel__queue">
                  {feed.personalFmSongs.map((song, index) => (
                    <button
                      key={`${song.hash}:${index}`}
                      className={[
                        "home-fm-track",
                        index === 0 ? "home-fm-track--lead" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      type="button"
                      onClick={() =>
                        onPlayPersonalFmTrack(song.hash, feed.personalFmSongs)
                      }
                      onContextMenu={(event) =>
                        onSongContextMenu(event, song, feed.personalFmSongs)
                      }
                    >
                      <span className="home-fm-track__index">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="home-fm-track__cover" aria-hidden="true">
                        {song.artworkUrl ? (
                          <img src={song.artworkUrl} alt="" loading="lazy" />
                        ) : (
                          <span className="home-fm-track__cover-fallback">
                            <NoteIcon />
                          </span>
                        )}
                      </span>
                      <span className="home-fm-track__copy">
                        <span className="home-fm-track__title">
                          {song.name}
                        </span>
                        <span className="home-fm-track__meta">
                          {song.artists.join(" / ") || text.unknownArtist}
                        </span>
                      </span>
                      <span className="home-fm-track__duration">
                        {formatDuration(song.durationMs)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
          <section className="home-section">
            <div className="home-section__header">
              <div>
                <p className="settings-screen__eyebrow">{text.source}</p>
                <h3 className="settings-card__title">{text.dailySongs}</h3>
              </div>
              {loading ? (
                <span className="home-section__hint">{text.loading}</span>
              ) : null}
            </div>
            <div className="home-song-list">
              {loading && !feed.dailySongs.length ? (
                <UILoadingBlock label={text.loading} variant="list" />
              ) : null}
              {!loading && error && !feed.dailySongs.length ? (
                <div className="network-section-error">
                  <p className="library-empty">{error}</p>
                  <UIButton
                    variant="secondary"
                    size="sm"
                    onClick={() => setReloadKey((value) => value + 1)}
                  >
                    {text.retry}
                  </UIButton>
                </div>
              ) : null}
              {!loading && !error && !feed.dailySongs.length ? (
                <p className="library-empty">{text.empty}</p>
              ) : null}
              {feed.dailySongs.map((song) => (
                <SongRow
                  key={song.hash}
                  song={song}
                  queue={feed.dailySongs}
                  badge={text.dailyTag}
                  text={text}
                  onPlayTrack={onPlayTrack}
                  onOpenArtist={onOpenArtist}
                  onOpenAlbum={onOpenAlbum}
                  onContextMenu={onSongContextMenu}
                />
              ))}
            </div>
          </section>
          <section className="home-section">
            <div className="home-section__header">
              <div>
                <p className="settings-screen__eyebrow">{text.source}</p>
                <h3 className="settings-card__title">{text.playlists}</h3>
              </div>
            </div>
            <div className="playlist-waterfall-grid">
              {loading && !feed.playlists.length ? (
                <UILoadingBlock label={text.loading} variant="grid" />
              ) : null}
              {!loading && !error && !feed.playlists.length ? (
                <p className="library-empty">{text.empty}</p>
              ) : null}
              {feed.playlists.map((playlist) => (
                <button
                  key={playlist.collectionId}
                  className="home-media-card home-media-card--button home-media-card--compact playlist-preview-card"
                  type="button"
                  onClick={() => onOpenPlaylist(playlist)}
                >
                  <div className="home-media-card__artwork" aria-hidden="true">
                    {playlist.artworkUrl ? (
                      <img src={playlist.artworkUrl} alt="" loading="lazy" />
                    ) : (
                      <span className="home-media-card__fallback">
                        <NoteIcon />
                      </span>
                    )}
                  </div>
                  <div className="home-media-card__copy">
                    <strong>{playlist.name}</strong>
                    <p>{playlist.description || text.empty}</p>
                  </div>
                  <div className="home-media-card__meta">
                    <span>
                      {playlist.playCount?.toLocaleString(locale) || "--"}{" "}
                      {text.playCount}
                    </span>
                    <span>
                      {text.creatorPrefix} {playlist.creatorName || text.source}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
          <section className="home-section">
            <div className="home-section__header">
              <div>
                <p className="settings-screen__eyebrow">{text.offlineSource}</p>
                <h3 className="settings-card__title">{text.offlinePicks}</h3>
              </div>
            </div>
            {isLibraryLoading ? (
              <UILoadingBlock label={text.loading} variant="list" />
            ) : offlineRecommendations.length === 0 ? (
              <p className="library-empty">{text.emptyLibrary}</p>
            ) : (
              <div className="home-song-list">
                {offlineRecommendations.map((track) => {
                  const artworkUrl = settings.appearance.showAlbumArtwork
                    ? getArtworkUrl(track, mediaLibrary)
                    : null;
                  return (
                    <div
                      key={track.id}
                      className="home-song-card"
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        onPlayLocalTrack(track.id, offlineRecommendations)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onPlayLocalTrack(track.id, offlineRecommendations);
                        }
                      }}
                    >
                      <span
                        className="home-song-card__cover"
                        aria-hidden="true"
                      >
                        {artworkUrl ? (
                          <img src={artworkUrl} alt="" loading="lazy" />
                        ) : (
                          <span className="home-song-card__cover-fallback">
                            <NoteIcon />
                          </span>
                        )}
                      </span>
                      <span className="home-song-card__copy">
                        <span className="home-song-card__title">
                          {track.title}
                        </span>
                        <span className="home-song-card__subtitle">
                          <button
                            className="song-meta-link"
                            type="button"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              onOpenTrackArtist(track);
                            }}
                          >
                            {track.artist?.trim() || text.unknownArtist}
                          </button>
                        </span>
                      </span>
                      <span className="home-song-card__meta">
                        <button
                          className="song-meta-link"
                          type="button"
                          disabled={!track.album?.trim()}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onOpenTrackAlbum(track);
                          }}
                        >
                          {track.album?.trim() || text.unknownAlbum}
                        </button>
                      </span>
                      <span className="home-song-card__duration">
                        {formatDuration(track.durationMs)}
                      </span>
                      <span className="home-song-card__badge">
                        {text.localTag}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}
