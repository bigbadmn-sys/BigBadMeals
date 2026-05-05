import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  serverTimestamp,
  orderBy
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { Recipe, UserProfile, MealPlan, GroceryList } from '../types';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function sanitizeData(data: any): any {
  return JSON.parse(JSON.stringify(data));
}

export const firestoreService = {
  // User Profile
  async getUserProfile(uid: string): Promise<UserProfile | null> {
    const path = `users/${uid}`;
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      return snap.exists() ? snap.data() as UserProfile : null;
    } catch (e) {
      // Do not throw: callers (e.g. auth bootstrap) must finish and clear loading UI.
      console.error('[Firestore] getUserProfile failed', path, e);
      return null;
    }
  },

  async saveUserProfile(profile: UserProfile): Promise<void> {
    const path = `users/${profile.uid}`;
    try {
      await setDoc(doc(db, 'users', profile.uid), sanitizeData(profile));
    } catch (e) {
      console.error('[Firestore] saveUserProfile failed', path, e);
    }
  },

  // Recipes
  async getRecipes(userId: string): Promise<Recipe[]> {
    const path = `users/${userId}/recipes`;
    try {
      const q = query(collection(db, 'users', userId, 'recipes'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as Recipe));
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, path);
      return [];
    }
  },

  async addRecipe(userId: string, recipe: Omit<Recipe, 'id'>): Promise<string> {
    const path = `users/${userId}/recipes`;
    try {
      const data = sanitizeData({
        ...recipe,
        createdAt: new Date().toISOString()
      });
      const docRef = await addDoc(collection(db, 'users', userId, 'recipes'), data);
      return docRef.id;
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, path);
      return '';
    }
  },

  async updateRecipe(userId: string, recipeId: string, updates: Partial<Recipe>): Promise<void> {
    const path = `users/${userId}/recipes/${recipeId}`;
    try {
      await updateDoc(doc(db, 'users', userId, 'recipes', recipeId), sanitizeData(updates) as any);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, path);
    }
  },

  async deleteRecipe(userId: string, recipeId: string): Promise<void> {
    const path = `users/${userId}/recipes/${recipeId}`;
    try {
      await deleteDoc(doc(db, 'users', userId, 'recipes', recipeId));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, path);
    }
  },

  // Meal Plans
  async getMealPlans(userId: string): Promise<MealPlan[]> {
    const path = `users/${userId}/mealPlans`;
    try {
      const q = query(collection(db, 'users', userId, 'mealPlans'), orderBy('startDate', 'desc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as MealPlan));
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, path);
      return [];
    }
  },

  async addMealPlan(userId: string, plan: Omit<MealPlan, 'id'>): Promise<string> {
    const path = `users/${userId}/mealPlans`;
    try {
      const docRef = await addDoc(collection(db, 'users', userId, 'mealPlans'), sanitizeData(plan));
      return docRef.id;
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, path);
      return '';
    }
  },

  async updateMealPlan(userId: string, planId: string, updates: Partial<MealPlan>): Promise<void> {
    const path = `users/${userId}/mealPlans/${planId}`;
    try {
      await updateDoc(doc(db, 'users', userId, 'mealPlans', planId), sanitizeData(updates) as any);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, path);
    }
  },

  // Grocery Lists
  async getGroceryLists(userId: string): Promise<GroceryList[]> {
    const path = `users/${userId}/groceryLists`;
    try {
      const q = query(collection(db, 'users', userId, 'groceryLists'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as GroceryList));
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, path);
      return [];
    }
  },

  async addGroceryList(userId: string, list: Omit<GroceryList, 'id'>): Promise<string> {
    const path = `users/${userId}/groceryLists`;
    try {
      const data = sanitizeData({
        ...list,
        createdAt: new Date().toISOString()
      });
      const docRef = await addDoc(collection(db, 'users', userId, 'groceryLists'), data);
      return docRef.id;
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, path);
      return '';
    }
  },

  async updateGroceryList(userId: string, listId: string, updates: Partial<GroceryList>): Promise<void> {
    const path = `users/${userId}/groceryLists/${listId}`;
    try {
      await updateDoc(doc(db, 'users', userId, 'groceryLists', listId), sanitizeData(updates) as any);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, path);
    }
  },

  async deleteGroceryList(userId: string, listId: string): Promise<void> {
    const path = `users/${userId}/groceryLists/${listId}`;
    try {
      await deleteDoc(doc(db, 'users', userId, 'groceryLists', listId));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, path);
    }
  },
};
