import type { Segment } from "@/db/schema";
import type { DayKind, DayLabels } from "@/lib/codes";
import { formatHours, formatSegments, paidMinutes, parseSegments } from "@/lib/shifts";

export type TemplateLite = { id: string; code: string; name: string; color: string; segments: Segment[]; paidMinutes: number; breakMinutes?: number };

export type ToolLite =
  | { type: "template"; templateId: string }
  | { type: "off" }
  | { type: "none" }
  | { type: "absence"; code: string }
  | { type: "custom"; text: string; breakMinutes?: number };

/**
 * What one grid cell displays; `tool` recreates the value (used for undo and copying).
 * `custom` is set for hours that don't come from a legend: the grid shows an automatic code for them (see customCodes).
 */
export type CellView = { kind: DayKind; label: string; color: string | null; paidMinutes: number; title: string; tool: ToolLite; custom?: string; segments?: Segment[] };

export const EMPTY_CELL: CellView = { kind: "none", label: "", color: null, paidMinutes: 0, title: "", tool: { type: "none" } };

export const CUSTOM_COLOR = "#64748b";

const segmentsText = (segments: Segment[]) => segments.map((s) => `${s.start}-${s.end}`).join(" / ");

/** Same hours + break = same custom code. */
export const customKey = (text: string, breakMinutes = 0) => `${text}|${breakMinutes}`;

/** Builds the display for a stored schedule/timesheet row. */
export function viewOfEntry(
  e: { kind: string; segments: Segment[]; paidMinutes: number; breakMinutes?: number; shiftTemplateId?: string | null; absenceCode: string | null },
  templates: TemplateLite[],
  labels: DayLabels,
): CellView {
  if (e.kind === "shift") {
    const t = e.shiftTemplateId ? templates.find((x) => x.id === e.shiftTemplateId) : undefined;
    const times = formatSegments(e.segments);
    const brk = e.breakMinutes ?? 0;
    const sameAsLegend = !!t && formatSegments(t.segments) === times && (t.breakMinutes ?? brk) === brk;
    const text = segmentsText(e.segments);
    const hours = `${brk ? ` −${brk} ${labels.minuteUnit},` : ""} ${formatHours(e.paidMinutes)} ${labels.hourUnit}`;
    return {
      kind: "shift",
      // A legend edited later than this entry keeps the entry's own hours, so show "*".
      label: t ? (sameAsLegend ? t.code : `${t.code}*`) : formatHours(e.paidMinutes),
      tool: sameAsLegend ? { type: "template", templateId: t.id } : { type: "custom", text, breakMinutes: brk },
      color: t?.color ?? CUSTOM_COLOR,
      paidMinutes: e.paidMinutes,
      title: `${t ? `${t.code} – ${t.name}: ` : ""}${times} (${hours.trim()})`,
      segments: e.segments,
      ...(t ? {} : { custom: customKey(text, brk) }),
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
      return viewOfEntry(
        { kind: "shift", segments: t.segments, paidMinutes: t.paidMinutes, breakMinutes: t.breakMinutes, shiftTemplateId: t.id, absenceCode: null },
        templates,
        labels,
      );
    }
    case "custom": {
      const segments = parseSegments(tool.text);
      const brk = tool.breakMinutes ?? 0;
      const paid = segments ? paidMinutes(segments, brk) : 0;
      if (!segments || paid <= 0) return null;
      return viewOfEntry({ kind: "shift", segments, paidMinutes: paid, breakMinutes: brk, absenceCode: null }, templates, labels);
    }
    case "absence":
      return viewOfEntry({ kind: "absence", segments: [], paidMinutes: 0, absenceCode: tool.code }, templates, labels);
    case "off":
      return viewOfEntry({ kind: "off", segments: [], paidMinutes: 0, absenceCode: null }, templates, labels);
    default:
      return EMPTY_CELL;
  }
}

export type CustomLegendRow = { key: string; code: string; times: string; breakMinutes: number; paidMinutes: number };

/**
 * Automatic codes (e.g. "P1", "P2") for hours entered without a legend, so the grid and the legend can
 * show them like real shifts. Numbered by start time, so the same hours keep the same code on screen and in the PDF.
 */
export function customCodes(cells: Iterable<CellView>, prefix: string): Map<string, CustomLegendRow> {
  const seen = new Map<string, CellView>();
  for (const c of cells) if (c.custom && !seen.has(c.custom)) seen.set(c.custom, c);
  const keys = [...seen.keys()].sort();
  return new Map(
    keys.map((key, i) => {
      const c = seen.get(key)!;
      const [text, brk] = key.split("|");
      return [key, { key, code: `${prefix}${i + 1}`, times: text.replace(/-/g, "–"), breakMinutes: Number(brk) || 0, paidMinutes: c.paidMinutes }];
    }),
  );
}

/** The label to show in a cell, using the automatic code for custom hours. */
export function cellLabel(c: CellView, codes: Map<string, CustomLegendRow>): string {
  return (c.custom && codes.get(c.custom)?.code) || c.label;
}
