"use client";

import type { Insight } from "@/lib/insights";
import { type ReactNode, useState } from "react";
import { ShareFixSheet } from "../share/share-fix-sheet";
import { InsightSheet } from "./insight-sheet";

type SheetState = { kind: "insight" | "share"; id: string } | null;

export function useInsightSheets(insights: readonly Insight[]): {
	open: (id: string) => void;
	sheets: ReactNode;
} {
	const [sheet, setSheet] = useState<SheetState>(null);
	const selected = sheet
		? (insights.find((i) => i.id === sheet.id) ?? null)
		: null;
	const close = () => setSheet(null);
	return {
		open: (id) => setSheet({ kind: "insight", id }),
		sheets: (
			<>
				<InsightSheet
					insight={sheet?.kind === "insight" ? selected : null}
					onClose={close}
					extraAction={
						selected && selected.severity !== "recovered" ? (
							<button
								type="button"
								className="btn"
								onClick={() => setSheet({ kind: "share", id: selected.id })}
							>
								Share fix
							</button>
						) : null
					}
				/>
				<ShareFixSheet
					insight={sheet?.kind === "share" ? selected : null}
					onClose={close}
				/>
			</>
		),
	};
}
