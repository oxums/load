/**
 * Placeholder icon registry for Load Editor.
 * You will later replace the `svg` strings with the real SVG markup.
 *
 * Conventions:
 * - Key names are lowercase.
 * - Extensions (without leading dot) map directly (e.g. "ts", "rs").
 * - Special keys: `folder`, `file`, `image`, `archive`, `binary`, `config`, `unknown`.
 */

export interface IconEntry {
  key: string;
  svg: string;          // Raw SVG markup (no surrounding quotes if you replace)
  description?: string; // Optional human readable label
  colorHint?: string;   // Optional suggested foreground color
}

type IconMap = Record<string, IconEntry>;

const PLACEHOLDER_SVG = (label: string) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="2" width="14" height="12" rx="2" ry="2" fill="currentColor" opacity="0.15"/>
    <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-family="monospace" font-size="6" fill="currentColor">${label.slice(0,3).toUpperCase()}</text>
  </svg>`;

/**
 * Base registry. Replace `svg` values with the final artwork as needed.
 */
export const ICONS: IconMap = {
  folder: { key: "folder", svg: PLACEHOLDER_SVG("dir"), description: "Folder", colorHint: "#cfa043" },
  file: { key: "file", svg: PLACEHOLDER_SVG("file"), description: "File", colorHint: "#8893a2" },
  unknown: { key: "unknown", svg: PLACEHOLDER_SVG("?"), description: "Unknown", colorHint: "#666" },

  // Common code / markup
  ts: { key: "ts", svg: PLACEHOLDER_SVG("ts"), description: "TypeScript", colorHint: "#3178c6" },
  tsx: { key: "tsx", svg: PLACEHOLDER_SVG("tsx"), description: "TSX", colorHint: "#3178c6" },
  js: { key: "js", svg: PLACEHOLDER_SVG("js"), description: "JavaScript", colorHint: "#f7df1e" },
  jsx: { key: "jsx", svg: PLACEHOLDER_SVG("jsx"), description: "JSX", colorHint: "#f7df1e" },
  json: { key: "json", svg: PLACEHOLDER_SVG("json"), description: "JSON", colorHint: "#cb3837" },
  css: { key: "css", svg: PLACEHOLDER_SVG("css"), description: "CSS", colorHint: "#563d7c" },
  html: { key: "html", svg: PLACEHOLDER_SVG("html"), description: "HTML", colorHint: "#e34c26" },
  md: { key: "md", svg: PLACEHOLDER_SVG("md"), description: "Markdown", colorHint: "#4f4f4f" },

  // Systems & compiled
  rs: { key: "rs", svg: PLACEHOLDER_SVG("rs"), description: "Rust", colorHint: "#dea584" },
  go: { key: "go", svg: PLACEHOLDER_SVG("go"), description: "Go", colorHint: "#00acd7" },
  c: { key: "c", svg: PLACEHOLDER_SVG("c"), description: "C", colorHint: "#555" },
  cpp: { key: "cpp", svg: PLACEHOLDER_SVG("cpp"), description: "C++", colorHint: "#004482" },
  h: { key: "h", svg: PLACEHOLDER_SVG("h"), description: "C/C++ Header", colorHint: "#6a6a6a" },
  hpp: { key: "hpp", svg: PLACEHOLDER_SVG("hpp"), description: "C++ Header", colorHint: "#6a6a6a" },
  swift: { key: "swift", svg: PLACEHOLDER_SVG("swf"), description: "Swift", colorHint: "#ffac45" },
  zig: { key: "zig", svg: PLACEHOLDER_SVG("zig"), description: "Zig", colorHint: "#f7a41d" },

  // Other languages
  py: { key: "py", svg: PLACEHOLDER_SVG("py"), description: "Python", colorHint: "#3670a0" },
  java: { key: "java", svg: PLACEHOLDER_SVG("jv"), description: "Java", colorHint: "#e76f00" },
  kt: { key: "kt", svg: PLACEHOLDER_SVG("kt"), description: "Kotlin", colorHint: "#a97bff" },
  dart: { key: "dart", svg: PLACEHOLDER_SVG("drt"), description: "Dart", colorHint: "#055393" },
  php: { key: "php", svg: PLACEHOLDER_SVG("php"), description: "PHP", colorHint: "#777bb3" },
  lua: { key: "lua", svg: PLACEHOLDER_SVG("lua"), description: "Lua", colorHint: "#000080" },
  rb: { key: "rb", svg: PLACEHOLDER_SVG("rb"), description: "Ruby", colorHint: "#cc342d" },
  hs: { key: "hs", svg: PLACEHOLDER_SVG("hs"), description: "Haskell", colorHint: "#5e5086" },
  ml: { key: "ml", svg: PLACEHOLDER_SVG("ml"), description: "OCaml", colorHint: "#ef7a08" },
  mli: { key: "mli", svg: PLACEHOLDER_SVG("mli"), description: "OCaml Interface", colorHint: "#ef7a08" },

  // Shell / scripts
  sh: { key: "sh", svg: PLACEHOLDER_SVG("sh"), description: "Shell", colorHint: "#4eaa25" },
  bash: { key: "bash", svg: PLACEHOLDER_SVG("bsh"), description: "Bash", colorHint: "#4eaa25" },
  ps1: { key: "ps1", svg: PLACEHOLDER_SVG("ps"), description: "PowerShell", colorHint: "#0273d4" },

  // Data / misc
  sql: { key: "sql", svg: PLACEHOLDER_SVG("sql"), description: "SQL", colorHint: "#00758f" },
  yml: { key: "yml", svg: PLACEHOLDER_SVG("yml"), description: "YAML", colorHint: "#cb5832" },
  yaml: { key: "yaml", svg: PLACEHOLDER_SVG("yml"), description: "YAML", colorHint: "#cb5832" },
  toml: { key: "toml", svg: PLACEHOLDER_SVG("tml"), description: "TOML", colorHint: "#9c4221" },
  lock: { key: "lock", svg: PLACEHOLDER_SVG("lck"), description: "Lock File", colorHint: "#444" },

  // Asset types
  png: { key: "png", svg: PLACEHOLDER_SVG("img"), description: "Image", colorHint: "#999" },
  jpg: { key: "jpg", svg: PLACEHOLDER_SVG("img"), description: "Image", colorHint: "#999" },
  jpeg: { key: "jpeg", svg: PLACEHOLDER_SVG("img"), description: "Image", colorHint: "#999" },
  gif: { key: "gif", svg: PLACEHOLDER_SVG("img"), description: "Image", colorHint: "#999" },
  svg: { key: "svg", svg: PLACEHOLDER_SVG("svg"), description: "Vector", colorHint: "#999" },
  ico: { key: "ico", svg: PLACEHOLDER_SVG("ico"), description: "Icon", colorHint: "#999" },
  webp: { key: "webp", svg: PLACEHOLDER_SVG("img"), description: "Image", colorHint: "#999" },

  // Archives / binaries
  zip: { key: "zip", svg: PLACEHOLDER_SVG("zip"), description: "Archive", colorHint: "#666" },
  tar: { key: "tar", svg: PLACEHOLDER_SVG("tar"), description: "Archive", colorHint: "#666" },
  gz: { key: "gz", svg: PLACEHOLDER_SVG("gz"), description: "Archive", colorHint: "#666" },
  exe: { key: "exe", svg: PLACEHOLDER_SVG("bin"), description: "Binary", colorHint: "#444" },
  bin: { key: "bin", svg: PLACEHOLDER_SVG("bin"), description: "Binary", colorHint: "#444" },

  // Config-ish
  env: { key: "env", svg: PLACEHOLDER_SVG("env"), description: "Environment", colorHint: "#6d9e6d" },
  editorconfig: { key: "editorconfig", svg: PLACEHOLDER_SVG("cfg"), description: "Editor Config", colorHint: "#6d6d9e" },
  gitignore: { key: "gitignore", svg: PLACEHOLDER_SVG("git"), description: ".gitignore", colorHint: "#f14e32" },
};

/**
 * Resolve the logical icon key for a given file.
 */
export function getIconKey(fileName: string, isDir: boolean): string {
  if (isDir) return "folder";
  const lower = fileName.toLowerCase();
  // Direct name matches (no extension)
  if (ICONS[lower]) return lower;

  const lastDot = lower.lastIndexOf(".");
  if (lastDot === -1) return "file";
  const ext = lower.slice(lastDot + 1);
  if (ICONS[ext]) return ext;
  return "unknown";
}

/**
 * Get the icon entry (never null; falls back to unknown).
 */
export function getIconEntry(fileName: string, isDir: boolean): IconEntry {
  const key = getIconKey(fileName, isDir);
  return ICONS[key] || ICONS.unknown;
}

/**
 * Convenience to get raw SVG markup.
 */
export function getIconSvg(fileName: string, isDir: boolean): string {
  return getIconEntry(fileName, isDir).svg;
}

/**
 * Allow runtime registration / override (e.g. user themes).
 */
export function registerIcon(key: string, entry: Partial<IconEntry>) {
  const normalized = key.toLowerCase();
  const existing = ICONS[normalized] || { key: normalized, svg: PLACEHOLDER_SVG(normalized) };
  ICONS[normalized] = {
    ...existing,
    ...entry,
    key: normalized,
    svg: entry.svg ?? existing.svg ?? PLACEHOLDER_SVG(normalized),
  };
}

/**
 * Replace multiple icons at once.
 */
export function bulkRegister(icons: Record<string, Partial<IconEntry>>) {
  for (const k of Object.keys(icons)) {
    registerIcon(k, icons[k]);
  }
}
