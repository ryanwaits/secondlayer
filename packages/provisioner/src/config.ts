/**
 * Provisioner runtime configuration — parsed once at startup.
 *
 * All sensitive values (source DB admin creds, shared secret) come from env;
 * this module fails fast if any required value is missing.
 *
 * SECURITY NOTE — provisioner network reachability:
 * Tenant API + processor containers join `sl-tenants`, and the provisioner
 * is also on `sl-tenants` (per `docker-compose.hetzner.yml` — needed so the
 * provisioner can reach `sl-pg-{slug}` for storage measurement). That means
 * a malicious subgraph handler with outbound HTTP can fetch
 * `http://provisioner:3850/...` and trip our auth. The shared
 * `PROVISIONER_SECRET` is the only thing standing between that traffic and
 * a `DELETE /tenants/:slug?deleteVolume=true`. The `requireStrongSecret`
 * gate below ensures the secret is meaningful; the proper fix (move
 * provisioner to its own `sl-control` network with tenant PGs joined to
 * both, so tenant API/processor can't see the provisioner at all) is a
 * larger refactor tracked separately.
 */

export interface ProvisionerConfig {
	/** Port the provisioner HTTP API listens on. */
	port: number;
	/** Shared secret required on every inbound API request. */
	secret: string;
	/**
	 * Admin credentials for the shared source indexer DB. Provisioner uses
	 * this to bootstrap the readonly role on startup.
	 */
	sourceDbAdminUrl: string;
	/**
	 * Password for the readonly role on the source DB. Rotatable via
	 * provisioner restart; tenant containers get URLs built from it.
	 */
	sourceDbReadonlyPassword: string;
	/** Host + port (without scheme) of the source DB as seen from tenant containers. */
	sourceDbHost: string;
	/** Name of the source DB (both admin + readonly connect here). */
	sourceDbName: string;
	/** Docker image tag to pull for tenant containers (`latest`, `v1.0.0`, etc.). */
	imageTag: string;
	/** GHCR owner — `ghcr.io/{owner}/secondlayer-{service}:{tag}`. */
	imageOwner: string;
	/** Base domain for tenant public URLs (`https://{slug}.{base}`). */
	tenantBaseDomain: string;
	/** Stacks node RPC URL injected into tenant API/processor containers. */
	stacksNodeRpcUrl: string;
	/** Optional Hiro API base URL injected into tenant API/processor containers. */
	hiroApiUrl: string | null;
	/** Optional Hiro API key injected into tenant API/processor containers. */
	hiroApiKey: string | null;
	/** AES-GCM key for tenant/runtime secret encryption. */
	secretsKey: string;
	/** Docker Engine API socket path. */
	dockerSocketPath: string;
}

function required(name: string): string {
	const v = process.env[name];
	if (!v || v.trim() === "") {
		throw new Error(`Missing required env var: ${name}`);
	}
	return v;
}

/**
 * Refuse to boot if `PROVISIONER_SECRET` is shorter than 32 characters or
 * looks like a placeholder. The secret is the only auth between platform
 * API and provisioner; a weak secret + a tenant container that can reach
 * `provisioner:3850` is a full container-control compromise. 32 chars of
 * random bytes is the bar; explicitly reject obvious dev defaults so a
 * forgotten override can't ship to prod.
 */
function requireStrongSecret(name: string): string {
	const v = required(name);
	if (v.length < 32) {
		throw new Error(
			`${name} is too short (${v.length} chars). Use 32+ random bytes — \`openssl rand -hex 32\`.`,
		);
	}
	const lc = v.toLowerCase();
	if (
		lc === "secret" ||
		lc === "changeme" ||
		lc === "insecure" ||
		lc.startsWith("dev-")
	) {
		throw new Error(
			`${name} looks like a placeholder (${v.slice(0, 8)}…). Generate a real one — \`openssl rand -hex 32\`.`,
		);
	}
	return v;
}

function optional(name: string, fallback: string): string {
	const v = process.env[name];
	return v && v.trim() !== "" ? v : fallback;
}

function optionalNullable(name: string): string | null {
	const v = process.env[name];
	return v && v.trim() !== "" ? v : null;
}

let cached: ProvisionerConfig | null = null;

export function getConfig(): ProvisionerConfig {
	if (cached) return cached;
	cached = {
		port: Number.parseInt(optional("PROVISIONER_PORT", "3850"), 10),
		secret: requireStrongSecret("PROVISIONER_SECRET"),
		sourceDbAdminUrl: required("PROVISIONER_SOURCE_DB_ADMIN_URL"),
		sourceDbReadonlyPassword: required(
			"PROVISIONER_SOURCE_DB_READONLY_PASSWORD",
		),
		sourceDbHost: optional("PROVISIONER_SOURCE_DB_HOST", "sl-pg-source:5432"),
		sourceDbName: optional("PROVISIONER_SOURCE_DB_NAME", "secondlayer"),
		imageTag: optional("PROVISIONER_IMAGE_TAG", "latest"),
		imageOwner: optional("PROVISIONER_IMAGE_OWNER", "secondlayer-labs"),
		tenantBaseDomain: optional(
			"PROVISIONER_TENANT_BASE_DOMAIN",
			"secondlayer.tools",
		),
		stacksNodeRpcUrl: required("STACKS_NODE_RPC_URL"),
		hiroApiUrl: optionalNullable("HIRO_API_URL"),
		hiroApiKey: optionalNullable("HIRO_API_KEY"),
		secretsKey: required("SECONDLAYER_SECRETS_KEY"),
		dockerSocketPath: optional("DOCKER_SOCKET", "/var/run/docker.sock"),
	};
	return cached;
}

export function resetConfigForTests(): void {
	cached = null;
}

/** Image name for a tenant service. */
export function imageName(
	cfg: ProvisionerConfig,
	service: "api" | "indexer",
): string {
	return `ghcr.io/${cfg.imageOwner}/secondlayer-${service}:${cfg.imageTag}`;
}
