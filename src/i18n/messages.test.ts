import { describe, expect, it } from "vitest";
import bg from "../../messages/bg.json";
import en from "../../messages/en.json";
import ru from "../../messages/ru.json";

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return typeof v === "string" ? { ...acc, [key]: v } : { ...acc, ...flatten(v, key) };
  }, {});
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("translations", () => {
  const base = flatten(en);
  for (const [name, messages] of Object.entries({ bg, ru })) {
    const flat = flatten(messages);
    it(`${name} has exactly the English keys`, () => {
      expect(Object.keys(flat).sort()).toEqual(Object.keys(base).sort());
    });
    it(`${name} uses the same {placeholders}`, () => {
      for (const key of Object.keys(base)) expect(placeholders(flat[key] ?? ""), key).toEqual(placeholders(base[key]));
    });
  }
});
