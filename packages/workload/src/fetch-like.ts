/**
 * A minimal fetch signature for dependency injection, matching
 * `@secondlayer/sdk`'s `FetchLike` (`sdk/src/base.ts`). `typeof fetch`
 * itself pulls in overload noise (e.g. `preconnect`) that makes a plain
 * `async (url, init) => Response` stub fail to type-check at every call
 * site — this is the same fetch, minus that noise.
 */
export type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;
