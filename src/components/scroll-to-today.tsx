"use client";

import { useEffect, useRef } from "react";

/** Wraps a wide table and scrolls it sideways so the column marked `data-today` is in view (phones). */
export function ScrollToToday({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current;
    const cell = box?.querySelector<HTMLElement>("[data-today]");
    if (!box || !cell) return;
    // Keep the sticky name column in mind: put today a little right of it.
    const sticky = box.querySelector<HTMLElement>("th")?.offsetWidth ?? 0;
    box.scrollLeft = Math.max(0, cell.offsetLeft - sticky - cell.offsetWidth);
  }, []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
