# Compliance Risk Digest

> Weekly diff-style compliance risk digest for a monitored client portfolio, with memory-driven scope and a draft-only boundary.

## What It Does

Turns raw compliance-monitoring data (violations, trends, affiliate rankings) into a change-first weekly digest. Scope and format preferences live in the user's Open Brain, so the skill file stays generic and portable across AI clients; the boundary is hard-coded: the agent drafts recommendations, a human approves actions.

## Supported Clients

- Claude Desktop / Cowork (tested)
- Claude Code
- Any MCP client with access to Open Brain plus a compliance-monitoring MCP

## Prerequisites

- Working Open Brain setup ([guide](../../docs/01-getting-started.md))
- A compliance-monitoring MCP exposing per-client snapshot, month-over-month, and affiliate-risk-ranking tools (built against Rightlander-style tooling; adapt tool names as needed)

## Installation

1. Copy `SKILL.md` into your client's reusable-instructions location
2. Reload the client
3. Say "run my compliance digest" — first run will ask for scope and capture it to Open Brain

## Trigger Conditions

- "compliance digest", "weekly risk digest", "risk roundup"
- A scheduled weekly task pointing at this skill

## Expected Outcome

A dated markdown digest (headline, biggest movers, cross-client repeat offenders, new critical exposure, draft recommendations tagged `[NEEDS APPROVAL]`) saved as a receipt in a local non-committed folder.

## Troubleshooting

**Issue: Digest covers the wrong clients**
Solution: Update the preference thought in Open Brain ("compliance risk digest preferences") — the skill reads scope from memory, not from the skill file.

**Issue: No preferences found on first run**
Solution: Expected — answer the scope questions and the skill captures them for future runs.

**Issue: Numbers look stale**
Solution: The skill is read-only against the monitoring platform; re-run after the platform's next scan cycle.

## Notes for Other Clients

Authored for Claude. For Codex/Cursor, keep Steps 1–4 intact and map the tool names to your MCP's equivalents; the memory-first pattern (Step 1) is the part that must not be dropped.
