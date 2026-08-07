// USMLE Anatomy — Service Worker
// Cíl: základní offline chování (PWA požadavek), ale BEZ rizika servírování
// zastaralé appky nebo bez zásahu do Firebase Realtime Database provozu
// (živé testy potřebují vždy čerstvé síťové spojení, nikdy ne cache).

const CACHE_VERSION = "usmle-anatomy-v2";
const SHELL_CACHE = `shell-${CACHE_VERSION}`;
const DATA_CACHE = `data-${CACHE_VERSION}`;

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

// Datové soubory s otázkami a obrázky — cachují se za běhu (ne při instalaci),
// aby velký objem base64 dat nemohl shodit instalaci celého service workeru.
// Díky tomu jde procházet otázky i offline (jakmile appka jednou proběhla
// online a data se stáhla). Živé testy a denní výzva offline nepojedou,
// protože běží přes Firebase Realtime Database — to je záměr, ne bug.
const DATA_ASSET_PATTERN = /^\/(questions\.js|images[1-5]\.js)$/;

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
  const validCaches = [SHELL_CACHE, DATA_CACHE];
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !validCaches.includes(key))
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

  // Data s otázkami a obrázky (questions.js, images1-5.js): stale-while-revalidate.
  // Pokud už jsou v cache, vrátí se okamžitě (funguje offline) a na pozadí se
  // zkusí stáhnout čerstvá verze pro příště. Pokud v cache ještě nejsou
  // (úplně první spuštění appky), počká se na síť a výsledek se zacachuje.
  if (DATA_ASSET_PATTERN.test(url.pathname)) {
    event.respondWith(
      caches.open(DATA_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const networkUpdate = fetch(request)
          .then((response) => {
            if (response && response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => null);

        if (cached) {
          // Neblokovat odpověď na aktualizaci — ta doběhne na pozadí.
          networkUpdate;
          return cached;
        }

        const fresh = await networkUpdate;
        return (
          fresh ||
          new Response("", {
            status: 504,
            statusText: "Offline a data ještě nejsou v cache",
          })
        );
      })
    );
    return;
  }

  // Vše ostatní stejné domény (Firebase-related fetch přes /api/admin-login apod.):
  // necháváme jít přímo na síť bez cachování.
});
