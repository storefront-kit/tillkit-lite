#!/usr/bin/env bash
# Run by .github/workflows/tillkit-update.yml. Compares this store's version (package.json)
# with Tillkit's latest release, then opens a pull request with exactly what changed between
# the two releases. Your own edits stay as they are; if a change can't be applied cleanly,
# it opens an issue with a link to the changes instead.
set -euo pipefail

if grep -q "const EDITION = 'lite'" src/config.js; then UPSTREAM=storefront-kit/tillkit-lite; else UPSTREAM=storefront-kit/storefront-kit; fi
URL="https://github.com/$UPSTREAM.git"
if [ "$UPSTREAM" = storefront-kit/storefront-kit ]; then
  if [ -z "${UPSTREAM_TOKEN:-}" ]; then
    echo "::warning::Add a TILLKIT_GITHUB_TOKEN secret so this can read the Tillkit Full repository (see Updating in README.md)."
    exit 0
  fi
  URL="https://x-access-token:${UPSTREAM_TOKEN}@github.com/$UPSTREAM.git"
fi

URL="${TILLKIT_UPSTREAM_URL:-$URL}" # for testing
HAVE=$(node -p "require('./package.json').version")
git fetch --quiet --no-tags "$URL" '+refs/heads/main:refs/remotes/tillkit/main'
ver() { git show "$1:package.json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).version))"; }
LATEST=$(ver tillkit/main)
NEWEST=$(printf '%s\n%s\n' "$HAVE" "$LATEST" | sort -V | tail -1)
if [ "$LATEST" = "$HAVE" ] || [ "$NEWEST" = "$HAVE" ]; then echo "Up to date ($HAVE)."; exit 0; fi
# The Tillkit release this copy is based on: the newest Tillkit commit with this copy's version.
BASE=""
for c in $(git rev-list tillkit/main); do if [ "$(ver "$c")" = "$HAVE" ]; then BASE=$c; break; fi; done

BRANCH="tillkit-update-$LATEST"
TITLE="Update Tillkit to $LATEST"
COMPARE="https://github.com/$UPSTREAM/commits/main"
if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then echo "$BRANCH already exists; review its pull request."; exit 0; fi

open_issue() {
  if [ -z "$(gh issue list --state open --search "\"$TITLE\" in:title" --json number --jq '.[].number')" ]; then
    gh issue create --title "$TITLE" --body "Tillkit $LATEST is available (you have $HAVE). $1

What changed: $COMPARE

You can update by hand, or open this repository in Claude Code (or any AI coding assistant) and ask it to apply the changes from that link, then run \`npm test\`."
  fi
}

if [ -z "$BASE" ]; then
  open_issue "This copy's version ($HAVE) isn't a Tillkit release, so the changes couldn't be worked out automatically."
  exit 0
fi

git config user.name "Tillkit updates"
git config user.email "updates@tillkit.shop"
git checkout -q -b "$BRANCH"
# Workflow files can't be changed from a workflow, so they're left out of the automatic update.
git diff --binary "$BASE" tillkit/main -- . ':(exclude).github/workflows' > /tmp/tillkit.patch
if ! git apply --3way --index /tmp/tillkit.patch; then
  git reset -q --hard && git checkout -q -
  open_issue "Some of the changes overlap with edits made in this copy, so they need to be merged by hand."
  exit 0
fi
git commit -q -m "$TITLE"
git push -q origin "$BRANCH"
if ! gh pr create --head "$BRANCH" --title "$TITLE" --body "Tillkit $LATEST (you have $HAVE).

What changed: $COMPARE

Before merging: check the changes, and that the tests pass (\`npm test\`). Merging redeploys your store on Railway."; then
  open_issue "A branch named $BRANCH has the changes, but a pull request couldn't be opened. Allow it under Settings → Actions → General → \"Allow GitHub Actions to create and approve pull requests\", or open one from that branch yourself."
fi
