import type { NeteaseSongSearchResult } from "../network/types";

type KugouSingerInfo = {
  name?: string;
};

type KugouAlbumInfo = {
  name?: string;
};

type KugouPlaylistEntryRecord = {
  name?: string;
  timelen?: number;
  singerinfo?: KugouSingerInfo[];
  albuminfo?: KugouAlbumInfo;
  cover?: string;
  sort?: number;
  fileid?: number;
};

export type ParsedKugouPlaylistTrack = {
  index: number;
  rawTitle: string;
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number | null;
  artworkUrl: string | null;
  searchQueries: string[];
};

export type KugouTrackMatch = {
  songId: number;
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number | null;
  artworkUrl: string | null;
  score: number;
  query: string;
};

export type KugouTrackMatchStrictness =
  | "exactTitleArtist"
  | "fuzzyTitleArtist"
  | "titleOnly";

const TEXT_DECODER_ENCODINGS = ["utf-8", "gb18030", "gbk"] as const;
const FILE_EXTENSION_PATTERN = /\.[a-z0-9]{1,5}$/i;

export async function readKugouPlaylistFile(file: File) {
  const buffer = await file.arrayBuffer();

  for (const encoding of TEXT_DECODER_ENCODINGS) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(buffer);
    } catch {
      continue;
    }
  }

  return new TextDecoder().decode(buffer);
}

export function parseKugouPlaylistJson(text: string): ParsedKugouPlaylistTrack[] {
  const payload = JSON.parse(text) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error("酷狗歌单 JSON 格式无效。");
  }

  return payload
    .map((entry, index) => toParsedKugouPlaylistTrack(entry, index))
    .filter((entry): entry is ParsedKugouPlaylistTrack => entry !== null);
}

export function findBestKugouTrackMatch(
  track: ParsedKugouPlaylistTrack,
  query: string,
  candidates: NeteaseSongSearchResult[],
  strictness: KugouTrackMatchStrictness = "fuzzyTitleArtist",
): KugouTrackMatch | null {
  const scoredCandidates = candidates
    .map((candidate) => ({
      candidate,
      score: scoreNeteaseSearchCandidate(track, candidate, query),
    }))
    .sort((left, right) => right.score - left.score);

  const bestCandidate = scoredCandidates[0];
  if (!bestCandidate) {
    return null;
  }

  const matchedCandidate = scoredCandidates.find(({ candidate, score }) =>
    isKugouTrackMatchAccepted(track, candidate, score, strictness),
  );
  if (!matchedCandidate) {
    return null;
  }

  return {
    songId: matchedCandidate.candidate.id,
    title: matchedCandidate.candidate.name,
    artists: matchedCandidate.candidate.artists,
    album: matchedCandidate.candidate.album ?? null,
    durationMs: matchedCandidate.candidate.durationMs ?? null,
    artworkUrl: matchedCandidate.candidate.artworkUrl ?? null,
    score: matchedCandidate.score,
    query,
  };
}

function toParsedKugouPlaylistTrack(
  value: unknown,
  index: number,
): ParsedKugouPlaylistTrack | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as KugouPlaylistEntryRecord;
  const rawTitle = normalizeWhitespace(record.name ?? "");
  if (!rawTitle) {
    return null;
  }

  const artists = (Array.isArray(record.singerinfo) ? record.singerinfo : [])
    .map((artist) => normalizeWhitespace(artist.name ?? ""))
    .filter(Boolean);
  const album = normalizeWhitespace(record.albuminfo?.name ?? "") || null;
  const title = inferTrackTitle(rawTitle, artists);
  const searchQueries = buildTrackQueries(title, rawTitle, artists, album);

  return {
    index,
    rawTitle,
    title,
    artists,
    album,
    durationMs: typeof record.timelen === "number" && Number.isFinite(record.timelen)
      ? record.timelen
      : null,
    artworkUrl: normalizeArtworkUrl(record.cover ?? null),
    searchQueries,
  };
}

function buildTrackQueries(
  title: string,
  rawTitle: string,
  artists: string[],
  _album: string | null,
) {
  const titleOnly = stripTrailingArtistSuffix(stripFileExtension(title), artists);
  const rawTitleOnly = stripTrailingArtistSuffix(stripFileExtension(rawTitle), artists);
  const normalizedArtists = artists.join(" ").trim();
  const titleWithArtists = normalizeWhitespace(
    [titleOnly, normalizedArtists].filter(Boolean).join(" "),
  );

  return Array.from(
    new Set(
      [
        titleWithArtists,
        titleOnly,
        rawTitleOnly,
      ]
        .map((query) => normalizeWhitespace(query))
        .filter(Boolean),
    ),
  );
}

function inferTrackTitle(rawTitle: string, artists: string[]) {
  const strippedTitle = stripTrailingArtistSuffix(stripFileExtension(rawTitle), artists);
  const normalizedArtists = artists.map((artist) => normalizeComparableText(artist));

  const hyphenMatch = strippedTitle.match(/^(.+?)\s*-\s*(.+)$/);
  if (!hyphenMatch) {
    return strippedTitle;
  }

  const [, possibleArtist, possibleTitle] = hyphenMatch;
  if (!possibleArtist || !possibleTitle) {
    return strippedTitle;
  }

  const possibleArtistKey = normalizeComparableText(possibleArtist);
  if (normalizedArtists.some((artist) => artist === possibleArtistKey)) {
    return stripTrailingArtistSuffix(normalizeWhitespace(possibleTitle), artists);
  }

  return strippedTitle;
}

