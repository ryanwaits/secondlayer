import { DetailTabs } from "@/components/console/detail-tabs";
import { ApiError, apiRequest, getSessionFromCookies } from "@/lib/api";
import type { Stream } from "@/lib/types";
import { notFound } from "next/navigation";
import { StreamHeader } from "./stream-header";

export default async function StreamDetailLayout({
	children,
	params,
}: {
	children: React.ReactNode;
	params: Promise<{ id: string }>;
}) {
	const session = await getSessionFromCookies();
	if (!session) notFound();

	const { id } = await params;

	let stream: Stream;
	try {
		stream = await apiRequest<Stream>(`/api/streams/${id}`, {
			sessionToken: session,
			tags: ["streams", `stream-${id}`],
		});
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) {
			notFound();
		}
		throw e;
	}

	const basePath = `/streams/${id}`;

	return (
		<>
			<StreamHeader initialStream={stream} sessionToken={session} />
			<DetailTabs
				items={[
					{ label: "Overview", href: basePath },
					{ label: "Filters", href: `${basePath}/filters` },
					{ label: "Deliveries", href: `${basePath}/deliveries` },
					{ label: "Endpoint", href: `${basePath}/endpoint` },
					{ label: "Replay", href: `${basePath}/replay` },
				]}
			/>
			{children}
		</>
	);
}
