import { parseIngredientLine } from "./parseIngredientLine.js";

export type StructuredIngredient = { name: string; amount: string; unit: string };

export type StructuredRecipeFromPage = {
  title?: string;
  description?: string;
  /** Raw `recipeIngredient` strings from JSON-LD (best for LLM grounding). */
  ingredientLines: string[];
  ingredients: StructuredIngredient[];
  instructions: string[];
};

function isRecipeType(t: unknown): boolean {
  const types = ([] as string[]).concat(t as string | string[]).flat().filter(Boolean);
  return types.some((x) => /recipe/i.test(String(x)));
}

function collectRecipeObjects(node: unknown, out: Record<string, unknown>[]): void {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const x of node) collectRecipeObjects(x, out);
    return;
  }
  if (typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  if (Array.isArray(o["@graph"])) collectRecipeObjects(o["@graph"], out);
  if (isRecipeType(o["@type"])) out.push(o);
}

function ingredientScore(o: Record<string, unknown>): number {
  const ri = o.recipeIngredient;
  if (Array.isArray(ri)) return ri.filter((x) => typeof x === "string" && x.trim()).length;
  if (typeof ri === "string" && ri.trim()) return 1;
  return 0;
}

function normalizeIngredientStrings(raw: unknown): string[] {
  if (raw == null) return [];
  if (typeof raw === "string") return raw.trim() ? [raw.trim()] : [];
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x === "string" && x.trim()) out.push(x.trim());
  }
  return out;
}

function flattenInstructions(raw: unknown): string[] {
  if (raw == null) return [];
  if (typeof raw === "string") {
    const t = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!t) return [];
    return t.split(/\n|(?:\d+\.\s+)/).map((s) => s.trim()).filter(Boolean);
  }
  if (!Array.isArray(raw)) return [];
  const steps: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      if (item.trim()) steps.push(item.trim());
    } else if (item && typeof item === "object") {
      const it = item as Record<string, unknown>;
      const tx = it.text;
      if (typeof tx === "string" && tx.trim()) steps.push(tx.trim());
      else if (typeof it.name === "string" && it.name.trim()) steps.push(it.name.trim());
    }
  }
  return steps;
}

/**
 * Reads schema.org Recipe JSON-LD from HTML. Many food blogs (Yoast, WP Recipe Maker, etc.)
 * publish authoritative `recipeIngredient` strings here — use them to avoid model hallucination.
 */
export function extractStructuredRecipeFromHtml(html: string): StructuredRecipeFromPage | null {
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const recipes: Record<string, unknown>[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      const data = JSON.parse(raw) as unknown;
      collectRecipeObjects(data, recipes);
    } catch {
      // skip invalid block
    }
  }
  if (recipes.length === 0) return null;

  recipes.sort((a, b) => ingredientScore(b) - ingredientScore(a));
  const best = recipes[0];
  if (!best) return null;

  const lines = normalizeIngredientStrings(best.recipeIngredient);
  const ingredients = lines.map(parseIngredientLine).filter((i) => i.name || i.amount || i.unit);

  const title = typeof best.name === "string" ? best.name.trim() : undefined;
  const description = typeof best.description === "string" ? best.description.replace(/<[^>]+>/g, " ").trim() : undefined;
  const instructions = flattenInstructions(best.recipeInstructions);

  if (lines.length === 0 && !title && instructions.length === 0) return null;

  return { title, description, ingredientLines: lines, ingredients, instructions };
}
