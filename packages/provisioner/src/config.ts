/**
 * Provisioner runtime configuration — parsed once at startup.
 *
 * All sensitive values (source DB admin creds, shared secret) come from env;
 * this module fails fast if any required value is missing.
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

function optional(name: string, fallback: string): string {
	const v = process.env[name];
	return v && v.trim() !== "" ? v : fallback;
}

let cached: ProvisionerConfig | null = null;

export function getConfig(): ProvisionerConfig {
	if (cached) return cached;
	cached = {
		port: Number.parseInt(optional("PROVISIONER_PORT", "3850"), 10),
		secret: required("PROVISIONER_SECRET"),
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
		dockerSocketPath: optional("DOCKER_SOCKET", "/var/run/docker.sock"),
	};
	return cached;
}

/** Image name for a tenant service. */
export function imageName(
	cfg: ProvisionerConfig,
	service: "api" | "indexer",
): string {
	return `ghcr.io/${cfg.imageOwner}/secondlayer-${service}:${cfg.imageTag}`;
}
