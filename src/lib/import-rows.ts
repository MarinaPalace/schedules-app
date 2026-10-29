// Rows pasted from Excel for the staff import (pure – used in the browser and in tests).
export const IMPORT_COLUMNS = ["firstName", "lastName", "phone", "email", "position", "place", "pay"] as const;
export type ImportRow = { firstName: string; lastName: string; phone?: string; email?: string; position?: string; place?: string; pay?: string };

/** Tab (Excel copy), semicolon or comma separated; a first row with column names is skipped. */
export function parseRows(text: string): ImportRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = lines.map((l) => (l.includes("\t") ? l.split("\t") : l.includes(";") ? l.split(";") : l.split(",")).map((c) => c.trim()));
  if (rows[0] && /^(име|first|name|имя|собствено)/i.test(rows[0][0] ?? "")) rows.shift();
  return rows.map((c) => Object.fromEntries(IMPORT_COLUMNS.map((k, i) => [k, c[i] ?? ""])) as ImportRow);
}
