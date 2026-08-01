/**
 * Writings figure library — see FIGURES.md for the tier taxonomy and
 * when-to-use lines, and /writing/figures for the live catalog. Posts
 * import figures explicitly (never via the global MDX map, which would
 * put client figures on every docs bundle).
 */
export { FigShell } from "./fig-shell";
export { mergeMarkers, resolveEndLabels, clampTooltipX } from "./collide";

// A — text-first
export { StatTile, type StatTileItem } from "./stat-tile";
export { TermPair } from "./term-pair";
export { Matrix, type MatrixCell } from "./matrix";
export { AnnotatedPayload, type PayloadSegment } from "./annotated-payload";
export { Sidenote } from "./sidenote";
export { AnnotatedCode } from "./annotated-code";
export { CodeDiff, type DiffLine } from "./code-diff";
export { InvariantList, type Invariant } from "./invariant-list";
export { Term } from "./term";
export { SpecSheet } from "./spec-sheet";
export { SourceQuote } from "./source-quote";

// B — diagrams
export {
	PositionTrack,
	type TrackMarker,
	type TrackState,
} from "./position-track";
export { FlowLoop } from "./flow-loop";
export { Timeline, type TimelineEvent } from "./timeline";
export {
	Lifecycle,
	type LifecycleEdge,
	type LifecycleNode,
	type LifecycleStep,
} from "./lifecycle";
export { PipelineFlow } from "./pipeline-flow";
export { SequenceDiagram } from "./sequence-diagram";
export { LayerStack, type Layer } from "./layer-stack";
export { TreeWalk, type TreeEdge, type TreeNode } from "./tree-walk";
export { BeforeAfter, type BaMarker, type BaState } from "./before-after";
export { StateRow, type RowState } from "./state-row";

// C — charts
export { LineChart, type LineSeries } from "./line-chart";
export { BarChart } from "./bar-chart";
export { SmallMultiples } from "./small-multiples";
export { CellStrip } from "./cell-strip";
export { Distribution } from "./distribution";
export { DeltaBars, type DeltaGroup } from "./delta-bars";
export { InlineSpark } from "./inline-spark";
export { HeatCalendar } from "./heat-calendar";

// D — explorers (D6 MiniSandbox deferred: dataset-sandbox was removed
// from production; the slot stays reserved until a post needs it)
export { ParamExplorer } from "./param-explorer";
export { PointerStrip, type StripPointer } from "./pointer-strip";
export { ScenarioToggle } from "./scenario-toggle";
export { StepThrough, type Step } from "./step-through";
export { Predict } from "./predict";
export { CrossHighlight, type CrossSegment } from "./cross-highlight";
export { CopyBlock } from "./copy-block";
