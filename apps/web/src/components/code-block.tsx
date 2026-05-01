import { highlight } from "@/lib/highlight";
import { CopyButton } from "./copy-button";

interface CodeBlockProps {
	code: string;
	lang?: string;
}

export async function CodeBlock({ code, lang = "typescript" }: CodeBlockProps) {
	const html = await highlight(code.trim(), lang);

	return (
		<div className="code-block-wrapper">
			<CopyButton code={code.trim()} />
			{/* biome-ignore lint/security/noDangerouslySetInnerHtml: shiki-highlighted server-rendered HTML */}
			<div dangerouslySetInnerHTML={{ __html: html }} />
		</div>
	);
}
