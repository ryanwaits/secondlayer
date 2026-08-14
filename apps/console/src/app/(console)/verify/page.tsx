import { CopyButton } from "@/components/console/copy-button";
import { EmptyState } from "@/components/console/empty-state";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { apiRequest } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { StatusReport } from "@/lib/types";

/**
 * Integrity + coverage, straight from `GET /status`: the index-progress
 * ledger (contiguous vs indexed vs highest seen), per-subgraph gap counts,
 * and the CLI line for a full verification run. Real data only — sections
 * whose fields the runtime omits don't render.
 */

const VERIFY_COMMAND = "secondlayer verify all --against <manifest>";

function integrityBadge(integrity: string): string {
	return integrity === "complete" ? "active" : "warn";
}

export default async function VerifyPage() {
	let report: StatusReport | null = null;
	try {
		report = await apiRequest<StatusReport>("/status");
	} catch {
		report = null;
	}

	const progress = report?.indexProgress ?? [];
	const subgraphs = report?.subgraphs ?? [];

	return (
		<>
			<OverviewTopbar crumbs={[{ label: "verify" }]} />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					<div className="ident">
						<h2>Verify</h2>
						{report?.integrity && (
							<span
								className={`verdict ${report.integrity === "complete" ? "ok" : "warn"}`}
							>
								{report.integrity === "complete" ? "complete" : "gaps detected"}
							</span>
						)}
						{report?.chainTip != null && (
							<span className="kv">
								tip <b>#{report.chainTip.toLocaleString()}</b>
							</span>
						)}
					</div>

					{report === null ? (
						<EmptyState message="Instance unreachable — is the runtime up and SL_API_URL pointed at it?" />
					) : (
						<>
							{progress.length > 0 && (
								<section className="sg-sec">
									<div className="sg-sec-head">
										<span className="t">
											Index coverage
											<span className="cnt">{progress.length}</span>
										</span>
									</div>
									<div className="table-scroll">
										<table className="sg">
											<thead>
												<tr>
													<th>Network</th>
													<th>Contiguous to</th>
													<th>Last indexed</th>
													<th>Highest seen</th>
													<th>Updated</th>
												</tr>
											</thead>
											<tbody>
												{progress.map((p) => (
													<tr key={p.network}>
														<td className="mono">{p.network}</td>
														<td className="mono">
															#{p.lastContiguousBlock.toLocaleString()}
														</td>
														<td className="mono">
															#{p.lastIndexedBlock.toLocaleString()}
														</td>
														<td className="mono">
															#{p.highestSeenBlock.toLocaleString()}
														</td>
														<td>{timeAgo(p.updatedAt) ?? "—"}</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</section>
							)}

							{subgraphs.length > 0 && (
								<section className="sg-sec">
									<div className="sg-sec-head">
										<span className="t">
											Subgraph integrity
											<span className="cnt">{subgraphs.length}</span>
										</span>
									</div>
									<div className="table-scroll">
										<table className="sg">
											<thead>
												<tr>
													<th>Subgraph</th>
													<th>Integrity</th>
													<th>Gaps</th>
													<th>Missing blocks</th>
													<th>Last processed</th>
												</tr>
											</thead>
											<tbody>
												{subgraphs.map((sg) => (
													<tr key={sg.name}>
														<td className="mono">{sg.name}</td>
														<td>
															<span
																className={`badge ${integrityBadge(sg.integrity)}`}
															>
																{sg.integrity === "complete"
																	? "complete"
																	: "gaps"}
															</span>
														</td>
														<td className="mono">{sg.gapCount}</td>
														<td className="mono">
															{sg.totalMissingBlocks.toLocaleString()}
														</td>
														<td className="mono">
															#{sg.lastProcessedBlock.toLocaleString()}
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</section>
							)}

							<section className="sg-sec">
								<div className="sg-sec-head">
									<span className="t">Run a verification</span>
								</div>
								<div className="panel">
									<h4>Verify against a manifest</h4>
									<p>
										Recompute this instance's block-range digests and compare
										them against a published manifest — proof the history you
										serve is the history that was published.
									</p>
									<div className="code-inline">
										<code>{VERIFY_COMMAND}</code>
										<CopyButton code={VERIFY_COMMAND} inline />
									</div>
									<p style={{ marginTop: 12, marginBottom: 0 }}>
										<a
											href="https://www.secondlayer.tools/docs/verification"
											target="_blank"
											rel="noopener noreferrer"
											className="sg-ep-link"
										>
											Verification docs →
										</a>
									</p>
								</div>
							</section>
						</>
					)}
				</div>
			</div>
		</>
	);
}
