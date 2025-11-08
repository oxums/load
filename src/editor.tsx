type TokenOffset = {
  col: number;
  row: number;
};

interface LoadFileHandle {
  readLine(num: number): string;
  writeLine(num: number, content: string): void;
  close(): void;
  reciveUpdate(
    callback: (line: number, content: string, totalLines?: number) => void,
  ): void;
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
  const lowered = type.toLowerCase();
  // Direct category mapping
  switch (lowered) {
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
      return "var(--token-untokenized)";
  }
  // Heuristic mapping for raw Tree-sitter node kinds
  if (lowered.includes("comment")) return "var(--token-comments)";
  if (lowered.includes("string") || lowered.includes("char"))
    return "var(--token-strings)";
  if (
    lowered.includes("number") ||
    lowered.includes("int") ||
    lowered.includes("float") ||
    lowered.includes("digit")
  )
    return "var(--token-numbers)";
  if (
    lowered.includes("function") ||
    lowered.includes("method") ||
    lowered === "fn_item"
  )
    return "var(--token-functions)";
  if (
    lowered.includes("class") ||
    lowered.includes("struct") ||
    lowered.includes("enum") ||
    lowered.includes("interface") ||
    lowered.includes("type")
  )
    return "var(--token-types)";
  if (
    lowered === "identifier" ||
    lowered.endsWith("_identifier") ||
    lowered.includes("var")
  )
    return "var(--token-variables)";
  if (
    [
      "import",
      "export",
      "package",
      "return",
      "if",
      "else",
      "for",
      "while",
      "switch",
      "case",
      "break",
      "continue",
    ].some((k) => lowered === k || lowered.includes(k + "_"))
  )
    return "var(--token-keywords)";
  return "var(--token-untokenized)";
}

