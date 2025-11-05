export type ElectronDiagnosticsEvent = {
  id: string;
  type: "backend-crash" | "backend-error";
  message: string;
  timestamp: string;
  logTail?: string;
  code?: number | null;
  signal?: string | null;
};
