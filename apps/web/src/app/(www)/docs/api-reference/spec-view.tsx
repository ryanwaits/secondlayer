import spec from "@/generated/openapi.json";

/**
 * Renders the API's own OpenAPI description. Nothing here restates the API —
 * `bun run openapi` copies `packages/api/src/routes/openapi.ts` into
 * src/generated/openapi.json, so this page can't drift from what ships.
 */

type Param = {
	name: string;
	in: string;
	required?: boolean;
	description?: string;
	schema?: { type?: string; enum?: string[]; default?: unknown };
	$ref?: string;
};

type Operation = {
	tags?: string[];
	summary?: string;
	description?: string;
	security?: Array<Record<string, unknown>>;
	parameters?: Param[];
	responses?: Record<string, { description?: string }>;
};

const SPEC = spec as unknown as {
	info: { title: string; version: string; description?: string };
	servers?: Array<{ url: string }>;
	tags?: Array<{ name: string; description?: string }>;
	components?: { parameters?: Record<string, Param> };
	paths: Record<string, Record<string, Operation>>;
};

/** `#/components/parameters/Limit` → the real parameter object. */
function resolve(param: Param): Param {
	const ref = param.$ref;
	if (!ref) return param;
	const key = ref.split("/").pop() ?? "";
	return SPEC.components?.parameters?.[key] ?? param;
}

/** An operation is public when its security list includes the empty scheme. */
function isAnonymous(op: Operation): boolean {
	return (op.security ?? []).some((s) => Object.keys(s).length === 0);
}

function paramType(param: Param): string {
	const schema = param.schema ?? {};
	if (schema.enum) return schema.enum.join(" · ");
	return schema.type ?? "string";
}

function Endpoint({
	path,
	method,
	op,
}: {
	path: string;
	method: string;
	op: Operation;
}) {
	const params = (op.parameters ?? []).map(resolve);
	const codes = Object.keys(op.responses ?? {});
	return (
		<div className="apiref-op">
			<div className="apiref-op-head">
				<span className={`apiref-verb apiref-verb-${method}`}>
					{method.toUpperCase()}
				</span>
				<code className="apiref-path">{path}</code>
				<span className="apiref-auth">
					{isAnonymous(op) ? "no key" : "bearer"}
				</span>
			</div>
			{op.summary ? <p className="apiref-summary">{op.summary}</p> : null}
			{op.description ? (
				<p className="apiref-summary apiref-muted">{op.description}</p>
			) : null}

			{params.length > 0 ? (
				<table className="apiref-params">
					<thead>
						<tr>
							<th>Parameter</th>
							<th>Type</th>
							<th>Notes</th>
						</tr>
					</thead>
					<tbody>
						{params.map((p) => (
							<tr key={`${p.in}:${p.name}`}>
								<td>
									<code>{p.name}</code>
									{p.required ? (
										<span className="apiref-required">required</span>
									) : null}
								</td>
								<td className="apiref-type">{paramType(p)}</td>
								<td>
									{p.description ?? (p.in === "path" ? "Path segment" : "")}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			) : null}

			{codes.length > 0 ? (
				<p className="apiref-codes">
					Responses:{" "}
					{codes.map((c) => (
						<code key={c}>{c}</code>
					))}
				</p>
			) : null}
		</div>
	);
}

export function SpecView() {
	const groups = (SPEC.tags ?? []).map((tag) => ({
		...tag,
		ops: Object.entries(SPEC.paths).flatMap(([path, methods]) =>
			Object.entries(methods)
				.filter(([, op]) => (op.tags ?? []).includes(tag.name))
				.map(([method, op]) => ({ path, method, op })),
		),
	}));

	// Anything the spec didn't tag still has to appear, or the page silently
	// under-reports the surface it claims to describe.
	const tagged = new Set(
		groups.flatMap((g) => g.ops.map((o) => `${o.method} ${o.path}`)),
	);
	const untagged = Object.entries(SPEC.paths).flatMap(([path, methods]) =>
		Object.entries(methods)
			.filter(([method]) => !tagged.has(`${method} ${path}`))
			.map(([method, op]) => ({ path, method, op })),
	);

	return (
		<>
			<p className="apiref-base">
				Base URL <code>{SPEC.servers?.[0]?.url}</code> · spec version{" "}
				{SPEC.info.version}
			</p>

			{groups.map((group) => (
				<section key={group.name}>
					<h2 id={group.name}>{group.name}</h2>
					{group.description ? <p>{group.description}</p> : null}
					{group.ops.map(({ path, method, op }) => (
						<Endpoint
							key={`${method} ${path}`}
							path={path}
							method={method}
							op={op}
						/>
					))}
				</section>
			))}

			{untagged.length > 0 ? (
				<section>
					<h2 id="other">other</h2>
					{untagged.map(({ path, method, op }) => (
						<Endpoint
							key={`${method} ${path}`}
							path={path}
							method={method}
							op={op}
						/>
					))}
				</section>
			) : null}
		</>
	);
}
