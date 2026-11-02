/** Reads the body before replying: stacks-node treats an early close as a failed delivery and retries forever. */
export async function handleIgnoredObserverPost(
	req: Request,
): Promise<Response> {
	await req.arrayBuffer();
	return Response.json({ status: "ok" });
}

export async function handleNotFound(req: Request): Promise<Response> {
	if (req.body) await req.arrayBuffer();
	return new Response("Not Found", { status: 404 });
}