function scoreNeteaseSearchCandidate(
  track: ParsedKugouPlaylistTrack,
  candidate: NeteaseSongSearchResult,
  query: string,
) {
  const titleKey = normalizeComparableText(track.title);
  const rawTitleKey = normalizeComparableText(track.rawTitle);
  const queryKey = normalizeComparableText(query);
  const candidateTitleKey = normalizeComparableText(candidate.name);
  const candidateAlbumKey = normalizeComparableText(candidate.album ?? "");

  let score = 0;

  if (candidateTitleKey === titleKey) {
    score += 92;
  } else if (candidateTitleKey === rawTitleKey) {
    score += 84;
  } else if (candidateTitleKey.includes(titleKey) || titleKey.includes(candidateTitleKey)) {
    score += 66;
  } else if (candidateTitleKey.includes(queryKey) || queryKey.includes(candidateTitleKey)) {
    score += 48;
  }

  const sourceArtists = track.artists.map((artist) => normalizeComparableText(artist));
  const candidateArtists = candidate.artists.map((artist) => normalizeComparableText(artist));
  for (const artist of sourceArtists) {
    if (!artist) {
      continue;
    }

    if (candidateArtists.includes(artist)) {
      score += 22;
      continue;
    }

    if (candidateArtists.some((candidateArtist) => candidateArtist.includes(artist) || artist.includes(candidateArtist))) {
      score += 10;
    }
  }

  const sourceAlbumKey = normalizeComparableText(track.album ?? "");
  if (sourceAlbumKey && candidateAlbumKey) {
    if (sourceAlbumKey === candidateAlbumKey) {
      score += 16;
    } else if (
      sourceAlbumKey.includes(candidateAlbumKey) ||
      candidateAlbumKey.includes(sourceAlbumKey)
    ) {
      score += 8;
    }
  }

  if (track.durationMs !== null && candidate.durationMs !== null) {
    const durationDiff = Math.abs(track.durationMs - candidate.durationMs);
    if (durationDiff <= 1200) {
      score += 18;
    } else if (durationDiff <= 3500) {
      score += 10;
    } else if (durationDiff <= 6500) {
      score += 4;
    } else if (durationDiff >= 15000) {
      score -= 8;
    }
  }

  return score;
}

function isKugouTrackMatchAccepted(
  track: ParsedKugouPlaylistTrack,
  candidate: NeteaseSongSearchResult,
  score: number,
  strictness: KugouTrackMatchStrictness,
) {
  const titleKey = normalizeComparableText(track.title);
  const rawTitleKey = normalizeComparableText(track.rawTitle);
  const candidateTitleKey = normalizeComparableText(candidate.name);
  const sourceArtists = track.artists
    .map((artist) => normalizeComparableText(artist))
    .filter(Boolean);
  const candidateArtists = candidate.artists
    .map((artist) => normalizeComparableText(artist))
    .filter(Boolean);

  const hasExactTitleMatch =
    candidateTitleKey === titleKey || candidateTitleKey === rawTitleKey;
  const hasStrongTitleMatch =
    hasExactTitleMatch ||
    candidateTitleKey.includes(titleKey) ||
    titleKey.includes(candidateTitleKey) ||
    candidateTitleKey.includes(rawTitleKey) ||
    rawTitleKey.includes(candidateTitleKey);
  const allArtistsExactlyMatched =
    sourceArtists.length === 0 ||
    sourceArtists.every((artist) => candidateArtists.includes(artist));
  const hasAnyArtistMatch =
    sourceArtists.length === 0 ||
    sourceArtists.some(
      (artist) =>
        candidateArtists.includes(artist) ||
        candidateArtists.some(
          (candidateArtist) =>
            candidateArtist.includes(artist) || artist.includes(candidateArtist),
        ),
    );

  if (strictness === "exactTitleArtist") {
    return hasExactTitleMatch && allArtistsExactlyMatched;
  }

  if (strictness === "titleOnly") {
    return hasStrongTitleMatch;
  }

  if (!hasStrongTitleMatch && score < 88) {
    return false;
  }

  if (hasStrongTitleMatch && score < 62) {
    return false;
  }

  if (track.artists.length > 0 && !hasAnyArtistMatch && score < 96) {
    return false;
  }

  return true;
}

function normalizeArtworkUrl(value: string | null) {
  const normalizedValue = normalizeWhitespace(value ?? "");
  if (!normalizedValue) {
    return null;
  }

  return normalizedValue.replace("{size}", "400");
}

function stripFileExtension(value: string) {
  return normalizeWhitespace(value).replace(FILE_EXTENSION_PATTERN, "").trim();
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stripTrailingArtistSuffix(value: string, artists: string[]) {
  let nextValue = normalizeWhitespace(value);
  if (!nextValue || artists.length === 0) {
    return nextValue;
  }

  const artistKeys = new Set(
    artists
      .map((artist) => normalizeComparableText(artist))
      .filter(Boolean),
  );

  while (true) {
    const segments = nextValue
      .split(/\s*[\\/／|｜]+\s*/g)
      .map((segment) => normalizeWhitespace(segment))
      .filter(Boolean);

    if (segments.length < 2) {
      return nextValue;
    }

    const trailingSegment = segments[segments.length - 1];
    if (!artistKeys.has(normalizeComparableText(trailingSegment))) {
      return nextValue;
    }

    nextValue = segments.slice(0, -1).join(" / ");
  }
}

function normalizeComparableText(value: string) {
  return stripFileExtension(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[【】\[\]()（）'"`~!@#$%^&*_+=|\\/:;,.?<>{}\-]/g, "")
    .replace(/\s+/g, "");
}
