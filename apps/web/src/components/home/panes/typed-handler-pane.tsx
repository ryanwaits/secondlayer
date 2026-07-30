import { CodeBlock } from "@/components/code-block";
import { TYPED_HANDLERS_ABI_SNIPPET } from "@/lib/home-snippets";

/**
 * V4 "IDE moment", two columns: the handler on the left with the type system
 * visible (hover card, squiggle, the real compiler error), and on the right
 * the ABI artifact those types come from. The left pane is hand-tokenized
 * (not Shiki) so the squiggle can live inside the code — token colors mirror
 * the monotone syntax theme. Its source of truth is TYPED_HANDLERS_SNIPPET
 * in home-snippets.ts; the mirror test pins the names shared by both.
 */
export function TypedHandlerPane() {
	return (
		<div className="home-ide-duo">
			<div className="home-ide-col">
				<div className="home-ide">
					<div className="home-ide-tabs">
						<span className="home-ide-tab on">marketplace.ts</span>
						<span className="home-ide-tab">marketplace.abi.ts</span>
					</div>
					<pre className="home-ide-body">
						<code>
							<span className="k">import</span> {"{ marketplaceAbi }"}{" "}
							<span className="k">from</span>{" "}
							<span className="s">"./marketplace.abi"</span>;{"\n"}
							{"\n"}
							{"sources: {\n"}
							{"  sale: {\n"}
							{"    type: "}
							<span className="s">"contract_call"</span>
							{",\n"}
							{"    contractId: MARKETPLACE,\n"}
							{"    functionName: "}
							<span className="s">"purchase-asset"</span>
							{",\n"}
							{"    abi: marketplaceAbi,\n"}
							{"  },\n"}
							{"},\n"}
							{"handlers: {\n"}
							{"  sale: (event, ctx) "}
							<span className="k">=&gt;</span>
							{" ctx.insert("}
							<span className="s">"sales"</span>
							{", {\n"}
							{"    collection: event.input.collection,\n"}
							{"    token_id:   event.input.tokenId,\n"}
							{"    amount:     event.input."}
							<span className="home-ide-squig">amount</span>
							{",\n"}
							{"  }),\n"}
							{"},"}
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
					collection: string; tokenId: bigint; price: bigint {"}"}&apos;. Did
					you mean &apos;price&apos;? <span className="code">ts(2551)</span>
				</div>
			</div>
			<div className="home-ide-col">
				<div className="home-test-editor">
					<div className="home-ide-tabs">
						<span className="home-ide-tab on">marketplace.abi.ts</span>
					</div>
					<CodeBlock code={TYPED_HANDLERS_ABI_SNIPPET} />
					<p className="home-ide-note">
						kebab-case on chain, camelCase in your handler:{" "}
						<code>token-id</code> → <code>tokenId</code>. A <code>uint128</code>{" "}
						arrives as <code>bigint</code> — never a truncated number.
					</p>
				</div>
			</div>
		</div>
	);
}
