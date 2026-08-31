import { getCurrentWindow } from "@tauri-apps/api/window";

let closing = false;

export async function closeApp() {
  if (closing) return;
  closing = true;

  const win = getCurrentWindow();

  try {
    // Hide first so Windows DWM can drop the transparent surface
    // without resetting other monitors.
    await win.hide();
    await new Promise((resolve) => window.setTimeout(resolve, 80));
  } catch (err) {
    console.error(err);
  }

  await win.destroy();
}

export function minimizeApp() {
  return getCurrentWindow().minimize();
}

export async function setupSafeClose() {
  const win = getCurrentWindow();

  await win.onCloseRequested(async (event) => {
    event.preventDefault();
    await closeApp();
  });
}
