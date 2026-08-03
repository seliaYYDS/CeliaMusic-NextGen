import type {
  KugouAlbumDetail,
  KugouAlbumSummary,
  KugouArtistDetail,
  KugouArtistSummary,
  KugouPagedResult,
  KugouPlaylistSummary,
  KugouSongDetail,
  KugouSongSearchResult,
} from "./types";

type RecordValue = Record<string, unknown>;

export function kugouResponseData(payload: RecordValue): RecordValue {
  if (record(payload.data)) return payload.data;
  if (Array.isArray(payload.data)) return { ...payload, items: payload.data };
  if (record(payload.body) && record(payload.body.data))
    return payload.body.data;
  if (record(payload.body)) return payload.body;
  return payload;
}

export function kugouSearchItems(data: RecordValue): RecordValue[] {
  return records(data.lists);
}

export function kugouRecommendationSongItems(data: RecordValue): RecordValue[] {
  return firstRecords(data.song_list, data.songs, data.audios, data.items);
}

export function kugouPlaylistItems(data: RecordValue): RecordValue[] {
  return records(data.songs);
}

export function kugouTopPlaylistItems(data: RecordValue): RecordValue[] {
  return firstRecords(data.special_list, data.specials, data.lists, data.items);
}

export function kugouPlaylistDetailItems(data: RecordValue): RecordValue[] {
  return firstRecords(
    data.items,
    data.info,
    data.list,
    data.lists,
    data.playlists,
  );
}

export function kugouAlbumSongItems(data: RecordValue): RecordValue[] {
  return records(data.songs);
}

export function kugouArtistSongItems(data: RecordValue): RecordValue[] {
  return firstRecords(data.items, data.audios, data.songs, data.lists);
}

export function kugouArtistAlbumItems(data: RecordValue): RecordValue[] {
  return firstRecords(data.items, data.albums, data.info, data.lists);
}

export function kugouUserPlaylistItems(data: RecordValue): RecordValue[] {
  return firstRecords(data.info, data.list, data.lists, data.playlists);
}

export function kugouArtistDetailRecord(data: RecordValue): RecordValue {
  return nestedRecord(data.author, data.singer, data.artist, data.info) ?? data;
}

export function kugouAlbumDetailRecord(data: RecordValue): RecordValue {
  return nestedRecord(data.album, data.info) ?? data;
}

export function kugouKrmAudioRecord(data: RecordValue): RecordValue | null {
  return (
    nestedRecord(data.audio, data.audio_info, data.song_info, data.info) ??
    (record(data.base) ? data : null)
  );
}

export function kugouTotal(data: RecordValue): number | null {
  return numberValue(data.total) ?? numberValue(data.count);
}

export function kugouPage<T>(
  items: T[],
  data: RecordValue,
  limit: number,
  offset: number,
): KugouPagedResult<T> {
  const total = kugouTotal(data);
  return {
    items,
    total,
    limit,
    offset,
    hasMore:
      total === null ? items.length >= limit : offset + items.length < total,
  };
}

export function mapKugouSearchSong(
  value: unknown,
): KugouSongSearchResult | null {
  const item = record(value) ? value : null;
  if (!item) return null;
  const hash = stringValue(item.FileHash);
  const albumAudioId = stringValue(item.MixSongID);
  const name =
    stringValue(item.OriSongName) ??
    songNameFromFileName(stringValue(item.FileName), searchArtists(item));
  if (!hash || !name) return null;
  return {
    id: hash,
    hash,
    albumAudioId,
    name,
    artists: searchArtists(item),
    album: stringValue(item.AlbumName),
    durationMs: secondsToMs(item.Duration),
    artworkUrl: artwork(
      stringValue(item.AlbumImage) ?? stringValue(item.Image),
    ),
  };
}

export function mapKugouSong(value: unknown): KugouSongDetail | null {
  const item = record(value) ? value : null;
  if (!item) return null;
  if ("FileHash" in item) {
    const search = mapKugouSearchSong(item);
    return search ? detailFromSearch(search, item) : null;
  }
  if (record(item.audio_info) && record(item.base)) return mapAlbumSong(item);
  return mapPlaylistOrArtistSong(item);
}

