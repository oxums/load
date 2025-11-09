import { invoke } from "@tauri-apps/api/core";
import { log, logError } from "./logs";
import { deepMerge } from "./utils";

const defaultValues = {
  colors: {
    background: "#1e1e2e", // Catppuccin Mocha base
    "background-secondary": "#181825", // surface0
    "background-accent": "#313244", // surface2
    text: "white", // text
  },
  ui: {
    "font-family": '"IBM Plex Sans", sans-serif',
    "font-size": "14px",
    "line-height": "1.5",
  },
  editor: {
    "font-family": "JetBrains Mono, Menlo, monospace",
    "font-size": "15px",
    "line-height": "1.6",
  },
  token: {
    types: "#f5c2e7", // mauve
    numbers: "#fab387", // peach
    strings: "#a6e3a1", // green
    comments: "#6c7086", // overlay1
    keywords: "#cba6f7", // lavender
    functions: "#89b4fa", // blue
    variables: "#f38ba8", // red
    untokenized: "#cdd6f4", // text
  },

  autosave: {
    enabled: true,
    debounceMs: 800,
    intervalMs: 0,
    onBlur: true,
  },
  wrap: {
    enabled: true,
    mode: "char",
  },
};

let cache = {
  ...defaultValues,
  __needs_refresh: true,
};

export async function getSettings() {
  if (!cache["__needs_refresh"]) {
    return cache;
  }

  try {
    const raw_settings = (await invoke("get_settings")) as string;
    const parsed = JSON.parse(raw_settings);

    if (parsed.__error) {
      logError(
        "Error in settings retrieved from backend, using defaults. Error: " +
          parsed.__error,
      );
      return cache;
    }

    const settings = deepMerge({ ...defaultValues }, parsed);
    cache = settings;

    log("Settings loaded successfully.");
  } catch (e) {
    console.error("Failed to load settings, using defaults.", e);
    logError(
      "Failed to load settings, using defaults. Error: " + (e as Error).message,
    );
  }

  return cache;
}
