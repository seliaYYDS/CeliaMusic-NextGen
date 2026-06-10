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

  useEffect(() => subscribeImmersiveWallpaperStaticSnapshot(setStaticSnapshot), []);
  useEffect(() => subscribeImmersiveWallpaperDynamicSnapshot(setDynamicSnapshot), []);

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
        immersiveBackgroundVideoSrc={safeStaticSnapshot.appBackgroundVideoSrc}
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
