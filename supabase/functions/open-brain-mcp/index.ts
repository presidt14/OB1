import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function getEmbedding(text: string): Promise<number[]> {
    const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "openai/text-embedding-3-small",
            input: text,
        }),
    });
    if (!r.ok) {
        const msg = await r.text().catch(() => "");
        throw new Error(`OpenRouter embeddings failed: ${r.status} ${msg}`);
    }
    const d = await r.json();
    return d.data[0].embedding;
}

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
    const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "openai/gpt-4o-mini",
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there.`,
                },
                { role: "user", content: text },
            ],
        }),
    });
    const d = await r.json();
    try {
        return JSON.parse(d.choices[0].message.content);
    } catch {
        return { topics: ["uncategorized"], type: "observation" };
    }
}

// --- MCP Server Setup ---
const server = new McpServer({
    name: "open-brain",
    version: "1.0.0",
});

// Tool 1: Semantic Search
server.registerTool(
    "search_thoughts",
    {
        title: "Search Thoughts",
        description: "Search captured thoughts by meaning.",
        inputSchema: {
            query: z.string().describe("What to search for"),
            limit: z.number().optional().default(10),
            threshold: z.number().optional().default(0.5),
        },
    },
    async ({ query, limit, threshold }) => {
        try {
            const qEmb = await getEmbedding(query);
            const { data, error } = await supabase.rpc("match_thoughts", {
                query_embedding: qEmb,
                match_threshold: threshold,
                match_count: limit,
                filter: {},
            });

            if (error || !data || data.length === 0) {
                return { content: [{ type: "text" as const, text: error ? `Error: ${error.message}` : `No results for "${query}".` }] };
            }

            const results = data.map((t: any, i: number) => {
                const m = t.metadata || {};
                return `Result ${i + 1}:\nType: ${m.type || "unknown"}\n${t.content}`;
            });

            return { content: [{ type: "text" as const, text: results.join("\n\n") }] };
        } catch (err: any) {
            return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
        }
    }
);

// Tool 2: Capture Thought
server.registerTool(
    "capture_thought",
    {
        title: "Capture Thought",
        description: "Save a new thought to the Open Brain.",
        inputSchema: { content: z.string() },
    },
    async ({ content }) => {
        try {
            const [embedding, metadata] = await Promise.all([getEmbedding(content), extractMetadata(content)]);
            const { error } = await supabase.from("thoughts").insert({ content, embedding, metadata: { ...metadata, source: "mcp" } });

            if (error) throw new Error(error.message);
            return { content: [{ type: "text" as const, text: `Captured successfully.` }] };
        } catch (err: any) {
            return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
        }
    }
);

// --- Hono App with Auth Check ---
const app = new Hono();

app.all("*", async (c) => {
    const provided = c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");
    if (!provided || provided !== MCP_ACCESS_KEY) return c.json({ error: "Invalid access key" }, 401);

    const transport = new StreamableHTTPTransport();
    await server.connect(transport);
    return transport.handleRequest(c);
});

Deno.serve(app.fetch);
