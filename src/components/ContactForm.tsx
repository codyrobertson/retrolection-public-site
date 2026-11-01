"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./contact.module.css";

type State = { at: "idle" | "sending" | "sent" | "error"; note?: string };

/**
 * Three lines and a send. Posts to /api/contact; the reply is said in place (aria-live), and
 * a sent note leaves a line saying so with the way to write another.
 */
export default function ContactForm({ email }: { email?: string }) {
  const [state, setState] = useState<State>({ at: "idle" });
  const started = useRef(0);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { started.current = Date.now(); }, []);

  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.at === "sending") return;
    const data = Object.fromEntries(new FormData(e.currentTarget));
    setState({ at: "sending" });
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, t: started.current }),
      });
      const out = await res.json().catch(() => ({ ok: false }));
      if (out.ok) { form.current?.reset(); setState({ at: "sent" }); return; }
      setState({ at: "error", note: out.error || "It didn't send. Try again?" });
    } catch {
      setState({ at: "error", note: `It didn't send.${email ? ` Write to ${email} instead?` : ""}` });
    }
  }

  if (state.at === "sent") {
    return (
      <div className={styles.sent} role="status">
        <p className={styles.sentTitle}>Sent. Thank you.</p>
        <p className={styles.sentNote}>I read every one, and answer within a couple of days.</p>
        <button type="button" className={styles.again} onClick={() => { started.current = Date.now(); setState({ at: "idle" }); }}>
          Write another
        </button>
      </div>
    );
  }

  const busy = state.at === "sending";
  return (
    <form ref={form} className={styles.form} onSubmit={send} data-state={state.at}>
      <div className={styles.pair}>
        <label className={styles.field}>
          <span className={styles.name}>Name</span>
          <input name="name" autoComplete="name" required maxLength={120} disabled={busy} />
        </label>
        <label className={styles.field}>
          <span className={styles.name}>Email</span>
          <input name="email" type="email" autoComplete="email" inputMode="email" required maxLength={254} disabled={busy} />
        </label>
      </div>
      <label className={styles.field}>
        <span className={styles.name}>What are you making?</span>
        <textarea name="message" rows={5} required minLength={10} maxLength={5000} disabled={busy} />
      </label>
      {/* for scripts that fill every box; no one else sees it */}
      <label className={styles.trap} aria-hidden>
        Website <input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      <div className={styles.foot}>
        <p className={styles.status} aria-live="polite" data-error={state.at === "error"}>
          {state.at === "error" ? state.note : busy ? "Sending…" : email ? <>Or write to <a href={`mailto:${email}`}>{email}</a></> : null}
        </p>
        <button type="submit" className={styles.send} disabled={busy}>
          {busy ? "Sending" : "Send"}<span aria-hidden> →</span>
        </button>
      </div>
    </form>
  );
}
