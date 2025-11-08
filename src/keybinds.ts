import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

export const globalKeybinds = {
  "CTRL+Q": () => {
    appWindow.close();
  },
};
