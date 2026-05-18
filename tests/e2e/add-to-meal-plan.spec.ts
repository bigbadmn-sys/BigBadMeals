import { test, expect } from '@playwright/test';

test('adds recipe to today meal plan from recipe details modal', async ({ page }) => {
  await page.route('**/api/ai/extract-text', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        title: 'Modal Chili',
        description: 'A simple chili recipe.',
        ingredients: [
          { name: 'Beans', amount: '1', unit: 'can' },
          { name: 'Tomatoes', amount: '1', unit: 'can' },
        ],
        instructions: ['Open cans', 'Simmer 10 minutes'],
        prepTime: 5,
        cookTime: 10,
        servings: 2,
      }),
    });
  });

  await page.goto('/');

  // Seed a recipe in the in-memory DB via the UI import flow.
  await page.getByTestId('nav-recipes').click();
  await page.getByRole('button', { name: 'Add New' }).click();
  await page.getByTestId('recipes-import-text').fill('Beans + tomatoes; simmer.');
  await page.getByTestId('recipes-import-submit').click();
  await expect(page.getByText('Modal Chili')).toBeVisible();

  // Open the details modal by clicking the recipe card.
  await page.getByText('Modal Chili').click();
  await page.getByRole('button', { name: 'Add to Meal Plan' }).click();
  await expect(page.getByTestId('recipes-add-plan-panel')).toBeVisible();
  await page.getByTestId('recipes-add-plan-confirm').click();
  await expect(page.getByText("Added to today's meal plan")).toBeVisible();

  // Planner should show the meal title in the current week (today).
  await page.keyboard.press('Escape'); // best-effort close if modal lingers
  await page.getByTestId('nav-planner').click();
  await expect(page.getByText('Modal Chili').first()).toBeVisible();
});

