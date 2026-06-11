import { PLATFORM_API_URL } from "@/lib/api";

type ExploreListLite = {
	subgraphs: { sources?: string[]; visibility: string }[];
};

/** Known contract → display label. Unknown contracts show a shortened id. */
const LABELS: Record<string, { name: string; detail: string }> = {
	"sbtc-token": { name: "sBTC", detail: "bridge + token" },
	"pox-4": { name: "PoX-4", detail: "stacking" },
	"BNS-V2": { name: "BNS", detail: "names" },
	"bns-v2": { name: "BNS", detail: "names" },
	"arkadiko-vault": { name: "Arkadiko", detail: "vaults" },
	"univ2-core": { name: "Velar", detail: "amm swaps" },
	"amm-pool-v2-01": { name: "ALEX", detail: "defi" },
	"zest-protocol": { name: "Zest", detail: "lending" },
	"stacking-dao-core": { name: "StackingDAO", detail: "liquid stacking" },
};

const FALLBACK: { name: string; detail: string }[] = [
	{ name: "sBTC", detail: "bridge + token" },
	{ name: "PoX-4", detail: "stacking" },
	{ name: "BNS", detail: "names" },
	{ name: "SIP-010", detail: "fungible tokens" },
	{ name: "SIP-009", detail: "nfts" },
	{ name: "Velar", detail: "amm swaps" },
	{ name: "Arkadiko", detail: "vaults" },
	{ name: "ALEX", detail: "defi" },
	{ name: "Zest", detail: "lending" },
	{ name: "StackingDAO", detail: "liquid stacking" },
];

async function deriveTiles(): Promise<{ name: string; detail: string }[]> {
	try {
		const res = await fetch(`${PLATFORM_API_URL}/v1/subgraphs`, {
			next: { revalidate: 300 },
		});
		if (!res.ok) return FALLBACK;
		const body = (await res.json()) as ExploreListLite;
		const seen = new Map<string, { name: string; detail: string }>();
		for (const sg of body.subgraphs) {
			if (sg.visibility !== "public") continue;
			for (const src of sg.sources ?? []) {
				const contractName = src.split(".")[1] ?? src;
				const label = LABELS[contractName] ?? {
					name: contractName.slice(0, 14),
					detail: `${src.slice(0, 6)}…`,
				};
				seen.set(label.name, label);
			}
		}
		// auto-populates as more public subgraphs get seeded; until the
		// directory is rich enough, the curated fallback carries the row
		return seen.size >= 6 ? [...seen.values()] : FALLBACK;
	} catch {
		return FALLBACK;
	}
}

/** Protocols-we-index marquee, derived from the live public directory. */
export async function ProtocolMarquee() {
	const tiles = await deriveTiles();
	// translateX(-50%) only loops gaplessly when ONE copy is wider than the
	// viewport. Short tile sets (few public subgraphs) or wide monitors leave
	// the right edge empty at the seam, so repeat the base set to a safe minimum
	// before doubling — both halves stay equal-width for the seamless loop.
	const MIN_PER_COPY = 16;
	const copy = Array.from(
		{ length: Math.ceil(MIN_PER_COPY / tiles.length) },
		() => tiles,
	).flat();
	const doubled = [...copy, ...copy];
	// Keep the visual scroll speed constant regardless of how many tiles the
	// directory yields (~4.8s per tile across one copy, matching the original).
	const durationSeconds = copy.length * 4.8;

	return (
		<div className="home-marquee-zone">
			<div
				className="home-marquee"
				aria-label="Protocols indexed on Secondlayer"
			>
				<div
					className="home-marquee-track"
					style={{ animationDuration: `${durationSeconds}s` }}
				>
					{doubled.map((t, i) => (
						<div className="home-proto" key={`${t.name}-${i}`}>
							<span className="n">{t.name}</span>
							<span className="d">{t.detail}</span>
						</div>
					))}
				</div>
			</div>
			<p className="home-marquee-more">
				every contract, every event —{" "}
				<a href="/subgraphs/explore">explore public subgraphs →</a>
			</p>
		</div>
	);
}
