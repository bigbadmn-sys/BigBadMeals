import { cn } from '@/lib/utils';
import React, { useContext, useEffect, useState } from 'react';
import { AuthContext } from '../components/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar as CalendarIcon, Sparkles, Loader2, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { format, addDays, startOfWeek, isSameDay } from 'date-fns';
import { dataService } from '../services/dataService';
import { generateWeeklyMealPlan } from '../services/geminiService';
import type { CleanIngredient, MealPlan, Recipe } from '../types';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tab } from '../components/Navigation';
import { categorizeIngredient } from '../lib/ingredientUtils';

type PlannerProps = {
  navigate: (tab: Tab) => void;
};

function isLikelyUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

function deriveNameFromUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl.trim());
    const parts = u.pathname
      .split('/')
      .map((p) => decodeURIComponent(p))
      .filter(Boolean);
    const candidate = parts[parts.length - 1] || u.hostname;
    return candidate
      .replace(/[-_]+/g, ' ')
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return rawUrl.trim();
  }
}

function parseSnacksAndSuppliesInput(input: string): { name: string; amount: string; unit: string }[] {
  const lines = input
    .split(/\r?\n|,/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: { name: string; amount: string; unit: string }[] = [];
  for (const line of lines) {
    if (isLikelyUrl(line)) {
      out.push({ name: deriveNameFromUrl(line), amount: '', unit: '' });
      continue;
    }

    // Heuristic: "<amount> <unit> <name>" or "<name> - <amount> <unit>"
    const m1 = line.match(/^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?\s+(.+)\s*$/);
    if (m1) {
      const amount = m1[1] || '';
      const unit = (m1[2] || '').trim();
      const name = (m1[3] || '').trim();
      if (name) {
        out.push({ name, amount, unit });
        continue;
      }
    }

    const m2 = line.match(/^(.+?)\s*[-–—]\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?\s*$/);
    if (m2) {
      out.push({ name: m2[1].trim(), amount: m2[2] || '', unit: (m2[3] || '').trim() });
      continue;
    }

    out.push({ name: line, amount: '', unit: '' });
  }
  return out;
}

function toCleanIngredient(row: { name: string; amount: string; unit: string }): CleanIngredient {
  const name = row.name.trim();
  const key = name.toLowerCase().replace(/\s+/g, ' ').trim();
  const category = categorizeIngredient(name) === 'Other' ? 'Supplies' : categorizeIngredient(name);
  return { name, amount: row.amount.trim(), unit: row.unit.trim(), category, key };
}

export const Planner = ({ navigate }: PlannerProps) => {
  const { user, profile } = useContext(AuthContext);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [plans, setPlans] = useState<MealPlan[]>([]);
  const [generating, setGenerating] = useState(false);
  const [activePlan, setActivePlan] = useState<MealPlan | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [snackName, setSnackName] = useState('');
  const [snackAmount, setSnackAmount] = useState('');
  const [snackUnit, setSnackUnit] = useState('');
  const [snackUrlText, setSnackUrlText] = useState('');

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user]);

  const loadData = async () => {
    const [r, p] = await Promise.all([
      dataService.getRecipes(user!.uid),
      dataService.getMealPlans(user!.uid)
    ]);
    setRecipes(r);
    setPlans(p);
    if (p.length > 0) setActivePlan(p[0]);
  };

  const handleGenerate = async () => {
    if (!profile) return;
    setGenerating(true);
    try {
      const startDate = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const planRes = await generateWeeklyMealPlan(profile, recipes, startDate);
      
      const newPlan: Omit<MealPlan, 'id'> = {
        ownerId: user!.uid,
        startDate,
        endDate: format(addDays(new Date(startDate), 6), 'yyyy-MM-dd'),
        days: planRes.days || [],
        snacksAndSupplies: []
      };
      
      const id = await dataService.addMealPlan(user!.uid, newPlan);
      await loadData();
      toast.success('AI Weekly Meal Plan Generated!');
    } catch (e) {
      toast.error('Failed to generate meal plan');
    } finally {
      setGenerating(false);
    }
  };

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(selectedDate, { weekStartsOn: 1 }), i));

  const getMealsForDay = (date: Date) => {
    const formattedDate = format(date, 'yyyy-MM-dd');
    return activePlan?.days.find(d => d.date === formattedDate)?.meals || [];
  };

  const openRecipe = (recipeId: string | undefined) => {
    if (!recipeId) return;
    sessionStorage.setItem('bb:recipes:openRecipeId', recipeId);
    navigate('recipes');
  };

  const startAddToSlot = (dateIso: string, type: 'breakfast' | 'lunch' | 'dinner', slot: 'main' | 'appetizer' | 'drink' | 'side' | 'dessert') => {
    sessionStorage.setItem('bb:plan:addTarget', JSON.stringify({ date: dateIso, type, slot }));
    navigate('recipes');
  };

  const removeMeal = async (dateIso: string, recipeId: string, type: 'breakfast' | 'lunch' | 'dinner' | 'snack', slot: string | undefined) => {
    if (!user || !activePlan?.id) return;
    const day = activePlan.days.find((d) => d.date === dateIso);
    if (!day) return;
    const nextMeals = day.meals.filter((m) => !(m.recipeId === recipeId && m.type === type && (m.slot || 'main') === (slot || 'main')));
    const nextDays = activePlan.days.map((d) => (d.date === dateIso ? { ...d, meals: nextMeals } : d));
    setActivePlan({ ...activePlan, days: nextDays });
    await dataService.updateMealPlan(user.uid, activePlan.id, { days: nextDays });
  };

  const addSnackSupplyRow = async (row: { name: string; amount: string; unit: string }) => {
    if (!user || !activePlan?.id) return;
    const existing = activePlan.snacksAndSupplies || [];
    const next = [...existing, toCleanIngredient(row)];
    setActivePlan({ ...activePlan, snacksAndSupplies: next });
    await dataService.updateMealPlan(user.uid, activePlan.id, { snacksAndSupplies: next });
  };

  const removeSnackSupply = async (idx: number) => {
    if (!user || !activePlan?.id) return;
    const existing = activePlan.snacksAndSupplies || [];
    const next = existing.filter((_, i) => i !== idx);
    setActivePlan({ ...activePlan, snacksAndSupplies: next });
    await dataService.updateMealPlan(user.uid, activePlan.id, { snacksAndSupplies: next });
  };

  return (
    <div className="p-6 pb-24 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-3xl font-black tracking-tight text-primary">Meal Plan</h1>
          <p className="text-sm text-muted-foreground italic">Balance your week with AI assistance</p>
        </div>
        <Button
          data-testid="planner-generate"
          onClick={handleGenerate} 
          disabled={generating}
          className="rounded-2xl bg-primary hover:bg-primary/90 border-none shadow-sm h-12 px-6"
        >
          {generating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
          Auto-Generate
        </Button>
      </div>

      <div className="flex items-center justify-between bg-card rounded-[1.5rem] p-4 shadow-sm border border-border/50">
        <Button variant="ghost" size="icon" onClick={() => setSelectedDate(addDays(selectedDate, -7))}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2">
          <CalendarIcon className="h-4 w-4 text-primary" />
          <span className="font-bold">Week of {format(startOfWeek(selectedDate, { weekStartsOn: 1 }), 'MMM d, yyyy')}</span>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setSelectedDate(addDays(selectedDate, 7))}>
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      <div className="grid gap-4">
        {weekDays.map((day, i) => {
          const meals = getMealsForDay(day);
          const isToday = isSameDay(day, new Date());
          const dateIso = format(day, 'yyyy-MM-dd');
          
          return (
            <Card key={i} className={cn(
              "rounded-[1.5rem] border border-border/50 shadow-sm overflow-hidden bg-card",
              isToday ? "ring-2 ring-primary/30 scale-[1.01]" : "opacity-90"
            )}>
              <div className={cn(
                "px-6 py-4 flex items-center justify-between",
                isToday ? "bg-muted/60" : "bg-card"
              )}>
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center font-bold",
                    isToday ? "bg-primary text-primary-foreground" : "bg-muted text-primary"
                  )}>
                    {format(day, 'd')}
                  </div>
                  <div>
                    <p className="font-bold text-lg">{format(day, 'EEEE')}</p>
                    {isToday && <p className="font-label text-[10px] uppercase font-semibold text-primary tracking-widest">TODAY</p>}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => {
                    toast.message('Pick a recipe in Recipes to add to this day.');
                    navigate('recipes');
                  }}
                >
                  Add meals <Plus className="h-4 w-4 ml-2" />
                </Button>
              </div>
              <CardContent className="p-0 bg-card">
                <div className="p-6 space-y-4">
                  {(['breakfast', 'lunch', 'dinner'] as const).map((mealType) => {
                    const mealsOfType = meals.filter((m) => m.type === mealType);
                    const slots = ['main', 'appetizer', 'drink', 'side', 'dessert'] as const;
                    return (
                      <div key={mealType} className="rounded-3xl border border-border/60 bg-background/50 p-4">
                        <div className="flex items-center justify-between mb-3">
                          <p className="font-label text-[10px] uppercase font-semibold text-muted-foreground tracking-[0.22em]">{mealType}</p>
                        </div>
                        <div className="grid gap-3">
                          {slots.map((slot) => {
                            const slotMeals = mealsOfType.filter((m) => (m.slot || 'main') === slot);
                            return (
                              <div key={slot} className="rounded-2xl border border-border/50 bg-card p-3">
                                <div className="flex items-center justify-between">
                                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{slot}</p>
                                  <Button
                                    variant="outline"
                                    className="rounded-xl h-9"
                                    onClick={() => startAddToSlot(dateIso, mealType, slot)}
                                  >
                                    Add <Plus className="ml-2 h-4 w-4" />
                                  </Button>
                                </div>
                                {slotMeals.length === 0 ? (
                                  <p className="mt-2 text-sm text-muted-foreground italic">No items yet.</p>
                                ) : (
                                  <div className="mt-2 grid gap-2">
                                    {slotMeals.map((m, idx) => (
                                      <div key={`${m.recipeId}:${idx}`} className="flex items-center gap-3 p-3 rounded-2xl bg-background border border-border/60">
                                        <button type="button" className="flex-1 text-left" onClick={() => openRecipe(m.recipeId)}>
                                          <p className="font-semibold text-primary">{m.recipeTitle}</p>
                                          <p className="text-[11px] text-muted-foreground">Meal details</p>
                                        </button>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          className="rounded-xl text-muted-foreground hover:bg-muted"
                                          onClick={() => removeMeal(dateIso, m.recipeId, mealType, m.slot)}
                                          aria-label="Remove meal"
                                        >
                                          <X className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Snacks & supplies (weekly) */}
      <Card className="rounded-[1.75rem] border border-border/50 shadow-sm bg-card overflow-hidden">
        <CardHeader>
          <CardTitle className="text-xl font-bold text-primary">Snacks &amp; supplies</CardTitle>
          <p className="text-sm text-muted-foreground">Add extras for the week (typed items or pasted/dropped URLs).</p>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest font-bold ml-1 text-muted-foreground">Item</Label>
              <Input className="rounded-xl h-11" value={snackName} onChange={(e) => setSnackName(e.target.value)} placeholder="Paper towels" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest font-bold ml-1 text-muted-foreground">Amount</Label>
              <Input className="rounded-xl h-11" value={snackAmount} onChange={(e) => setSnackAmount(e.target.value)} placeholder="2" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest font-bold ml-1 text-muted-foreground">Unit</Label>
              <Input className="rounded-xl h-11" value={snackUnit} onChange={(e) => setSnackUnit(e.target.value)} placeholder="rolls" />
            </div>
          </div>
          <Button
            className="rounded-2xl bg-primary hover:bg-primary/90"
            onClick={async () => {
              if (!snackName.trim()) return;
              await addSnackSupplyRow({ name: snackName, amount: snackAmount, unit: snackUnit });
              setSnackName('');
              setSnackAmount('');
              setSnackUnit('');
              toast.success('Added');
            }}
          >
            Add item
          </Button>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-widest font-bold ml-1 text-muted-foreground">Paste or drop URLs / items</Label>
            <textarea
              className="w-full min-h-[120px] p-4 rounded-2xl border border-border bg-background/60 focus:ring-1 focus:ring-primary outline-none text-sm leading-relaxed"
              placeholder={"Examples:\nhttps://www.target.com/p/paper-towels\nbananas\n2 bags chips"}
              value={snackUrlText}
              onChange={(e) => setSnackUrlText(e.target.value)}
              onDrop={(e) => {
                e.preventDefault();
                const text = e.dataTransfer.getData('text/plain');
                if (text) setSnackUrlText((v) => `${v}${v ? '\n' : ''}${text}`);
              }}
              onDragOver={(e) => e.preventDefault()}
            />
            <Button
              variant="outline"
              className="rounded-2xl"
              onClick={async () => {
                const parsed = parseSnacksAndSuppliesInput(snackUrlText);
                if (parsed.length === 0) return;
                for (const row of parsed) {
                  if (!row.name.trim()) continue;
                  // eslint-disable-next-line no-await-in-loop
                  await addSnackSupplyRow(row);
                }
                setSnackUrlText('');
                toast.success(`Added ${parsed.length} item(s)`);
              }}
            >
              Add from text/URLs
            </Button>
          </div>

          <div className="space-y-2">
            {(activePlan?.snacksAndSupplies || []).length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No weekly extras yet.</p>
            ) : (
              <div className="grid gap-2">
                {(activePlan?.snacksAndSupplies || []).map((it, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-3 rounded-2xl bg-background border border-border/60">
                    <div className="flex-1">
                      <p className="font-semibold text-primary">{it.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {it.amount ? `${it.amount} ` : ''}{it.unit || ''}{it.category ? ` • ${it.category}` : ''}
                      </p>
                    </div>
                    <Button size="icon" variant="ghost" className="rounded-xl text-muted-foreground hover:bg-muted" onClick={() => removeSnackSupply(idx)} aria-label="Remove weekly extra">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// End of Planner
