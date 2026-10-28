import type { Segment } from "@/db/schema";
import type { DayKind, DayLabels } from "@/lib/codes";
import { formatHours, formatSegments, paidMinutes, parseSegments } from "@/lib/shifts";

export type TemplateLite = { id: string; code: string; name: string; color: string; segments: Segment[]; paidMinutes: number };

export type ToolLite =
  | { type: "template"; templateId: string }
  | { type: "off" }
  | { type: "none" }
  | { type: "absence"; code: string }
  | { type: "custom"; text: string };

/** What one grid cell displays; `tool` recreates the value (used for undo and copying). */
export type CellView = { kind: DayKind; label: string; color: string | null; paidMinutes: number; title: string; tool: ToolLite };

export const EMPTY_CELL: CellView = { kind: "none", label: "", color: null, paidMinutes: 0, title: "", tool: { type: "none" } };

/** Builds the display for a stored schedule/timesheet row. */
export function viewOfEntry(
  e: { kind: string; segments: Segment[]; paidMinutes: number; shiftTemplateId?: string | null; absenceCode: string | null },
  templates: TemplateLite[],
  labels: DayLabels,
): CellView {
  if (e.kind === "shift") {
    const t = e.shiftTemplateId ? templates.find((x) => x.id === e.shiftTemplateId) : undefined;
    const times = formatSegments(e.segments);
    const sameAsLegend = !!t && formatSegments(t.segments) === times;
    return {
      kind: "shift",
      // A legend edited later than this entry keeps the entry's own hours, so show "*".
      label: t ? (sameAsLegend ? t.code : `${t.code}*`) : formatHours(e.paidMinutes),
      tool: sameAsLegend ? { type: "template", templateId: t.id } : { type: "custom", text: e.segments.map((s) => `${s.start}-${s.end}`).join(" / ") },
      color: t?.color ?? "#64748b",
      paidMinutes: e.paidMinutes,
      title: `${t ? `${t.code} – ${t.name}: ` : ""}${times} (${formatHours(e.paidMinutes)} ${labels.hourUnit})`,
    };
  }
  if (e.kind === "absence") {
    const code = e.absenceCode ?? "";
    return { kind: "absence", label: code || "?", color: null, paidMinutes: 0, title: labels.absence[code] ?? "", tool: { type: "absence", code } };
  }
  if (e.kind === "off") return { kind: "off", label: "–", color: null, paidMinutes: 0, title: labels.dayOff, tool: { type: "off" } };
  return EMPTY_CELL;
}

/** Display for a tool applied to a cell (client-side preview before saving). Null if invalid. */
export function viewOfTool(tool: ToolLite, templates: TemplateLite[], labels: DayLabels): CellView | null {
  switch (tool.type) {
    case "template": {
      const t = templates.find((x) => x.id === tool.templateId);
      if (!t) return null;
      return viewOfEntry({ kind: "shift", segments: t.segments, paidMinutes: t.paidMinutes, shiftTemplateId: t.id, absenceCode: null }, templates, labels);
    }
    case "custom": {
      const segments = parseSegments(tool.text);
      if (!segments) return null;
      return viewOfEntry({ kind: "shift", segments, paidMinutes: paidMinutes(segments), absenceCode: null }, templates, labels);
    }
    case "absence":
      return viewOfEntry({ kind: "absence", segments: [], paidMinutes: 0, absenceCode: tool.code }, templates, labels);
    case "off":
      return viewOfEntry({ kind: "off", segments: [], paidMinutes: 0, absenceCode: null }, templates, labels);
    default:
      return EMPTY_CELL;
  }
}
