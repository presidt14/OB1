// ============================================================
// Open Brain — ingest-thought/index.ts
// Supabase Edge Function: Slack → embed → classify → store → reply
//
// Pattern: ACK Slack in <100ms (return 200 fast), then do the slow
// embed/classify/insert/reply work in the background via
// EdgeRuntime.waitUntil(). Idempotency on slack_ts guarantees any
// Slack-side retry that does sneak through never duplicates.
//
// Deploy: supabase functions deploy ingest-thought --no-verify-jwt
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY        = Deno.env.get("OPENROUTER_API_KEY")!;
const SLACK_BOT_TOKEN           = Deno.env.get("SLACK_BOT_TOKEN")!;
const SLACK_CAPTURE_CHANNEL     = Deno.env.get("SLACK_CAPTURE_CHANNEL")!;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// `EdgeRuntime` is a Supabase Edge Functions global for background tasks.
// Declared so TS doesn't complain about the missing type.
declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void };

// ── Generate 1536-dim embedding via OpenRouter ──────────────────────
async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
    }),
  });
  const d = await r.json();
  return d.data[0].embedding;
}

// ── Extract structured metadata via gpt-4o-mini ────────────────────
async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
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

// ── Post threaded reply to Slack ────────────────────────────────────
async function replyInSlack(channel: string, threadTs: string, text: string): Promise<void> {
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel, thread_ts: threadTs, text }),
  });
}

// ── Background work: dedupe, embed, classify, insert, reply ─────────
async function processMessage(
  messageText: string,
  channel: string,
  messageTs: string,
): Promise<void> {
  try {
    // Idempotency check: skip if this slack_ts is already in the DB.
    // Defends against Slack retries that arrive before our 200 ACK,
    // and against any race with concurrent invocations.
    const { data: existing, error: selErr } = await supabase
      .from("thoughts")
      .select("id")
      .filter("metadata->>slack_ts", "eq", messageTs)
      .limit(1)
      .maybeSingle();

    if (selErr) {
      // Log and continue — losing a capture is worse than a possible dup.
      console.error("Dedupe SELECT failed:", selErr);
    } else if (existing) {
      console.log(`Skipping duplicate ingest for slack_ts=${messageTs}`);
      return;
    }

    // Generate embedding + extract metadata in parallel for speed
    const [embedding, metadata] = await Promise.all([
      getEmbedding(messageText),
      extractMetadata(messageText),
    ]);

    // Persist to Supabase
    const { error } = await supabase.from("thoughts").insert({
      content: messageText,
      embedding,
      metadata: { ...metadata, source: "slack", slack_ts: messageTs },
    });

    if (error) {
      console.error("Supabase insert error:", error);
      await replyInSlack(channel, messageTs, `Failed to capture: ${error.message}`);
      return;
    }

    // Build confirmation message
    const meta = metadata as Record<string, unknown>;
    let confirmation = `Captured as *${meta.type || "thought"}*`;
    if (Array.isArray(meta.topics) && meta.topics.length > 0)
      confirmation += ` - ${meta.topics.join(", ")}`;
    if (Array.isArray(meta.people) && meta.people.length > 0)
      confirmation += `\nPeople: ${meta.people.join(", ")}`;
    if (Array.isArray(meta.action_items) && meta.action_items.length > 0)
      confirmation += `\nAction items: ${meta.action_items.join("; ")}`;

    await replyInSlack(channel, messageTs, confirmation);
  } catch (err) {
    console.error("Background processing error:", err);
  }
}

// ── Main handler: ACK Slack fast, defer the work ────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  try {
    const body = await req.json();

    // Slack URL verification handshake (must be synchronous)
    if (body.type === "url_verification") {
      return new Response(JSON.stringify({ challenge: body.challenge }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const event = body.event;

    // Ignore non-message events, bot messages, and messages outside capture channel
    if (
      !event ||
      event.type !== "message" ||
      event.subtype ||
      event.bot_id ||
      event.channel !== SLACK_CAPTURE_CHANNEL
    ) {
      return new Response("ok", { status: 200 });
    }

    const messageText: string = event.text;
    const channel: string = event.channel;
    const messageTs: string = event.ts;

    if (!messageText || messageText.trim() === "") {
      return new Response("ok", { status: 200 });
    }

    // Hand work to the background; ACK Slack immediately.
    EdgeRuntime.waitUntil(processMessage(messageText, channel, messageTs));
    return new Response("ok", { status: 200 });

  } catch (err) {
    console.error("Handler error:", err);
    return new Response("error", { status: 500 });
  }
});
