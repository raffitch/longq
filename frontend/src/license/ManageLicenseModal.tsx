import React from "react";

import { Button } from "../ui/Button";
import { ActivationPanel } from "./ActivationView";

type ManageLicenseModalProps = {
  onClose: () => void;
};

export function ManageLicenseModal({ onClose }: ManageLicenseModalProps) {
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/65 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[720px] overflow-hidden rounded-3xl border border-border bg-surface shadow-surface-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border bg-surface-subtle px-6 py-4">
          <div>
            <div className="text-[16px] font-semibold text-text-primary">Manage License</div>
            <div className="text-[11px] uppercase tracking-[0.3em] text-text-secondary/80">
              Quantum Qi™ Operator
            </div>
          </div>
          <Button variant="secondary" size="sm" className="px-3" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="max-h-[80vh] overflow-y-auto bg-logo-background px-6 py-6">
          <ActivationPanel initialMode="refresh" onClose={onClose} />
        </div>
      </div>
    </div>
  );
}
