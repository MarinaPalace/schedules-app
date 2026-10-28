"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { CellView, TemplateLite, ToolLite } from "@/lib/cell-view";
import { ABSENCE_CODES, type DayLabels } from "@/lib/codes";
import { formatHours, formatSegments, parseSegments } from "@/lib/shifts";

type Props = {
  title: string;
  subtitle: string;
  current: CellView;
  templates: TemplateLite[];
  labels: DayLabels;
  historyHref?: string;
  onPick: (tool: ToolLite) => void;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
};

/**
 * Big-button shift chooser. Bottom sheet on phones, dialog on larger screens.
 * Picking a value saves it; the parent then moves on to the next person/day.
 */
export function ShiftPicker({ title, subtitle, current, templates, labels, historyHref, onPick, onPrev, onNext, onClose }: Props) {
  const t = useTranslations();
  const [custom, setCustom] = useState(current.tool.type === "custom" ? current.tool.text : "");
  const customOk = custom.trim() !== "" && parseSegments(custom) !== null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const selected = (tool: ToolLite) => JSON.stringify(tool) === JSON.stringify(current.tool);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="absolute inset-0 bg-black/40" aria-label={t("common.close")} onClick={onClose} />
      <div className="relative flex max-h-[88vh] w-full flex-col rounded-t-2xl bg-surface shadow-xl md:max-w-lg md:rounded-2xl">
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-gray-300 md:hidden" />
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 pt-2 pb-3">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">{title}</div>
            <div className="text-sm text-gray-500">{subtitle}</div>
          </div>
          <button type="button" onClick={onClose} className="btn btn-sm shrink-0" aria-label={t("common.close")}>
            ✕
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-4 py-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {templates.map((tpl) => {
              const tool: ToolLite = { type: "template", templateId: tpl.id };
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => onPick(tool)}
                  className={`flex min-h-16 flex-col items-start justify-center rounded-xl px-3 py-2 text-left text-white shadow-sm active:scale-[0.98] ${
                    selected(tool) ? "ring-4 ring-blue-400 ring-offset-2 ring-offset-surface" : ""
                  }`}
                  style={{ background: tpl.color }}
                >
                  <span className="text-lg leading-tight font-bold">
                    {tpl.code} <span className="text-sm font-medium opacity-90">{tpl.name}</span>
                  </span>
                  <span className="text-xs opacity-90">
                    {formatSegments(tpl.segments)} · {formatHours(tpl.paidMinutes)} {labels.hourUnit}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <PlainButton active={selected({ type: "off" })} onClick={() => onPick({ type: "off" })}>
              <span className="text-lg font-bold">–</span>
              <span className="text-xs">{labels.dayOff}</span>
            </PlainButton>
            {ABSENCE_CODES.map((code) => (
              <PlainButton key={code} active={selected({ type: "absence", code })} onClick={() => onPick({ type: "absence", code })} tone="amber">
                <span className="text-lg font-bold">{code}</span>
                <span className="text-xs leading-tight">{labels.absence[code]}</span>
              </PlainButton>
            ))}
            <PlainButton active={current.kind === "none"} onClick={() => onPick({ type: "none" })}>
              <span className="text-lg font-bold">∅</span>
              <span className="text-xs">{t("schedule.clear")}</span>
            </PlainButton>
          </div>

          <div>
            <label className="label" htmlFor="custom-hours">
              {t("schedule.customHours")}
            </label>
            <div className="flex gap-2">
              <input
                id="custom-hours"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                className="input font-mono"
                placeholder="08:00-12:00 / 17:00-21:00"
                inputMode="text"
              />
              <button type="button" className="btn btn-primary shrink-0" disabled={!customOk} onClick={() => onPick({ type: "custom", text: custom })}>
                {t("schedule.apply")}
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-gray-200 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button type="button" className="btn" disabled={!onPrev} onClick={onPrev}>
            ← {t("common.previous")}
          </button>
          {historyHref && (
            <Link href={historyHref} className="mx-auto text-sm text-blue-700 hover:underline">
              {t("schedule.history")}
            </Link>
          )}
          <button type="button" className="btn ml-auto" disabled={!onNext} onClick={onNext}>
            {t("common.next")} →
          </button>
        </div>
      </div>
    </div>
  );
}

function PlainButton({ active, onClick, children, tone }: { active: boolean; onClick: () => void; children: React.ReactNode; tone?: "amber" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-16 flex-col items-center justify-center rounded-xl border px-2 py-2 text-center active:scale-[0.98] ${
        tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-gray-300 bg-surface text-gray-800"
      } ${active ? "ring-4 ring-blue-400 ring-offset-2 ring-offset-surface" : ""}`}
    >
      {children}
    </button>
  );
}
