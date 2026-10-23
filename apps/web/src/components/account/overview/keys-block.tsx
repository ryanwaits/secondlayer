"use client";

import type { ApiKey, ConnectedApp } from "@/lib/types";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { AppsTable } from "../keys/apps-table";
import { groupKeys } from "../keys/key-view";
import { FRESH_MS, KeysTable } from "../keys/keys-screen";
import { NewKeyFlow, PREFIX_LENGTH } from "../keys/new-key-flow";

/** The block's markup: heading, New key, the flow when open, keys, then apps. */
export function KeysBlockView({
	keys,
	apps,
	now,
	flow,
	freshPrefix = null,
	onNew,
}: {
	keys: ApiKey[] | null;
	apps: ConnectedApp[] | null;
	now: Date;
	/** The create flow, while it is open; the New key button hides meanwhile. */
	flow?: ReactNode;
	freshPrefix?: string | null;
	onNew: () => void;
}) {
	return (
		<section className="ov-section" aria-label="Keys and apps">
			<div className="ov-section-h">
				<h2>Keys and apps</h2>
				{flow ? null : (
					<button
						type="button"
						className="acct-btn solid small"
						onClick={onNew}
					>
						New key
					</button>
				)}
			</div>
			{flow}
			<KeysTable keys={keys} now={now} freshPrefix={freshPrefix} />
			<AppsTable apps={apps} now={now} />
		</section>
	);
}

/** Keys and connected apps on the Account page. The container loads both lists. */
export function KeysBlock({
	keys,
	apps,
	now,
}: {
	keys: ApiKey[] | null;
	apps: ConnectedApp[] | null;
	now: Date;
}) {
	const [creating, setCreating] = useState(false);
	const [freshPrefix, setFreshPrefix] = useState<string | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);
	const markFresh = useCallback((key: string) => {
		setFreshPrefix(key.slice(0, PREFIX_LENGTH));
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => setFreshPrefix(null), FRESH_MS);
	}, []);

	const existingNames = groupKeys(keys, now)
		.own.filter((k) => k.product !== "docs")
		.map((k) => k.name);

	return (
		<KeysBlockView
			keys={keys}
			apps={apps}
			now={now}
			freshPrefix={freshPrefix}
			onNew={() => setCreating(true)}
			flow={
				creating ? (
					<NewKeyFlow
						existingNames={existingNames}
						onCreated={markFresh}
						onClose={() => setCreating(false)}
					/>
				) : null
			}
		/>
	);
}
