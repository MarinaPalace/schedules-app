import "server-only";
import path from "node:path";
import PDFDocument from "pdfkit";
import type { DayKind } from "@/lib/codes";

export type PdfCell = { kind: DayKind; label: string; sub?: string; color: string | null };
export type PdfInput = {
  title: string;
  subtitle: string;
  generated: string;
  days: { top: string; bottom: string; weekend: boolean; today: boolean }[];
  rows: { name: string; position: string | null; cells: PdfCell[]; hours: string; highlight?: boolean }[];
  dayTotals: string[];
  totalHours: string;
  /** Shift legends used in the period: code, name, times and paid hours. */
  legend: { code: string; color: string; name: string; times: string; hours: string }[];
  /** Other symbols: absences, day off, custom hours. */
  symbols: { code: string; text: string; kind: DayKind }[];
  labels: { employee: string; hours: string; total: string; legend: string; page: (n: number, of: number) => string };
};

const FONTS = path.join(process.cwd(), "src", "fonts");
const REGULAR = path.join(FONTS, "PT_Sans-Web-Regular.ttf");
const BOLD = path.join(FONTS, "PT_Sans-Web-Bold.ttf");

const PAGE = { width: 841.89, height: 595.28, margin: 28 };
const GRID = "#c7ccd4";
const MUTED = "#6b7280";
const WEEKEND = "#f1f3f6";
const TODAY = "#e6efff";
const ABSENCE = { fill: "#fdecc8", text: "#8a5a00" };
const OFF = { fill: "#eceef1", text: "#6b7280" };

/** Black or white text, whichever reads better on `hex`. */
function textOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#111827" : "#ffffff";
}

function fillFor(c: PdfCell): { fill: string | null; text: string } {
  if (c.kind === "shift") return { fill: c.color ?? "#64748b", text: textOn(c.color ?? "#64748b") };
  if (c.kind === "absence") return ABSENCE;
  if (c.kind === "off") return OFF;
  return { fill: null, text: MUTED };
}

