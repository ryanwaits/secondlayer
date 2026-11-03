// Secondlayer dash kit: one dependency-free ES module.
// Runs in the browser (index.html renders spec.json) and in Bun (check.ts and
// tests import validateSpec, decideNetworks and buildPrompt). Copied verbatim
// from the secondlayer skill: edit spec.json, not this file. The views port
// the hosted dashboard's own (apps/web components/account/**) to plain DOM.

const NETWORK_ORDER = ["mainnet", "testnet", "devnet"];
const NETWORK_NAME = {
	mainnet: "Mainnet",
	testnet: "Testnet",
	devnet: "Devnet",
};
const FREE_ROWS = 1_000_000;
const COPIED_MS = 1400;
/** Consecutive failures that make a webhook read as failing (the hosted pill's rule). */
const DOWN_MIN_CONSECUTIVE = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SVG_NS = "http://www.w3.org/2000/svg";

const isObject = (value) =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const isBinding = (value) =>
	isObject(value) && Object.keys(value).length === 1 && "$state" in value;

/** "mainnet" → "Mainnet". Spec values stay lowercase; people read the name. */
const networkName = (network) => NETWORK_NAME[network] ?? network;

function readPointer(state, pointer) {
	if (typeof pointer !== "string" || !pointer.startsWith("/")) return undefined;
	let at = state;
	for (const part of pointer.slice(1).split("/")) {
		if (!isObject(at) || !(part in at)) return undefined;
		at = at[part];
	}
	return at;
}

// ── validateSpec ────────────────────────────────────────────────────────

function checkProp(prop, value, catalog, def) {
	if (isBinding(value)) {
		return typeof value.$state === "string" && value.$state.startsWith("/")
			? null
			: '$state must be a JSON pointer such as "/network"';
	}
	const networks = catalog.networks ?? NETWORK_ORDER;
	if (prop.enum && !prop.enum.includes(value)) {
		return `must be one of ${prop.enum.join(", ")}`;
	}
	switch (prop.type) {
		case "string":
			return typeof value === "string" && value.length > 0
				? null
				: "must be a non-empty string";
		case "string[]":
			return Array.isArray(value) && value.every((v) => typeof v === "string")
				? null
				: "must be a list of strings";
		case "number":
			if (typeof value !== "number" || !Number.isFinite(value)) {
				return "must be a number";
			}
			if (prop.min !== undefined && value < prop.min) {
				return `must be at least ${prop.min}`;
			}
			if (prop.max !== undefined && value > prop.max) {
				return `must be at most ${prop.max}`;
			}
			return null;
		case "network":
			if (!networks.includes(value)) {
				return `must be one of ${networks.join(", ")}`;
			}
			if (def.networks && !def.networks.includes(value)) {
				return `has no data on ${value}; use ${def.networks.join(" or ")}`;
			}
			return null;
		case "network[]":
			return Array.isArray(value) &&
				value.length > 0 &&
				value.every((v) => networks.includes(v)) &&
				new Set(value).size === value.length
				? null
				: `must list distinct networks from ${networks.join(", ")}`;
		case "month":
			return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
				? null
				: "must be YYYY-MM";
		default:
			return `catalog has unknown prop type ${prop.type}`;
	}
}

/**
 * Check a spec against catalog.json. Returns `[{ id, prop, message }]`, empty
 * when the spec is good. `prop` is null for element-level problems.
 */
export function validateSpec(spec, catalog) {
	const errors = [];
	const add = (id, prop, message) => errors.push({ id, prop, message });
	if (!isObject(spec)) {
		add(null, null, "spec must be a JSON object");
		return errors;
	}
	if (spec.version !== 1) add(null, "version", "version must be 1");
	const elements = isObject(spec.elements) ? spec.elements : {};
	if (!isObject(spec.elements)) {
		add(null, "elements", "elements must map ids to elements");
	}
	if (typeof spec.root !== "string" || !isObject(elements[spec.root])) {
		add(
			typeof spec.root === "string" ? spec.root : null,
			"root",
			`root "${spec.root}" is not an element id`,
		);
		return errors;
	}
	const state = isObject(spec.state) ? spec.state : {};
	const components = catalog.components;
	const placeable = Object.keys(components).filter(
		(name) => !components[name].openedFrom,
	);

	for (const [id, el] of Object.entries(elements)) {
		if (!isObject(el)) {
			add(id, "type", "element must be an object");
			continue;
		}
		const def = components[el.type];
		if (!def) {
			add(
				id,
				"type",
				`unknown component "${el.type}"; use one of ${placeable.join(", ")}`,
			);
			continue;
		}
		if (def.openedFrom) {
			add(
				id,
				"type",
				`${el.type} opens from a ${def.openedFrom} row; place a ${def.openedFrom} instead`,
			);
			continue;
		}
		const props = el.props ?? {};
		if (!isObject(props)) {
			add(id, "props", "props must be an object");
			continue;
		}
		for (const [name, prop] of Object.entries(def.props)) {
			if (prop.required && props[name] === undefined) {
				add(id, name, `${el.type} needs ${name}`);
			}
		}
		for (const [name, value] of Object.entries(props)) {
			const prop = def.props[name];
			if (!prop) {
				add(id, name, `${el.type} has no prop ${name}`);
				continue;
			}
			const message = checkProp(prop, value, catalog, def);
			if (message) add(id, name, `${name} ${message}`);
		}
		if (
			el.type === "NetworkTabs" &&
			typeof props.default === "string" &&
			Array.isArray(props.networks) &&
			!props.networks.includes(props.default)
		) {
			add(id, "default", "default must be one of networks");
		}
		if (el.children !== undefined) {
			if (!def.children) {
				add(id, "children", `${el.type} takes no children`);
			} else if (
				!Array.isArray(el.children) ||
				!el.children.every((c) => typeof c === "string")
			) {
				add(id, "children", "children must be a list of element ids");
			} else {
				for (const child of el.children) {
					if (!(child in elements)) {
						add(id, "children", `no element "${child}"`);
					}
				}
			}
		}
		if (
			el.type === "Tabs" &&
			Array.isArray(props.labels) &&
			(el.children?.length ?? 0) !== props.labels.length
		) {
			add(id, "labels", "Tabs needs one child per label");
		}
	}

	const seen = new Set();
	const walk = (id, trail, underTabs) => {
		seen.add(id);
		const el = elements[id];
		if (!isObject(el) || !components[el.type]) return;
		for (const [name, value] of Object.entries(el.props ?? {})) {
			if (!isBinding(value)) continue;
			const pointer = value.$state;
			const written = pointer === "/network" && underTabs;
			if (!written && readPointer(state, pointer) === undefined) {
				add(
					id,
					name,
					`$state ${pointer} has no value: set it in state or put ${id} under NetworkTabs`,
				);
			}
		}
		const tabs = underTabs || el.type === "NetworkTabs";
		for (const child of Array.isArray(el.children) ? el.children : []) {
			if (!isObject(elements[child])) continue;
			if (trail.includes(child)) {
				add(id, "children", `cycle: ${[...trail, child].join(" → ")}`);
				continue;
			}
			if (seen.has(child)) {
				add(id, "children", `"${child}" already has a parent`);
				continue;
			}
			walk(child, [...trail, child], tabs);
		}
	};
	walk(spec.root, [spec.root], false);
	for (const id of Object.keys(elements)) {
		if (!seen.has(id)) {
			add(id, null, `"${id}" is not reachable from root "${spec.root}"`);
		}
	}
	return errors;
}

// ── decideNetworks ──────────────────────────────────────────────────────

/**
 * Which networks a dashboard shows. A named network (or list) wins outright.
 * Otherwise keep the networks the probe reached that hold at least one
 * `resource` ("webhooks" or "subgraphs"), in mainnet, testnet, devnet order.
 * `probe` is probe.ts output. Tabs only when two or more networks remain.
 */
export function decideNetworks({ named, probe, resource = "webhooks" }) {
	const asked = (Array.isArray(named) ? named : named ? [named] : []).filter(
		(n) => NETWORK_ORDER.includes(n),
	);
	if (asked.length > 0) {
		const networks = NETWORK_ORDER.filter((n) => asked.includes(n));
		return { networks, tabs: networks.length > 1 };
	}
	const found = probe?.networks ?? {};
	const networks = NETWORK_ORDER.filter(
		(n) => found[n]?.ok && (found[n][resource]?.length ?? 0) > 0,
	);
	return { networks, tabs: networks.length > 1 };
}

// ── formatting ──────────────────────────────────────────────────────────

