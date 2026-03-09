import type {
  SearchContractsResponse,
  ContractDetail,
} from "@secondlayer/shared/schemas";
import { BaseClient } from "../base.ts";

export class Contracts extends BaseClient {
  async search(
    query: string,
    params?: { limit?: number; offset?: number },
  ): Promise<SearchContractsResponse> {
    const qs = new URLSearchParams({ q: query });
    if (params?.limit !== undefined) qs.set("limit", String(params.limit));
    if (params?.offset !== undefined) qs.set("offset", String(params.offset));
    return this.request<SearchContractsResponse>("GET", `/api/contracts?${qs}`);
  }

  async get(contractId: string): Promise<ContractDetail> {
    return this.request<ContractDetail>("GET", `/api/contracts/${contractId}`);
  }

  async getAbi(contractId: string): Promise<unknown> {
    return this.request<unknown>("GET", `/api/contracts/${contractId}/abi`);
  }
}
