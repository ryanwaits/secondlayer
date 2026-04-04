"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import "@/styles/console.css";
import "@/styles/marketplace.css";

function EscBack() {
	const router = useRouter();
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (
				e.target instanceof HTMLInputElement ||
				e.target instanceof HTMLTextAreaElement
			)
				return;
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			if (e.key === "Escape") {
				router.back();
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [router]);
	return null;
}

export default function MarketplaceLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<div className="marketing">
			<EscBack />
			{children}
		</div>
	);
}