const fmt = (n) => Number(n).toLocaleString("en-US");
const usd = (micros) => `$${(Number(micros) / 1e6).toFixed(2)}`;
const pct = (n) => `${(n * 100).toFixed(n >= 0.999 || n === 0 ? 0 : 1)}%`;
const enc = encodeURIComponent;
const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? "" : "s"}`;

/** Group a digit string without going through Number: values can pass 2^53. */
function groupDigits(digits) {
	const m = /^(-?)(\d+)$/.exec(String(digits));
	return m
		? `${m[1]}${m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`
		: String(digits);
}

const middle = (value, head, tail) =>
	`${value.slice(0, head)}…${value.slice(-tail)}`;

/** "SP21YTS…8XEF.pox4-fast-pool-v3": only the address part is shortened. */
function shortenPrincipal(value) {
	const dot = value.indexOf(".");
	const addr = dot > 0 ? value.slice(0, dot) : value;
	const shortAddr = addr.length > 14 ? middle(addr, 6, 4) : addr;
	return dot > 0 ? `${shortAddr}${value.slice(dot)}` : shortAddr;
}

function ago(iso, now) {
	if (!iso) return "never";
	const s = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
	if (s < 60) return `${s}s ago`;
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	return `${Math.floor(s / 86400)}d ago`;
}

function until(iso, now) {
	if (!iso) return "none";
	const s = Math.round((Date.parse(iso) - now.getTime()) / 1000);
	if (s <= 0) return "due now";
	return s < 3600
		? `in ${Math.floor(s / 60)}m ${s % 60}s`
		: `in ${Math.floor(s / 3600)}h`;
}

/** Time of day for today, the date for anything older. */
function clock(iso, now = new Date()) {
	const at = new Date(iso);
	return at.toDateString() === now.toDateString()
		? at.toLocaleTimeString("en-GB", { hour12: false })
		: at.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function csvCell(value) {
	if (value === null || value === undefined) return "null";
	const s = typeof value === "object" ? JSON.stringify(value) : String(value);
	return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

const kb = (text) =>
	`${(new TextEncoder().encode(text).length / 1024).toFixed(1)} KB`;

// ── webhook status and trigger wording (ported from the hosted views) ───

/** The status a webhook shows, which isn't always `webhook.status`. */
function displayStatus(w) {
	if (w.status === "paused" && w.circuitOpenedAt) return "error";
	if (w.status === "paused") return "paused";
	if (w.status === "error" || w.circuitFailures >= DOWN_MIN_CONSECUTIVE) {
		return "error";
	}
	return "active";
}

const STATUS = {
	active: { dot: "ok", text: "Delivering" },
	paused: { dot: "", text: "Paused" },
	error: { dot: "alarm", text: "Failing" },
};

const TRIGGER_NOUN = {
	stx_transfer: "STX transfer",
	stx_mint: "STX mint",
	stx_burn: "STX burn",
	stx_lock: "STX lock",
	ft_transfer: "token transfer",
	ft_mint: "token mint",
	ft_burn: "token burn",
	nft_transfer: "NFT transfer",
	nft_mint: "NFT mint",
	nft_burn: "NFT burn",
	contract_call: "contract call",
	contract_deploy: "contract deploy",
	print_event: "print event",
	nested_contract_call: "nested contract call",
	var_set: "data-var write",
	map_set: "map write",
	map_insert: "map insert",
	map_delete: "map delete",
	sbtc_deposit: "sBTC deposit",
	sbtc_withdrawal_create: "sBTC withdrawal request",
	sbtc_withdrawal_accept: "sBTC withdrawal accept",
	sbtc_withdrawal_reject: "sBTC withdrawal reject",
	sbtc_withdrawal_swept_confirmed: "sBTC withdrawal sweep",
	rune_etch: "rune etch",
	rune_mint: "rune mint",
	rune_transfer: "rune transfer",
	rune_burn: "rune burn",
};

const FIELD_ORDER = [
	"assetIdentifier",
	"contractId",
	"deployer",
	"contractName",
	"functionName",
	"caller",
	"varName",
	"map",
	"topic",
	"where",
	"lockedAddress",
	"bitcoinTxid",
	"sweepTxid",
	"requestId",
	"trait",
	"sender",
	"recipient",
	"rune",
	"address",
	"minAmount",
	"maxAmount",
];

const PRINCIPAL = /^S[PMTN][0-9A-Z]{20,}/;
const SBTC_ASSET = /\.sbtc-token(::|$)/;
const shortHash = (v) => (v.length > 12 ? middle(v, 6, 4) : v);
const t = (text) => ({ text });
const c = (text) => ({ text, code: true });

function principalName(value) {
	const dot = value.indexOf(".");
	return dot > 0 ? value.slice(dot + 1) : shortenPrincipal(value);
}

function pattern(value, kind) {
	if (!value.includes("*")) return c(principalName(value));
	const after = value.includes(".")
		? value.slice(value.indexOf(".") + 1)
		: value;
	const prefix = after.split("*")[0] ?? "";
	return t(prefix ? `any ${kind} starting with ${prefix}` : `any ${kind}`);
}

function token(asset) {
	if (SBTC_ASSET.test(asset)) return "sBTC";
	const [contract = "", name] = asset.split("::");
	return name || principalName(contract);
}

const isSbtc = (tr) =>
	String(tr.type).startsWith("sbtc_") ||
	SBTC_ASSET.test(String(tr.assetIdentifier ?? ""));

function amount(tr, raw) {
	const n = Number(raw);
	const f = (v, d) => v.toLocaleString("en-US", { maximumFractionDigits: d });
	if (String(tr.type).startsWith("stx_")) return `${f(n / 1e6, 6)} STX`;
	if (isSbtc(tr)) return `${f(n / 1e8, 8)} sBTC`;
	return `${f(n, 0)} base units`;
}

function amountPhrase(tr) {
	const { minAmount: min, maxAmount: max } = tr;
	if (min !== undefined && max !== undefined) {
		return `between ${amount(tr, min).split(" ")[0]} and ${amount(tr, max)}`;
	}
	if (min !== undefined) return `${amount(tr, min)} or more`;
	return `${amount(tr, max)} or less`;
}

function listPieces(values) {
	const shown = values.map((v) => (PRINCIPAL.test(v) ? principalName(v) : v));
	if (shown.length === 1) return [c(shown[0])];
	if (shown.length === 2 && `${shown[0]} or ${shown[1]}`.length <= 40) {
		return [c(shown[0]), t(" or "), c(shown[1])];
	}
	const kind = values.every((v) => PRINCIPAL.test(v)) ? "contracts" : "values";
	return [t(`one of these ${values.length} ${kind}`)];
}

const PHRASES = {
	assetIdentifier: (_, v) => [t("of "), c(token(String(v)))],
	contractId: (tr, v) => [
		t(
			`${tr.type === "print_event" ? "from" : /call/.test(String(tr.type)) ? "to" : "on"} `,
		),
		pattern(String(v), "contract"),
	],
	deployer: (_, v) => [t("by "), pattern(String(v), "address")],
	contractName: (_, v) =>
		String(v).includes("*")
			? [t(`with a name starting with ${String(v).split("*")[0]}`)]
			: [t("named "), c(String(v))],
	functionName: (_, v) => [t("calling "), pattern(String(v), "function")],
	caller: (_, v) => [t("made by "), pattern(String(v), "contract")],
	varName: (_, v) => [t("to "), c(String(v))],
	map: (_, v) => [t("to map "), c(String(v))],
	topic: (_, v) => [t("with topic "), c(String(v))],
	lockedAddress: (_, v) => [t("by "), pattern(String(v), "address")],
	bitcoinTxid: (_, v) => [t("from Bitcoin tx "), c(shortHash(String(v)))],
	sweepTxid: (_, v) => [t("in Bitcoin tx "), c(shortHash(String(v)))],
	requestId: (_, v) => [t("for request "), c(`#${v}`)],
	trait: (_, v) => [t("on any contract implementing "), c(String(v))],
	sender: (tr, v) => [
		t(/burn|sbtc_/.test(String(tr.type)) ? "from " : "sent by "),
		pattern(String(v), "address"),
	],
	recipient: (_, v) => [t("to "), pattern(String(v), "address")],
	rune: (_, v) => [t("of "), c(String(v))],
	address: (_, v) => [t("to "), c(shortHash(String(v)))],
};

/** A trigger as one line: "STX transfers to SP3K8…KBR9 of 1,000 STX or more". */
function describeTrigger(tr) {
	const noun = TRIGGER_NOUN[tr.type] ?? tr.type;
	const keys = Object.keys(tr).filter(
		(k) => k !== "type" && tr[k] !== undefined,
	);
	const ordered = [
		...FIELD_ORDER.filter((k) => keys.includes(k)),
		...keys.filter((k) => !FIELD_ORDER.includes(k)),
	];
	if (ordered.length === 0) return [t(`Every ${noun} on chain`)];
	const hasAmount = tr.minAmount !== undefined || tr.maxAmount !== undefined;
	const unitField =
		tr.assetIdentifier !== undefined
			? "assetIdentifier"
			: tr.rune !== undefined
				? "rune"
				: null;
	const head = /^[a-z][A-Z]/.test(noun)
		? noun
		: `${noun.charAt(0).toUpperCase()}${noun.slice(1)}`;
	const line = [t(`${head}s`)];
	for (const key of ordered) {
		const value = tr[key];
		let phrase;
		if (key === "where") {
			for (const [i, [k, v]] of Object.entries(value).entries()) {
				line.push(
					t(" "),
					t(i === 0 ? "where " : "and "),
					c(k),
					t(" is "),
					...listPieces([v].flat().map(String)),
				);
			}
			continue;
		}
		if (key === "minAmount" || key === "maxAmount") {
			if (unitField) continue;
			if (key === "maxAmount" && tr.minAmount !== undefined) continue;
			const a = amountPhrase(tr);
			phrase = [t(a.startsWith("between") ? a : `of ${a}`)];
		} else if (key === unitField && hasAmount) {
			const a = amountPhrase(tr);
			phrase = isSbtc(tr)
				? [t(a.startsWith("between") ? a : `of ${a}`)]
				: [
						t("of "),
						c(key === "rune" ? String(value) : token(String(value))),
						t(`, ${a}`),
					];
		} else {
			const build = PHRASES[key];
			phrase = build
				? build(tr, value)
				: [t("with "), c(key), t(" "), c(String(value))];
		}
		line.push(t(" "), ...phrase);
	}
	return line;
}

const plainText = (pieces) => pieces.map((p) => p.text).join("");

// ── DOM helpers (browser only) ──────────────────────────────────────────

let doc = null;

function h(tag, cls, ...children) {
	const node = doc.createElement(tag);
	if (cls) node.className = cls;
	for (const child of children.flat()) {
		if (child === null || child === undefined || child === false) continue;
		node.append(child instanceof Node ? child : String(child));
	}
	return node;
}

function svg(tag, attrs = {}) {
	const node = doc.createElementNS(SVG_NS, tag);
	for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
	return node;
}

function svgText(x, y, text, anchor = "middle") {
	const node = svg("text", { x, y, "text-anchor": anchor });
	node.textContent = text;
	return node;
}

const dot = (kind) => h("span", `dot ${kind ?? ""}`);
const eyebrow = (text) => h("span", "eyebrow", text);
const pieces = (list) =>
	list.map((p) => (p.code ? h("code", null, p.text) : p.text));

function emptyCard(reason, next) {
	return h(
		"div",
		"empty",
		h("p", null, reason),
		next ? h("p", "sub", next) : null,
	);
}

function button(cls, ...children) {
	const b = h("button", cls, ...children);
	b.type = "button";
	return b;
}

const ICON_PATHS = {
	copy: [
		["rect", { x: 3.5, y: 3.5, width: 7, height: 7, rx: 1.5 }],
		[
			"path",
			{
				d: "M8.5 2.5V2a.5.5 0 0 0-.5-.5H2a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 .5.5h.5",
			},
		],
	],
	done: [
		[
			"path",
			{
				d: "M2 6.4 4.8 9 10 3",
				"stroke-width": 1.4,
				"stroke-linecap": "round",
				"stroke-linejoin": "round",
			},
		],
	],
};

/** The copy icon, or the check it swaps to for a moment after a copy. */
function icon(kind) {
	const node = svg("svg", { viewBox: "0 0 12 12", "aria-hidden": "true" });
	for (const [tag, attrs] of ICON_PATHS[kind]) {
		node.append(svg(tag, { fill: "none", stroke: "currentColor", ...attrs }));
	}
	return node;
}

// ── SVG charts, ported from the direction mock ─────────────────────────

