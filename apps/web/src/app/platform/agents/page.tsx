import { OverviewTopbar } from "@/components/console/overview-topbar";

export default function AgentsPage() {
	return (
		<>
			<OverviewTopbar page="Agents" showRefresh={false} showTimeRange={false} />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="agents-inner">
					<h1 className="agents-title">Agents</h1>
					<p className="agents-desc">
						Run browser agents for blockchain tasks, or use our SDK and CLI
						tools to build agent workflows in your own environment.
					</p>

					<div className="agents-divider">
						<span className="agents-divider-text">Get started</span>
					</div>

					<div className="agents-cards">
						{/* Run in browser */}
						<div className="agent-card">
							<div className="agent-card-preview">
								<div className="agent-card-preview-art">
									<svg width="120" height="60" viewBox="0 0 120 60" fill="none">
										<rect x="8" y="8" width="50" height="6" rx="2" fill="currentColor" opacity="0.4" />
										<rect x="8" y="20" width="35" height="4" rx="2" fill="currentColor" opacity="0.25" />
										<rect x="8" y="28" width="42" height="4" rx="2" fill="currentColor" opacity="0.25" />
										<rect x="8" y="36" width="28" height="4" rx="2" fill="currentColor" opacity="0.25" />
										<rect x="70" y="12" width="40" height="28" rx="4" fill="currentColor" opacity="0.15" />
										<circle cx="80" cy="26" r="4" fill="currentColor" opacity="0.3" />
										<circle cx="90" cy="26" r="3" fill="currentColor" opacity="0.2" />
										<circle cx="98" cy="26" r="2" fill="currentColor" opacity="0.15" />
									</svg>
								</div>
								<div className="agent-card-icon">
									<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
										<circle cx="8" cy="8" r="6" />
										<path d="M8 5v3l2 1.5" />
									</svg>
								</div>
							</div>
							<div className="agent-card-body">
								<div className="agent-card-title">
									Run in browser
									<span className="info-icon">
										<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
											<circle cx="8" cy="8" r="6" />
											<path d="M8 7v4" />
											<circle cx="8" cy="5" r="0.5" fill="currentColor" />
										</svg>
									</span>
								</div>
								<div className="agent-card-desc">
									Launch pre-built agents for common blockchain tasks &mdash;
									monitor wallets, track contract events, analyze token flows.
									No code required.
								</div>
							</div>
						</div>

						{/* Start in code */}
						<div className="agent-card">
							<div className="agent-card-preview">
								<div className="agent-card-preview-art">
									<svg width="120" height="60" viewBox="0 0 120 60" fill="none">
										<rect x="8" y="8" width="14" height="4" rx="1" fill="currentColor" opacity="0.3" />
										<rect x="26" y="8" width="30" height="4" rx="1" fill="currentColor" opacity="0.2" />
										<rect x="12" y="16" width="20" height="4" rx="1" fill="currentColor" opacity="0.25" />
										<rect x="36" y="16" width="16" height="4" rx="1" fill="currentColor" opacity="0.15" />
										<rect x="12" y="24" width="28" height="4" rx="1" fill="currentColor" opacity="0.25" />
										<rect x="12" y="32" width="22" height="4" rx="1" fill="currentColor" opacity="0.2" />
										<rect x="38" y="32" width="18" height="4" rx="1" fill="currentColor" opacity="0.15" />
										<rect x="8" y="40" width="10" height="4" rx="1" fill="currentColor" opacity="0.3" />
										<rect x="70" y="8" width="42" height="36" rx="3" fill="currentColor" opacity="0.08" stroke="currentColor" strokeOpacity="0.15" strokeWidth="0.5" />
										<rect x="76" y="14" width="30" height="3" rx="1" fill="currentColor" opacity="0.2" />
										<rect x="76" y="21" width="24" height="3" rx="1" fill="currentColor" opacity="0.15" />
										<rect x="76" y="28" width="28" height="3" rx="1" fill="currentColor" opacity="0.15" />
									</svg>
								</div>
								<div className="agent-card-icon">
									<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
										<path d="M5 4l-3 4 3 4" />
										<path d="M11 4l3 4-3 4" />
										<path d="M9 2l-2 12" />
									</svg>
								</div>
							</div>
							<div className="agent-card-body">
								<div className="agent-card-title">
									Start in code
									<span className="info-icon">
										<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
											<circle cx="8" cy="8" r="6" />
											<path d="M8 7v4" />
											<circle cx="8" cy="5" r="0.5" fill="currentColor" />
										</svg>
									</span>
								</div>
								<div className="agent-card-desc">
									Build agent workflows with the Secondlayer SDK, CLI skills,
									or Claude Code. Copy scaffolds and deploy from your own
									environment.
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</>
	);
}
