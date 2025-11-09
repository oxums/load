export type autocompleteSuggestion = {
  alreadyTyped: string;
  suggestion: string;
};

export async function generate_suggestions(
  fileContent: string,
  cursorPosition: number,
  line: number,
): Promise<autocompleteSuggestion[]> {
  // Placeholder suggestions
  return [
    { alreadyTyped: "con", suggestion: "sole" },
    { alreadyTyped: "fun", suggestion: "ction" },
    { alreadyTyped: "ret", suggestion: "urn" },
  ];
}

export async function ai_inline_suggest(
  fileContent: string,
  cursorPosition: number,
  line: number,
): Promise<string> {
  // Placeholder inline suggestion
  return "console.log('Hello, world!');";
}
