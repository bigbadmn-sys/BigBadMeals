import { cn } from '@/lib/utils';
import React, { useContext, useEffect, useState } from 'react';
import { AuthContext } from '../components/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChefHat, Calendar, ArrowRight, Star, Plus, X, ChevronLeft, ChevronsDown, ChevronsUp } from 'lucide-react';
import { dataService } from '../services/dataService';
import { Recipe, MealPlan } from '../types';
import { format, isToday, subDays, parseISO, isAfter } from 'date-fns';
import { Tab } from '../components/Navigation';
import { ALL_MEAL_SLOTS, DEFAULT_VISIBLE_MEAL_SLOTS, EXTRA_MEAL_SLOTS, mealSlotExpandKey } from '../lib/mealPlanSlots';

type DashboardProps = {
  navigate: (tab: Tab) => void;
};

export const Dashboard = ({ navigate }: DashboardProps) => {
  const { user, profile } = useContext(AuthContext);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [activePlan, setActivePlan] = useState<MealPlan | null>(null);
  const [view, setView] = useState<'home' | 'recipes' | 'favorites' | 'viewWeek'>('home');
  const [mealSlotListExpanded, setMealSlotListExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (user) {
      dataService.getRecipes(user.uid).then(setRecipes);
      dataService.getMealPlans(user.uid).then(plans => {
        if (plans.length > 0) setActivePlan(plans[0]);
      });
    }
  }, [user]);

  const todayIso = format(new Date(), 'yyyy-MM-dd');
  const todaysMeals = activePlan?.days.find(d => d.date === todayIso)?.meals || [];
  const nextMeal = todaysMeals[0]; // Simplistic logic for "Next"
  const greetingName =
    profile?.displayName?.split(' ')[0] ||
    (user as { displayName?: string } | null)?.displayName?.split(' ')[0] ||
    'there';
  const weekStart = subDays(new Date(), 7);
  const recipesAddedThisWeek = recipes.filter((recipe) => {
    if (!recipe.createdAt) return false;
    const created = parseISO(recipe.createdAt);
    return isAfter(created, weekStart) || created.getTime() === weekStart.getTime();
  }).length;

  const openAddRecipe = () => {
    sessionStorage.setItem('bb:recipes:openAdd', '1');
    navigate('recipes');
  };

  const openRecipe = (recipeId: string | undefined) => {
    if (!recipeId) {
      navigate('recipes');
      return;
    }
    sessionStorage.setItem('bb:recipes:openRecipeId', recipeId);
    navigate('recipes');
  };

  const removeMealFromToday = async (recipeId: string, type: 'breakfast' | 'lunch' | 'dinner' | 'snack', slot: string | undefined) => {
    if (!user || !activePlan?.id) return;
    const existingDay = activePlan.days.find((d) => d.date === todayIso);
    if (!existingDay) return;
    const nextMeals = existingDay.meals.filter((m) => !(m.recipeId === recipeId && m.type === type && (m.slot || 'main') === (slot || 'main')));
    const nextDays = activePlan.days.map((d) => (d.date === todayIso ? { ...d, meals: nextMeals } : d));
    setActivePlan({ ...activePlan, days: nextDays });
    await dataService.updateMealPlan(user.uid, activePlan.id, { days: nextDays });
  };

  const startAddToSlot = (type: 'breakfast' | 'lunch' | 'dinner', slot: 'main' | 'appetizer' | 'drink' | 'side' | 'dessert') => {
    sessionStorage.setItem('bb:plan:addTarget', JSON.stringify({ date: todayIso, type, slot }));
    navigate('recipes');
  };

  const handleLetsCook = () => {
    if (nextMeal?.recipeId) {
      openRecipe(nextMeal.recipeId);
      return;
    }
    if (recipes.length > 0) {
      openRecipe(recipes[0]?.id);
      return;
    }
    openAddRecipe();
  };

  return (
    <div className="p-6 pb-24 space-y-8 max-w-4xl mx-auto">
      {/* Greeting */}
      <div>
        <h1 className="font-heading text-4xl font-black tracking-tight text-primary">
          Welcome, {greetingName}
        </h1>
        <p className="text-lg text-muted-foreground">Ready for a smart kitchen today?</p>
      </div>

      {/* Main Action Card: Current Meal */}
      <Card className="rounded-[1.75rem] border-none bg-primary text-primary-foreground shadow-[0_24px_60px_-30px_rgba(47,53,59,0.35)] overflow-hidden">
        <CardContent className="p-8 relative">
          {/* pointer-events-none so this layer never steals clicks from the CTA row */}
          <Utensils className="pointer-events-none absolute -right-8 -top-8 h-48 w-48 opacity-10 rotate-12" />
          <div className="relative z-10 space-y-1 mb-8">
            <span className="font-label text-xs uppercase tracking-[0.22em] font-semibold text-primary-foreground/80 bg-black/10 px-3 py-1 rounded-full w-fit">
              Next Serving
            </span>
            <h2 className="font-heading text-4xl font-bold">
              {nextMeal?.recipeTitle || 'No meal scheduled'}
            </h2>
          </div>
          <div className="relative z-10 flex items-center gap-6">
             <div className="flex flex-col">
               <span className="font-label text-[10px] uppercase font-semibold tracking-widest text-primary-foreground/70">Prepare</span>
               <span className="text-xl font-bold">~35 min</span>
             </div>
             <div className="flex flex-col">
               <span className="font-label text-[10px] uppercase font-semibold tracking-widest text-primary-foreground/70">Difficulty</span>
               <span className="text-xl font-bold">Easy</span>
             </div>
             <Button
               className="relative z-20 ml-auto rounded-2xl bg-background text-primary hover:bg-background/90 h-12 px-6 font-semibold shadow-sm"
               onClick={handleLetsCook}
               data-testid="dashboard-lets-cook"
             >
               Let's Cook <ArrowRight className="ml-2 h-4 w-4" />
             </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats Grid / Details */}
      {view === 'home' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <StatCard icon={ChefHat} label="Recipes" value={recipes.length.toString()} trend={recipesAddedThisWeek > 0 ? `+${recipesAddedThisWeek} this week` : undefined} color="bg-muted text-primary" onClick={() => setView('recipes')} />
          <StatCard icon={Star} label="Favorites" value={recipes.filter(r => r.isFavorite).length.toString()} color="bg-muted text-primary" onClick={() => setView('favorites')} />
        </div>
      ) : (
        <Card className="rounded-[1.75rem] border border-border/50 shadow-sm bg-card overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" className="rounded-2xl" onClick={() => setView('home')} aria-label="Back">
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <CardTitle className="text-xl font-bold text-primary">
                {view === 'recipes' ? 'Recipes' : view === 'favorites' ? 'Favorites' : 'View Week'}
              </CardTitle>
            </div>
            {view === 'recipes' && (
              <Button className="rounded-2xl" onClick={() => navigate('recipes')}>
                Open Vault <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-6">
            {view === 'recipes' && (
              <div className="space-y-3">
                <p className="text-muted-foreground">Browse, import, and tag recipes in your vault.</p>
                <Button variant="outline" className="rounded-2xl" onClick={openAddRecipe}>
                  Import a Recipe <Plus className="ml-2 h-4 w-4" />
                </Button>
              </div>
            )}
            {view === 'favorites' && (
              <div className="space-y-3">
                <p className="text-muted-foreground">Your starred recipes, ready to reuse.</p>
                <div className="grid gap-2">
                  {recipes.filter((r) => r.isFavorite).slice(0, 6).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="text-left p-4 rounded-2xl border border-border/60 hover:bg-muted/40 transition-colors"
                      onClick={() => openRecipe(r.id)}
                    >
                      <p className="font-semibold text-primary">{r.title}</p>
                      <p className="text-xs text-muted-foreground line-clamp-1">{r.category || 'Recipe'}</p>
                    </button>
                  ))}
                  {recipes.filter((r) => r.isFavorite).length === 0 && <p className="text-sm text-muted-foreground italic">No favorites yet.</p>}
                </div>
              </div>
            )}
            {view === 'viewWeek' && (
              <div className="space-y-4">
                <p className="text-muted-foreground">Your current week at a glance.</p>
                <div className="grid gap-3">
                  {(activePlan?.days || []).slice(0, 7).map((d) => (
                    <div key={d.date} className="p-4 rounded-2xl border border-border/60 bg-background/60">
                      <p className="font-semibold text-primary">{d.date}</p>
                      <p className="text-xs text-muted-foreground">{d.meals.length} planned items</p>
                    </div>
                  ))}
                  {!activePlan && <p className="text-sm text-muted-foreground italic">No plan yet. Generate one in Meal Plan.</p>}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Today's Plan (Party Plan capable) */}
      {view === 'home' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between px-2">
            <h2 className="font-heading text-2xl font-bold flex items-center gap-2 text-primary">
              <Calendar className="h-6 w-6 text-primary" /> Today&apos;s Plan
            </h2>
            <Button
              variant="ghost"
              className="font-label text-primary font-semibold uppercase tracking-widest text-xs"
              onClick={() => setView('viewWeek')}
              data-testid="dashboard-view-week"
            >
              View Week
            </Button>
          </div>

          <div className="grid gap-4">
            {(['breakfast', 'lunch', 'dinner'] as const).map((type) => {
              const mealsOfType = todaysMeals.filter((m) => m.type === type);
              const expandKey = mealSlotExpandKey(todayIso, type);
              const expanded = mealSlotListExpanded[expandKey] === true;
              const slots = expanded ? ALL_MEAL_SLOTS : DEFAULT_VISIBLE_MEAL_SLOTS;
              const extraSlotHasMeals = EXTRA_MEAL_SLOTS.some((slot) =>
                mealsOfType.some((m) => (m.slot || 'main') === slot)
              );
              return (
                <Card key={type} className="rounded-[1.5rem] border border-border/50 shadow-sm bg-card overflow-hidden">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg font-bold text-primary capitalize">{type}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {slots.map((slot) => {
                      const slotMeals = mealsOfType.filter((m) => (m.slot || 'main') === slot);
                      return (
                        <div key={slot} className="rounded-2xl border border-border/50 bg-background/50 p-4">
                          <div className="flex items-center justify-between mb-3">
                            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{slot}</p>
                            <Button variant="outline" className="rounded-xl h-9" onClick={() => startAddToSlot(type, slot)}>
                              Add <Plus className="ml-2 h-4 w-4" />
                            </Button>
                          </div>
                          {slotMeals.length === 0 ? (
                            <p className="text-sm text-muted-foreground italic">No items yet.</p>
                          ) : (
                            <div className="grid gap-2">
                              {slotMeals.map((m, idx) => (
                                <div key={`${m.recipeId}:${idx}`} className="flex items-center gap-3 p-3 rounded-2xl bg-card border border-border/60">
                                  <button type="button" className="flex-1 text-left" onClick={() => openRecipe(m.recipeId)}>
                                    <p className="font-semibold text-primary">{m.recipeTitle}</p>
                                    <p className="text-[11px] text-muted-foreground">Meal details</p>
                                  </button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="rounded-xl text-muted-foreground hover:bg-muted"
                                    onClick={() => removeMealFromToday(m.recipeId, type, m.slot)}
                                    aria-label="Remove from today"
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
                    {!expanded && (
                      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between pt-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-xl border-dashed"
                          aria-expanded={false}
                          onClick={() =>
                            setMealSlotListExpanded((prev) => ({
                              ...prev,
                              [expandKey]: true,
                            }))
                          }
                        >
                          <ChevronsDown className="mr-2 h-4 w-4" />
                          EXPAND LIST
                        </Button>
                        {extraSlotHasMeals && (
                          <p className="text-center text-[11px] text-muted-foreground sm:text-right">
                            Appetizer, drink, or dessert slots have items — expand to view.
                          </p>
                        )}
                      </div>
                    )}
                    {expanded && (
                      <div className="pt-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="rounded-xl text-muted-foreground"
                          aria-expanded
                          onClick={() =>
                            setMealSlotListExpanded((prev) => ({
                              ...prev,
                              [expandKey]: false,
                            }))
                          }
                        >
                          <ChevronsUp className="mr-2 h-4 w-4" />
                          COLLAPSE LIST
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard = ({ icon: Icon, label, value, trend, color, onClick }: any) => (
  <Card
    className={cn(
      "rounded-[1.5rem] border border-border/50 shadow-sm bg-card p-6",
      onClick && "cursor-pointer hover:bg-muted/30 transition-colors"
    )}
    onClick={onClick}
    role={onClick ? "button" : undefined}
    tabIndex={onClick ? 0 : undefined}
  >
    <div className="flex items-center gap-4 mb-4">
      <div className={cn("p-3 rounded-2xl", color)}>
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <p className="font-label text-[10px] uppercase font-semibold text-muted-foreground tracking-[0.22em]">{label}</p>
        <p className="text-2xl font-bold text-primary">{value}</p>
      </div>
    </div>
    {trend && <p className="text-xs font-semibold text-muted-foreground bg-muted px-3 py-1 rounded-full w-fit">{trend}</p>}
  </Card>
);

function Utensils(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3 2 7 7" />
      <path d="m3 12 7-7" />
      <path d="m11 20 2-2" />
      <path d="m15 16 2-2" />
      <path d="m19 12 2-2" />
      <path d="M20 21v-2a4 4 0 0 0-4-4h-2a4 4 0 0 0-4 4v2" />
    </svg>
  );
}

// End of Dashboard