function mapTreeSitterKindToCategory(kind: string): string {
  const l = kind.toLowerCase();
  if (l.includes("comment")) return "comments";
  if (l.includes("string") || l.includes("char")) return "strings";
  if (
    l.includes("number") ||
    l.includes("int") ||
    l.includes("float") ||
    l.includes("digit")
  )
    return "numbers";
  if (l.includes("function") || l.includes("method") || l === "fn_item")
    return "functions";
  if (
    l.includes("class") ||
    l.includes("struct") ||
    l.includes("enum") ||
    l.includes("interface") ||
    l.includes("type")
  )
    return "types";
  if (l === "identifier" || l.endsWith("_identifier") || l.includes("var"))
    return "variables";
  if (
    [
      "import",
      "export",
      "package",
      "return",
      "if",
      "else",
      "for",
      "while",
      "switch",
      "case",
      "break",
      "continue",
    ].some((k) => l === k || l.includes(k + "_"))
  )
    return "keywords";
  return "untokenized";
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

  // Tokenization pool: for each line we keep { version, tokens }
  const [tokenPool, setTokenPool] = useState<
    Map<number, { version: number; tokens: Token[] }>
  >(() => new Map());
  const [lineVersions, setLineVersions] = useState<Map<number, number>>(
    () => new Map(),
  );

  const pendingTokenizationRef = useRef<null>(null);

  const [fileLineCount, setFileLineCount] = useState<number>(() =>
    Math.max(1, (fileHandle.metadata as any).lineCount ?? 1),
  );

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

  // (Removed timeout cleanup; no debounce timers now)
  useEffect(() => {}, []);

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
      // Bump version for the modified line so pool knows it needs refresh
      setLineVersions((prev) => {
        const m = new Map(prev);
        m.set(startFirst.row, (m.get(startFirst.row) ?? 0) + 1);
        return m;
      });

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

    setFileLineCount((c) => Math.max(1, c - (endLast.row - startFirst.row)));

    setSel(null);

    // Shift token pool entries downward after multi-line deletion (lines removed)
    setTokenPool((prev) => {
      const removedCount = endLast.row - startFirst.row;
      const m = new Map<number, { version: number; tokens: Token[] }>();
      prev.forEach((val, line) => {
        if (line < startFirst.row) {
          m.set(line, val);
        } else if (line > endLast.row) {
          // Shift upward by removedCount
          m.set(line - removedCount, val);
        }
        // Lines within deleted block are discarded and will be re-tokenized if visible
      });
      return m;
    });
    // Bump version of merged first line
    setLineVersions((prev) => {
      const removedCount = endLast.row - startFirst.row;
      const m = new Map<number, number>();
      prev.forEach((v, line) => {
        if (line < startFirst.row) {
          m.set(line, v);
        } else if (line > endLast.row) {
          m.set(line - removedCount, v);
        }
      });
      m.set(
        startFirst.row,
        (m.get(startFirst.row) ?? 0) + 1, // merged content
      );
      return m;
    });

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

    [
      loadedUpto,
      buffer,
      fileHandle,
      fileLineCount,
      firstVisibleLine,
      lastVisibleLine,
    ],
  );

  useEffect(() => {
    const off = (e: any) => {
      const { line, content, totalLines } = e;
      buffer.setLine(line, content);
      // If backend provides totalLines, trust it; otherwise grow if needed.
      setFileLineCount((current) => {
        if (typeof totalLines === "number") {
          try {
            (window as any).__loadTotalLines = totalLines;
          } catch {}
        }
        if (typeof totalLines === "number") return Math.max(1, totalLines);
        const candidate = line + 1;
        if (candidate > current) {
          try {
            (window as any).__loadTotalLines = candidate;
          } catch {}
          return candidate;
        }
        return current;
      });

      // Mark line version increment so that visible token request will include this line
      setLineVersions((prev) => {
        const m = new Map(prev);
        m.set(line, (m.get(line) ?? 0) + 1);
        return m;
      });
      // Do not clear existing tokens; they stay until replaced to avoid flicker.
    };
    fileHandle.reciveUpdate((line, content, totalLines) => {
      off({ line, content, totalLines });
    });
    fileHandle.recieveTokenization((newTokens) => {
      // Group incoming per-line tokens
      const grouped = new Map<number, Token[]>();
      newTokens.forEach((t) => {
        const ln = t.startOffset.row;
        const arr = grouped.get(ln) || [];
        arr.push(t);
        grouped.set(ln, arr);
      });
      setTokenPool((prev) => {
        const next = new Map(prev);
        grouped.forEach((arr, ln) => {
          next.set(ln, {
            version: lineVersions.get(ln) ?? 0,
            tokens: arr,
          });
        });
        return next;
      });
      // Adjust file line count if needed
      setFileLineCount((current) => {
        let maxLine = current - 1;
        grouped.forEach((_v, ln) => {
          if (ln > maxLine) maxLine = ln;
        });
        const candidate = maxLine + 1;
        if (candidate > current) {
          try {
            (window as any).__loadTotalLines = candidate;
          } catch {}
          return candidate;
        }
        return current;
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

  // Request tokenization only for lines in view that are missing or stale
  useEffect(() => {
    const need: number[] = [];
    visibleLines.forEach((ln) => {
      const version = lineVersions.get(ln) ?? 0;
      const entry = tokenPool.get(ln);
      if (!entry || entry.version < version) {
        need.push(ln);
      }
    });
    if (need.length) {
      const start = Math.min(...need);
      const end = Math.max(...need);
      fileHandle.requestTokenization(start, end);
    }
  }, [visibleLines, tokenPool, lineVersions, fileHandle]);

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

      // Bump version for this line; keep old tokens until replacement arrives (no flicker)
      setLineVersions((prev) => {
        const m = new Map(prev);
        m.set(cursor.row, (m.get(cursor.row) ?? 0) + 1);
        return m;
      });

      scheduleAutosave();
    },
    [
      cursor,
      buffer,
      moveCaret,
      fileHandle,
      sel,
      deleteSelection,
      lastVisibleLine,
      firstVisibleLine,
    ],
  );

  const deleteBackward = useCallback(() => {
    if (sel) {
      deleteSelection();
      return;
    }
    // If not at column 0, delete a single character to the left
    if (cursor.col > 0) {
      const line = buffer.getLine(cursor.row);
      const before = line.slice(0, Math.max(0, cursor.col - 1));
      const after = line.slice(cursor.col);
      const updated = before + after;
      buffer.setLine(cursor.row, updated);
      fileHandle.writeLine(cursor.row, updated);
      // Bump version for this line so tokenization pool knows it's stale
      setLineVersions((prev) => {
        const m = new Map(prev);
        m.set(cursor.row, (m.get(cursor.row) ?? 0) + 1);
        return m;
      });
      moveCaret(cursor.row, Math.max(0, cursor.col - 1));
      scheduleAutosave();
      return;
    }
    // At column 0: merge with previous line if possible
    if (cursor.row === 0) {
      return;
    }
    const prevLine = buffer.getLine(cursor.row - 1);
    const currentLine = buffer.getLine(cursor.row);
    const merged = prevLine + currentLine;
    const newCol = prevLine.length;

    buffer.setLine(cursor.row - 1, merged);
    buffer.removeLine(cursor.row);
    fileHandle.writeLine(cursor.row - 1, merged);

    // Keep backend buffer in sync: remove the now-merged line on the backend
    invoke("remove_line", { num: cursor.row }).catch((e) =>
      logError("remove_line failed " + (e as Error).message),
    );
    moveCaret(cursor.row - 1, newCol);

    setFileLineCount((c) => Math.max(1, c - 1));

    // Shift token pool entries upward from removed line
    const removedRow = cursor.row;
    setTokenPool((prev) => {
      const m = new Map<number, { version: number; tokens: Token[] }>();
      prev.forEach((val, line) => {
        if (line < removedRow) {
          m.set(line, val);
        } else if (line > removedRow) {
          m.set(line - 1, val);
        }
        // removedRow itself discarded
      });
      return m;
    });
    setLineVersions((prev) => {
      const m = new Map<number, number>();
      prev.forEach((v, line) => {
        if (line < removedRow) {
          m.set(line, v);
        } else if (line > removedRow) {
          m.set(line - 1, v);
        }
      });
      // bump merged line (removedRow - 1)
      const merged = removedRow - 1;
      m.set(merged, (m.get(merged) ?? 0) + 1);
      return m;
    });

    scheduleAutosave();
  }, [
    cursor,
    buffer,
    moveCaret,
    fileHandle,
    sel,
    deleteSelection,
    firstVisibleLine,
    lastVisibleLine,
    fileLineCount,
  ]);

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

    invoke("insert_line", { num: cursor.row + 1, content: after }).catch((e) =>
      logError("insert_line failed " + (e as Error).message),
    );

    const newRow = cursor.row + 1;
    setFileLineCount((c) => c + 1);

    setCursor({ row: newRow, col: 0 });

    // Shift token pool entries downward from insertion row
    const insertRow = cursor.row;
    setTokenPool((prev) => {
      const m = new Map<number, { version: number; tokens: Token[] }>();
      prev.forEach((val, line) => {
        if (line < insertRow) {
          m.set(line, val);
        } else {
          m.set(line + 1, val);
        }
      });
      // clear tokens for split lines
      m.delete(insertRow);
      m.delete(insertRow + 1);
      return m;
    });
    setLineVersions((prev) => {
      const m = new Map<number, number>();
      prev.forEach((v, line) => {
        if (line < insertRow) {
          m.set(line, v);
        } else {
          m.set(line + 1, v);
        }
      });
      // bump versions for affected lines
      m.set(insertRow, (m.get(insertRow) ?? 0) + 1);
      m.set(insertRow + 1, (m.get(insertRow + 1) ?? 0) + 1);
      return m;
    });

    scheduleAutosave();
  }, [
    cursor,
    buffer,
    moveCaret,
    fileHandle,
    sel,
    deleteSelection,
    fileLineCount,
    firstVisibleLine,
    lastVisibleLine,
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
      const tokens = tokenPool.get(lineNumber)?.tokens;
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
        const lineLen = content.length;
        const rawStart = t.startOffset.col;
        const rawEnd = t.endOffset.col;
        const start = Math.max(0, Math.min(rawStart, lineLen));
        const end = Math.max(0, Math.min(rawEnd, lineLen));
        const gapStart = Math.max(0, Math.min(lastCol, lineLen));
        if (start > gapStart) {
          const gap = content.slice(gapStart, start);
          if (gap.length > 0) {
            spans.push(
              <span
                key={"gap-" + i + "-" + lineNumber + "-" + gapStart}
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

        if (end > start) {
          const slice = content.slice(start, end);
          spans.push(
            <span
              key={"tok-" + i + "-" + lineNumber}
              style={{ color: tokenColor(t.type), whiteSpace: "pre" }}
            >
              {slice || " "}
            </span>,
          );
        }
        lastCol = Math.max(lastCol, end);
      });

      const tailStart = Math.max(0, Math.min(lastCol, content.length));
      if (tailStart < content.length) {
        spans.push(
          <span
            key={"final-gap-" + lineNumber}
            style={{
              color: tokenColor("untokenized"),

              whiteSpace: "pre",
            }}
          >
            {content.slice(tailStart)}
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
    [tokenPool, buffer, lineHeightPx],
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
  let updateCb:
    | ((line: number, content: string, totalLines?: number) => void)
    | null = null;
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
        const { line, content, totalLines } = e.payload as any;
        cache.set(line, content);
        if (updateCb) updateCb(line, content, totalLines);
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
      // Map raw Tree-sitter kinds; split multi-line tokens into per-line segments

      tokenCb = (tokens) => {
        const pieces: Array<{
          startOffset: TokenOffset;

          endOffset: TokenOffset;

          type: string;
        }> = [];

        const BIG = 2147483647;

        for (const t of tokens) {
          const mappedType = mapTreeSitterKindToCategory(t.type);

          const sRow = t.startOffset.row;

          const eRow = t.endOffset.row;

          const sCol = t.startOffset.col;

          const eCol = t.endOffset.col;

          if (sRow === eRow) {
            pieces.push({
              startOffset: { row: sRow, col: sCol },

              endOffset: { row: eRow, col: eCol },

              type: mappedType,
            });
          } else {
            // First line: start col -> end of line

            pieces.push({
              startOffset: { row: sRow, col: sCol },

              endOffset: { row: sRow, col: BIG },

              type: mappedType,
            });

            // Middle full lines

            for (let r = sRow + 1; r < eRow; r++) {
              pieces.push({
                startOffset: { row: r, col: 0 },

                endOffset: { row: r, col: BIG },

                type: mappedType,
              });
            }

            // Last line: col 0 -> end col

            pieces.push({
              startOffset: { row: eRow, col: 0 },

              endOffset: { row: eRow, col: eCol },

              type: mappedType,
            });
          }
        }

        callback(pieces);
      };
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
