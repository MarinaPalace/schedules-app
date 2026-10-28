import type { Segment } from "@/db/schema";
import { absenceLabel, type DayKind } from "@/lib/codes";
import { formatHours, formatSegments, paidMinutes, parseSegments } from "@/lib/shifts";

export type TemplateLite = { id: string; code: string; name: string; color: string; segments: Segment[]; paidMinutes: number };

/** What one grid cell displays. */
export type CellView = { kind: DayKind; label: string; color: string | null; paidMinutes: number; title: string };

export const EMPTY_CELL: CellView = { kind: "none", label: "", color: null, paidMinutes: 0, title: "" };

/** Builds the display for a stored schedule/timesheet row. */
export function viewOfEntry(
  e: { kind: string; segments: Segment[]; paidMinutes: number; shiftTemplateId?: string | null; absenceCode: string | null },
  templates: TemplateLite[],
): CellView {
  if (e.kind === "shift") {
    const t = e.shiftTemplateId ? templates.find((x) => x.id === e.shiftTemplateId) : undefined;
    const times = formatSegments(e.segments);
    return {
      kind: "shift",
      // A legend edited later than this entry keeps the entry's own hours, so show "*".
      label: t ? (formatSegments(t.segments) === times ? t.code : `${t.code}*`) : formatHours(e.paidMinutes),
      color: t?.color ?? "#64748b",
      paidMinutes: e.paidMinutes,
      title: `${t ? `${t.code} – ${t.name}: ` : ""}${times} (${formatHours(e.paidMinutes)} h)`,
    };
  }
  if (e.kind === "absence") return { kind: "absence", label: e.absenceCode ?? "?", color: null, paidMinutes: 0, title: absenceLabel(e.absenceCode) };
  if (e.kind === "off") return { kind: "off", label: "–", color: null, paidMinutes: 0, title: "Day off" };
  return EMPTY_CELL;
}

export type ToolLite =
  | { type: "template"; templateId: string }
  | { type: "off" }
  | { type: "none" }
  | { type: "absence"; code: string }
  | { type: "custom"; text: string };

/** Display for a tool applied to a cell (client-side preview before saving). Null if invalid. */
export function viewOfTool(tool: ToolLite, templates: TemplateLite[]): CellView | null {
  switch (tool.type) {
    case "template": {
      const t = templates.find((x) => x.id === tool.templateId);
      if (!t) return null;
      return viewOfEntry({ kind: "shift", segments: t.segments, paidMinutes: t.paidMinutes, shiftTemplateId: t.id, absenceCode: null }, templates);
    }
    case "custom": {
      const segments = parseSegments(tool.text);
      if (!segments) return null;
      return viewOfEntry({ kind: "shift", segments, paidMinutes: paidMinutes(segments), absenceCode: null }, templates);
    }
    case "absence":
      return viewOfEntry({ kind: "absence", segments: [], paidMinutes: 0, absenceCode: tool.code }, templates);
    case "off":
      return viewOfEntry({ kind: "off", segments: [], paidMinutes: 0, absenceCode: null }, templates);
    default:
      return EMPTY_CELL;
  }
}
