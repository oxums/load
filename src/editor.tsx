type TokenOffset = {
  col: number;
  row: number;
};

interface LoadFileHandle {
  readLine(num: number): string;
  writeLine(num: number, content: string): void;
  close(): void;
  reciveUpdate(callback: (line: number, content: string) => void): void;
  metadata: {
    name: string;
    path: string;
    size: number;
    language: string;
    lineCount: number;
  };

  requestTokenization(lineStart: number, lineEnd: number): void;
  recieveTokenization(
    callback: (
      tokens: Array<{
        startOffset: TokenOffset;
        endOffset: TokenOffset;
        type: string;
      }>,
    ) => void,
  ): void;

  saveBuffer(): void;
  changeLanguage(language: string): void;
}

import "./keybinds";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import { log, logError } from "./logs";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";

type Token = {
  startOffset: TokenOffset;
  endOffset: TokenOffset;
  type: string;
};

type FileBuffer = {
  lines: string[];
  getLine(n: number): string;
  setLine(n: number, content: string): void;
  insertLine(n: number, content: string): void;
  removeLine(n: number): void;
  length(): number;
};

function createFileBuffer(initial: string[]): FileBuffer {
  return {
    lines: initial,
    getLine(n) {
      if (n < 0 || n >= this.lines.length) return "";
      return this.lines[n];
    },
    setLine(n, content) {
      if (n < 0) return;
      if (n >= this.lines.length) {
        const missing = n - this.lines.length + 1;
        for (let i = 0; i < missing; i++) this.lines.push("");
      }
      this.lines[n] = content;
    },
    insertLine(n, content) {
      if (n < 0) n = 0;
      if (n > this.lines.length) n = this.lines.length;
      this.lines.splice(n, 0, content);
    },
    removeLine(n) {
      if (n < 0 || n >= this.lines.length) return;
      this.lines.splice(n, 1);
    },
    length() {
      return this.lines.length;
    },
  };
}

function tokenColor(type: string) {
  switch (type) {
    case "types":
      return "var(--token-types)";
    case "numbers":
      return "var(--token-numbers)";
    case "strings":
      return "var(--token-strings)";
    case "comments":
      return "var(--token-comments)";
    case "keywords":
      return "var(--token-keywords)";
    case "functions":
      return "var(--token-functions)";
    case "variables":
      return "var(--token-variables)";
    case "untokenized":
    default:
      return "var(--token-untokenized)";
  }
}

function isPrintableKey(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key.length === 1) return true;
  return false;
}

