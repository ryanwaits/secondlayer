import type { WebhookSummary } from "@secondlayer/sdk";
import Link from "next/link";
import { shortenName } from "./shared";

export interface WaitingItem {
	id: string;
	label: string;
	title: string;
}

export interface WaitingGroup {
	/** "SP1A27…ADJ7.v0-vault-sbtc", or null for names that don't name a contract. */
	contract: string | null;
	items: WaitingItem[];
}

const WATCH_NAME =
	/^(?:[a-z][a-z0-9-]*:)?(S[PMTN][0-9A-Z]{26,41}\.[A-Za-z][A-Za-z0-9-]*):(.+)$/;

/** Group never-matched webhooks by the contract their name watches. A name
 *  like `sentinel:SP….vault:set-impl` (prefix optional) groups under
 *  `SP….vault` with label `set-impl`; any other name lands in the null group
 *  with its whole (shortened) name as the label. Groups keep first-seen order;
 *  the null group goes last. */
export function groupWaiting(
	webhooks: readonly Pick<WebhookSummary, "id" | "name">[],
): WaitingGroup[] {
	const byContract = new Map<string, WaitingItem[]>();
	const other: WaitingItem[] = [];
	for (const { id, name } of webhooks) {
		const match = WATCH_NAME.exec(name);
		if (match?.[1] && match[2]) {
			const contract = shortenName(match[1]);
			const items = byContract.get(contract) ?? [];
			items.push({ id, label: match[2], title: name });
			byContract.set(contract, items);
		} else {
			other.push({ id, label: shortenName(name), title: name });
		}
	}
	const groups: WaitingGroup[] = [...byContract].map(([contract, items]) => ({
		contract,
		items,
	}));
	if (other.length > 0) groups.push({ contract: null, items: other });
	return groups;
}

/** Who set the waiting webhooks up (when one owner did) and the oldest start. */
export function waitingMeta(
	webhooks: readonly Pick<WebhookSummary, "managedBy" | "createdAt">[],
): { owner: string | null; since: string } {
	const owners = new Set(webhooks.map((w) => w.managedBy));
	const only = owners.size === 1 ? [...owners][0] : null;
	const oldest = webhooks.reduce<string | null>(
		(min, w) => (min === null || w.createdAt < min ? w.createdAt : min),
		null,
	);
	const since = oldest
		? new Date(oldest).toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
				timeZone: "UTC",
			})
		: "";
	return { owner: only ?? null, since };
}

export function WaitingGroups({
	webhooks,
}: { webhooks: readonly WebhookSummary[] }) {
	return (
		<>
			{groupWaiting(webhooks).map((group) => {
				const dot = group.contract?.indexOf(".") ?? -1;
				return (
					<div className="wq-g" key={group.contract ?? "other"}>
						<div className="wq-c">
							{group.contract ? (
								<>
									<span className="wq-addr">
										{group.contract.slice(0, dot + 1)}
									</span>
									<b>{group.contract.slice(dot + 1)}</b>
								</>
							) : (
								"Other webhooks"
							)}
							<small>
								{group.items.length}{" "}
								{group.items.length === 1 ? "webhook" : "webhooks"}
							</small>
						</div>
						<div className="wq-fns">
							{group.items.map((item) => (
								<Link
									key={item.id}
									className="wq-fn"
									href={`/account/webhooks/${item.id}`}
									title={item.title}
								>
									{item.label}
								</Link>
							))}
						</div>
					</div>
				);
			})}
		</>
	);
}

export function WaitingBlock({
	webhooks,
}: { webhooks: readonly WebhookSummary[] }) {
	const { owner, since } = waitingMeta(webhooks);
	return (
		<section className="wq" aria-label="Waiting for a first match">
			<div className="wq-h">
				<span className="dash-dot idle" aria-hidden="true" />
				<span className="wq-t">Waiting for a first match</span>
				<span className="wq-n">{webhooks.length}</span>
				<span className="wq-meta">
					{owner ? `set up by ${owner} · ` : ""}since {since}
				</span>
			</div>
			<p className="wq-sub">
				Each one fires the first block a matching event lands, so quiet until
				then is normal.
			</p>
			<WaitingGroups webhooks={webhooks} />
		</section>
	);
}
