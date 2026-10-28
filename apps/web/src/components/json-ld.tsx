/**
 * Renders one schema.org object as a JSON-LD script. `<` is escaped so a value
 * containing `</script>` cannot close the tag early.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
	return (
		<script
			type="application/ld+json"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: JSON.stringify output with `<` escaped
			dangerouslySetInnerHTML={{
				__html: JSON.stringify(data).replace(/</g, "\\u003c"),
			}}
		/>
	);
}
