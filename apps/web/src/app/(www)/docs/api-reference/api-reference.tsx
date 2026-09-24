import { highlight } from "@/lib/highlight";
import { Fragment, type ReactNode, cache } from "react";
import {
	BaseUrlSwitch,
	CodeTabs,
	SectionActions,
	StickyAsides,
} from "./client";
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
	objectsByTag,
	paramGroups,
	responseExample,
	returnedObject,
	sdkSample,
	successContentType,
	tagGroups,
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

/** Token classes already defined in this render. */
const definedTokens = cache(() => new Set<string>());

/** FNV-1a, base 36: a short name that is the same for the same style. */
function tokenClass(style: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < style.length; i++) {
		h = Math.imul(h ^ style.charCodeAt(i), 0x01000193);
	}
	return `tk-${(h >>> 0).toString(36)}`;
}

/**
 * Shiki puts a ~100-char inline style on every token: 24k spans here, which
 * the page then ships twice (HTML and RSC payload) for 9 distinct styles.
 * Each style becomes a class instead, and the first block to use one emits
 * its rule. Same custom properties, so the dark-mode `var(--shiki-dark)`
 * rules apply unchanged.
 */
function classifyTokens(html: string): { html: string; css: string } {
	const defined = definedTokens();
	const rules: string[] = [];
	const out = html.replace(/<span style="([^"]*)">/g, (_, style: string) => {
		const name = tokenClass(style);
		if (!defined.has(name)) {
			defined.add(name);
			rules.push(`.${name}{${style}}`);
		}
		return `<span class="${name}">`;
	});
	return { html: out, css: rules.join("") };
}

async function Code({ code, lang }: { code: string; lang: string }) {
	const { html, css } = classifyTokens(await highlight(code, lang));
	return (
		<>
			{css ? <style>{css}</style> : null}
			<div
				className="apiref-code"
				// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output, server-rendered from our own spec
				dangerouslySetInnerHTML={{ __html: html }}
			/>
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

function Methods({ endpoint }: { endpoint: Endpoint }) {
	return (
		<div className="apiref-route">
			<span
				className={`apiref-verb apiref-verb-${endpoint.method.toLowerCase()}`}
			>
				{endpoint.method}
			</span>
			<code className="apiref-path">{endpoint.path}</code>
			{endpoint.selfHostOnly ? (
				<span className="apiref-pill">Self-hosted instances</span>
			) : null}
		</div>
	);
}

async function RequestPanel({ endpoint }: { endpoint: Endpoint }) {
	const hosted = curlFor(endpoint, "hosted");
	const local = curlFor(endpoint, "local");
	const sdk = sdkSample(endpoint.op);
	// Panels travel as an array into CodeTabs, so each one needs its own key.
	const curlPanel = (
		<Fragment key="curl">
			<div className="apiref-when-hosted">
				<Code code={hosted} lang="bash" />
			</div>
			<div className="apiref-when-local">
				<Code code={local} lang="bash" />
			</div>
		</Fragment>
	);
	const labels = ["cURL", ...(sdk ? ["SDK"] : [])];
	const panels: ReactNode[] = [
		curlPanel,
		...(sdk ? [<Code key="sdk" code={sdk} lang="typescript" />] : []),
	];
	return (
		<CodeTabs
			labels={labels}
			panels={panels}
			copyText={[endpoint.selfHostOnly ? local : hosted, ...(sdk ? [sdk] : [])]}
		/>
	);
}

async function ResponsePanel({
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
			<div className="apiref-response-bar">
				<span>{title}</span>
				{status ? (
					<span className={`apiref-status apiref-status-${statusTone(status)}`}>
						{status}
					</span>
				) : null}
			</div>
			<Code code={JSON.stringify(example, null, 2)} lang="json" />
		</div>
	);
}

async function EndpointSection({ endpoint }: { endpoint: Endpoint }) {
	const { op, anchor } = endpoint;
	const returned = returnedObject(op);
	const example = responseExample(op);
	const successCode = Object.keys(op.responses ?? {}).find((c) =>
		c.startsWith("2"),
	);
	const contentType = successContentType(op);
	const fields = bodyFields(op);
	return (
		<section id={anchor} className="apiref-section">
			<div className="apiref-main">
				<div className="apiref-eyebrow">{endpoint.tag}</div>
				<h3 className="apiref-title">
					<a href={`#${anchor}`}>{op.summary ?? op.operationId}</a>
				</h3>
				<SectionActions anchor={anchor} />
				<Methods endpoint={endpoint} />
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
									<a href={`#${objectAnchor(returned.name)}`}>
										{objectName(returned.name)} objects
									</a>
									.
								</>
							) : (
								<>
									<a href={`#${objectAnchor(returned.name)}`}>
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
			<aside className="apiref-aside" aria-label="Example request and response">
				<RequestPanel endpoint={endpoint} />
				{example !== undefined ? (
					<ResponsePanel
						title="Response"
						example={example}
						status={successCode}
					/>
				) : null}
			</aside>
		</section>
	);
}

async function ObjectSection({ entry }: { entry: ObjectEntry }) {
	const { schema, anchor } = entry;
	return (
		<section id={anchor} className="apiref-section">
			<div className="apiref-main">
				<div className="apiref-eyebrow">Object</div>
				<h3 className="apiref-title">
					<a href={`#${anchor}`}>{objectTitle(entry.name)}</a>
				</h3>
				<SectionActions anchor={anchor} />
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
							<a href={`#${e.anchor}`}>{e.op.summary ?? e.op.operationId}</a>
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
			{schema.example !== undefined ? (
				<aside className="apiref-aside" aria-label="Example object">
					<ResponsePanel
						title={objectTitle(entry.name)}
						example={schema.example}
					/>
				</aside>
			) : null}
		</section>
	);
}

export async function ApiReference() {
	const groups = tagGroups();
	const objects = objectsByTag();
	return (
		<div className="apiref" data-base="hosted">
			<div className="apiref-toolbar">
				<BaseUrlSwitch />
			</div>
			<StickyAsides />
			{groups.map((group) => (
				<div key={group.name} className="apiref-tag">
					<h2 id={group.name} className="apiref-tag-title">
						{group.name}
					</h2>
					{group.description ? (
						<p className="apiref-tag-desc">
							<Prose text={group.description} />
						</p>
					) : null}
					{(objects.get(group.name) ?? []).map((entry) => (
						<ObjectSection key={entry.name} entry={entry} />
					))}
					{group.endpoints.map((endpoint) => (
						<EndpointSection key={endpoint.anchor} endpoint={endpoint} />
					))}
				</div>
			))}
		</div>
	);
}
