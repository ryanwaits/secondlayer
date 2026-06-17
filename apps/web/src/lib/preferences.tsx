"use client";

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";

type SubgraphsView = "list" | "cards";

interface Preferences {
	onboardingComplete: boolean;
	subgraphsView: SubgraphsView;
}

interface PreferencesCtx {
	showOnboarding: boolean;
	completeOnboarding(): void;
	subgraphsView: SubgraphsView;
	setSubgraphsView(view: SubgraphsView): void;
}

const STORAGE_KEY = "sl:preferences";

const DEFAULT: Preferences = {
	onboardingComplete: false,
	subgraphsView: "list",
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

	const completeOnboarding = useCallback(() => {
		setPreferences((prev) => {
			const next = { ...prev, onboardingComplete: true };
			write(next);
			return next;
		});
	}, []);

	const setSubgraphsView = useCallback((view: SubgraphsView) => {
		setPreferences((prev) => {
			const next = { ...prev, subgraphsView: view };
			write(next);
			return next;
		});
	}, []);

	const showOnboarding = mounted && !preferences.onboardingComplete;
	// Default to "list" until the stored preference is read, so the first paint
	// is stable and matches SSR (avoids a flash of the wrong view).
	const subgraphsView = mounted ? preferences.subgraphsView : "list";

	return (
		<PreferencesContext.Provider
			value={{
				showOnboarding,
				completeOnboarding,
				subgraphsView,
				setSubgraphsView,
			}}
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