/** A4 landscape schedule: one row per person, one column per day, legend of hours at the bottom. */
export function renderSchedulePdf(input: PdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: PAGE.margin, bufferPages: true, font: REGULAR, info: { Title: `${input.title} – ${input.subtitle}` } });
  doc.registerFont("R", REGULAR);
  doc.registerFont("B", BOLD);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = PAGE.margin;
  const right = PAGE.width - PAGE.margin;
  const bottom = PAGE.height - PAGE.margin - 14; // room for the page number
  const n = input.days.length;
  const wide = n <= 7; // week: room for the times under the code
  const nameW = wide ? 170 : 128;
  const hoursW = 40;
  const dayW = (right - left - nameW - hoursW) / n;
  const headH = 24;
  const rowH = wide ? 30 : 17;
  const x = (i: number) => left + nameW + i * dayW;

  function header() {
    doc.font("B").fontSize(15).fillColor("#111827").text(input.title, left, PAGE.margin, { lineBreak: false });
    doc.font("R").fontSize(10).fillColor(MUTED).text(input.subtitle, left, PAGE.margin + 19, { lineBreak: false });
    doc.fontSize(8).text(input.generated, left, PAGE.margin + 4, { width: right - left, align: "right", lineBreak: false });
    return PAGE.margin + 40;
  }

  function tableHead(y: number) {
    doc.font("B").fontSize(8).fillColor(MUTED).text(input.labels.employee, left + 3, y + 8, { width: nameW - 6, lineBreak: false });
    input.days.forEach((d, i) => {
      if (d.today || d.weekend) doc.rect(x(i), y, dayW, headH).fill(d.today ? TODAY : WEEKEND);
      doc.font("R").fontSize(6.5).fillColor(MUTED).text(d.top, x(i), y + 3, { width: dayW, align: "center", lineBreak: false });
      doc.font("B").fontSize(8.5).fillColor("#111827").text(d.bottom, x(i), y + 11.5, { width: dayW, align: "center", lineBreak: false });
    });
    doc.font("B").fontSize(8).fillColor(MUTED).text(input.labels.hours, x(n), y + 8, { width: hoursW - 3, align: "right", lineBreak: false });
    doc.moveTo(left, y + headH).lineTo(right, y + headH).lineWidth(0.8).strokeColor("#9ca3af").stroke();
    return y + headH;
  }

  function row(r: PdfInput["rows"][number], y: number) {
    if (r.highlight) doc.rect(left, y, right - left, rowH).fill("#fff8e1");
    input.days.forEach((d, i) => {
      if ((d.weekend || d.today) && !r.highlight) doc.rect(x(i), y, dayW, rowH).fill(d.today ? TODAY : WEEKEND);
    });
    const nameY = wide && r.position ? y + 5 : y + (rowH - 9) / 2;
    doc.font("B").fontSize(8.5).fillColor("#111827").text(r.name, left + 3, nameY, { width: nameW - 6, lineBreak: false, ellipsis: true });
    if (wide && r.position) doc.font("R").fontSize(7).fillColor(MUTED).text(r.position, left + 3, y + 16, { width: nameW - 6, lineBreak: false, ellipsis: true });

    r.cells.forEach((c, i) => {
      const { fill, text } = fillFor(c);
      const pad = 1.5;
      if (fill) doc.roundedRect(x(i) + pad, y + pad, dayW - 2 * pad, rowH - 2 * pad, 2).fill(fill);
      if (!c.label) return;
      const sub = wide && c.sub;
      doc.font("B").fontSize(wide ? 9 : 7.5).fillColor(text);
      doc.text(c.label, x(i) + 1, sub ? y + 5 : y + (rowH - (wide ? 10 : 8.5)) / 2, { width: dayW - 2, align: "center", lineBreak: false, ellipsis: true });
      if (sub) doc.font("R").fontSize(6).fillColor(text).text(c.sub!, x(i) + 1, y + 17, { width: dayW - 2, align: "center", lineBreak: false, ellipsis: true });
    });
    doc.font("B").fontSize(8.5).fillColor("#111827").text(r.hours, x(n), y + (rowH - 9) / 2, { width: hoursW - 3, align: "right", lineBreak: false });
    doc.moveTo(left, y + rowH).lineTo(right, y + rowH).lineWidth(0.4).strokeColor(GRID).stroke();
    return y + rowH;
  }

  function totals(y: number) {
    const h = 16;
    doc.rect(left, y, right - left, h).fill("#f3f4f6");
    doc.font("B").fontSize(8).fillColor("#111827").text(input.labels.total, left + 3, y + 4, { width: nameW - 6, lineBreak: false });
    input.dayTotals.forEach((v, i) => doc.font("R").fontSize(7).fillColor(MUTED).text(v, x(i), y + 4.5, { width: dayW, align: "center", lineBreak: false }));
    doc.font("B").fontSize(8.5).fillColor("#111827").text(input.totalHours, x(n), y + 4, { width: hoursW - 3, align: "right", lineBreak: false });
    return y + h;
  }

  function verticalLines(top: number, end: number) {
    for (let i = 0; i <= n; i++) doc.moveTo(x(i), top).lineTo(x(i), end).lineWidth(0.4).strokeColor(GRID).stroke();
  }

  // Legend: shift boxes in columns, then the other symbols on one wrapped line.
  const colW = 250;
  const perRow = Math.max(1, Math.floor((right - left) / colW));
  const legendRows = Math.ceil(input.legend.length / perRow);
  const legendH = 22 + legendRows * 15 + 18;

  function legend(y: number) {
    doc.font("B").fontSize(10).fillColor("#111827").text(input.labels.legend, left, y, { lineBreak: false });
    y += 15;
    input.legend.forEach((l, i) => {
      const lx = left + (i % perRow) * colW;
      const ly = y + Math.floor(i / perRow) * 15;
      doc.roundedRect(lx, ly, 26, 12, 2).fill(l.color);
      doc.font("B").fontSize(7.5).fillColor(textOn(l.color)).text(l.code, lx, ly + 2.2, { width: 26, align: "center", lineBreak: false });
      const tw = doc.font("B").fontSize(8.5).widthOfString(l.times);
      doc.fillColor("#111827").text(l.times, lx + 31, ly + 1.2, { lineBreak: false });
      doc.font("R").fillColor(MUTED).text(`${l.hours} · ${l.name}`, lx + 35 + tw, ly + 1.2, { width: colW - 44 - tw, lineBreak: false, ellipsis: true });
    });
    y += legendRows * 15 + 4;
    let sx = left;
    for (const s of input.symbols) {
      const { fill, text } = fillFor({ kind: s.kind, label: s.code, color: null });
      const w = Math.max(18, doc.font("B").fontSize(7.5).widthOfString(s.code) + 8);
      const tw = doc.font("R").fontSize(8).widthOfString(s.text);
      if (sx + w + tw + 18 > right) {
        sx = left;
        y += 15;
      }
      if (fill) doc.roundedRect(sx, y, w, 12, 2).fill(fill);
      else doc.roundedRect(sx, y, w, 12, 2).lineWidth(0.6).strokeColor(GRID).stroke();
      doc.font("B").fontSize(7.5).fillColor(text).text(s.code, sx, y + 2.2, { width: w, align: "center", lineBreak: false });
      doc.font("R").fontSize(8).fillColor(MUTED).text(s.text, sx + w + 4, y + 1.6, { lineBreak: false });
      sx += w + tw + 18;
    }
  }

  let y = header();
  let tableTop = y;
  y = tableHead(y);
  input.rows.forEach((r, i) => {
    // Keep the totals row with the last person.
    const need = rowH + (i === input.rows.length - 1 ? 16 : 0);
    if (y + need > bottom) {
      verticalLines(tableTop, y);
      doc.addPage();
      y = header();
      tableTop = y;
      y = tableHead(y);
    }
    y = row(r, y);
  });
  if (y + 16 > bottom) {
    verticalLines(tableTop, y);
    doc.addPage();
    y = header();
    tableTop = y;
    y = tableHead(y);
  }
  y = totals(y);
  verticalLines(tableTop, y);

  y += 14;
  if (y + legendH > bottom) {
    doc.addPage();
    y = header();
  }
  legend(y);

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // writing inside the margin must not start a new page
    doc.font("R").fontSize(7.5).fillColor(MUTED).text(input.labels.page(i + 1, range.count), left, PAGE.height - PAGE.margin - 8, {
      width: right - left,
      align: "right",
      lineBreak: false,
    });
  }
  doc.end();
  return done;
}
