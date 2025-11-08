import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

export type KeyCommand = () => void;
export type KeyMap = Record<string, KeyCommand>;

export const normalizeKey = (e: KeyboardEvent) =>
  `${e.ctrlKey || e.metaKey ? "CTRL+" : ""}${e.shiftKey ? "SHIFT+" : ""}${e.altKey ? "ALT+" : ""}${e.key.toUpperCase()}`;

export function dispatchKey(e: KeyboardEvent, map: KeyMap) {
  const key = normalizeKey(e);
  const fn = map[key];
  if (fn) {
    e.preventDefault();
    fn();
    return true;
  }
  return false;
}

export let globalKeybinds: KeyMap = {
  "CTRL+Q": () => {
    appWindow.close();
  },
  "CTRL+O": () => {
    window.dispatchEvent(new CustomEvent("load:open-file"));
  },
  "CTRL+N": () => {
    window.dispatchEvent(new CustomEvent("load:new-file"));
  },
};

export function setGlobalKeybind(key: string, handler: KeyCommand) {
  globalKeybinds[key.toUpperCase()] = handler;
}

export function removeGlobalKeybind(key: string) {
  delete globalKeybinds[key.toUpperCase()];
}

export function ensureGlobalKeybindListener() {
  const w = window as any;
  if (w.__loadGlobalKeybindsAttached) return;
  const handler = (e: KeyboardEvent) => {
    dispatchKey(e, globalKeybinds);
  };
  window.addEventListener("keydown", handler);
  w.__loadGlobalKeybindsAttached = true;
}

ensureGlobalKeybindListener();