export function mapKugouArtistSong(
  value: unknown,
  artistId: string,
): KugouSongDetail | null {
  const item = record(value) ? value : null;
  if (!item) return null;
  const hash = stringValue(item.hash);
  const name = stringValue(item.audio_name);
  if (!hash || !name) return null;
  const artists = splitArtists(stringValue(item.author_name));
  return detail({
    hash,
    albumAudioId: stringValue(item.album_audio_id),
    name,
    artists,
    artistIds: artists.map((_artist, index) => (index === 0 ? artistId : null)),
    album: stringValue(item.album_name),
    albumId: stringValue(item.album_id),
    albumArtist: stringValue(item.author_name),
    durationMs: duration(item.timelength),
    artworkUrl: artwork(
      record(item.trans_param)
        ? stringValue((item.trans_param as RecordValue).union_cover)
        : null,
    ),
    trackNumber: null,
    discNumber: null,
    year: year(item.publish_date),
    mvId: stringValue(item.video_hash),
    fee: numberValue(item.pay_type),
  });
}

export function mapKugouPlaylist(value: unknown): KugouPlaylistSummary | null {
  const item = record(value) ? value : null;
  if (!item) return null;
  const id =
    numberValue(item.listid) ??
    numberValue(item.list_create_listid) ??
    numberValue(item.specialid);
  const collectionId =
    stringValue(item.global_collection_id) ?? stringValue(item.list_create_gid);
  const name =
    stringValue(item.name) ??
    stringValue(item.listname) ??
    stringValue(item.specialname);
  if (id === null || !collectionId || !name) return null;
  return {
    id,
    collectionId,
    name,
    description: stringValue(item.intro),
    artworkUrl: artwork(
      stringValue(item.flexible_cover) ??
        stringValue(item.imgurl) ??
        stringValue(item.pic),
    ),
    trackCount: numberValue(item.count) ?? numberValue(item.song_count),
    playCount: numberValue(item.play_count) ?? numberValue(item.heat),
    creatorName:
      stringValue(item.list_create_username) ?? stringValue(item.nickname),
    creatorUserId:
      numberValue(item.list_create_userid) ?? numberValue(item.suid),
    isDefault: numberValue(item.is_def) === 1,
    isLiked: numberValue(item.is_def) === 2,
    isOwned: numberValue(item.type) === 0,
  };
}

export function mapKugouAlbum(value: unknown): KugouAlbumSummary | null {
  const source = record(value) ? value : null;
  const item =
    source &&
    (record(source.album_info)
      ? { ...source, ...(source.album_info as RecordValue) }
      : record(source.albumInfo)
        ? { ...source, ...(source.albumInfo as RecordValue) }
        : source);
  if (!item) return null;
  const id =
    stringValue(item.album_id) ??
    stringValue(item.albumid) ??
    stringValue(item.id);
  const name =
    stringValue(item.album_name) ??
    stringValue(item.albumname) ??
    stringValue(item.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    artistName:
      stringValue(item.author_name) ??
      stringValue(item.singername) ??
      stringValue(item.singer) ??
      stringValue(item.artist_name),
    artworkUrl: artwork(
      stringValue(item.sizable_cover) ??
        stringValue(item.cover) ??
        stringValue(item.imgurl) ??
        stringValue(item.img),
    ),
    trackCount:
      numberValue(item.audio_count) ??
      numberValue(item.song_count) ??
      numberValue(item.songcount) ??
      numberValue(item.total),
    publishYear: year(item.publish_date ?? item.publish_time),
  };
}

export function mapKugouAlbumDetail(value: unknown): KugouAlbumDetail | null {
  const item = record(value) ? value : null;
  const summary = mapKugouAlbum(item);
  if (!item || !summary) return null;
  return {
    ...summary,
    description:
      stringValue(item.intro) ??
      stringValue(item.description) ??
      stringValue(item.brief_desc),
    company: stringValue(item.publish_company) ?? stringValue(item.company),
    type: stringValue(item.type),
    songs: [],
  };
}

