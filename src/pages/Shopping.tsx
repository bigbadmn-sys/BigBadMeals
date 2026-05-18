import { cn } from '@/lib/utils';
import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../components/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ShoppingBasket, Receipt, Trash2, Plus, Loader2, ArrowRight } from 'lucide-react';
import { dataService } from '../services/dataService';
import { Recipe, MealPlan, GroceryList, GroceryItem } from '../types';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { normalizeIngredients } from '../lib/ingredientUtils';

export const Shopping = () => {
  const { user } = useContext(AuthContext);
  const [lists, setLists] = useState<GroceryList[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeList, setActiveList] = useState<GroceryList | null>(null);

  useEffect(() => {
    if (user) loadLists();
  }, [user]);

  const loadLists = async () => {
    const data = await dataService.getGroceryLists(user!.uid);
    setLists(data);
    if (data.length > 0) {
      const first = data[0];
      const sorted = [...(first.items || [])].sort((a, b) => {
        const ac = (a.category || '').toString();
        const bc = (b.category || '').toString();
        if (ac !== bc) return ac.localeCompare(bc);
        return a.name.localeCompare(b.name);
      });
      setActiveList({ ...first, items: sorted });
    }
    setLoading(false);
  };

  const toggleItem = async (index: number) => {
    if (!activeList) return;
    const newItems = [...activeList.items];
    newItems[index].checked = !newItems[index].checked;
    const updated = { ...activeList, items: newItems };
    setActiveList(updated);
    await dataService.updateGroceryList(user!.uid, activeList.id!, { items: newItems });
  };

  const generateFromPlan = async () => {
    const plans = await dataService.getMealPlans(user!.uid);
    const recipes = await dataService.getRecipes(user!.uid);
    
    if (plans.length === 0) {
      toast.error('Generate a meal plan first!');
      return;
    }

    const latestPlan = plans[0];
    const itemsMap = new Map<string, GroceryItem>();

    latestPlan.days.forEach(day => {
      day.meals.forEach(meal => {
        const recipe =
          recipes.find(r => r.id === meal.recipeId) ??
          recipes.find(r => r.title.trim().toLowerCase() === meal.recipeTitle.trim().toLowerCase());
        if (recipe) {
          const clean = recipe.cleanIngredients && recipe.cleanIngredients.length > 0 ? recipe.cleanIngredients : normalizeIngredients(recipe.ingredients);
          clean.forEach((ing) => {
            const key = (ing.key || ing.name).toLowerCase();
            if (itemsMap.has(key)) {
              const existing = itemsMap.get(key)!;
              const a = parseFloat(existing.amount);
              const b = parseFloat(ing.amount);
              if (!Number.isNaN(a) && !Number.isNaN(b) && existing.unit === ing.unit) {
                existing.amount = (a + b).toString();
              }
            } else {
              itemsMap.set(key, { name: ing.name, amount: ing.amount, unit: ing.unit, checked: false, category: ing.category });
            }
          });
        } else {
          console.warn('[Shopping] Meal references missing recipe', {
            recipeId: meal.recipeId,
            recipeTitle: meal.recipeTitle,
          });
        }
      });
    });

    (latestPlan.snacksAndSupplies || []).forEach((ing) => {
      const key = (ing.key || ing.name).toLowerCase();
      if (!itemsMap.has(key)) {
        itemsMap.set(key, { name: ing.name, amount: ing.amount, unit: ing.unit, checked: false, category: ing.category });
      }
    });

    const newList: Omit<GroceryList, 'id'> = {
      ownerId: user!.uid,
      mealPlanId: latestPlan.id!,
      items: Array.from(itemsMap.values()).sort((a, b) => {
        const ac = (a.category || '').toString();
        const bc = (b.category || '').toString();
        if (ac !== bc) return ac.localeCompare(bc);
        return a.name.localeCompare(b.name);
      }),
      totalEstimatedCost: 0,
      createdAt: new Date().toISOString()
    };

    await dataService.addGroceryList(user!.uid, newList);
    await loadLists();
    toast.success('Shopping list synced with your plan!');
  };

  const clearChecked = async () => {
    if (!activeList) return;
    const newItems = activeList.items.filter(i => !i.checked);
    await dataService.updateGroceryList(user!.uid, activeList.id!, { items: newItems });
    setActiveList({ ...activeList, items: newItems });
    toast.success('Cleaned up your list');
  };

  const deleteList = async () => {
    if (!activeList?.id) return;
    if (!confirm('Delete this shopping list?')) return;
    await dataService.deleteGroceryList(user!.uid, activeList.id);
    setActiveList(null);
    await loadLists();
    toast.success('Deleted list');
  };

  return (
    <div className="p-6 pb-24 space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-3xl font-black tracking-tight text-primary">Shopping</h1>
          <p className="text-sm text-muted-foreground italic">Tick off as you shop</p>
        </div>
        <Button
          data-testid="shopping-sync-plan"
          onClick={generateFromPlan} 
          variant="outline" 
          className="rounded-2xl border-border h-11 bg-background/50"
        >
          <Receipt className="h-4 w-4 mr-2" /> Sync Plan
        </Button>
      </div>

      {!activeList ? (
        <div className="py-20 text-center space-y-4">
          <ShoppingBasket className="h-16 w-16 mx-auto text-muted-foreground/30" />
          <p className="text-lg text-muted-foreground">Your cart is empty.</p>
          <Button onClick={generateFromPlan} className="rounded-xl bg-primary hover:bg-primary/90">Sync from latest plan</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between px-2">
            <span className="text-sm font-semibold text-muted-foreground">{activeList.items.filter(i => i.checked).length} of {activeList.items.length} items collected</span>
            <Button variant="ghost" size="sm" onClick={clearChecked} className="text-red-500 hover:bg-red-50 rounded-xl">Clear Finished</Button>
          </div>

          <Card className="rounded-[1.75rem] border border-border/50 shadow-sm bg-card overflow-hidden">
            <CardContent className="p-6 space-y-1">
              {activeList.items.map((item, i) => (
                <div 
                  key={i} 
                  className={cn(
                    "flex items-center gap-4 py-4 px-2 hover:bg-muted/50 rounded-2xl transition-colors group",
                    item.checked && "opacity-50"
                  )}
                  onClick={() => toggleItem(i)}
                >
                  <Checkbox checked={item.checked} className="h-6 w-6 rounded-lg border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary" />
                  <div className="flex-1">
                    <p className={cn("font-bold text-lg", item.checked && "line-through")}>{item.name}</p>
                    <p className="text-sm text-muted-foreground">{item.amount} {item.unit}</p>
                  </div>
                  <Badge className="bg-muted text-primary border-none rounded-lg group-hover:bg-muted/80">{item.category}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Button onClick={deleteList} className="w-full h-14 rounded-2xl bg-primary text-primary-foreground gap-2 mt-4 hover:bg-primary/90">
            <Trash2 className="h-5 w-5" /> Delete List
          </Button>
        </div>
      )}
    </div>
  );
};

// End of Shopping
