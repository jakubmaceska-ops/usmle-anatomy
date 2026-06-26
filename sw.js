// USMLE Anatomy — Service Worker
// Cíl: základní offline chování (PWA požadavek), ale BEZ rizika servírování
// zastaralé appky nebo bez zásahu do Firebase Realtime Database provozu
// (živé testy potřebují vždy čerstvé síťové spojení, nikdy ne cache).

const CACHE_VERSION = "usmle-anatomy-v1";
const SHELL_CACHE = `shell-${CACHE_VERSION}`;

// Soubory, které appka potřebuje pro zobrazení i bez připojení.
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-192.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
];

// Jednoduchá offline stránka zobrazená, když appka nemá síť
// a požadovaná stránka ještě není v cache.
const OFFLINE_FALLBACK_HTML = `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>USMLE Anatomy — offline</title>
<style>
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #fafafa;
    color: #1a1a1a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    text-align: center;
    padding: 24px;
  }
  .box { max-width: 360px; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { font-size: 14px; color: #5a5a5a; line-height: 1.6; margin: 0 0 20px; }
  button {
    border: 1px solid #cfcfcf;
    background: #ffffff;
    color: #1a1a1a;
    padding: 10px 20px;
    border-radius: 4px;
    font-size: 14px;
    cursor: pointer;
  }
  button:hover { background: #f0f0f0; }
</style>
</head>
<body>
  <div class="box">
    <h1>Jsi offline</h1>
    <p>Pro práci s USMLE Anatomy je potřeba připojení k internetu (například pro živé testy). Zkontroluj prosím Wi-Fi nebo mobilní data a zkus to znovu.</p>
    <button onclick="location.reload()">Zkusit znovu</button>
  </div>
</body>
</html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Jen GET požadavky řešíme servisním workerem.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Necachovat a nezasahovat do požadavků na jinou doménu
  // (Firebase Realtime Database, Firebase Auth, gstatic.com SDK moduly, Google Fonts atd.).
  // Tyto požadavky musí vždy jít přímo na síť, nikdy přes cache.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Pro navigaci (otevření/refresh appky): zkusit síť první (čerstvá verze appky),
  // a teprve když síť není dostupná, sáhnout po cache nebo offline fallbacku.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put("/index.html", copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match("/index.html");
          return (
            cached ||
            new Response(OFFLINE_FALLBACK_HTML, {
              headers: { "Content-Type": "text/html; charset=UTF-8" },
            })
          );
        })
    );
    return;
  }

  // Pro statické assety appky (ikony, manifest): cache první, síť jako záloha.
  if (SHELL_ASSETS.some((asset) => url.pathname === asset)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
    return;
  }

  // Vše ostatní stejné domény: nech projít na síť normálně.
});
