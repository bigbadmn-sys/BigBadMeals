/**
 * Best-effort split of a single recipe ingredient line (often from JSON-LD `recipeIngredient`)
 * into structured fields. Unknown shapes fall back to full line as `name`.
 */
export function parseIngredientLine(line: string): { name: string; amount: string; unit: string } {
  const s = line.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return { name: "", amount: "", unit: "" };

  const parenLead = /^\(([^)]+)\)\s+(.+)$/.exec(s);
  if (parenLead) {
    return parseIngredientLine(`${parenLead[1].trim()} ${parenLead[2].trim()}`);
  }

  const fracs: [string, string][] = [
    ["\u00BC", "1/4"],
    ["\u00BD", "1/2"],
    ["\u00BE", "3/4"],
    ["\u2153", "1/3"],
    ["\u2154", "2/3"],
    ["\u215B", "1/8"],
    ["\u215C", "3/8"],
    ["\u215D", "5/8"],
    ["\u215E", "7/8"],
  ];
  let t = s;
  for (const [u, a] of fracs) t = t.split(u).join(a);

  // "2 tablespoons olive oil", "1 pound ground beef", "1/2 teaspoon salt"
  const m = /^([\d./\s-]+)\s+([\w'.°]+(?:\s+[\w'.°]+){0,2})\s+(.+)$/i.exec(t);
  if (m?.[1] && m[2] && m[3]) {
    return { amount: m[1].trim(), unit: m[2].trim(), name: m[3].trim() };
  }

  return { name: t, amount: "", unit: "" };
}
