export type SpotifyImage = {
  url: string;
  height: number | null;
  width: number | null;
};

export type SpotifyArtist = {
  id: string;
  name: string;
  uri?: string;
  genres?: string[];
};

export type SpotifyTrack = {
  id: string;
  name: string;
  uri: string;
  duration_ms: number;
  artists: SpotifyArtist[] | null;
  album: {
    name: string;
    images: SpotifyImage[] | null;
  } | null;
};

export type SpotifyPlaylist = {
  id: string;
  name: string;
  description: string | null;
  uri: string;
  tracks: { total: number } | null;
  items: { total: number } | null;
  images: SpotifyImage[] | null;
};

export type SpotifyPlaylistTrackItem = {
  track?: SpotifyTrack | null;
  item?: SpotifyTrack | null;
};
