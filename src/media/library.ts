import { invoke } from "@tauri-apps/api/core";

import type {
  ImportMediaRequest,
  MediaLibrarySnapshot,
  RemoteTrackDraft,
  SongConfig,
  TrackRecord,
} from "./types";

export type RemoteAudioCacheRequest = {
  url: string;
  mimeType?: string | null;
  headers?: Record<string, string> | null;
  cacheKey?: string | null;
};

export type AudioTrackAnalysis = {
  sourcePath: string;
  durationMs: number;
  sampleRate: number;
  analysisFrameMs: number;
  estimatedTempoBpm: number | null;
  beatTimesMs: number[];
  barTimesMs: number[];
  phraseTimesMs: number[];
  introPhaseEndMs: number | null;
  outroPhaseStartMs: number | null;
  energyCurve: number[];
  averageEnergy: number;
  introEnergy: number;
  outroEnergy: number;
  suggestedTransitionStartMs: number | null;
  suggestedTransitionReason: string;
};

export type LocalLyricsBundle = {
  lyric: string | null;
  translatedLyric: string | null;
  romanizedLyric: string | null;
};

export type LocalSongMetadataInspection = {
  sourcePath: string;
  fileName: string;
  extension: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  durationMs: number | null;
  trackNumber: number | null;
  discNumber: number | null;
  year: number | null;
  genre: string | null;
  hasEmbeddedArtwork: boolean;
  hasRelatedArtwork: boolean;
  artworkPreviewPath: string | null;
  hasEmbeddedLyrics: boolean;
  hasSidecarLyrics: boolean;
  missingFields: string[];
};

export type SaveLocalSongMetadataRequest = {
  path: string;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  lyric?: string | null;
  coverArtPath?: string | null;
};

export const ensureMediaLibrary = async (): Promise<MediaLibrarySnapshot> =>
  invoke("ensure_media_library");

export const listMediaLibrary = async (): Promise<MediaLibrarySnapshot> =>
  invoke("list_media_library");

export const importMediaFiles = async (
  request: ImportMediaRequest,
): Promise<MediaLibrarySnapshot> =>
  invoke("import_media_files", {
    request,
  });

export const clearMediaLibrary = async (): Promise<MediaLibrarySnapshot> =>
  invoke("clear_media_library");

export const deleteMediaTracks = async (
  trackIds: string[],
): Promise<MediaLibrarySnapshot> =>
  invoke("delete_media_tracks", {
    trackIds,
  });

export const registerRemoteTrack = async (
  draft: RemoteTrackDraft,
): Promise<TrackRecord> =>
  invoke("register_remote_track", {
    draft,
  });

export const saveSongConfig = async (
  trackId: string,
  config: SongConfig,
): Promise<TrackRecord> =>
  invoke("save_song_config", {
    patch: {
      trackId,
      config,
    },
  });

export const cacheRemoteAudio = async (request: RemoteAudioCacheRequest): Promise<string> =>
  invoke("cache_remote_audio_for_spectrum", {
    request,
  });

export const clearCachedRemoteAudio = async (path: string): Promise<void> =>
  invoke("clear_cached_spectrum_audio", {
    path,
  });

export const analyzeLocalAudioTrack = async (path: string): Promise<AudioTrackAnalysis> =>
  invoke("analyze_local_audio_track", {
    request: {
      path,
    },
  });

export const inspectLocalSongMetadata = async (
  path: string,
): Promise<LocalSongMetadataInspection> =>
  invoke("inspect_local_song_metadata", {
    request: {
      path,
    },
  });

export const saveLocalSongMetadata = async (
  request: SaveLocalSongMetadataRequest,
): Promise<LocalSongMetadataInspection> =>
  invoke("save_local_song_metadata", {
    request,
  });

export const loadLocalLyrics = async (path: string): Promise<string | null> =>
  invoke("load_local_lyrics", {
    request: {
      path,
    },
  });

export const saveLocalLyrics = async (path: string, content: string): Promise<string> =>
  invoke("save_local_lyrics", {
    request: {
      path,
      content,
    },
  });

export const loadLocalLyricsBundle = async (path: string): Promise<LocalLyricsBundle> =>
  invoke("load_local_lyrics_bundle", {
    request: {
      path,
    },
  });

export const saveLocalLyricsBundle = async (
  path: string,
  lyrics: LocalLyricsBundle,
): Promise<string> =>
  invoke("save_local_lyrics_bundle", {
    request: {
      path,
      ...lyrics,
    },
  });
