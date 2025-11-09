import { invoke } from "@tauri-apps/api/core";

export type autocompleteSuggestion = {
  alreadyTyped: string;
  suggestion: string;
};

export async function generate_suggestions(
  fileContent: string,
  cursorPosition: number,
  line: number,
  finename: string,
): Promise<autocompleteSuggestion[]> {  
  const ext = finename.split(".").pop()?.toLowerCase() || "";
  let keywords: string[] = [];
  
  console.log(`Generating suggestions for extension: ${ext}`);

  switch (ext) {
    case "js":
    case "jsx":
    case "ts":
    case "tsx":
      keywords = [
        "function",
        "const",
        "let",
        "var",
        "if",
        "else",
        "for",
        "while",
        "switch",
        "case",
        "break",
        "continue",
        "return",
        "import",
        "export",
        "from",
        "class",
        "extends",
        "constructor",
        "super",
        "this",
        "new",
        "try",
        "catch",
        "finally",
        "throw",
        "async",
        "await",
        "interface",
        "type",
        "enum",
        "public",
        "private",
        "protected",
        "static",
        "get",
        "set",
      ];
      break;
    case "py":
      keywords = [
        "def",
        "class",
        "import",
        "from",
        "as",
        "if",
        "elif",
        "else",
        "for",
        "while",
        "break",
        "continue",
        "return",
        "try",
        "except",
        "finally",
        "with",
        "lambda",
        "pass",
        "yield",
        "global",
        "nonlocal",
        "assert",
        "raise",
        "del",
        "in",
        "is",
        "not",
        "and",
        "or",
      ];
      break;
    case "go":
      keywords = [
        "func",
        "package",
        "import",
        "var",
        "const",
        "type",
        "struct",
        "interface",
        "if",
        "else",
        "for",
        "range",
        "switch",
        "case",
        "break",
        "continue",
        "return",
        "go",
        "defer",
        "select",
        "map",
        "chan",
        "fallthrough",
        "default",
      ];
      break;
    case "rs":
      keywords = [
        "fn",
        "let",
        "mut",
        "const",
        "static",
        "struct",
        "enum",
        "impl",
        "trait",
        "for",
        "in",
        "if",
        "else",
        "match",
        "while",
        "loop",
        "break",
        "continue",
        "return",
        "pub",
        "use",
        "mod",
        "crate",
        "super",
        "self",
        "ref",
        "as",
        "move",
        "unsafe",
        "async",
        "await",
        "dyn",
        "where",
      ];
      break;
    case "c":
    case "h":
      keywords = [
        "int",
        "float",
        "double",
        "char",
        "void",
        "struct",
        "union",
        "enum",
        "typedef",
        "if",
        "else",
        "for",
        "while",
        "do",
        "switch",
        "case",
        "break",
        "continue",
        "return",
        "goto",
        "const",
        "static",
        "extern",
        "volatile",
        "register",
        "sizeof",
        "unsigned",
        "signed",
        "short",
        "long",
        "#include",
        "#define",
        "#ifdef",
        "#ifndef",
        "#endif",
      ];
      break;
    case "cpp":
    case "cc":
    case "cxx":
    case "hpp":
    case "hxx":
      keywords = [
        "int",
        "float",
        "double",
        "char",
        "void",
        "struct",
        "union",
        "enum",
        "typedef",
        "if",
        "else",
        "for",
        "while",
        "do",
        "switch",
        "case",
        "break",
        "continue",
        "return",
        "goto",
        "const",
        "static",
        "extern",
        "volatile",
        "register",
        "sizeof",
        "unsigned",
        "signed",
        "short",
        "long",
        "namespace",
        "class",
        "public",
        "private",
        "protected",
        "virtual",
        "override",
        "template",
        "typename",
        "using",
        "new",
        "delete",
        "this",
        "operator",
        "friend",
        "inline",
        "constexpr",
        "nullptr",
        "throw",
        "catch",
        "try",
        "#include",
        "#define",
        "#ifdef",
        "#ifndef",
        "#endif",
      ];
      break;
    default:
      keywords = [];
  }

  const lines = fileContent.split("\n");
  const currentLine = lines[line] || "";

  const cursorIdxInLine = cursorPosition - (fileContent.lastIndexOf("\n", cursorPosition - 1) + 1);
  let startIdx = cursorIdxInLine;
  while (
    startIdx > 0 &&
    /[a-zA-Z0-9_]/.test(currentLine[startIdx - 1])
  ) {
    startIdx--;
  }
  const alreadyTyped = currentLine.slice(startIdx, cursorIdxInLine);

  const suggestions = keywords
    .filter((word) => word.startsWith(alreadyTyped) && alreadyTyped.length > 0)
    .map((word) => ({
      alreadyTyped,
      suggestion: word.slice(alreadyTyped.length),
    }));
  
  const filteredSuggestions = suggestions.filter(s => s.suggestion.length > 0);

  return filteredSuggestions;
}

export async function ai_inline_suggest(
  fileContent: string,
  cursorPosition: number,
  line: number,
): Promise<string> {
  return "";
}
