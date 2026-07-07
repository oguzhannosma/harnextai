#!/bin/sh
# Index-staleness check: warns when many files changed since the last Indexer
# run. Re-indexing stays a deliberate act — run /index in Claude Code.
# The Indexer records the commit it indexed at in .harness/last-index-commit
# (the same marker `harness doctor` checks; threshold matches its 25).
MARKER=".harness/last-index-commit"
THRESHOLD=25

if [ ! -f "$MARKER" ]; then
  echo "harness: project index has never been built — run /index in Claude Code."
  exit 0
fi

LAST=$(cat "$MARKER" | tr -d '[:space:]')
if ! git rev-parse --quiet --verify "$LAST^{commit}" >/dev/null 2>&1; then
  echo "harness: index marker points at unknown commit — run /index to rebuild."
  exit 0
fi

CHANGED=$(git diff --name-only "$LAST"..HEAD | grep -v '^\.harness/' | wc -l | tr -d '[:space:]')
if [ "$CHANGED" -gt "$THRESHOLD" ]; then
  echo "harness: $CHANGED files changed since the last index run (threshold $THRESHOLD) — the project index is stale. Run /index in Claude Code."
fi
exit 0
