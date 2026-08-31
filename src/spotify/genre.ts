import { invoke } from "@tauri-apps/api/core";

import metalRat from "../assets/metal.png";
import punkRat from "../assets/punk.png";
import rockRat from "../assets/rock.png";
import electronicRat from "../assets/electronic.png";
import glamPopRat from "../assets/glampop.png";
import defaultRat from "../assets/rats_love1.png";
import type { SpotifyTrack } from "./types";

export type GenreSkin =
  | "metal"
  | "punk"
  | "rock"
  | "electronic"
  | "glampop"
  | "default";

export type GenreTheme = {
  id: GenreSkin;
  label: string;
  image: string;
  genres: string[];
};

const trackGenreCache = new Map<string, string[]>();

const SKINS: Array<{
  id: Exclude<GenreSkin, "default">;
  label: string;
  image: string;
  test: RegExp;
}> = [
  {
    id: "metal",
    label: "Metal",
    image: metalRat,
    test: /\b(metal|thrash|deathcore|grindcore|doom|sludge|blackened|nwobhm|metalcore|djent)\b/i,
  },
  {
    id: "punk",
    label: "Punk",
    image: punkRat,
    test: /\b(punk|post-punk|post punk|pop[- ]punk|ska punk|hardcore punk|riot grrrl|emocore|emo)\b/i,
  },
  {
    id: "electronic",
    label: "Electronic",
    image: electronicRat,
    test: /\b(electronic(?:a)?|edm|techno|trance|dubstep|synthwave|idm|dnb|drum(?:\s*and\s*|&)\s*bass|breakbeat|big beat|future bass|deep house|house|electro)\b/i,
  },
  {
    id: "rock",
    label: "Rock",
    image: rockRat,
    test: /\b((hard|classic|album|indie|alternative|alt|arena|soft|blues|garage|psych(?:edelic)?|prog(?:ressive)?|folk|southern|heartland|art|noise|math|post)\s+)?rock\b/i,
  },
  {
    id: "glampop",
    label: "Glam Pop",
    image: glamPopRat,
    test: /\b(glam(?:\s*(?:pop|rock|metal))?|glampop|glitter(?:\s*pop)?|bubblegum|hyperpop|k-?pop|j-?pop|dance[\s-]?pop|synth[\s-]?pop|electro[\s-]?pop|indie pop|art pop|dream pop|pop)\b/i,
  },
];

type ArtistRef = { id?: string; uri?: string; name?: string };

export function artistIdFromRef(artist: ArtistRef) {
  for (const value of [artist.id, artist.uri]) {
    if (!value) continue;
    if (/^[A-Za-z0-9]{22}$/.test(value)) return value;
    const match = value.match(/artist[:/]([A-Za-z0-9]{22})/i);
    if (match) return match[1];
  }

  return "";
}

export async function resolveTrackGenres(track: SpotifyTrack) {
  const cacheKey = track.id || track.uri;
  const cached = trackGenreCache.get(cacheKey);
  if (cached?.length) return cached;

  const title = track.name?.trim() ?? "";
  const artists = (track.artists ?? [])
    .map((artist) => artist.name?.trim())
    .filter((name): name is string => Boolean(name));

  for (const artist of artists) {
    try {
      const genres = await invoke<string[]>("lookup_track_genres", {
        artist,
        title,
      });

      if (genres?.length) {
        trackGenreCache.set(cacheKey, genres);
        return genres;
      }
    } catch (err) {
      console.error("Genre lookup failed", artist, err);
    }
  }

  return [];
}

export function themeFromGenres(genres: string[]): GenreTheme {
  for (const skin of SKINS) {
    if (genres.some((genre) => skin.test.test(genre))) {
      return {
        id: skin.id,
        label: skin.label,
        image: skin.image,
        genres,
      };
    }
  }

  return {
    id: "default",
    label: genres[0] ? capitalize(genres[0]) : "Unknown",
    image: defaultRat,
    genres,
  };
}

function capitalize(value: string) {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}
