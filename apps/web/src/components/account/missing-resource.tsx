import { MissingMark } from "@/components/not-found/missing-mark";
import { type Route, closestRoutes } from "@/lib/not-found-match";
import Link from "next/link";
import "@/components/not-found/not-found.css";

export function MissingResource({
	kind,
	id,
	deleted = null,
	others,
	listHref,
}: {
	kind: "webhook" | "subgraph";
	id: string;
	deleted?: string | null;
	others: Route[] | null;
	listHref: string;
}) {
	const [near] =
		others && deleted === null ? closestRoutes(`/${id}`, others, 1) : [];
	const rest = (others ?? []).filter((r) => r.href !== near?.href).slice(0, 5);
	const plural = kind === "webhook" ? "Webhooks" : "Subgraphs";
	return (
		<div className="nf-missing">
			<div className="nf-gone">
				<MissingMark />
				<div>
					{deleted !== null ? (
						<>
							<h2>
								<code>{deleted}</code> was deleted
							</h2>
							<p>It's no longer on this account.</p>
						</>
					) : (
						<>
							<h2>
								No {kind} <code>{id}</code> on this account
							</h2>
							<p>
								{near
									? `It was deleted or renamed, or it belongs to another account. You probably meant ${near.title}.`
									: "It was deleted, or it belongs to another account."}
							</p>
						</>
					)}
				</div>
			</div>
			{rest.length ? (
				<ul className="nf-others">
					{rest.map((r) => (
						<li key={r.href}>
							<Link href={r.href}>{r.title}</Link>
						</li>
					))}
				</ul>
			) : null}
			<div className="nf-pages">
				{near ? (
					<Link className="acct-btn solid small" href={near.href}>
						Open {near.title}
					</Link>
				) : null}
				<Link
					className={`acct-btn small ${near ? "line" : "solid"}`}
					href={listHref}
				>
					All {plural.toLowerCase()}
				</Link>
			</div>
		</div>
	);
}
