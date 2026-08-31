import { open } from "@tauri-apps/plugin-shell";
import { createSpotifyAuthUrl } from "./auth";

export async function login() {
  const url = await createSpotifyAuthUrl();

  await open(url);
}