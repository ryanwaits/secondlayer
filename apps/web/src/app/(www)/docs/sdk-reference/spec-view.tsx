import spec from "@/generated/sdk-spec.json";

/**
 * Renders the SDK's public surface, extracted from its TypeScript source by
 * openpkg. Nothing here is hand-maintained — `bun run openpkg` in packages/sdk
 * regenerates it, so a rename or a new export can't quietly go undocumented.
 */

const REPO = "https://github.com/ryanwaits/secondlayer/blob/main";

type Entry = {
	name: string;
	kind: string;
	summary: string;
	signature: string | null;
	file: string | null;
	line: number | null;
};

const SPEC = spec as unknown as {
	package: string;
	version: string;
	areas: Array<{ name: string; exports: Entry[] }>;
};

/** Paths are package-relative for SDK sources, repo-relative for re-exports. */
function sourceHref(entry: Entry): string | null {
	if (!entry.file) return null;
	const path = entry.file.startsWith("packages/")
		? entry.file
		: `packages/sdk/${entry.file}`;
	return `${REPO}/${path}#L${entry.line ?? 1}`;
}

function slug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

function Export({ entry }: { entry: Entry }) {
	const href = sourceHref(entry);
	return (
		<div className="sdkref-item">
			<div className="sdkref-item-head">
				<code className="sdkref-name" id={`x-${slug(entry.name)}`}>
					{entry.name}
				</code>
				<span className="sdkref-kind">{entry.kind}</span>
				{href ? (
					<a className="sdkref-src" href={href}>
						source
					</a>
				) : null}
			</div>
			{entry.signature ? (
				<code className="sdkref-sig">{entry.signature}</code>
			) : null}
			{entry.summary ? <p className="sdkref-summary">{entry.summary}</p> : null}
		</div>
	);
}

export function SdkSpecView() {
	const total = SPEC.areas.reduce((n, a) => n + a.exports.length, 0);
	return (
		<>
			<p className="sdkref-meta">
				<code>
					{SPEC.package}@{SPEC.version}
				</code>{" "}
				· {total} exports · extracted with openpkg
			</p>

			{SPEC.areas.map((area) => (
				<section key={area.name}>
					<h2 id={slug(area.name)}>{area.name}</h2>
					<div className="sdkref-grid">
						{area.exports.map((entry) => (
							<Export key={entry.name} entry={entry} />
						))}
					</div>
				</section>
			))}
		</>
	);
}
