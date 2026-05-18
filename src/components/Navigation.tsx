import React from 'react';
import { Home, UtensilsCrossed, Calendar, ShoppingCart, User } from 'lucide-react';
import { cn } from '@/lib/utils';

export type Tab = 'dashboard' | 'recipes' | 'planner' | 'shopping' | 'profile';

interface NavigationProps {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
}

export const Navigation: React.FC<NavigationProps> = ({ activeTab, setActiveTab }) => {
  const navItems = [
    { id: 'dashboard', label: 'Home', icon: Home },
    { id: 'recipes', label: 'Recipes', icon: UtensilsCrossed },
    { id: 'planner', label: 'Meal Plan', icon: Calendar },
    { id: 'shopping', label: 'Shopping', icon: ShoppingCart },
    { id: 'profile', label: 'Me', icon: User },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex h-20 items-center justify-around border-t border-border bg-background/80 px-4 pb-2 backdrop-blur-xl shadow-[0_-4px_20px_-5px_rgba(47,53,59,0.06)]"
      aria-label="Primary navigation"
      data-testid="nav-primary"
    >
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = activeTab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveTab(item.id as Tab)}
            data-testid={`nav-${item.id}`}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'group flex min-w-[3.5rem] flex-col items-center justify-center space-y-1 transition-all duration-300',
              isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <div
              className={cn(
                'rounded-2xl p-2 transition-all duration-300',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-md ring-2 ring-primary/25 scale-105'
                  : 'text-current group-hover:bg-muted/90 group-hover:text-foreground'
              )}
            >
              <Icon className="h-6 w-6" aria-hidden />
            </div>
            <span
              className={cn(
                'font-label text-[10px] font-semibold uppercase tracking-widest',
                isActive && 'text-primary'
              )}
            >
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
