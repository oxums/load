type TokenOffset = {
  col: number;
  row: number;
}

interface LoadFileHandle {
  readLine(num: number): string;
  writeLine(line: string): void;
  close(): void;
  reciveUpdate(callback: (line: number, content: string) => void): void;
  metadata: {
    name: string;
    path: string;
    size: number;
    language: string;
  };
  requestTokenization(lineStart: number, lineEnd: number): void;
  recieveTokenization(
    callback: (
      tokens: Array<{ startOffset: TokenOffset; endOffset: TokenOffset; type: string }>,
    ) => void,
  ): void;
  saveBuffer(): void;
  changeLanguage(language: string): void;
}

export function Editor({ fileHandle }: { fileHandle: LoadFileHandle }) {
  return <></>;
}
