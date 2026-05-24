/**
 * Datasets (L2 curated) data-flow diagram.
 * Raw L1 events → curated Foundation Datasets → JSON API + parquet, with the
 * five shipped datasets as chips.
 */
export function DatasetsDiagram() {
	return (
		<figure className="sl-diagram-figure">
			<div className="sl-diagram-frame">
				<div className="sl-diagram-inner">
					<svg
						className="sl-diagram"
						viewBox="0 0 690 200"
						role="img"
						aria-label="Raw L1 events feed curated Foundation Datasets, served as a JSON API and parquet bulk export, across five shipped datasets."
					>
						<defs>
							<marker
								id="sl-datasets-ar"
								viewBox="0 0 10 10"
								refX="8.5"
								refY="5"
								markerWidth="6"
								markerHeight="6"
								orient="auto-start-reverse"
							>
								<path
									d="M1 1L9 5L1 9"
									fill="none"
									stroke="context-stroke"
									strokeWidth="1.6"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							</marker>
						</defs>

						<path
							className="edge"
							d="M186,72 H212"
							markerEnd="url(#sl-datasets-ar)"
						/>
						<path
							className="edge acc"
							d="M404,60 C440,60 440,52 470,52"
							markerEnd="url(#sl-datasets-ar)"
						/>
						<path
							className="edge acc"
							d="M404,84 C440,84 440,108 470,108"
							markerEnd="url(#sl-datasets-ar)"
						/>

						<g className="node data">
							<rect x="14" y="44" width="172" height="56" rx="9" />
							<text className="nt" x="100" y="68" textAnchor="middle">
								Raw events
							</text>
							<text className="ns" x="100" y="84" textAnchor="middle">
								L1 · curated
							</text>
						</g>
						<g className="node api">
							<rect x="212" y="44" width="192" height="56" rx="9" />
							<text className="nt" x="308" y="68" textAnchor="middle">
								Foundation Datasets
							</text>
							<text className="ns" x="308" y="84" textAnchor="middle">
								/v1/datasets · stable schema
							</text>
						</g>
						<g className="node">
							<rect x="470" y="32" width="206" height="40" rx="8" />
							<text className="nt" x="486" y="56" textAnchor="start">
								JSON API
							</text>
						</g>
						<g className="node">
							<rect x="470" y="88" width="206" height="40" rx="8" />
							<text className="nt" x="486" y="112" textAnchor="start">
								Parquet bulk export
							</text>
						</g>

						<g>
							<rect
								className="chip"
								x="212"
								y="150"
								width="78"
								height="22"
								rx="6"
							/>
							<text className="chiptext" x="251" y="164" textAnchor="middle">
								sBTC
							</text>
							<rect
								className="chip"
								x="298"
								y="150"
								width="98"
								height="22"
								rx="6"
							/>
							<text className="chiptext" x="347" y="164" textAnchor="middle">
								STX transfers
							</text>
							<rect
								className="chip"
								x="404"
								y="150"
								width="66"
								height="22"
								rx="6"
							/>
							<text className="chiptext" x="437" y="164" textAnchor="middle">
								PoX-4
							</text>
							<rect
								className="chip"
								x="478"
								y="150"
								width="58"
								height="22"
								rx="6"
							/>
							<text className="chiptext" x="507" y="164" textAnchor="middle">
								BNS
							</text>
							<rect
								className="chip"
								x="544"
								y="150"
								width="98"
								height="22"
								rx="6"
							/>
							<text className="chiptext" x="593" y="164" textAnchor="middle">
								Network health
							</text>
						</g>
						<text className="elabel" x="212" y="190">
							five Foundation Datasets · free to read
						</text>
					</svg>
				</div>
			</div>
		</figure>
	);
}
