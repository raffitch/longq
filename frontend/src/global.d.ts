import type { ElectronDiagnosticsEvent } from "./types/electron";

declare global {
  interface Window {
    longqDiagnostics?: {
      subscribe: (handler: (event: ElectronDiagnosticsEvent) => void) => (() => void) | void;
      getHistory?: () => Promise<ElectronDiagnosticsEvent[]>;
    };
    longqLicense?: {
      onManageRequest?: (handler: () => void) => (() => void) | void;
      openPath?: (targetPath: string) => Promise<{ ok: boolean; error?: string }>;
      openDirectory?: (targetPath: string) => Promise<{ ok: boolean; error?: string }>;
      notifyActivated?: () => void;
    };
  }
}

export {};
