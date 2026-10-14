import { Code } from "@/components/code/code";
import { CodeTabs } from "@/components/code/code-tabs";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import {
	ApiHashRedirect,
	BaseUrlSwitch,
	CopyUrl,
	PromptBar,
	SectionActions,
} from "./client";
import { anchorPages, pageContent } from "./page-content";
import { API_PAGES, apiPageHref, findApiPage } from "./pages";
import { endpointPrompt, objectPrompt, promptParts } from "./prompt";
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

/** The route row: method pill, path, a copy-URL icon, and a self-host note. */
function Methods({ endpoint }: { endpoint: Endpoint }) {
	return (
		<span className="apiref-route">
			<span
				className={`apiref-verb apiref-verb-${endpoint.method.toLowerCase()}`}
			>
				{endpoint.method}
			</span>
			<code className="apiref-path">{endpoint.path}</code>
			<CopyUrl path={endpoint.path} />
			{endpoint.selfHostOnly ? (
				<span className="apiref-pill">Self-hosted instances</span>
			) : null}
		</span>
	);
}

/** cURL and the SDK call for one endpoint, one tab each. The cURL carries the
 *  hosted base URL; the page's Base URL switch rewrites it in place. */
function RequestPanel({ endpoint }: { endpoint: Endpoint }) {
	const sdk = sdkSample(endpoint.op);
	return (
		<div className="apiref-request">
			<CodeTabs sync="lang">
				<Code lang="bash" meta="base" code={curlFor(endpoint, "hosted")} />
				{sdk ? <Code lang="ts" code={sdk} /> : null}
			</CodeTabs>
		</div>
	);
}

function ResponsePanel({
	title,
	example,
	status,
}: {
	title: string;
	example: unknown;
	status?: string;
}) {
	return (
		<div className="apiref-response">
			<Code
				lang="json"
				meta={status ? `status=${status}` : undefined}
				title={title}
				code={JSON.stringify(example, null, 2)}
			/>
		</div>
	);
}

type HrefFor = (anchor: string) => string;

/** One endpoint in full: the docs on the left, and on the right (sticky) the
 *  agent prompt, the request and the response. Rendered on the server. */
function EndpointSection({
	endpoint,
	family,
	hrefFor,
}: { endpoint: Endpoint; family: string; hrefFor: HrefFor }) {
	const { op, anchor } = endpoint;
	const title = op.summary ?? op.operationId;
	const prompt = endpointPrompt(endpoint);
	const returned = returnedObject(op);
	const example = responseExample(op);
	const successCode = Object.keys(op.responses ?? {}).find((c) =>
		c.startsWith("2"),
	);
	const contentType = successContentType(op);
	const fields = bodyFields(op);
	return (
		<section className="apiref-ep" aria-labelledby={anchor}>
			<div className="apiref-ep-head">
				<div className="apiref-ep-id">
					<h3
						id={anchor}
						className="apiref-ep-title"
						data-outline-child={family}
						data-outline={title}
						data-verb={endpoint.method.toLowerCase()}
					>
						<a href={`#${anchor}`} className="heading-anchor">
							{title}
						</a>
					</h3>
					<Methods endpoint={endpoint} />
				</div>
				<SectionActions anchor={anchor} />
			</div>
			{op.description ? (
				<p className="apiref-desc">
					<Prose text={op.description} />
				</p>
			) : null}
			<div className="apiref-ep-cols">
				<div className="apiref-main">
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
				</div>
				<aside
					className="apiref-aside"
					aria-label="Agent prompt, request and response"
				>
					<PromptBar text={prompt} parts={promptParts(prompt)} />
					<RequestPanel endpoint={endpoint} />
					{example !== undefined ? (
						<ResponsePanel
							title="Response"
							example={example}
							status={successCode}
						/>
					) : null}
				</aside>
			</div>
		</section>
	);
}

/** One object in full, laid out like an endpoint: attributes on the left, the
 *  prompt and the example object on the right. */
