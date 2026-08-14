#!/bin/sh
# secondlayer CLI installer — https://secondlayer.tools
#   curl -fsSL https://secondlayer.tools/install.sh | bash
# Installs @secondlayer/cli globally with whichever package manager you have
# (bun, then pnpm, then npm) and verifies the binary.
set -eu

PKG="@secondlayer/cli"

have() { command -v "$1" >/dev/null 2>&1; }

if have bun; then
	echo "Installing ${PKG} with bun…"
	bun add -g "$PKG"
elif have pnpm; then
	echo "Installing ${PKG} with pnpm…"
	pnpm add -g "$PKG"
elif have npm; then
	echo "Installing ${PKG} with npm…"
	npm install -g "$PKG"
else
	echo "No supported package manager found (bun, pnpm, or npm)." >&2
	echo "Install one, then re-run — for bun: curl -fsSL https://bun.sh/install | bash" >&2
	exit 1
fi

if have secondlayer; then
	echo ""
	secondlayer --version
	echo "Installed. Start with: secondlayer init --network mainnet"
else
	echo "Installed, but 'secondlayer' is not on PATH yet — open a new shell." >&2
fi
