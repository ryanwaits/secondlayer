import { Code } from "@/components/code/code";
import { CodeScope } from "@/components/code/code-scope";
import { CodeTabs } from "@/components/code/code-tabs";
import { GITHUB_URL } from "@/lib/site";
import Link from "next/link";
import { apiPageHref, pageForTag } from "../api-reference/pages";
import { allEndpoints, curlFor } from "../api-reference/spec";
import { GlanceFilter, SdkHashRedirect } from "./client";
import {
	constantListHtml,
	disclosuresHtml,
	errorTreeHtml,
	glanceGroupsHtml,
	glanceHtml,
	mapBoxHtml,
	paramGroupsHtml,
	typeListHtml,
} from "./html";
import { Paragraphs, Text } from "./markdown-text";
import {
	type PackageKey,
	SDK_BASE,
	SDK_SURFACES,
	findPackagePage,
	findSurface,
} from "./pages";
import {
	type Method,
	type TypeDoc,
	callbackArgs,
	constructorEntry,
	errorAnchor,
	errorTree,
	exampleWithRefs,
	groupAnchor,
	groupParams,
	helperAnchor,
	legacyOwners,
	manifest,
	methodAnchor,
	packageTypes,
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
export function SdkEyebrow({
	title,
	lead = "SDK reference",
}: { title: string; lead?: string }) {
	return (
		<p className="sdkr-eyebrow">
			{lead} <span>· {title}</span>
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
	const ctor = constructorEntry(data);
	const entries = ctor ? [ctor, ...data.methods] : data.methods;
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

			<GlanceFilter count={entries.length}>
				<Html html={glanceHtml(entries)} />
			</GlanceFilter>

			{entries.map((method) => (
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

/**
 * A function-first package on one page: every function at a glance, then each
 * group as a section of full entries, its constants, and the types they use.
 */
export async function PackageReferencePage({ pkg }: { pkg: PackageKey }) {
	const info = findPackagePage(pkg);
	const m = manifest(pkg);
	const groups = m.surfaces.map((s) => ({
		slug: s.slug,
		title: s.title,
		data: surface(s.slug, pkg),
	}));
	const allTypes = packageTypes(groups.map((g) => g.data));
	const types = new Map(allTypes.map((t) => [t.name, t]));
	const total = groups.reduce((n, g) => n + g.data.methods.length, 0);
	return (
		<div className="sdkr">
			<CodeScope />
			<div className="sdkr-meta">
				<span className="v">
					{m.package}@{m.version}
				</span>
				<span>{total} functions</span>
				<span>from source with openpkg</span>
				{info.guide ? (
					<Link href={info.guide.href}>{info.guide.title}</Link>
				) : null}
			</div>

			<GlanceFilter count={total} noun="functions">
				<Html
					html={glanceGroupsHtml(
						groups.map((g) => ({ title: g.title, methods: g.data.methods })),
					)}
				/>
			</GlanceFilter>

			{groups.map((g) => (
				<section key={g.slug} className="sdkr-g">
					<h2
						id={groupAnchor(g.slug)}
						data-outline={g.title}
						className="sdkr-gh"
					>
						<a href={`#${groupAnchor(g.slug)}`} className="heading-anchor">
							{g.title}
						</a>
					</h2>
					{info.groups[g.slug] ? (
						<Paragraphs text={info.groups[g.slug] ?? ""} className="sdkr-sum" />
					) : null}
					<p className="sdkr-from">
						import from <code>{g.data.from ?? info.specifier}</code>
					</p>
					{g.data.methods.map((method) => (
						<MethodEntry key={method.id} method={method} types={types} />
					))}
					{g.data.constants?.length ? (
						<section className="sdkr-m">
							<div className="sdkr-mh">
								<h3 id={`${g.slug}-constants`}>Constants</h3>
							</div>
							<Html
								className="sdkr-typelist"
								html={constantListHtml(g.data.constants)}
							/>
						</section>
					) : null}
				</section>
			))}

			{allTypes.length ? (
				<section className="sdkr-m">
					<div className="sdkr-mh">
						<h2 id="types" data-outline="Types">
							<a href="#types" className="heading-anchor">
								Types on this page
							</a>
						</h2>
					</div>
					<Html className="sdkr-typelist" html={typeListHtml(allTypes)} />
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
			<div id={errorAnchor(tree[0]?.name ?? "")}>
				<Html html={errorTreeHtml(tree)} />
			</div>
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
				<Html
					className="sdkr-kids"
					html={SDK_SURFACES.map((s) => {
						const count = counts.get(s.slug) ?? 0;
						const name =
							s.slug === "client"
								? surface("client")
										.methods.map((x) => x.path)
										.join(" · ")
								: (m.surfaces.find((x) => x.slug === s.slug)?.root ?? s.title);
						return mapBoxHtml(
							`${SDK_BASE}/${s.slug}`,
							name,
							s.blurb,
							`${count} ${count === 1 ? "method" : "methods"}`,
						);
					}).join("")}
				/>
				<div className="sdkr-maprow">
					<p className="sdkr-lbl">Helpers you import directly</p>
					<Html
						className="sdkr-kids"
						html={[
							...featured.map((h) =>
								mapBoxHtml(
									`${SDK_BASE}/helpers#${helperAnchor(h.name)}`,
									h.name,
									h.summary,
								),
							),
							mapBoxHtml(
								`${SDK_BASE}/helpers`,
								`All ${m.helpers.length} helpers`,
								"Decoders, type guards, signature and proof checks",
							),
						].join("")}
					/>
				</div>
				<div className="sdkr-maprow">
					<p className="sdkr-lbl">Errors</p>
					<Html
						html={errorTreeHtml(
							errorTree(m.errors),
							(name) => `${SDK_BASE}/errors#${errorAnchor(name)}`,
						)}
					/>
				</div>
			</div>
		</div>
	);
}
