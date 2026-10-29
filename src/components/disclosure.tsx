"use client";

import { useState, type ReactNode } from "react";

/**
 * <details> whose `defaultOpen` only sets how it starts: it stays open after a refresh changes
 * the reason (e.g. the first department was just created and its invite panel is showing).
 */
export function Disclosure({ defaultOpen, className, children }: { defaultOpen: boolean; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className={className} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      {children}
    </details>
  );
}
