import { Glob } from "bun";

/* Vocs 1.4.1 emits no sitemap. Walk the page files and write one into
   docs/public before `vocs build`, which copies public/ into whichever output
   dir it uses (docs/dist locally, .vercel/output/static on Vercel), like
   robots.txt. */
const origin = "https://stacks.secondlayer.tools";
const pagesDir = new URL("../docs/pages/", import.meta.url).pathname;
const outFile = new URL("../docs/public/sitemap.xml", import.meta.url).pathname;

export function routeOf(file: string): string {
	const route = file.replace(/\.mdx$/, "").replace(/(^|\/)index$/, "");
	return route === "" ? "/" : `/${route}`;
}

export function sitemap(files: string[]): string {
	const urls = files
		.map(routeOf)
		.sort()
		.map((route) => `\t<url><loc>${origin}${route}</loc></url>`);
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

if (import.meta.main) {
	const files = [...new Glob("**/*.mdx").scanSync(pagesDir)];
	await Bun.write(outFile, sitemap(files));
	console.log(`sitemap: ${files.length} urls`);
}
