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
	const doubled = [...tiles, ...tiles]; // seamless loop

	return (
		<div className="home-marquee-zone">
			<span className="home-marquee-note" aria-hidden="true">
				all live, <em>no key needed</em>
			</span>
			<div
				className="home-marquee"
				aria-label="Protocols indexed on Secondlayer"
			>
				<div className="home-marquee-track">
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
