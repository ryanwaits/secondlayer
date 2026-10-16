import Link from "next/link";
import type { ReactNode } from "react";
import { Skel } from "./skel";
import { type Tone, dotClass } from "./status-sentence";

export function ResourceRow({
	href,
	name,
	tone,
	kind,
	state,
	spark,
	count,
	age,
	nameTitle,
}: {
	href: string;
	name: string;
	tone: Tone;
	/** Small faint label after the name. */
	kind?: string;
	/** The state line (text, or text plus a "Why ›" span). */
	state?: ReactNode;
	/** A chart element from a later plan, or nothing. */
	spark?: ReactNode;
	count?: string;
	age?: string;
	/** Full name for the title tooltip when the shown name is shortened. */
	nameTitle?: string;
}) {
	return (
		<Link href={href} className="dash-row">
			<span className="dash-row-name" title={nameTitle}>
				{/* Healthy is the default and shows no dot; the empty slot keeps names aligned. */}
				<span className={tone === "ok" ? "dash-dot none" : dotClass(tone)} />
				<span>{name}</span>
				{kind ? <em>{kind}</em> : null}
			</span>
			<span className="dash-row-state">{state}</span>
			<span className="dash-row-spark">{spark}</span>
			<span className="dash-row-v">{count}</span>
			<span className="dash-row-t">{age}</span>
		</Link>
	);
}

/** The five column labels of a resource table. */
export type ResourceRowLabels = [string, string, string, string, string];

export function ResourceRowHead({
	labels,
	className,
}: {
	labels: ResourceRowLabels;
	/** Extra class, for a second header further down the same table. */
	className?: string;
}) {
	return (
		<div className={className ? `dash-row-head ${className}` : "dash-row-head"}>
			<span>{labels[0]}</span>
			<span>{labels[1]}</span>
			<span>{labels[2]}</span>
			<span>{labels[3]}</span>
			<span>{labels[4]}</span>
		</div>
	);
}

/** A row's shape while the Overview's first data is in flight. */
export function ResourceRowSkeleton() {
	return (
		<div className="dash-row" aria-hidden="true">
			<span className="dash-row-name">
				<span className="dash-dot idle" />
				<Skel width="55%" />
			</span>
			<span className="dash-row-state">
				<Skel width="70%" />
			</span>
			<span className="dash-row-spark">
				<Skel width={132} height={30} style={{ display: "block" }} />
			</span>
			<span className="dash-row-v">
				<Skel width={40} />
			</span>
			<span className="dash-row-t">
				<Skel width={28} />
			</span>
		</div>
	);
}
