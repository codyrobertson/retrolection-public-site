import { getSite } from "@/lib/content";

/**
 * The contact form's backend: checks the note, then sends it on through Resend
 * (RESEND_API_KEY). It goes to CONTACT_TO, or the site's own email link; from CONTACT_FROM,
 * which has to be on a domain verified with Resend (onboarding@resend.dev only reaches the
 * Resend account's owner). Replies go straight to whoever wrote.
 */

const LIMITS = { name: 120, email: 254, message: 5000 };
const MIN_MS = 2500;                       // faster than anyone writes a note: a script
const WINDOW_MS = 10 * 60_000, PER_WINDOW = 5;
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

// best-effort, per instance: enough to stop one sender filling the inbox
const seen = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now(), hits = (seen.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  seen.set(ip, hits);
  if (seen.size > 5000) seen.clear();
  return hits.length > PER_WINDOW;
}

const bad = (error: string, status = 400) => Response.json({ ok: false, error }, { status });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const line = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return bad("That didn't come through. Try again?"); }

  const name = line(String(body.name ?? "")), email = line(String(body.email ?? ""));
  const message = String(body.message ?? "").trim(), started = Number(body.t ?? 0);

  // the field no one sees, and the note written faster than it could be read: say it went
  if (String(body.website ?? "") || !started || Date.now() - started < MIN_MS) return Response.json({ ok: true });

  if (!name) return bad("Your name, please.");
  if (!EMAIL.test(email)) return bad("That email doesn't look right.");
  if (message.length < 10) return bad("A little more about it, please.");
  if (name.length > LIMITS.name || email.length > LIMITS.email || message.length > LIMITS.message) return bad("That's longer than this form takes.");

  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  if (limited(ip)) return bad("That's a few already. Give it a little while.", 429);

  const key = process.env.RESEND_API_KEY;
  const site = await getSite();
  const own = site.social.find((s) => s.platform === "email")?.url.replace(/^mailto:/, "");
  const to = process.env.CONTACT_TO || own;
  if (!key || !to) return bad(`The form isn't connected yet.${own ? ` Write to ${own}.` : ""}`, 503);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.CONTACT_FROM || `${site.name} <onboarding@resend.dev>`,
      to: [to],
      reply_to: email,
      subject: `A note from ${name}`,
      text: `${message}\n\n— ${name} <${email}>`,
      html: `<div style="font:16px/1.55 Georgia,serif;color:#1a1917;white-space:pre-wrap">${esc(message)}</div>` +
        `<p style="font:13px/1.4 ui-monospace,monospace;color:#8a857a">— ${esc(name)} &lt;${esc(email)}&gt;</p>`,
    }),
  }).catch(() => null);

  if (!res?.ok) {
    // Resend's own reason (an unverified from-domain, say), for the server log only
    const why = res ? await res.json().then((j) => j?.message ?? j?.name, () => res.statusText) : "unreachable";
    console.error(`[contact] Resend refused: ${res?.status ?? "-"} ${why}`);
    return bad(`It didn't send.${own ? ` Write to ${own} instead?` : " Try again in a moment?"}`, 502);
  }
  return Response.json({ ok: true });
}
