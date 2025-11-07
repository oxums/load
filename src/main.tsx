import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./global.css";
import Loading from "./Loading";
import { setCSSvar } from "./utils";
import { getSettings } from "./settings";

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

  const tasks = [
    getSettings,
    applyTheme,
  ];

  useEffect(() => {
    Promise.all(tasks.map((task) => task())).then(() => {
      setIsLoaded(true);
    });
  });

  return <>{isLoaded ? <App /> : <Loading />}</>;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppLoader />
  </React.StrictMode>,
);
