import { CopyButton } from "./copy-button";

const R2_HOST = "https://pub-08fa583203de40b2b154e6a56624adc2.r2.dev";
const R2_BASE = `${R2_HOST}/stacks-datasets/mainnet/v0`;

export type ParquetSnippetProps = {
	/** Dataset slug, e.g. "sbtc/events" or "sbtc/token-events". */
	dataset: string;
	/** Optional title shown above the panel. */
	title?: string;
	/** Optional one-line description shown beneath the title. */
	description?: string;
};

export function ParquetSnippet({
	dataset,
	title,
	description,
}: ParquetSnippetProps) {
	const dataGlob = `${R2_BASE}/${dataset}/data/block_height/*/data.parquet`;
	const manifestUrl = `${R2_BASE}/${dataset}/latest.json`;
	// Manifest-based snippet — recommended; works without LIST permission on R2.
	// Manifest files[].path is bucket-relative, so prefix the R2 host; DuckDB
	// can't take a subquery inside read_parquet(), hence SET VARIABLE.
	const duckdbManifest = `-- Read partition list from manifest, then count rows.
SET VARIABLE files = (
  SELECT list_transform(files, lambda f: '${R2_HOST}/' || f.path)
  FROM read_json_auto('${manifestUrl}')
);
SELECT count(*) AS rows
FROM read_parquet(getvariable('files'));`;
	// Glob fallback — requires R2 LIST + DuckDB http-glob escape.
	const duckdbGlob = `SET allow_asterisks_in_http_paths = true;
SELECT count(*) AS rows
FROM read_parquet('${dataGlob}');`;
	const curl = `curl ${manifestUrl}`;

	return (
		<div className="dataset-sandbox">
			{title ? <div className="dataset-sandbox-title">{title}</div> : null}
			{description ? (
				<div className="dataset-sandbox-description">{description}</div>
			) : null}

			<div className="dataset-sandbox-endpoint">
				<span className="dataset-sandbox-method">GET</span>
				<code className="dataset-sandbox-path">{manifestUrl}</code>
			</div>

			<div className="dataset-sandbox-snippets">
				<details className="dataset-sandbox-snippet" open>
					<summary>DuckDB (via manifest, recommended)</summary>
					<div className="dataset-sandbox-snippet-body">
						<pre className="code-block">
							<code>{duckdbManifest}</code>
						</pre>
						<CopyButton code={duckdbManifest} />
					</div>
				</details>
				<details className="dataset-sandbox-snippet">
					<summary>DuckDB (via glob, requires LIST)</summary>
					<div className="dataset-sandbox-snippet-body">
						<pre className="code-block">
							<code>{duckdbGlob}</code>
						</pre>
						<CopyButton code={duckdbGlob} />
					</div>
				</details>
				<details className="dataset-sandbox-snippet">
					<summary>Manifest (curl)</summary>
					<div className="dataset-sandbox-snippet-body">
						<pre className="code-block">
							<code>{curl}</code>
						</pre>
						<CopyButton code={curl} />
					</div>
				</details>
			</div>
		</div>
	);
}
