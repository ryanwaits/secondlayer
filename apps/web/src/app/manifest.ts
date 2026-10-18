import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
	return {
		name: "Secondlayer",
		short_name: "Secondlayer",
		description: "Your stack, from your phone.",
		id: "/account",
		start_url: "/account",
		scope: "/account",
		display: "standalone",
		background_color: "#ffffff", // DESIGN.md colors.light.paper
		theme_color: "#ffffff",
		icons: [
			{ src: "/pwa-icon/192", sizes: "192x192", type: "image/png" },
			{ src: "/pwa-icon/512", sizes: "512x512", type: "image/png" },
			{
				src: "/pwa-icon/512",
				sizes: "512x512",
				type: "image/png",
				purpose: "maskable",
			},
		],
	};
}
