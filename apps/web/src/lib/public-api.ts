/** API origin the browser calls directly, so the API sees the visitor's IP. */
export const PUBLIC_API_URL =
	process.env.NEXT_PUBLIC_SECONDLAYER_API_URL ??
	(process.env.NODE_ENV === "production"
		? "https://api.secondlayer.tools"
		: "http://localhost:3800");
