import type { CleanIngredient, GroceryCategory, Ingredient, Recipe, RecipeTag } from '../types';

function safeTrim(s: unknown): string {
  return typeof s === 'string' ? s.trim() : '';
}

function normalizeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\u00ae\u2122]/g, '') // ® ™
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function categorizeIngredient(rawName: string): GroceryCategory {
  const n = normalizeKey(rawName);

  // beverages
  if (/(beer|wine|vodka|gin|rum|tequila|whiskey|bourbon|champagne|soda|sparkling water|seltzer|juice|coffee|tea)/.test(n)) {
    return 'Beverages';
  }

  // produce
  if (
    /(apple|banana|berries|strawberry|blueberry|raspberry|orange|lemon|lime|grapefruit|avocado|tomato|onion|garlic|ginger|lettuce|spinach|kale|arugula|cabbage|carrot|celery|pepper|jalapeño|jalapeno|mushroom|cucumber|potato|sweet potato|broccoli|cauliflower|zucchini|corn|herb|cilantro|parsley|basil|mint|dill)/.test(
      n
    )
  ) {
    return 'Produce';
  }

  // meat & seafood
  if (/(chicken|turkey|beef|pork|bacon|sausage|ham|lamb|salmon|tuna|shrimp|prawn|crab|lobster|fish|cod)/.test(n)) {
    return 'Meat & Seafood';
  }

  // dairy & eggs
  if (/(milk|cream|half and half|butter|cheese|yogurt|egg|eggs|sour cream|creme fraiche)/.test(n)) {
    return 'Dairy & Eggs';
  }

  // bakery
  if (/(bread|bun|roll|tortilla|bagel|pita|naan|croissant|breadcrumbs)/.test(n)) {
    return 'Bakery';
  }

  // frozen
  if (/(frozen|ice cream)/.test(n)) {
    return 'Frozen';
  }

  // canned & jarred
  if (/(canned|can of|jar|tomato sauce|tomato paste|beans|chickpeas|lentils|broth|stock)/.test(n)) {
    return 'Canned & Jarred';
  }

  // condiments & spices
  if (
    /(salt|pepper|paprika|cumin|coriander|oregano|thyme|rosemary|cinnamon|nutmeg|clove|spice|seasoning|soy sauce|vinegar|mustard|ketchup|mayo|mayonnaise|hot sauce|sriracha|gochujang|harissa|bbq)/.test(
      n
    )
  ) {
    return 'Condiments & Spices';
  }

  // snacks
  if (/(chips|crackers|pretzel|nuts|almonds|cashews|trail mix|granola|protein bar)/.test(n)) {
    return 'Snacks';
  }

  // pantry (default-ish for dry goods)
  if (/(flour|sugar|brown sugar|rice|pasta|noodle|quinoa|oats|oil|olive oil|vegetable oil|canola|honey|maple syrup|cocoa|chocolate|baking powder|baking soda|yeast)/.test(n)) {
    return 'Pantry';
  }

  return 'Other';
}

function normalizeOneIngredient(ing: Ingredient): CleanIngredient | null {
  const name = safeTrim(ing?.name);
  if (!name) return null;

  const amount = safeTrim(ing?.amount);
  const unit = safeTrim(ing?.unit);

  return {
    name,
    amount,
    unit,
    category: categorizeIngredient(name),
    key: normalizeKey(name),
  };
}

export function normalizeIngredients(ingredients: Ingredient[] | undefined | null): CleanIngredient[] {
  const src = Array.isArray(ingredients) ? ingredients : [];
  const out: CleanIngredient[] = [];
  for (const ing of src) {
    const next = normalizeOneIngredient(ing);
    if (next) out.push(next);
  }
  return out;
}

export function deriveRecipeTags(recipe: Pick<Recipe, 'title' | 'category' | 'description' | 'ingredients'>): RecipeTag[] {
  const haystack = `${safeTrim(recipe.title)} ${safeTrim(recipe.category)} ${safeTrim(recipe.description)}`.toLowerCase();
  const tags = new Set<RecipeTag>();

  // meal time
  if (/(breakfast|brunch|pancake|waffle|omelet|oatmeal|granola|smoothie bowl)/.test(haystack)) tags.add('breakfast');
  if (/(lunch|sandwich|salad|wrap|bowl)/.test(haystack)) tags.add('lunch');
  if (/(dinner|stew|roast|casserole|pasta|curry|taco|stir fry|stir-fry)/.test(haystack)) tags.add('dinner');

  // course / role
  if (/(appetizer|starter|dip|salsa|bruschetta)/.test(haystack)) tags.add('appetizer');
  if (/(drink|cocktail|mocktail|lemonade|spritz|smoothie|shake)/.test(haystack)) tags.add('drink');
  if (/(snack|bite|energy ball|bar)/.test(haystack)) tags.add('snack');
  if (/(main|entree|entrée)/.test(haystack)) tags.add('main');

  // ingredient hints
  const ingredientsText = (recipe.ingredients || []).map(i => safeTrim(i.name).toLowerCase()).join(' ');
  if (!tags.has('drink') && /(vodka|gin|rum|tequila|whiskey|bourbon|sparkling water|seltzer)/.test(ingredientsText)) tags.add('drink');

  // if nothing was inferred, keep existing behavior: treat as main+dinner-ish
  if (tags.size === 0) {
    tags.add('main');
    tags.add('dinner');
  }

  return Array.from(tags);
}

