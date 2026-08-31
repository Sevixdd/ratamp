const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined;
const REDIRECT_URI = "spotify-tauri-test://callback";

function requireClientId() {
  if (!CLIENT_ID) {
    throw new Error(
      "This build is missing the Spotify client ID. Rebuild with VITE_SPOTIFY_CLIENT_ID set."
    );
  }

  return CLIENT_ID;
}

const SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read",
].join(" ");

function randomString(length: number) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

  const random = new Uint8Array(length);
  crypto.getRandomValues(random);

  return Array.from(random)
    .map((x) => chars[x % chars.length])
    .join("");
}

async function sha256(plain: string) {
  const encoder = new TextEncoder();
  return crypto.subtle.digest("SHA-256", encoder.encode(plain));
}

function base64url(buffer: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function saveTokens(data: {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}) {
  localStorage.setItem("spotify_access_token", data.access_token);

  if (data.refresh_token) {
    localStorage.setItem("spotify_refresh_token", data.refresh_token);
  }

  if (data.expires_in) {
    localStorage.setItem(
      "spotify_token_expires_at",
      String(Date.now() + data.expires_in * 1000)
    );
  }
}

export async function createSpotifyAuthUrl() {
  const verifier = randomString(64);

  const challenge = base64url(await sha256(verifier));

  localStorage.setItem("spotify_code_verifier", verifier);

  const params = new URLSearchParams({
    client_id: requireClientId(),
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SCOPES,
    show_dialog: "true",
  });

  return `https://accounts.spotify.com/authorize?${params}`;
}

const USED_CODES_KEY = "spotify_used_auth_codes";

function getUsedCodes(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(USED_CODES_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function hasUsedAuthCode(code: string) {
  return getUsedCodes().includes(code);
}

function markAuthCodeUsed(code: string) {
  const used = [...getUsedCodes().filter((item) => item !== code), code].slice(-10);
  sessionStorage.setItem(USED_CODES_KEY, JSON.stringify(used));
}

function parseTokenError(text: string) {
  try {
    const json = JSON.parse(text) as {
      error?: string;
      error_description?: string;
    };

    if (json.error_description) {
      return json.error_description;
    }

    if (json.error) {
      return json.error;
    }
  } catch {
    // Keep the raw response.
  }

  return text;
}

const exchangingCodes = new Set<string>();

export async function exchangeCode(code: string) {
  if (exchangingCodes.has(code) || hasUsedAuthCode(code)) {
    const token = getAccessToken();
    if (token) {
      return { access_token: token };
    }

    throw new Error("This login link was already used. Connect Spotify again.");
  }

  exchangingCodes.add(code);
  markAuthCodeUsed(code);

  try {
    const verifier = localStorage.getItem("spotify_code_verifier");

    if (!verifier) {
      throw new Error("Missing PKCE verifier");
    }

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: requireClientId(),
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      }),
    });

    if (!response.ok) {
      throw new Error(parseTokenError(await response.text()));
    }

    const data = await response.json();
    saveTokens(data);
    localStorage.removeItem("spotify_code_verifier");
    return data;
  } finally {
    exchangingCodes.delete(code);
  }
}

export async function refreshAccessToken() {
  const refreshToken = localStorage.getItem("spotify_refresh_token");

  if (!refreshToken) {
    throw new Error("Missing refresh token. Connect Spotify again.");
  }

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: requireClientId(),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(parseTokenError(await response.text()));
  }

  const data = await response.json();
  saveTokens(data);
  return data.access_token as string;
}

export async function getValidAccessToken() {
  const token = localStorage.getItem("spotify_access_token");

  if (!token) {
    return null;
  }

  const expiresAt = Number(localStorage.getItem("spotify_token_expires_at") ?? 0);
  const stillFresh = expiresAt > 0 && Date.now() < expiresAt - 60_000;

  if (stillFresh) {
    return token;
  }

  try {
    return await refreshAccessToken();
  } catch (error) {
    if (expiresAt > Date.now()) {
      return token;
    }

    throw error;
  }
}

export function getAccessToken() {
  return localStorage.getItem("spotify_access_token");
}

export function clearAuth() {
  localStorage.removeItem("spotify_access_token");
  localStorage.removeItem("spotify_refresh_token");
  localStorage.removeItem("spotify_token_expires_at");
  localStorage.removeItem("spotify_code_verifier");
}
