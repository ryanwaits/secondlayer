import pkg from "../../../packages/stacks/package.json";

/* Version pill at the end of the top nav. Reads the package version at
   build time so the docs never claim a version the repo does not carry.
   Vocs picks this file up as a named consumer component. */
export function TopNavEnd() {
	return (
		<a
			className="sl-version"
			href="https://www.npmjs.com/package/@secondlayer/stacks"
			rel="noreferrer"
			target="_blank"
			title="@secondlayer/stacks on npm"
		>
			v{pkg.version}
		</a>
	);
}
