# Open Brain

A vendor-independent memory layer — capture thoughts via Slack, query them semantically via a hosted MCP server that any AI assistant can connect to.

## Architecture

```
Slack message → ingest-thought (Edge Fn) → Supabase (pgvector) ← open-brain-mcp (Edge Fn) ← AI assistants
```

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) installed and logged in
- A Supabase project created and linked
- An [OpenRouter](https://openrouter.ai) API key
- A Slack app with `chat:write` and `channels:history` bot scopes

## Deploy Steps

### 1. Link your Supabase project
```powershell
cd C:\Users\TP\.gemini\antigravity\scratch\open-brain
supabase link --project-ref YOUR_PROJECT_REF
```

### 2. Run the database migration
```powershell
supabase db push
```

### 3. Set secrets
```powershell
supabase secrets set `
  OPENROUTER_API_KEY=sk-or-... `
  SLACK_BOT_TOKEN=xoxb-... `
  SLACK_CAPTURE_CHANNEL=C0XXXXXXXXX `
  MCP_ACCESS_KEY=your-random-secret-key
```
> `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by Supabase.

### 4. Deploy both Edge Functions
```powershell
supabase functions deploy ingest-thought
supabase functions deploy open-brain-mcp
```

### 5. Configure Slack
- In your Slack app dashboard → **Event Subscriptions**
- Enable events and set the **Request URL** to:
  `https://YOUR_PROJECT_REF.supabase.co/functions/v1/ingest-thought`
- Subscribe to the `message.channels` bot event
- Invite your bot to your capture channel

### 6. Connect an AI assistant to the MCP server
Add this to your AI tool's MCP config (e.g. Claude Desktop, Cursor):
```json
{
  "mcpServers": {
    "open-brain": {
      "url": "https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp",
      "headers": {
        "x-brain-key": "your-random-secret-key"
      }
    }
  }
}
```

## MCP Tools available to AI assistants

| Tool | Description |
|------|-------------|
| `search_thoughts` | Semantic search across all captured thoughts |
| `capture_thought` | Save a new thought directly from the AI assistant |

## File Structure

```
open-brain/
├── PLAN.md
├── README.md
├── .env.example
└── supabase/
    ├── migrations/
    │   └── 0000_setup.sql          # pgvector schema + match_thoughts RPC
    └── functions/
        ├── ingest-thought/
        │   └── index.ts            # Slack webhook → embed → store
        └── open-brain-mcp/
            ├── deno.json           # Import map
            └── index.ts            # MCP server (search + capture)
```
