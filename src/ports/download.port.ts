import { getErrorDefinition } from "../types/application-error";

export interface DownloadPort {
  downloadMarkdown(input: { markdown: string; sourceFileName: string }): void;
}

function safeFilename(sourceFileName: string): string {
  const stem = sourceFileName.replace(/\.[^.]+$/, "");

  let safe = stem.replace(/[/?<>:"*|\\]/g, "-");

  safe = safe.replace(/-+/g, "-");

  safe = safe.replace(/[. ]+$/, "");

  if (safe.length === 0) {
    return "transcript.md";
  }

  return `${safe}.md`;
}

export function createDownloadPort(): DownloadPort {
  return {
    downloadMarkdown(input: { markdown: string; sourceFileName: string }): void {
      try {
        const blob = new Blob([input.markdown], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);

        try {
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = safeFilename(input.sourceFileName);
          anchor.click();
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch {
        const def = getErrorDefinition("DOWNLOAD_FAILED");
        throw Object.assign(new Error(def.message), def);
      }
    },
  };
}
