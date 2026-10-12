import type { Problem } from "@/lib/account-health";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The parts every /account page is built from: head, status strip, cards,
 * and the "needs attention" list. A new account page is head, then strip,
 * then cards, with problems directly under the head.
 */

export type DotTone = "ok" | "bad" | "off";

export function Dot({ tone = "ok" }: { tone?: DotTone }) {
	return <span className={`acct-dot ${tone}`} aria-hidden="true" />;
}

/** Page title, one-line sub, and an optional action (or status) on the right. */
export function AccountHead({
	title,
	sub,
	children,
}: {
	title: string;
	sub?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<header className="acct-head">
			<div>
				<h1>{title}</h1>
				{sub ? <p>{sub}</p> : null}
			</div>
			{children}
		</header>
	);
}

/** One bordered box, cells split by hairlines. Wraps to 2x2, then one column. */
export function StatusStrip({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<section className="acct-strip" aria-label={label}>
			{children}
		</section>
	);
}

export function StripCell({
	href,
	label,
	aside,
	children,
}: {
	href?: string;
	label: string;
	aside?: ReactNode;
	children: ReactNode;
}) {
	const body = (
		<>
			<span className="acct-strip-k">
				{label}
				{aside ? <span>{aside}</span> : null}
			</span>
			{children}
		</>
	);
	return (
		<div className="acct-strip-cell">
			{href ? (
				<Link href={href} className="acct-strip-link">
					{body}
				</Link>
			) : (
				<div className="acct-strip-link">{body}</div>
			)}
		</div>
	);
}

/** A bordered card with a header row: title left, muted link or meta right. */
export function AcctCard({
	title,
	aside,
	label,
	children,
}: {
	title: string;
	aside?: ReactNode;
	/** Accessible name when the visible title isn't enough. */
	label?: string;
	children: ReactNode;
}) {
	return (
		<section className="acct-box" aria-label={label ?? title}>
			<div className="acct-box-h">
				<h2>{title}</h2>
				{aside ? <span className="acct-box-aside">{aside}</span> : null}
			</div>
			<div className="acct-box-b">{children}</div>
		</section>
	);
}

/** Problems with their fix action, as hairline rows with a red dot. */
export function AttentionList({ problems }: { problems: Problem[] }) {
	if (problems.length === 0) return null;
	return (
		<ul className="acct-attn" aria-label="Needs attention">
			{problems.map((p) => (
				<li key={p.kind}>
					<span className="acct-attn-t">
						<Dot tone="bad" />
						{p.label}
					</span>
					<Link href={p.href} className="acct-btn line small">
						{p.action}
					</Link>
				</li>
			))}
		</ul>
	);
}
