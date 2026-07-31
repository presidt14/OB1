# MCP OAuth Proxy

## What it does

Puts a thin Cloudflare Worker in front of your `open-brain-mcp` Edge Function so MCP connectors stop trying to sign in with OAuth. It answers `404` to OAuth discovery probes — which a stock `*.supabase.co` domain cannot do — and moves your access key out of the URL and into a request header so it stops appearing in Supabase's request logs.

Use this if adding Open Brain as a custom connector fails with:

> Couldn't register with Open Brain's sign-in service. You can try again, or add an OAuth Client ID in the connector settings.

## Why the error happens

MCP clients that support OAuth start by probing the RFC 9728 discovery path:

```
GET https://YOUR_PROJECT_REF.supabase.co/.well-known/oauth-protected-resource/functions/v1/open-brain-mcp
```

That path sits at the **project root**, outside your Edge Function's route, so it never reaches your code. It lands on Supabase's API gateway, which requires an `apikey` on any unrecognised route and therefore answers **401 — not 404**.

That distinction is the entire bug:

| Gateway answers | Client concludes | What happens |
|---|---|---|
| `404` | "No OAuth here." | Falls back to the access key. Connector works. |
| `401` | "OAuth-protected, I'm just not authenticated." | Hunts for an authorization server, finds none, attempts Dynamic Client Registration, fails. |

There is no authorization server to register with, so registration fails and the connector surfaces the sign-in error. Your MCP server is never actually contacted.

Because the probe hits a path the Edge Function can't serve, this cannot be fixed inside the function. It needs a host you control — which is what this Worker provides.

> [!NOTE]
> Before reaching for this Worker, make sure you're running a current `open-brain-mcp`. An older revision that returns a bare HTTP `401` on a missing key makes strict MCP hosts treat the failure as a transport fault and start the same OAuth dance. The maintained function returns a JSON-RPC error envelope with HTTP 200 instead.

## Prerequisites

- A working Open Brain setup with `open-brain-mcp` deployed
- Your Supabase project ref and your `MCP_ACCESS_KEY`
- A Cloudflare account (the free Workers plan is enough)
- A domain on a Cloudflare zone you control — required, since the Worker must own the whole origin including `/.well-known/*`
- Node.js 18+ and the [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)

![Step 1](https://img.shields.io/badge/Step_1-Configure_the_Worker-F38020?style=for-the-badge)

1. Copy this folder somewhere local.
2. Open `wrangler.toml` and set `UPSTREAM_URL` to your Edge Function — with **no** `?key=` on the end:

   ```toml
   [vars]
   UPSTREAM_URL = "https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp"
   ```

3. Uncomment the `[[routes]]` block and set `pattern` to the hostname you want to serve Open Brain from:

   ```toml
   [[routes]]
   pattern = "brain.example.com"
   custom_domain = true
   ```

✅ **Done when:** `wrangler.toml` has your real project ref in `UPSTREAM_URL` and your real hostname in `pattern`.

![Step 2](https://img.shields.io/badge/Step_2-Deploy-F38020?style=for-the-badge)

1. Authenticate Wrangler against your Cloudflare account:

   ```bash
   npx wrangler login
   ```

2. Deploy the Worker from the folder containing `wrangler.toml`:

   ```bash
   npx wrangler deploy
   ```

Wrangler prints the deployed URL and provisions the custom domain. DNS can take a minute or two to go live.

✅ **Done when:** `npx wrangler deploy` completes without errors and prints your custom domain.

![Step 3](https://img.shields.io/badge/Step_3-Verify_the_404-F38020?style=for-the-badge)

This is the check that matters — the discovery path must return `404`, not `401`:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  https://brain.example.com/.well-known/oauth-protected-resource
```

✅ **Done when:** the command prints `404`. If it prints `401`, the request is still reaching Supabase rather than your Worker — recheck the route binding in Step 1.

![Step 4](https://img.shields.io/badge/Step_4-Repoint_your_connector-F38020?style=for-the-badge)

1. If you're replacing an existing Open Brain connector, remove the old one first — connector clients cache OAuth state per entry, and a stale entry keeps failing even after the 404 is in place.
2. In Claude Desktop, open **Settings → Connectors → Add custom connector**.
3. Name it `Open Brain`.
4. For the remote MCP server URL, use your Worker's hostname with the key appended:

   ```text
   https://brain.example.com/?key=YOUR_MCP_ACCESS_KEY
   ```

5. Click **Add**.

The Worker strips `?key=` before forwarding and re-sends it as the `x-brain-key` header, so the key never reaches Supabase's request logs.

✅ **Done when:** the connector saves without a sign-in prompt, and Open Brain's tools appear in a new conversation.

## Expected outcome

Adding the connector completes with no OAuth prompt and no registration error. Open Brain's tools (`search_thoughts`, `list_thoughts`, `thought_stats`, `capture_thought`, plus the `search`/`fetch` compatibility pair) show up in a new conversation. In Supabase, edge function logs show incoming requests with a bare URL — no `key=` in the query string.

## Troubleshooting

**Still getting the sign-in / registration error.** Confirm Step 3 returns `404`. If it returns `401`, your connector URL is still pointing at `*.supabase.co` — the Worker isn't in the path. Also delete and re-add the connector; clients cache OAuth state per connector entry.

**`401` or an "Invalid or missing access key" response.** The Worker forwards the key but never validates it. Check that `?key=` matches the `MCP_ACCESS_KEY` secret set on the Edge Function (`npx supabase secrets list`).

**`UPSTREAM_URL is not configured on this Worker.`** The `[vars]` block didn't ship. Re-run `npx wrangler deploy` from the folder containing `wrangler.toml`.

**Tools connect but calls hang or time out.** MCP streams over Server-Sent Events. If you've added Cloudflare features that buffer or transform responses on this route, disable them — the Worker itself streams the body through untouched.

**`526` or TLS errors on the custom domain.** The zone's SSL/TLS mode needs to be Full or Full (Strict). Flexible mode breaks the HTTPS hop to Supabase.

## Related

- [MCP Tool Audit & Optimization Guide](../../docs/05-tool-audit.md) — keeping your tool surface manageable as you add connectors
- [Getting Started](../../docs/01-getting-started.md) — Step 7 covers connecting AI clients
- [FAQ](../../docs/03-faq.md)
