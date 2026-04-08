/** Execute a generic user function step. */
export async function executeRunStep<T>(fn: () => Promise<T>): Promise<T> {
	return await fn();
}
