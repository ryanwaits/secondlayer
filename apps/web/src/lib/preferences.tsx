"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

interface Products {
  streams: boolean;
  subgraphs: boolean;
}

interface Preferences {
  products: Products;
  onboardingComplete: boolean;
}

interface PreferencesCtx {
  preferences: Preferences;
  setProducts(products: Products): void;
  completeOnboarding(): void;
  showOnboarding: boolean;
}

const STORAGE_KEY = "sl:preferences";

const DEFAULT: Preferences = {
  products: { streams: true, subgraphs: true },
  onboardingComplete: false,
};

function read(): Preferences {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    return { ...DEFAULT, ...JSON.parse(raw) };
  } catch {
    return DEFAULT;
  }
}

function write(prefs: Preferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {}
}

const PreferencesContext = createContext<PreferencesCtx | null>(null);

export function PreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setPreferences(read());
    setMounted(true);
  }, []);

  const setProducts = useCallback((products: Products) => {
    setPreferences((prev) => {
      const next = { ...prev, products };
      write(next);
      return next;
    });
  }, []);

  const completeOnboarding = useCallback(() => {
    setPreferences((prev) => {
      const next = { ...prev, onboardingComplete: true };
      write(next);
      return next;
    });
  }, []);

  const showOnboarding = mounted && !preferences.onboardingComplete;

  return (
    <PreferencesContext.Provider
      value={{ preferences, setProducts, completeOnboarding, showOnboarding }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesCtx {
  const ctx = useContext(PreferencesContext);
  if (!ctx)
    throw new Error("usePreferences must be used within PreferencesProvider");
  return ctx;
}
