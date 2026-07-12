import { invoke } from "@tauri-apps/api/core";

export const SONG_DOWNLOAD_PROGRESS_EVENT = "song-download-progress";

export type DownloadNeteaseSongRequest = {
  jobId: string;
  songId: number;
  title: string;
  artist: string | null;
  album: string | null;
  artworkUrl: string | null;
  lyric: string | null;
  translatedLyric: string | null;
  romanizedLyric: string | null;
  lyricsMode: "embedded" | "sidecar" | null;
  url: string;
  saveDirectory: string;
  fileExtension: string | null;
};

export type SongDownloadProgressEvent = {
  jobId: string;
  songId: number;
  title: string;
  artist: string | null;
  status: "started" | "progress" | "completed" | "failed";
  receivedBytes: number;
  totalBytes: number | null;
  progressPercent: number | null;
  filePath: string | null;
  error: string | null;
};

export const downloadNeteaseSong = async (
  request: DownloadNeteaseSongRequest,
): Promise<string> =>
  invoke("download_netease_song", { request });
