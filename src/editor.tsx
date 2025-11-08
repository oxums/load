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
      if (n < 0) return "";
      const val = this.lines[n];
      return typeof val === "string" ? val : "";
    },
    setLine(n, content) {
      if (n < 0) return;
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
  const suppressNextClickRef = useRef(false);
  const dragAnchorRef = useRef<{ row: number; col: number } | null>(null);
  const renderCacheRef = useRef<
    Map<number, { version: number; node: JSX.Element }>
  >(new Map());
  const pendingScrollTopRef = useRef(0);
  const scrollRafRef = useRef<number | null>(null);
  // Tokenization request batching / debouncing
  const tokenRequestDebounceRef = useRef<number | null>(null);
  const tokenReqPendingRef = useRef<{ start: number; end: number } | null>(
    null,
  );
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
  const lineVersionsRef = useRef<Map<number, number>>(new Map());
  useEffect(() => {
    lineVersionsRef.current = lineVersions;
  }, [lineVersions]);
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
  useEffect(() => {
    buffer.lines = [];
    setLoadedUpto(0);
    setFileLineCount(Math.max(1, (fileHandle.metadata as any)?.lineCount ?? 1));
    setTokenPool(new Map());
    setLineVersions(new Map());
    setCursor({ row: 0, col: 0 });
    setSel(null);
    undoStackRef.current = [];
    redoStackRef.current = [];
  }, [fileHandle]);
  const [cursor, setCursor] = useState<{ row: number; col: number }>({
    row: 0,
    col: 0,
  });
  const [extraCursors, setExtraCursors] = useState<
    Array<{ row: number; col: number }>
  >([]);
  const clampPos = useCallback(
    (row: number, col: number) => {
      row = Math.max(0, Math.min(row, Math.max(0, fileLineCount - 1)));
      const line = buffer.getLine(row);
      col = Math.max(0, Math.min(col, line.length));
      return { row, col };
    },
    [buffer, fileLineCount],
  );
  const addCursor = useCallback(
    (row: number, col: number) => {
      const p = clampPos(row, col);
      if (p.row === cursor.row && p.col === cursor.col) return;
      setExtraCursors((list) => {
        for (const c of list)
          if (c.row === p.row && c.col === p.col) return list;
        return [...list, p];
      });
    },
    [clampPos, cursor],
  );
  const clearExtraCursors = useCallback(() => setExtraCursors([]), []);
  const getAllCursors = useCallback(
    () => [{ row: cursor.row, col: cursor.col }, ...extraCursors],
    [cursor, extraCursors],
  );
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
  type Snapshot = {
    lines: string[];
    cursor: { row: number; col: number };
    sel: any;
  };
  const undoStackRef = useRef<Snapshot[]>([]);
  const redoStackRef = useRef<Snapshot[]>([]);
  const takeSnapshot = useCallback((): Snapshot => {
    return {
      lines: [...buffer.lines],
      cursor: { row: cursor.row, col: cursor.col },
      sel,
    };
  }, [buffer, cursor, sel]);
  const applySnapshot = useCallback(
    (snap: Snapshot) => {
      const currLen = fileLineCount;
      const newLen = snap.lines.length;
      const minLen = Math.min(currLen, newLen);
      for (let i = 0; i < minLen; i++) {
        const desired = snap.lines[i] ?? "";
        if (buffer.getLine(i) !== desired) {
          buffer.setLine(i, desired);
          fileHandle.writeLine(i, desired);
          setLineVersions((prev) => {
            const m = new Map(prev);
            m.set(i, (m.get(i) ?? 0) + 1);
            return m;
          });
        }
      }
      if (newLen > currLen) {
        for (let i = currLen; i < newLen; i++) {
          const content = snap.lines[i] ?? "";
          buffer.insertLine(i, content);
          invoke("insert_line", { num: i, content }).catch(() => {});
        }
        setFileLineCount(newLen);
      } else if (newLen < currLen) {
        for (let i = currLen - 1; i >= newLen; i--) {
          buffer.removeLine(i);
          invoke("remove_line", { num: i }).catch(() => {});
        }
        setFileLineCount(newLen);
      }
      setTokenPool(new Map());
      setLineVersions(new Map());
      const pos = clampPos(snap.cursor.row, snap.cursor.col);
      setCursor(pos);
      setSel(snap.sel);
      scheduleAutosave();
    },
    [
      buffer,
      fileHandle,
      fileLineCount,
      setFileLineCount,
      setTokenPool,
      setLineVersions,
      scheduleAutosave,
    ],
  );
  const pushUndoSnapshot = useCallback(() => {
    undoStackRef.current.push(takeSnapshot());
    redoStackRef.current = [];
  }, [takeSnapshot]);
  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const current = takeSnapshot();
    const snap = undoStackRef.current.pop()!;
    redoStackRef.current.push(current);
    applySnapshot(snap);
  }, [takeSnapshot, applySnapshot]);
  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const current = takeSnapshot();
    const snap = redoStackRef.current.pop()!;
    undoStackRef.current.push(current);
    applySnapshot(snap);
  }, [takeSnapshot, applySnapshot]);
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
  const deleteRange = (row: number, startCol: number, endCol: number) => {
    if (row < 0 || row >= fileLineCount) return;
    const line = buffer.getLine(row);
    const sc = Math.max(0, Math.min(startCol, line.length));
    const ec = Math.max(sc, Math.min(endCol, line.length));
    if (sc === ec) return;
    const updated = line.slice(0, sc) + line.slice(ec);
    buffer.setLine(row, updated);
    fileHandle.writeLine(row, updated);
    setLineVersions((prev) => {
      const m = new Map(prev);
      m.set(row, (m.get(row) ?? 0) + 1);
      return m;
    });
  };
  const deleteSelection = useCallback(() => {
    if (!sel) return;
    pushUndoSnapshot();
    const {
      startRow: rawSR,
      startCol: rawSC,
      endRow: rawER,
      endCol: rawEC,
    } = sel;
    const forward =
      rawSR < rawER || (rawSR === rawER && rawSC <= rawEC)
        ? {
            sRow: rawSR,
            sCol: rawSC,
            eRow: rawER,
            eCol: rawEC,
          }
        : {
            sRow: rawER,
            sCol: rawEC,
            eRow: rawSR,
            eCol: rawSC,
          };
    const { sRow, sCol, eRow, eCol } = forward;
    if (sRow === eRow) {
      deleteRange(sRow, sCol, eCol);
      setSel(null);
      scheduleAutosave();
      return;
    }
    const firstLine = buffer.getLine(sRow);
    const lastLine = buffer.getLine(eRow);
    const newFirst = firstLine.slice(0, sCol);
    const newLast = lastLine.slice(eCol);
    const merged = newFirst + newLast;
    buffer.setLine(sRow, merged);
    fileHandle.writeLine(sRow, merged);
    for (let r = eRow; r >= sRow + 1; r--) {
      buffer.removeLine(r);
    }
    setFileLineCount((c) => Math.max(1, c - (eRow - sRow)));
    setTokenPool((prev) => {
      const removedCount = eRow - sRow;
      const m = new Map<number, { version: number; tokens: Token[] }>();
      prev.forEach((val, line) => {
        if (line < sRow) {
          m.set(line, val);
        } else if (line > eRow) {
          m.set(line - removedCount, val);
        }
      });
      return m;
    });
    setLineVersions((prev) => {
      const removedCount = eRow - sRow;
      const m = new Map<number, number>();
      prev.forEach((v, line) => {
        if (line < sRow) {
          m.set(line, v);
        } else if (line > eRow) {
          m.set(line - removedCount, v);
        }
      });
      m.set(sRow, (m.get(sRow) ?? 0) + 1);
      return m;
    });
    setSel(null);
    scheduleAutosave();
  }, [sel, buffer, fileHandle]);
  const gutterPx = useMemo(() => {
    const digits = String(Math.max(fileLineCount, 1)).length;
    return Math.max(32, Math.ceil(charWidthPx * digits) + 12 + 8);
  }, [charWidthPx, fileLineCount]);
  const overscan = 3;
  const TOKEN_CONTEXT_BEFORE = 5;
  const TOKEN_CONTEXT_AFTER = 5;
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
    },
    [loadedUpto, buffer, fileHandle, fileLineCount],
  );
  useEffect(() => {
    const off = (e: any) => {
      const { line, content, totalLines } = e;
      buffer.setLine(line, content);
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
      setLineVersions((prev) => {
        const m = new Map(prev);
        m.set(line, (m.get(line) ?? 0) + 1);
        return m;
      });
    };
    fileHandle.reciveUpdate((line, content, totalLines) => {
      off({ line, content, totalLines });
    });
    fileHandle.recieveTokenization((newTokens) => {
      const grouped = new Map<number, Token[]>();
      const invalidated = new Set<number>();
      newTokens.forEach((t) => {
        const ln = t.startOffset.row;
        invalidated.add(ln);
        const arr = grouped.get(ln) || [];
        arr.push(t);
        grouped.set(ln, arr);
      });
      
      invalidated.forEach((ln) => renderCacheRef.current.delete(ln));
      setTokenPool((prev) => {
        const next = new Map(prev);
        grouped.forEach((arr, ln) => {
          next.set(ln, {
            version: lineVersionsRef.current.get(ln) ?? 0,
            tokens: arr,
          });
        });
        return next;
      });
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
    renderCacheRef.current.clear();
  }, [lineHeightPx, charWidthPx, fileHandle.metadata.language]);
  useEffect(() => {
    ensureLinesLoaded(lastVisibleLine);
    if (
      undoStackRef.current.length === 0 &&
      loadedUpto >= Math.min(fileLineCount - 1, lastVisibleLine)
    ) {
      undoStackRef.current.push(takeSnapshot());
    }
  }, [
    lastVisibleLine,
    ensureLinesLoaded,
    loadedUpto,
    fileLineCount,
    takeSnapshot,
  ]);
  const visibleLines: number[] = useMemo(() => {
    const lines: number[] = [];
    const end = Math.min(fileLineCount - 1, lastVisibleLine);
    for (let i = firstVisibleLine; i <= end; i++) lines.push(i);
    return lines;
  }, [firstVisibleLine, lastVisibleLine, fileLineCount]);
  useEffect(() => {
    const needLines: number[] = [];
    visibleLines.forEach((ln) => {
      const version = lineVersions.get(ln) ?? 0;
      const entry = tokenPool.get(ln);
      if (!entry || entry.version < version) {
        needLines.push(ln);
      }
    });
    if (needLines.length === 0) return;

    needLines.sort((a, b) => a - b);
    const ranges: Array<{ start: number; end: number }> = [];
    let rs = needLines[0];
    let re = needLines[0];
    for (let i = 1; i < needLines.length; i++) {
      const ln = needLines[i];
      if (ln === re + 1) {
        re = ln;
      } else {
        ranges.push({ start: rs, end: re });
        rs = re = ln;
      }
    }
    ranges.push({ start: rs, end: re });

    ranges.forEach((r) => {
      if (!tokenReqPendingRef.current) {
        tokenReqPendingRef.current = { start: r.start, end: r.end };
      } else {
        tokenReqPendingRef.current.start = Math.min(
          tokenReqPendingRef.current.start,
          r.start,
        );
        tokenReqPendingRef.current.end = Math.max(
          tokenReqPendingRef.current.end,
          r.end,
        );
      }
    });

    if (tokenRequestDebounceRef.current) {
      clearTimeout(tokenRequestDebounceRef.current);
    }
    tokenRequestDebounceRef.current = window.setTimeout(() => {
      const pending = tokenReqPendingRef.current;
      tokenRequestDebounceRef.current = null;
      if (!pending) return;
      const expandedStart = Math.max(0, pending.start - TOKEN_CONTEXT_BEFORE);
      const expandedEnd = Math.min(
        fileLineCount - 1,
        pending.end + TOKEN_CONTEXT_AFTER,
      );
      fileHandle.requestTokenization(expandedStart, expandedEnd);
      tokenReqPendingRef.current = null;
    }, 60); 
  }, [visibleLines, tokenPool, lineVersions, fileHandle, fileLineCount]);
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
    if (cursor.col > 0) {
      const line = buffer.getLine(cursor.row);
      const before = line.slice(0, Math.max(0, cursor.col - 1));
      const after = line.slice(cursor.col);
      const updated = before + after;
      buffer.setLine(cursor.row, updated);
      fileHandle.writeLine(cursor.row, updated);
      setLineVersions((prev) => {
        const m = new Map(prev);
        m.set(cursor.row, (m.get(cursor.row) ?? 0) + 1);
        return m;
      });
      moveCaret(cursor.row, Math.max(0, cursor.col - 1));
      scheduleAutosave();
      return;
    }
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
    invoke("remove_line", { num: cursor.row }).catch((e) =>
      logError("remove_line failed " + (e as Error).message),
    );
    moveCaret(cursor.row - 1, newCol);
    setFileLineCount((c) => Math.max(1, c - 1));
    const removedRow = cursor.row;
    setTokenPool((prev) => {
      const m = new Map<number, { version: number; tokens: Token[] }>();
      prev.forEach((val, line) => {
        if (line < removedRow) {
          m.set(line, val);
        } else if (line > removedRow) {
          m.set(line - 1, val);
        }
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
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const isWord = (ch: string) => /[A-Za-z0-9_]/.test(ch);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        const lastRow = Math.max(0, fileLineCount - 1);
        const lastCol = buffer.getLine(lastRow).length;
        setSel({ startRow: 0, startCol: 0, endRow: lastRow, endCol: lastCol });
        moveCaret(lastRow, lastCol);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }
      const prevWord = (row: number, col: number) => {
        const line = buffer.getLine(row);
        let i = col;
        while (i > 0 && /\s/.test(line[i - 1])) i--;
        while (i > 0 && isWord(line[i - 1])) i--;
        return i;
      };
      const nextWord = (row: number, col: number) => {
        const line = buffer.getLine(row);
        let i = col;
        const n = line.length;
        while (i < n && /\s/.test(line[i])) i++;
        while (i < n && isWord(line[i])) i++;
        return i;
      };
      const startSelIfNeeded = () => {
        if (!sel) {
          setSel({
            startRow: cursor.row,
            startCol: cursor.col,
            endRow: cursor.row,
            endCol: cursor.col,
          });
        }
      };
      const updateSelection = (toRow: number, toCol: number) => {
        startSelIfNeeded();
        setSel((s) =>
          s
            ? {
                startRow: s.startRow,
                startCol: s.startCol,
                endRow: toRow,
                endCol: toCol,
              }
            : s,
        );
      };
      if (ctrl && e.key.toUpperCase() === "A") {
        e.preventDefault();
        const lastRow = Math.max(0, fileLineCount - 1);
        const lastCol = buffer.getLine(lastRow).length;
        setSel({ startRow: 0, startCol: 0, endRow: lastRow, endCol: lastCol });
        moveCaret(lastRow, lastCol);
        return;
      }
      if (ctrl && e.key.toUpperCase() === "Z") {
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (!ctrl) clearExtraCursors();
        const newCol = ctrl ? prevWord(cursor.row, cursor.col) : cursor.col - 1;
        if (shift) {
          updateSelection(cursor.row, Math.max(0, newCol));
        } else {
          setSel(null);
        }
        moveCaret(cursor.row, Math.max(0, newCol));
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (!ctrl) clearExtraCursors();
        const newCol = ctrl ? nextWord(cursor.row, cursor.col) : cursor.col + 1;
        if (shift) {
          updateSelection(cursor.row, newCol);
        } else {
          setSel(null);
        }
        moveCaret(cursor.row, newCol);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!ctrl) clearExtraCursors();
        const newRow = cursor.row - 1;
        if (shift) {
          updateSelection(Math.max(0, newRow), cursor.col);
        } else {
          setSel(null);
        }
        moveCaret(newRow, cursor.col);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!ctrl) clearExtraCursors();
        const newRow = cursor.row + 1;
        if (shift) {
          updateSelection(Math.min(fileLineCount - 1, newRow), cursor.col);
        } else {
          setSel(null);
        }
        moveCaret(newRow, cursor.col);
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        if (!ctrl) clearExtraCursors();
        if (shift) {
          updateSelection(cursor.row, 0);
        } else {
          setSel(null);
        }
        moveCaret(cursor.row, 0);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        if (!ctrl) clearExtraCursors();
        const col = buffer.getLine(cursor.row).length;
        if (shift) {
          updateSelection(cursor.row, col);
        } else {
          setSel(null);
        }
        moveCaret(cursor.row, col);
        return;
      }
      if (ctrl && e.key.toUpperCase() === "DELETE") {
        e.preventDefault();
        if (sel) {
          deleteSelection();
        } else {
          const toCol = nextWord(cursor.row, cursor.col);
          setSel({
            startRow: cursor.row,
            startCol: cursor.col,
            endRow: cursor.row,
            endCol: toCol,
          });
          deleteSelection();
        }
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "Delete" || e.key === "Backspace")
      ) {
        e.preventDefault();
        pushUndoSnapshot();
        const isForward = e.key === "Delete";
        if (sel) {
          deleteSelection();
          scheduleAutosave();
          return;
        }
        if (extraCursors.length === 0) {
          const row = cursor.row;
          const col = cursor.col;
          if (isForward) {
            const toCol = nextWord(row, col);
            if (toCol !== col) {
              deleteRange(row, col, toCol);
              moveCaret(row, col);
            }
          } else {
            const fromCol = prevWord(row, col);
            if (fromCol !== col) {
              deleteRange(row, fromCol, col);
              moveCaret(row, fromCol);
            }
          }
          setSel(null);
          scheduleAutosave();
          return;
        }
        const carets = getAllCursors()
          .slice()
          .sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row));
        const byLine: Record<number, Array<number>> = {};
        carets.forEach((c) => {
          byLine[c.row] = byLine[c.row] || [];
          byLine[c.row].push(c.col);
        });
        Object.entries(byLine).forEach(([rowStr, cols]) => {
          const row = parseInt(rowStr, 10);
          cols.sort((a, b) => a - b);
          let line = buffer.getLine(row);
          let offset = 0;
          if (isForward) {
            cols.forEach((col) => {
              const start = col + offset;
              let end = start;
              const n = line.length;
              while (end < n && /\s/.test(line[end])) end++;
              while (end < n && /[A-Za-z0-9_]/.test(line[end])) end++;
              if (end > start) {
                line = line.slice(0, start) + line.slice(end);
                offset -= end - start;
              }
            });
          } else {
            cols.forEach((col) => {
              const end = col + offset;
              let start = end;
              while (start > 0 && /\s/.test(line[start - 1])) start--;
              while (start > 0 && /[A-Za-z0-9_]/.test(line[start - 1])) start--;
              if (start < end) {
                line = line.slice(0, start) + line.slice(end);
                offset -= end - start;
              }
            });
          }
          buffer.setLine(row, line);
          fileHandle.writeLine(row, line);
          setLineVersions((prev) => {
            const m = new Map(prev);
            m.set(row, (m.get(row) ?? 0) + 1);
            return m;
          });
        });
        if (!isForward) {
          setCursor((c) => ({ row: c.row, col: prevWord(c.row, c.col) }));
          setExtraCursors((prev) =>
            prev.map((c) => ({
              row: c.row,
              col: prevWord(c.row, c.col),
            })),
          );
        }
        setSel(null);
        scheduleAutosave();
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        if (!ctrl) clearExtraCursors();
        pushUndoSnapshot();
        if (extraCursors.length === 0) {
          if (sel) {
            deleteSelection();
          } else {
            deleteBackward();
          }
        } else {
          const carets = getAllCursors()
            .slice()
            .sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row));
          const byLine: Record<number, Array<{ col: number }>> = {};
          carets.forEach((c) => {
            byLine[c.row] = byLine[c.row] || [];
            byLine[c.row].push({ col: c.col });
          });
          Object.entries(byLine).forEach(([rowStr, cols]) => {
            const row = parseInt(rowStr, 10);
            cols.sort((a, b) => a.col - b.col);
            let line = buffer.getLine(row);
            let offset = 0;
            cols.forEach(({ col }) => {
              const actual = col + offset;
              if (actual <= 0) return;
              line = line.slice(0, actual - 1) + line.slice(actual);
              offset -= 1;
            });
            buffer.setLine(row, line);
            fileHandle.writeLine(row, line);
            setLineVersions((prev) => {
              const m = new Map(prev);
              m.set(row, (m.get(row) ?? 0) + 1);
              return m;
            });
          });
          const newPrimary = {
            row: cursor.row,
            col: Math.max(0, cursor.col - 1),
          };
          setCursor(newPrimary);
          setExtraCursors((prev) =>
            prev.map((c) =>
              c.col > 0
                ? { row: c.row, col: c.col - 1 }
                : { row: c.row, col: c.col },
            ),
          );
        }
        setSel(null);
        scheduleAutosave();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        pushUndoSnapshot();
        if (extraCursors.length === 0) {
          if (sel) deleteSelection();
          insertNewLine();
        } else {
          const carets = getAllCursors()
            .slice()
            .sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row));
          for (let i = carets.length - 1; i >= 0; i--) {
            const c = carets[i];
            const line = buffer.getLine(c.row);
            const before = line.slice(0, c.col);
            const after = line.slice(c.col);
            buffer.setLine(c.row, before);
            buffer.insertLine(c.row + 1, after);
            fileHandle.writeLine(c.row, before);
            invoke("insert_line", {
              num: c.row + 1,
              content: after,
            }).catch(() => {});
            setLineVersions((prev) => {
              const m = new Map(prev);
              m.set(c.row, (m.get(c.row) ?? 0) + 1);
              m.set(c.row + 1, (m.get(c.row + 1) ?? 0) + 1);
              return m;
            });
            setFileLineCount((cnt) => cnt + 1);
            for (let j = 0; j < i; j++) {
              if (carets[j].row > c.row) carets[j].row += 1;
            }
          }
          setCursor({
            row: cursor.row + 1,
            col: 0,
          });
          setExtraCursors((prev) =>
            prev.map((c) => ({ row: c.row + 1, col: 0 })),
          );
        }
        clearExtraCursors();
        setSel(null);
        scheduleAutosave();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        pushUndoSnapshot();
        const insertion = "  ";
        if (extraCursors.length === 0) {
          if (sel) deleteSelection();
          insertText(insertion);
        } else {
          const carets = getAllCursors()
            .slice()
            .sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row));
          const byLine: Record<number, Array<number>> = {};
          carets.forEach((c) => {
            byLine[c.row] = byLine[c.row] || [];
            byLine[c.row].push(c.col);
          });
          Object.entries(byLine).forEach(([rowStr, cols]) => {
            const row = parseInt(rowStr, 10);
            cols.sort((a, b) => a - b);
            let line = buffer.getLine(row);
            let offset = 0;
            cols.forEach((col) => {
              const actual = col + offset;
              line = line.slice(0, actual) + insertion + line.slice(actual);
              offset += insertion.length;
            });
            buffer.setLine(row, line);
            fileHandle.writeLine(row, line);
            setLineVersions((prev) => {
              const m = new Map(prev);
              m.set(row, (m.get(row) ?? 0) + 1);
              return m;
            });
          });
          const shiftMap: Record<string, number> = {};
          Object.entries(byLine).forEach(([rowStr, cols]) => {
            const row = parseInt(rowStr, 10);
            cols.sort((a, b) => a - b);
            cols.forEach((col, idx) => {
              shiftMap[`${row}:${col}`] = insertion.length * (idx + 1);
            });
          });
          setCursor((c) => ({
            row: c.row,
            col: c.col + insertion.length,
          }));
          setExtraCursors((prev) =>
            prev.map((c) => ({
              row: c.row,
              col: c.col + insertion.length,
            })),
          );
        }
        scheduleAutosave();
        return;
      }
      if (isPrintableKey(e.nativeEvent)) {
        pushUndoSnapshot();
        const ch = e.key;
        if (extraCursors.length === 0) {
          if (sel) deleteSelection();
          insertText(ch);
        } else {
          const carets = getAllCursors()
            .slice()
            .sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row));
          const byLine: Record<number, Array<number>> = {};
          carets.forEach((c) => {
            byLine[c.row] = byLine[c.row] || [];
            byLine[c.row].push(c.col);
          });
          Object.entries(byLine).forEach(([rowStr, cols]) => {
            const row = parseInt(rowStr, 10);
            cols.sort((a, b) => a - b);
            let line = buffer.getLine(row);
            let offset = 0;
            cols.forEach((col) => {
              const actual = col + offset;
              line = line.slice(0, actual) + ch + line.slice(actual);
              offset += ch.length;
            });
            buffer.setLine(row, line);
            fileHandle.writeLine(row, line);
            setLineVersions((prev) => {
              const m = new Map(prev);
              m.set(row, (m.get(row) ?? 0) + 1);
              return m;
            });
          });
          setCursor((c) => ({
            row: c.row,
            col: c.col + ch.length,
          }));
          setExtraCursors((prev) =>
            prev.map((c) => ({ row: c.row, col: c.col + ch.length })),
          );
        }
        setSel(null);
        scheduleAutosave();
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
      sel,
      deleteSelection,
      fileLineCount,
      pushUndoSnapshot,
      undo,
      redo,
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
      if (e.ctrlKey || e.metaKey) {
        addCursor(row, col);
      } else {
        clearExtraCursors();
        setSel(null);
        moveCaret(row, col);
      }
      hiddenInputRef.current?.focus();
    },
    [
      lineHeightPx,
      charWidthPx,
      moveCaret,
      scrollTop,
      addCursor,
      clearExtraCursors,
    ],
  );
  useEffect(() => {
    const handleDocClick = (e: MouseEvent) => {
      if (
        contextMenuRef.current &&
        contextMenuRef.current.contains(e.target as Node)
      ) {
        return;
      }
      setContextMenu(null);
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!dragAnchorRef.current) return;
      if (!containerRef.current) return;
      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const margin = 24;
      let delta = 0;
      if (e.clientY < rect.top + margin) {
        delta = -Math.ceil(rect.top + margin - e.clientY);
      } else if (e.clientY > rect.bottom - margin) {
        delta = Math.ceil(e.clientY - (rect.bottom - margin));
      }
      if (delta !== 0) {
        const maxScroll = container.scrollHeight - container.clientHeight;
        const next = Math.max(
          0,
          Math.min(maxScroll, container.scrollTop + delta),
        );

        if (next !== container.scrollTop) {
          container.scrollTop = next;

          pendingScrollTopRef.current = next;
          if (scrollRafRef.current == null) {
            scrollRafRef.current = requestAnimationFrame(() => {
              scrollRafRef.current = null;
              setScrollTop(pendingScrollTopRef.current);
            });
          }
        }
      }
      const y = e.clientY - rect.top + container.scrollTop;
      const x = e.clientX - rect.left;
      const row = Math.max(
        0,
        Math.min(fileLineCount - 1, Math.floor(y / (lineHeightPx || 1))),
      );
      const xContent = Math.max(0, x - gutterPx);
      const col = Math.floor(xContent / (charWidthPx || 1));
      const anchor = dragAnchorRef.current;
      if (!anchor) return;
      setSel({
        startRow: anchor.row,
        startCol: anchor.col,
        endRow: row,
        endCol: col,
      });
      moveCaret(row, col);
    };
    const handleGlobalMouseUp = () => {
      if (dragAnchorRef.current) {
        suppressNextClickRef.current = true;
        dragAnchorRef.current = null;
      }
    };
    window.addEventListener("mousedown", handleDocClick, true);
    window.addEventListener("keydown", handleEsc);
    window.addEventListener("mousemove", handleGlobalMouseMove, true);
    window.addEventListener("mouseup", handleGlobalMouseUp, true);
    return () => {
      window.removeEventListener("mousedown", handleDocClick, true);
      window.removeEventListener("keydown", handleEsc);
      window.removeEventListener("mousemove", handleGlobalMouseMove, true);
      window.removeEventListener("mouseup", handleGlobalMouseUp, true);
    };
  }, []);
  useLayoutEffect(() => {
    if (caretRef.current) {
      caretRef.current.style.top = cursor.row * lineHeightPx - scrollTop + "px";
      caretRef.current.style.left = cursor.col * charWidthPx + gutterPx + "px";
      caretRef.current.style.height = lineHeightPx + "px";
    }
  }, [cursor, lineHeightPx, charWidthPx, gutterPx, scrollTop]);
  const renderLineTokens = useCallback(
    (lineNumber: number) => {
      const version = lineVersions.get(lineNumber) ?? 0;

      const content = buffer.getLine(lineNumber);

      const tokens = tokenPool.get(lineNumber)?.tokens;

      const cached = renderCacheRef.current.get(lineNumber);

      if (cached && cached.version === version) return cached.node;

      const setCacheAndReturn = (n: JSX.Element) => {
        renderCacheRef.current.set(lineNumber, { version, node: n });
        return n;
      };
      if (!tokens || tokens.length === 0) {
        return setCacheAndReturn(
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
          </div>,
        );
      }

      const MAX_TOKENS_PER_LINE = 800;
      const MAX_COLUMNS_PER_LINE_FOR_TOKENIZED_RENDER = 2000;
      if (
        content.length > MAX_COLUMNS_PER_LINE_FOR_TOKENIZED_RENDER ||
        tokens.length > MAX_TOKENS_PER_LINE
      ) {
        return setCacheAndReturn(
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
          </div>,
        );
      }
      const sorted = [...tokens]
        .sort((a, b) => a.startOffset.col - b.startOffset.col)
        .slice(0, MAX_TOKENS_PER_LINE);

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
      return setCacheAndReturn(
        <div
          data-line={lineNumber}
          className="flex"
          style={{ height: lineHeightPx }}
        >
          {spans}
        </div>,
      );
    },
    [tokenPool, buffer, lineHeightPx, lineVersions],
  );
  return (
    <div
      className="w-full h-full relative overflow-hidden editor-styling"
      onClick={(e) => {
        setContextMenu(null);
        if (suppressNextClickRef.current) {
          suppressNextClickRef.current = false;
          return;
        }
        handleContainerClick(e);
      }}
    >
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-auto"
        onScroll={(e) => {
          setContextMenu(null);

          const st = (e.target as HTMLDivElement).scrollTop;
          pendingScrollTopRef.current = st;
          if (scrollRafRef.current == null) {
            scrollRafRef.current = requestAnimationFrame(() => {
              scrollRafRef.current = null;
              setScrollTop(pendingScrollTopRef.current);
            });
          }
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
              transform: `translateY(${firstVisibleLine * lineHeightPx}px)`,
              willChange: "transform",
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
                  e.stopPropagation();
                  if (e.button !== 0) {
                    return;
                  }
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const xContent = Math.max(0, x - gutterPx);
                  const col = Math.floor(xContent / charWidthPx);
                  if (e.detail === 3) {
                    const len = buffer.getLine(ln).length;
                    clearExtraCursors();
                    dragAnchorRef.current = { row: ln, col: 0 };
                    setSel({
                      startRow: ln,
                      startCol: 0,
                      endRow: ln,
                      endCol: len,
                    });
                    moveCaret(ln, len);
                    hiddenInputRef.current?.focus();
                    return;
                  }
                  if (e.detail === 2) {
                    const lineStr = buffer.getLine(ln);
                    let s = Math.max(0, Math.min(col, lineStr.length));
                    let start = s;
                    while (start > 0 && /\w/.test(lineStr[start - 1])) start--;
                    let end = s;
                    while (end < lineStr.length && /\w/.test(lineStr[end]))
                      end++;
                    clearExtraCursors();
                    dragAnchorRef.current = { row: ln, col: start };
                    setSel({
                      startRow: ln,
                      startCol: start,
                      endRow: ln,
                      endCol: end,
                    });
                    moveCaret(ln, end);
                    hiddenInputRef.current?.focus();
                    return;
                  }
                  if (e.ctrlKey || e.metaKey) {
                    addCursor(ln, col);
                  } else if (e.shiftKey) {
                    const anchor = sel
                      ? { row: sel.startRow, col: sel.startCol }
                      : { row: cursor.row, col: cursor.col };
                    dragAnchorRef.current = { ...anchor };
                    setSel({
                      startRow: anchor.row,
                      startCol: anchor.col,
                      endRow: ln,
                      endCol: col,
                    });
                    moveCaret(ln, col);
                  } else {
                    clearExtraCursors();
                    dragAnchorRef.current = { row: ln, col };
                    setSel({
                      startRow: ln,
                      startCol: col,
                      endRow: ln,
                      endCol: col,
                    });
                    moveCaret(ln, col);
                  }
                  hiddenInputRef.current?.focus();
                }}
                onMouseMove={(e) => {
                  if (e.buttons === 1) {
                    const anchor = dragAnchorRef.current;
                    if (!anchor) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const xContent = Math.max(0, x - gutterPx);
                    const col = Math.floor(xContent / charWidthPx);
                    setSel((_s) => ({
                      startRow: anchor.row,
                      startCol: anchor.col,
                      endRow: ln,
                      endCol: col,
                    }));
                    moveCaret(ln, col);
                  }
                }}
                onMouseUp={(e) => {
                  e.stopPropagation();
                  if (dragAnchorRef.current)
                    suppressNextClickRef.current = true;
                  dragAnchorRef.current = null;
                }}
                onClick={(e) => {
                  e.stopPropagation();
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
          const visStart = firstVisibleLine;
          const visEnd = Math.min(
            fileLineCount - 1,
            firstVisibleLine + visibleLineCount + overscan,
          );
          const fromR = Math.max(startFirst.row, visStart);
          const toR = Math.min(endLast.row, visEnd);
          for (let r = fromR; r <= toR; r++) {
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
      {extraCursors.map((c, i) => (
        <div
          key={"extra-caret-" + i + "-" + c.row + "-" + c.col}
          style={{
            position: "absolute",
            top: c.row * lineHeightPx - scrollTop,
            left: gutterPx + c.col * charWidthPx,
            width: 2,
            height: lineHeightPx,
            background: "var(--text-color)",
            pointerEvents: "none",
          }}
        />
      ))}
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
            pieces.push({
              startOffset: { row: sRow, col: sCol },
              endOffset: { row: sRow, col: BIG },
              type: mappedType,
            });
            for (let r = sRow + 1; r < eRow; r++) {
              pieces.push({
                startOffset: { row: r, col: 0 },
                endOffset: { row: r, col: BIG },
                type: mappedType,
              });
            }
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
