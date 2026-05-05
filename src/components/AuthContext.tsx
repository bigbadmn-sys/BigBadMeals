import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, User, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { Button } from '@/components/ui/button';
import { LogIn, Loader2 } from 'lucide-react';
import { firestoreService } from '../services/firestoreService';
import { UserProfile } from '../types';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: () => Promise<void>;
  e2eSignIn: () => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export const AuthContext = React.createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  signIn: async () => {},
  e2eSignIn: async () => {},
  logout: async () => {},
  refreshProfile: async () => {},
});

type E2EUserState = {
  uid: string;
  email: string;
  displayName: string;
};

const E2E_USER_STORAGE_KEY = 'bigbad.e2eUser';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (import.meta.env.VITE_DISABLE_AUTH === 'true') {
      const testUser = { uid: 'test-user', email: 'test@example.com', displayName: 'Test User' } as unknown as User;
      const testProfile: UserProfile = {
        uid: 'test-user',
        email: 'test@example.com',
        displayName: 'Test User',
        familyMembers: [],
        globalPreferences: { cuisines: [], dietaryRestrictions: [], budgetLimit: 0 },
        inventory: [],
      };
      setUser(testUser);
      setProfile(testProfile);
      setLoading(false);
      return;
    }

    if (import.meta.env.VITE_E2E_AUTH === 'true') {
      try {
        const raw = window.localStorage.getItem(E2E_USER_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as E2EUserState;
          if (parsed?.uid && parsed?.email) {
            const e2eUser = {
              uid: parsed.uid,
              email: parsed.email,
              displayName: parsed.displayName,
            } as unknown as User;

            const e2eProfile: UserProfile = {
              uid: parsed.uid,
              email: parsed.email,
              displayName: parsed.displayName || 'E2E User',
              familyMembers: [],
              globalPreferences: { cuisines: [], dietaryRestrictions: [], budgetLimit: 0 },
              inventory: [],
            };

            setUser(e2eUser);
            setProfile(e2eProfile);
          }
        }
      } catch (e) {
        console.warn('[Auth] Failed to restore E2E auth state', e);
      } finally {
        setLoading(false);
      }
      return;
    }

    const PROFILE_BOOTSTRAP_MS = 15_000;

    const unsub = onAuthStateChanged(auth, async (u) => {
      try {
        setUser(u);
        if (!u) {
          setProfile(null);
          return;
        }

        const minimalProfile = (): UserProfile => ({
          uid: u.uid,
          email: u.email || '',
          displayName: u.displayName || 'User',
          familyMembers: [],
          globalPreferences: {
            cuisines: [],
            dietaryRestrictions: [],
            budgetLimit: 0,
          },
          inventory: [],
        });

        const bootstrap = async () => {
          const p = await firestoreService.getUserProfile(u.uid);
          if (p) {
            setProfile(p);
            return;
          }
          const newProfile = minimalProfile();
          await firestoreService.saveUserProfile(newProfile);
          setProfile(newProfile);
        };

        try {
          await Promise.race([
            bootstrap(),
            new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error('profile_bootstrap_timeout')), PROFILE_BOOTSTRAP_MS);
            }),
          ]);
        } catch (e) {
          console.warn('[Auth] Profile bootstrap failed or timed out; using local minimal profile.', e);
          setProfile(minimalProfile());
        }
      } finally {
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  const signIn = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const e2eSignIn = async () => {
    const state: E2EUserState = {
      uid: 'e2e-user',
      email: 'e2e@example.com',
      displayName: 'E2E User',
    };
    window.localStorage.setItem(E2E_USER_STORAGE_KEY, JSON.stringify(state));
    const e2eUser = {
      uid: state.uid,
      email: state.email,
      displayName: state.displayName,
    } as unknown as User;
    const e2eProfile: UserProfile = {
      uid: state.uid,
      email: state.email,
      displayName: state.displayName,
      familyMembers: [],
      globalPreferences: { cuisines: [], dietaryRestrictions: [], budgetLimit: 0 },
      inventory: [],
    };
    setUser(e2eUser);
    setProfile(e2eProfile);
  };

  const logout = async () => {
    if (import.meta.env.VITE_E2E_AUTH === 'true') {
      window.localStorage.removeItem(E2E_USER_STORAGE_KEY);
      setUser(null);
      setProfile(null);
      return;
    }
    await signOut(auth);
  };

  const refreshProfile = async () => {
    if (user) {
      const p = await firestoreService.getUserProfile(user.uid);
      setProfile(p);
    }
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, e2eSignIn, logout, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const AuthGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading, signIn, e2eSignIn } = React.useContext(AuthContext);
  const disableAuth = import.meta.env.VITE_DISABLE_AUTH === 'true';
  const e2eAuth = import.meta.env.VITE_E2E_AUTH === 'true';

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#fdfaf6]">
        <Loader2 className="h-8 w-8 animate-spin text-[#d97706]" />
      </div>
    );
  }

  if (disableAuth) {
    return <>{children}</>;
  }

  if (!user) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-[#fdfaf6] px-6 text-center">
        <h1 className="mb-2 text-4xl font-bold tracking-tight text-[#451a03]">BigBadMeal Prep</h1>
        <p className="mb-8 text-lg text-[#92400e]">Smart fuel for your family, simplified with AI.</p>
        {e2eAuth && (
          <Button
            data-testid="e2e-login"
            onClick={e2eSignIn}
            className="mb-3 w-full max-w-xs h-14 text-lg bg-black hover:bg-black/90 text-white shadow-xl rounded-2xl"
          >
            Continue as E2E user
          </Button>
        )}
        <Button 
          onClick={signIn} 
          className="w-full max-w-xs h-14 text-lg bg-[#d97706] hover:bg-[#b45309] text-white shadow-xl rounded-2xl"
        >
          <LogIn className="mr-2 h-5 w-5" />
          Sign in with Google
        </Button>
      </div>
    );
  }

  return <>{children}</>;
};
