"use client";

import { formatDate } from "@/lib/account-data";
import type { WebhookActivity, WebhookDetail } from "@secondlayer/sdk";
import { FloatingCard } from "../floating-card";
import { ListensFor } from "./listens-for";
import { CliLine } from "./shared";

/** What it listens for, where it sends, and the commands that change it. */
export function DefinitionSections({
	webhook,
	activity,
}: {
	webhook: WebhookDetail;
	activity: WebhookActivity | null;
}) {
	const { name } = webhook;
	return (
		<>
			<section className="wd-def">
				<ListensFor webhook={webhook} activity={activity} />
			</section>
			<section className="wd-def">
				<h3>Sends to</h3>
				<dl className="wd-kv">
					<dt>Endpoint</dt>
					<dd>
						<code>{webhook.url}</code>
					</dd>
					<dt>Format</dt>
					<dd>
						<code>{webhook.format}</code>
					</dd>
					<dt>Retries</dt>
					<dd>{webhook.maxRetries} tries, then it gives up</dd>
					<dt>Timeout</dt>
					<dd>{webhook.timeoutMs.toLocaleString("en-US")}ms</dd>
					{webhook.receiverCertExpiresAt ? (
						<>
							<dt>TLS</dt>
							<dd>
								Certificate valid until{" "}
								{formatDate(webhook.receiverCertExpiresAt)}
							</dd>
						</>
					) : null}
				</dl>
			</section>
			<section className="wd-def">
				<h3>Change it</h3>
				<CliLine
					label="Receiver, filter"
					command={`sl webhooks update ${name}`}
				/>
				<CliLine
					label="New secret"
					command={`sl webhooks rotate-secret ${name}`}
				/>
				<CliLine label="Check it" command={`sl webhooks doctor ${name}`} />
				<p className="wd-faint">
					Deleting is <code>sl webhooks delete {name}</code>. There's no button
					for it.
				</p>
			</section>
			<section className="wd-def">
				<h3>Record</h3>
				<dl className="wd-kv">
					<dt>ID</dt>
					<dd>
						<code>{webhook.id}</code>
					</dd>
					<dt>Created</dt>
					<dd>{formatDate(webhook.createdAt)}</dd>
				</dl>
			</section>
		</>
	);
}

/**
 * A webhook's definition, out of the page's way. The page reports; the CLI
 * edits.
 */
export function DefinitionDrawer({
	webhook,
	activity,
	open,
	onClose,
}: {
	webhook: WebhookDetail;
	activity: WebhookActivity | null;
	open: boolean;
	onClose: () => void;
}) {
	return (
		<FloatingCard
			open={open}
			onClose={onClose}
			scrim
			title={webhook.name}
			subtitle="Webhook · definition"
		>
			<DefinitionSections webhook={webhook} activity={activity} />
		</FloatingCard>
	);
}
