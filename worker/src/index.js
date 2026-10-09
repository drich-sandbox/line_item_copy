// HubSpot app backend: OAuth install + the "Copy line items" workflow action.
// Runs on Cloudflare Workers. Secrets HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET
// are set with `wrangler secret put` (see GUIDE.md).

const API = "https://api.hubapi.com";
const LINE_ITEM_TO_DEAL = 20; // HubSpot-defined association type: line item -> deal

// Properties that must never be copied.
const SKIP_PROPS = new Set([
  "hs_object_id", "createdate", "hs_createdate", "hs_lastmodifieddate",
  "lastmodifieddate", "hs_all_owner_ids", "hs_object_source",
  "hs_object_source_id", "hs_object_source_label", "hs_object_source_detail_1",
  "hs_object_source_detail_2", "hs_object_source_detail_3", "amount",
]);

// Used if the full copy is rejected (e.g. a property turns out to be read-only).
const SAFE_PROPS = [
  "name", "quantity", "price", "description", "hs_sku", "hs_product_id",
  "discount", "hs_discount_percentage", "recurringbillingfrequency",
  "hs_recurring_billing_period", "hs_recurring_billing_start_date",
  "hs_term_in_months", "hs_line_item_currency_code",
];

class UserError extends Error {}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/") return html("Line Item Copy app is running.");
      if (url.pathname === "/oauth/callback") return await oauthCallback(url, env);
      if (url.pathname === "/action/copy-line-items" && request.method === "POST") {
        return await copyAction(request, env);
      }
      return new Response("Not found", { status: 404 });
    } catch (err) {
      console.error(err.stack || err);
      if (err instanceof UserError) return json({ message: err.message }, 400);
      return json({ message: "Internal error: " + err.message }, 500);
    }
  },
};

// ---------- OAuth ----------

async function oauthCallback(url, env) {
  const code = url.searchParams.get("code");
  if (!code) return html("Missing authorization code.", 400);

  const tokens = await tokenRequest(env, {
    grant_type: "authorization_code",
    redirect_uri: `${url.origin}/oauth/callback`,
    code,
  });

  const info = await fetch(`${API}/oauth/v1/access-tokens/${tokens.access_token}`);
  if (!info.ok) throw new Error("Could not look up HubSpot account: " + (await info.text()));
  const { hub_id } = await info.json();

  await saveTokens(env, hub_id, tokens);
  return html("Installed! You can close this tab and use the Copy line items action in a HubSpot workflow.");
}

