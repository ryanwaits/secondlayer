import { BaseClient, type SecondLayerOptions } from "../base.ts";

/**
 * Typed client for project management (`/api/projects/*`).
 *
 * Projects are the account-scoped containers for work. Every method requires an
 * account-level (owner) API key or a dashboard session — scoped read keys are
 * rejected. Team mutations (invite/remove/role) are intentionally not exposed
 * here; only the read view ({@link Projects.team}) is.
 */

export interface Project {
	id: string;
	name: string;
	slug: string;
	network: string;
	nodeRpc: string | null;
	settings: Record<string, unknown> | null;
	createdAt: string;
	updatedAt: string;
}

export interface ProjectTeamMember {
	id: string;
	role: string;
	email: string;
	displayName: string | null;
	avatarUrl: string | null;
	createdAt: string;
}

export interface ProjectInvitation {
	id: string;
	email: string;
	role: string;
	expiresAt: string;
	createdAt: string;
}

export interface ProjectTeam {
	members: ProjectTeamMember[];
	invitations: ProjectInvitation[];
}

export interface CreateProjectParams {
	name: string;
	slug?: string;
	network?: string;
	nodeRpc?: string;
}

export interface UpdateProjectParams {
	name?: string;
	/** Rename the project's URL slug. */
	slug?: string;
	network?: string;
	nodeRpc?: string;
	settings?: Record<string, unknown>;
}

export class Projects extends BaseClient {
	constructor(options: Partial<SecondLayerOptions> = {}) {
		super(options);
	}

	/** All projects owned by the account, newest-relevant first. */
	list(): Promise<{ projects: Project[] }> {
		return this.request<{ projects: Project[] }>("GET", "/api/projects");
	}

	/** A single project by slug. */
	get(slug: string): Promise<Project> {
		return this.request<Project>("GET", `/api/projects/${slug}`);
	}

	/** Create a project. The creator is added as the project owner. */
	create(params: CreateProjectParams): Promise<Project> {
		return this.request<Project>("POST", "/api/projects", params);
	}

	/** Update a project's name, slug (rename), network, RPC, or settings. */
	update(slug: string, patch: UpdateProjectParams): Promise<Project> {
		return this.request<Project>("PATCH", `/api/projects/${slug}`, patch);
	}

	/** Delete a project. The account's last remaining project cannot be deleted. */
	delete(slug: string): Promise<{ ok: true }> {
		return this.request<{ ok: true }>("DELETE", `/api/projects/${slug}`);
	}

	/** Team members and pending invitations for a project. */
	team(slug: string): Promise<ProjectTeam> {
		return this.request<ProjectTeam>("GET", `/api/projects/${slug}/team`);
	}
}
