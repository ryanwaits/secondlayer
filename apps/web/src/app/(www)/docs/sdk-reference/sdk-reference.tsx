import { Code } from "@/components/code/code";
import { CodeScope } from "@/components/code/code-scope";
import { CodeTabs } from "@/components/code/code-tabs";
import { GITHUB_URL } from "@/lib/site";
import Link from "next/link";
import type { ReactNode } from "react";
import { apiPageHref, pageForTag } from "../api-reference/pages";
import { allEndpoints, curlFor } from "../api-reference/spec";
import { GlanceFilter, SdkHashRedirect } from "./client";
import {
	disclosuresHtml,
	glanceHtml,
	paramGroupsHtml,
	typeListHtml,
} from "./html";
import { Paragraphs, Text, plain } from "./markdown-text";
import { SDK_BASE, SDK_SURFACES, findSurface } from "./pages";
import {
	type Method,
	type TypeDoc,
	callbackArgs,
	errorAnchor,
	errorTree,
	exampleWithRefs,
	groupParams,
	helperAnchor,
	legacyOwners,
	manifest,
	methodAnchor,
	paramRows,
	refKey,
	restTarget,
	returnFields,
	shortHelpers,
	signatureOf,
	surface,
	typeMap,
} from "./reference";

const sourceHref = (file: string, line: number) =>
	`${GITHUB_URL}/blob/main/${file}#L${line}`;

