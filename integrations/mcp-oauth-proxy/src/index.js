/**
 * Open Brain MCP OAuth Proxy
 *
 * A thin Cloudflare Worker that sits in front of the `open-brain-mcp` Supabase
 * Edge Function and does two things:
 *
 *   1. Answers 404 to OAuth discovery probes.
 *   2. Moves the access key out of the URL and into a request header.
 *
 * Why (1) matters
 * ---------------
 * MCP clients that support OAuth begin by probing RFC 9728 discovery paths:
 *
 *   GET /.well-known/oauth-protected-resource/functions/v1/open-brain-mcp
 *
 * On a stock `*.supabase.co` domain that path never reaches your Edge
 * Function — it lands on Supabase's API gateway, which requires an `apikey`
 * on any unrecognised route and therefore answers **401**, not 404.
 *
 * That distinction is the whole bug. A 404 means "this server has no OAuth,
 * fall back to whatever credentials you were given." A 401 means "this
 * resource IS OAuth-protected, you just aren't authenticated yet" — so the
 * client stays on the OAuth path, fails to find an authorization server, and
 * falls back to Dynamic Client Registration. There is no authorization server
 * to register with, so registration fails and the user sees:
 *
 *   "Couldn't register with <server>'s sign-in service. You can try again, or
 *    add an OAuth Client ID in the connector settings."
 *
 * Serving a clean 404 from a domain you control ends that flow before it
 * starts.
 *
 * Why (2) matters
 * ---------------
 * Connector UIs generally only let you paste a URL, so the access key ends up
 * as `?key=...`. Query strings are recorded in full in Supabase's request
 * logs, which puts the key in cleartext in log retention. This Worker accepts
 * the key either way, forwards it as the `x-brain-key` header, and strips it
 * from the upstream URL so it stops showing up in logs.
 */

const WELL_KNOWN_PREFIX = "/.well-known/";
const KEY_QUERY_PARAM = "key";
const KEY_HEADER = "x-brain-key";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-brain-key, accept, mcp-session-id, mcp-protocol-version, last-event-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
  "Access-Control-Max-Age": "86400",
};

/**
 * Headers that describe a single network hop and must not be copied onto the
 * outbound request. `host` and `content-length` are recomputed by fetch().
 */
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

export default {
  async fetch(request, env) {
    const upstream = env.UPSTREAM_URL;
    if (!upstream) {
      return json({ error: "UPSTREAM_URL is not configured on this Worker." }, 500);
    }

    const url = new URL(request.url);

    // CORS preflight — Claude Desktop and claude.ai are browser/Electron
    // based, so they preflight before the real request.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Kill OAuth discovery. A 404 here tells the client there is no OAuth on
    // this server, so it uses the access key instead of trying to register.
    if (url.pathname.startsWith(WELL_KNOWN_PREFIX)) {
      return json({ error: "Not Found" }, 404);
    }

    const target = new URL(upstream);

    // Carry over any query params the caller supplied, except the access key,
    // which moves to a header so it stays out of upstream request logs.
    for (const [name, value] of url.searchParams) {
      if (name !== KEY_QUERY_PARAM) target.searchParams.set(name, value);
    }

    const headers = new Headers();
    for (const [name, value] of request.headers) {
      if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) headers.set(name, value);
    }

    // Header wins if the client already sent one; otherwise promote ?key=.
    const key = request.headers.get(KEY_HEADER) ?? url.searchParams.get(KEY_QUERY_PARAM);
    if (key) headers.set(KEY_HEADER, key);

    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const upstreamResponse = await fetch(
      new Request(target.toString(), {
        method: request.method,
        headers,
        body: hasBody ? request.body : undefined,
        redirect: "manual",
        // Required when streaming a request body.
        duplex: "half",
      })
    );

    // Stream the response straight through — MCP uses Server-Sent Events, so
    // buffering here would stall the transport.
    const responseHeaders = new Headers(upstreamResponse.headers);
    for (const [name, value] of Object.entries(CORS_HEADERS)) {
      responseHeaders.set(name, value);
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  },
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
