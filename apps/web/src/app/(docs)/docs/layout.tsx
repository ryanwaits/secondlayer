"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { CssStudioDev } from "./css-studio-dev";

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

export default function MarketingLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<div className="marketing">
			<EscBack />
			<CssStudioDev />
			{children}
		</div>
	);
}
