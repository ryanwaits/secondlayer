import { sql, type Kysely } from "kysely";
import type { Database, Contract } from "../types.ts";

export async function searchContracts(
  db: Kysely<Database>,
  query: string,
  limit: number,
  offset: number,
): Promise<{ contracts: Contract[]; total: number }> {
  const pattern = `%${query}%`;

  const contracts = await db
    .selectFrom("contracts")
    .selectAll()
    .where((eb) =>
      eb.or([
        eb("name", "ilike", pattern),
        eb("contract_id", "ilike", pattern),
      ]),
    )
    .orderBy("call_count", "desc")
    .limit(limit)
    .offset(offset)
    .execute();

  const countResult = await db
    .selectFrom("contracts")
    .select(sql<number>`count(*)`.as("count"))
    .where((eb) =>
      eb.or([
        eb("name", "ilike", pattern),
        eb("contract_id", "ilike", pattern),
      ]),
    )
    .executeTakeFirst();

  return { contracts, total: Number(countResult?.count ?? 0) };
}

export async function getContract(
  db: Kysely<Database>,
  contractId: string,
): Promise<Contract | null> {
  return (
    (await db
      .selectFrom("contracts")
      .selectAll()
      .where("contract_id", "=", contractId)
      .executeTakeFirst()) ?? null
  );
}

export async function cacheContractAbi(
  db: Kysely<Database>,
  contractId: string,
  abi: unknown,
): Promise<void> {
  await db
    .updateTable("contracts")
    .set({
      abi: JSON.stringify(abi),
      abi_fetched_at: new Date(),
      updated_at: new Date(),
    })
    .where("contract_id", "=", contractId)
    .execute();
}
