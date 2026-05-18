import { cn } from '@/lib/utils';
import React, { useState, useContext, useEffect } from 'react';
import { AuthContext } from '../components/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Search, Plus, Filter, ChefHat, Timer, Flame, Heart, Trash2, Camera, Link, FileText, Loader2, X } from 'lucide-react';
import { dataService } from '../services/dataService';
import { extractRecipeFromText, extractRecipeFromImage, extractRecipeFromUrl } from '../services/geminiService';
import type { DayPlan, MealPlan, Recipe, RecipeTag } from '../types';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { addDays, format, startOfWeek } from 'date-fns';
import { deriveRecipeTags, normalizeIngredients, suggestRecipeImageUrl } from '../lib/ingredientUtils';

export const Recipes = () => {
  const { user } = useContext(AuthContext);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [activeRecipe, setActiveRecipe] = useState<Recipe | null>(null);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [tagFilter, setTagFilter] = useState<'all' | RecipeTag>('all');
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    if (user) loadRecipes();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (loading) return;

    const openAdd = sessionStorage.getItem('bb:recipes:openAdd');
    if (openAdd === '1') {
      sessionStorage.removeItem('bb:recipes:openAdd');
      setDialogOpen(true);
    }

    const openRecipeId = sessionStorage.getItem('bb:recipes:openRecipeId');
    if (openRecipeId) {
      sessionStorage.removeItem('bb:recipes:openRecipeId');
      const match = recipes.find((r) => r.id === openRecipeId);
      if (match) setActiveRecipe(match);
    }
  }, [user, loading, recipes]);

  const loadRecipes = async () => {
    const data = await dataService.getRecipes(user!.uid);
    setRecipes(data);
    setLoading(false);

    // Backfill newer fields for older saved recipes (best-effort, cost-free).
    const needsBackfill = data.filter((r) => !!r.id && (!r.tags || r.tags.length === 0 || !r.cleanIngredients || r.cleanIngredients.length === 0 || !r.imageUrl));
    if (needsBackfill.length > 0) {
      // Fire-and-forget style: update in background, then reload once.
      Promise.all(
        needsBackfill.map(async (r) => {
          if (!r.id) return;
          const updates: Partial<Recipe> = {};
          if (!r.cleanIngredients || r.cleanIngredients.length === 0) updates.cleanIngredients = normalizeIngredients(r.ingredients);
          if (!r.tags || r.tags.length === 0) updates.tags = deriveRecipeTags(r);
          if (!r.imageUrl) updates.imageUrl = suggestRecipeImageUrl(r);
          await dataService.updateRecipe(user!.uid, r.id, updates);
        })
      )
        .then(() => dataService.getRecipes(user!.uid))
        .then((next) => setRecipes(next))
        .catch(() => {
          // ignore backfill failures
        });
    }
  };

  const addRecipeToMealPlan = async (recipe: Recipe) => {
    if (!user) {
      toast.error('Please sign in to add meals to your plan');
      return;
    }
    if (!recipe.id) {
      toast.error('Recipe is missing an id');
      return;
    }

    const plans = await dataService.getMealPlans(user.uid);

    const todayIso = format(new Date(), 'yyyy-MM-dd');
    const planTargetRaw = sessionStorage.getItem('bb:plan:addTarget');
    let targetDate = todayIso;
    let targetType: 'breakfast' | 'lunch' | 'dinner' | 'snack' = 'dinner';
    let targetSlot: 'main' | 'appetizer' | 'drink' | 'side' | 'dessert' | 'snack' | undefined = 'main';
    try {
      if (planTargetRaw) {
        const parsed = JSON.parse(planTargetRaw);
        if (typeof parsed?.date === 'string') targetDate = parsed.date;
        if (parsed?.type === 'breakfast' || parsed?.type === 'lunch' || parsed?.type === 'dinner' || parsed?.type === 'snack') {
          targetType = parsed.type;
        }
        if (
          parsed?.slot === 'main' ||
          parsed?.slot === 'appetizer' ||
          parsed?.slot === 'drink' ||
          parsed?.slot === 'side' ||
          parsed?.slot === 'dessert' ||
          parsed?.slot === 'snack'
        ) {
          targetSlot = parsed.slot;
        }
      }
    } catch {
      // ignore parse errors
    } finally {
      sessionStorage.removeItem('bb:plan:addTarget');
    }
    const weekStartIso = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const weekEndIso = format(addDays(new Date(`${weekStartIso}T00:00:00.000Z`), 6), 'yyyy-MM-dd');

    let plan: MealPlan | null = plans.length > 0 ? plans[0] : null;
    if (!plan) {
      const newPlan: Omit<MealPlan, 'id'> = {
        ownerId: user.uid,
        startDate: weekStartIso,
        endDate: weekEndIso,
        days: [],
      };
      const id = await dataService.addMealPlan(user.uid, newPlan);
      if (!id) {
        toast.error('Failed to create meal plan');
        return;
      }
      plan = { ...newPlan, id };
    }

    const existingDay = plan.days.find((d) => d.date === targetDate);
    const nextMeals = existingDay ? [...existingDay.meals] : [];
    const alreadyAdded = nextMeals.some((m) => m.recipeId === recipe.id && m.type === targetType && (m.slot || 'main') === (targetSlot || 'main'));
    if (alreadyAdded) {
      toast.message('Already in this slot');
      return;
    }

    nextMeals.push({
      type: targetType,
      slot: targetSlot,
      recipeId: recipe.id,
      recipeTitle: recipe.title,
    });

    const nextDays: DayPlan[] = existingDay
      ? plan.days.map((d) => (d.date === targetDate ? { ...d, meals: nextMeals } : d))
      : [...plan.days, { date: targetDate, meals: nextMeals }];

    await dataService.updateMealPlan(user.uid, plan.id!, {
      ownerId: plan.ownerId,
      startDate: plan.startDate,
      endDate: plan.endDate,
      days: nextDays,
    });

    toast.success('Added to meal plan');
    setActiveRecipe(null);
  };

  const handleImportUrl = async () => {
    if (!importUrl.trim()) return;
    setImporting(true);
    try {
      const extracted = await extractRecipeFromUrl(importUrl);
      const baseRecipe: Omit<Recipe, 'id'> = {
        ownerId: user!.uid,
        title: extracted.title || 'Extracted Recipe',
        description: extracted.description || '',
        ingredients: extracted.ingredients || [],
        instructions: extracted.instructions || [],
        nutritionalInfo: extracted.nutritionalInfo,
        prepTime: extracted.prepTime,
        cookTime: extracted.cookTime,
        servings: extracted.servings,
        category: extracted.category,
        isFavorite: false,
        sourceUrl: importUrl.trim(),
        imageUrl: extracted.imageUrl,
        createdAt: new Date().toISOString(),
      };
      const recipe: Omit<Recipe, 'id'> = {
        ...baseRecipe,
        cleanIngredients: normalizeIngredients(baseRecipe.ingredients),
        tags: deriveRecipeTags(baseRecipe),
        imageUrl: baseRecipe.imageUrl || suggestRecipeImageUrl(baseRecipe),
      };
      await dataService.addRecipe(user!.uid, recipe);
      await loadRecipes();
      setImportUrl('');
      setShowUrlInput(false);
      setDialogOpen(false);
      toast.success('Recipe imported from URL!');
    } catch (e) {
      console.error('[Recipes] URL Import Error Trace:', e);
      toast.error('Failed to import URL. The site might be blocking AI access. Try pasting the text instead.');
    } finally {
      setImporting(false);
    }
  };

  const handleImportText = async () => {
    if (!importText.trim()) return;
    setImporting(true);
    try {
      console.log('[Recipes] Importing from text...');
      const extracted = await extractRecipeFromText(importText);
      const baseRecipe: Omit<Recipe, 'id'> = {
        ownerId: user!.uid,
        title: extracted.title || 'Extracted Recipe',
        description: extracted.description || '',
        ingredients: extracted.ingredients || [],
        instructions: extracted.instructions || [],
        nutritionalInfo: extracted.nutritionalInfo,
        prepTime: extracted.prepTime,
        cookTime: extracted.cookTime,
        servings: extracted.servings,
        category: extracted.category,
        isFavorite: false,
        imageUrl: extracted.imageUrl,
        createdAt: new Date().toISOString(),
      };
      const recipe: Omit<Recipe, 'id'> = {
        ...baseRecipe,
        cleanIngredients: normalizeIngredients(baseRecipe.ingredients),
        tags: deriveRecipeTags(baseRecipe),
        imageUrl: baseRecipe.imageUrl || suggestRecipeImageUrl(baseRecipe),
      };
      await dataService.addRecipe(user!.uid, recipe);
      await loadRecipes();
      setImportText('');
      setDialogOpen(false);
      toast.success('Recipe imported from text!');
    } catch (e) {
      console.error('[Recipes] Text Import Error Trace:', e);
      toast.error('Failed to extract recipe from text');
    } finally {
      setImporting(false);
    }
  };

  const resizeImage = (base64Str: string, maxWidth = 800, maxHeight = 800): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = base64Str;
      img.onerror = () => {
        console.error('[Recipes] Image load error');
        reject(new Error('Failed to load image for processing'));
      };
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxWidth) {
              height *= maxWidth / width;
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width *= maxHeight / height;
              height = maxHeight;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Could not get canvas context'));
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          const base64 = dataUrl.split(',')[1];
          if (!base64) {
            reject(new Error('Failed to generate base64 from canvas'));
            return;
          }
          resolve(base64);
        } catch (err) {
          console.error('[Recipes] Canvas processing error:', err);
          reject(err);
        }
      };
    });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Size check - Safari can struggle with very large files in memory
    if (file.size > 20 * 1024 * 1024) {
      toast.error('Image is too large. Please use a smaller photo (under 20MB).');
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => {
      toast.error('Failed to read the file. Please try again.');
    };
    reader.onload = async () => {
      const result = reader.result as string;
      if (!result) {
        setImporting(false);
        return;
      }
      
      setImporting(true);
      try {
        console.log('[Recipes] Resizing image for Gemini...');
        const base64 = await resizeImage(result).catch(err => {
          console.warn('[Recipes] Resize failed, falling back to original:', err);
          return result.split(',')[1];
        });
        
        console.log('[Recipes] Extracting from image...');
        const extracted = await extractRecipeFromImage(base64, "image/jpeg");
        
        const baseRecipe: Omit<Recipe, "id"> = {
          ownerId: user!.uid,
          title: extracted.title || 'Untitled Recipe',
          description: extracted.description || '',
          ingredients: extracted.ingredients || [],
          instructions: extracted.instructions || [],
          nutritionalInfo: extracted.nutritionalInfo,
          isFavorite: false,
          imageUrl: extracted.imageUrl,
          createdAt: new Date().toISOString(),
        };
        const recipe: Omit<Recipe, "id"> = {
          ...baseRecipe,
          cleanIngredients: normalizeIngredients(baseRecipe.ingredients),
          tags: deriveRecipeTags(baseRecipe),
          imageUrl: baseRecipe.imageUrl || suggestRecipeImageUrl(baseRecipe),
        };
        await dataService.addRecipe(user!.uid, recipe);
        await loadRecipes();
        setDialogOpen(false);
        toast.success('Recipe extracted from image!');
      } catch (e: any) {
        console.error('Image extraction error:', e);
        const errorMsg = e?.message || 'Check your internet connection or use a clearer photo.';
        toast.error(`Import failed: ${errorMsg}`);
      } finally {
        setImporting(false);
        // Clear the input so same file can be uploaded again
        e.target.value = '';
      }
    };
    reader.readAsDataURL(file);
  };

  const toggleFavorite = async (recipe: Recipe) => {
    await dataService.updateRecipe(user!.uid, recipe.id!, { isFavorite: !recipe.isFavorite });
    await loadRecipes();
  };

  const deleteRecipe = async (id: string) => {
    if (!confirm('Are you sure you want to delete this recipe?')) return;
    await dataService.deleteRecipe(user!.uid, id);
    await loadRecipes();
    setActiveRecipe(null);
    toast.success('Recipe deleted');
  };

  const filteredRecipes = recipes
    .filter((r) => {
      const q = search.toLowerCase().trim();
      const matchesSearch =
        !q ||
        r.title.toLowerCase().includes(q) ||
        (r.ingredients || []).some((i) => (i.name || '').toLowerCase().includes(q));
      const matchesTag = tagFilter === 'all' ? true : (r.tags || []).includes(tagFilter);
      return matchesSearch && matchesTag;
    })
    .sort((a, b) => {
      // default: newest first (createdAt), with fallback to title
      const ad = a.createdAt || '';
      const bd = b.createdAt || '';
      if (ad !== bd) return bd.localeCompare(ad);
      return a.title.localeCompare(b.title);
    });

  return (
    <div className="p-6 pb-24 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-3xl font-black tracking-tight text-primary">Recipe Vault</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={
            <button type="button" className="rounded-2xl bg-primary hover:bg-primary/90 shadow-sm inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-primary-foreground cursor-pointer">
              <Plus className="mr-2 h-4 w-4" /> Add New
            </button>
          } />
          <DialogContent className="sm:max-w-xl rounded-[1.75rem] border border-border/50 shadow-2xl p-0 overflow-hidden bg-card">
            <div className="bg-muted/60 p-6">
              <DialogHeader>
                <DialogTitle className="font-heading text-2xl font-bold text-primary">Add New Recipe</DialogTitle>
                <p className="text-sm text-muted-foreground italic">Paste text, upload an image, or drop a URL</p>
              </DialogHeader>
            </div>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <Button variant="outline" className="h-24 flex-col rounded-2xl gap-2 border-border bg-background/60 shadow-sm" onClick={() => document.getElementById('img-up')?.click()}>
                  <Camera className="h-6 w-6 text-primary" />
                  <span className="text-xs uppercase tracking-wider font-bold">Image/Scan</span>
                  <input type="file" id="img-up" hidden accept="image/*" onChange={handleImageUpload} />
                </Button>
                <Button 
                  variant="outline" 
                  className={cn(
                    "h-24 flex-col rounded-2xl gap-2 border-border bg-background/60 shadow-sm transition-all",
                    showUrlInput && "ring-2 ring-primary scale-95"
                  )}
                  onClick={() => setShowUrlInput(!showUrlInput)}
                >
                  <Link className="h-6 w-6 text-primary" />
                  <span className="text-xs uppercase tracking-wider font-bold">URL Import</span>
                </Button>
              </div>

              {showUrlInput && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                  <Label className="text-xs uppercase tracking-widest font-bold ml-1 text-muted-foreground">Website Recipe URL</Label>
                  <div className="flex gap-2">
                    <Input 
                      placeholder="https://cooking.nytimes.com/..." 
                      className="rounded-xl border-border h-11 bg-background"
                      value={importUrl}
                      onChange={(e) => setImportUrl(e.target.value)}
                    />
                    <Button onClick={handleImportUrl} disabled={importing || !importUrl.trim()} className="bg-primary rounded-xl px-6">
                      Fetch
                    </Button>
                  </div>
                </div>
              )}
              
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-widest font-bold ml-1 text-muted-foreground">Text Entry / Transcription</Label>
                <textarea 
                  data-testid="recipes-import-text"
                  className="w-full min-h-[150px] p-4 rounded-2xl border border-border bg-background/60 focus:ring-1 focus:ring-primary outline-none text-sm leading-relaxed"
                  placeholder="Paste recipe instructions and ingredients here..."
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                />
              </div>

              {importing && (
                <div className="flex items-center justify-center py-4 gap-3 bg-muted rounded-2xl animate-pulse">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-sm font-medium text-muted-foreground">Gemini is analyzing context...</span>
                </div>
              )}
            </div>
            <DialogFooter className="p-6 bg-muted/40">
              <Button data-testid="recipes-import-submit" onClick={handleImportText} disabled={importing || !importText.trim()} className="w-full rounded-xl bg-primary hover:bg-primary/90">
                Extract & Save Recipe
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative group">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <Input 
          placeholder="Search recipes, ingredients..." 
          className="pl-12 h-14 rounded-2xl border-border bg-background/70 backdrop-blur-sm shadow-sm focus-visible:ring-primary"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button
          size="icon"
          variant="ghost"
          className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 text-muted-foreground hover:bg-muted rounded-xl"
          onClick={() => setFilterOpen((v) => !v)}
          aria-label="Filter recipes"
        >
          <Filter className="h-5 w-5" />
        </Button>

        {filterOpen && (
          <div className="absolute z-50 right-0 mt-3 w-full sm:w-[420px] bg-card border border-border/60 shadow-xl rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Sort / Filter</p>
              <Button variant="ghost" size="sm" className="rounded-xl" onClick={() => setFilterOpen(false)}>
                Close
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['all', 'All'],
                  ['breakfast', 'Breakfast'],
                  ['lunch', 'Lunch'],
                  ['dinner', 'Dinner'],
                  ['snack', 'Snack'],
                  ['appetizer', 'Appetizer'],
                  ['drink', 'Drink'],
                  ['main', 'Main'],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  variant={tagFilter === value ? 'default' : 'outline'}
                  className="rounded-xl h-9"
                  onClick={() => setTagFilter(value as any)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Showing <span className="font-semibold text-foreground">{filteredRecipes.length}</span>
              </p>
              <Button
                variant="ghost"
                className="rounded-xl"
                onClick={() => {
                  setTagFilter('all');
                  setSearch('');
                }}
              >
                Clear
              </Button>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center gap-4 text-muted-foreground/40">
          <Loader2 className="h-10 w-10 animate-spin" />
          <p className="font-medium italic">Opening the vault...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredRecipes.map((recipe) => (
            <Card 
              key={recipe.id} 
              className="rounded-[1.75rem] border border-border/50 shadow-sm overflow-hidden group cursor-pointer hover:scale-[1.02] transition-transform duration-300 bg-card"
              onClick={() => setActiveRecipe(recipe)}
            >
              <div className="relative h-48 bg-muted overflow-hidden">
                {recipe.imageUrl ? (
                  <img src={recipe.imageUrl} alt={recipe.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted/50 to-muted">
                    <ChefHat className="h-16 w-16 text-muted-foreground/30" />
                  </div>
                )}
                <div className="absolute top-4 right-4 z-10">
                  <Button 
                    size="icon" 
                    variant="ghost" 
                    className={cn(
                      "rounded-xl bg-white/20 backdrop-blur-md hover:bg-white/40 transition-colors",
                      recipe.isFavorite ? "text-red-500 fill-red-500" : "text-white"
                    )}
                    onClick={(e) => { e.stopPropagation(); toggleFavorite(recipe); }}
                  >
                    <Heart className="h-5 w-5" />
                  </Button>
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/60 to-transparent">
                  <Badge className="bg-primary border-none text-primary-foreground font-semibold">{recipe.category || 'Entree'}</Badge>
                </div>
              </div>
              <CardContent className="p-6 space-y-4">
                <div>
                  <h3 className="font-bold text-xl mb-2 line-clamp-1">{recipe.title}</h3>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1"><Timer className="h-4 w-4" /> {(recipe.prepTime || 0) + (recipe.cookTime || 0) || 30}m</span>
                    <span className="flex items-center gap-1"><Flame className="h-4 w-4" /> {recipe.nutritionalInfo?.calories || 450} kcal</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    <span>Ingredients</span>
                    <span>{recipe.ingredients.length} total</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {recipe.ingredients.slice(0, 3).map((ing, i) => (
                      <Badge key={i} variant="secondary" className="bg-muted text-[10px] py-0 px-2 font-medium text-primary border-border">
                        {ing.name}
                      </Badge>
                    ))}
                    {recipe.ingredients.length > 3 && (
                      <span className="text-[10px] text-muted-foreground font-semibold">+{recipe.ingredients.length - 3} more</span>
                    )}
                  </div>
                </div>

                {recipe.instructions.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">First Step</p>
                    <p className="text-sm text-muted-foreground line-clamp-2 italic leading-snug">
                      "{recipe.instructions[0]}"
                    </p>
                  </div>
                )}
                
                <div className="pt-2 border-t border-border flex items-center justify-between group-hover:text-primary transition-colors">
                  <span className="text-xs font-bold uppercase tracking-widest">View Full Recipe</span>
                  <Plus className="h-4 w-4 transform group-hover:rotate-90 transition-transform" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!activeRecipe} onOpenChange={(o) => {
        if (!o) setActiveRecipe(null);
      }}>
        <DialogContent 
          className={cn(
            "p-0 overflow-hidden border border-border/50 shadow-2xl flex flex-col outline-none bg-card",
            "w-full max-w-full h-full sm:w-[calc(100%-2rem)] sm:h-[90dvh] sm:max-w-2xl sm:rounded-[2.5rem]",
            "m-0 sm:m-auto",
            "z-[100]"
          )}
          showCloseButton={false}
        >
          <div 
            className="flex-1 overflow-y-auto overscroll-contain scroll-smooth -webkit-overflow-scrolling-touch bg-background"
            style={{ 
              // Fix for Safari mobile viewport height issues with nested scrolls
              height: '100%',
              minHeight: '100%',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            <div className="relative h-64 sm:h-80 bg-muted">
              <Button 
                size="icon" 
                variant="ghost" 
                className="absolute top-4 right-4 sm:top-6 sm:right-6 z-20 bg-black/20 backdrop-blur-md rounded-2xl text-white hover:bg-black/40"
                onClick={() => setActiveRecipe(null)}
              >
                <X className="h-6 w-6" />
              </Button>
              {activeRecipe?.imageUrl ? (
                <img src={activeRecipe.imageUrl} alt={activeRecipe.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-background">
                  <ChefHat className="h-24 w-24 text-muted-foreground/30" />
                </div>
              )}
              <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8 pt-16 sm:pt-20 bg-gradient-to-t from-background via-background/80 to-transparent">
                 <h2 className="font-heading text-2xl sm:text-4xl font-bold leading-tight text-primary">{activeRecipe?.title}</h2>
              </div>
            </div>
            
            <div className="p-6 sm:p-8 space-y-6 sm:space-y-8 bg-background pb-12">
              {activeRecipe?.description && (
                <div className="bg-muted/60 rounded-3xl p-5 sm:p-6 border border-border/50">
                  <p className="text-muted-foreground italic leading-relaxed text-base sm:text-lg">
                    "{activeRecipe.description}"
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <div className="bg-card rounded-2xl sm:rounded-3xl p-3 sm:p-4 shadow-sm border border-border/50">
                   <div className="flex items-center gap-2 mb-1">
                     <Timer className="h-3 w-3 text-primary" />
                     <p className="font-label text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">Time</p>
                   </div>
                   <p className="font-bold text-base sm:text-lg">{(activeRecipe?.prepTime || 0) + (activeRecipe?.cookTime || 0)}m</p>
                </div>
                <div className="bg-card rounded-2xl sm:rounded-3xl p-3 sm:p-4 shadow-sm border border-border/50">
                   <div className="flex items-center gap-2 mb-1">
                     <ChefHat className="h-3 w-3 text-primary" />
                     <p className="font-label text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">Servings</p>
                   </div>
                   <p className="font-bold text-base sm:text-lg">{activeRecipe?.servings || 2}</p>
                </div>
                <div className="bg-card rounded-2xl sm:rounded-3xl p-3 sm:p-4 shadow-sm border border-border/50">
                   <div className="flex items-center gap-2 mb-1">
                     <Flame className="h-3 w-3 text-primary" />
                     <p className="font-label text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">Calories</p>
                   </div>
                   <p className="font-bold text-base sm:text-lg">{activeRecipe?.nutritionalInfo?.calories || '--'} <span className="text-sm font-normal">kcal</span></p>
                </div>
                <div className="bg-card rounded-2xl sm:rounded-3xl p-3 sm:p-4 shadow-sm border border-border/50">
                   <p className="font-label text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-1">Nutrients (P/C/F)</p>
                   <p className="font-bold text-xs sm:text-sm">
                     {activeRecipe?.nutritionalInfo?.protein || 0}g / {activeRecipe?.nutritionalInfo?.carbs || 0}g / {activeRecipe?.nutritionalInfo?.fat || 0}g
                   </p>
                </div>
              </div>

              <div className="space-y-6">
                <div>
                   <div className="flex items-center justify-between mb-4">
                     <h3 className="font-heading text-xl sm:text-2xl font-bold flex items-center gap-2 text-primary">Ingredients</h3>
                     <Badge variant="outline" className="rounded-full border-border text-primary bg-muted font-semibold">
                       {activeRecipe?.ingredients.length} items
                     </Badge>
                   </div>
                   <div className="grid gap-2 sm:gap-3">
                     {activeRecipe?.ingredients.map((ing, i) => (
                       <div key={i} className="flex items-center justify-between p-3 sm:p-4 bg-card rounded-xl sm:rounded-2xl border border-border/50 shadow-sm hover:border-border transition-colors">
                         <div className="flex items-center gap-2 sm:gap-3">
                           <div className="w-1.5 h-1.5 rounded-full bg-primary/60" />
                           <span className="font-medium text-primary text-sm sm:text-base">{ing.name}</span>
                         </div>
                         <span className="text-primary font-semibold px-2 sm:px-3 py-1 bg-muted rounded-full text-xs sm:text-sm whitespace-nowrap">{ing.amount} {ing.unit}</span>
                       </div>
                     ))}
                   </div>
                </div>

                <div>
                   <h3 className="font-heading text-xl sm:text-2xl font-bold mb-4 flex items-center gap-2 text-primary">Preparation Steps</h3>
                   <div className="space-y-6 sm:space-y-8 relative before:absolute before:left-4 before:top-4 before:bottom-4 before:w-0.5 before:bg-border">
                     {activeRecipe?.instructions.map((step, i) => (
                       <div key={i} className="flex gap-4 sm:gap-6 relative">
                         <div className="flex-shrink-0 w-8 h-8 rounded-full bg-card border-2 border-primary flex items-center justify-center font-bold text-primary shadow-sm z-10 text-sm sm:text-base">
                           {i + 1}
                         </div>
                         <p className="text-base sm:text-lg leading-relaxed text-muted-foreground pt-0.5">{step}</p>
                       </div>
                     ))}
                   </div>
                </div>
              </div>

              <div className="pt-8 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <Button variant="outline" className="rounded-xl h-12 order-2 sm:order-1" onClick={() => deleteRecipe(activeRecipe!.id!)}>
                  <Trash2 className="h-4 w-4 mr-2" /> Delete Recipe
                </Button>
                <Button className="rounded-xl h-12 bg-primary order-1 sm:order-2" onClick={() => addRecipeToMealPlan(activeRecipe!)}>
                  Add to Meal Plan
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// End of Recipes
