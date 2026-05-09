import { CopyButton } from "./copy-button";

const R2_BASE =
	"https://pub-08fa583203de40b2b154e6a56624adc2.r2.dev/stacks-datasets/mainnet/v0";

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
	const manifestUrl = `${R2_BASE}/${dataset}/manifest/latest.json`;
	const duckdb = `SELECT count(*) AS rows
FROM read_parquet(
  '${dataGlob}'
);`;
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
					<summary>DuckDB</summary>
					<div className="dataset-sandbox-snippet-body">
						<pre className="code-block">
							<code>{duckdb}</code>
						</pre>
						<CopyButton code={duckdb} />
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
