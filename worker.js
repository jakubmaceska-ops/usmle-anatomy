// src/worker.js
//
// Cloudflare Worker — servíruje statické soubory appky (index.html, ikony,
// obrázky, ...) A ZÁROVEŇ obsluhuje /api/admin-login. Admin kód i Firebase
// service account klíč žijou POUZE jako Cloudflare secrets (Settings →
// Variables and secrets v dashboardu), takže se nikdy neposílají do
// prohlížeče a nejsou vidět ve zdrojovém kódu.
//
// Nutné Cloudflare secrets (Settings → Variables and secrets, typ "Secret"):
//   LIVE_ADMIN_CODE       - tajný admin kód
//   FIREBASE_CLIENT_EMAIL - z JSON klíče service accountu
//   FIREBASE_PRIVATE_KEY  - "private_key" z téhož JSON

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/admin-login") {
      if (request.method === "POST") return handleAdminLogin(request, env);
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // Vše ostatní -> servíruj statické soubory appky (index.html, obrázky, ...)
    return env.ASSETS.fetch(request);
  },
};

async function handleAdminLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: "Invalid request" }, 400);
  }

  const submitted = typeof body.code === "string" ? body.code : "";
  const expected = env.LIVE_ADMIN_CODE || "";

  if (!expected || !timingSafeEqual(submitted, expected)) {
    await sleep(300);
    return jsonResponse({ error: "Invalid code" }, 401);
  }

  if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    console.error("admin-login: missing FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY env");
    return jsonResponse({ error: "Server misconfigured" }, 500);
  }

  try {
    const token = await createFirebaseCustomToken({
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKeyPem: env.FIREBASE_PRIVATE_KEY,
      uid: "live-admin",
      claims: { admin: true },
    });
    return jsonResponse({ token }, 200);
  } catch (e) {
    console.error("admin-login: token mint failed:", e);
    return jsonResponse({ error: "Server error" }, 500);
  }
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function createFirebaseCustomToken({ clientEmail, privateKeyPem, uid, claims }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    sub: clientEmail,
    aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iat: now,
    exp: now + 3600,
    uid,
    claims,
  };

  const encoder = new TextEncoder();
  const b64urlFromBytes = (buf) =>
    btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const b64urlFromStr = (str) => b64urlFromBytes(encoder.encode(str));

  const signingInput = `${b64urlFromStr(JSON.stringify(header))}.${b64urlFromStr(JSON.stringify(payload))}`;
  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    encoder.encode(signingInput)
  );

  return `${signingInput}.${b64urlFromBytes(signature)}`;
}

async function importPrivateKey(pem) {
  const normalized = pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem;
  const b64 = normalized
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}