/** Delivered per day as a line; days with failed attempts get a red dot. */
function sparkline(days) {
	const W = 120;
	const H = 28;
	const p = 2;
	const s = svg("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
	if (days.length < 2) return s;
	const max = Math.max(1, ...days.map((d) => d.delivered));
	const x = (i) => p + (i * (W - 2 * p)) / (days.length - 1);
	const y = (v) => H - p - (v * (H - 2 * p)) / max;
	const pts = days
		.map((d, i) => `${x(i).toFixed(1)},${y(d.delivered).toFixed(1)}`)
		.join(" ");
	s.append(
		svg("polygon", {
			points: `${p},${H - p} ${pts} ${W - p},${H - p}`,
			class: "area",
		}),
		svg("polyline", { points: pts, class: "line" }),
	);
	days.forEach((d, i) => {
		if (d.failed > 0) {
			s.append(
				svg("circle", { cx: x(i), cy: y(d.delivered), r: 2.2, class: "fail" }),
			);
		}
	});
	const last = days.length - 1;
	if (!(days[last].failed > 0)) {
		s.append(
			svg("circle", {
				cx: x(last),
				cy: y(days[last].delivered),
				r: 2.2,
				class: "tip",
			}),
		);
	}
	return s;
}

function niceMax(v) {
	if (v <= 0) return 1;
	const mag = 10 ** Math.floor(Math.log10(v));
	const step = [1, 2, 2.5, 5, 10].find((m) => m * mag >= v) ?? 10;
	return step * mag;
}

const shortNum = (v) =>
	v >= 1e6
		? `${+(v / 1e6).toFixed(1)}M`
		: v >= 1e3
			? `${+(v / 1e3).toFixed(1)}k`
			: `${+v.toFixed(2)}`;

function axis(s, { L, R, y, max, label = shortNum }) {
	for (let i = 0; i <= 4; i++) {
		const v = (max * i) / 4;
		s.append(
			svg("line", { x1: L, x2: R, y1: y(v), y2: y(v), class: "grid" }),
			svgText(L - 6, y(v) + 3, label(v), "end"),
		);
	}
}

/** Grouped bars: `rows` = [{ label, values: number[] }], one value per series. */
function bars(rows, seriesCount) {
	const W = 560;
	const H = 200;
	const L = 40;
	const B = 24;
	const T = 8;
	const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
	const max = niceMax(Math.max(0, ...rows.flatMap((r) => r.values)));
	const y = (v) => T + (H - T - B) * (1 - v / max);
	axis(s, { L, R: W - 4, y, max });
	const cw = (W - L - 8) / Math.max(1, rows.length);
	const bw = Math.max(2, Math.min(12, cw / seriesCount - 3));
	const every = Math.ceil(rows.length / 7);
	rows.forEach((row, i) => {
		const cx = L + cw * i + cw / 2;
		const start = cx - (bw * seriesCount + (seriesCount - 1)) / 2;
		row.values.forEach((v, k) => {
			s.append(
				svg("rect", {
					x: start + k * (bw + 1),
					y: y(v),
					width: bw,
					height: Math.max(0, H - B - y(v)),
					rx: 1.5,
					class: `s${k}`,
				}),
			);
		});
		if (i % every === 0) s.append(svgText(cx, H - 8, row.label));
	});
	return s;
}

/** Delivered (ink) with failed (alarm) stacked on top, one bar per day. */
function stackedDays(days) {
	const W = 560;
	const H = 150;
	const L = 34;
	const B = 22;
	const T = 8;
	const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
	const max = niceMax(Math.max(0, ...days.map((d) => d.delivered + d.failed)));
	const y = (v) => T + (H - T - B) * (1 - v / max);
	axis(s, { L, R: W - 4, y, max });
	const cw = (W - L - 4) / Math.max(1, days.length);
	const bw = Math.max(3, cw - 5);
	days.forEach((d, i) => {
		const x = L + cw * i + (cw - bw) / 2;
		if (d.delivered > 0) {
			s.append(
				svg("rect", {
					x,
					y: y(d.delivered),
					width: bw,
					height: H - B - y(d.delivered),
					rx: 1.5,
					class: "s0",
				}),
			);
		}
		if (d.failed > 0) {
			const top = y(d.delivered + d.failed);
			s.append(
				svg("rect", {
					x,
					y: top,
					width: bw,
					height: Math.max(1, y(d.delivered) - top - (d.delivered ? 1 : 0)),
					rx: 1.5,
					class: "failbar",
				}),
			);
		}
		const last = i === days.length - 1;
		if (last || (i % 7 === 0 && days.length - 1 - i > 3)) {
			s.append(
				svgText(x + bw / 2, H - 6, d.day.slice(5), last ? "end" : "middle"),
			);
		}
	});
	return s;
}

/** Cumulative line over a month, with a dashed projection to month end. */
function cumulative(points, { days, projected, label }) {
	const W = 560;
	const H = 190;
	const L = 52;
	const B = 24;
	const T = 10;
	const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
	const top = niceMax(Math.max(projected, ...points.map((p) => p.v), 0));
	const x = (d) => L + (W - L - 10) * (d / days);
	const y = (v) => T + (H - T - B) * (1 - v / top);
	axis(s, { L, R: W - 10, y, max: top, label });
	if (points.length > 0) {
		const pts = [{ d: 0, v: 0 }, ...points];
		const line = pts.map((p) => `${x(p.d)},${y(p.v)}`).join(" ");
		const last = pts[pts.length - 1];
		s.append(
			svg("polygon", {
				points: `${x(0)},${y(0)} ${line} ${x(last.d)},${y(0)}`,
				class: "area",
			}),
			svg("polyline", { points: line, class: "line" }),
			svg("line", {
				x1: x(last.d),
				y1: y(last.v),
				x2: x(days),
				y2: y(projected),
				class: "projection",
			}),
			svg("circle", { cx: x(last.d), cy: y(last.v), r: 3, class: "tip" }),
		);
	}
	for (const d of [0, 7, 14, 21, days]) {
		s.append(
			svgText(
				x(d),
				H - 8,
				`day ${d === days ? d : d + 1}`,
				d === 0 ? "start" : d === days ? "end" : "middle",
			),
		);
	}
	return s;
}

// ── data errors, in the user's terms ───────────────────────────────────

class ReadError extends Error {
	constructor(status, message, next) {
		super(message);
		this.status = status;
		this.next = next;
	}
}

function readError(status, body, network, path) {
	if (status === 401 || status === 403) {
		return network === "devnet"
			? new ReadError(status, "Token missing or wrong: set INSTANCE_TOKEN")
			: new ReadError(status, "Key missing or wrong: set SECONDLAYER_API_KEY");
	}
	if (status === 502 || status === 504) {
		return new ReadError(
			status,
			`${networkName(network)} is not answering`,
			body?.error,
		);
	}
	const detail = body?.error ?? body?.message;
	return new ReadError(
		status,
		`${status} from ${path}${detail ? `: ${detail}` : ""}`,
	);
}

const notFound = (err) =>
	err instanceof ReadError && (err.status === 404 || err.status === 400);

const missingWebhook = (id, network) =>
	emptyCard(
		`No webhook ${id} on ${networkName(network)}`,
		"Run probe.ts and use an id it lists.",
	);

/** Read one webhook; ids are UUIDs, so anything else can only be missing. */
async function readWebhook(ctx, network, id, suffix = "") {
	if (!UUID.test(id)) throw new ReadError(404, "not a webhook id");
	return ctx.get(network, `/api/webhooks/${enc(id)}${suffix}`);
}

/** Pick webhooks by id; ids not on this network come back as `missing`. */
function pick(list, ids) {
	if (!ids?.length) return { found: list, missing: [] };
	return {
		found: list.filter((w) => ids.includes(w.id)),
		missing: ids.filter((id) => !list.some((w) => w.id === id)),
	};
}

function foldHoursToDays(hours) {
	const byDay = new Map();
	for (const hr of hours ?? []) {
		const day = hr.hour.slice(0, 10);
		const d = byDay.get(day) ?? { day, delivered: 0, failed: 0 };
		d.delivered += hr.delivered;
		d.failed += hr.failed;
		byDay.set(day, d);
	}
	return [...byDay.values()].slice(-7);
}

// ── JSON view (ported: webhooks/payload-view.tsx) ───────────────────────

const CLAMP_OVER = 80;
const CLAMP_HEAD = 26;
const CLAMP_TAIL = 12;
const RESPONSE_CAP = 8192;

function collectStrings(value, into) {
	if (typeof value === "string") into.push(value);
	else if (Array.isArray(value)) for (const v of value) collectStrings(v, into);
	else if (value && typeof value === "object") {
		for (const v of Object.values(value)) collectStrings(v, into);
	}
}

/** True for a string equal to a trigger filter value; `x*` matches by prefix. */
function markMatcher(triggers) {
	const patterns = [];
	for (const trigger of triggers) {
		for (const [field, value] of Object.entries(trigger)) {
			if (field !== "type") collectStrings(value, patterns);
		}
	}
	const exact = new Set(patterns.filter((p) => !p.endsWith("*")));
	const prefixes = patterns
		.filter((p) => p.endsWith("*"))
		.map((p) => p.slice(0, -1));
	return (value) =>
		exact.has(value) || prefixes.some((p) => value.startsWith(p));
}

/** Pieces of a JSON-encoded string (quotes included), or null when it fits. */
function clampString(json) {
	if (json.length <= CLAMP_OVER) return null;
	return {
		head: json.slice(0, CLAMP_HEAD),
		tail: json.slice(-CLAMP_TAIL),
		hidden: json.length - (CLAMP_HEAD + CLAMP_TAIL),
	};
}

function jsonString(value, marked) {
	const json = JSON.stringify(value);
	const clamp = clampString(json);
	let body;
	if (!clamp) body = h("span", "s", json);
	else {
		const more = button("pv-more", `+${fmt(clamp.hidden)}`);
		body = h(
			"span",
			null,
			h("span", "s", clamp.head),
			h("span", "p", "…"),
			h("span", "s", clamp.tail),
			more,
		);
		more.addEventListener("click", () =>
			body.replaceChildren(h("span", "s", json)),
		);
	}
	return marked ? h("span", "m", body) : body;
}

function jsonNode(value, depth, isMarked) {
	if (typeof value === "string") return jsonString(value, isMarked(value));
	if (typeof value === "number") return h("span", "n", String(value));
	if (value === null || typeof value !== "object")
		return h("span", "b", String(value));
	const isArray = Array.isArray(value);
	const entries = isArray
		? value.map((v, i) => [String(i), v])
		: Object.entries(value);
	const [open, close] = isArray ? ["[", "]"] : ["{", "}"];
	if (entries.length === 0) return h("span", "p", `${open}${close}`);
	const pad = "  ".repeat(depth);
	const out = [h("span", "p", open)];
	entries.forEach(([key, child], i) => {
		out.push(`\n${pad}  `);
		if (!isArray)
			out.push(h("span", "key", JSON.stringify(key)), h("span", "p", ": "));
		out.push(jsonNode(child, depth + 1, isMarked));
		if (i < entries.length - 1) out.push(h("span", "p", ","));
	});
	out.push(`\n${pad}`, h("span", "p", close));
	return h("span", null, out);
}

const jsonView = (value, isMarked = () => false) =>
	h("div", "j", jsonNode(value, 0, isMarked));

// ── panels ──────────────────────────────────────────────────────────────

/** A titled panel: heading on the left, caption on the right, then the body. */
function panel({ title, caption, head }) {
	const heading = head ?? h("h2", null, title);
	const cap = h("span", null, caption ?? "");
	const meta = h("div", "meta", cap);
	const body = h("div", "pbody", h("p", "sub mono", "loading…"));
	const wrap = h("section", "panel", h("div", "ptitle", heading, meta), body);
	return {
		wrap,
		body,
		meta,
		set(...nodes) {
			body.replaceChildren(...nodes.flat().filter(Boolean));
		},
		fail(err) {
			body.replaceChildren(emptyCard(err.message, err.next));
		},
		setTitle(text) {
			if (!head) heading.textContent = text;
		},
		setCaption(text) {
			cap.textContent = text;
		},
	};
}

/**
 * Poll `load` on the component's catalog interval. `load` draws and returns
 * the data the page prompt describes; an error draws a card and is recorded.
 */
function live(ctx, scope, { id, type, p }, load) {
	scope.every(
		ctx.poll(type),
		async () => {
			const data = await load();
			if (data !== undefined) ctx.data.set(id, data);
		},
		(err) => {
			p.fail(err);
			ctx.data.set(id, { error: err.message });
		},
	);
}

/** A not-found read draws a card naming what's missing and records it. */
function missing(p, message, next) {
	p.set(emptyCard(message, next));
	return { error: message };
}

const PROBE_HINT = "Run probe.ts and use an id it lists.";
const TABLE_HINT = "Run probe.ts and use a subgraph and table it lists.";

// ── payload (ported: webhooks/payload-view.tsx) ─────────────────────────

/** One delivery: Sent and Response tabs. A failed attempt opens on Response. */
function payloadView(ctx, { network, webhook, row, onDetail }) {
	const path = `/api/webhooks/${enc(webhook.id)}/deliveries/${enc(row.id)}`;
	const sentTab = button(null, "Sent");
	const respTab = button(null, `Response ${row.statusCode ?? "none"}`);
	for (const b of [sentTab, respTab]) b.setAttribute("role", "tab");
	const tabs = h("div", "tabbar", sentTab, respTab);
	tabs.setAttribute("role", "tablist");
	const gone = h(
		"p",
		"pv-note pv-note-in",
		"The payload isn't kept after delivery cleanup. The response is below.",
	);
	const body = h("div", "pv-body", "Loading…");
	const note = h("p", "pv-note");
	const view = h(
		"div",
		null,
		h("div", "pv", h("div", "pv-bar", tabs), gone, body),
		note,
	);
	const failed = !(row.statusCode >= 200 && row.statusCode < 300);
	let tab = failed ? "response" : "sent";
	let detail = null;
	let triggers = [];
	let error = null;
	let host = webhook.url;
	try {
		host = new URL(webhook.url).host;
	} catch {}

	const draw = () => {
		sentTab.setAttribute("aria-selected", String(tab === "sent"));
		respTab.setAttribute("aria-selected", String(tab === "response"));
		const payload = detail?.payload ?? null;
		const response = detail?.responseBody ?? row.responseBody ?? null;
		if (response) {
			respTab.replaceChildren(
				`Response ${row.statusCode ?? "none"}`,
				h("span", "n", kb(response)),
			);
		}
		if (payload !== null) {
			sentTab.replaceChildren(
				"Sent",
				h("span", "n", kb(JSON.stringify(payload, null, 2))),
			);
		}
		gone.hidden = !(detail && payload === null);
		note.hidden = tab !== "response";
		note.textContent = `What ${host} sent back. Stored up to 8 KB per attempt.`;
		if (tab === "sent") {
			if (error) body.replaceChildren(error);
			else if (detail && payload !== null) {
				body.replaceChildren(jsonView(payload, markMatcher(triggers)));
			}
			return;
		}
		if (!response) {
			body.replaceChildren("The receiver sent no body.");
			return;
		}
		try {
			body.replaceChildren(jsonView(JSON.parse(response)));
		} catch {
			body.replaceChildren(
				h(
					"div",
					"raw",
					response,
					response.length >= RESPONSE_CAP ? "\n\nCut at 8 KB." : "",
				),
			);
		}
	};
	sentTab.addEventListener("click", () => {
		tab = "sent";
		draw();
	});
	respTab.addEventListener("click", () => {
		tab = "response";
		draw();
	});
	draw();

	Promise.all([
		ctx.get(network, path),
		ctx.get(network, `/api/webhooks/${enc(webhook.id)}`),
	])
		.then(([d, w]) => {
			detail = d;
			triggers = w.triggers ?? [];
			if (d.payload === null) tab = "response";
			onDetail(d);
			draw();
		})
		.catch((err) => {
			error = err.message;
			draw();
		});
	return view;
}

// ── row panel (ported: subgraphs/row-panel.tsx) ─────────────────────────

const NUMERIC_TYPES = new Set(["uint", "int", "bigint", "serial"]);
const SYSTEM_COLUMNS = new Set([
	"_id",
	"_block_height",
	"_tx_id",
	"_created_at",
]);

function formatCell(type, name, value) {
	if (value === null || value === undefined) {
		return { text: "null", tone: "faint" };
	}
	if (name === "_tx_id") {
		const full = String(value);
		const hex = full.replace(/^0x/, "");
		return {
			text: hex.length > 8 ? `0x${middle(hex, 4, 4)}` : full,
			title: full,
			tone: "sub",
		};
	}
	if (NUMERIC_TYPES.has(type)) {
		return { text: groupDigits(String(value)), tone: "ink" };
	}
	const full =
		type === "jsonb" && typeof value !== "string"
			? JSON.stringify(value)
			: String(value);
	if (type === "principal" && full.length > 14) {
		return { text: middle(full, 5, 4), title: full, tone: "ink" };
	}
	if (type === "jsonb" && full.length > 60) {
		return { text: `${full.slice(0, 60)}…`, title: full, tone: "ink" };
	}
	if (type === "timestamp") {
		const ms = new Date(full).getTime();
		return {
			text: Number.isFinite(ms)
				? `${new Date(ms).toISOString().slice(0, 19)}Z`
				: full,
			tone: "ink",
		};
	}
	if (full.length > 48) {
		return { text: middle(full, 24, 18), title: full, tone: "ink" };
	}
	return { text: full, tone: "ink" };
}

function fullValue(type, value) {
	if (value === null || value === undefined) return "null";
	if (type === "jsonb") return JSON.stringify(value, null, 2);
	if (NUMERIC_TYPES.has(type)) return groupDigits(String(value));
	return String(value);
}

/** `_block_height`, then the table's own columns, then `_tx_id`. */
function gridColumns(columns) {
	const own = Object.keys(columns).filter((n) => !n.startsWith("_"));
	return [
		...("_block_height" in columns ? ["_block_height"] : []),
		...own,
		...("_tx_id" in columns ? ["_tx_id"] : []),
	];
}

function rowPanel(ctx, { columns, row }) {
	const names = Object.keys(columns).length
		? Object.keys(columns)
		: Object.keys(row);
	const fields = h(
		"dl",
		"sg-fields",
		names.map((n) => {
			const value = row[n];
			const empty = value === null || value === undefined;
			return h(
				"div",
				"sg-field",
				h("dt", null, n),
				h(
					"dd",
					empty ? "sg-null" : null,
					fullValue(columns[n]?.type ?? "text", value),
				),
			);
		}),
	);
	const tx = formatCell("text", "_tx_id", row._tx_id);
	const txCell = h("dd", null, tx.text);
	if (tx.title) txCell.title = tx.title;
	const block = row._block_height;
	const written = row._created_at;
	const came = h(
		"dl",
		"rw-kv",
		h(
			"div",
			null,
			h("dt", null, "Block"),
			h(
				"dd",
				null,
				block === null || block === undefined
					? "–"
					: `#${groupDigits(String(block))}`,
			),
		),
		h("div", null, h("dt", null, "Transaction"), txCell),
		h(
			"div",
			null,
			h("dt", null, "Written"),
			h(
				"dd",
				null,
				typeof written === "string" ? ago(written, ctx.now()) : "–",
			),
		),
	);
	return h(
		"div",
		"sg-rowx",
		h(
			"div",
			"sg-rowx-col",
			eyebrow(`Row ${groupDigits(String(row._id ?? ""))}`),
			fields,
		),
		h(
			"div",
			"sg-rowx-col",
			eyebrow("Where it came from"),
			came,
			h(
				"span",
				"faint",
				"Every row keeps the block and transaction it came from, so you can check it against the chain.",
			),
		),
	);
}

// ── subgraph reads ──────────────────────────────────────────────────────

const rowsPath = (subgraph, table, limit) =>
	`/v1/subgraphs/${enc(subgraph)}/${enc(table)}?_sort=_block_height&_order=desc&_limit=${limit}`;

/** A table's columns from `/api/subgraphs/:name`; null when it isn't there. */
async function readTable(ctx, network, subgraph, table) {
	try {
		const detail = await ctx.get(network, `/api/subgraphs/${enc(subgraph)}`);
		return detail.tables?.[table] ?? null;
	} catch (err) {
		if (notFound(err)) return null;
		throw err;
	}
}

/** A table's newest rows; null when the subgraph or table isn't there. */
async function readRows(ctx, network, subgraph, table, limit) {
	try {
		const data = await ctx.get(network, rowsPath(subgraph, table, limit));
		return data.rows ?? [];
	} catch (err) {
		if (notFound(err)) return null;
		throw err;
	}
}

const noTable = (p, subgraph, table, network) =>
	missing(
		p,
		`No subgraph ${subgraph} with table ${table} on ${networkName(network)}`,
		TABLE_HINT,
	);

/** Mark whether each column is indexed and what the platform adds. */
function schemaOf(info) {
	return Object.entries(info.columns ?? {}).map(([name, column]) => ({
		name,
		type: column.type,
		indexed:
			name === "_id" ||
			Boolean(column.indexed) ||
			(info.indexes ?? []).some((index) => index[0] === name),
		notes: [
			SYSTEM_COLUMNS.has(name) ? "added by secondlayer" : null,
			column.nullable ? "nullable" : null,
			column.searchable ? "searchable" : null,
		]
			.filter(Boolean)
			.join(" · "),
	}));
}

const webhookLine = (w) =>
	`${w.name} (${w.id}): ${STATUS[displayStatus(w)].text}${
		w.circuitOpenedAt ? ` since ${w.circuitOpenedAt}` : ""
	}, last success ${w.lastSuccessAt ?? "never"}`;

const okStatus = (code) => code !== null && code >= 200 && code < 300;

// ── components ──────────────────────────────────────────────────────────
// Each entry draws itself (`render`), says what the page prompt shows for it
// (`prompt(props, data)`, from the data its last read recorded) and lists the
// reads behind it (`reads(props, data)`).

const CATALOG = {
	Page: {
		render({ props, kids }) {
			return h(
				"div",
				"page",
				h(
					"div",
					"dtitle",
					h("h1", null, props.title),
					props.subtitle ? h("p", "sub", props.subtitle) : null,
				),
				kids(),
			);
		},
		prompt: () => [],
		reads: () => [],
	},

	Stack: {
		render({ props, kids }) {
			return h("div", props.columns === 2 ? "stack cols2" : "stack", kids());
		},
		prompt: () => [],
		reads: () => [],
	},

	Tabs: {
		render({ id, props, ctx, kids }) {
			const bar = h("div", "tabbar");
			bar.setAttribute("role", "tablist");
			const views = kids();
			const show = (index) => {
				ctx.ui.tabs[id] = index;
				[...bar.children].forEach((b, i) => {
					b.setAttribute("aria-selected", String(i === index));
				});
				views.forEach((view, i) => {
					view.hidden = i !== index;
				});
			};
			props.labels.forEach((label, i) => {
				const b = button(null, label);
				b.setAttribute("role", "tab");
				b.addEventListener("click", () => show(i));
				bar.append(b);
			});
			show(0);
			return h("div", "tabs", bar, views);
		},
		prompt: () => [],
		reads: () => [],
	},

	NetworkTabs: {
		render({ props, ctx, scope, kids }) {
			const bar = h("div", "tabbar");
			bar.setAttribute("role", "tablist");
			bar.hidden = true;
			const body = h("div", "stack", h("p", "sub mono", "checking networks…"));
			const wrap = h("div", "tabs", bar, body);
			let childScope = null;
			const show = (network) => {
				ctx.state.network = network;
				childScope?.dispose();
				childScope = scope.child();
				for (const b of bar.children) {
					b.setAttribute(
						"aria-selected",
						String(b.dataset.network === network),
					);
				}
				body.replaceChildren(...kids(childScope));
			};
			ctx
				.health()
				.then((health) => {
					const reachable = props.networks.filter((n) => health[n]?.ok);
					if (reachable.length === 0) {
						body.replaceChildren(
							emptyCard(
								"No network is answering",
								`Tried ${props.networks.map(networkName).join(", ")}.`,
							),
						);
						return;
					}
					if (reachable.length > 1) {
						ctx.ui.networks = reachable;
						for (const network of reachable) {
							const b = button(null, networkName(network));
							b.dataset.network = network;
							b.setAttribute("role", "tab");
							b.addEventListener("click", () => show(network));
							bar.append(b);
						}
						bar.hidden = false;
					} else {
						wrap.prepend(h("span", "chip", networkName(reachable[0])));
					}
					show(
						reachable.includes(props.default) ? props.default : reachable[0],
					);
				})
				.catch((err) => body.replaceChildren(emptyCard(err.message, err.next)));
			return wrap;
		},
		prompt: () => [],
		reads: () => [],
	},

	Summary: {
		render({ id, props, ctx, scope }) {
			const { network } = props;
			const line = h("div", "summary");
			const p = panel({ head: line });
			p.body.hidden = true;
			live(ctx, scope, { id, type: "Summary", p }, async () => {
				const { data } = await ctx.get(network, "/api/webhooks");
				const { found, missing: gone } = pick(data, props.webhookIds);
				const by = (s) => found.filter((w) => displayStatus(w) === s);
				const failing = by("error");
				const paused = by("paused");
				const since = failing
					.map((w) => w.circuitOpenedAt)
					.filter(Boolean)
					.sort()[0];
				line.replaceChildren(
					h("span", null, h("b", null, plural(found.length, "webhook"))),
					h("span", null, dot("ok"), `${by("active").length} delivering`),
					failing.length
						? h(
								"span",
								"alarmtxt",
								dot("alarm"),
								`${failing.length} failing${since ? ` since ${clock(since, ctx.now())}` : ""}`,
							)
						: "",
					paused.length
						? h("span", null, dot(), `${paused.length} paused`)
						: "",
				);
				const extra = [
					...(found.length === 0 && gone.length === 0
						? [emptyCard(`No webhooks on ${networkName(network)}`)]
						: []),
					...gone.map((wid) => missingWebhook(wid, network)),
				];
				p.set(extra);
				p.body.hidden = extra.length === 0;
				return { webhooks: found, missing: gone, since };
			});
			return p.wrap;
		},
		prompt(_props, d) {
			const count = (s) =>
				d.webhooks.filter((w) => displayStatus(w) === s).length;
			return [
				[
					plural(d.webhooks.length, "webhook"),
					`${count("active")} delivering`,
					count("error")
						? `${count("error")} failing${d.since ? ` since ${d.since}` : ""}`
						: null,
					count("paused") ? `${count("paused")} paused` : null,
				]
					.filter(Boolean)
					.join(" · "),
				...d.missing.map((wid) => `Not found: webhook ${wid}`),
			];
		},
		reads: () => ["/api/webhooks"],
	},

	WebhookTable: {
		render({ id, props, ctx, scope }) {
			const { network } = props;
			const days = props.days ?? 30;
			const query = days === 30 ? "?days=30" : "";
			const p = panel({ title: "Webhooks", caption: `last ${days} days` });
			live(ctx, scope, { id, type: "WebhookTable", p }, async () => {
				const { data } = await ctx.get(network, "/api/webhooks");
				const { found, missing: gone } = pick(data, props.webhookIds);
				const activity = await Promise.all(
					found.map((w) =>
						ctx
							.get(network, `/api/webhooks/${enc(w.id)}/activity${query}`)
							.catch((err) => err),
					),
				);
				const rows = found.map((w, i) => {
					const act = activity[i] instanceof Error ? null : activity[i];
					const series = act
						? days === 30
							? (act.days ?? [])
							: foldHoursToDays(act.hours)
						: [];
					const delivered = series.reduce((n, d) => n + d.delivered, 0);
					const failed = series.reduce((n, d) => n + d.failed, 0);
					return {
						w,
						series,
						delivered,
						failed,
						waiting: act?.waiting ?? null,
					};
				});
				const notes = gone.map((wid) => missingWebhook(wid, network));
				if (rows.length === 0) {
					p.set(
						gone.length
							? notes
							: emptyCard(`No webhooks on ${networkName(network)}`),
					);
				} else {
					const head = h(
						"tr",
						null,
						h("th", null, "Name"),
						h("th", null, `${days} days`),
						h("th", "num", "Delivered"),
						h("th", "num", "Failed"),
						h("th", "num", "Success"),
						h("th", "num", "Waiting"),
						h("th", "num", "Last success"),
						h("th", null, "Status"),
					);
					const body = rows.map(({ w, series, delivered, failed, waiting }) => {
						const st = STATUS[displayStatus(w)];
						const attempts = delivered + failed;
						let host = w.url;
						try {
							host = new URL(w.url).host;
						} catch {}
						return h(
							"tr",
							null,
							h("td", null, h("div", "name", w.name), h("div", "why", host)),
							h("td", "sp", waiting === null ? "—" : sparkline(series)),
							h("td", "num", fmt(delivered)),
							h("td", `num${failed ? " alarmtxt" : ""}`, fmt(failed)),
							h("td", "num", attempts ? pct(delivered / attempts) : "—"),
							h("td", "num", waiting === null ? "—" : fmt(waiting)),
							h("td", "num", ago(w.lastSuccessAt, ctx.now())),
							h(
								"td",
								null,
								h(
									"span",
									`chip ${st.dot === "alarm" ? "alarmtxt" : ""}`,
									dot(st.dot),
									st.text,
								),
							),
						);
					});
					p.set(
						h(
							"div",
							"scroll",
							h("table", null, h("thead", null, head), h("tbody", null, body)),
						),
						notes,
					);
				}
				return {
					days,
					missing: gone,
					rows: rows.map(({ w, delivered, failed, waiting }) => ({
						webhook: w,
						delivered,
						failed,
						waiting,
					})),
				};
			});
			return p.wrap;
		},
		prompt(_props, d) {
			return [
				`Webhooks, last ${d.days} days:`,
				...d.rows.map(({ webhook: w, delivered, failed, waiting }) => {
					const attempts = delivered + failed;
					return `- ${webhookLine(w)}; delivered ${delivered}, failed ${failed}, success ${attempts ? pct(delivered / attempts) : "n/a"}, waiting ${waiting ?? "n/a"}`;
				}),
				...d.missing.map((wid) => `Not found: webhook ${wid}`),
			];
		},
		reads: (props) => [
			"/api/webhooks",
			`/api/webhooks/{id}/activity${(props.days ?? 30) === 30 ? "?days=30" : ""}`,
		],
	},

	DeliveryFeed: {
		render({ id, props, ctx, scope }) {
			const { network } = props;
			const limit = props.limit ?? 6;
			const single = props.webhookIds?.length === 1;
			const p = panel({
				title: single ? "Attempts" : "Deliveries",
				caption: "newest first",
			});
			let openId = null;
			let first = true;
			const drawers = new Map();
			const details = new Map();
			const drawerFor = (w, d) => {
				if (!drawers.has(d.id)) {
					const view = payloadView(ctx, {
						network,
						webhook: w,
						row: d,
						onDetail: (detail) => {
							details.set(d.id, detail);
							if (ctx.ui.open?.deliveryId === d.id)
								ctx.ui.open.data.detail = detail;
						},
					});
					drawers.set(d.id, h("div", "drawer", view));
				}
				return drawers.get(d.id);
			};
			const setOpen = (w, d) => {
				openId = d?.id ?? null;
				if (d) {
					ctx.ui.open = {
						type: "Payload",
						from: id,
						network,
						deliveryId: d.id,
						data: {
							webhook: w,
							delivery: d,
							detail: details.get(d.id) ?? null,
						},
					};
				} else if (ctx.ui.open?.from === id) {
					ctx.ui.open = null;
				}
			};
			scope.onDispose(() => {
				if (ctx.ui.open?.from === id) ctx.ui.open = null;
			});
			live(ctx, scope, { id, type: "DeliveryFeed", p }, async () => {
				const { data } = await ctx.get(network, "/api/webhooks");
				const { found, missing: gone } = pick(data, props.webhookIds);
				const pages = await Promise.all(
					found.map((w) =>
						ctx.get(network, `/api/webhooks/${enc(w.id)}/deliveries`),
					),
				);
				const rows = pages
					.flatMap((page, i) => page.data.map((d) => ({ w: found[i], d })))
					.sort((a, b) => b.d.dispatchedAt.localeCompare(a.d.dispatchedAt))
					.slice(0, limit);
				if (first) {
					first = false;
					const start =
						props.open === "newest-failed"
							? rows.find((r) => !okStatus(r.d.statusCode))
							: null;
					if (start) setOpen(start.w, start.d);
				}
				const notes = gone.map((wid) => missingWebhook(wid, network));
				if (rows.length === 0) {
					p.set(
						found.length || gone.length === 0
							? emptyCard(`No deliveries yet on ${networkName(network)}`)
							: null,
						notes,
					);
				} else {
					const list = h("ul", "feed");
					for (const { w, d } of rows) {
						const row = button(
							"row",
							h("span", "t", clock(d.dispatchedAt, ctx.now())),
							h(
								"span",
								"w",
								single ? null : `${w.name} `,
								h(
									"small",
									null,
									d.blockHeight === null
										? "test delivery"
										: `block ${fmt(d.blockHeight)}`,
									d.attempt > 1 ? ` · attempt ${d.attempt}` : "",
								),
							),
							h(
								"span",
								`s ${okStatus(d.statusCode) ? "oktxt" : "alarmtxt"}`,
								d.statusCode ?? "no response",
							),
							h("span", "chev", "›"),
						);
						const li = h("li", null, row);
						const isOpen = openId === d.id;
						row.setAttribute("aria-expanded", String(isOpen));
						if (isOpen) {
							li.classList.add("open");
							li.append(drawerFor(w, d));
						}
						row.addEventListener("click", () => {
							const opening = openId !== d.id;
							for (const other of list.children) {
								other.classList.remove("open");
								other
									.querySelector(".row")
									.setAttribute("aria-expanded", "false");
								other.querySelector(".drawer")?.remove();
							}
							setOpen(w, opening ? d : null);
							if (opening) {
								li.classList.add("open");
								row.setAttribute("aria-expanded", "true");
								li.append(drawerFor(w, d));
							}
						});
						list.append(li);
					}
					p.set(list, notes);
				}
				return {
					missing: gone,
					rows: rows.map(({ w, d }) => ({
						webhook: { id: w.id, name: w.name },
						delivery: d,
					})),
				};
			});
			return p.wrap;
		},
		prompt(props, d) {
			const single = props.webhookIds?.length === 1;
			return [
				`${single ? "Attempts" : "Deliveries"}, newest first:`,
				...d.rows.map(
					({ webhook: w, delivery: x }) =>
						`  ${x.dispatchedAt}  ${single ? "" : `${w.name}  `}delivery ${x.id}  block ${x.blockHeight ?? "-"}${x.attempt > 1 ? `  attempt ${x.attempt}` : ""}  → ${x.statusCode ?? x.errorMessage ?? "no response"}`,
				),
				...d.missing.map((wid) => `Not found: webhook ${wid}`),
			];
		},
		reads: () => ["/api/webhooks", "/api/webhooks/{id}/deliveries"],
	},

	Payload: {
		prompt(_props, d) {
			const { webhook: w, delivery: x, detail } = d;
			const response = String(
				detail?.responseBody ?? x.responseBody ?? x.errorMessage ?? "",
			)
				.replace(/\s+/g, " ")
				.slice(0, 140);
			const sent =
				detail === null
					? ["Sent: still loading"]
					: detail.payload === null
						? ["Sent: not kept after delivery cleanup"]
						: ["Sent:", ...JSON.stringify(detail.payload, null, 2).split("\n")];
			return [
				`Delivery ${x.id} of ${w.name} (${w.id}) → ${x.statusCode ?? "no response"}`,
				`Response: ${response || "(no body)"}`,
				...sent,
			];
		},
		reads: (_props, d) => [
			`/api/webhooks/${d.webhook.id}/deliveries/${d.delivery.id}`,
		],
	},

	WebhookHeader: {
		render({ id, props, ctx, scope }) {
			const { network, webhookId } = props;
			const name = h("span", "wd-name", webhookId);
			const statusDot = dot();
			const p = panel({
				head: h("div", "wd-title", h("h1", null, statusDot, name)),
			});
			live(ctx, scope, { id, type: "WebhookHeader", p }, async () => {
				let w;
				try {
					w = await readWebhook(ctx, network, webhookId);
				} catch (err) {
					if (!notFound(err)) throw err;
					return missing(
						p,
						`No webhook ${webhookId} on ${networkName(network)}`,
						PROBE_HINT,
					);
				}
				const s = displayStatus(w);
				statusDot.className = `dot ${STATUS[s].dot}`;
				name.textContent = w.name;
				const now = ctx.now();
				const state =
					s === "error"
						? h(
								"span",
								"alarmtxt",
								`Failing${w.circuitOpenedAt ? ` since ${clock(w.circuitOpenedAt, now)}` : ""}${w.lastError ? ` · ${w.lastError}` : ""}`,
							)
						: s === "paused"
							? h("span", "sub", "Paused")
							: h(
									"span",
									null,
									`Delivering · last success ${ago(w.lastSuccessAt, now)}`,
								);
				p.set(
					h(
						"div",
						"summary small",
						h("span", "chip", networkName(network)),
						state,
						h("span", "sub mono", w.url),
					),
				);
				return { webhook: w };
			});
			return p.wrap;
		},
		prompt(_props, d) {
			const w = d.webhook;
			return [
				`Webhook ${webhookLine(w)}`,
				`Endpoint: ${w.url}${w.lastError ? `, last error: ${w.lastError}` : ""}`,
			];
		},
		reads: (props) => [`/api/webhooks/${props.webhookId}`],
	},

	ListensFor: {
		render({ id, props, ctx, scope }) {
			const { network, webhookId } = props;
			const p = panel({ head: eyebrow("Listens for") });
			live(ctx, scope, { id, type: "ListensFor", p }, async () => {
				let w;
				try {
					w = await readWebhook(ctx, network, webhookId);
				} catch (err) {
					if (!notFound(err)) throw err;
					return missing(
						p,
						`No webhook ${webhookId} on ${networkName(network)}`,
						PROBE_HINT,
					);
				}
				const n = w.triggers.length;
				p.setCaption(
					`${plural(n, "trigger")}${n > 1 ? ", either one fires" : ""}`,
				);
				p.set(
					h(
						"div",
						"lf-rows",
						w.triggers.map((tr) =>
							h(
								"div",
								"lf-row",
								h("span", "lf-type", tr.type),
								h("span", "lf-line", pieces(describeTrigger(tr))),
							),
						),
					),
				);
				return { triggers: w.triggers };
			});
			return p.wrap;
		},
		prompt(_props, d) {
			return [
				`Listens for${d.triggers.length > 1 ? " (either one fires)" : ""}:`,
				...d.triggers.map(
					(tr) =>
						`- ${tr.type}: ${plainText(describeTrigger(tr))} ${JSON.stringify(tr)}`,
				),
			];
		},
		reads: (props) => [`/api/webhooks/${props.webhookId}`],
	},

	ActivityBars: {
		render({ id, props, ctx, scope }) {
			const { network, webhookId } = props;
			const p = panel({ head: eyebrow("Last 30 days") });
			p.meta.prepend(
				h(
					"span",
					"legend",
					h("span", null, h("i", "s0"), "delivered"),
					h("span", null, h("i", "failbar"), "failed"),
				),
			);
			live(ctx, scope, { id, type: "ActivityBars", p }, async () => {
				let act;
				try {
					act = await readWebhook(ctx, network, webhookId, "/activity?days=30");
				} catch (err) {
					if (!notFound(err)) throw err;
					return missing(
						p,
						`No webhook ${webhookId} on ${networkName(network)}`,
						PROBE_HINT,
					);
				}
				const days = act.days ?? [];
				p.set(h("div", "chartbox", stackedDays(days)));
				return { days };
			});
			return p.wrap;
		},
		prompt(_props, d) {
			const sum = (k) => d.days.reduce((n, x) => n + x[k], 0);
			return [
				`Last 30 days: ${sum("delivered")} delivered, ${sum("failed")} failed. Per day (delivered/failed), oldest first:`,
				`  ${d.days.map((x) => `${x.day.slice(5)} ${x.delivered}/${x.failed}`).join(", ")}`,
			];
		},
		reads: (props) => [`/api/webhooks/${props.webhookId}/activity?days=30`],
	},

	RetryState: {
		render({ id, props, ctx, scope }) {
			const { network, webhookId } = props;
			const p = panel({ head: eyebrow("Right now") });
			live(ctx, scope, { id, type: "RetryState", p }, async () => {
				let w;
				let dead;
				let act;
				try {
					[w, dead, act] = await Promise.all([
						readWebhook(ctx, network, webhookId),
						readWebhook(ctx, network, webhookId, "/dead"),
						readWebhook(ctx, network, webhookId, "/activity"),
					]);
				} catch (err) {
					if (!notFound(err)) throw err;
					return missing(
						p,
						`No webhook ${webhookId} on ${networkName(network)}`,
						PROBE_HINT,
					);
				}
				const now = ctx.now();
				const pairs = [
					[
						"First failure",
						w.circuitOpenedAt ? clock(w.circuitOpenedAt, now) : "none",
					],
					["Last response", w.lastError ?? "ok", w.lastError ? "alarmtxt" : ""],
					["Waiting to retry", plural(act.waiting, "event")],
					["Next retry", until(act.nextAttemptAt, now)],
					[
						"Gave up",
						fmt(dead.data.length),
						dead.data.length ? "alarmtxt" : "",
					],
				];
				p.set(
					h(
						"div",
						"kv",
						pairs.flatMap(([k, v, cls]) => [
							h("div", null, k),
							h("div", `v ${cls ?? ""}`, v),
						]),
					),
					h(
						"p",
						"sub note",
						`Each event is retried up to ${w.maxRetries} times before it counts as given up.`,
					),
				);
				return {
					webhook: w,
					waiting: act.waiting,
					nextAttemptAt: act.nextAttemptAt,
					gaveUp: dead.data.length,
				};
			});
			return p.wrap;
		},
		prompt(_props, d) {
			const w = d.webhook;
			return [
				`Right now: ${STATUS[displayStatus(w)].text}${w.circuitOpenedAt ? ` since ${w.circuitOpenedAt}` : ""}, last response ${w.lastError ?? "ok"}`,
				`Waiting to retry: ${d.waiting} · next retry ${d.nextAttemptAt ?? "none"} · gave up: ${d.gaveUp} · up to ${w.maxRetries} retries per event`,
			];
		},
		reads: (props) => [
			`/api/webhooks/${props.webhookId}`,
			`/api/webhooks/${props.webhookId}/dead`,
			`/api/webhooks/${props.webhookId}/activity`,
		],
	},

	DataGrid: {
		render({ id, props, ctx, scope }) {
			const { network, subgraph, table } = props;
			const limit = props.limit ?? 25;
			const p = panel({
				title: `${subgraph} · ${table}`,
				caption: `newest ${limit}`,
			});
			let openKey = null;
			let seen = null;
			let last = null;
			const fresh = new Map();
			const key = (r, i) => String(r._id ?? i);
			scope.onDispose(() => {
				if (ctx.ui.open?.from === id) ctx.ui.open = null;
			});
			/** Draw from the last read: opening a row never refetches. */
			const draw = () => {
				const { info, rows, cols } = last;
				const columns = info.columns ?? {};
				const numeric = (n) => NUMERIC_TYPES.has(columns[n]?.type ?? "");
				const head = h(
					"tr",
					null,
					cols.map((n, i) =>
						h(
							"th",
							numeric(n) ? "r" : null,
							h(
								"span",
								"sg-sort",
								h("span", null, n),
								h("small", i === 0 ? "sg-first" : null, columns[n]?.type ?? ""),
							),
						),
					),
				);
				const body = [];
				rows.forEach((r, i) => {
					const k = key(r, i);
					const isOpen = openKey === k;
					const tr = h(
						"tr",
						isOpen ? "click sel" : "click",
						cols.map((n, ci) => {
							const cell = formatCell(columns[n]?.type ?? "text", n, r[n]);
							const cls = [
								numeric(n) ? "r" : "",
								cell.tone === "faint"
									? "faint"
									: cell.tone === "sub"
										? "subtle"
										: "",
							]
								.join(" ")
								.trim();
							const td = h(
								"td",
								cls || null,
								ci === 0
									? h("span", fresh.has(k) ? "sg-slot new" : "sg-slot")
									: null,
								cell.text,
							);
							if (cell.title) td.title = cell.title;
							return td;
						}),
					);
					tr.tabIndex = 0;
					tr.setAttribute("aria-expanded", String(isOpen));
					const toggle = () => {
						openKey = isOpen ? null : k;
						if (openKey) {
							ctx.ui.open = {
								type: "RowPanel",
								from: id,
								network,
								data: { subgraph, table, columns, row: r },
							};
						} else if (ctx.ui.open?.from === id) {
							ctx.ui.open = null;
						}
						draw();
					};
					tr.addEventListener("click", toggle);
					tr.addEventListener("keydown", (e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							toggle();
						}
					});
					body.push(tr);
					if (isOpen) {
						const td = h("td", null, rowPanel(ctx, { columns, row: r }));
						td.colSpan = cols.length;
						body.push(h("tr", "rowx", td));
					}
				});
				p.set(
					h("p", "sub note", "Open a row to see everything in it."),
					rows.length
						? h(
								"div",
								"sg-grid-wrap",
								h(
									"table",
									"sg-table",
									h("thead", null, head),
									h("tbody", null, body),
								),
							)
						: emptyCard(`No rows in ${subgraph}.${table} yet`),
					h(
						"div",
						"sg-foot",
						h(
							"span",
							"mono",
							`${groupDigits(String(info.rowCount ?? rows.length))} rows · newest ${rows.length}`,
						),
					),
				);
			};
			live(ctx, scope, { id, type: "DataGrid", p }, async () => {
				const [info, rows] = await Promise.all([
					readTable(ctx, network, subgraph, table),
					readRows(ctx, network, subgraph, table, limit),
				]);
				if (!info || !rows) return noTable(p, subgraph, table, network);
				// Rows that weren't in the last read get the yellow dot for 9s.
				const nowMs = ctx.now().getTime();
				if (seen) {
					for (const [i, r] of rows.entries()) {
						if (!seen.has(key(r, i))) fresh.set(key(r, i), nowMs);
					}
				}
				seen = new Set(rows.map(key));
				for (const [k, at] of fresh) if (nowMs - at > 9000) fresh.delete(k);
				const cols = props.columns?.length
					? props.columns
					: gridColumns(info.columns ?? {});
				last = { info, rows, cols };
				draw();
				return { rowCount: info.rowCount ?? null, columns: cols, rows };
			});
			return p.wrap;
		},
		prompt(props, d) {
			return [
				`Table ${props.subgraph}.${props.table}: ${d.rowCount === null ? "?" : fmt(d.rowCount)} rows, showing newest ${d.rows.length}`,
				d.columns.join(","),
				...d.rows.map((r) => d.columns.map((n) => csvCell(r[n])).join(",")),
			];
		},
		reads: (props) => [
			`/api/subgraphs/${props.subgraph}`,
			rowsPath(props.subgraph, props.table, props.limit ?? 25),
		],
	},

	RowPanel: {
		prompt(_props, d) {
			const { subgraph, table, columns, row } = d;
			const names = Object.keys(columns).length
				? Object.keys(columns)
				: Object.keys(row);
			return [
				`Row ${row._id ?? "?"} of ${subgraph}.${table} (every column)`,
				...names.map((n) => `${n}: ${csvCell(row[n])}`),
				`Came from block #${row._block_height ?? "?"}, tx ${row._tx_id ?? "?"}`,
			];
		},
		reads: () => [],
	},

	Schema: {
		render({ id, props, ctx, scope }) {
			const { network, subgraph, table } = props;
			const p = panel({ head: eyebrow(table) });
			live(ctx, scope, { id, type: "Schema", p }, async () => {
				const info = await readTable(ctx, network, subgraph, table);
				if (!info) return noTable(p, subgraph, table, network);
				const columns = schemaOf(info);
				const head = h(
					"tr",
					null,
					["column", "type", "indexed", "notes"].map((x) =>
						h("th", null, h("span", "sg-sort", x)),
					),
				);
				const body = columns.map((c) =>
					h(
						"tr",
						null,
						h("td", null, c.name),
						h("td", "subtle", c.type),
						h("td", c.indexed ? null : "faint", c.indexed ? "yes" : "no"),
						h("td", "sg-notes", c.notes),
					),
				);
				p.set(
					h(
						"div",
						"sg-grid-wrap",
						h(
							"table",
							"sg-table",
							h("thead", null, head),
							h("tbody", null, body),
						),
					),
				);
				return { columns };
			});
			return p.wrap;
		},
		prompt(props, d) {
			return [
				`Schema of ${props.subgraph}.${props.table}:`,
				...d.columns.map(
					(c) =>
						`- ${c.name} ${c.type}${c.indexed ? ", indexed" : ""}${c.notes ? `, ${c.notes}` : ""}`,
				),
			];
		},
		reads: (props) => [`/api/subgraphs/${props.subgraph}`],
	},

	Bars: {
		render({ id, props, ctx, scope }) {
			const { network, subgraph, table, value } = props;
			const bucket = props.bucket ?? 144;
			const tables = [table, ...(props.series ?? [])];
			const p = panel({
				title: `${tables.join(" vs ")} · ${value}`,
				caption: `per ${fmt(bucket)} blocks`,
			});
			live(ctx, scope, { id, type: "Bars", p }, async () => {
				const sets = await Promise.all(
					tables.map((tb) => readRows(ctx, network, subgraph, tb, 1000)),
				);
				const gone = tables.find((_, i) => !sets[i]);
				if (gone) return noTable(p, subgraph, gone, network);
				const total = sets.reduce((n, rows) => n + rows.length, 0);
				p.setCaption(`last ${fmt(total)} rows · per ${fmt(bucket)} blocks`);
				const buckets = new Map();
				sets.forEach((rows, k) => {
					for (const r of rows) {
						const start = Math.floor(Number(r._block_height) / bucket) * bucket;
						const v = Number(r[value]);
						if (!Number.isFinite(start) || !Number.isFinite(v)) continue;
						const entry = buckets.get(start) ?? tables.map(() => 0);
						entry[k] += v;
						buckets.set(start, entry);
					}
				});
				const rows = [...buckets.entries()]
					.sort((a, b) => a[0] - b[0])
					.slice(-30)
					.map(([start, values]) => ({ label: fmt(start), start, values }));
				if (rows.length === 0) {
					p.set(emptyCard(`No ${value} values in the last ${fmt(total)} rows`));
				} else {
					p.set(
						tables.length > 1
							? h(
									"div",
									"legend",
									tables.map((tb, k) => h("span", null, h("i", `s${k}`), tb)),
								)
							: null,
						h("div", "chartbox", bars(rows, tables.length)),
					);
				}
				return { tables, total, rows };
			});
			return p.wrap;
		},
		prompt(props, d) {
			return [
				`${d.tables.join(" vs ")}: ${props.value} per ${props.bucket ?? 144} blocks, summed in the browser from the last ${d.total} rows, oldest first:`,
				`  bucket_start,${d.tables.join(",")}`,
				...d.rows.map((r) => `  ${r.start},${r.values.join(",")}`),
			];
		},
		reads: (props) =>
			[props.table, ...(props.series ?? [])].map((tb) =>
				rowsPath(props.subgraph, tb, 1000),
			),
	},

	Leaderboard: {
		render({ id, props, ctx, scope }) {
			const { network, subgraph, table, key, sum } = props;
			const limit = props.limit ?? 5;
			const p = panel({ title: `Top ${key} by ${sum}`, caption: table });
			live(ctx, scope, { id, type: "Leaderboard", p }, async () => {
				const rows = await readRows(ctx, network, subgraph, table, 1000);
				if (!rows) return noTable(p, subgraph, table, network);
				p.setCaption(`last ${fmt(rows.length)} rows`);
				const totals = new Map();
				for (const r of rows) {
					const v = Number(r[sum]);
					if (!Number.isFinite(v)) continue;
					const k = String(r[key]);
					totals.set(k, (totals.get(k) ?? 0) + v);
				}
				const top = [...totals.entries()]
					.sort((a, b) => b[1] - a[1])
					.slice(0, limit);
				if (top.length === 0) {
					p.set(
						emptyCard(`No ${sum} values in the last ${fmt(rows.length)} rows`),
					);
				} else {
					p.set(
						h(
							"div",
							"kv",
							top.flatMap(([k, v]) => {
								const name = h("div", "mono", shortenPrincipal(k));
								name.title = k;
								return [name, h("div", "v", fmt(v))];
							}),
						),
					);
				}
				return { total: rows.length, top };
			});
			return p.wrap;
		},
		prompt(props, d) {
			return [
				`Top ${props.key} by ${props.sum}, summed in the browser from the last ${d.total} rows of ${props.table}:`,
				...d.top.map(([k, v]) => `  ${k} ${v}`),
			];
		},
		reads: (props) => [rowsPath(props.subgraph, props.table, 1000)],
	},

	UsageMeter: {
		render({ id, props, ctx, scope }) {
			const network = "mainnet";
			const path = `/api/billing/usage${props.month ? `?month=${props.month}` : ""}`;
			const p = panel({ title: "Usage", caption: props.month ?? "this month" });
			live(ctx, scope, { id, type: "UsageMeter", p }, async () => {
				const data = await ctx.get(network, path);
				p.setCaption(data.month);
				const u = usageFacts(data);
				const fill = h("div", "fill");
				fill.style.width = `${(u.share * 100).toFixed(1)}%`;
				const meter = h(
					"div",
					"meter",
					h(
						"div",
						"row",
						h("span", null, `Rows delivered in ${data.month}`),
						h("span", null, "1M free"),
					),
					h("div", "big", fmt(u.rows)),
					h("div", "track", fill),
					h(
						"div",
						"row",
						h("span", null, `${pct(u.share)} of the free rows`),
						h("span", null, "Index and Streams reads only"),
					),
				);
				const kv = h(
					"div",
					"kv",
					data.usage.flatMap((x) => [
						h("div", null, USAGE_LABEL[x.unit] ?? x.unit),
						h(
							"div",
							"v",
							`${fmt(+Number(x.quantity).toFixed(2))} · ${usd(x.usdMicros)}`,
						),
					]),
					h("div", "sub", "Spent this month"),
					h("div", "v", usd(u.spend)),
				);
				p.set(
					h("div", "grid2", meter, kv),
					h(
						"div",
						"chartbox",
						cumulative(u.points, {
							days: u.days,
							projected: u.projected,
							label: (v) => usd(v),
						}),
					),
				);
				return { month: data.month, usage: data.usage, ...u };
			});
			return p.wrap;
		},
		prompt(_props, d) {
			return [
				`Rows delivered in ${d.month}: ${fmt(d.rows)} of ${fmt(FREE_ROWS)} free (${pct(d.share)})`,
				`Spent: ${usd(d.spend)} · burn ${usd(d.burn)}/day · projected month end ${usd(d.projected)}`,
				`By unit: ${d.usage.map((x) => `${USAGE_LABEL[x.unit] ?? x.unit} ${x.quantity} (${usd(x.usdMicros)})`).join(" · ")}`,
			];
		},
		reads: (props) => [
			`/api/billing/usage${props.month ? `?month=${props.month}` : ""}`,
		],
	},

	Empty: {
		render({ props }) {
			return emptyCard(props.reason, props.next);
		},
		prompt: (props) => [
			`Note: ${props.reason}${props.next ? ` ${props.next}` : ""}`,
		],
		reads: () => [],
	},
};

