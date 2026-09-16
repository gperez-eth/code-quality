import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Where GitHub delivers webhooks.
 *
 * This is deliberately a pipe and not a handler. It forwards the raw body, the
 * signature header and the event name to `public.handle_github_event`, which
 * verifies the HMAC and decides what to do. The app's webhook secret lives in
 * Vault and is read by a function in the `private` schema, which PostgREST does
 * not expose — so the body travels to the secret rather than the secret
 * travelling to the body.
 *
 * `verify_jwt` is off, and has to be: GitHub sends no Supabase JWT. The
 * authentication is the signature, checked in the database against a secret
 * this function never sees. An unsigned delivery is refused there, not here.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Only POST is delivered here" }, 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    // Injected by the platform. Missing means misconfigured, and queueing work
    // from an unverifiable delivery would be worse than a failed delivery.
    return json({ error: "Function is not configured" }, 500);
  }

  const event = req.headers.get("x-github-event") ?? "";
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  const delivery = req.headers.get("x-github-delivery") ?? "";

  // Read as text, never parsed here: the HMAC is over the exact bytes GitHub
  // signed, and JSON.parse followed by JSON.stringify is not those bytes.
  const body = await req.text();

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/handle_github_event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ p_event: event, p_signature: signature, p_body: body }),
  });

  const text = await response.text();

  if (!response.ok) {
    // A rejected signature comes back as a raised exception. Answer 401 so the
    // delivery shows red in GitHub's log — a silent 200 on a forged signature
    // is how you find out months later.
    const rejected = text.includes("Signature does not match") ||
      text.includes("No webhook secret is configured");
    console.error(`delivery ${delivery} (${event}) rejected: ${text}`);
    return json({ error: rejected ? "Signature rejected" : "Delivery failed" }, rejected ? 401 : 500);
  }

  console.log(`delivery ${delivery} (${event}): ${text}`);
  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
