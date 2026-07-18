// functions/api/admin-login.js
//
// Cloudflare Pages Function — jediné místo, kde se admin kód pro živé testy
// skutečně ověřuje. Kód i klíč Firebase service accountu žijou POUZE jako
// Cloudflare environment secrets (nastavené v dashboardu / přes wrangler),
// takže se nikdy neposílají do prohlížeče a nejsou vidět ve zdrojovém kódu.
//
// Flow:
//   1. Klient pošle POST { code } sem.
//   2. Porovnáme s env.LIVE_ADMIN_CODE (server-side, tajné).
//   3. Pokud sedí, vystavíme Firebase custom token s claimem { admin: true }.
//   4. Klient se tímto tokenem přihlásí přes signInWithCustomToken.
//   5. Firebase Realtime Database Rules pak podle auth.token.admin === true
//      rozhodují, kdo smí zakládat/ovládat liveSessions — TOHLE je skutečné
//      vymáhání, ne klientský JS.
//
// Nutné Cloudflare Pages env proměnné (Settings → Environment variables,
// pro Production i Preview, ideálně jako "Encrypt"):
//   LIVE_ADMIN_CODE       - tajný kód (dřív "MACESKA2026", klidně změň)
//   FIREBASE_CLIENT_EMAIL - z JSON klíče service accountu (Firebase Console →
//                           Project settings → Service accounts → Generate new private key)
//   FIREBASE_PRIVATE_KEY  - "private_key" z téhož JSON (i s "\n" v textu, kód
//                           si je sám normalizuje na skutečné nové řádky)

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: "Invalid request" }, 400);
  }

  const submitted = typeof body.code === "string" ? body.code : "";
  const expected = env.LIVE_ADMIN_CODE || "";

  if (!expected || !timingSafeEqual(submitted, expected)) {
    // Drobné zpoždění jako slabá obrana proti naivnímu brute-force zkoušení.
    // Nenahrazuje to skutečný rate limiting (viz poznámka níže).
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

// Cokoliv jiného než POST na tento endpoint odmítneme.
export async function onRequestGet() {
  return jsonResponse({ error: "Method not allowed" }, 405);
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

// Porovnání odolné vůči timing útoku (délka + XOR všech znaků).
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Ruční sestavení Firebase custom tokenu (JWT podepsaný RS256 privátním klíčem
// service accountu) pomocí Web Crypto — firebase-admin balík totiž potřebuje
// Node.js API, která na Cloudflare Workers runtime nejsou k dispozici.
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
  // Cloudflare secrets občas uloží víceřádkový PEM s doslovnými "\n" místo
  // skutečných zalomení řádků — tady to sjednotíme.
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
