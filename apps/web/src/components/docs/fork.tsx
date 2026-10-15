import { Choice } from "@/components/choice";
import {
	Children,
	type ReactElement,
	type ReactNode,
	isValidElement,
} from "react";

type ForkPathProps = { value: string; label: string; children?: ReactNode };

/** One answer to a `<Fork>`: the code and prose that follow if it is chosen. */
export function ForkPath({ children }: ForkPathProps) {
	return <>{children}</>;
}

/**
 * A question whose answer swaps the code you would write. Radios plus CSS
 * `:has()` show the chosen path, so it works without script. Paths are
 * `<ForkPath value label>` children (up to four); the first is chosen first.
 * Content goes in children so the markdown twin keeps it.
 */
export function Fork({
	question,
	name,
	children,
}: { question: string; name: string; children?: ReactNode }) {
	const paths = Children.toArray(children).filter(
		(c): c is ReactElement<ForkPathProps> =>
			isValidElement(c) && c.type === ForkPath,
	);
	const first = paths[0]?.props.value;
	const askId = `${name}-ask`;
	return (
		<div className="docs-fork">
			<p className="docs-fork-ask" id={askId}>
				{question}
			</p>
			<Choice
				name={name}
				labelledBy={askId}
				options={paths.map((p) => ({
					value: p.props.value,
					label: p.props.label,
				}))}
				defaultValue={first}
			/>
			{paths.map((p) => (
				<div
					key={p.props.value}
					className="docs-fork-path"
					data-path={p.props.value}
				>
					{p.props.children}
				</div>
			))}
		</div>
	);
}
