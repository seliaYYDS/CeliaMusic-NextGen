import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import {
  buildImmersiveFallbackPalette,
  formatTimeLabel,
  getImmersivePlayerCopy,
  getLocaleStrings,
  ImmersivePlayerOverlay,
} from "./AppShell";
import {
  EMPTY_IMMERSIVE_WALLPAPER_DYNAMIC_SNAPSHOT,
  EMPTY_IMMERSIVE_WALLPAPER_STATIC_SNAPSHOT,
  readImmersiveWallpaperDynamicSnapshot,
  readImmersiveWallpaperStaticSnapshot,
  subscribeImmersiveWallpaperDynamicSnapshot,
  subscribeImmersiveWallpaperStaticSnapshot,
} from "./immersiveWallpaperSync";
import {
  loadWallpaperEngineProjectForHost,
  readWallpaperEngineProjectState,
  subscribeWallpaperEngineProjectState,
  type WallpaperEngineProjectState,
} from "./wallpaperEngineSync";
import { WallpaperEngineSceneRenderer } from "./WallpaperEngineSceneRenderer";

const noopAsync = async () => undefined;
const noop = () => undefined;

function logWallpaperWindow(message: string, details?: unknown) {
  if (details === undefined) {
    console.info(`[wallpaper-window] ${message}`);
    return;
  }

  console.info(`[wallpaper-window] ${message}`, details);
}