export { CATALOG };

const USAGE_LABEL = {
	"rows.delivered": "Rows delivered",
	"webhook.event": "Webhook events",
	"memory.gb_hour": "Stack memory, GB-hours",
	"storage.gb_day": "Storage, GB-days",
};

/** Free-row share, spend, and the month's cumulative spend with a projection. */
function usageFacts(data) {
	const rows = Number(
		data.usage.find((u) => u.unit === "rows.delivered")?.quantity ?? 0,
	);
	const spend = data.usage.reduce((n, u) => n + Number(u.usdMicros), 0);
	const [year, month] = data.month.split("-").map(Number);
	const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
	const byDay = new Map();
	for (const d of data.daily) {
		const day = Number(d.date.slice(8, 10));
		byDay.set(day, (byDay.get(day) ?? 0) + Number(d.usdMicros));
	}
	let running = 0;
	const points = [...byDay.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([day, v]) => {
			running += v;
			return { d: day, v: running };
		});
	const lastDay = points.at(-1)?.d ?? 0;
	const burn = Number(data.burn?.rateDayUsdMicros ?? 0);
	return {
		rows,
		share: Math.min(1, rows / FREE_ROWS),
		spend,
		burn,
		days,
		points,
		projected: running + burn * Math.max(0, days - lastDay),
	};
}

