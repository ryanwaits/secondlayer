import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: [
			{
				userAgent: "*",
				allow: "/",
				disallow: ["/login", "/verify"],
			},
		],
		sitemap: "https://www.secondlayer.tools/sitemap.xml",
	};
}
