"use client";

import { displayClientName } from "@/app/(www)/cli/login/cli-login";
import { Skel } from "@/components/dashboard/shell/skel";
import { HoldButton } from "@/components/mobile/hold-button";
import { revokeApp, revokeKey } from "@/lib/account-data";
import { shortCount } from "@/lib/subgraph-view";
import type { ApiKey, ConnectedApp } from "@/lib/types";
import { toast } from "sonner";
import { agoShort, groupKeys, keyFlags, revokedOwnKeys } from "./key-view";

type KeyLook = { dot: "ok" | "ring" | "off"; line: string };

/** The dot and the one line a key shows: when it was last used, or why it is quiet. */
export function keyLook(k: ApiKey, now: Date): KeyLook {
	if (k.status === "revoked") return { dot: "off", line: "Revoked" };
	const { staleDays } = keyFlags(k, now);
	if (staleDays !== undefined) {
		return { dot: "ring", line: `Unused for ${staleDays} days` };
	}
	if (!k.lastUsedAt) return { dot: "ok", line: "Never used" };
	const used = `Used ${agoShort(k.lastUsedAt, now)} ago`;
	return {
		dot: "ok",
		line:
			k.rows30d === undefined
				? used
				: `${used} · ${shortCount(k.rows30d)} rows 30d`,
	};
}

/** The keys the phone lists: the ones you made, in use first, revoked last. */
export function phoneKeys(keys: ApiKey[], now: Date): ApiKey[] {
	return [
		...groupKeys(keys, now).own.filter((k) => k.product !== "docs"),
		...revokedOwnKeys(keys),
	];
}

function RowSkeleton() {
	return (
		<div className="mac-skel-row" aria-hidden="true">
			<Skel width={8} height={8} style={{ borderRadius: "50%" }} />
			<span className="mac-skel-text">
				<Skel width="46%" height={14} />
				<Skel width="72%" height={12} />
			</span>
		</div>
	);
}

function HoldRow({
	name,
	line,
	holdLabel,
	onConfirm,
	revoked = false,
}: {
	name: string;
	line: string;
	holdLabel: string;
	onConfirm: () => void;
	revoked?: boolean;
}) {
	return (
		<li className="ma-key">
			<span className="ma-key-main">
				<span className={`ma-key-name${revoked ? " is-revoked" : ""}`}>
					{name}
				</span>
				<span className="ma-key-line">{line}</span>
			</span>
			{revoked ? null : (
				<span className="ma-hold">
					<HoldButton label={holdLabel} onConfirm={onConfirm} />
				</span>
			)}
		</li>
	);
}

/**
 * Keys and connected apps on the Account page's phone layout: one list, each
 * row ending in a hold that revokes or disconnects. Making a key waits for a
 * desk.
 */
export function KeysAppsCompact({
	keys,
	apps,
	now,
}: {
	keys: ApiKey[] | null;
	apps: ConnectedApp[] | null;
	now: Date;
}) {
	async function revoke(k: ApiKey) {
		try {
			await revokeKey(k.id);
			toast.success(`Revoked ${k.name}. Calls with it now get 401.`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Couldn't revoke that key");
		}
	}
	async function disconnect(app: ConnectedApp) {
		const name = displayClientName(app.clientName);
		try {
			await revokeApp(app.id);
			toast.success(`Disconnected ${name}.`);
		} catch (e) {
			toast.error(
				e instanceof Error ? e.message : "Couldn't disconnect that app",
			);
		}
	}
	if (keys === null || apps === null) {
		return (
			<div className="mac-group">
				<RowSkeleton />
				<RowSkeleton />
			</div>
		);
	}
	const listed = phoneKeys(keys, now);
	if (listed.length === 0 && apps.length === 0) {
		return <p className="ov-lede">No keys yet.</p>;
	}
	return (
		<ul className="ma-keys">
			{listed.map((k) => (
				<HoldRow
					key={k.id}
					name={k.name}
					line={keyLook(k, now).line}
					holdLabel="Hold to revoke"
					revoked={k.status === "revoked"}
					onConfirm={() => void revoke(k)}
				/>
			))}
			{apps.map((app) => (
				<HoldRow
					key={app.id}
					name={displayClientName(app.clientName)}
					line={
						app.lastUsedAt
							? `App · used ${agoShort(app.lastUsedAt, now)} ago`
							: "App · never used"
					}
					holdLabel="Hold to disconnect"
					onConfirm={() => void disconnect(app)}
				/>
			))}
		</ul>
	);
}