/** The network the page's tabs (or its state) point at, if any. */
const bindingsNetwork = (spec, state) =>
	state.network ?? (isObject(spec.state) ? spec.state.network : undefined);

// ── buildPrompt ─────────────────────────────────────────────────────────

const INTRO =
	"Here's my Secondlayer dashboard. Use it as context for what I ask next.";

/** "2026-11-03 14:02:31 UTC" */
const utcStamp = (at) =>
	`${new Date(at).toISOString().slice(0, 19).replace("T", " ")} UTC`;

/** The components on screen in order, with their props resolved. */
function visibleElements(spec, state) {
	const out = [];
	const bindings = { ...(spec.state ?? {}) };
	if (state.network) bindings.network = state.network;
	const walk = (id) => {
		const el = spec.elements[id];
		if (!isObject(el)) return;
		out.push({ id, type: el.type, props: resolveProps(el.props, bindings) });
		const children = Array.isArray(el.children) ? el.children : [];
		if (el.type === "Tabs") {
			const index = state.tabs?.[id] ?? 0;
			if (children[index]) walk(children[index]);
			return;
		}
		for (const child of children) walk(child);
	};
	walk(spec.root);
	return out;
}

/**
 * The one prompt "Copy for agent" copies, from the page's state right now.
 * `state`: { network, networks (live NetworkTabs list), tabs ({ id: index }),
 * open ({ type: "Payload" | "RowPanel", network, data } or null), bases, at }.
 * `data`: each element's last read, by element id ({ error } when it failed).
 * Never holds keys, tokens or env values: only what the page shows.
 */
