/// <reference types="spotify-web-playback-sdk" />

import { getValidAccessToken } from "./auth";

let cached:
  | {
      player: Spotify.Player;
      deviceId: string;
    }
  | null = null;

export function loadSpotifySDK(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Spotify) {
      resolve();
      return;
    }

    window.onSpotifyWebPlaybackSDKReady = () => {
      resolve();
    };

    const script = document.createElement("script");

    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;

    script.onerror = () => {
      reject(new Error("Failed to load Spotify Web Playback SDK"));
    };

    document.body.appendChild(script);
  });
}

export function getSpotifyPlayer() {
  return cached?.player ?? null;
}

export async function createPlayer(): Promise<{
  player: Spotify.Player;
  deviceId: string;
}> {
  if (cached) {
    return cached;
  }

  await loadSpotifySDK();

  const token = await getValidAccessToken();

  if (!token) {
    throw new Error("Not authenticated");
  }

  const player = new window.Spotify.Player({
    name: "Tauri Spotify Player",
    volume: 0.5,

    getOAuthToken: async (callback) => {
      const fresh = (await getValidAccessToken()) ?? token;
      callback(fresh);
    },
  });

  return new Promise((resolve, reject) => {
    player.addListener("initialization_error", ({ message }) => {
      reject(new Error(`Initialization error: ${message}`));
    });

    player.addListener("authentication_error", ({ message }) => {
      reject(new Error(`Authentication error: ${message}`));
    });

    player.addListener("account_error", ({ message }) => {
      reject(new Error(`Account error: ${message}`));
    });

    player.addListener("playback_error", ({ message }) => {
      console.error("PLAYBACK ERROR:", message);
    });

    player.addListener("ready", ({ device_id }) => {
      cached = { player, deviceId: device_id };
      resolve(cached);
    });

    player.addListener("not_ready", ({ device_id }) => {
      console.log("Spotify device went offline:", device_id);
    });

    player.connect().then((connected) => {
      if (!connected) {
        reject(new Error("player.connect() returned false"));
      }
    });
  });
}
