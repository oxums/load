import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState, useEffect, useRef, createContext, useContext } from "react";
import Editor from "./editor";
import {
  open as openDialog,
  save as saveDialog,
} from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { createTauriFileHandle } from "./editor";

const MenuContext = createContext<{
  openTab: string | null;
  setOpenTab: (tab: string | null) => void;
}>({
  openTab: null,
  setOpenTab: () => {},
});

const MIN_INTERVAL_MS = 150;
let lastOpenFileTime = 0;
let lastNewFileTime = 0;

function throttleAsync(
  fn: (...args: any[]) => Promise<any>,
  lastTimeRef: { current: number },
) {
  return async (...args: any[]) => {
    const now = Date.now();
    if (now - lastTimeRef.current < MIN_INTERVAL_MS) {
      return;
    }
    lastTimeRef.current = now;
    return await fn(...args);
  };
}

function WindowUpperMenuTab({
  name,
  options,
}: {
  name: string;
  options: {
    text: string;
    onClick: () => void;
    keybindSuggestion?: string;
  }[];
}) {
  const { openTab, setOpenTab } = useContext(MenuContext);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const isOpen = openTab === name;

  const handleMouseEnter = () => {
    if (openTab !== name) {
      setOpenTab(name);
    }
  };

  const handleMouseLeave = () => {};

  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setOpenTab(null);
      }
    };
    window.addEventListener("mousedown", handleOutside);
    return () => window.removeEventListener("mousedown", handleOutside);
  }, [isOpen, setOpenTab]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenTab(null);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, setOpenTab]);

  return (
    <div
      ref={rootRef}
      className="relative"
      tabIndex={0}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onBlur={() => {
        setOpenTab(null);
      }}
    >
      <button
        className="flex items-center gap-2 px-1.5 py-0.1 m-1 rounded hover:bg-(--background-color) select-none text-sm"
        onClick={() => setOpenTab(isOpen ? null : name)}
        onMouseDown={(e) => e.stopPropagation()}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <span className="select-none pointer-events-none text-[13px]">
          {name}
        </span>
      </button>

      {isOpen && (
        <div
          className="absolute left-0 mt-0.5 ml-1 w-56 bg-(--background-secondary-color) border border-(--token-keywords) rounded-md p-1 shadow-lg z-50"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className="flex flex-col">
            {options.map((opt, i) => (
              <button
                key={i}
                onMouseDown={() => {
                  try {
                    opt.onClick();
                  } finally {
                    setOpenTab(null);
                  }
                }}
                className="w-full flex items-center justify-between gap-2 px-2 py-0.5 rounded-sm hover:bg-(--background-color) text-[13px]"
              >
                <span className="truncate">{opt.text}</span>
                {opt.keybindSuggestion ? (
                  <span className="text-xs c text-(--token-comments) ml-2 select-none">
                    {opt.keybindSuggestion}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  const appWindow = getCurrentWindow();

  const [windowTitle, setWindowTitle] = useState("");
  const [fileHandle, setFileHandle] = useState<any>(null);
  const [openTab, setOpenTab] = useState<string | null>(null);

  const lastOpenFileRef = useRef(0);

  const lastNewFileRef = useRef(0);

  const menuCloseTimerRef = useRef<NodeJS.Timeout | null>(null);
  const handleMenuMouseEnter = () => {
    if (menuCloseTimerRef.current) {
      clearTimeout(menuCloseTimerRef.current);
      menuCloseTimerRef.current = null;
    }
  };
  const handleMenuMouseLeave = () => {
    if (menuCloseTimerRef.current) clearTimeout(menuCloseTimerRef.current);
    menuCloseTimerRef.current = setTimeout(() => {
      setOpenTab(null);
    }, 250);
  };

  useEffect(() => {
    const onOpen = (_e?: Event) => {
      (async () => {
        const now = Date.now();
        if (now - lastOpenFileRef.current < MIN_INTERVAL_MS) return;
        lastOpenFileRef.current = now;
        const path = await openDialog({ multiple: false, directory: false });
        if (typeof path === "string") {
          const fh = await createTauriFileHandle(path);
          setFileHandle(fh);
          setWindowTitle(fh.metadata.name);
          (window as any).__loadTotalLines = (fh.metadata as any)?.lineCount;
        }
      })();
    };
    const onNew = (_e?: Event) => {
      (async () => {
        const now = Date.now();
        if (now - lastNewFileRef.current < MIN_INTERVAL_MS) return;
        lastNewFileRef.current = now;
        const path = await saveDialog({ title: "Create New File" });
        if (path) {
          await invoke("create_empty_file", { path });
          const fh = await createTauriFileHandle(path as string);
          setFileHandle(fh);
          setWindowTitle(fh.metadata.name);
          (window as any).__loadTotalLines = (fh.metadata as any)?.lineCount;
        }
      })();
    };

    window.addEventListener("load:open-file", onOpen as EventListener);
    window.addEventListener("load:new-file", onNew as EventListener);
    return () => {
      window.removeEventListener("load:open-file", onOpen as EventListener);
      window.removeEventListener("load:new-file", onNew as EventListener);
    };
  }, []);

  return (
    <MenuContext.Provider value={{ openTab, setOpenTab }}>
      <div className="h-screen flex flex-col">
        <div
          className="shrink-0 bg-(--background-secondary-color) flex justify-between items-center min-h-6 max-h-8"
          onMouseDown={(e) => {
            if (e.buttons === 1) {
              e.detail === 2
                ? appWindow.toggleMaximize()
                : appWindow.startDragging();
            }
          }}
        >
          <div className="flex items-center gap-0">
            <WindowUpperMenuTab
              name="Load"
              options={[
                {
                  text: "About",

                  onClick: () => {
                    openUrl("https://github.com/oxums/load#load-editor");
                  },
                },

                {
                  text: "Quit",

                  onClick: () => {
                    appWindow.close();
                  },

                  keybindSuggestion: "Ctrl+Q",
                },
              ]}
            />

            <WindowUpperMenuTab
              name="File"
              options={[
                {
                  text: "Open File...",

                  onClick: async () => {
                    const now = Date.now();
                    if (now - lastOpenFileRef.current < MIN_INTERVAL_MS) return;
                    lastOpenFileRef.current = now;
                    const path = await openDialog({
                      multiple: false,
                      directory: false,
                    });

                    if (typeof path === "string") {
                      const fh = await createTauriFileHandle(path);

                      setFileHandle(fh);

                      setWindowTitle(fh.metadata.name);
                    }
                  },
                  keybindSuggestion: "Ctrl+O",
                },

                {
                  text: "New File...",

                  onClick: async () => {
                    const now = Date.now();
                    if (now - lastNewFileRef.current < MIN_INTERVAL_MS) return;
                    lastNewFileRef.current = now;
                    const path = await saveDialog({ title: "Create New File" });

                    if (path) {
                      await invoke("create_empty_file", { path });

                      const fh = await createTauriFileHandle(path as string);

                      setFileHandle(fh);

                      setWindowTitle(fh.metadata.name);
                    }
                  },
                  keybindSuggestion: "Ctrl+N",
                },
              ]}
            />
          </div>

          <div>
            <span className="select-none text-xs c text-(--token-comments)">
              {windowTitle}
            </span>
          </div>
          <div className="flex items-center flex-row-reverse gap-2 px-2 select-none">
            <button
              className="w-[11.5px] h-[11.5px] rounded-full bg-red-500 border border-black/10 hover:bg-red-400 transition-colors"
              aria-label="Close"
              onMouseDown={() => {
                appWindow.close();
              }}
              tabIndex={-1}
            />
            <button
              className="w-[11.5px] h-[11.5px] rounded-full bg-yellow-400 border border-black/10 hover:bg-yellow-300 transition-colors"
              aria-label="Minimize"
              onMouseDown={() => {
                appWindow.minimize();
              }}
              tabIndex={-1}
            />
            <button
              className="w-[11.5px] h-[11.5px] rounded-full bg-green-500 border border-black/10 hover:bg-green-400 transition-colors"
              aria-label="Maximize"
              onMouseDown={() => {
                appWindow.toggleMaximize();
              }}
              tabIndex={-1}
            />
          </div>
        </div>
        <div className="flex-1 flex w-full border-t border-(--token-functions)">
          <div className="w-xs max-w-[18rem] shrink-0 bg-(--background-secondary-color) flex flex-col justify-between border-r border-(--token-functions)">
            <div></div>
            <div className="p-1 border-t border-(--token-functions) flex items-center justify-between">
              <div className="flex items-center gap-0.5">
                <div className="nice">
                  <span className="text-xs select-none">Typescript</span>
                </div>
                <div className="nice">
                  <span className="text-xs c text-(--token-functions) select-none">
                    {(() => {
                      const [cursor, setCursor] = useState((window as any).__loadCursor || { row: 1, col: 1 });

                      useEffect(() => {
                        const interval = setInterval(() => {
                          setCursor((window as any).__loadCursor || { row: 1, col: 1 });
                        }, 100);

                        return () => clearInterval(interval);
                      }, []);

                      return `${cursor.row}:${cursor.col}`;
                    })()}
                  </span>
                </div>
              </div>

              <div
                className="flex items-center gap-0"
                onMouseEnter={handleMenuMouseEnter}
                onMouseLeave={handleMenuMouseLeave}
              >
                <div className="nice">
                  <div className="c text-red-400">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="1em"
                      height="1em"
                      viewBox="0 0 24 24"
                      className="c"
                    >
                      <path
                        fill="currentColor"
                        d="M12 17q.425 0 .713-.288Q13 16.425 13 16t-.287-.713Q12.425 15 12 15t-.712.287Q11 15.575 11 16t.288.712Q11.575 17 12 17Zm0-4q.425 0 .713-.288Q13 12.425 13 12V8q0-.425-.287-.713Q12.425 7 12 7t-.712.287Q11 7.575 11 8v4q0 .425.288.712q.287.288.712.288Zm0 9q-2.075 0-3.9-.788q-1.825-.787-3.175-2.137q-1.35-1.35-2.137-3.175Q2 14.075 2 12t.788-3.9q.787-1.825 2.137-3.175q1.35-1.35 3.175-2.138Q9.925 2 12 2t3.9.787q1.825.788 3.175 2.138q1.35 1.35 2.137 3.175Q22 9.925 22 12t-.788 3.9q-.787 1.825-2.137 3.175q-1.35 1.35-3.175 2.137Q14.075 22 12 22Zm0-2q3.35 0 5.675-2.325Q20 15.35 20 12q0-3.35-2.325-5.675Q15.35 4 12 4Q8.65 4 6.325 6.325Q4 8.65 4 12q0 3.35 2.325 5.675Q8.65 20 12 20Zm0-8Z"
                      />
                    </svg>
                  </div>
                  <span className="text-xs select-none">0 Errors</span>
                </div>
                <div className="nice">
                  <div className="c text-yellow-400">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="1em"
                      height="1em"
                      viewBox="0 0 24 24"
                    >
                      <path
                        fill="currentColor"
                        d="M12 5.99L19.53 19H4.47zM2.74 18c-.77 1.33.19 3 1.73 3h15.06c1.54 0 2.5-1.67 1.73-3L13.73 4.99c-.77-1.33-2.69-1.33-3.46 0zM11 11v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1m0 5h2v2h-2z"
                      />
                    </svg>
                  </div>
                  <span className="text-xs select-none">1 Warning</span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex-1">
            {fileHandle ? <Editor fileHandle={fileHandle} /> : null}
          </div>
        </div>
      </div>
    </MenuContext.Provider>
  );
}

export default App;
