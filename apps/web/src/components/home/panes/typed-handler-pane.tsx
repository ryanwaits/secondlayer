import { TYPED_HANDLERS_SNIPPET } from "@/lib/home-snippets";

const SQUIGGLE_ON = "event.input.amount";

/**
 * V4 "IDE moment": the snippet with the type system visible — a hover card
 * for `event.input`, a squiggle plus the real compiler error for the field
 * the ABI rejects. Hand-rendered (not Shiki) so the squiggle can live inside
 * the code; the source string stays in home-snippets.ts for the mirror test.
 */
export function TypedHandlerPane() {
	const at = TYPED_HANDLERS_SNIPPET.indexOf(SQUIGGLE_ON);
	const before = TYPED_HANDLERS_SNIPPET.slice(0, at + "event.input.".length);
	const after = TYPED_HANDLERS_SNIPPET.slice(at + SQUIGGLE_ON.length);

	return (
		<div className="home-ide-zone">
			<div className="home-ide">
				<div className="home-ide-tabs">
					<span className="home-ide-tab on">marketplace.ts</span>
					<span className="home-ide-tab">marketplace.abi.ts</span>
				</div>
				<pre className="home-ide-body">
					<code>
						{before}
						<span className="home-ide-squig">amount</span>
						{after}
					</code>
				</pre>
				<div className="home-ide-hover" aria-hidden="true">
					<div>
						<span className="k">(property)</span> input: {"{"}
					</div>
					{(
						[
							["collection", "string"],
							["tokenId", "bigint"],
							["price", "bigint"],
						] as const
					).map(([name, type]) => (
						<div key={name}>
							&nbsp;&nbsp;{name}: <span className="t">{type}</span>
							{";"}
						</div>
					))}
					<div>{"}"}</div>
				</div>
			</div>
			<div className="home-ide-err">
				Property &apos;amount&apos; does not exist on type &apos;{"{"}{" "}
				collection: string; tokenId: bigint; price: bigint {"}"}&apos;. Did you
				mean &apos;price&apos;? <span className="code">ts(2551)</span>
			</div>
		</div>
	);
}
