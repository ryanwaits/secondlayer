/** The fade ends once the visitor is on a different page than the one that streamed. */
export function shouldEndStreamed(initial: string, current: string): boolean {
	return initial !== current;
}
