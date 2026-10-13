import { highlight } from "@/lib/highlight";
import Link from "next/link";
import { Fragment } from "react";
import { ApiHashRedirect, BaseUrlSwitch, CodeTabs } from "./client";
import { ApiDrawerHost, type DrawerDetail } from "./drawer";
import { anchorPages, pageContent } from "./page-content";
import { API_PAGES, apiPageHref, findApiPage } from "./pages";
import { endpointPrompt, objectPrompt } from "./prompt";
import {
	type Endpoint,
	type ObjectEntry,
	type Param,
	type Schema,
	bodyFields,
	curlFor,
	enumValues,
	objectAnchor,
	objectName,
	objectTitle,
	paramGroups,
	responseExample,
	returnedObject,
	sdkSample,
	successContentType,
	typeLabel,
} from "./spec";

/** Spec prose uses backticks for code; that's the only markup it carries. */
function Prose({ text }: { text?: string }) {
	if (!text) return null;
	return (
		<>
			{text.split(/(`[^`]+`)/g).map((part, i) =>
				part.startsWith("`") && part.endsWith("`") ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: static split of immutable text
					<code key={i}>{part.slice(1, -1)}</code>
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: static split of immutable text
					<Fragment key={i}>{part}</Fragment>
				),
			)}
		</>
	);
}

/** Token classes seen by any highlighted block, with their rules. */
const tokenRules = new Map<string, string>();

/** FNV-1a, base 36: a short name that is the same for the same style. */
function tokenClass(style: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < style.length; i++) {
		h = Math.imul(h ^ style.charCodeAt(i), 0x01000193);
	}
	return `tk-${(h >>> 0).toString(36)}`;
}

/**
 * Shiki puts a ~100-char inline style on every token: tens of thousands of
 * spans on a page, for 9 distinct styles. Each style becomes a class instead.
 * Same custom properties, so the dark-mode `var(--shiki-dark)` rules apply
 * unchanged. The rules are collected here and written once per page by
 * `TokenStyles`, after every block on the page has been highlighted, because
 * the blocks themselves only reach the page when a drawer opens one.
 */
function classifyTokens(html: string): string {
	return html.replace(/<span style="([^"]*)">/g, (_, style: string) => {
		const name = tokenClass(style);
		if (!tokenRules.has(name)) tokenRules.set(name, `.${name}{${style}}`);
		return `<span class="${name}">`;
	});
}

function TokenStyles() {
	return <style>{[...tokenRules.values()].join("")}</style>;
}

type Block = { html: string };

async function highlightBlock(code: string, lang: string): Promise<Block> {
	return { html: classifyTokens(await highlight(code, lang)) };
}

function Code({ block }: { block: Block }) {
	return (
		<div
			className="apiref-code"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output, server-rendered from our own spec
			dangerouslySetInnerHTML={{ __html: block.html }}
		/>
	);
}

function EnumValues({ values }: { values: readonly string[] }) {
	return (
		<details className="apiref-enum">
			<summary>{values.length} possible values</summary>
			<div className="apiref-enum-values">
				{values.map((v) => (
					<code key={v}>{v}</code>
				))}
			</div>
		</details>
	);
}

function FieldRow({
	id,
	name,
	type,
	required,
	description,
	schema,
}: {
	id: string;
	name: string;
	type: string;
	required?: boolean;
	description?: string;
	schema?: Schema;
}) {
	return (
		<div id={id} className="apiref-field">
			<div className="apiref-field-head">
				<code className="apiref-field-name">{name}</code>
				<span className="apiref-field-type">{type}</span>
				{required ? <span className="apiref-field-req">required</span> : null}
				<a
					href={`#${id}`}
					className="apiref-field-link"
					aria-label={`Link to ${name}`}
				>
					#
				</a>
			</div>
			{description ? (
				<p className="apiref-field-desc">
					<Prose text={description} />
				</p>
			) : null}
			{enumValues(schema).length ? (
				<EnumValues values={enumValues(schema)} />
			) : null}
		</div>
	);
}

function ParamList({ anchor, params }: { anchor: string; params: Param[] }) {
	return (
		<div className="apiref-fields">
			{params.map((p) => (
				<FieldRow
					key={p.name}
					id={`${anchor}.${p.name}`}
					name={p.name}
					type={typeLabel(p.schema)}
					required={p.required}
					description={p.description}
					schema={p.schema}
				/>
			))}
		</div>
	);
}

function statusTone(code: string): string {
	if (code.startsWith("2")) return "ok";
	if (code.startsWith("5")) return "bad";
	return "warn";
}

function Methods({ endpoint }: { endpoint: Endpoint }) {
	return (
		<span className="apiref-route">
			<span
				className={`apiref-verb apiref-verb-${endpoint.method.toLowerCase()}`}
			>
				{endpoint.method}
			</span>
			<code className="apiref-path">{endpoint.path}</code>
			{endpoint.selfHostOnly ? (
				<span className="apiref-pill">Self-hosted instances</span>
			) : null}
		</span>
	);
}

function RequestPanel({
	endpoint,
	hosted,
	local,
	sdk,
}: {
	endpoint: Endpoint;
	hosted: Block;
	local: Block;
	sdk: Block | null;
}) {
	const curlText = curlFor(
		endpoint,
		endpoint.selfHostOnly ? "local" : "hosted",
	);
	// Panels travel as an array into CodeTabs, so each one needs its own key.
	const curlPanel = (
		<Fragment key="curl">
			<div className="apiref-when-hosted">
				<Code block={hosted} />
			</div>
			<div className="apiref-when-local">
				<Code block={local} />
			</div>
		</Fragment>
	);
	const sdkText = sdkSample(endpoint.op);
	return (
		<CodeTabs
			labels={["cURL", ...(sdk ? ["SDK"] : [])]}
			panels={[curlPanel, ...(sdk ? [<Code key="sdk" block={sdk} />] : [])]}
			copyText={[curlText, ...(sdkText ? [sdkText] : [])]}
		/>
	);
}

function ResponsePanel({
	title,
	block,
	status,
}: {
	title: string;
	block: Block;
	status?: string;
}) {
	return (
		<div className="apiref-response">
			<div className="apiref-response-bar">
				<span>{title}</span>
				{status ? (
					<span className={`apiref-status apiref-status-${statusTone(status)}`}>
						{status}
					</span>
				) : null}
			</div>
			<Code block={block} />
		</div>
	);
}

type HrefFor = (anchor: string) => string;

/** One endpoint's drawer content: the docs, the request and the response,
 *  highlighted here on the server so the browser only ever receives markup. */
async function endpointDetail(
	endpoint: Endpoint,
	hrefFor: HrefFor,
): Promise<DrawerDetail> {
	const { op, anchor } = endpoint;
	const returned = returnedObject(op);
	const example = responseExample(op);
	const successCode = Object.keys(op.responses ?? {}).find((c) =>
		c.startsWith("2"),
	);
	const contentType = successContentType(op);
	const fields = bodyFields(op);
	const sdk = sdkSample(op);
	const [hosted, local, sdkBlock, responseBlock] = await Promise.all([
		highlightBlock(curlFor(endpoint, "hosted"), "bash"),
		highlightBlock(curlFor(endpoint, "local"), "bash"),
		sdk ? highlightBlock(sdk, "typescript") : null,
		example !== undefined
			? highlightBlock(JSON.stringify(example, null, 2), "json")
			: null,
	]);
	return {
		title: op.summary ?? op.operationId,
		subtitle: <Methods endpoint={endpoint} />,
		prompt: endpointPrompt(endpoint),
		main: (
			<>
				{op.description ? (
					<p className="apiref-desc">
						<Prose text={op.description} />
					</p>
				) : null}

				{paramGroups(op).map((group) => (
					<div key={group.title} className="apiref-group">
						<h4 className="apiref-group-title">{group.title}</h4>
						<ParamList anchor={anchor} params={group.params} />
					</div>
				))}

				{fields.length ? (
					<div className="apiref-group">
						<h4 className="apiref-group-title">Body</h4>
						<div className="apiref-fields">
							{fields.map((f) => (
								<FieldRow
									key={f.name}
									id={`${anchor}.body.${f.name}`}
									name={f.name}
									type={typeLabel(f.schema)}
									required={f.required}
									description={f.schema.description}
									schema={f.schema}
								/>
							))}
						</div>
					</div>
				) : null}

				<div className="apiref-group">
					<h4 className="apiref-group-title">Returns</h4>
					{returned ? (
						<p className="apiref-desc">
							{returned.list ? (
								<>
									A cursor envelope. <code>{returned.key}</code> holds{" "}
									<a href={hrefFor(objectAnchor(returned.name))}>
										{objectName(returned.name)} objects
									</a>
									.
								</>
							) : (
								<>
									<a href={hrefFor(objectAnchor(returned.name))}>
										{objectTitle(returned.name)}
									</a>
									.
								</>
							)}
						</p>
					) : contentType && contentType !== "application/json" ? (
						<p className="apiref-desc">
							<code>{contentType}</code>
						</p>
					) : null}
					<ul className="apiref-statuses">
						{Object.entries(op.responses ?? {}).map(([code, res]) => (
							<li key={code}>
								<span
									className={`apiref-status apiref-status-${statusTone(code)}`}
								>
									{code}
								</span>
								<span>
									<Prose text={res.description} />
								</span>
							</li>
						))}
					</ul>
				</div>
			</>
		),
		request: (
			<RequestPanel
				endpoint={endpoint}
				hosted={hosted}
				local={local}
				sdk={sdkBlock}
			/>
		),
		response: responseBlock ? (
			<ResponsePanel
				title="Response"
				block={responseBlock}
				status={successCode}
			/>
		) : null,
	};
}

async function objectDetail(
	entry: ObjectEntry,
	hrefFor: HrefFor,
): Promise<DrawerDetail> {
	const { schema, anchor } = entry;
	const example =
		schema.example !== undefined
			? await highlightBlock(JSON.stringify(schema.example, null, 2), "json")
			: null;
	return {
		title: objectTitle(entry.name),
		subtitle: "Object",
		prompt: objectPrompt(entry),
		main: (
			<>
				{schema.description ? (
					<p className="apiref-desc">
						<Prose text={schema.description} />
					</p>
				) : null}
				<p className="apiref-returned-by">
					Returned by{" "}
					{entry.returnedBy.map((e, i) => (
						<Fragment key={e.anchor}>
							{i > 0 ? ", " : ""}
							<a href={hrefFor(e.anchor)}>{e.op.summary ?? e.op.operationId}</a>
						</Fragment>
					))}
				</p>
				<div className="apiref-group">
					<h4 className="apiref-group-title">Attributes</h4>
					<div className="apiref-fields">
						{Object.entries(schema.properties ?? {}).map(([name, s]) => (
							<FieldRow
								key={name}
								id={`${anchor.replace(/-object$/, "")}.${name}`}
								name={name}
								type={typeLabel(s)}
								required={schema.required?.includes(name)}
								description={s.description}
								schema={s}
							/>
						))}
					</div>
				</div>
			</>
		),
		request: null,
		response: example ? (
			<ResponsePanel title={objectTitle(entry.name)} block={example} />
		) : null,
	};
}

/** A family heading, marked up like an MDX `##` so the page reads as one. */
function FamilyHeading({
	id,
	title,
	count,
}: { id: string; title: string; count: number }) {
	return (
		<div className="section-heading-wrap">
			<hr />
			<h2 id={id} className="section-heading" data-count={count}>
				<a href={`#${id}`} className="heading-anchor">
					{title}
				</a>
			</h2>
		</div>
	);
}

function EndpointRow({ endpoint }: { endpoint: Endpoint }) {
	return (
		<a href={`#${endpoint.anchor}`} className="apiref-row" data-endpoint-row>
			<span
				className={`apiref-verb apiref-verb-${endpoint.method.toLowerCase()}`}
			>
				{endpoint.method}
			</span>
			<code className="apiref-row-path">{endpoint.path}</code>
			<span className="apiref-row-sum">
				{endpoint.op.summary ?? endpoint.op.operationId}
			</span>
		</a>
	);
}

function ObjectRow({ entry }: { entry: ObjectEntry }) {
	return (
		<a href={`#${entry.anchor}`} className="apiref-row" data-endpoint-row>
			<span className="apiref-verb apiref-verb-object">Object</span>
			<code className="apiref-row-path">{entry.name}</code>
			<span className="apiref-row-sum">{objectTitle(entry.name)}</span>
		</a>
	);
}

/**
 * One API page: every endpoint at a glance, by family, then the page's
 * objects. Each row links to its anchor; the drawer opens it. The drawer's
 * content is rendered here, once per row, and handed to the client host
 * keyed by anchor, so the page itself ships rows and the host ships markup.
 */
export async function ApiPage({ slug }: { slug: string }) {
	const page = findApiPage(slug);
	if (!page) throw new Error(`No API reference page "${slug}"`);
	const { families, objects } = pageContent(page);
	const owners = anchorPages();
	const hrefFor: HrefFor = (anchor) =>
		owners[anchor] ? `${apiPageHref(owners[anchor])}#${anchor}` : `#${anchor}`;
	const endpoints = families.flatMap((f) => f.endpoints);
	const entries = await Promise.all([
		...endpoints.map(
			async (e) => [e.anchor, await endpointDetail(e, hrefFor)] as const,
		),
		...objects.map(
			async (o) => [o.anchor, await objectDetail(o, hrefFor)] as const,
		),
	]);
	return (
		<div className="apiref">
			<div className="apiref-toolbar">
				<BaseUrlSwitch />
			</div>
			{families.map((family) => (
				<section key={family.id} aria-label={family.title}>
					<FamilyHeading
						id={family.id}
						title={family.title}
						count={family.endpoints.length}
					/>
					<p className="apiref-family-desc">{family.summary}</p>
					<div className="apiref-rows">
						{family.endpoints.map((endpoint) => (
							<EndpointRow key={endpoint.anchor} endpoint={endpoint} />
						))}
					</div>
				</section>
			))}
			{objects.length ? (
				<section aria-label="Objects">
					<FamilyHeading id="objects" title="Objects" count={objects.length} />
					<p className="apiref-family-desc">
						The shapes this page's endpoints return.
					</p>
					<div className="apiref-rows">
						{objects.map((entry) => (
							<ObjectRow key={entry.anchor} entry={entry} />
						))}
					</div>
				</section>
			) : null}
			<TokenStyles />
			<ApiDrawerHost details={Object.fromEntries(entries)} />
		</div>
	);
}

/** The reference's front page: the six pages, with what each one covers. */
export function ApiPageList() {
	return (
		<div className="apiref-rows apiref-pages">
			<ApiHashRedirect owners={anchorPages()} />
			{API_PAGES.map((page) => {
				const { families } = pageContent(page);
				const count = families.reduce((n, f) => n + f.endpoints.length, 0);
				return (
					<Link
						key={page.slug}
						href={apiPageHref(page.slug)}
						className="apiref-row"
					>
						<span className="apiref-row-name">{page.title}</span>
						<span className="apiref-row-sum">
							{families.map((f) => f.title).join(" · ")}
						</span>
						<span className="apiref-row-count">{count}</span>
					</Link>
				);
			})}
		</div>
	);
}
