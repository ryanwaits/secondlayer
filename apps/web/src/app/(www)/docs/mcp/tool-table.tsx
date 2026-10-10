import { firstSentence, resourceRows, toolGroups } from "./tools";

/**
 * The MCP page's tool and resource tables, rendered from the generated
 * registry snapshot. `/docs/mcp.md` gets the same tables as markdown
 * (docs-source.ts), since the markdown twin strips components.
 */

export function McpResources() {
	return (
		<table>
			<thead>
				<tr>
					<th>Resource</th>
					<th>What it returns</th>
				</tr>
			</thead>
			<tbody>
				{resourceRows().map(({ uri, description }) => (
					<tr key={uri}>
						<td>
							<code>{uri}</code>
						</td>
						<td>{firstSentence(description)}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

export function McpTools() {
	return (
		<>
			{toolGroups().map(({ group, title, tools }) => (
				<section key={group}>
					<h3 id={`tools-${group}`}>{title}</h3>
					<table>
						<thead>
							<tr>
								<th>Tool</th>
								<th>What it does</th>
							</tr>
						</thead>
						<tbody>
							{tools.map((tool) => (
								<tr key={tool.name}>
									<td>
										<code>{tool.name}</code>
									</td>
									<td>
										{firstSentence(tool.description)}
										{tool.hostedOnly ? " Hosted only." : ""}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</section>
			))}
		</>
	);
}
