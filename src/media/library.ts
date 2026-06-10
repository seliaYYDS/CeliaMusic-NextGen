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