export function buildPrompt(spec, state, data) {
	const shown = visibleElements(spec, state);
	const root = spec.elements[spec.root];
	const title = root?.props?.title ?? "Secondlayer dashboard";
	const tabParts = [];
	const networks = state.networks ?? [];
	if (networks.length > 1 && networks.includes(state.network)) {
		const others = networks.filter((n) => n !== state.network).map(networkName);
		tabParts.push(
			`${networkName(state.network)} tab (also ${others.join(", ")})`,
		);
	}
	for (const el of shown) {
		if (el.type !== "Tabs") continue;
		const labels = el.props.labels ?? [];
		const index = state.tabs?.[el.id] ?? 0;
		const others = labels.filter((_, i) => i !== index);
		tabParts.push(
			`${labels[index]} tab${others.length ? ` (also ${others.join(", ")})` : ""}`,
		);
	}
	const network =
		bindingsNetwork(spec, state) ??
		shown.find((el) => typeof el.props.network === "string")?.props.network ??
		"mainnet";
	const screen = [];
	const reads = [];
	for (const el of shown) {
		const entry = CATALOG[el.type];
		const d = data[el.id];
		if (!entry || d === undefined) continue;
		if (d?.error) {
			screen.push(`${el.type}: ${d.error}`);
			continue;
		}
		screen.push(...entry.prompt(el.props, d));
		reads.push(...entry.reads(el.props, d));
	}
	// An open delivery or row counts only while the view it opened from is shown.
	const opened =
		state.open &&
		(!state.open.from || shown.some((el) => el.id === state.open.from))
			? state.open
			: null;
	const open = opened ? CATALOG[opened.type].prompt({}, opened.data) : [];
	if (opened) reads.push(...CATALOG[opened.type].reads({}, opened.data));
	const lines = [
		INTRO,
		"",
		`Page      ${[title, ...tabParts].join(" · ")}`,
		`Network   ${networkName(network)} · ${state.bases?.[network] ?? "unknown base"}`,
		"Spec      .secondlayer/dash/spec.json",
		`As of     ${utcStamp(state.at)}`,
		"",
		"## On screen",
		...(screen.length ? screen : ["Nothing loaded yet."]),
	];
	if (open.length) lines.push("", "## Open", ...open);
	lines.push(
		"",
		"## Reads behind this page (read-only, through the dashboard proxy)",
		...[...new Set(reads)].map((path) => `GET ${path}`),
	);
	return lines.join("\n");
}

