// USMLE Anatomy — Cloudflare Pages Function: geo-lang middleware
//
// Cíl: podle země requestu (Cloudflare edge geolokace, zdarma a bez API volání)
// nastavit výchozí jazyk appky -- CZ/SK -> "cz", jinde -> "en".
// Appka (index.html) si toto respektuje jen jako VÝCHOZÍ hodnotu; pokud si
// uživatel jazyk už dřív ručně přepnul, appka drží jeho volbu v localStorage
// a tuhle geo hodnotu ignoruje (viz state.lang init v index.html).
//
// Funguje jen na HTML navigační requesty (ne na questions.js, images*.js,
// API endpointy, statické assety atd.) -- ty necháváme projít beze změny,
// aby se nezasahovalo do cachování ani do service workeru.

const CZ_SK_COUNTRIES = new Set(["CZ", "SK"]);

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  // Middleware zajímá jen GET navigace na HTML (typicky "/" a "/index.html").
  // Vše ostatní (JS, obrázky, manifest, API) necháváme projít beze změny.
  const isHtmlNavigation =
    request.method === "GET" &&
    (request.headers.get("Accept") || "").includes("text/html");

  if (!isHtmlNavigation) {
    return next();
  }

  const response = await next();

  // Přepisovat jen skutečné HTML odpovědi (pro jistotu, kdyby routa vracela něco jiného).
  const contentType = response.headers.get("Content-Type") || "";
  if (!contentType.includes("text/html")) {
    return response;
  }

  // Cloudflare automaticky vyplňuje request.cf.country na edge (ISO 3166-1 alpha-2),
  // zdarma, bez nutnosti externího geo-IP API.
  const country = request.cf && request.cf.country ? request.cf.country : null;
  const lang = country && CZ_SK_COUNTRIES.has(country) ? "cz" : "en";

  const rewriter = new HTMLRewriter().on("head", {
    element(element) {
      // Vkládáme na ZAČÁTEK <head>, aby window.__GEO_LANG__ existovalo
      // dřív, než se spustí hlavní <script> appky v <body>.
      element.prepend(
        `<script>window.__GEO_LANG__=${JSON.stringify(lang)};</script>`,
        { html: true }
      );
    },
  });

  return rewriter.transform(response);
}