async function tokenRequest(env, params) {
  const res = await fetch(`${API}/oauth/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.HUBSPOT_CLIENT_ID,
      client_secret: env.HUBSPOT_CLIENT_SECRET,
      ...params,
    }),
  });
  if (!res.ok) throw new Error("HubSpot token request failed: " + (await res.text()));
  return res.json();
}

async function saveTokens(env, portalId, t) {
  await env.TOKENS.put(
    `hub:${portalId}`,
    JSON.stringify({
      refresh_token: t.refresh_token,
      access_token: t.access_token,
      expires_at: Date.now() + (t.expires_in - 60) * 1000,
    })
  );
}

async function getAccessToken(env, portalId) {
  const raw = await env.TOKENS.get(`hub:${portalId}`);
  if (!raw) {
    throw new UserError(
      `The app is not installed in HubSpot account ${portalId}. Reinstall it, then re-run.`
    );
  }
  const saved = JSON.parse(raw);
  if (saved.access_token && saved.expires_at > Date.now()) return saved.access_token;
  const fresh = await tokenRequest(env, {
    grant_type: "refresh_token",
    refresh_token: saved.refresh_token,
  });
  await saveTokens(env, portalId, fresh);
  return fresh.access_token;
}

// ---------- Workflow action ----------

async function copyAction(request, env) {
  const body = await request.text();
  await verifySignature(request, body, env.HUBSPOT_CLIENT_SECRET);

  const payload = JSON.parse(body);
  const portalId = payload.origin?.portalId;
  const sourceId = payload.object?.objectId;
  const targetId = String(payload.fields?.targetDealId ?? "").trim();
  const mode = payload.fields?.mode === "REPLACE" ? "REPLACE" : "ADD";

  if (!portalId || !sourceId) throw new UserError("Missing deal or account in request.");
  if (!/^\d+$/.test(targetId)) {
    throw new UserError(`Target deal ID "${targetId}" is not a valid deal ID.`);
  }
  if (String(sourceId) === targetId) {
    throw new UserError("Source and target deal are the same deal.");
  }

  const hs = hubspotClient(await getAccessToken(env, portalId));

  const sourceItemIds = await listLineItemIds(hs, sourceId);
  let removed = 0;
  if (mode === "REPLACE") {
    const existing = await listLineItemIds(hs, targetId);
    for (const chunk of chunks(existing, 100)) {
      await hs("POST", "/crm/v3/objects/line_items/batch/archive", {
        inputs: chunk.map((id) => ({ id })),
      });
    }
    removed = existing.length;
  }

  let copied = 0;
  if (sourceItemIds.length) {
    const props = await copyableProperties(hs);
    const items = [];
    for (const chunk of chunks(sourceItemIds, 100)) {
      const res = await hs("POST", "/crm/v3/objects/line_items/batch/read", {
        properties: props,
        inputs: chunk.map((id) => ({ id })),
      });
      items.push(...res.results);
    }
    copied = await createCopies(hs, items, targetId);
  }

  return json({ outputFields: { copiedCount: copied, removedCount: removed } });
}

async function createCopies(hs, items, targetId) {
  const build = (keep) =>
    items.map((it) => ({
      properties: pick(it.properties, keep),
      associations: [
        {
          to: { id: targetId },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: LINE_ITEM_TO_DEAL }],
        },
      ],
    }));

  const allKeys = [...new Set(items.flatMap((i) => Object.keys(i.properties)))];
  const attempts = [allKeys, SAFE_PROPS];
  for (let a = 0; a < attempts.length; a++) {
    let created = 0;
    try {
      for (const chunk of chunks(build(attempts[a]), 100)) {
        await hs("POST", "/crm/v3/objects/line_items/batch/create", { inputs: chunk });
        created += chunk.length;
      }
      return created;
    } catch (err) {
      // Only retry with the safe list if nothing was created yet.
      if (a === 0 && created === 0 && err.status === 400) continue;
      throw err;
    }
  }
}

function pick(props, keys) {
  const out = {};
  for (const k of keys) {
    const v = props[k];
    if (v !== null && v !== undefined && v !== "" && !SKIP_PROPS.has(k)) out[k] = v;
  }
  return out;
}

let propCache = null;
async function copyableProperties(hs) {
  if (propCache && propCache.expires > Date.now()) return propCache.names;
  const res = await hs("GET", "/crm/v3/properties/line_items");
  const names = res.results
    .filter((p) => !p.modificationMetadata?.readOnlyValue && !p.calculated && !SKIP_PROPS.has(p.name))
    .map((p) => p.name);
  propCache = { names, expires: Date.now() + 10 * 60 * 1000 };
  return names;
}

async function listLineItemIds(hs, dealId) {
  const ids = [];
  let after;
  do {
    const q = `?limit=500${after ? `&after=${after}` : ""}`;
    const res = await hs("GET", `/crm/v4/objects/deals/${dealId}/associations/line_items${q}`);
    ids.push(...res.results.map((r) => String(r.toObjectId)));
    after = res.paging?.next?.after;
  } while (after);
  return ids;
}

// ---------- helpers ----------

function hubspotClient(token) {
  return async (method, path, body) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(API + path, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 429 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`HubSpot ${method} ${path} -> ${res.status}: ${text}`);
        err.status = res.status;
        throw err;
      }
      return res.status === 204 ? null : res.json();
    }
  };
}

async function verifySignature(request, body, secret) {
  const sig = request.headers.get("X-HubSpot-Signature-v3");
  const ts = request.headers.get("X-HubSpot-Request-Timestamp");
  if (!sig || !ts || Math.abs(Date.now() - Number(ts)) > 5 * 60 * 1000) {
    throw new UserError("Invalid or expired request signature.");
  }
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const data = new TextEncoder().encode(request.method + request.url + body + ts);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  const expected = btoa(String.fromCharCode(...mac));
  if (!timingSafeEqual(expected, sig)) throw new UserError("Invalid request signature.");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function* chunks(arr, size) {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

function html(msg, status = 200) {
  return new Response(`<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:2rem"><p>${msg}</p>`, {
    status, headers: { "Content-Type": "text/html" },
  });
}
