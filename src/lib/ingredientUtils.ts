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
 * Minimal, no-key “web” image fallback using a predictable remote source.
 * This returns a low-res URL intended for use as a header image.
 */
export function suggestRecipeImageUrl(recipe: Pick<Recipe, 'title' | 'category'>): string {
  const query = encodeURIComponent(
    [safeTrim(recipe.title), safeTrim(recipe.category)].filter(Boolean).join(' ').trim() || 'recipe'
  );
  // Note: `images.weserv.nl` provides simple resizing proxying without keys.
  const upstream = `https://source.unsplash.com/featured/?${query}`;
  return `https://images.weserv.nl/?url=${encodeURIComponent(upstream)}&w=800&h=450&fit=cover&q=55`;
}

