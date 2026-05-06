"use client";

import type { ApiKey, ApiKeyProduct, ApiKeyTier } from "@/lib/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "./fetch";
import { queryKeys } from "./keys";

export type CreateApiKeyInput = {
	name?: string;
	product?: ApiKeyProduct;
	tier?: ApiKeyTier;
};

export function useApiKeys(initialData?: ApiKey[]) {
	return useQuery({
		queryKey: queryKeys.keys.all,
		queryFn: () =>
			fetchJson<{ keys: ApiKey[] }>("/api/keys").then((r) => r.keys ?? []),
		initialData,
		staleTime: 60_000,
	});
}

export function useRevokeApiKey() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (keyId: string) =>
			fetchJson(`/api/keys/${keyId}`, { method: "DELETE" }),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.keys.all });
		},
	});
}

export function useCreateApiKey() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: CreateApiKeyInput | undefined) =>
			fetchJson<{
				key: string;
				id: string;
				prefix: string;
				product: ApiKeyProduct;
				tier: ApiKeyTier | null;
				createdAt: string;
			}>("/api/keys", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: input?.name || undefined,
					product: input?.product ?? "account",
					tier: input?.tier,
				}),
			}),
		onSuccess: (data, input) => {
			const newKey: ApiKey = {
				id: data.id,
				prefix: data.prefix,
				name: input?.name || "",
				status: "active",
				product: data.product,
				tier: data.tier,
				createdAt: data.createdAt,
				lastUsedAt: null,
			};
			qc.setQueryData<ApiKey[]>(queryKeys.keys.all, (old) =>
				old ? [newKey, ...old] : [newKey],
			);
			qc.invalidateQueries({ queryKey: queryKeys.keys.all });
		},
	});
}