export function mapKugouArtist(value: unknown): KugouArtistSummary | null {
  const source = record(value) ? value : null;
  const item =
    source && record(source.base)
      ? { ...source, ...(source.base as RecordValue) }
      : source;
  if (!item) return null;
  const id =
    stringValue(item.author_id) ??
    stringValue(item.singerid) ??
    stringValue(item.AuthorId) ??
    stringValue(item.id);
  const name =
    stringValue(item.author_name) ??
    stringValue(item.singername) ??
    stringValue(item.AuthorName) ??
    stringValue(item.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    avatarUrl: artwork(
      stringValue(item.sizable_avatar) ??
        stringValue(item.avatar) ??
        stringValue(item.Avatar) ??
        stringValue(item.imgurl),
    ),
    briefDesc: stringValue(item.intro) ?? stringValue(item.description),
    musicCount:
      numberValue(item.audio_count) ??
      numberValue(item.song_count) ??
      numberValue(item.AudioCount),
    albumCount: numberValue(item.album_count) ?? numberValue(item.AlbumCount),
  };
}

export function mapKugouArtistDetail(value: unknown): KugouArtistDetail | null {
  const item = record(value) ? value : null;
  const summary = mapKugouArtist(item);
  if (!item || !summary) return null;
  return {
    ...summary,
    coverUrl:
      artwork(
        stringValue(item.sizable_avatar) ??
          stringValue(item.avatar) ??
          stringValue(item.cover),
      ) ?? summary.avatarUrl,
    description:
      stringValue(item.intro) ??
      stringValue(item.description) ??
      summary.briefDesc,
    alias: records(item.alias)
      .map((entry) => stringValue(entry.name) ?? stringValue(entry.alias))
      .filter(present),
  };
}

function mapAlbumSong(item: RecordValue): KugouSongDetail | null {
  const audio = item.audio_info as RecordValue;
  const base = item.base as RecordValue;
  const hash = stringValue(audio.hash);
  const name = stringValue(base.audio_name);
  if (!hash || !name) return null;
  const authors = records(item.authors);
  const artists = authors
    .map((author) => stringValue(author.author_name))
    .filter(present);
  return detail({
    hash,
    albumAudioId: stringValue(base.album_audio_id),
    name,
    artists,
    artistIds: authors.map((author) => stringValue(author.author_id)),
    album: record(item.album_info)
      ? stringValue((item.album_info as RecordValue).album_name)
      : null,
    albumId: stringValue(base.album_id),
    albumArtist: stringValue(base.author_name),
    durationMs: duration(audio.duration_320) ?? duration(audio.duration),
    artworkUrl:
      artwork(
        record(item.album_info)
          ? stringValue((item.album_info as RecordValue).cover)
          : null,
      ) ??
      artwork(
        record(item.trans_param)
          ? stringValue((item.trans_param as RecordValue).union_cover)
          : null,
      ),
    trackNumber: record(item.extend)
      ? numberValue((item.extend as RecordValue).sort)
      : null,
    discNumber: record(item.extend)
      ? numberValue((item.extend as RecordValue).disc)
      : null,
    year: null,
    mvId: null,
    fee: record(item.deprecated)
      ? numberValue((item.deprecated as RecordValue).pay_type)
      : null,
  });
}

function mapPlaylistOrArtistSong(item: RecordValue): KugouSongDetail | null {
  const hash = stringValue(item.hash);
  const rawName =
    stringValue(item.name) ??
    stringValue(item.audio_name) ??
    stringValue(item.ori_audio_name) ??
    stringValue(item.songname);
  if (!hash || !rawName) return null;
  const singers = recordsOrRecord(item.singerinfo);
  const authors = recordsOrRecord(item.authors);
  const artists =
    singers.length > 0
      ? singers.map((singer) => stringValue(singer.name)).filter(present)
      : authors.length > 0
        ? authors
            .map(
              (author) =>
                stringValue(author.author_name) ?? stringValue(author.name),
            )
            .filter(present)
        : splitArtists(stringValue(item.author_name));
  const normalized = normalizeTitle(rawName, artists);
  const albumInfo = record(item.albuminfo) ? item.albuminfo : null;
  return detail({
    hash,
    albumAudioId:
      stringValue(item.mixsongid) ?? stringValue(item.album_audio_id),
    name: normalized.name,
    artists: normalized.artists,
    artistIds:
      singers.length > 0
        ? singers.map((singer) => stringValue(singer.id))
        : authors.length > 0
          ? authors.map(
              (author) =>
                stringValue(author.author_id) ?? stringValue(author.id),
            )
          : normalized.artists.map(() => null),
    album: albumInfo
      ? stringValue(albumInfo.name)
      : (stringValue(item.album_name) ?? stringValue(item.remark)),
    albumId:
      stringValue(item.album_id) ??
      (albumInfo ? stringValue(albumInfo.id) : null),
    albumArtist: stringValue(item.author_name) ?? normalized.artists[0] ?? null,
    durationMs:
      duration(item.timelen) ??
      duration(item.timelength) ??
      secondsToMs(item.time_length) ??
      duration(item.duration),
    artworkUrl:
      artwork(stringValue(item.cover) ?? stringValue(item.sizable_cover)) ??
      artwork(
        record(item.trans_param)
          ? stringValue((item.trans_param as RecordValue).union_cover)
          : null,
      ),
    trackNumber: numberValue(item.sort),
    discNumber: null,
    year: year(item.publish_date),
    mvId:
      stringValue(item.mvhash) ??
      stringValue(item.mv_hash) ??
      stringValue(item.video_hash),
    fee: numberValue(item.pay_type),
    fileId: stringValue(item.fileid) ?? stringValue(item.file_id),
  });
}

