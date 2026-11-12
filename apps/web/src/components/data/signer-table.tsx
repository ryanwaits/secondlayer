"use client";

import { PageArrow } from "@/components/page-arrow";
import type { SignerRow } from "@/lib/protocol-stats";
import { useState } from "react";

const stx = new Intl.NumberFormat("en-US");
const PAGE_SIZE = 10;

/**
 * Signers of the current cycle, largest delegation first, ten at a time.
 * Every row is in the server HTML (the other pages are `hidden`), so crawlers
 * read all of them; back/next only change which ten show.
 */
export function SignerTable({ signers }: { signers: readonly SignerRow[] }) {
	const [page, setPage] = useState(0);
	const pages = Math.ceil(signers.length / PAGE_SIZE);
	const from = page * PAGE_SIZE;
	const to = Math.min(from + PAGE_SIZE, signers.length);
	return (
		<div className="live-signers">
			<div className="live-table">
				<table>
					<thead>
						<tr>
							<th>Signer</th>
							<th className="num">Stacked STX</th>
							<th className="num">Share</th>
							<th>In set</th>
						</tr>
					</thead>
					<tbody>
						{signers.map((row, i) => (
							<tr key={row.principal} hidden={i < from || i >= to}>
								<td title={row.principal}>{row.name}</td>
								<td className="num">{stx.format(row.stackedStx)}</td>
								<td className="num">{row.sharePct.toFixed(1)}%</td>
								<td>{row.inSet ? "Yes" : "No"}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{pages > 1 ? (
				<nav className="rw-pager live-pager" aria-label="Signer pages">
					<span className="bl-note">
						{from + 1}–{to} of {signers.length}
					</span>
					<button
						type="button"
						aria-label="Previous signers"
						disabled={page === 0}
						onClick={() => setPage(page - 1)}
					>
						<PageArrow back />
					</button>
					<button
						type="button"
						aria-label="Next signers"
						disabled={page === pages - 1}
						onClick={() => setPage(page + 1)}
					>
						<PageArrow />
					</button>
				</nav>
			) : null}
		</div>
	);
}