/** Markup built by `html.ts`, which escapes every dynamic value. */
function Html({ html, className }: { html: string; className?: string }) {
	return (
		<div
			className={className}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: built by html.ts, which escapes every dynamic value
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}

/** "SDK reference · Streams", above the page title. */
export function SdkEyebrow({ title }: { title: string }) {
	return (
		<p className="sdkr-eyebrow">
			SDK reference <span>· {title}</span>
		</p>
	);
}

let endpointIndex: Map<string, string> | undefined;

/** `GET /v1/streams/events` → the API page anchor that documents it. */
function endpointHref(rest: string): string | null {
	endpointIndex ??= new Map(
		allEndpoints().flatMap((e) => {
			const page = pageForTag(e.tag);
			return page
				? [[`${e.method} ${e.path}`, `${apiPageHref(page.slug)}#${e.anchor}`]]
				: [];
		}),
	);
	const { method, path } = restTarget(rest);
	return endpointIndex.get(`${method} ${path}`) ?? null;
}

function tabLabels(method: Method): string[] {
	const labels = method.overloads.map((o, i) => o.label || `Overload ${i + 1}`);
	const seen = new Map<string, number>();
	return labels.map((label) => {
		const n = (seen.get(label) ?? 0) + 1;
		seen.set(label, n);
		return labels.filter((l) => l === label).length > 1
			? `${label} ${n}`
			: label;
	});
}

async function MethodEntry({
	method,
	types,
}: { method: Method; types: ReadonlyMap<string, TypeDoc> }) {
	const rows = paramRows(method, types);
	const names = new Set(rows.map((r) => refKey(r.name)));
	const labels = tabLabels(method);
	const first = method.overloads[0];
	const args = (first?.params ?? []).map((p) => p.name).join(", ");
	const anchor = methodAnchor(method.id);
	const rest = method.rest ? restTarget(method.rest) : null;
	const restHref = method.rest ? endpointHref(method.rest) : null;
	const endpoint = rest
		? allEndpoints().find(
				(e) => e.method === rest.method && e.path === rest.path,
			)
		: undefined;
	const prefix = method.path.slice(0, method.path.length - method.id.length);
	const signatures = method.overloads.map((o, i) => (
		<Code
			key={labels[i]}
			lang="ts"
			title={method.overloads.length > 1 ? labels[i] : undefined}
			code={signatureOf(method, o, names)}
		/>
	));
	// A method with a REST twin pairs its example with the cURL call.
	const examples = method.examples.map((ex) => {
		const ts = (
			<Code
				key={ex.file}
				lang="ts"
				title={ex.file.split("/").pop()}
				code={exampleWithRefs(ex.code, names, ex.file)}
			/>
		);
		return endpoint ? (
			<CodeTabs key={ex.file} sync="lang">
				{ts}
				<Code
					lang="bash"
					title="cURL"
					code={curlFor(endpoint, "hosted")}
					links={false}
				/>
			</CodeTabs>
		) : (
			ts
		);
	});
	const description =
		method.description ||
		method.overloads.find((o) => o.description)?.description;
	const groups = groupParams(rows);
	const returned = first ? returnFields(first, types) : [];

	return (
		<section className="sdkr-m" data-scope>
			<div className="sdkr-mh">
				<h2 id={anchor} data-outline={method.id}>
					<a
						href={`#${anchor}`}
						className="heading-anchor"
						aria-label={`Link to ${method.path}`}
					>
						<span className="obj">{prefix}</span>
						{method.id}({args})
					</a>
				</h2>
				<div className="sdkr-chips">
					{method.deprecated ? (
						<span className="sdkr-chip">deprecated</span>
					) : null}
					{method.overloads.length > 1 ? (
						<span className="sdkr-chip">
							{method.overloads.length} overloads
						</span>
					) : null}
					{rest ? (
						restHref ? (
							<a className="sdkr-chip" href={restHref}>
								REST{" "}
								<span className="mono">
									{rest.method} {rest.path}
								</span>
							</a>
						) : (
							<span className="sdkr-chip">
								REST{" "}
								<span className="mono">
									{rest.method} {rest.path}
								</span>
							</span>
						)
					) : null}
					{method.source ? (
						<a
							className="sdkr-chip"
							href={sourceHref(method.source.file, method.source.line)}
						>
							source
						</a>
					) : null}
				</div>
			</div>
			{description ? (
				<Paragraphs text={description} className="sdkr-sum" />
			) : null}
			{method.deprecated ? (
				<p className="sdkr-sum">
					Deprecated.
					{method.deprecated.use ? (
						<>
							{" "}
							Use <code>{method.deprecated.use}</code>.
						</>
					) : null}
				</p>
			) : null}
			{method.overloads.length > 1 ? (
				<CodeTabs>{signatures}</CodeTabs>
			) : (
				signatures
			)}
			{examples}
			{groups.length ? (
				<>
					<div className="sdkr-sub">
						<h3>Parameters</h3>
						<span>hover a row to find it in the code</span>
					</div>
					<Html html={paramGroupsHtml(groups)} />
				</>
			) : null}
			<Html
				html={disclosuresHtml(
					callbackArgs(rows, types),
					first ? { type: first.returns.type, fields: returned } : null,
				)}
			/>
		</section>
	);
}

/** One surface: every method at a glance, then each in full, then the types they use. */
export async function SdkSurfacePage({ slug }: { slug: string }) {
	const info = findSurface(slug);
	if (!info) throw new Error(`No SDK reference page "${slug}"`);
	const data = surface(slug);
	const m = manifest();
	const types = typeMap(data);
	return (
		<div className="sdkr">
			<CodeScope />
			<div className="sdkr-meta">
				<span className="v">
					{m.package}@{m.version}
				</span>
				<span>
					{data.methods.length}{" "}
					{data.methods.length === 1 ? "method" : "methods"}
				</span>
				<span>from source with openpkg</span>
				{info.guide ? (
					<Link href={info.guide.href}>{info.guide.title}</Link>
				) : null}
				{info.api ? <Link href={info.api.href}>{info.api.title}</Link> : null}
			</div>

			<GlanceFilter count={data.methods.length}>
				<Html html={glanceHtml(data.methods)} />
			</GlanceFilter>

			{data.methods.map((method) => (
				<MethodEntry key={method.id} method={method} types={types} />
			))}

			{data.types.length ? (
				<section className="sdkr-m">
					<div className="sdkr-mh">
						<h2 id="types" data-outline="Types">
							<a href="#types" className="heading-anchor">
								Types on this page
							</a>
						</h2>
					</div>
					<Html className="sdkr-typelist" html={typeListHtml(data.types)} />
				</section>
			) : null}
		</div>
	);
}

/** The helpers you import directly, each with its signature. */
export async function SdkHelpersPage() {
	const m = manifest();
	return (
		<div className="sdkr">
			<div className="sdkr-meta">
				<span className="v">
					{m.package}@{m.version}
				</span>
				<span>{m.helpers.length} helpers</span>
				<span>from source with openpkg</span>
			</div>
			{m.helpers.map((h) => (
				<section key={h.name} className="sdkr-m">
					<div className="sdkr-mh">
						<h2 id={helperAnchor(h.name)} data-outline={h.name}>
							<a href={`#${helperAnchor(h.name)}`} className="heading-anchor">
								{h.name}
							</a>
						</h2>
						<div className="sdkr-chips">
							{h.source ? (
								<a
									className="sdkr-chip"
									href={sourceHref(h.source.file, h.source.line)}
								>
									source
								</a>
							) : null}
						</div>
					</div>
					{h.summary ? (
						<p className="sdkr-sum">
							<Text text={h.summary} />
						</p>
					) : null}
					<Code lang="ts" meta="wrap" code={h.signature} />
				</section>
			))}
		</div>
	);
}

/** The error classes: the family tree, then each one's status and meaning. */
export function SdkErrorsPage() {
	const m = manifest();
	const tree = errorTree(m.errors);
	return (
		<div className="sdkr">
			<pre className="sdkr-tree">
				{tree.map((line) => (
					<span key={line.name} className="sdkr-tree-row">
						{line.prefix}
						<b>{line.name}</b>
						{line.note ? ` ${line.note}` : ""}
						{"\n"}
					</span>
				))}
			</pre>
			<div className="sdkr-params-wrap">
				<table className="sdkr-t sdkr-errors">
					<tbody>
						{m.errors.map((e) => (
							<tr key={e.name} id={errorAnchor(e.name)}>
								<td className="pn">
									<code>{e.name}</code>
									<span className="t">
										extends {e.parent}
										{e.status ? ` · ${e.status}` : ""}
									</span>
								</td>
								<td className="pd">
									<Text text={e.summary} />
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function MapBox({
	href,
	name,
	blurb,
	meta,
}: { href: string; name: string; blurb: string; meta?: string }): ReactNode {
	return (
		<Link className="sdkr-box" href={href}>
			<b>{name}</b>
			<span>{blurb}</span>
			{meta ? <em>{meta}</em> : null}
		</Link>
	);
}

/** The client drawn as a map: the root, its surfaces with counts, the helpers, the errors. */
export function SdkOverview() {
	const m = manifest();
	const counts = new Map(m.surfaces.map((s) => [s.slug, s.methodCount]));
	const total = m.surfaces.reduce((n, s) => n + s.methodCount, 0);
	const featured = shortHelpers(m.helpers);
	return (
		<div className="sdkr">
			<SdkHashRedirect owners={legacyOwners()} />
			<div className="sdkr-meta">
				<span className="v">
					{m.package}@{m.version}
				</span>
				<span>{total} methods</span>
				<span>from source with openpkg</span>
			</div>
			<div className="sdkr-map">
				<div className="sdkr-root">
					const sl = new SecondLayer() <span>· {m.package}</span>
				</div>
				<div className="sdkr-kids">
					{SDK_SURFACES.map((s) => {
						const count = counts.get(s.slug) ?? 0;
						const name =
							s.slug === "client"
								? surface("client")
										.methods.map((x) => x.path)
										.join(" · ")
								: (m.surfaces.find((x) => x.slug === s.slug)?.root ?? s.title);
						return (
							<MapBox
								key={s.slug}
								href={`${SDK_BASE}/${s.slug}`}
								name={name}
								blurb={s.blurb}
								meta={`${count} ${count === 1 ? "method" : "methods"}`}
							/>
						);
					})}
				</div>
				<div className="sdkr-maprow">
					<p className="sdkr-lbl">Helpers you import directly</p>
					<div className="sdkr-kids">
						{featured.map((h) => (
							<MapBox
								key={h.name}
								href={`${SDK_BASE}/helpers#${helperAnchor(h.name)}`}
								name={h.name}
								blurb={plain(h.summary)}
							/>
						))}
						<MapBox
							href={`${SDK_BASE}/helpers`}
							name={`All ${m.helpers.length} helpers`}
							blurb="Decoders, type guards, signature and proof checks"
						/>
					</div>
				</div>
				<div className="sdkr-maprow">
					<p className="sdkr-lbl">Errors</p>
					<pre className="sdkr-tree">
						{errorTree(m.errors).map((line) => (
							<span key={line.name} className="sdkr-tree-row">
								{line.prefix}
								<Link href={`${SDK_BASE}/errors#${errorAnchor(line.name)}`}>
									<b>{line.name}</b>
								</Link>
								{line.note ? ` ${line.note}` : ""}
								{"\n"}
							</span>
						))}
					</pre>
				</div>
			</div>
		</div>
	);
}