function ObjectSection({
	entry,
	hrefFor,
}: { entry: ObjectEntry; hrefFor: HrefFor }) {
	const { schema, anchor } = entry;
	const title = objectTitle(entry.name);
	const prompt = objectPrompt(entry);
	return (
		<section className="apiref-ep" aria-labelledby={anchor}>
			<div className="apiref-ep-head">
				<div className="apiref-ep-id">
					<h3
						id={anchor}
						className="apiref-ep-title"
						data-outline-child="objects"
						data-outline={title}
					>
						<a href={`#${anchor}`} className="heading-anchor">
							{title}
						</a>
					</h3>
					<span className="apiref-verb apiref-verb-object">Object</span>
				</div>
				<SectionActions anchor={anchor} />
			</div>
			{schema.description ? (
				<p className="apiref-desc">
					<Prose text={schema.description} />
				</p>
			) : null}
			<div className="apiref-ep-cols">
				<div className="apiref-main">
					<p className="apiref-returned-by">
						Returned by{" "}
						{entry.returnedBy.map((e, i) => (
							<Fragment key={e.anchor}>
								{i > 0 ? ", " : ""}
								<a href={hrefFor(e.anchor)}>
									{e.op.summary ?? e.op.operationId}
								</a>
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
				</div>
				<aside
					className="apiref-aside"
					aria-label="Agent prompt and example object"
				>
					<PromptBar text={prompt} parts={promptParts(prompt)} />
					{schema.example !== undefined ? (
						<ResponsePanel title={title} example={schema.example} />
					) : null}
				</aside>
			</div>
		</section>
	);
}

function EndpointRow({ endpoint }: { endpoint: Endpoint }) {
	return (
		<a href={`#${endpoint.anchor}`} className="apiref-row">
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
		<a href={`#${entry.anchor}`} className="apiref-row">
			<span className="apiref-verb apiref-verb-object">Object</span>
			<code className="apiref-row-path">{entry.name}</code>
			<span className="apiref-row-sum">{objectTitle(entry.name)}</span>
		</a>
	);
}

/** One family in the page's index: heading, summary, a row per entry. The
 *  heading is the family's anchor and its label in the docs sidebar. */
function FamilyIndex({
	id,
	title,
	summary,
	children,
}: {
	id: string;
	title: string;
	summary: string;
	children: ReactNode;
}) {
	return (
		<div className="apiref-family">
			<h2 id={id} className="apiref-family-title" data-outline-family="">
				<a href={`#${id}`} className="heading-anchor">
					{title}
				</a>
			</h2>
			<p className="apiref-family-desc">{summary}</p>
			<div className="apiref-rows">{children}</div>
		</div>
	);
}

/**
 * One API page as one long scroll. An index of every endpoint and object
 * comes first, grouped by family (plain in-page links), then every endpoint
 * in full, then the page's objects. The docs sidebar lists each section and
 * follows the one on screen.
 */
export function ApiPage({ slug }: { slug: string }) {
	const page = findApiPage(slug);
	if (!page) throw new Error(`No API reference page "${slug}"`);
	const { families, objects } = pageContent(page);
	const owners = anchorPages();
	const hrefFor: HrefFor = (anchor) =>
		owners[anchor] ? `${apiPageHref(owners[anchor])}#${anchor}` : `#${anchor}`;
	return (
		<div className="apiref">
			<div className="apiref-toolbar">
				<BaseUrlSwitch />
			</div>
			<nav className="apiref-index" aria-label="Endpoints on this page">
				{families.map((family) => (
					<FamilyIndex
						key={family.id}
						id={family.id}
						title={family.title}
						summary={family.summary}
					>
						{family.endpoints.map((endpoint) => (
							<EndpointRow key={endpoint.anchor} endpoint={endpoint} />
						))}
					</FamilyIndex>
				))}
				{objects.length ? (
					<FamilyIndex
						id="objects"
						title="Objects"
						summary="The shapes this page's endpoints return."
					>
						{objects.map((entry) => (
							<ObjectRow key={entry.anchor} entry={entry} />
						))}
					</FamilyIndex>
				) : null}
			</nav>
			{families.flatMap((family) =>
				family.endpoints.map((endpoint) => (
					<EndpointSection
						key={endpoint.anchor}
						endpoint={endpoint}
						family={family.id}
						hrefFor={hrefFor}
					/>
				)),
			)}
			{objects.map((entry) => (
				<ObjectSection key={entry.anchor} entry={entry} hrefFor={hrefFor} />
			))}
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
