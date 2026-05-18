import type { Meal, Recipe, RecipeTag } from '../types';
import { deriveRecipeTags } from './ingredientUtils';

/** Key for per-day, per-meal-type slot list expand state (Planner + Dashboard). */
export const mealSlotExpandKey = (dateIso: string, mealType: string) => `${dateIso}::${mealType}`;

export const ALL_MEAL_SLOTS = ['main', 'appetizer', 'drink', 'side', 'dessert'] as const;

export const DEFAULT_VISIBLE_MEAL_SLOTS = ['main', 'side'] as const;

export const EXTRA_MEAL_SLOTS = ['appetizer', 'drink', 'dessert'] as const;

/**
 * Infer default meal row + course slot from recipe tags (or derived tags).
 * Used when adding a recipe to the plan so the picker opens with sensible defaults.
 */
export function suggestMealPlacementForRecipe(
  recipe: Pick<Recipe, 'tags' | 'title' | 'category' | 'description' | 'ingredients'>
): { type: Meal['type']; slot: NonNullable<Meal['slot']> } {
  const rawTags = recipe.tags && recipe.tags.length > 0 ? recipe.tags : deriveRecipeTags(recipe);
  const tags = new Set<RecipeTag>(rawTags);

  if (tags.has('snack')) {
    return { type: 'snack', slot: 'snack' };
  }

  const pickMealType = (): Meal['type'] => {
    const bt = tags.has('breakfast');
    const lt = tags.has('lunch');
    const dt = tags.has('dinner');
    const n = (bt ? 1 : 0) + (lt ? 1 : 0) + (dt ? 1 : 0);
    if (n === 1) {
      if (bt) return 'breakfast';
      if (lt) return 'lunch';
      if (dt) return 'dinner';
    }
    if (n > 1) {
      if (lt && bt && !dt) return 'lunch';
      return 'dinner';
    }
    return 'dinner';
  };

  if (tags.has('appetizer')) {
    return { type: pickMealType(), slot: 'appetizer' };
  }
  if (tags.has('drink')) {
    return { type: pickMealType(), slot: 'drink' };
  }

  return { type: pickMealType(), slot: 'main' };
}