// ── render ──────────────────────────────────────────────────────────────

function makeScope() {
	const timers = new Set();
	const disposers = [];
	const children = [];
	let dead = false;
	return {
		/** Run `load` now and every `ms` (0 = once); skip while the tab is hidden. */
		every(ms, load, onError) {
			const tick = async () => {
				if (dead) return;
				if (!doc.hidden) {
					try {
						await load();
					} catch (err) {
						if (!dead) onError?.(err);
					}
				}
				if (dead || !ms) return;
				const timer = setTimeout(() => {
					timers.delete(timer);
					tick();
				}, ms);
				timers.add(timer);
			};
			tick();
		},
		onDispose(fn) {
			disposers.push(fn);
		},
		child() {
			const next = makeScope();
			children.push(next);
			return next;
		},
		dispose() {
			dead = true;
			for (const timer of timers) clearTimeout(timer);
			for (const next of children) next.dispose();
			for (const fn of disposers) fn();
		},
	};
}

function resolveProps(props, state) {
	const out = {};
	for (const [k, v] of Object.entries(props ?? {})) {
		out[k] = isBinding(v) ? readPointer(state, v.$state) : v;
	}
	return out;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", ""]);
/** Identical reads within this window share one request (panels on one webhook). */
const SHARE_MS = 1000;

/**
 * Draw `spec` into `root`. Options: `catalog` (catalog.json, required),
 * `fetch` and `now` (injectable for tests), `api` (proxy prefix).
 * Returns `stop()`, which ends every poll.
 */
export function render(spec, root, options) {
	doc = root.ownerDocument;
	const {
		catalog,
		fetch: doFetch = (...args) => globalThis.fetch(...args),
		now = () => new Date(),
		api = "/api/sl",
	} = options;
	root.replaceChildren();
	const errors = validateSpec(spec, catalog);
	const fatal = errors.find(
		(e) => e.prop === "root" || (e.id === null && e.prop !== "version"),
	);
	if (fatal) {
		root.append(
			h(
				"div",
				"dash",
				h(
					"div",
					"dbody",
					emptyCard(
						`Spec error: ${fatal.message}`,
						"Fix spec.json and run check.ts.",
					),
				),
			),
		);
		return () => {};
	}

	let health = null;
	const bases = {};
	const recent = new Map();
	const ctx = {
		state: structuredClone(isObject(spec.state) ? spec.state : {}),
		ui: { networks: [], tabs: {}, open: null },
		data: new Map(),
		now,
		poll: (type) => catalog.components[type]?.poll ?? 0,
		health() {
			health ??= (async () => {
				const res = await doFetch(`${api}/health`).catch(() => null);
				if (!res?.ok) {
					throw new ReadError(
						0,
						"The dash server is not answering",
						"Start it with bun dev.ts.",
					);
				}
				const body = await res.json();
				for (const [n, v] of Object.entries(body)) bases[n] = v.base;
				return body;
			})();
			return health;
		},
		get(network, path) {
			const key = `${network}${path}`;
			const hit = recent.get(key);
			if (hit && now().getTime() - hit.at < SHARE_MS) return hit.read;
			const read = (async () => {
				let res;
				try {
					res = await doFetch(`${api}/${network}${path}`, {
						headers: { accept: "application/json" },
					});
				} catch {
					throw new ReadError(
						0,
						"The dash server is not answering",
						"Start it with bun dev.ts.",
					);
				}
				let body = null;
				try {
					body = await res.json();
				} catch {}
				if (!res.ok) throw readError(res.status, body, network, path);
				return body;
			})();
			recent.set(key, { at: now().getTime(), read });
			read.catch(() => recent.delete(key));
			return read;
		},
	};
	ctx.health().catch(() => {});

	const bad = new Map();
	for (const e of errors) {
		if (
			e.id !== null &&
			e.prop !== null &&
			e.prop !== "children" &&
			!bad.has(e.id)
		) {
			bad.set(e.id, e);
		}
	}

	const mount = (id, scope, trail) => {
		const el = spec.elements[id];
		if (!isObject(el)) {
			return emptyCard(
				`No element "${id}" in spec`,
				"Add it to elements or drop it from children.",
			);
		}
		if (trail.includes(id)) return emptyCard(`Spec error: cycle at "${id}"`);
		const err = bad.get(id);
		if (err) {
			return emptyCard(
				`Spec error in ${id}${err.prop ? `.${err.prop}` : ""}`,
				err.message,
			);
		}
		const def = catalog.components[el.type];
		const props = resolveProps(el.props, ctx.state);
		scope.onDispose(() => ctx.data.delete(id));
		if (
			def.networks &&
			"network" in def.props &&
			!def.networks.includes(props.network)
		) {
			const message = `${el.type} has no data on ${networkName(props.network)}`;
			ctx.data.set(id, { error: message });
			return emptyCard(
				message,
				`It reads ${def.networks.map(networkName).join(" and ")} only.`,
			);
		}
		const kids = (s = scope) =>
			(Array.isArray(el.children) ? el.children : []).map((child) =>
				mount(child, s, [...trail, id]),
			);
		return CATALOG[el.type].render({ id, props, ctx, scope, kids });
	};

	// Frame: location and title, the one Copy for agent button, the body,
	// the hosted warning, and the fallback <pre> when the clipboard refuses.
	const title = spec.elements[spec.root].props?.title ?? "Secondlayer dash";
	const copy = button("cp", icon("copy"), h("span", null, "Copy for agent"));
	const bar = h(
		"div",
		"dbar",
		h(
			"div",
			"l",
			h("span", "logo", h("i"), h("i")),
			h("span", null, location.host),
			h("span", null, title),
		),
		h("div", "r", h("span", "chip", dot("ok"), "live"), copy),
	);
	const body = h("div", "dbody");
	const clipPre = h("pre");
	const clip = h(
		"section",
		"clip",
		h(
			"div",
			"ptitle",
			h("h2", null, "Copied for your agent"),
			h("span", "mono", "paste it into your next message"),
		),
		clipPre,
	);
	clip.hidden = true;
	const frame = h("div", "dash", bar);
	if (!LOOPBACK.has(location.hostname)) {
		const link = h("a", null, "Turn on Vercel password protection");
		link.href =
			"https://vercel.com/docs/security/deployment-protection/methods-to-protect-deployments/password-protection";
		frame.append(
			h(
				"div",
				"notice",
				dot("alarm"),
				h(
					"span",
					null,
					"Anyone with this URL can read this account's webhooks, subgraphs and usage. ",
					link,
					" or keep it local.",
				),
			),
		);
	}
	frame.append(body);
	root.append(frame, clip);

	const scope = makeScope();
	for (const e of errors.filter((x) => x.prop === "version")) {
		body.append(emptyCard(`Spec error: ${e.message}`));
	}
	body.append(mount(spec.root, scope, []));

	copy.addEventListener("click", () => {
		const text = buildPrompt(
			spec,
			{
				network: ctx.state.network,
				networks: ctx.ui.networks,
				tabs: ctx.ui.tabs,
				open: ctx.ui.open,
				bases,
				at: now().toISOString(),
			},
			Object.fromEntries(ctx.data),
		);
		clipPre.textContent = text;
		const done = () => {
			copy.classList.add("done");
			copy.firstChild.replaceWith(icon("done"));
			setTimeout(() => {
				copy.classList.remove("done");
				copy.firstChild.replaceWith(icon("copy"));
			}, COPIED_MS);
		};
		// Only when the clipboard refuses: show the prompt, selected, to copy by hand.
		const selectFallback = () => {
			clip.hidden = false;
			const range = doc.createRange();
			range.selectNodeContents(clipPre);
			const sel = doc.getSelection();
			sel.removeAllRanges();
			sel.addRange(range);
			done();
		};
		try {
			navigator.clipboard.writeText(text).then(done, selectFallback);
		} catch {
			selectFallback();
		}
	});

	return () => scope.dispose();
}
