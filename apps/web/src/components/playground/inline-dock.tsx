"use client";

import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";

/**
 * Reusable slide-out dock. A server product page wraps its body in
 * <DockProvider> and swaps its primary CTA for <DockTrigger>; the rest of the
 * page stays a server component (status fetch etc. intact). On open the whole
 * page body shifts + blurs (locked Subtle motion) and `panel` docks sharp on
 * the right. Outside-click or Escape closes.
 */

const DockContext = createContext<{ open: () => void } | null>(null);

export function DockProvider({
	panel,
	panelWidth,
	children,
}: {
	panel: ReactNode;
	/** Override the default 440px panel width (e.g. the wider agent window). */
	panelWidth?: number;
	children: ReactNode;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const panelRef = useRef<HTMLDivElement>(null);
	const close = useCallback(() => setIsOpen(false), []);
	const open = useCallback(() => setIsOpen(true), []);

	// While open, the shifted body is pointer-events:none, so an outside click
	// (anything not inside the panel) or Escape is the close path.
	useEffect(() => {
		if (!isOpen) return;
		function onDown(e: MouseEvent) {
			if (!panelRef.current?.contains(e.target as Node)) close();
		}
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") close();
		}
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [isOpen, close]);

	return (
		<DockContext.Provider value={{ open }}>
			<div className={`sl-dock${isOpen ? " open" : ""}`}>
				<div className="sl-dock-body">{children}</div>
				<div
					className="sl-dock-panel"
					ref={panelRef}
					style={panelWidth ? { width: panelWidth } : undefined}
				>
					{panel}
				</div>
			</div>
		</DockContext.Provider>
	);
}

export function useDock() {
	const ctx = useContext(DockContext);
	if (!ctx) throw new Error("useDock must be used within <DockProvider>");
	return ctx;
}

/** Drop-in replacement for the page's primary CTA button; opens the dock. */
export function DockTrigger(props: React.ComponentProps<"button">) {
	const { open } = useDock();
	return <button type="button" {...props} onClick={open} />;
}
