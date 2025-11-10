import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl, openPath } from "@tauri-apps/plugin-opener";

import {
  useState,
  useEffect,
  useRef,
  createContext,
  useContext
} from "react";
import type { DragEvent } from "react";

import Editor from "./editor";
import {
  open as openDialog,
  save as saveDialog,
} from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createTauriFileHandle } from "./editor";
import { getIconSvg } from "./icon";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";

const MenuContext = createContext<{
  openTab: string | null;
  setOpenTab: (tab: string | null) => void;
}>({
  openTab: null,
  setOpenTab: () => {},
});

const MIN_INTERVAL_MS = 150;

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

function App({ setAIModal }: { setAIModal: (open: boolean) => void }) {
  const appWindow = getCurrentWindow();

  const [windowTitle, setWindowTitle] = useState("");

  const [fileHandle, setFileHandle] = useState<any>(null);
  const [openTab, setOpenTab] = useState<string | null>(null);

  const [folderRoot, setFolderRoot] = useState<string | null>(null);
  const [dirTree, setDirTree] = useState<any | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [openFiles, setOpenFiles] = useState<{ path: string; name: string }[]>(
    [],
  );

  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    path: string;
    isDir: boolean;
    name: string;
  } | null>(null);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>("");
  const dragSourcePathRef = useRef<string | null>(null);
  const dragOverPathRef = useRef<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const lastOpenFileRef = useRef(0);

  const lastNewFileRef = useRef(0);
  const openingRef = useRef(false);
  useEffect(() => {
    if (!fileHandle) return;
    try {
      setOpenFiles((prev) => {
        const p = (fileHandle as any)?.metadata?.path;
        const n = (fileHandle as any)?.metadata?.name;
        if (!p || !n) return prev;
        if (prev.some((f) => f.path === p)) return prev;
        return [{ path: p, name: n }, ...prev].slice(0, 50);
      });
    } catch {}
  }, [fileHandle]);

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

  const addOpenFile = (path: string, name: string) => {
    setOpenFiles((prev) => {
      if (prev.some((f) => f.path === path)) return prev;
      return [{ path, name }, ...prev].slice(0, 50);
    });
  };

  const openFilePath = async (path: string) => {
    if (openingRef.current) return;
    openingRef.current = true;
    try {
      const fh = await createTauriFileHandle(path);
      setFileHandle(fh);
      setWindowTitle(fh.metadata.name);
      (window as any).__loadTotalLines = (fh.metadata as any)?.lineCount;
      addOpenFile(path, fh.metadata.name);
    } finally {
      openingRef.current = false;
    }
  };

  useEffect(() => {
    const checkInitialPath = async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, 100));

        const initialPathInfo = await invoke<{
          path: string;
          isDirectory: boolean;
        } | null>("get_initial_path");
        console.log("Initial path from CLI:", initialPathInfo);

        if (initialPathInfo) {
          if (initialPathInfo.isDirectory) {
            // Open as folder
            console.log("Opening directory:", initialPathInfo.path);
            const tree = await invoke("read_directory_root", {
              path: initialPathInfo.path,
            });
            setDirTree(tree as any);
            setFolderRoot(initialPathInfo.path);
            setExpanded((e) => ({ ...e, [initialPathInfo.path]: true }));
          } else if (!fileHandle) {
            // Open as file
            console.log("Opening file:", initialPathInfo.path);
            await openFilePath(initialPathInfo.path);
          }
        }
      } catch (error) {
        console.error("Failed to open initial path:", error);
        if (error && typeof error === "object" && "message" in error) {
          console.error("Error details:", error);
        }
      }
    };

    const timer = setTimeout(checkInitialPath, 200);
    return () => clearTimeout(timer);
  }, []);

  const renderNode = (node: any) => {
    const isDir = !!node.isDir;
    const isExpanded = expanded[node.path] ?? node.path === folderRoot;
    const gray = node.ignored ? "opacity-60" : "";
    const row = (
      <div
        className={`flex items-center gap-1 px-1 py-0.5 rounded ${gray} hover:bg-(--background-color)`}
      >
        <span
          className="inline-block c icon-size pr-1"
          dangerouslySetInnerHTML={{ __html: getIconSvg(node.name, isDir) }}
        />
        <span className="truncate">{node.name}</span>
      </div>
    );
    if (isDir) {
      return (
        <div key={node.path}>
          <div
            className="w-full text-left cursor-pointer"
            onClick={() =>
              setExpanded((e) => ({ ...e, [node.path]: !isExpanded }))
            }
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setExpanded((e) => ({ ...e, [node.path]: !isExpanded }));
              }
            }}
          >
            {row}
          </div>
          {isExpanded &&
          Array.isArray(node.children) &&
          node.children.length > 0 ? (
            <div className="pl-3">
              {node.children.map((c: any) => renderNode(c))}
            </div>
          ) : null}
        </div>
      );
    }
    return (
      <button
        key={node.path}
        className="w-full text-left"
        onClick={() => openFilePath(node.path)}
      >
        {row}
      </button>
    );
  };

  function injectChildren(
    tree: any,
    targetPath: string,
    newChildren: any[],
  ): any {
    if (!tree) return tree;
    if (tree.path === targetPath) {
      return { ...tree, children: newChildren };
    }
    if (Array.isArray(tree.children)) {
      return {
        ...tree,
        children: tree.children.map((c: any) =>
          injectChildren(c, targetPath, newChildren),
        ),
      };
    }
    return tree;
  }

  const dirname = (p: string) => {
    const n = p.replace(/\\/g, "/");
    const i = n.lastIndexOf("/");
    return i >= 0 ? p.slice(0, i) : "";
  };

  const refreshDir = async (dirPath: string) => {
    if (!folderRoot) return;
    try {
      const children = await invoke("read_directory_children", {
        path: dirPath,
        root: folderRoot as string,
      });
      setDirTree((prev: any) => injectChildren(prev, dirPath, children as any));
    } catch {}
  };

  const refreshParent = async (p: string) => {
    const dir = dirname(p);
    if (dir) await refreshDir(dir);
  };

  const commitRename = async (originalPath: string, newBase: string) => {
    const dir = dirname(originalPath);
    if (!dir || !newBase) return;
    const sep = originalPath.includes("\\") ? "\\" : "/";
    const newPath = dir.replace(/[\\/]+$/, "") + sep + newBase;
    if (newPath === originalPath) return;
    await invoke("move_path", { src: originalPath, dest: newPath });
    await refreshParent(originalPath);
    setOpenFiles((prev) =>
      prev.map((f) =>
        f.path === originalPath ? { path: newPath, name: newBase } : f,
      ),
    );
    if ((fileHandle as any)?.metadata?.path === originalPath) {
      const fh = await createTauriFileHandle(newPath);
      setFileHandle(fh);
      setWindowTitle(fh.metadata.name);
      (window as any).__loadTotalLines = (fh.metadata as any)?.lineCount;
    }
  };

  useEffect(() => {
    const onOpen = (_e?: Event) => {
      (async () => {
        const now = Date.now();

        if (now - lastOpenFileRef.current < MIN_INTERVAL_MS) return;

        lastOpenFileRef.current = now;

        const path = await openDialog({ multiple: false, directory: false });
        if (typeof path === "string") {
          await openFilePath(path);
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

          await openFilePath(path as string);
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

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      unlisten = await listen<string>("queue-file-open", async (event) => {
        const filePath = event.payload;
        if (typeof filePath === "string") {
          await openFilePath(filePath);
        }
      });
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    if (ctxMenu) window.addEventListener("keydown", onKey);

    let unlisten: (() => void) | null = null;
    (async () => {
      unlisten = await listen<string[]>("tauri://file-drop", async (event) => {
        const payload = event.payload;
        if (!Array.isArray(payload)) return;
        if (!folderRoot) return;
        for (const droppedPath of payload) {
          try {
            const base = droppedPath.replace(/\\/g, "/").split("/").pop() || "";
            const sep = folderRoot.includes("\\") ? "\\" : "/";
            const dest = folderRoot.replace(/[\\/]+$/, "") + sep + base;
            if (droppedPath !== dest) {
              await invoke("copy_path", { src: droppedPath, dest });
            }
          } catch {}
        }
        await refreshDir(folderRoot);
      });
    })();

    return () => {
      window.removeEventListener("keydown", onKey);
      if (unlisten) unlisten();
    };
  }, [ctxMenu, folderRoot, refreshDir]);

  return (
    <MenuContext.Provider value={{ openTab, setOpenTab }}>
      <style>{`.icon-size svg{width:16px;height:16px;display:block}`}</style>
      <div className="h-screen flex flex-col">
        <div
          className="shrink-0 bg-(--background-secondary-color) flex justify-between items-center min-h-8 max-h-8"
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
                  text: "Open settings",
                  onClick: () => {
                    invoke("open_settings");
                  },
                },
                {
                  text: "Open AI settings",
                  onClick: () => {
                    setAIModal(true);
                  },
                },
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
                  text: "Open Folder...",
                  onClick: async () => {
                    const now = Date.now();

                    if (now - lastOpenFileRef.current < MIN_INTERVAL_MS) return;

                    lastOpenFileRef.current = now;

                    const path = await openDialog({
                      multiple: false,
                      directory: true,
                    });
                    if (typeof path === "string") {
                      const tree = await invoke("read_directory_root", {
                        path,
                      });
                      setDirTree(tree as any);
                      setFolderRoot(path as string);
                      setExpanded((e) => ({ ...e, [path as string]: true }));
                    }
                  },
                },
                ...(folderRoot
                  ? [
                      {
                        text: "Close Folder",
                        onClick: () => {
                          setFolderRoot(null);
                          setDirTree(null);
                          setExpanded({});
                        },
                      },
                    ]
                  : []),
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
                      await openFilePath(path);
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
                      await openFilePath(path as string);
                    }
                  },
                  keybindSuggestion: "Ctrl+N",
                },
              ]}
            />
          </div>

          <div className="flex-1 flex justify-center pointer-events-none">
            <span className="select-none text-sm c text-(--token-comments) flex items-center">
              {windowTitle}
            </span>
          </div>
          <div className="h-11 rounded-t-lg bg-card flex justify-start items-center flex-row-reverse gap-1.5 px-3">
            <span
              className="w-3 h-3 rounded-full bg-[#FF736A] fine-border cursor-pointer hover:bg-red-500 transition-colors border-[1px]"
              aria-label="Close"
              onMouseDown={() => {
                appWindow.close();
              }}
              tabIndex={-1}
            />
            <span
              className="w-3 h-3 rounded-full bg-[#FEBC2E] fine-border cursor-pointer hover:bg-yellow-500 transition-colors"
              aria-label="Minimize"
              onMouseDown={() => {
                appWindow.minimize();
              }}
              tabIndex={-1}
            />
            <span
              className="w-3 h-3 rounded-full bg-[#19C332] fine-border cursor-pointer hover:bg-green-500 transition-colors"
              aria-label="Maximize"
              onMouseDown={() => {
                appWindow.toggleMaximize();
              }}
              tabIndex={-1}
            />
          </div>
        </div>
        <div className="flex-1 flex w-full border-t border-(--token-functions)">
          <div className="w-xs max-w-[18rem] shrink-0 bg-(--background-secondary-color) flex flex-col border-r border-(--token-functions) s h-[calc(100vh-32px)]">
            <div className="flex-1 overflow-y-auto s scroll-thin">
              {folderRoot ? (
                <div className="p-1">
                  {(() => {
                    const renderTree = (root: any) => {
                      const Node = (node: any) => {
                        if (
                          node?.isDir &&
                          typeof node.name === "string" &&
                          node.name.startsWith(".")
                        ) {
                          return null;
                        }
                        const isDir = !!node.isDir;
                        const isExpanded =
                          expanded[node.path] ?? node.path === folderRoot;
                        const gray = node.ignored ? "opacity-60" : "";
                        const isActive =
                          !isDir &&
                          (fileHandle as any)?.metadata?.path === node.path;
                        const onClick = async () => {
                          if (isDir) {
                            const next = !isExpanded;
                            setExpanded((e) => ({ ...e, [node.path]: next }));
                            if (next && node.children == null) {
                              try {
                                const children = await invoke(
                                  "read_directory_children",
                                  {
                                    path: node.path,
                                    root: folderRoot as string,
                                  },
                                );
                                setDirTree((prev: any) =>
                                  injectChildren(
                                    prev,
                                    node.path,
                                    children as any,
                                  ),
                                );
                              } catch {}
                            }
                          } else {
                            const fh = await createTauriFileHandle(node.path);
                            setFileHandle(fh);
                            setWindowTitle(fh.metadata.name);
                            (window as any).__loadTotalLines = (
                              fh.metadata as any
                            )?.lineCount;
                          }
                        };
                        return (
                          <div key={node.path}>
                            <button
                              type="button"
                              className="w-full text-left"
                              draggable
                              onDragStart={(
                                e: DragEvent<HTMLButtonElement>,
                              ) => {
                                dragSourcePathRef.current = node.path;
                                dragOverPathRef.current = null;
                                setIsDragging(true);
                                e.dataTransfer.setData(
                                  "text/load-path",
                                  node.path,
                                );
                                e.dataTransfer.effectAllowed = "move";
                              }}
                              onDragOver={(e: DragEvent<HTMLButtonElement>) => {
                                if (isDir && isDragging) {
                                  e.preventDefault();
                                  e.dataTransfer.dropEffect = "move";
                                  dragOverPathRef.current = node.path;
                                }
                              }}
                              onDrop={async (
                                e: DragEvent<HTMLButtonElement>,
                              ) => {
                                e.preventDefault();
                                const src =
                                  e.dataTransfer.getData("text/load-path");
                                if (!src || src === node.path || !isDir) {
                                  dragSourcePathRef.current = null;
                                  dragOverPathRef.current = null;
                                  setIsDragging(false);
                                  return;
                                }
                                try {
                                  const base =
                                    src.replace(/\\/g, "/").split("/").pop() ||
                                    "";
                                  const sep = node.path.includes("\\")
                                    ? "\\"
                                    : "/";
                                  const dest =
                                    node.path.replace(/[\\/]+$/, "") +
                                    sep +
                                    base;
                                  if (dest !== src) {
                                    await invoke("move_path", { src, dest });
                                    await refreshParent(src);
                                    await refreshDir(node.path);
                                  }
                                } catch {
                                } finally {
                                  dragSourcePathRef.current = null;
                                  dragOverPathRef.current = null;
                                  setIsDragging(false);
                                }
                              }}
                              onDragEnd={() => {
                                dragSourcePathRef.current = null;
                                dragOverPathRef.current = null;
                                setIsDragging(false);
                              }}
                              onMouseDown={(e) => {
                                if (editingPath === node.path) {
                                  e.stopPropagation();
                                  return;
                                }
                                if (e.button !== 0) {
                                  return;
                                }
                                e.preventDefault();
                                onClick();
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                setCtxMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  path: node.path,
                                  isDir,
                                  name: node.name || "",
                                });
                              }}
                            >
                              <div
                                className={`flex items-center gap-1 px-1 py-[3px] rounded ${gray} ${isActive ? "bg-(--background-color) ring-1 ring-(--token-functions)" : ""} hover:bg-(--background-color)/70 transition-colors group`}
                              >
                                {isDir ? (
                                  <span
                                    className={`inline-flex justify-center items-center w-3 shrink-0 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
                                  >
                                    <svg
                                      width="12"
                                      height="12"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      className="c opacity-70 group-hover:opacity-100"
                                    >
                                      <polyline points="9 6 15 12 9 18" />
                                    </svg>
                                  </span>
                                ) : (
                                  <span className="w-3" />
                                )}
                                <span
                                  className="inline-block c icon-size pr-1"
                                  dangerouslySetInnerHTML={{
                                    __html: getIconSvg(node.name || "", isDir),
                                  }}
                                />
                                {editingPath === node.path ? (
                                  <input
                                    className="text-sm px-1 py-0.5 rounded bg-(--background-color) border border-(--token-functions)/40 w-full"
                                    autoFocus
                                    onMouseDown={(e) => e.stopPropagation()}
                                    value={editingName}
                                    onChange={(e) =>
                                      setEditingName(e.target.value)
                                    }
                                    onBlur={async () => {
                                      const trimmed = (
                                        editingName || ""
                                      ).trim();
                                      if (trimmed && trimmed !== node.name) {
                                        await commitRename(node.path, trimmed);
                                      }
                                      setEditingPath(null);
                                    }}
                                    onKeyDown={async (e) => {
                                      if (e.key === "Enter") {
                                        const trimmed = (
                                          editingName || ""
                                        ).trim();
                                        if (trimmed && trimmed !== node.name) {
                                          await commitRename(
                                            node.path,
                                            trimmed,
                                          );
                                        }
                                        setEditingPath(null);
                                      } else if (e.key === "Escape") {
                                        setEditingPath(null);
                                      }
                                    }}
                                  />
                                ) : (
                                  <span
                                    className={`truncate text-sm ${isActive ? "font-medium" : ""}`}
                                  >
                                    {node.name}
                                  </span>
                                )}
                              </div>
                            </button>
                            {isDir &&
                            isExpanded &&
                            Array.isArray(node.children) &&
                            node.children.length > 0 ? (
                              <div className="pl-3 border-l border-(--token-functions)/30 ml-[6px]">
                                {[...(node.children || [])]
                                  .sort((a: any, b: any) => {
                                    if (!!a.isDir !== !!b.isDir)
                                      return a.isDir ? -1 : 1;
                                    return (a.name || "").localeCompare(
                                      b.name || "",
                                      undefined,
                                      { sensitivity: "base" },
                                    );
                                  })
                                  .map((c: any) => (
                                    <Node key={c.path} {...c} />
                                  ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      };
                      return <Node {...root} />;
                    };

                    const normalize = (s: string) =>
                      s.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
                    const outside = openFiles.filter((f) => {
                      const np = f.path.replace(/\\/g, "/").toLowerCase();
                      const nr = normalize(folderRoot as string) + "/";
                      return !np.startsWith(nr);
                    });

                    return (
                      <div className="flex flex-col gap-1">
                        {outside.length > 0 ? (
                          <div className="mb-1">
                            {outside.map((f) => (
                              <button
                                key={f.path}
                                className="w-full text-left"
                                draggable
                                onDragStart={(
                                  e: DragEvent<HTMLButtonElement>,
                                ) => {
                                  e.dataTransfer.setData(
                                    "text/load-path",
                                    f.path,
                                  );
                                }}
                                onClick={async () => {
                                  const fh = await createTauriFileHandle(
                                    f.path,
                                  );
                                  setFileHandle(fh);
                                  setWindowTitle(fh.metadata.name);
                                  (window as any).__loadTotalLines = (
                                    fh.metadata as any
                                  )?.lineCount;
                                }}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  setCtxMenu({
                                    x: e.clientX,
                                    y: e.clientY,
                                    path: f.path,
                                    isDir: false,
                                    name: f.name,
                                  });
                                }}
                              >
                                <div
                                  className={`flex items-center gap-1 px-1 py-[3px] rounded ${fileHandle?.metadata?.path === f.path ? "bg-(--background-color) ring-1 ring-(--token-functions)" : ""} hover:bg-(--background-color)/70 transition-colors`}
                                >
                                  <span
                                    className="inline-block c icon-size pr-1"
                                    dangerouslySetInnerHTML={{
                                      __html: getIconSvg(f.name, false),
                                    }}
                                  />
                                  {editingPath === f.path ? (
                                    <input
                                      className="text-xs px-1 py-0.5 rounded bg-(--background-color) border border-(--token-functions)/40 w-full"
                                      autoFocus
                                      value={editingName}
                                      onChange={(e) =>
                                        setEditingName(e.target.value)
                                      }
                                      onBlur={async () => {
                                        const trimmed = (
                                          editingName || ""
                                        ).trim();
                                        if (trimmed && trimmed !== f.name) {
                                          await commitRename(f.path, trimmed);
                                        }
                                        setEditingPath(null);
                                      }}
                                      onKeyDown={async (e) => {
                                        if (e.key === "Enter") {
                                          const trimmed = (
                                            editingName || ""
                                          ).trim();
                                          if (trimmed && trimmed !== f.name) {
                                            await commitRename(f.path, trimmed);
                                          }
                                          setEditingPath(null);
                                        } else if (e.key === "Escape") {
                                          setEditingPath(null);
                                        }
                                      }}
                                    />
                                  ) : (
                                    <span className="truncate text-xs">
                                      {f.name}
                                    </span>
                                  )}
                                </div>
                              </button>
                            ))}
                            <div className="h-px bg-(--token-functions) my-1 opacity-30" />
                          </div>
                        ) : null}

                        {dirTree ? renderTree(dirTree) : null}
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="p-1">
                  <div>
                    {openFiles.length > 0 ? (
                      openFiles.map((f) => (
                        <div
                          key={f.path}
                          className="w-full text-left cursor-pointer"
                          draggable
                          onDragStart={(e: DragEvent<HTMLDivElement>) => {
                            dragSourcePathRef.current = f.path;
                            dragOverPathRef.current = null;
                            setIsDragging(true);
                            e.dataTransfer.setData("text/load-path", f.path);
                          }}
                          onDragEnd={() => {
                            dragSourcePathRef.current = null;
                            dragOverPathRef.current = null;
                            setIsDragging(false);
                          }}
                          onClick={async (e) => {
                            if ((e.target as HTMLElement).closest("button")) {
                              return;
                            }
                            const fh = await createTauriFileHandle(f.path);
                            setFileHandle(fh);
                            setWindowTitle(fh.metadata.name);
                            (window as any).__loadTotalLines = (
                              fh.metadata as any
                            )?.lineCount;
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setCtxMenu({
                              x: e.clientX,
                              y: e.clientY,
                              path: f.path,
                              isDir: false,
                              name: f.name,
                            });
                          }}
                        >
                          <div
                            className={`flex items-center gap-1 px-1 py-[3px] rounded ${fileHandle?.metadata?.path === f.path ? "bg-(--background-color) ring-1 ring-(--token-functions)" : ""} hover:bg-(--background-color)/70 transition-colors`}
                          >
                            <span
                              className="inline-block c icon-size pr-1"
                              dangerouslySetInnerHTML={{
                                __html: getIconSvg(f.name, false),
                              }}
                            />
                            {editingPath === f.path ? (
                              <input
                                className="text-sm px-1 py-0.5 rounded bg-(--background-color) border border-(--token-functions)/40 w-full"
                                autoFocus
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                onBlur={async () => {
                                  const trimmed = (editingName || "").trim();
                                  if (trimmed && trimmed !== f.name) {
                                    await commitRename(f.path, trimmed);
                                  }
                                  setEditingPath(null);
                                }}
                                onKeyDown={async (e) => {
                                  if (e.key === "Enter") {
                                    const trimmed = (editingName || "").trim();
                                    if (trimmed && trimmed !== f.name) {
                                      await commitRename(f.path, trimmed);
                                    }
                                    setEditingPath(null);
                                  } else if (e.key === "Escape") {
                                    setEditingPath(null);
                                  }
                                }}
                              />
                            ) : (
                              <span className="truncate text-sm">{f.name}</span>
                            )}
                            <button
                              type="button"
                              className="ml-1 text-[10px] px-1 py-0.5 rounded hover:bg-(--background-color) text-(--token-comments)"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setOpenFiles((prev) =>
                                  prev.filter((of) => of.path !== f.path),
                                );
                                if (
                                  (fileHandle as any)?.metadata?.path === f.path
                                ) {
                                  setFileHandle(null);
                                  setWindowTitle("");
                                }
                              }}
                              aria-label="Close file"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="px-1 py-0.5 text-(--token-comments) text-sm">
                        No files open
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="p-1 border-t border-(--token-functions) flex items-center justify-between">
              <div className="flex items-center gap-0.5">
                <div className="nice">
                  <span className="text-xs select-none">Typescript</span>
                </div>
                <div className="nice">
                  <span className="text-xs c text-(--token-functions) select-none">
                    {(() => {
                      const [cursor, setCursor] = useState(
                        (window as any).__loadCursor || { row: 1, col: 1 },
                      );

                      useEffect(() => {
                        const interval = setInterval(() => {
                          setCursor(
                            (window as any).__loadCursor || { row: 1, col: 1 },
                          );
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
                  <div className="c text-red-400 hidden">
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
                  <span className="text-xs select-none hidden">0 Errors</span>
                </div>
                <div className="nice">
                  <div className="c text-yellow-400 hidden">
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
                  <span className="text-xs select-none hidden">1 Warning</span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex-1">
            {fileHandle ? (
              <Editor
                key={(fileHandle as any)?.metadata?.path}
                fileHandle={fileHandle}
              />
            ) : null}
          </div>
        </div>
      </div>
      {ctxMenu && (
        <div
          className="fixed inset-0 z-50"
          onMouseDown={() => setCtxMenu(null)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="absolute" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            <div className="min-w-48 bg-(--background-secondary-color) border border-(--token-keywords) rounded-md p-1 shadow-lg">
              <div className="flex flex-col gap-0.5">
                <div className="hidden" />

                <button
                  className="w-full text-left px-2 py-1 rounded text-xs hover:bg-(--background-color) transition-colors"
                  onMouseDown={async (e) => {
                    e.preventDefault();

                    try {
                      await writeText("@" + ctxMenu.path);
                    } catch {}
                    setCtxMenu(null);
                  }}
                >
                  Copy
                </button>
                <button
                  className="w-full text-left px-2 py-1 rounded text-xs hover:bg-(--background-color) transition-colors"
                  onMouseDown={async (e) => {
                    e.preventDefault();
                    try {
                      const lower = ctxMenu.path.toLowerCase();
                      if (
                        lower.startsWith("c:\\windows") ||
                        lower.startsWith("c:/windows")
                      ) {
                        return;
                      }
                      await writeText("!" + ctxMenu.path);
                    } catch {}
                    setCtxMenu(null);
                  }}
                >
                  Cut
                </button>

                <button
                  className="w-full text-left px-2 py-1 rounded text-xs hover:bg-(--background-color) transition-colors"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const base =
                      ctxMenu.path.replace(/\\/g, "/").split("/").pop() || "";
                    setEditingPath(ctxMenu.path);
                    setEditingName(base);
                    setCtxMenu(null);
                  }}
                >
                  Rename
                </button>

                <button
                  className="w-full text-left px-2 py-1 rounded text-xs hover:bg-(--background-color) transition-colors"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    openPath(ctxMenu.path);
                    setCtxMenu(null);
                  }}
                >
                  Show in Explorer
                </button>
                {ctxMenu.isDir && (
                  <button
                    className="w-full text-left px-2 py-1 rounded text-xs hover:bg-(--background-color) transition-colors"
                    onMouseDown={async (e) => {
                      e.preventDefault();
                      try {
                        const clip = (await readText()) || "";
                        if (!clip || clip.length < 2) return;
                        const marker = clip[0];
                        const src = clip.slice(1);
                        const base =
                          src.replace(/\\/g, "/").split("/").pop() || "";
                        const sep = ctxMenu.path.includes("\\") ? "\\" : "/";
                        const dest =
                          ctxMenu.path.replace(/[\\/]+$/, "") + sep + base;
                        if (marker === "@") {
                          await invoke("copy_path", { src, dest });
                          await refreshDir(ctxMenu.path);
                        } else if (marker === "!") {
                          const lower = src.toLowerCase();
                          if (
                            lower.startsWith("c:\\windows") ||
                            lower.startsWith("c:/windows")
                          ) {
                            return;
                          }
                          await invoke("move_path", { src, dest });
                          await writeText("");
                          await refreshParent(src);
                          await refreshDir(ctxMenu.path);
                        } else {
                          return;
                        }
                      } catch {}
                      setCtxMenu(null);
                    }}
                  >
                    Paste
                  </button>
                )}

                <button
                  className="w-full text-left px-2 py-1 rounded text-xs hover:bg-red-600/40 hover:text-red-300 transition-colors"
                  onMouseDown={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                      const name =
                        ctxMenu.path.replace(/\\/g, "/").split("/").pop() ||
                        ctxMenu.path;
                      if (confirm(`Delete ${name}? This cannot be undone.`)) {
                        await invoke("delete_path", { path: ctxMenu.path });
                        await refreshParent(ctxMenu.path);
                      }
                    } catch {}

                    setCtxMenu(null);
                  }}
                >
                  Delete…
                </button>

                <div className="h-px bg-(--token-functions)/40 my-0.5" />
                <button
                  className="w-full text-left px-2 py-1 rounded text-xs hover:bg-(--background-color) transition-colors"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setCtxMenu(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </MenuContext.Provider>
  );
}

export default App;
