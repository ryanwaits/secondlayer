import { redirect } from "next/navigation";
import { STORY_INDEX } from "../tree";

export default function LabIndexPage() {
	redirect(`/lab/components/${STORY_INDEX[0].id}`);
}
