#!/bin/sh
# secondlayer Claude Code skill installer — https://secondlayer.tools
#   curl -fsSL https://secondlayer.tools/skill.sh | bash
# Installs the secondlayer skill into ~/.claude/skills so Claude Code can
# build against Streams, Index, Subgraphs, Subscriptions, and the SDK.
set -eu

RAW="https://raw.githubusercontent.com/ryanwaits/secondlayer/main/skills/secondlayer"
DEST="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}/secondlayer"

mkdir -p "$DEST/references"

echo "Installing the secondlayer skill to ${DEST}…"
curl -fsSL "$RAW/SKILL.md" -o "$DEST/SKILL.md"

for ref in api-rest cli index-quickstart installation mcp sdk \
	stacks-extensions stacks subgraph-authoring troubleshooting; do
	curl -fsSL "$RAW/references/${ref}.md" -o "$DEST/references/${ref}.md"
done

echo "Installed. Claude Code picks it up on the next session."
