import { Code } from "@/components/code/code";

interface CodeBlockProps {
	code: string;
	lang?: string;
}

/** Callers outside MDX (product pages, verify) render through the one `<Code>`. */
export function CodeBlock({ code, lang = "typescript" }: CodeBlockProps) {
	return <Code code={code} lang={lang} />;
}
