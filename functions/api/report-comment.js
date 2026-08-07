// POST /api/report-comment
// Volá se z buildovaného indexu (commentsReportSubmit) poté, co se nahlášení
// zapíše do Firebase Realtime Database (reports/{qId}/{commentId}/...), která
// je zdroj pravdy. Tenhle endpoint jen pošle e-mailové upozornění admin(ům) —
// pokud selže, nahlášení samotné se v appce přesto nepočítá za ztracené.
//
// Používá Resend (https://resend.com) — jednoduché REST API na e-maily,
// zdarma tier stačí na tenhle objem provozu.
//
// NASTAVENÍ (nutné před nasazením):
// 1) Založit účet na resend.com, vygenerovat API klíč.
// 2) V Cloudflare Pages -> Settings -> Environment variables -> Secrets
//    přidat RESEND_API_KEY = <tvůj klíč>.
// 3) Buď ověřit vlastní doménu v Resendu a použít ji ve FROM_EMAIL níže,
//    nebo (pro rychlý start) nechat výchozí "onboarding@resend.dev" —
//    ten funguje bez ověřování domény, ale Resend ho může časem omezit.
// 4) Volitelně: přidat jednoduchý rate-limit/captcha proti zneužití
//    (viz poznámka na konci souboru).

const TO_EMAIL = "jakubmaceska@gmail.com";
const FROM_EMAIL = "USMLE Anatomy <onboarding@resend.dev>"; // uprav po ověření vlastní domény

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400 });
  }

  const questionId = String(body.questionId || "").slice(0, 50);
  const commentId = String(body.commentId || "").slice(0, 100);
  const reason = String(body.reason || "").slice(0, 500);
  const commentText = String(body.commentText || "").slice(0, 1000);
  const commentAuthorName = String(body.commentAuthorName || "").slice(0, 100);

  if (!commentId || !reason) {
    return new Response(JSON.stringify({ error: "missing_fields" }), { status: 400 });
  }

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("report-comment: RESEND_API_KEY není nastavený");
    return new Response(JSON.stringify({ error: "email_not_configured" }), { status: 500 });
  }

  const escapeHtml = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const subject = `Nahlášený komentář — otázka #${questionId}`;
  const html = `
    <p><strong>Otázka:</strong> #${escapeHtml(questionId)}</p>
    <p><strong>Autor komentáře:</strong> ${escapeHtml(commentAuthorName || "?")}</p>
    <p><strong>Text komentáře:</strong><br>${escapeHtml(commentText).replace(/\n/g, "<br>")}</p>
    <p><strong>Důvod nahlášení:</strong><br>${escapeHtml(reason).replace(/\n/g, "<br>")}</p>
    <p style="color:#888;font-size:12px;">ID komentáře: ${escapeHtml(commentId)}</p>
  `;

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [TO_EMAIL],
        subject,
        html
      })
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error("report-comment: Resend error", resp.status, errText);
      return new Response(JSON.stringify({ error: "email_send_failed" }), { status: 502 });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("report-comment: fetch to Resend failed", err);
    return new Response(JSON.stringify({ error: "email_send_failed" }), { status: 502 });
  }
}

// Poznámka ke zneužití: tenhle endpoint může kdokoliv zavolat opakovaně a
// zaplavit e-mail. Appka na frontendu po jednom nahlášení tlačítko pro daný
// komentář zablokuje (comments.reportDone), ale to jde v devtools obejít.
// Pokud by to začalo být problém, přidej třeba jednoduchý rate-limit podle
// IP (Cloudflare KV/Durable Object) nebo ověření přes Firebase ID token
// stejně jako u /api/admin-login.
