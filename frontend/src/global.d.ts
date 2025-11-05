import type { ElectronDiagnosticsEvent } from "./types/electron";

declare global {
  interface Window {
    longqDiagnostics?: {
      subscribe: (handler: (event: ElectronDiagnosticsEvent) => void) => (() => void) | void;
      getHistory?: () => Promise<ElectronDiagnosticsEvent[]>;
    };
  }
}

export {};
