export const config = { runtime: "edge" };

const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");

const STRIP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

export default async function handler(req) {
  const requestId = crypto.randomUUID();
  const startMs = Date.now();

  if (!TARGET_BASE) {
    console.error("[relay] misconfigured", { requestId, reason: "TARGET_DOMAIN missing" });
    return new Response("Misconfigured: TARGET_DOMAIN is not set", { status: 500 });
  }

  try {
    const pathStart = req.url.indexOf("/", 8);
    const targetUrl =
      pathStart === -1 ? TARGET_BASE + "/" : TARGET_BASE + req.url.slice(pathStart);
    const requestUrl = new URL(req.url);

    console.log("[relay] request:start", {
      requestId,
      method: req.method,
      path: requestUrl.pathname,
      hasQuery: requestUrl.search.length > 0,
    });
    console.log("[relay] request:upstream", {
      requestId,
      targetUrl,
      hasQuery: requestUrl.search.length > 0,
    });

    const out = new Headers();
    let clientIp = null;
    for (const [k, v] of req.headers) {
      if (STRIP_HEADERS.has(k)) continue;
      if (k.startsWith("x-vercel-")) continue;
      if (k === "x-real-ip") {
        clientIp = v;
        continue;
      }
      if (k === "x-forwarded-for") {
        if (!clientIp) clientIp = v;
        continue;
      }
      out.set(k, v);
    }
    if (clientIp) out.set("x-forwarded-for", clientIp);

    const method = req.method;
    const hasBody = method !== "GET" && method !== "HEAD";
    const upstreamRes = await fetch(targetUrl, {
      method,
      headers: out,
      body: hasBody ? req.body : undefined,
      duplex: "half",
      redirect: "manual",
    });

    console.log("[relay] request:done", {
      requestId,
      status: upstreamRes.status,
      durationMs: Date.now() - startMs,
    });

    return upstreamRes;
  } catch (err) {
    console.error("[relay] request:error", {
      requestId,
      durationMs: Date.now() - startMs,
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response("Bad Gateway: Tunnel Failed", { status: 502 });
  }
}
