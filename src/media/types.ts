export type PlaybackMode = "localFile" | "remoteStream" | "hybrid";

export type PlaybackSource = {
  mode: PlaybackMode;
  primaryUri: string;
  fallbackUri: string | null;
  fallbackUris: string[];
  cacheKey: string | null;
};

export type LocalFileSource = {
  path: string;
  fileName: string;
  extension: string | null;
  fileSizeBytes: number | null;
  modifiedAtMs: number | null;
};

export type RemoteStreamSource = {
  url: string;
  mimeType: string | null;
  headers: Record<string, string>;
};

export type MediaSource =
  | {
      kind: "localFile";
      path: string;
      fileName: string;
      extension: string | null;
      fileSizeBytes: number | null;
      modifiedAtMs: number | null;
    }
  | {
      kind: "remoteStream";
      url: string;
      mimeType: string | null;
      headers: Record<string, string>;
    };

export type ArtworkSource =
  | {
      kind: "localFile";
      path: string;
      fileName: string;
      extension: string | null;
      fileSizeBytes: number | null;
      modifiedAtMs: number | null;
    }
  | {
      kind: "remoteUrl";
      url: string;
    };

export type SongConfig = {
  preferredArtworkId: string | null;
  lyricsOffsetMs: number;
  trimStartMs: number;
  trimEndMs: number | null;
  loudnessGainDb: number;
  replayGainEnabled: boolean;
  lastPositionMs: number;
  normalizeVolume: boolean;
};

export type TrackRecord = {
  id: string;
  source: MediaSource;
  playback: PlaybackSource;
  title: string;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  durationMs: number | null;
  trackNumber: number | null;
  discNumber: number | null;
  year: number | null;
  genre: string | null;
  artworkIds: string[];
  config: SongConfig;
  importedAtMs: number;
  updatedAtMs: number;
};

export type ArtworkRecord = {
  id: string;
  source: ArtworkSource;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  importedAtMs: number;
  updatedAtMs: number;
};

export type MediaLibrarySnapshot = {
  schemaVersion: number;
  libraryPath: string;
  tracks: TrackRecord[];
  artworks: ArtworkRecord[];
  importedAtMs: number;
};

export type ImportMediaRequest = {
  paths: string[];
};

export type RemoteTrackDraft = {
  title: string;
  artist?: string | null;
  album?: string | null;
  albumArtist?: string | null;
  durationMs?: number | null;
  genre?: string | null;
  streamUrl: string;
  artworkUrl?: string | null;
  fallbackLocalPath?: string | null;
  fallbackUrls?: string[] | null;
  mimeType?: string | null;
  headers?: Record<string, string> | null;
  cacheKey?: string | null;
};

export type SongConfigPatch = {
  trackId: string;
  config: SongConfig;
};

export const createDefaultSongConfig = (): SongConfig => ({
  preferredArtworkId: null,
  lyricsOffsetMs: 0,
  trimStartMs: 0,
  trimEndMs: null,
  loudnessGainDb: 0,
  replayGainEnabled: true,
  lastPositionMs: 0,
  normalizeVolume: true,
});

export const isLocalSource = (
  source: MediaSource,
): source is Extract<MediaSource, { kind: "localFile" }> =>
  source.kind === "localFile";

export const isRemoteSource = (
  source: MediaSource,
): source is Extract<MediaSource, { kind: "remoteStream" }> =>
  source.kind === "remoteStream";
