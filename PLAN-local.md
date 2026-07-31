# Open Brain Architecture Plan

We are building a vendor-independent memory layer (Postgres database) that all AI assistants can query via a hosted Model Context Protocol (MCP) server.

## Tech Stack

* **Database**: Supabase (Postgres with pgvector).
* **AI Gateway**: OpenRouter (text-embedding-3-small, gpt-4o-mini).
* **Compute**: Supabase Edge Functions (Deno/TypeScript).
* **Interface**: Slack private channel webhook.

## Agent Instructions

1. Review the SQL in `supabase/migrations/0000_setup.sql`.
2. Review the Capture pipeline in `supabase/functions/ingest-thought/index.ts`.
3. Review the MCP server in `supabase/functions/open-brain-mcp/index.ts`.
4. Help the user deploy these to their linked Supabase project using the Supabase CLI.
