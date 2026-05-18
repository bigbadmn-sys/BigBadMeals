import type { Ingredient, Recipe } from '../types';

type ExtractedRecipe = {
  title?: string;
  description?: string;
  ingredients?: Ingredient[];
  instructions?: string[];
  nutritionalInfo?: Recipe['nutritionalInfo'];
  prepTime?: number;
  cookTime?: number;
  servings?: number;
  category?: string;
  imageUrl?: string;
};

function parseIngredientLine(line: string): Ingredient {
  const trimmed = line.replace(/^[-*•]\s*/, '').trim();
  if (!trimmed) return { name: '', amount: '', unit: '' };

  const amountName = /^(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)\s+(.+)$/i.exec(trimmed);
  if (amountName?.[1] && amountName[2]) {
    const amount = amountName[1].trim();
    const remainder = amountName[2].trim();
    const withUnit = /^([\d./\s-]+)\s+([\w'.°]+(?:\s+[\w'.°]+){0,2})\s+(.+)$/i.exec(remainder);
    if (withUnit?.[1] && withUnit[2] && withUnit[3]) {
      return { amount: `${amount} ${withUnit[1].trim()}`.trim(), unit: withUnit[2].trim(), name: withUnit[3].trim() };
    }
    return { amount, unit: '', name: remainder };
  }

  const match = /^([\d./\s-]+)\s+([\w'.°]+(?:\s+[\w'.°]+){0,2})\s+(.+)$/i.exec(trimmed);
  if (match?.[1] && match[2] && match[3]) {
    return { amount: match[1].trim(), unit: match[2].trim(), name: match[3].trim() };
  }

  return { name: trimmed, amount: '', unit: '' };
}

function parseIngredientSection(section: string): Ingredient[] {
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*•]/.test(line) || /^\d/.test(line))
    .map(parseIngredientLine)
    .filter((ing) => ing.name.trim().length > 0);
}

function parseInstructionSection(section: string): string[] {
  const lines = section
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const numbered = lines.filter((line) => /^\d+[.)]\s+/.test(line));
  if (numbered.length > 0) {
    return numbered.map((line) => line.replace(/^\d+[.)]\s+/, '').trim()).filter(Boolean);
  }

  return lines;
}

export function parseRecipeTextFallback(text: string): Partial<ExtractedRecipe> {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return {};

  const title = normalized.split('\n').map((line) => line.trim()).find(Boolean) || 'Imported Recipe';
  const ingredientsMatch = /ingredients?\s*:?\s*([\s\S]*?)(?:instructions?|directions?|method)\s*:?\s*([\s\S]*)$/i.exec(normalized);
  const instructionsOnlyMatch = /(?:instructions?|directions?|method)\s*:?\s*([\s\S]+)$/i.exec(normalized);

  const ingredients = ingredientsMatch ? parseIngredientSection(ingredientsMatch[1]) : [];
  const instructions = ingredientsMatch
    ? parseInstructionSection(ingredientsMatch[2])
    : instructionsOnlyMatch
      ? parseInstructionSection(instructionsOnlyMatch[1])
      : [];

  return {
    title,
    ingredients,
    instructions,
  };
}

export function enrichExtractedRecipeFromText(rawText: string, extracted: ExtractedRecipe): ExtractedRecipe {
  const fallback = parseRecipeTextFallback(rawText);
  const ingredients =
    extracted.ingredients && extracted.ingredients.length > 0
      ? extracted.ingredients
      : fallback.ingredients || [];
  const instructions =
    extracted.instructions && extracted.instructions.length > 0
      ? extracted.instructions
      : fallback.instructions || [];

  return {
    ...extracted,
    title: extracted.title?.trim() || fallback.title,
    ingredients,
    instructions,
  };
}
