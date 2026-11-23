import { IntentLink } from "@/components/intent-link";
import { type Tone, flagClass } from "@/lib/tone";
import type { ReactNode } from "react";
import { Skel } from "./skel";

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
	kind?: string;
	state?: ReactNode;
	spark?: ReactNode;
	count?: string;
	age?: string;
	nameTitle?: string;
}) {
	const flag = flagClass(tone);
	return (
		<IntentLink href={href} className={flag ? `dash-row ${flag}` : "dash-row"}>
			<span className="dash-row-name" title={nameTitle}>
				<span>{name}</span>
				{kind ? <em>{kind}</em> : null}
			</span>
			<span className="dash-row-state">{state}</span>
			<span className="dash-row-spark">{spark}</span>
			<span className="dash-row-v">{count}</span>
			<span className="dash-row-t">{age}</span>
		</IntentLink>
	);
}

export type ResourceRowLabels = [string, string, string, string, string];

export function ResourceRowHead({
	labels,
	className,
}: {
	labels: ResourceRowLabels;
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

export function ResourceRowSkeleton() {
	return (
		<div className="dash-row" aria-hidden="true">
			<span className="dash-row-name">
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
