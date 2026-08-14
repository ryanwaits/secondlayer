"use client";

import type { InstanceMeta } from "@/components/console/sidebar";
import { createContext, useContext } from "react";

/**
 * Server-resolved instance identity (`/v1/instance` + `/health`), threaded to
 * client chrome — the topbar's network chip reads it without fetching. Null
 * fields mean the runtime was unreachable; consumers hide, not fabricate.
 */
const InstanceMetaCtx = createContext<InstanceMeta>({
	network: null,
	mode: null,
	imageSha: null,
	instanceId: null,
});

export function useInstanceMeta(): InstanceMeta {
	return useContext(InstanceMetaCtx);
}

export function InstanceMetaProvider({
	meta,
	children,
}: {
	meta: InstanceMeta;
	children: React.ReactNode;
}) {
	return (
		<InstanceMetaCtx.Provider value={meta}>{children}</InstanceMetaCtx.Provider>
	);
}
