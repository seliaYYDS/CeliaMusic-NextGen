export type NeteaseSongSearchResult = {
  id: number;
  name: string;
  artists: string[];
  album: string | null;
  durationMs: number | null;
  artworkUrl: string | null;
};

export type NeteaseSearchHotKeyword = {
  keyword: string;
  score: number | null;
  iconType: number | null;
};

export type NeteaseSearchSuggestions = {
  songs: NeteaseSongDetail[];
  artists: NeteaseArtistSummary[];
  playlists: NeteasePlaylistRecommendation[];
  albums: NeteaseAlbumSummary[];
};

export type NeteasePagedResult<T> = {
  items: T[];
  total: number | null;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type NeteaseArtistSummary = {
  id: number;
  name: string;
  avatarUrl: string | null;
  briefDesc: string | null;
  musicCount: number | null;
  albumCount: number | null;
};

export type NeteaseArtistDetail = NeteaseArtistSummary & {
  coverUrl: string | null;
  description: string | null;
  alias: string[];
};

export type NeteaseAlbumSummary = {
  id: number;
  name: string;
  artistName: string | null;
  artworkUrl: string | null;
  trackCount: number | null;
  publishYear: number | null;
};

export type NeteaseAlbumDetail = NeteaseAlbumSummary & {
  description: string | null;
  company: string | null;
  type: string | null;
  songs: NeteaseSongDetail[];
};

export type NeteaseSongDetail = {
  id: number;
  name: string;
  artists: string[];
  artistIds: number[];
  album: string | null;
  albumId: number | null;
  albumArtist: string | null;
  durationMs: number | null;
  artworkUrl: string | null;
  trackNumber: number | null;
  discNumber: number | null;
  year: number | null;
  mvId: number | null;
  fee: number | null;
  requiresVip: boolean;
  copyrightRestricted: boolean;
  unavailableMessage: string | null;
};

export type NeteaseMvStream = {
  mvId: number;
  url: string;
  resolution: number | null;
};

export type NeteasePlaylistRecommendation = {
  id: number;
  name: string;
  description: string | null;
  artworkUrl: string | null;
  trackCount: number | null;
  playCount: number | null;
  creatorName: string | null;
  creatorUserId: number | null;
  subscribed: boolean;
};

export type NeteaseDjRecommendation = {
  id: number;
  name: string;
  description: string | null;
  artworkUrl: string | null;
  djName: string | null;
  programCount: number | null;
  subscribedCount: number | null;
};

export type NeteaseSongStream = {
  id: number;
  url: string;
  br: number | null;
  size: number | null;
  type: string | null;
  level: string | null;
  code: number | null;
  fee: number | null;
  isFreeTrial: boolean;
  trialStart: number | null;
  trialEnd: number | null;
};

export type NeteaseSongLyrics = {
  lyric: string | null;
  translatedLyric: string | null;
  romanizedLyric: string | null;
  dynamicLyric: string | null;
  metadataEntries: NeteaseLyricMetadataEntry[];
  lines: NeteaseParsedLyricLine[];
  source: "line" | "word";
};

export type NeteaseLyricMetadataEntry = {
  timeMs: number;
  text: string;
  artworkUrl: string | null;
  target: string | null;
};

export type NeteaseParsedLyricWord = {
  text: string;
  startTimeMs: number;
  durationMs: number;
  endTimeMs: number;
};

export type NeteaseParsedLyricLine = {
  text: string;
  startTimeMs: number;
  durationMs: number;
  endTimeMs: number;
  translatedText: string | null;
  romanizedText: string | null;
  words: NeteaseParsedLyricWord[];
};

export type NeteaseResolvedTrack = {
  detail: NeteaseSongDetail;
  stream: NeteaseSongStream;
  fallbackStreams: NeteaseSongStream[];
  lyrics: NeteaseSongLyrics | null;
  availability: {
    success: boolean;
    message: string | null;
  } | null;
  notice: string | null;
};

export type NeteaseQrLoginSession = {
  key: string;
  qrUrl: string;
  qrImage: string | null;
};

export type NeteaseQrLoginStatusCode = 800 | 801 | 802 | 803;

export type NeteaseQrLoginStatus = {
  code: NeteaseQrLoginStatusCode;
  message: string | null;
  cookie: string | null;
};

export type NeteaseAccountProfile = {
  userId: number;
  nickname: string;
  avatarUrl: string | null;
  backgroundUrl: string | null;
  signature: string | null;
  level: number | null;
  vipType: number | null;
};
