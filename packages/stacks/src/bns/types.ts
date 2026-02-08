export interface FullyQualifiedName {
  name: string;
  namespace: string;
}

export interface NameInfo {
  owner: string;
  registeredAt: bigint | null;
  renewalHeight: bigint;
  stxBurn: bigint;
  importedAt: bigint | null;
  preorderedBy: string | null;
}

export interface ResolveNameResult {
  owner: string;
  renewal: bigint;
}

export interface ClaimFastParams {
  name: string;
  namespace?: string;
  recipient: string;
}

export interface TransferParams {
  name: string;
  namespace?: string;
  recipient: string;
}

export interface SetPrimaryParams {
  name: string;
  namespace?: string;
}

export interface PreorderParams {
  name: string;
  namespace?: string;
  salt?: Uint8Array; // Optional - auto-generated if not provided
}

export interface RegisterParams {
  name: string;
  namespace?: string;
  salt: Uint8Array; // Required - must match preorder salt
}

export interface UpdateZonefileParams {
  name: string;
  namespace?: string;
  zonefile: string | Uint8Array | null; // null to clear zonefile
}