export function ImmersiveWallpaperWindow() {
  const [staticSnapshot, setStaticSnapshot] = useState(() => readImmersiveWallpaperStaticSnapshot());
  const [dynamicSnapshot, setDynamicSnapshot] = useState(() => readImmersiveWallpaperDynamicSnapshot());
  const [wallpaperEngineProject, setWallpaperEngineProject] = useState<WallpaperEngineProjectState | null>(() =>
    readWallpaperEngineProjectState(),
  );

  useEffect(() => subscribeImmersiveWallpaperStaticSnapshot(setStaticSnapshot), []);
  useEffect(() => subscribeImmersiveWallpaperDynamicSnapshot(setDynamicSnapshot), []);
  useEffect(() => subscribeWallpaperEngineProjectState(setWallpaperEngineProject), []);
  useEffect(() => {
    if (!wallpaperEngineProject) {
      return;
    }
    const requiresSceneRuntime = wallpaperEngineProject.descriptor.wallpaperType === "scene" && !wallpaperEngineProject.sceneRuntime;
    const requiresWebHost = wallpaperEngineProject.descriptor.wallpaperType === "web" && !wallpaperEngineProject.webHostUrl;
    if (!requiresSceneRuntime && !requiresWebHost) {
      return;
    }

    void loadWallpaperEngineProjectForHost(wallpaperEngineProject.folderPath, "immersive-wallpaper").catch((error) => {
      console.error("[wallpaper-engine] failed to prepare scene runtime for immersive host", error);
    });
  }, [wallpaperEngineProject]);
  const safeStaticSnapshot = staticSnapshot ?? EMPTY_IMMERSIVE_WALLPAPER_STATIC_SNAPSHOT;
  const safeDynamicSnapshot = dynamicSnapshot ?? EMPTY_IMMERSIVE_WALLPAPER_DYNAMIC_SNAPSHOT;
  const copy = getImmersivePlayerCopy(safeStaticSnapshot.locale);
  const localeStrings = getLocaleStrings(safeStaticSnapshot.locale);
  const palette =
    safeStaticSnapshot.palette ?? buildImmersiveFallbackPalette(safeStaticSnapshot.appearanceSettings);
  const trackTitle = safeStaticSnapshot.title.trim().length > 0 ? safeStaticSnapshot.title : localeStrings.player.idleTitle;
  const trackArtist =
    safeStaticSnapshot.artist?.trim() ||
    (safeStaticSnapshot.locale === "en-US" ? "Unknown Artist" : "未知歌手");

  useEffect(() => {
    logWallpaperWindow("mounted immersive wallpaper renderer", {
      hasTrack: safeStaticSnapshot.hasTrack,
      trackId: safeStaticSnapshot.trackId,
      durationSeconds: safeDynamicSnapshot.durationSeconds,
    });

    return () => {
      logWallpaperWindow("unmounted immersive wallpaper renderer");
    };
  }, []);

  useEffect(() => {
    logWallpaperWindow("wallpaper static snapshot updated", {
      hasTrack: safeStaticSnapshot.hasTrack,
      trackId: safeStaticSnapshot.trackId,
      title: safeStaticSnapshot.title,
      artist: safeStaticSnapshot.artist,
      album: safeStaticSnapshot.album,
      hasBackgroundVideo: Boolean(safeStaticSnapshot.appBackgroundVideoSrc),
      hasArtwork: Boolean(safeStaticSnapshot.artworkUrl),
    });
  }, [
    safeStaticSnapshot.album,
    safeStaticSnapshot.appBackgroundVideoSrc,
    safeStaticSnapshot.artist,
    safeStaticSnapshot.artworkUrl,
    safeStaticSnapshot.hasTrack,
    safeStaticSnapshot.title,
    safeStaticSnapshot.trackId,
  ]);

  useEffect(() => {
    logWallpaperWindow("wallpaper playback state updated", {
      trackId: safeStaticSnapshot.trackId,
      isPlaying: safeDynamicSnapshot.isPlaying,
      isPlaybackLoading: safeDynamicSnapshot.isPlaybackLoading,
      durationSeconds: safeDynamicSnapshot.durationSeconds,
    });
  }, [
    safeDynamicSnapshot.durationSeconds,
    safeDynamicSnapshot.isPlaybackLoading,
    safeDynamicSnapshot.isPlaying,
    safeStaticSnapshot.trackId,
  ]);

  if (wallpaperEngineProject) {
    return <WallpaperEngineProjectRenderer projectState={wallpaperEngineProject} />;
  }

  return (
    <div className="immersive-wallpaper-window">
      <ImmersivePlayerOverlay
        isOpen={safeStaticSnapshot.hasTrack}
        isWindowVisible={true}
        trackId={safeStaticSnapshot.trackId}
        artworkUrl={safeStaticSnapshot.artworkUrl}
        palette={palette}
        appearanceSettings={safeStaticSnapshot.appearanceSettings}
        appBackgroundImageStyle={safeStaticSnapshot.appBackgroundImageStyle}
        appBackgroundVideoSrc={safeStaticSnapshot.appBackgroundVideoSrc}
        appBackgroundVideoLoop={safeStaticSnapshot.appBackgroundVideoLoop}
        immersiveBackgroundVideoSrc={safeStaticSnapshot.immersiveBackgroundVideoSrc}
        appBackgroundOpacity={safeStaticSnapshot.appBackgroundOpacity}
        appBackgroundBlurPx={safeStaticSnapshot.appBackgroundBlurPx}
        appBackgroundDimOpacity={safeStaticSnapshot.appBackgroundDimOpacity}
        copy={copy}
        trackTitle={trackTitle}
        trackArtist={trackArtist}
        trackAlbum={safeStaticSnapshot.album}
        hasTrackArtist={Boolean(safeStaticSnapshot.artist?.trim())}
        progress={safeDynamicSnapshot.progress}
        currentTimeSeconds={safeDynamicSnapshot.currentTimeSeconds}
        elapsedLabel={formatTimeLabel(Math.round(safeDynamicSnapshot.currentTimeSeconds))}
        totalLabel={formatTimeLabel(Math.round(safeDynamicSnapshot.durationSeconds))}
        isAutoMixTransitionActive={false}
        autoMixBadgePhase="hidden"
        isPlaying={safeDynamicSnapshot.isPlaying}
        isPlaybackLoading={safeDynamicSnapshot.isPlaybackLoading}
        lyrics={safeStaticSnapshot.lyrics}
        isLyricsLoading={safeDynamicSnapshot.isLyricsLoading}
        currentLyricsTimeMs={safeDynamicSnapshot.currentLyricsTimeMs}
        activeLyricLineIndex={safeDynamicSnapshot.activeLyricLineIndex}
        lyricsSettings={safeStaticSnapshot.lyricsSettings}
        volume={0}
        canSkipPrevious={false}
        canSkipNext={false}
        playbackMode="ordered"
        playbackModeText={copy.nowPlaying}
        isPlaybackModeLocked={true}
        volumeLabel={localeStrings.player.volumeLabel}
        isMaximized={false}
        isFullscreen={false}
        displayMode="wallpaper"
        localeStrings={localeStrings.window}
        onMinimize={noopAsync}
        onToggleMaximize={noopAsync}
        onToggleFullscreen={noopAsync}
        onCloseWindow={noopAsync}
        onStartDragging={noopAsync}
        onTogglePlayback={noopAsync}
        onSkipPrevious={noopAsync}
        onSkipNext={noopAsync}
        onCyclePlaybackMode={noop}
        onSeekStart={noop}
        onSeek={noop}
        onSeekEnd={noop}
        onLyricSeek={noop}
        onVolumeChange={noop}
        onClose={noop}
      />
    </div>
  );
}

