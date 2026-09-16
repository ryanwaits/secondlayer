import pkg from "../../../../packages/stacks/package.json";

const REPO = "https://github.com/ryanwaits/secondlayer";

function compact(n: number) {
	return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${n}`;
}

/* viem's stat row: stars · license · version. Stars come from
   `__SL_STARS__` (build-time GitHub fetch, see docs/stats.ts); the badge
   is skipped when no number is available rather than printing a dash. */
export function Badges() {
	const stars = __SL_STARS__;
	return (
		<div className="sl-badges">
			{stars !== null ? (
				<a className="sl-badge" href={REPO} rel="noreferrer" target="_blank">
					<span>stars</span>
					<span>{compact(stars)}</span>
				</a>
			) : null}
			<a
				className="sl-badge"
				href={`${REPO}/blob/main/packages/stacks/LICENSE`}
				rel="noreferrer"
				target="_blank"
			>
				<span>license</span>
				<span>{__SL_LICENSE__}</span>
			</a>
			<a
				className="sl-badge"
				href="https://www.npmjs.com/package/@secondlayer/stacks"
				rel="noreferrer"
				target="_blank"
			>
				<span>version</span>
				<span>{pkg.version}</span>
			</a>
		</div>
	);
}
