import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: [
			{
				userAgent: "*",
				allow: "/",
				disallow: ["/admin/", "/platform/", "/login", "/verify"],
			},
		],
		sitemap: "https://secondlayer.tools/sitemap.xml",
	};
}
