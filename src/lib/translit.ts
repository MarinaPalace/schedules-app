// Cyrillic → Latin for usernames (Bulgarian official system, plus Russian letters).
const MAP: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sht",
  ъ: "a", ь: "y", ю: "yu", я: "ya", ы: "y", э: "e", ё: "yo",
};

export function transliterate(text: string): string {
  return [...text.toLowerCase()].map((ch) => MAP[ch] ?? ch).join("");
}

/** "Иван", "Петров" → "ivan.petrov" (only a–z, 0–9, dot, dash). */
export function suggestUsername(first: string, last: string): string {
  const part = (s: string) => transliterate(s.trim()).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return [part(first), part(last)].filter(Boolean).join(".").slice(0, 40);
}

/** First free name: ivan.petrov, ivan.petrov2, ivan.petrov3… */
export function uniqueUsername(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
}
