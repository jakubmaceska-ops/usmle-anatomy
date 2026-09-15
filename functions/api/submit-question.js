// functions/api/submit-question.js
//
// Cloudflare Pages Function — přijme POST z formuláře "Přidat otázku"
// (fetch("/api/submit-question", ...) ve frontendu) a pošle e-mail
// přes Resend na adresu v proměnné NOTIFY_EMAIL.
//
// Potřebné proměnné prostředí (Cloudflare Pages → Settings → Environment variables):
//   RESEND_API_KEY  – API klíč z resend.com (nastav jako "Encrypt")
//   NOTIFY_EMAIL    – e-mail, kam se mají otázky posílat (tvůj e-mail)
//   RESEND_FROM     – volitelné, výchozí odesílatel (viz návod níže)

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function optionsHtml(opts, correctLetter) {
  return ["a", "b", "c", "d", "e"].map((l) =>
    `<li>${l.toUpperCase()}${correctLetter === l ? " ✅" : ""}: ${escapeHtml(opts?.[l])}</li>`
  ).join("");
}

function dataUrlToAttachment(imgObj, baseName) {
  if (!imgObj || !imgObj.dataUrl) return null;
  const match = /^data:([^;]+);base64,(.+)$/.exec(imgObj.dataUrl);
  if (!match) return null;
  const mime = match[1];
  const base64 = match[2];
  const ext = (mime.split("/")[1] || "bin").split("+")[0];
  return { filename: `${baseName}.${ext}`, content: base64 };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  // -- server-side validace (nikdy nespoléhat jen na frontend) --
  if (!payload || payload.consentGiven !== true) {
    return new Response(JSON.stringify({ error: "Consent not given" }), { status: 400 });
  }
  const cz = payload.cz || {};
  const en = payload.en || {};
  const letters = ["a", "b", "c", "d", "e"];
  const czValid = cz.stem && cz.explanation && cz.correct && cz.options &&
    letters.every((l) => cz.options[l]);
  const enValid = en.stem && en.explanation && en.options &&
    letters.every((l) => en.options[l]);
  if (!czValid || !enValid) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
  }

  const attachments = [
    dataUrlToAttachment(payload.image, "obrazek-cz"),
    dataUrlToAttachment(payload.explanationImage, "obrazek-vysvetleni-en"),
  ].filter(Boolean);

  const html = `
    <h2>Nová otázka ke kontrole – USMLE Anatomy App</h2>
    <p><strong>Celek:</strong> ${escapeHtml(payload.unitTitle)}<br>
       <strong>Kapitola:</strong> ${escapeHtml(payload.chapterTitle)}</p>
    <p><strong>Autor:</strong> ${
      payload.showAuthorName && payload.authorName ? escapeHtml(payload.authorName) : "neuvedeno / anonymní"
    }</p>

    <h3>Česky</h3>
    <p>${escapeHtml(cz.stem)}</p>
    <ul>${optionsHtml(cz.options, cz.correct)}</ul>
    <p><strong>Vysvětlení:</strong> ${escapeHtml(cz.explanation)}</p>
    ${payload.image?.sourceUrl ? `<p><strong>Zdroj obrázku:</strong> ${escapeHtml(payload.image.sourceUrl)}</p>` : ""}

    <h3>English</h3>
    <p>${escapeHtml(en.stem)}</p>
    <ul>${optionsHtml(en.options, cz.correct)}</ul>
    <p><strong>Explanation:</strong> ${escapeHtml(en.explanation)}</p>
    ${payload.explanationImage?.sourceUrl ? `<p><strong>Zdroj obrázku (explanation):</strong> ${escapeHtml(payload.explanationImage.sourceUrl)}</p>` : ""}

    <hr>
    <p style="color:#888;font-size:12px">Odesláno automaticky z formuláře „Přidat otázku“ v USMLE Anatomy App.</p>
  `;

  try {
    const resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM || "USMLE Anatomy App <onboarding@resend.dev>",
        to: [env.NOTIFY_EMAIL],
        subject: `Nová otázka ke kontrole – ${payload.unitTitle} / ${payload.chapterTitle}`,
        html,
        attachments: attachments.length ? attachments : undefined,
      }),
    });

    if (!resendResp.ok) {
      const errText = await resendResp.text();
      console.error("Resend error:", resendResp.status, errText);
      return new Response(JSON.stringify({ error: "Resend send failed" }), { status: 502 });
    }
  } catch (err) {
    console.error("submit-question fetch to Resend failed:", err);
    return new Response(JSON.stringify({ error: "Server error" }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Cokoliv jiného než POST na tuto route odmítneme.
export async function onRequestGet() {
  return new Response("Method Not Allowed", { status: 405 });
}
