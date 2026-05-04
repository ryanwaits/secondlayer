declare module "cssstudio" {
	export function startStudio(options?: {
		mcpPort?: number;
		debug?: boolean;
		defaultSettings?: unknown;
		breakpoints?: unknown;
	}): () => void;
}
