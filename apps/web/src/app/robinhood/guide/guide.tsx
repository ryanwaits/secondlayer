"use client";

import { Choice } from "@/components/choice";
import { CopyButton } from "@/components/copy-button";
import { ButtonLink } from "@/components/site/button-link";
import { Eyebrow } from "@/components/site/eyebrow";
import { useState } from "react";
import {
	BRIDGE_TOKENS,
	LOCKER_SANDBOX,
	RH_MAINNET_ADDRESS,
	ROBINHOOD_CHAIN,
	toBaseUnits,
} from "../bridge";

const TOKEN_OPTIONS = BRIDGE_TOKENS.map((t) => ({
	value: t.symbol,
	label: t.symbol,
}));

/** A value the tester pastes somewhere: shown whole, copied in one click. */
function Value({ children }: { children: string }) {
	return (
		<span className="rh-g-val">
			<code>{children}</code>
			<CopyButton code={children} label="Copy" />
		</span>
	);
}

function Rows({ rows }: { rows: [React.ReactNode, React.ReactNode][] }) {
	return (
		<div className="rh-g-table">
			<table>
				<tbody>
					{rows.map(([k, v], i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: fixed rows
						<tr key={i}>
							<th scope="row">{k}</th>
							<td>{v}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** The round trip, in page order: the list under the warning links to each. */
const STEPS = [
	{ id: "lock", title: "Lock on Stacks", who: "you · 1 tx" },
	{ id: "mint", title: "Wait for the twin", who: "~70 min + approval" },
	{ id: "burn", title: "Burn to come home", who: "you · 1 tx" },
	{ id: "release", title: "Wait for the release", who: "~20 min + approval" },
] as const;

function StepHead({ n }: { n: 1 | 2 | 3 | 4 }) {
	const step = STEPS[n - 1];
	return (
		<div className="rh-g-step-head">
			<span className="rh-g-n mono">{n}</span>
			<h2>{step.title}</h2>
			<span className="rh-g-who mono">{step.who}</span>
		</div>
	);
}

function Waits({ items }: { items: [string, string][] }) {
	return (
		<ol className="rh-g-wait">
			{items.map(([what, when]) => (
				<li key={what}>
					<i />
					<span>{what}</span>
					<span className="mono">{when}</span>
				</li>
			))}
		</ol>
	);
}

/**
 * The tester guide for the current phase (phase 0). One page; the token
 * switch rewrites every address, decimal and cap in place, and the amount
 * field turns whole tokens into the base units both contract calls take.
 */
export function TesterGuide() {
	const [symbol, setSymbol] = useState<string>(BRIDGE_TOKENS[0].symbol);
	const token =
		BRIDGE_TOKENS.find((t) => t.symbol === symbol) ?? BRIDGE_TOKENS[0];
	const [amounts, setAmounts] = useState<Record<string, string>>(() =>
		Object.fromEntries(BRIDGE_TOKENS.map((t) => [t.symbol, t.example])),
	);
	const amount = amounts[token.symbol];
	const base = toBaseUnits(amount, token);
	const cap = `${token.cap.toLocaleString("en-US")} ${token.symbol}`;
	const units = base.ok ? base.units : "…";
	const [contractAddress, contractName] = token.stacks.split(".");

	return (
		<article className="rh-g-article">
			<div className="rh-g-head">
				<div className="rh-g-eyebrow">
					<Eyebrow noun="Phase 0" verb="Tester guide" />
					<span className="seal">live</span>
				</div>
				<Choice
					name="token"
					legend="Token"
					size="sm"
					options={TOKEN_OPTIONS}
					value={token.symbol}
					onChange={setSymbol}
				/>
			</div>
			<h1>Bridge {token.symbol} to Robinhood Chain and back.</h1>
			<p className="lede">
				Two transactions from you, about two hours, most of it waiting. Your
				round trip goes on the public record on /robinhood.
			</p>
			<p className="rh-g-meta mono">
				<span>
					Cap <b>{cap}</b> in total
				</span>
				<span>
					Fees <b>~0.1 STX</b> + <b>~0.0005 ETH</b>
				</span>
				<span>
					Chain <b>4663</b>
				</span>
			</p>

			<p className="rh-note">
				<i />
				<span>
					<strong>This bridge is custodial.</strong> One person holds both keys
					of a 2-of-2 multisig on Stacks and a 2-of-2 Safe on Robinhood Chain.
					Those keys can pay out or mint without checking the other chain. Only
					bridge an amount you're fine losing. The twin you receive is not a
					Robinhood app balance: never send it to a Robinhood deposit address.
				</span>
			</p>

			<ol className="rh-g-toc" aria-label="Steps">
				{STEPS.map((s, i) => (
					<li key={s.id}>
						<a href={`#${s.id}`}>
							<span className="rh-g-n mono">{i + 1}</span>
							<span>{s.title}</span>
							<span className="rh-g-who mono">{s.who}</span>
						</a>
					</li>
				))}
			</ol>

			<section className="rh-g-sec" id="before">
				<h2>What you need</h2>
				<Rows
					rows={[
						[
							"Stacks wallet",
							`Leather or Xverse, holding the ${token.symbol} you want to bridge, plus about 0.1 STX for fees`,
						],
						[
							"EVM wallet",
							"MetaMask or similar, on Robinhood Chain, with about 0.0005 ETH for the burn",
						],
					]}
				/>
				<h3>Add Robinhood Chain to your wallet</h3>
				<Rows
					rows={[
						["Network name", <Value key="n">{ROBINHOOD_CHAIN.name}</Value>],
						["RPC URL", <Value key="r">{ROBINHOOD_CHAIN.rpc}</Value>],
						["Chain ID", <Value key="c">{ROBINHOOD_CHAIN.chainId}</Value>],
						["Currency", <Value key="u">{ROBINHOOD_CHAIN.currency}</Value>],
						["Explorer", <Value key="e">{ROBINHOOD_CHAIN.explorer}</Value>],
					]}
				/>
			</section>

			<section className="rh-g-sec" id="lock">
				<StepHead n={1} />
				<p>
					Open the locker in the Hiro sandbox, connect your Stacks wallet, and
					call <code>lock</code>. Call it from your own wallet, not through
					another contract.
				</p>
				<div className="rh-g-amount">
					<label htmlFor="rh-g-amount">Amount</label>
					<input
						id="rh-g-amount"
						inputMode="decimal"
						autoComplete="off"
						value={amount}
						onChange={(e) =>
							setAmounts((a) => ({ ...a, [token.symbol]: e.target.value }))
						}
					/>
					<span className="mono">
						{token.symbol} = <b>{units}</b> base units
					</span>
					{!base.ok && base.reason !== "empty" && (
						<span className="rh-g-amount-error">
							{base.reason === "decimals"
								? `${token.symbol} has ${token.decimals} decimals.`
								: "Enter an amount like 25."}
						</span>
					)}
					{base.ok && base.overCap && (
						<span className="rh-g-amount-error">
							That's past the {cap} cap. The lock would fail.
						</span>
					)}
				</div>
				<Rows
					rows={[
						[<code key="t">token</code>, <Value key="v">{token.stacks}</Value>],
						[
							<code key="a">amount</code>,
							base.ok ? <Value key="v">{base.units}</Value> : "Base units",
						],
						[
							<code key="r">recipient</code>,
							<span key="v">
								Your EVM address, all 20 bytes, e.g. <code>0x2Ae8…81EF</code>
							</span>,
						],
					]}
				/>
				<h3>Add the post-condition</h3>
				<p>
					Below the arguments, keep the mode on <code>Deny</code> and add a
					Fungible Post Condition. Without it the lock fails and you only lose
					the fee.
				</p>
				<Rows
					rows={[
						["Address", "Your Stacks address, the one calling lock"],
						["Condition Code", <code key="c">Equal</code>],
						[
							"Amount",
							base.ok ? <Value key="v">{base.units}</Value> : "Base units",
						],
						["Asset Address", <Value key="a">{contractAddress}</Value>],
						["Asset Contract Name", <Value key="n">{contractName}</Value>],
						["Asset Name", <Value key="s">{token.asset}</Value>],
					]}
				/>
				<p className="rh-g-note">
					Your wallet shows one asset leaving: exactly that amount. The cap is
					for everyone together; a lock that would pass it fails and nothing
					moves. Note the transaction id.
				</p>
				<ButtonLink href={LOCKER_SANDBOX}>Open the locker in Hiro ↗</ButtonLink>
			</section>

			<section className="rh-g-sec" id="mint">
				<StepHead n={2} />
				<p>
					Nothing to do. Add the ERC-20 to your EVM wallet so it shows up when
					it lands.
				</p>
				<Waits
					items={[
						["Your lock is six Bitcoin blocks deep", "~70 min"],
						["The relayer proposes the mint", "minutes"],
						["Ryan approves it on his hardware wallet", "within a few hours"],
					]}
				/>
				<Rows
					rows={[
						["ERC-20 on 4663", <Value key="e">{token.erc20}</Value>],
						["Decimals", <code key="d">{token.decimals}</code>],
					]}
				/>
			</section>

			<section className="rh-g-sec" id="burn">
				<StepHead n={3} />
				<p>
					Open the ERC-20 on Blockscout, go to Contract, then Write contract,
					connect your EVM wallet, and call <code>burn</code>.
				</p>
				<Rows
					rows={[
						[
							<code key="a">amount</code>,
							`Base units, at most what you hold, e.g. ${units}`,
						],
						[
							<code key="s">stacksRecipient</code>,
							<span key="v">
								The Stacks address to pay, e.g. your <code>SP…</code> address
							</span>,
						],
					]}
				/>
				<p className="rh-g-note">
					Type the Stacks address carefully. An address the relayer can't parse
					is never paid; Ryan sees it and contacts you.
				</p>
				<ButtonLink
					href={`${RH_MAINNET_ADDRESS}${token.erc20}?tab=write_contract`}
				>
					Open {token.symbol} on Blockscout ↗
				</ButtonLink>
			</section>

			<section className="rh-g-sec" id="release">
				<StepHead n={4} />
				<Waits
					items={[
						["Your burn is final on Ethereum", "~20 min"],
						["The relayer proposes the release", "minutes"],
						["Ryan confirms it on his hardware wallet", "within a few hours"],
					]}
				/>
				<p className="rh-g-note">
					The {token.symbol} arrives at the Stacks address you typed.
				</p>
			</section>

			<section className="rh-g-sec" id="record">
				<h2>On the record</h2>
				<p>
					Nothing to send. The relayer logs every lock, mint, burn and release,
					and your round trip joins the list on /robinhood once the release
					lands.
				</p>
			</section>
		</article>
	);
}