function detail(
  value: Omit<
    KugouSongDetail,
    "id" | "requiresVip" | "copyrightRestricted" | "unavailableMessage"
  >,
): KugouSongDetail {
  return {
    ...value,
    id: value.hash,
    requiresVip: value.fee !== null && value.fee > 0,
    copyrightRestricted: false,
    unavailableMessage: null,
  };
}

function detailFromSearch(
  search: KugouSongSearchResult,
  item: RecordValue,
): KugouSongDetail {
  return detail({
    hash: search.hash,
    albumAudioId: search.albumAudioId,
    name: search.name,
    artists: search.artists,
    artistIds: searchArtistsWithIds(item).ids,
    album: search.album,
    albumId: stringValue(item.AlbumID),
    albumArtist: search.artists[0] ?? null,
    durationMs: search.durationMs,
    artworkUrl: search.artworkUrl,
    trackNumber: null,
    discNumber: null,
    year: year(item.PublishDate),
    mvId: null,
    fee: numberValue(item.PayType),
  });
}

function searchArtists(item: RecordValue) {
  return searchArtistsWithIds(item).names;
}
function searchArtistsWithIds(item: RecordValue) {
  const entries = records(item.Singers);
  return {
    names: entries.map((entry) => stringValue(entry.name)).filter(present),
    ids: entries.map((entry) => stringValue(entry.id)),
  };
}
function normalizeTitle(name: string, artists: string[]) {
  const match = name.match(/^(.+?)\s+-\s+(.+)$/u);
  if (
    !match ||
    !artists.some(
      (artist) =>
        artist.toLocaleLowerCase() === match[1].trim().toLocaleLowerCase(),
    )
  )
    return { name, artists };
  return { name: match[2].trim(), artists };
}
function splitArtists(value: string | null) {
  return (
    value
      ?.split(/[、/&]/u)
      .map((name) => name.trim())
      .filter(Boolean) ?? []
  );
}
function songNameFromFileName(name: string | null, artists: string[]) {
  return name ? normalizeTitle(name, artists).name : null;
}
function records(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.filter(record) : [];
}
function recordsOrRecord(value: unknown): RecordValue[] {
  return record(value) ? [value] : records(value);
}
function firstRecords(...values: unknown[]) {
  for (const value of values) {
    const items = records(value);
    if (items.length > 0) return items;
  }
  return [];
}
function nestedRecord(...values: unknown[]) {
  return values.find(record) ?? null;
}
function record(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function stringValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}
function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() &&
    Number.isFinite(Number(value))
  )
    return Number(value);
  return null;
}
function duration(value: unknown) {
  const valueMs = numberValue(value);
  return valueMs === null ? null : Math.round(valueMs);
}
function secondsToMs(value: unknown) {
  const seconds = numberValue(value);
  return seconds === null ? null : Math.round(seconds * 1000);
}
function year(value: unknown) {
  const match = stringValue(value)?.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}
function artwork(value: string | null) {
  return value?.replace("{size}", "400").replace(/^http:/i, "https:") ?? null;
}
function present<T>(value: T | null): value is T {
  return value !== null;
}