export function Editor({ fileHandle }: { fileHandle: LoadFileHandle }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hiddenInputRef = useRef<HTMLInputElement | null>(null);
  const caretRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const lastKeydownRef = useRef<{ key: string; ts: number } | null>(null);

  const [lineHeightPx, setLineHeightPx] = useState(18);
  const [charWidthPx, setCharWidthPx] = useState(8);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  const [buffer] = useState<FileBuffer>(() => createFileBuffer([]));
  const [loadedUpto, setLoadedUpto] = useState(0);

  const [tokensByLine, setTokensByLine] = useState<Map<number, Token[]>>(
    () => new Map(),
  );

  // total finite line count from backend metadata
  const [fileLineCount, setFileLineCount] = useState<number>(() =>
    Math.max(1, (fileHandle.metadata as any).lineCount ?? 1),
  );

  // settings + autosave
  const [settings, setSettings] = useState<any>({});
  useEffect(() => {
    invoke("get_settings")
      .then((s: any) => {
        try {
          const obj = typeof s === "string" ? JSON.parse(s) : s;
          setSettings(obj || {});
        } catch {
          setSettings({});
        }
      })
      .catch(() => {});
  }, []);
  const autosave = {
    enabled: settings?.autosave?.enabled ?? true,
    intervalMs: settings?.autosave?.intervalMs ?? 0,
    onBlur: settings?.autosave?.onBlur ?? true,
    debounceMs: settings?.autosave?.debounceMs ?? 1000,
  };
  const dirtyRef = useRef(false);
  const debounceTimerRef = useRef<number | null>(null);
  function scheduleAutosave() {
    dirtyRef.current = true;
    if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
    if (autosave.enabled && autosave.debounceMs > 0) {
      debounceTimerRef.current = window.setTimeout(() => {
        if (dirtyRef.current) {
          try {
            fileHandle.saveBuffer();
          } finally {
            dirtyRef.current = false;
          }
        }
      }, autosave.debounceMs);
    }
  }
  useEffect(() => {
    if (autosave.enabled && autosave.intervalMs && autosave.intervalMs > 0) {
      const id = window.setInterval(() => {
        if (dirtyRef.current) {
          try {
            fileHandle.saveBuffer();
          } finally {
            dirtyRef.current = false;
          }
        }
      }, autosave.intervalMs);
      return () => window.clearInterval(id);
    }
  }, [autosave.enabled, autosave.intervalMs, fileHandle]);
  useEffect(() => {
    if (!autosave.onBlur) return;
    const h = () => {
      if (dirtyRef.current) {
        try {
          fileHandle.saveBuffer();
        } finally {
          dirtyRef.current = false;
        }
      }
    };
    window.addEventListener("blur", h);
    return () => window.removeEventListener("blur", h);
  }, [autosave.onBlur, fileHandle]);

  const [cursor, setCursor] = useState<{ row: number; col: number }>({
    row: 0,
    col: 0,
  });

  useEffect(() => {
    try {
      (window as any).__loadCursor = {
        row: cursor.row + 1,
        col: cursor.col + 1,
      };
    } catch {}
  }, [cursor]);

  useEffect(() => {
    try {
      (window as any).__loadTotalLines = fileLineCount;
    } catch {}
  }, [fileLineCount]);
  const [sel, setSel] = useState<{
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  const getSelectedText = useCallback(() => {
    if (!sel) return "";

    const sRow = sel.startRow;
    const eRow = sel.endRow;
    const sCol = sel.startCol;
    const eCol = sel.endCol;
    const startFirst =
      sRow < eRow || (sRow === eRow && sCol <= eCol)
        ? { row: sRow, col: sCol }
        : { row: eRow, col: eCol };
    const endLast =
      sRow < eRow || (sRow === eRow && sCol <= eCol)
        ? { row: eRow, col: eCol }
        : { row: sRow, col: sCol };
    // Move caret to the normalized start before mutating
    moveCaret(startFirst.row, startFirst.col);
    if (startFirst.row === endLast.row) {
      const line = buffer.getLine(startFirst.row);
      return line.slice(startFirst.col, endLast.col);
    }
    const parts: string[] = [];
    const firstLine = buffer.getLine(startFirst.row);
    parts.push(firstLine.slice(startFirst.col));
    for (let r = startFirst.row + 1; r < endLast.row; r++) {
      parts.push(buffer.getLine(r));
    }
    const lastLine = buffer.getLine(endLast.row);
    parts.push(lastLine.slice(0, endLast.col));
    return parts.join("\n");
  }, [sel, buffer]);

  const deleteSelection = useCallback(() => {
    if (!sel) return;

    const sRow = sel.startRow;

    const eRow = sel.endRow;

    const sCol = sel.startCol;

    const eCol = sel.endCol;

    const startFirst =
      sRow < eRow || (sRow === eRow && sCol <= eCol)
        ? { row: sRow, col: sCol }
        : { row: eRow, col: eCol };

    const endLast =
      sRow < eRow || (sRow === eRow && sCol <= eCol)
        ? { row: eRow, col: eCol }
        : { row: sRow, col: sCol };

    if (startFirst.row === endLast.row) {
      const line = buffer.getLine(startFirst.row);

      const before = line.slice(0, startFirst.col);

      const after = line.slice(endLast.col);

      const updated = before + after;

      buffer.setLine(startFirst.row, updated);

      fileHandle.writeLine(startFirst.row, updated);

      setSel(null);
      fileHandle.requestTokenization(startFirst.row, startFirst.row);

      scheduleAutosave();

      return;
    }

    const firstLine = buffer.getLine(startFirst.row);

    const lastLine = buffer.getLine(endLast.row);

    const newFirst = firstLine.slice(0, startFirst.col);

    const newLast = lastLine.slice(endLast.col);

    buffer.setLine(startFirst.row, newFirst + newLast);

    fileHandle.writeLine(startFirst.row, newFirst + newLast);

    for (let r = endLast.row; r >= startFirst.row + 1; r--) {
      buffer.removeLine(r);
    }

    // adjust total line count by removed lines
    setFileLineCount((c) => Math.max(1, c - (endLast.row - startFirst.row)));
    setSel(null);
    fileHandle.requestTokenization(startFirst.row, startFirst.row);

    scheduleAutosave();
  }, [sel, buffer, fileHandle]);

  const gutterPx = useMemo(() => {
    const digits = String(Math.max(fileLineCount, 1)).length;
    return Math.max(32, Math.ceil(charWidthPx * digits) + 12 + 8);
  }, [charWidthPx, fileLineCount]);

  const overscan = 10;

  const totalHeight = useMemo(
    () => fileLineCount * lineHeightPx,
    [fileLineCount, lineHeightPx],
  );

  const firstVisibleLine = Math.max(
    0,
    Math.floor(scrollTop / (lineHeightPx || 1)),
  );
  const visibleLineCount = Math.ceil(
    (viewportHeight || 1) / (lineHeightPx || 1),
  );
  const lastVisibleLine = firstVisibleLine + visibleLineCount + overscan;

  const ensureLinesLoaded = useCallback(
    (target: number) => {
      const clamped = Math.min(target, Math.max(0, fileLineCount - 1));
      if (clamped <= loadedUpto) return;

      const start = loadedUpto;

      const end = clamped;
      for (let i = start; i <= end; i++) {
        let l: string;

        try {
          l = fileHandle.readLine(i);
        } catch (e) {
          logError("readLine failed line " + i + " " + (e as Error).message);
          break;
        }

        buffer.setLine(i, l ?? "");
      }

      setLoadedUpto(end);
      log("Loaded lines 0-" + end);
      fileHandle.requestTokenization(start, end);
    },

    [loadedUpto, buffer, fileHandle, fileLineCount],
  );

  useEffect(() => {
    const off = (e: any) => {
      const { line, content } = e;
      buffer.setLine(line, content);
      // If backend sends an update for a line we have not accounted for,
      // extend the known finite line count and sync global.
      setFileLineCount((current) => {
        const candidate = line + 1;
        if (candidate > current) {
          try {
            (window as any).__loadTotalLines = candidate;
          } catch {}
          return candidate;
        }
        return current;
      });
      setTokensByLine((prev) => {
        const updated = new Map(prev);
        updated.delete(line);
        return updated;
      });
    };
    fileHandle.reciveUpdate((line, content) => {
      off({ line, content });
    });
    fileHandle.recieveTokenization((newTokens) => {
      setTokensByLine((prev) => {
        const updated = new Map(prev);
        const byLine = new Map<number, Token[]>();
        newTokens.forEach((t) => {
          const line = t.startOffset.row;
          const arr = byLine.get(line) || [];
          arr.push(t);
          byLine.set(line, arr);
        });
        byLine.forEach((arr, line) => {
          updated.set(line, arr);
          // Also ensure line count grows if tokenization reveals further lines.
          setFileLineCount((current) => {
            const candidate = line + 1;
            if (candidate > current) {
              try {
                (window as any).__loadTotalLines = candidate;
              } catch {}
              return candidate;
            }
            return current;
          });
        });
        return updated;
      });
    });
  }, [fileHandle, buffer, setFileLineCount]);

  useLayoutEffect(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setViewportHeight(rect.height);
    }
  }, []);

  useEffect(() => {
    function handleResize() {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setViewportHeight(rect.height);
      }
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useLayoutEffect(() => {
    if (measureRef.current) {
      const el = measureRef.current;
      const style = window.getComputedStyle(el);
      const lh = parseFloat(style.lineHeight);
      const fw = el.getBoundingClientRect().width / 10;
      setLineHeightPx(lh || lineHeightPx);
      setCharWidthPx(fw || charWidthPx);
    }
  }, [fileHandle.metadata.language]);

  useEffect(() => {
    ensureLinesLoaded(lastVisibleLine);
  }, [lastVisibleLine, ensureLinesLoaded]);

  const visibleLines: number[] = useMemo(() => {
    const lines: number[] = [];

    const end = Math.min(fileLineCount - 1, lastVisibleLine);
    for (let i = firstVisibleLine; i <= end; i++) lines.push(i);

    return lines;
  }, [firstVisibleLine, lastVisibleLine, fileLineCount]);

  const requestVisibleTokenization = useCallback(() => {
    const start = firstVisibleLine;
    const end = lastVisibleLine;
    fileHandle.requestTokenization(start, end);
  }, [firstVisibleLine, lastVisibleLine, fileHandle]);

  useEffect(() => {
    const id = setTimeout(requestVisibleTokenization, 50);
    return () => clearTimeout(id);
  }, [firstVisibleLine, lastVisibleLine, requestVisibleTokenization]);

  const moveCaret = useCallback(
    (row: number, col: number) => {
      row = Math.max(0, Math.min(row, Math.max(0, fileLineCount - 1)));
      const line = buffer.getLine(row);
      col = Math.max(0, Math.min(col, line.length));
      setCursor({ row, col });
    },

    [buffer, fileLineCount],
  );

  const insertText = useCallback(
    (text: string) => {
      if (sel) {
        deleteSelection();
      }

      const line = buffer.getLine(cursor.row);

      const before = line.slice(0, cursor.col);

      const after = line.slice(cursor.col);

      const updated = before + text + after;

      buffer.setLine(cursor.row, updated);

      fileHandle.writeLine(cursor.row, updated);

      moveCaret(cursor.row, cursor.col + text.length);

      setTokensByLine((prev) => {
        const m = new Map(prev);

        m.delete(cursor.row);

        return m;
      });

      fileHandle.requestTokenization(cursor.row, cursor.row);

      scheduleAutosave();
    },

    [cursor, buffer, moveCaret, fileHandle, sel, deleteSelection],
  );

  const deleteBackward = useCallback(() => {
    if (sel) {
      deleteSelection();
      return;
    }
    if (cursor.col > 0) {
      const line = buffer.getLine(cursor.row);
      const before = line.slice(0, cursor.col - 1);
      const after = line.slice(cursor.col);
      const updated = before + after;
      buffer.setLine(cursor.row, updated);
      fileHandle.writeLine(cursor.row, updated);
      moveCaret(cursor.row, cursor.col - 1);
      setTokensByLine((prev) => {
        const m = new Map(prev);
        m.delete(cursor.row);
        return m;
      });

      fileHandle.requestTokenization(cursor.row, cursor.row);

      scheduleAutosave();
    } else if (cursor.row > 0) {
      const prevLine = buffer.getLine(cursor.row - 1);

      const currentLine = buffer.getLine(cursor.row);

      const merged = prevLine + currentLine;

      const newCol = prevLine.length;

      buffer.setLine(cursor.row - 1, merged);

      buffer.removeLine(cursor.row);

      fileHandle.writeLine(cursor.row - 1, merged);

      moveCaret(cursor.row - 1, newCol);

      setTokensByLine((prev) => {
        const m = new Map(prev);

        m.delete(cursor.row - 1);

        const shifted = new Map<number, Token[]>();

        m.forEach((v, k) => {
          if (k >= cursor.row) shifted.set(k - 1, v);
          else shifted.set(k, v);
        });

        return shifted;
      });

      setFileLineCount((c) => Math.max(1, c - 1));
      fileHandle.requestTokenization(cursor.row - 1, cursor.row - 1);

      scheduleAutosave();
    }
  }, [cursor, buffer, moveCaret, fileHandle, sel, deleteSelection]);

  const insertNewLine = useCallback(() => {
    if (sel) {
      deleteSelection();
    }

    const line = buffer.getLine(cursor.row);
    const before = line.slice(0, cursor.col);
    const after = line.slice(cursor.col);

    buffer.setLine(cursor.row, before);
    buffer.insertLine(cursor.row + 1, after);

    fileHandle.writeLine(cursor.row, before);
    fileHandle.writeLine(cursor.row + 1, after);

    const newRow = cursor.row + 1;
    setFileLineCount((c) => c + 1);

    setTokensByLine((prev) => {
      const m = new Map(prev);

      m.delete(cursor.row);

      const shifted = new Map<number, Token[]>();

      m.forEach((v, k) => {
        if (k > cursor.row) shifted.set(k + 1, v);
        else shifted.set(k, v);
      });

      return shifted;
    });

    setCursor({ row: newRow, col: 0 });
    fileHandle.requestTokenization(cursor.row, newRow);

    scheduleAutosave();
  }, [
    cursor,
    buffer,
    moveCaret,
    fileHandle,
    sel,
    deleteSelection,
    fileLineCount,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        moveCaret(cursor.row, cursor.col - 1);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        moveCaret(cursor.row, cursor.col + 1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        moveCaret(cursor.row - 1, cursor.col);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveCaret(cursor.row + 1, cursor.col);
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        moveCaret(cursor.row, 0);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        moveCaret(cursor.row, buffer.getLine(cursor.row).length);
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        deleteBackward();
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        insertNewLine();
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        insertText("  ");
        return;
      }
      if (isPrintableKey(e.nativeEvent)) {
        insertText(e.key);
        e.preventDefault();
        return;
      }
      if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        try {
          fileHandle.saveBuffer();
          log("Buffer saved");
        } catch (err) {
          logError("Save failed " + (err as Error).message);
        }
      }
    },
    [
      cursor,
      moveCaret,
      buffer,
      deleteBackward,
      insertNewLine,
      insertText,
      fileHandle,
    ],
  );

  const handleContainerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const y = e.clientY - rect.top + scrollTop;
      const x = e.clientX - rect.left;
      const row = Math.floor(y / lineHeightPx);
      const xContent = Math.max(0, x - gutterPx);
      const col = Math.floor(xContent / charWidthPx);
      moveCaret(row, col);
      hiddenInputRef.current?.focus();
    },
    [lineHeightPx, charWidthPx, moveCaret, scrollTop],
  );

  useEffect(() => {
    hiddenInputRef.current?.focus();
  }, []);
  useEffect(() => {
    const handleDocClick = (e: MouseEvent) => {
      if (
        contextMenuRef.current &&
        contextMenuRef.current.contains(e.target as Node)
      )
        return;
      setContextMenu(null);
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("mousedown", handleDocClick);
    window.addEventListener("keydown", handleEsc);
    return () => {
      window.removeEventListener("mousedown", handleDocClick);
      window.removeEventListener("keydown", handleEsc);
    };
  }, []);

  useLayoutEffect(() => {
    if (caretRef.current) {
      caretRef.current.style.top = cursor.row * lineHeightPx - scrollTop + "px";
      caretRef.current.style.left = cursor.col * charWidthPx + gutterPx + "px";
      caretRef.current.style.height = lineHeightPx + "px";
    }
  }, [cursor, lineHeightPx, charWidthPx, scrollTop]);

  const renderLineTokens = useCallback(
    (lineNumber: number) => {
      const content = buffer.getLine(lineNumber);
      const tokens = tokensByLine.get(lineNumber);
      if (!tokens || tokens.length === 0) {
        return (
          <div
            data-line={lineNumber}
            className="flex"
            style={{ height: lineHeightPx }}
          >
            <span
              style={{
                color: tokenColor("untokenized"),
                whiteSpace: "pre",
              }}
            >
              {content || " "}
            </span>
          </div>
        );
      }
      const sorted = [...tokens].sort(
        (a, b) => a.startOffset.col - b.startOffset.col,
      );
      const spans: React.ReactNode[] = [];
      let lastCol = 0;
      sorted.forEach((t, i) => {
        if (t.startOffset.row !== lineNumber) return;
        const start = t.startOffset.col;
        const end = t.endOffset.col;
        if (start > lastCol) {
          const gap = content.slice(lastCol, start);
          if (gap.length > 0) {
            spans.push(
              <span
                key={"gap-" + i + "-" + lineNumber + "-" + lastCol}
                style={{
                  color: tokenColor("untokenized"),
                  whiteSpace: "pre",
                }}
              >
                {gap}
              </span>,
            );
          }
        }
        const slice = content.slice(start, end);
        spans.push(
          <span
            key={"tok-" + i + "-" + lineNumber}
            style={{ color: tokenColor(t.type), whiteSpace: "pre" }}
          >
            {slice || " "}
          </span>,
        );
        lastCol = end;
      });
      if (lastCol < content.length) {
        spans.push(
          <span
            key={"final-gap-" + lineNumber}
            style={{
              color: tokenColor("untokenized"),
              whiteSpace: "pre",
            }}
          >
            {content.slice(lastCol)}
          </span>,
        );
      }
      if (content.length === 0) {
        spans.push(
          <span
            key={"empty-" + lineNumber}
            style={{ color: tokenColor("untokenized"), whiteSpace: "pre" }}
          >
            {" "}
          </span>,
        );
      }
      return (
        <div
          data-line={lineNumber}
          className="flex"
          style={{ height: lineHeightPx }}
        >
          {spans}
        </div>
      );
    },
    [tokensByLine, buffer, lineHeightPx],
  );

  return (
    <div
      className="w-full h-full relative overflow-hidden editor-styling"
      onClick={(e) => {
        setContextMenu(null);
        handleContainerClick(e);
      }}
    >
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-auto"
        onScroll={(e) => {
          setContextMenu(null);
          setScrollTop((e.target as HTMLDivElement).scrollTop);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          const rect = (
            e.currentTarget as HTMLDivElement
          ).getBoundingClientRect();
          setContextMenu({
            x: e.clientX - rect.left + containerRef.current!.scrollLeft,
            y: e.clientY - rect.top + scrollTop,
          });
        }}
      >
        <div
          style={{
            position: "relative",
            height: totalHeight,
            width: "100%",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: firstVisibleLine * lineHeightPx,
              left: 0,
              right: 0,
            }}
          >
            {visibleLines.map((ln) => (
              <div
                key={ln}
                className={
                  "px-2 flex" +
                  (ln === cursor.row
                    ? " bg-(--background-accent-color)/30"
                    : "") +
                  (sel &&
                  ln >= Math.min(sel.startRow, sel.endRow) &&
                  ln <= Math.max(sel.startRow, sel.endRow)
                    ? " bg-(--background-accent-color)/50"
                    : "")
                }
                style={{
                  minHeight: lineHeightPx,
                  height: lineHeightPx,
                  fontFamily: "var(--editor-font-family)",
                  fontSize: "var(--editor-font-size)",
                  lineHeight: `${lineHeightPx}px`,
                  whiteSpace: "pre",
                }}
                onMouseDown={(e) => {
                  e.preventDefault();

                  const target = e.currentTarget;

                  const rect = target.getBoundingClientRect();

                  const x = e.clientX - rect.left;

                  const xContent = Math.max(0, x - gutterPx);

                  const col = Math.floor(xContent / charWidthPx);

                  moveCaret(ln, col);

                  setSel({
                    startRow: ln,
                    startCol: col,
                    endRow: ln,
                    endCol: col,
                  });
                  hiddenInputRef.current?.focus();
                }}
                onMouseMove={(e) => {
                  if (e.buttons === 1 && sel) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const xContent = Math.max(0, x - gutterPx);
                    const col = Math.floor(xContent / charWidthPx);
                    setSel((s: any) =>
                      s
                        ? {
                            ...s,
                            endRow: ln,
                            endCol: col,
                          }
                        : s,
                    );
                  }
                }}
              >
                <div
                  className="select-none text-[11px] text-right shrink-0"
                  style={{
                    width: gutterPx - 8,
                    paddingRight: 8,
                    color:
                      ln === cursor.row ||
                      (sel &&
                        ln >= Math.min(sel.startRow, sel.endRow) &&
                        ln <= Math.max(sel.startRow, sel.endRow))
                        ? "var(--text-color)"
                        : "var(--token-comments)",
                  }}
                >
                  {ln + 1}
                </div>

                <div className="flex-1">{renderLineTokens(ln)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <input
        ref={hiddenInputRef}
        spellCheck={false}
        autoCorrect="off"
        autoComplete="off"
        style={{
          position: "absolute",
          opacity: 0,
          pointerEvents: "none",
          width: 0,
          height: 0,
        }}
        onBlur={() => {
          hiddenInputRef.current?.focus();
        }}
        onKeyDown={(e) => {
          handleKeyDown(e);
          if (hiddenInputRef.current) hiddenInputRef.current.value = "";
        }}
      />
      <span
        ref={measureRef}
        style={{
          position: "absolute",
          top: -9999,
          left: -9999,
          fontFamily: "var(--editor-font-family)",
          fontSize: "var(--editor-font-size)",
          lineHeight: "var(--editor-line-height)",
          whiteSpace: "nowrap",
        }}
      >
        MMMMMMMMMM
      </span>

      {sel &&
        (() => {
          const sRow = sel.startRow;
          const eRow = sel.endRow;
          const sCol = sel.startCol;
          const eCol = sel.endCol;
          const startFirst =
            sRow < eRow || (sRow === eRow && sCol <= eCol)
              ? { row: sRow, col: sCol }
              : { row: eRow, col: eCol };
          const endLast =
            sRow < eRow || (sRow === eRow && sCol <= eCol)
              ? { row: eRow, col: eCol }
              : { row: sRow, col: sCol };
          const rects: JSX.Element[] = [];
          for (let r = startFirst.row; r <= endLast.row; r++) {
            const fromCol = r === startFirst.row ? startFirst.col : 0;
            const toCol =
              r === endLast.row ? endLast.col : buffer.getLine(r).length;
            const top = r * lineHeightPx - scrollTop;
            const left = gutterPx + fromCol * charWidthPx;
            const width = Math.max(0, (toCol - fromCol) * charWidthPx);
            rects.push(
              <div
                key={"sel-" + r}
                style={{
                  position: "absolute",

                  top,
                  left,
                  width,
                  height: lineHeightPx,
                  background: "var(--background-accent-color)",
                  opacity: 0.3,
                  pointerEvents: "none",
                }}
              />,
            );
          }
          return <>{rects}</>;
        })()}
      <div
        ref={caretRef}
        style={{
          position: "absolute",
          width: 2,
          background: "var(--text-color)",
          transition: "top 0.02s,left 0.02s",
          pointerEvents: "none",
        }}
      />

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="absolute z-50 bg-(--background-secondary-color) border border-(--token-keywords) rounded p-1 w-40 text-[13px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="w-full flex justify-between px-2 py-0.5 rounded hover:bg-(--background-color)"
            onMouseDown={() => {
              try {
                writeText(getSelectedText());
              } finally {
                setContextMenu(null);
              }
            }}
          >
            <span>Copy</span>
          </button>
          <button
            className="w-full flex justify-between px-2 py-0.5 rounded hover:bg-(--background-color)"
            onMouseDown={() => {
              try {
                writeText(getSelectedText());
                deleteSelection();
              } finally {
                setContextMenu(null);
              }
            }}
          >
            <span>Cut</span>
          </button>
          <button
            className="w-full flex justify-between px-2 py-0.5 rounded hover:bg-(--background-color)"
            onMouseDown={async () => {
              try {
                const clip = await readText();
                insertText(clip);
              } finally {
                setContextMenu(null);
              }
            }}
          >
            <span>Paste</span>
          </button>
        </div>
      )}
    </div>
  );
}

export async function createTauriFileHandle(
  path: string,
): Promise<LoadFileHandle> {
  const meta = await invoke<any>("open_file", { path });
  const cache = new Map<number, string>();
  let updateCb: ((line: number, content: string) => void) | null = null;
  let tokenCb:
    | ((
        tokens: Array<{
          startOffset: TokenOffset;
          endOffset: TokenOffset;
          type: string;
        }>,
      ) => void)
    | null = null;
  const unlisten: Array<() => void> = [];

  try {
    const un1 = await listen<{ line: number; content: string }>(
      "file-updated",
      (e) => {
        const { line, content } = e.payload;
        cache.set(line, content);
        if (updateCb) updateCb(line, content);
      },
    );
    unlisten.push(un1);
  } catch (e) {
    logError("listen file-updated failed " + (e as Error).message);
  }

  try {
    const un2 = await listen<
      Array<{
        startOffset: TokenOffset;
        endOffset: TokenOffset;
        type: string;
      }>
    >("tokenization", (e) => {
      if (tokenCb) tokenCb(e.payload);
    });
    unlisten.push(un2);
  } catch (e) {
    logError("listen tokenization failed " + (e as Error).message);
  }

  try {
    const un3 = await listen<{ language: string }>("language-changed", (e) => {
      // @ts-ignore
      handle.metadata.language = e.payload.language;
    });
    unlisten.push(un3);
  } catch (e) {
    logError("listen language-changed failed " + (e as Error).message);
  }

  const handle: LoadFileHandle = {
    metadata: {
      name: meta?.name ?? "",
      path: meta?.path ?? path,
      size: meta?.size ?? 0,
      language: meta?.language ?? "plain",

      lineCount: Math.max(
        1,
        (meta as any)?.lineCount ?? (meta as any)?.line_count ?? 1,
      ),
    },
    readLine(num: number): string {
      if (cache.has(num)) return cache.get(num) as string;
      invoke<string>("read_line", { num })
        .then((content) => {
          cache.set(num, content ?? "");
          if (updateCb) updateCb(num, content ?? "");
        })
        .catch((e) => logError("read_line failed " + (e as Error).message));
      return cache.get(num) ?? "";
    },
    writeLine(num: number, content: string): void {
      invoke("write_line", { num, content }).catch((e) =>
        logError("write_line failed " + (e as Error).message),
      );
    },
    close(): void {
      while (unlisten.length) {
        try {
          const fn = unlisten.pop();
          if (fn) fn();
        } catch {}
      }
    },
    reciveUpdate(callback) {
      updateCb = callback;
    },
    requestTokenization(lineStart: number, lineEnd: number) {
      invoke("request_tokenization", { lineStart, lineEnd }).catch((e) =>
        logError("request_tokenization failed " + (e as Error).message),
      );
    },
    recieveTokenization(callback) {
      tokenCb = callback;
    },
    saveBuffer() {
      invoke("save_buffer").catch((e) =>
        logError("save_buffer failed " + (e as Error).message),
      );
    },
    changeLanguage(language: string) {
      invoke("change_language", { language })
        .then(() => {
          // @ts-ignore
          handle.metadata.language = language;
        })
        .catch((e) =>
          logError("change_language failed " + (e as Error).message),
        );
    },
  };

  log("Tauri file handle created for " + path);
  return handle;
}

export default Editor;
