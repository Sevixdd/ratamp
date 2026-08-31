import { getValidAccessToken, refreshAccessToken } from "./auth";
import type {
  SpotifyPlaylist,
  SpotifyPlaylistTrackItem,
  SpotifyTrack,
} from "./types";

export const LIKED_SONGS_ID = "liked-songs";

function isPlayableTrack(track: SpotifyTrack | null): track is SpotifyTrack {
  return Boolean(
    track?.name &&
      track.uri?.startsWith("spotify:track:") &&
      (track.id || track.uri)
  );
}

function normalizePath(path: string) {
  if (path.startsWith("https://api.spotify.com/v1")) {
    return path.replace("https://api.spotify.com/v1", "");
  }

  return path;
}

function withMarket(path: string) {
  const [pathname, search = ""] = normalizePath(path).split("?");
  const params = new URLSearchParams(search);

  if (!params.has("market")) {
    params.set("market", "from_token");
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

async function fetchAllItems<T>(firstPath: string, addMarket = true) {
  const items: T[] = [];
  let path: string | null = firstPath;

  while (path) {
    const data: { items?: T[]; next?: string | null } = await spotifyFetch(
      addMarket ? withMarket(path) : path
    );
    items.push(...(data.items ?? []));
    path = data.next ?? null;
  }

  return items;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function parseSpotifyErrorBody(text: string) {
  const trimmed = text.trim();

  if (!trimmed) {
    return "";
  }

  try {
    const json = JSON.parse(trimmed) as {
      error?: string | { message?: string };
      error_description?: string;
    };

    if (typeof json.error === "object" && json.error?.message) {
      return json.error.message;
    }

    if (json.error_description) {
      return json.error_description;
    }

    if (typeof json.error === "string") {
      return json.error;
    }
  } catch {
    // Spotify sometimes returns plain text like "Too many requests".
  }

  return trimmed;
}

function formatSpotifyError(status: number, text: string) {
  const message = parseSpotifyErrorBody(text);

  if (status === 429 || /too many requests/i.test(message)) {
    return "Spotify rate-limited this app. Wait a minute, then search or reload playlists again.";
  }

  if (status === 401 || /access token/i.test(message)) {
    return "Spotify login expired. Disconnect and connect again.";
  }

  if (
    status === 403 ||
    /forbidden/i.test(message) ||
    /not registered/i.test(message) ||
    /development mode/i.test(message)
  ) {
    return "This Spotify account isn't allowed to use this app yet. Add their email in the Spotify Developer Dashboard under User Management, then have them disconnect and connect again.";
  }

  return message || `Spotify API error (${status})`;
}

async function readResponseBody(response: Response) {
  const text = await response.text();

  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(formatSpotifyError(response.status, text));
  }
}

async function spotifyFetch<T>(
  path: string,
  options: RequestInit = {},
  didRefresh = false,
  didRetry429 = false
): Promise<T> {
  const token = await getValidAccessToken();

  if (!token) {
    throw new Error("Not authenticated");
  }

  const response = await fetch(`https://api.spotify.com/v1${normalizePath(path)}`, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (response.status === 401 && !didRefresh) {
    await refreshAccessToken();
    return spotifyFetch(path, options, true, didRetry429);
  }

  if (response.status === 429 && !didRetry429) {
    const retryAfter = Number(response.headers.get("Retry-After") ?? "2");
    await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 2000);
    return spotifyFetch(path, options, didRefresh, true);
  }

  if (!response.ok) {
    throw new Error(formatSpotifyError(response.status, await response.text()));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await readResponseBody(response)) as T;
}

export async function getUserPlaylists() {
  const items = await fetchAllItems<SpotifyPlaylist | null>(
    "/me/playlists?limit=50",
    false
  );

  return items.filter((item): item is SpotifyPlaylist =>
    Boolean(item?.id && item.name)
  );
}

export async function getSavedTracksCount() {
  const data = await spotifyFetch<{ total: number }>("/me/tracks?limit=1");
  return data.total;
}

export function createLikedSongsPlaylist(total: number): SpotifyPlaylist {
  return {
    id: LIKED_SONGS_ID,
    name: "Liked Songs",
    description: "Songs you've saved",
    uri: "",
    tracks: { total },
    items: { total },
    images: [],
  };
}

export async function getSavedTracks() {
  const items = await fetchAllItems<{ track: SpotifyTrack | null }>(
    "/me/tracks?limit=50"
  );

  return items.map((item) => item.track).filter(isPlayableTrack);
}

export async function getPlaylistTracks(playlistId: string) {
  if (playlistId === LIKED_SONGS_ID) {
    return getSavedTracks();
  }

  try {
    const entries = await fetchAllItems<SpotifyPlaylistTrackItem>(
      `/playlists/${encodeURIComponent(playlistId)}/items?limit=50`,
      false
    );

    return entries
      .map((entry) => entry?.item ?? entry?.track ?? null)
      .filter(isPlayableTrack)
      .map((track) => ({
        ...track,
        id: track.id || track.uri,
      }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (/forbidden/i.test(message)) {
      throw new Error(
        "Spotify only lets this app read playlists you own or collaborate on."
      );
    }

    throw error;
  }
}

export async function searchTracks(query: string) {
  const params = new URLSearchParams({
    q: query,
    type: "track",
    limit: "10",
    market: "from_token",
  });

  const data = await spotifyFetch<{ tracks: { items: SpotifyTrack[] } }>(
    `/search?${params}`
  );

  return (data.tracks.items ?? []).filter(isPlayableTrack);
}

export async function playUri(
  deviceId: string,
  uri: string,
  contextUri?: string
) {
  const body = contextUri
    ? { context_uri: contextUri, offset: { uri } }
    : uri.startsWith("spotify:playlist:") || uri.startsWith("spotify:album:")
      ? { context_uri: uri }
      : { uris: [uri] };

  await spotifyFetch(`/me/player/play?device_id=${deviceId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function getCoverUrl(
  images: { url: string }[] | null | undefined,
  size: "small" | "large" = "small"
) {
  if (!images || images.length === 0) {
    return null;
  }

  if (size === "large") {
    return images[0]?.url ?? null;
  }

  return images[images.length - 1]?.url ?? images[0]?.url ?? null;
}

export function playlistTrackCount(playlist: {
  items?: { total: number } | null;
  tracks?: { total: number } | null;
}) {
  return playlist.items?.total ?? playlist.tracks?.total ?? 0;
}

export function formatArtists(artists: { name: string }[] | null | undefined) {
  return (artists ?? []).map((artist) => artist.name).join(", ");
}
