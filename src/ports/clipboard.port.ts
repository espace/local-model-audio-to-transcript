import { getErrorDefinition } from "../types/application-error";

export interface ClipboardPort {
  writeText(value: string): Promise<void>;
}

export function createClipboardPort(): ClipboardPort {
  return {
    async writeText(value: string): Promise<void> {
      try {
        await navigator.clipboard.writeText(value);
      } catch {
        const def = getErrorDefinition("CLIPBOARD_WRITE_FAILED");
        throw Object.assign(new Error(def.message), def);
      }
    },
  };
}
