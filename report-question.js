// functions/api/report-question.js
//
// Cloudflare Pages Function — přijme nahlášení chyby v otázce z klienta
// (viz qreportSubmit() v index.html) a pošle e-mailové upozornění přes Resend.
//
// Očekávané proměnné prostředí (Cloudflare Pages -> Settings -> Environment
// variables; nastav je jako "Secret", kromě REPORT_TO_EMAIL / REPORT_FROM_EMAIL,
// které mohou být obyčejné "Text"):
//   RESEND_API_KEY_2   – API klíč z https://resend.com/api-keys
//   REPORT_TO_EMAIL  – e-mail, na který se má nahlášení posílat (tvůj e-mail)
//   REPORT_FROM_EMAIL – odesílací adresa, musí být na ověřené doméně v Resendu
//                        (např. "USMLE Anatomy <reports@tvoje-domena.cz>")
//
// Pozn.: pokud už máš z dřívějška hotový functions/api/report-comment.js
// (posílá upozornění na nahlášené komentáře), zkontroluj, jaké názvy proměnných
// prostředí používá tam, a případně přejmenuj konstanty níže tak, aby seděly —
// ať v Cloudflare konzoli nemusíš mít dvě sady stejných secrets pod jinými jmény.

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "invalid-json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const { questionId, description, original, proposed } = body || {};

  if (questionId === undefined || questionId === null || !description || typeof description !== "string") {
    return new Response(JSON.stringify({ error: "missing-fields" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (!env.RESEND_API_KEY_2 || !env.REPORT_TO_EMAIL || !env.REPORT_FROM_EMAIL) {
    console.error("report-question: missing RESEND_API_KEY_2 / REPORT_TO_EMAIL / REPORT_FROM_EMAIL env vars");
    return new Response(JSON.stringify({ error: "server-not-configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const nl2br = (s) => esc(s).replace(/\n/g, "<br>");

  function renderQuestionHtml(langLabel, data) {
    if (!data) return "";
    const letters = Object.keys(data.options || {});
    const optionsHtml = letters
      .map((l) => {
        const isCorrect = l === data.correct;
        return `<li${isCorrect ? ' style="font-weight:700;"' : ""}>${esc(l.toUpperCase())}) ${nl2br(data.options[l])}${isCorrect ? " ✅" : ""}</li>`;
      })
      .join("");
    return `
      <h4 style="margin:16px 0 4px;">${esc(langLabel)}</h4>
      <p style="margin:4px 0;"><strong>Zadání:</strong><br>${nl2br(data.stem)}</p>
      <p style="margin:4px 0;"><strong>Možnosti:</strong></p>
      <ul style="margin:4px 0;padding-left:20px;">${optionsHtml}</ul>
      <p style="margin:4px 0;"><strong>Vysvětlení:</strong><br>${nl2br(data.explanation)}</p>
    `;
  }

  const html = `
    <div style="font-family:sans-serif;font-size:14px;line-height:1.5;color:#111;">
      <h2 style="margin:0 0 12px;">🚩 Nahlášená chyba v otázce #${esc(questionId)}</h2>

      <p style="margin:4px 0;"><strong>Popis chyby od uživatele:</strong><br>${nl2br(description)}</p>

      <hr style="margin:20px 0;border:none;border-top:1px solid #ddd;">
      <h3 style="margin:0 0 4px;">Aktuální znění otázky</h3>
      ${renderQuestionHtml("Čeština", original && original.cz)}
      ${renderQuestionHtml("English", original && original.en)}

      <hr style="margin:20px 0;border:none;border-top:1px solid #ddd;">
      <h3 style="margin:0 0 4px;">Navrhovaná úprava od uživatele</h3>
      ${renderQuestionHtml("Čeština", proposed && proposed.cz)}
      ${renderQuestionHtml("English", proposed && proposed.en)}
    </div>
  `;

  const text = [
    `Nahlášená chyba v otázce #${questionId}`,
    "",
    `Popis chyby: ${description}`,
    "",
    "--- Aktuální znění (CZ) ---",
    JSON.stringify(original && original.cz, null, 2),
    "",
    "--- Aktuální znění (EN) ---",
    JSON.stringify(original && original.en, null, 2),
    "",
    "--- Navrhovaná úprava (CZ) ---",
    JSON.stringify(proposed && proposed.cz, null, 2),
    "",
    "--- Navrhovaná úprava (EN) ---",
    JSON.stringify(proposed && proposed.en, null, 2)
  ].join("\n");

  try {
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY_2}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: env.REPORT_FROM_EMAIL,
        to: env.REPORT_TO_EMAIL,
        subject: `🚩 Nahlášená chyba v otázce #${questionId}`,
        html,
        text
      })
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text().catch(() => "");
      console.error("Resend API error:", resendRes.status, errText);
      return new Response(JSON.stringify({ error: "resend-failed" }), {
        status: 502,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("report-question handler failed:", err);
    return new Response(JSON.stringify({ error: "internal-error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
