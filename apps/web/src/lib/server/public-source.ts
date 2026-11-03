/** The source response minus the deployed bundle (`handlerCode`) and the pin
 *  fields: the dashboard shows the author's source, never the compiled code. */
export function publicSource(payload: unknown): unknown {
	if (!payload || typeof payload !== "object") return payload;
	const { name, version, sourceCode, readOnly, updatedAt } = payload as Record<
		string,
		unknown
	>;
	return { name, version, sourceCode, readOnly, updatedAt };
}
