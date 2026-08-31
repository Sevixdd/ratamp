import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";

import "./App.css";
import { login } from "./spotify/login";
import {
  clearAuth,
  exchangeCode,
  getAccessToken,
  hasUsedAuthCode,
} from "./spotify/auth";
import {
  createLikedSongsPlaylist,
  formatArtists,
  getCoverUrl,
  getPlaylistTracks,
  getSavedTracksCount,
  getUserPlaylists,
  playlistTrackCount,
  playUri,
  searchTracks,
} from "./spotify/api";
import {
  artistIdFromRef,
  resolveTrackGenres,
  themeFromGenres,
  type GenreTheme,
} from "./spotify/genre";
import { createPlayer, getSpotifyPlayer } from "./spotify/player";
import type { SpotifyPlaylist, SpotifyTrack } from "./spotify/types";
import { WinampPlayer } from "./WinampPlayer";
import { WindowButtons } from "./WindowButtons";
import appLogo from "./assets/logo.png";

function getParam(url: string, key: string): string | null {
  try {
    return new URL(url).searchParams.get(key);
  } catch {
    const match = url.match(new RegExp(`[?&#]${key}=([^&#]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  }
}

function sdkTrackToSpotify(track: Spotify.Track): SpotifyTrack {
  return {
    id: track.id ?? track.uri,
    name: track.name,
    uri: track.uri,
    duration_ms: track.duration_ms,
    artists: track.artists.map((artist) => ({
      id: artistIdFromRef(artist),
      name: artist.name,
      uri: artist.uri,
    })),
    album: {
      name: track.album.name,
      images: track.album.images.map((image) => ({
        url: image.url,
        height: image.height ?? null,
        width: image.width ?? null,
      })),
    },
  };
}
function Cover({
  images,
  label,
  size = "small",
}: {
  images: { url: string }[] | null | undefined;
  label: string;
  size?: "small" | "large";
}) {
  const url = getCoverUrl(images, size);

  if (!url) {
    return (
      <div
        className={`${size === "large" ? "playlist-cover" : "track-cover"} cover-placeholder`}
      >
        ♪
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={label}
      className={size === "large" ? "playlist-cover" : "track-cover"}
    />
  );
}

function App() {
  const [token, setToken] = useState(getAccessToken());
  const [status, setStatus] = useState("Not connected");
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [playerLoading, setPlayerLoading] = useState(false);

  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistsError, setPlaylistsError] = useState<string | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] =
    useState<SpotifyPlaylist | null>(null);
  const [tracks, setTracks] = useState<SpotifyTrack[]>([]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [tracksError, setTracksError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SpotifyTrack[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<SpotifyTrack | null>(null);
  const [theme, setTheme] = useState<GenreTheme>(() => themeFromGenres([]));
  const [paused, setPaused] = useState(true);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.5);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    async function handleUrl(url: string) {
      const code = getParam(url, "code");
      const error = getParam(url, "error");

      if (error) {
        setStatus(`Spotify error: ${error}`);
        return;
      }

      if (!code) return;

      const existing = getAccessToken();
      if (existing && hasUsedAuthCode(code)) {
        setToken(existing);
        return;
      }

      try {
        setStatus("Authenticating...");
        const result = await exchangeCode(code);
        if (cancelled) return;
        setToken(result.access_token);
        setStatus("Connected to Spotify");
      } catch (err) {
        console.error(err);

        const saved = getAccessToken();
        if (saved) {
          if (!cancelled) {
            setToken(saved);
            setStatus("Connected to Spotify");
          }
          return;
        }

        if (!cancelled) {
          setStatus(
            err instanceof Error ? err.message : "Authentication failed."
          );
        }
      }
    }

    async function setup() {
      try {
        const urls = await getCurrent();
        if (!cancelled && urls?.length) {
          await handleUrl(urls[0]);
        }

        unlisten = await onOpenUrl(async (urls) => {
          if (urls.length) {
            await handleUrl(urls[0]);
          }
        });
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setStatus(
            err instanceof Error
              ? `Deep link setup failed: ${err.message}`
              : "Deep link setup failed."
          );
        }
      }
    }

    setup();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const themedTrackId = useRef<string | null>(null);

  const applyThemeFromTrack = useCallback(async (track: SpotifyTrack) => {
    setCurrentTrack(track);

    const key = track.id || track.uri;
    if (themedTrackId.current === key) return;
    themedTrackId.current = key;

    try {
      const genres = await resolveTrackGenres(track);
      setTheme(themeFromGenres(genres));
    } catch (err) {
      console.error(err);
      themedTrackId.current = null;
      setTheme(themeFromGenres([]));
    }
  }, []);

  const initPlayer = useCallback(async () => {
    if (deviceId || playerLoading) return deviceId;

    setPlayerLoading(true);
    setStatus("Starting playback device...");

    try {
      const { deviceId: id, player } = await createPlayer();
      setDeviceId(id);
      setStatus("Ready to play");

      player.addListener("player_state_changed", (state) => {
        if (!state) return;

        setPaused(state.paused);
        setPosition(state.position);
        setDuration(state.duration);

        const playing = state.track_window.current_track;
        if (playing) {
          void applyThemeFromTrack(sdkTrackToSpotify(playing));
        }
      });

      return id;
    } catch (err) {
      console.error(err);
      setStatus(err instanceof Error ? err.message : "Player setup failed");
      return null;
    } finally {
      setPlayerLoading(false);
    }
  }, [deviceId, playerLoading, applyThemeFromTrack]);

  useEffect(() => {
    if (!token) return;
    initPlayer();
  }, [token, initPlayer]);

  useEffect(() => {
    if (!deviceId || paused) return;

    const timer = window.setInterval(async () => {
      const state = await getSpotifyPlayer()?.getCurrentState();
      if (state) {
        setPosition(state.position);
        setDuration(state.duration);
      }
    }, 500);

    return () => window.clearInterval(timer);
  }, [deviceId, paused]);

  useEffect(() => {
    if (!token) return;

    async function loadPlaylists() {
      setPlaylistsLoading(true);
      setPlaylistsError(null);

      try {
        setStatus("Loading playlists...");
        const [items, likedCount] = await Promise.all([
          getUserPlaylists(),
          getSavedTracksCount().catch(() => 0),
        ]);

        const library = [
          ...(likedCount > 0 ? [createLikedSongsPlaylist(likedCount)] : []),
          ...items,
        ];

        setPlaylists(library);
        setStatus("Ready to play");
      } catch (err) {
        console.error(err);
        const message =
          err instanceof Error ? err.message : "Failed to load playlists";
        setPlaylistsError(message);
        setStatus(message);
      } finally {
        setPlaylistsLoading(false);
      }
    }

    loadPlaylists();
  }, [token]);

  useEffect(() => {
    const playlist = selectedPlaylist;
    if (!playlist) {
      setTracks([]);
      setTracksError(null);
      return;
    }

    const playlistId = playlist.id;

    async function loadTracks() {
      setTracksLoading(true);
      setTracksError(null);

      try {
        const items = await getPlaylistTracks(playlistId);
        setTracks(items);
        if (items.length === 0) {
          setTracksError("No playable tracks in this playlist.");
        }
      } catch (err) {
        console.error(err);
        const message =
          err instanceof Error ? err.message : "Failed to load playlist tracks";
        setTracks([]);
        setTracksError(message);
        setStatus(message);
      } finally {
        setTracksLoading(false);
      }
    }

    loadTracks();
  }, [selectedPlaylist]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      setSearchLoading(true);

      try {
        const results = await searchTracks(query);
        setSearchResults(results);
      } catch (err) {
        console.error(err);
        setStatus(err instanceof Error ? err.message : "Search failed");
      } finally {
        setSearchLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  async function connectSpotify() {
    try {
      setStatus("Opening Spotify login...");
      await login();
      setStatus("Waiting for Spotify redirect… keep this window open.");
    } catch (err) {
      console.error(err);
      setStatus(err instanceof Error ? err.message : String(err));
    }
  }

  function disconnect() {
    clearAuth();
    setToken(null);
    setDeviceId(null);
    setPlaylists([]);
    setPlaylistsError(null);
    setSelectedPlaylist(null);
    setTracks([]);
    setSearchResults([]);
    setSearchQuery("");
    setCurrentTrack(null);
    themedTrackId.current = null;
    setTheme(themeFromGenres([]));
    setPaused(true);
    setPosition(0);
    setDuration(0);
    setStatus("Disconnected");
  }

  async function handlePlay(track: SpotifyTrack, fromSearch = false) {
    const id = deviceId ?? (await initPlayer());
    if (!id) return;

    const label = `${track.name} · ${formatArtists(track.artists)}`;

    try {
      setStatus(`Playing ${label}...`);
      await playUri(
        id,
        track.uri,
        !fromSearch && selectedPlaylist?.uri ? selectedPlaylist.uri : undefined
      );
      await applyThemeFromTrack(track);
      setPaused(false);
      setDuration(track.duration_ms);
      setStatus("Playing");

      if (fromSearch) {
        setSearchQuery("");
        setSearchResults([]);
      }
    } catch (err) {
      console.error(err);
      setStatus(err instanceof Error ? err.message : "Playback failed");
    }
  }

  async function handleVolume(value: number) {
    setVolume(value);
    await getSpotifyPlayer()?.setVolume(value);
  }

  function selectPlaylist(playlist: SpotifyPlaylist) {
    if (selectedPlaylist?.id === playlist.id) {
      setSelectedPlaylist(null);
      setTracks([]);
      return;
    }

    setSelectedPlaylist(playlist);
  }

  const showSearchDropdown = searchQuery.trim().length > 0;

  if (!token) {
    return (
      <div className="app login-screen theme-default">
        <div className="login-card winamp">
          <div className="winamp-title" data-tauri-drag-region>
            <span className="winamp-brand" data-tauri-drag-region>
              <img className="app-logo" src={appLogo} alt="" />
              RatAMP
            </span>
            <WindowButtons />
          </div>
          <img className="login-logo" src={appLogo} alt="RatAMP" />
          <h1>Spotify Player</h1>
          <p>Connect your account to browse playlists and search songs.</p>
          <button className="primary-button" onClick={connectSpotify}>
            Connect Spotify
          </button>
          <p className="status-text" style={{ marginTop: "1rem" }}>
            {status}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`app player-shell theme-${theme.id}`}>
      <img
        className="rat-mascot"
        src={theme.image}
        alt={`${theme.label} rat`}
      />
      <div className="winamp-frame">
        <div className="winamp-title" data-tauri-drag-region>
          <span className="winamp-brand" data-tauri-drag-region>
            <img className="app-logo" src={appLogo} alt="" />
            RatAMP
          </span>
          <span className="winamp-skin-label" data-tauri-drag-region>
            {theme.label}
          </span>
          <WindowButtons />
        </div>

        <div className="winamp-body">
          <WinampPlayer
            theme={theme}
            track={currentTrack}
            paused={paused}
            position={position}
            duration={duration}
            volume={volume}
            onVolume={handleVolume}
            onDisconnect={disconnect}
          />

          <div className="library-panel">
            <div className="search-wrap">
              <input
                className="search-input"
                type="search"
                placeholder="Search a song..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />

              {showSearchDropdown && (
                <div className="search-dropdown">
                  {searchLoading && (
                    <div className="empty-state">Searching...</div>
                  )}

                  {!searchLoading && searchResults.length === 0 && (
                    <div className="empty-state">No matches</div>
                  )}

                  {!searchLoading &&
                    searchResults.map((track) => (
                      <button
                        key={`${track.id}-${track.uri}`}
                        className="track-row"
                        type="button"
                        onClick={() => handlePlay(track, true)}
                      >
                        <Cover images={track.album?.images} label={track.name} />
                        <div className="track-meta">
                          <strong>{track.name}</strong>
                          <span>{formatArtists(track.artists)}</span>
                        </div>
                      </button>
                    ))}
                </div>
              )}
            </div>

            <div className="sidebar-header" data-tauri-drag-region>
              <h2 data-tauri-drag-region>Playlists</h2>
              <p data-tauri-drag-region>{playlists.length} in library</p>
            </div>

            <div className="playlist-list">
              {playlistsLoading && (
                <div className="empty-state">Loading playlists...</div>
              )}

              {!playlistsLoading &&
                playlists.map((playlist) => (
                  <div key={playlist.id} className="playlist-block">
                    <button
                      className={`playlist-item ${
                        selectedPlaylist?.id === playlist.id ? "active" : ""
                      }`}
                      onClick={() => selectPlaylist(playlist)}
                    >
                      <Cover
                        images={playlist.images}
                        label={playlist.name}
                        size="large"
                      />
                      <div className="playlist-meta">
                        <strong>{playlist.name}</strong>
                        <span>{playlistTrackCount(playlist)} tracks</span>
                      </div>
                    </button>

                    {selectedPlaylist?.id === playlist.id && (
                      <div className="playlist-tracks">
                        {tracksLoading && (
                          <div className="empty-state">Loading tracks...</div>
                        )}
                        {tracksError && (
                          <div className="empty-state">{tracksError}</div>
                        )}
                        {!tracksLoading &&
                          !tracksError &&
                          tracks.map((track) => (
                            <button
                              key={`${track.id}-${track.uri}`}
                              className="track-row"
                              type="button"
                              onClick={() => handlePlay(track)}
                            >
                              <Cover
                                images={track.album?.images}
                                label={track.name}
                              />
                              <div className="track-meta">
                                <strong>{track.name}</strong>
                                <span>{formatArtists(track.artists)}</span>
                              </div>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                ))}

              {!playlistsLoading && playlistsError && (
                <div className="empty-state">{playlistsError}</div>
              )}

              {!playlistsLoading && !playlistsError && playlists.length === 0 && (
                <div className="empty-state">No playlists found.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
