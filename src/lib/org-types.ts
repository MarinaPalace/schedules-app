/** A role in a department (Waiter…) and a place (Restaurant 1, code "R1"), as sent to the browser. */
export type RoleLite = { id: string; name: string };
export type LocationLite = { id: string; name: string; code: string };

/** Short tag for a role, e.g. "Assistant manager" → "AM". */
export function roleTag(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.map((w) => w[0]).join("") : name.slice(0, 3)).toUpperCase().slice(0, 3);
}