function WallpaperEngineProjectRenderer({
  projectState,
}: {
  projectState: WallpaperEngineProjectState;
}) {
  const descriptor = projectState.descriptor;
  const previewSrc = descriptor.previewPath ? convertFileSrc(descriptor.previewPath) : null;
  const mainFileSrc = descriptor.mainFilePath ? convertFileSrc(descriptor.mainFilePath) : null;
  const sceneEntries = descriptor.scenePkg?.entries.slice(0, 12) ?? [];

  if (descriptor.wallpaperType === "scene") {
    if (projectState.sceneRuntime) {
      return (
        <div className="immersive-wallpaper-window wallpaper-engine-wallpaper">
          <WallpaperEngineSceneRenderer runtime={projectState.sceneRuntime} />
        </div>
      );
    }

    return (
      <div className="immersive-wallpaper-window wallpaper-engine-wallpaper">
        <div
          className="wallpaper-engine-wallpaper__native-scene-host"
          data-we-native-backend={projectState.nativeStatus?.backend ?? "planned-native-renderer"}
          data-we-scene-folder={projectState.folderPath}
        />
      </div>
    );
  }

  if (descriptor.wallpaperType === "web" && projectState.webHostUrl) {
    return (
      <div className="immersive-wallpaper-window wallpaper-engine-wallpaper">
        <iframe
          className="wallpaper-engine-wallpaper__iframe"
          src={projectState.webHostUrl}
          title={descriptor.title || "Wallpaper Engine Web Wallpaper"}
          allow="autoplay; fullscreen"
          referrerPolicy="no-referrer"
        />
      </div>
    );
  }

  if (descriptor.wallpaperType === "web") {
    return <div className="immersive-wallpaper-window wallpaper-engine-wallpaper" />;
  }

  if (descriptor.wallpaperType === "video" && mainFileSrc) {
    return (
      <div className="immersive-wallpaper-window wallpaper-engine-wallpaper">
        <video
          className="wallpaper-engine-wallpaper__video"
          src={mainFileSrc}
          autoPlay
          loop
          muted
          playsInline
        />
      </div>
    );
  }

  return (
    <div className="immersive-wallpaper-window wallpaper-engine-wallpaper">
      {previewSrc ? (
        <img className="wallpaper-engine-wallpaper__preview" src={previewSrc} alt="" />
      ) : (
        <div className="wallpaper-engine-wallpaper__fallback" />
      )}
      <div className="wallpaper-engine-wallpaper__overlay" />
      <section className="wallpaper-engine-wallpaper__panel">
        <p className="wallpaper-engine-wallpaper__eyebrow">Wallpaper Engine Scene</p>
        <h1 className="wallpaper-engine-wallpaper__title">{descriptor.title || "Untitled Wallpaper"}</h1>
        <p className="wallpaper-engine-wallpaper__meta">
          {descriptor.rawType || "Unknown"} · {descriptor.propertyCount} properties
          {descriptor.scenePkg ? ` · ${descriptor.scenePkg.entryCount} pkg entries` : ""}
        </p>
        {descriptor.description ? (
          <p className="wallpaper-engine-wallpaper__description">{descriptor.description}</p>
        ) : null}
        <div className="wallpaper-engine-wallpaper__grid">
          <div>
            <strong>Folder</strong>
            <span>{descriptor.folderPath}</span>
          </div>
          <div>
            <strong>Scene JSON</strong>
            <span>{descriptor.sceneJsonPath ?? "embedded in scene.pkg or unresolved"}</span>
          </div>
          <div>
            <strong>Preview</strong>
            <span>{descriptor.previewPath ?? "none"}</span>
          </div>
          <div>
            <strong>PKG Version</strong>
            <span>{descriptor.scenePkg?.versionTag ?? "unknown"}</span>
          </div>
        </div>
        {sceneEntries.length > 0 ? (
          <div className="wallpaper-engine-wallpaper__entries">
            {sceneEntries.map((entry) => (
              <code key={entry}>{entry}</code>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
