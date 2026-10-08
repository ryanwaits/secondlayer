import { ClassifierInputError, type Question } from "./types.ts";

// Strictest common limits across jev, kev and clef.
export const MAX_QUESTIONS = 64;
export const MIN_CHOICE = 2;
export const MAX_CHOICE = 255;
export const MIN_SCORE = 2;
export const MAX_SCORE = 10;
export const QUESTION_ID = /^[A-Za-z0-9_.-]{1,100}$/;
export const MAX_STATE_CHARS = 24_000;

/** A bad question definition is a programmer bug: throw, never fail open. */
export function validateQuestions(questions: Record<string, Question>): void {
	const ids = Object.keys(questions);
	if (ids.length === 0) throw new ClassifierInputError("no questions");
	if (ids.length > MAX_QUESTIONS) {
		throw new ClassifierInputError(`more than ${MAX_QUESTIONS} questions`);
	}
	for (const id of ids) {
		if (!QUESTION_ID.test(id)) {
			throw new ClassifierInputError(`invalid question id: ${id}`);
		}
		const q = questions[id] as Question;
		if (q.type === "choice") {
			const n = Object.keys(q.criteria).length;
			if (n < MIN_CHOICE || n > MAX_CHOICE) {
				throw new ClassifierInputError(
					`question ${id}: choice needs ${MIN_CHOICE}-${MAX_CHOICE} options`,
				);
			}
		} else if (q.type === "score") {
			const n = q.criteria.length;
			if (n < MIN_SCORE || n > MAX_SCORE) {
				throw new ClassifierInputError(
					`question ${id}: score needs ${MIN_SCORE}-${MAX_SCORE} levels`,
				);
			}
		} else if (q.type !== "boolean") {
			throw new ClassifierInputError(`question ${id}: unknown type`);
		}
	}
}

export function stateSize(state: string | Record<string, unknown>): number {
	return typeof state === "string"
		? state.length
		: JSON.stringify(state).length;
}
