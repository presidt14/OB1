---
name: ob1-sync-check
description: Use when Trevor asks about OpenBrain/OB1 repo status, whether his fork is up to date, out of sync, behind upstream, or whether he needs to pull/merge upstream changes — e.g. "check my openbrain status", "am I behind upstream", "sync OB1".
---

# OB1 Sync Check

Check whether Trevor's OpenBrain fork is current, and advise (don't auto-execute) a sync. Repo: local `P:\OpenBrain-linked` → fork `presidt14/OB1` (origin) → upstream `NateBJones-Projects/OB1`.

## Steps (all read-only until Trevor approves a sync)

1. **Fetch and compare** (PowerShell, in `P:\OpenBrain-linked`):
   ```
   git fetch origin; git fetch upstream
   git status --short                                    # local dirt / untracked
   git rev-list --left-right --count main...origin/main  # vs fork
   git rev-list --left-right --count main...upstream/main # ahead<TAB>behind
   ```
2. **If behind upstream, assess the incoming changes:**
   ```
   git log --oneline main..upstream/main
   git diff --stat main...upstream/main
   git merge-tree --write-tree --name-only main upstream/main   # conflict dry-run
   ```
   Check overlap with fork-owned paths: `supabase/`, `server/index.ts`, `integrations/mcp-oauth-proxy/`, `.github/workflows/supabase-keepalive.yml`, `skills/compliance-risk-digest/`.
3. **Backend health:** call Open Brain MCP `thought_stats` — confirm the store responds and the date range reaches ~today (keep-alive working; see keep-alive failure mode in project memory `openbrain-ops.md`).
4. **Keep-alive workflow:** `gh run list -R presidt14/OB1 --workflow supabase-keepalive.yml -L 3` — recent successful runs expected (daily 06:23 UTC).

## Recommend sync when

- Behind upstream AND merge-tree dry run is clean → recommend `git merge upstream/main` + push (low risk).
- Upstream touches fork-owned paths or dry run conflicts → recommend a careful merge session, list the conflicting files first.
- Only docs/README churn upstream (< ~5 commits) → fine to defer; say so.
- After any merge: verify `git rev-list --left-right --count main...upstream/main` shows `N 0`, then `git push origin main`. Upstream changes to `recipes/`, `schemas/`, `skills/`, docs never require redeploying Supabase Edge Functions; changes under `supabase/functions/` do — flag those explicitly.

## Gotchas

- `brain locate` does not know this repo — go straight to `P:\OpenBrain-linked`.
- GitHub MCP often fails to connect; use `gh` CLI instead.
- Fork's "Deploy landing page" workflow is intentionally disabled (2026-09-06); don't re-enable when syncing.
- Report ahead/behind counts and a recommendation; only execute the merge when Trevor says yes.
