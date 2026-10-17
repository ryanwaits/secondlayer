import { renderCode } from "@/components/code/code";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_BLOCKS = 10;
const MAX_CODE = 8000;
const MAX_TITLE = 80;
const MAX_LINES = 10000;

type Block = { code: string; title: string; lines: number };

function parse(body: unknown): Block[] | null {
	const blocks = (body as { blocks?: unknown } | null)?.blocks;
	if (!Array.isArray(blocks) || blocks.length < 1 || blocks.length > MAX_BLOCKS)
		return null;
	const out: Block[] = [];
	for (const raw of blocks) {
		const { code, title, lines } = (raw ?? {}) as Partial<Block>;
		if (
			typeof code !== "string" ||
			code.length < 1 ||
			code.length > MAX_CODE ||
			typeof title !== "string" ||
			title.length > MAX_TITLE ||
			typeof lines !== "number" ||
			!Number.isInteger(lines) ||
			lines < 1 ||
			lines > MAX_LINES
		)
			return null;
		out.push({ code, title, lines });
	}
	return out;
}

/** Renders TypeScript blocks with the docs code renderer, for client screens
 *  that can't run Shiki. Renders only the text it's given, escaped by
 *  renderCode, and reads no account data, so it needs no session. */
export async function POST(req: Request) {
	const blocks = parse(await req.json().catch(() => null));
	if (!blocks)
		return NextResponse.json(
			{
				error: `Send { blocks }: 1 to ${MAX_BLOCKS} of { code (1 to ${MAX_CODE} chars), title (up to ${MAX_TITLE} chars), lines (1 to ${MAX_LINES}) }.`,
			},
			{ status: 400 },
		);
	const rendered = await Promise.all(
		blocks.map(({ code, title, lines }) =>
			renderCode({ code, lang: "ts", meta: `lines=${lines}`, title }),
		),
	);
	return NextResponse.json({
		blocks: rendered.map(({ className, copyable, html }) => ({
			className,
			copyable,
			html,
		})),
	});
}
