import React, {
  createContext,
  KeyboardEvent,
  useContext,
  useEffect,
} from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./global.css";
import Loading from "./Loading";
import { setCSSvar } from "./utils";
import { getSettings } from "./settings";
import { globalKeybinds } from "./keybinds";
import { invoke } from "@tauri-apps/api/core";
import { AIStatus } from "./aistatus";

async function applyTheme() {
  const settings = await getSettings();

  // Colors
  setCSSvar("--background-color", settings.colors.background);
  setCSSvar(
    "--background-secondary-color",
    settings.colors["background-secondary"],
  );
  setCSSvar("--background-accent-color", settings.colors["background-accent"]);
  setCSSvar("--text-color", settings.colors.text);

  // UI
  setCSSvar("--ui-font-family", settings.ui["font-family"]);
  setCSSvar("--ui-font-size", settings.ui["font-size"]);
  setCSSvar("--ui-line-height", settings.ui["line-height"]);

  // Editor
  setCSSvar("--editor-font-family", settings.editor["font-family"]);
  setCSSvar("--editor-font-size", settings.editor["font-size"]);
  setCSSvar("--editor-line-height", settings.editor["line-height"]);

  // Token colors
  const tokenVars = [
    ["--token-types", settings.token.types],
    ["--token-numbers", settings.token.numbers],
    ["--token-strings", settings.token.strings],
    ["--token-comments", settings.token.comments],
    ["--token-keywords", settings.token.keywords],
    ["--token-functions", settings.token.functions],
    ["--token-variables", settings.token.variables],
    ["--token-untokenized", settings.token.untokenized],
  ];
  tokenVars.forEach(([key, value]) => setCSSvar(key, value));
}

function AppLoader() {
  const [isLoaded, setIsLoaded] = React.useState(false);

  useEffect(() => {
    setCSSvar("--background-color", "oklch(14.1% 0.005 285.823)");
    setCSSvar("--text-color", "white");
  });

  const tasks = [getSettings, applyTheme, () => invoke("ready")];

  useEffect(() => {
    Promise.all(tasks.map((task) => task())).then(() => {
      setIsLoaded(true);
    });
  });

  useEffect(() => {
    function handleGlobalKeybinds(e: any) {
      const key = `${e.ctrlKey ? "CTRL+" : ""}${e.shiftKey ? "SHIFT+" : ""}${e.altKey ? "ALT+" : ""}${e.key.toUpperCase()}`;
      // @ts-ignore
      if (globalKeybinds[key]) {
        e.preventDefault();
        // @ts-ignore
        globalKeybinds[key]();
      }
    }

    window.addEventListener("keydown", handleGlobalKeybinds);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeybinds);
    };
  });
  
  const [aiModalOpen, setAIModalOpen] = React.useState(false);

  return (
    <>
      {isLoaded ? <App setAIModal={setAIModalOpen} /> : <Loading />}
      {aiModalOpen && <AIStatus setAIModal={setAIModalOpen} />}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppLoader />
  </React.StrictMode>,
);
