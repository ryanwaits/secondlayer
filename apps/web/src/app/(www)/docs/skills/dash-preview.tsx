import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DashPreviewClient } from "./dash-preview-client";

const TEMPLATE = join(
	process.cwd(),
	"..",
	"..",
	"skills",
	"secondlayer",
	"dash",
	"template",
);
const RECIPES = join(TEMPLATE, "..", "recipes");

const read = (path: string) => readFileSync(path, "utf8");

export function shadowKitCss(css: string): string {
	return `${css.replace(/:root\b/g, ":host").replace(/^body\s*\{/m, ":host {")}
:host { display: block; padding: 0; background: none; }
.dash { border: 0; border-radius: 0; }
.dbar { display: none; }`;
}

export function DashPreview() {
	const css = shadowKitCss(read(join(TEMPLATE, "kit.css")));
	const catalog = JSON.parse(read(join(TEMPLATE, "catalog.json")));
	const spec = JSON.parse(read(join(RECIPES, "webhook-health.json")));
	return (
		<figure className="dash-preview">
			<div className="dash-preview-bar" aria-hidden="true">
				<span className="dash-preview-dots">
					<i />
					<i />
					<i />
				</span>
				<span className="dash-preview-url">localhost:4400</span>
			</div>
			<DashPreviewClient css={css} spec={spec} catalog={catalog} />
			<figcaption>
				The webhook-health dashboard on an example account. Click a delivery to
				open its payload.
			</figcaption>
		</figure>
	);
}
