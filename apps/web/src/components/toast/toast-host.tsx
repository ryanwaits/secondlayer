"use client";

import { useEffect } from "react";
import { Toaster, type ToasterProps, toast } from "sonner";
import { isUndoShortcut, takeUndo } from "./notify";

export function ToastHost({
	position = "bottom-right",
	offset,
	mobileOffset,
}: Pick<ToasterProps, "position" | "offset" | "mobileOffset">) {
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!isUndoShortcut(e)) return;
			const entry = takeUndo();
			if (!entry) return;
			e.preventDefault();
			void entry.run();
			toast.dismiss(entry.id);
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, []);

	return (
		<Toaster
			position={position}
			offset={offset}
			mobileOffset={mobileOffset}
			gap={8}
			visibleToasts={3}
			toastOptions={{ unstyled: true }}
		/>
	);
}