/**
 * Optional placeholder when a recipe has no image (e.g. text-only import).
 * URL imports should set `imageUrl` from the source page (Open Graph) on the server instead.
 */
export function suggestRecipeImageUrl(_recipe: Pick<Recipe, 'title' | 'category'>): string | undefined {
  return undefined;
}

const UNICODE_FRAC_PAIRS: [string, string][] = [
  ['\u00BC', '1/4'],
  ['\u00BD', '1/2'],
  ['\u00BE', '3/4'],
  ['\u2153', '1/3'],
  ['\u2154', '2/3'],
  ['\u215B', '1/8'],
  ['\u215C', '3/8'],
  ['\u215D', '5/8'],
  ['\u215E', '7/8'],
];

function replaceUnicodeFractions(s: string): string {
  let t = s.replace(/\u00a0/g, ' ');
  for (const [u, a] of UNICODE_FRAC_PAIRS) t = t.split(u).join(a);
  return t.trim();
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function fractionToString(frac: number, maxDen = 16): string {
  if (frac < 1e-9) return '0';
  let bestNum = 0;
  let bestDen = 1;
  let bestErr = Infinity;
  for (let den = 1; den <= maxDen; den++) {
    const num = Math.round(frac * den);
    if (num < 0 || num > den) continue;
    const err = Math.abs(frac - num / den);
    if (err < bestErr) {
      bestErr = err;
      bestNum = num;
      bestDen = den;
    }
  }
  if (bestErr > 0.06) {
    const rounded = Math.round(frac * 100) / 100;
    return String(rounded);
  }
  const g = gcd(bestNum, bestDen);
  bestNum /= g;
  bestDen /= g;
  if (bestNum === 0) return '0';
  if (bestNum === bestDen) return '1';
  return `${bestNum}/${bestDen}`;
}

function formatCookingNumber(n: number): string {
  if (!Number.isFinite(n)) return '';
  const sign = n < 0 ? '-' : '';
  let v = Math.abs(n);
  if (v < 1e-9) return `${sign}0`;
  let whole = Math.floor(v + 1e-9);
  let frac = v - whole;
  if (frac > 1 - 1e-6) {
    whole += 1;
    frac = 0;
  }
  const fs = fractionToString(frac);
  if (whole === 0) return sign + (fs === '0' ? '0' : fs);
  if (fs === '0' || frac < 1e-6) return `${sign}${whole}`;
  return `${sign}${whole} ${fs}`;
}

function parseSingleAmountToNumber(s: string): number | null {
  const t = replaceUnicodeFractions(s).replace(/,/g, '').trim();
  if (!t) return null;
  if (/^(to taste|as needed|a pinch|pinch|dash|few|several|some|handful)$/i.test(t)) return null;

  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  if (mixed) {
    const w = parseInt(mixed[1], 10);
    const num = parseInt(mixed[2], 10);
    const den = parseInt(mixed[3], 10);
    if (!Number.isFinite(w) || !Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
    return w + num / den;
  }
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (frac) {
    const num = parseInt(frac[1], 10);
    const den = parseInt(frac[2], 10);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
    return num / den;
  }
  const dec = /^(\d+(?:\.\d+)?)$/.exec(t);
  if (dec) return parseFloat(dec[1]);
  return null;
}

/**
 * Scale a recipe `amount` string for batch display (1×, 2×, 3×).
 * Non-numeric phrases (e.g. "to taste") are returned unchanged.
 */
export function scaleIngredientAmount(amount: string, multiplier: number): string {
  const raw = typeof amount === 'string' ? amount.trim() : '';
  if (multiplier === 1 || !raw) return raw;
  const normalized = replaceUnicodeFractions(raw);
  const rangeParts = normalized.split(/\s*-\s/).map((p) => p.trim());
  if (rangeParts.length === 2) {
    const a = parseSingleAmountToNumber(rangeParts[0]);
    const b = parseSingleAmountToNumber(rangeParts[1]);
    if (a !== null && b !== null) {
      return `${formatCookingNumber(a * multiplier)} - ${formatCookingNumber(b * multiplier)}`;
    }
  }
  const n = parseSingleAmountToNumber(normalized);
  if (n === null) return raw;
  return formatCookingNumber(n * multiplier);
}

