import type { ReactNode } from "react";

export interface OwnershipNode {
	who: string;
	name: string;
	body: string;
	/** Runs on the reader's side: drawn dashed. */
	yours?: boolean;
}

export interface OwnershipLink {
	label: string;
	/** Price tag hung on the link, where billing happens. */
	meter?: string;
}

/**
 * Who runs what: nodes left to right with the link between each pair, then
 * one line for each side. `links[i]` joins `nodes[i]` to `nodes[i + 1]`.
 */
export function Ownership({
	nodes,
	links,
	ours,
	yours,
}: {
	nodes: readonly OwnershipNode[];
	links: readonly OwnershipLink[];
	ours: ReactNode;
	yours: ReactNode;
}) {
	return (
		<div className="ownership">
			<div className="ownership-flow">
				{nodes.map((node, i) => (
					<div className="ownership-step" key={node.name}>
						{i > 0 && <Link link={links[i - 1]} />}
						<div className={`ownership-node${node.yours ? " yours" : ""}`}>
							<span className="who">{node.who}</span>
							<b>{node.name}</b>
							<span>{node.body}</span>
						</div>
					</div>
				))}
			</div>
			<div className="ownership-sides">
				<p>{ours}</p>
				<p className="yours">{yours}</p>
			</div>
		</div>
	);
}

function Link({ link }: { link: OwnershipLink | undefined }) {
	return (
		<div className="ownership-link" aria-hidden={!link}>
			{link?.meter && <span className="meter-tag">{link.meter}</span>}
			<span className="wire" />
			{link && <span className="label">{link.label}</span>}
		</div>
	);
}
