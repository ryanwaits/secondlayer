"use client";

import { CopyButton } from "@/components/copy-button";

export function SkillBar({
  command = "npx skills add ryanwaits/secondlayer --skill secondlayer",
}: {
  command?: string;
}) {
  return (
    <div className="skill-bar">
      <span className="skill-bar-label">skill</span>
      <span className="skill-bar-cmd">{command}</span>
      <CopyButton code={command} />
    </div>
  );
}
