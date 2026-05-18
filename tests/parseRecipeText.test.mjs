import assert from 'node:assert/strict';
import { enrichExtractedRecipeFromText, parseRecipeTextFallback } from '../src/lib/parseRecipeText.ts';

const sample = `Chicken Parmesan
Ingredients:
- 2 chicken breasts
- 1 cup marinara sauce
- 1 cup mozzarella
Instructions: Bake at 375F for 25 min`;

const parsed = parseRecipeTextFallback(sample);
assert.equal(parsed.title, 'Chicken Parmesan');
assert.equal(parsed.ingredients?.length, 3);
assert.equal(parsed.ingredients?.[0]?.name, 'chicken breasts');
assert.equal(parsed.instructions?.[0], 'Bake at 375F for 25 min');

const enriched = enrichExtractedRecipeFromText(sample, { title: 'Chicken Parmesan', ingredients: [], instructions: [] });
assert.equal(enriched.ingredients?.length, 3);
assert.equal(enriched.instructions?.length, 1);

console.log('parseRecipeText tests passed');
