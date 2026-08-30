import "server-only";

import { createConnection } from "node:net";

/**
 * The alert mailer: env-gated, with two transports and no SDK.
 *
 * The project has no application-level email provider — Supabase Auth's SMTP
 * belongs to the auth mailer and the application never touches it — so this
 * builds one, the same way billing built its Stripe client: raw protocol,
 * secrets read server-side only, and a `connected` predicate the UI renders
 * as **Not Connected** until one transport is supplied.
 *
 * Production transport — REST over Resend:
 *
 *   RESEND_API_KEY        an API key from resend.com
 *   JOB_ALERT_EMAIL_FROM  a from address on a domain verified with Resend
 *
 * Development-stack transport — plain SMTP:
 *
 *   JOB_ALERT_SMTP_URL    smtp://host:port — no TLS, no auth, deliberately:
 *                         this is for the local stack's Mailpit sink (and
 *                         nothing else), so the acceptance lane can verify a
 *                         real delivery end to end. It is not a production
 *                         transport; production uses Resend.
 *   JOB_ALERT_EMAIL_FROM  the from address, same variable as above
 *
 * When both are set, Resend wins. Without a transport plus a from address,
 * nothing sends, nothing pretends to send, and the alert controls say why.
 */

const RESEND_URL = "https://api.resend.com/emails";

export function alertEmailConnected(): boolean {
  return (
    Boolean(process.env.JOB_ALERT_EMAIL_FROM) &&
    (Boolean(process.env.RESEND_API_KEY) || Boolean(process.env.JOB_ALERT_SMTP_URL))
  );
}

export type SendResult = Readonly<{ sent: boolean; detail: string | null }>;

export async function sendAlertEmail(args: Readonly<{
  to: string;
  subject: string;
  text: string;
}>): Promise<SendResult> {
  const from = process.env.JOB_ALERT_EMAIL_FROM;
  if (!from) {
    return { sent: false, detail: "Email is not configured (JOB_ALERT_EMAIL_FROM)." };
  }
  if (process.env.RESEND_API_KEY) {
    return sendThroughResend(process.env.RESEND_API_KEY, from, args);
  }
  if (process.env.JOB_ALERT_SMTP_URL) {
    return sendThroughSmtp(process.env.JOB_ALERT_SMTP_URL, from, args);
  }
  return { sent: false, detail: "Email is not configured (RESEND_API_KEY or JOB_ALERT_SMTP_URL)." };
}

async function sendThroughResend(
  key: string,
  from: string,
  args: Readonly<{ to: string; subject: string; text: string }>,
): Promise<SendResult> {
  try {
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [args.to], subject: args.subject, text: args.text }),
    });
    if (!response.ok) {
      // The provider's message can help the owner (a domain not verified,
      // a revoked key); it never carries the recipient's content back out.
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      return { sent: false, detail: `Resend answered ${response.status}: ${body?.message ?? "no detail"}` };
    }
    return { sent: true, detail: null };
  } catch {
    return { sent: false, detail: "Resend could not be reached." };
  }
}

/**
 * A deliberately minimal SMTP conversation: EHLO, MAIL FROM, RCPT TO, DATA,
 * QUIT, over a plain socket. Enough for Mailpit; refuses anything that asks
 * for more (smtps://, credentials in the URL) rather than half-implementing
 * security.
 */
async function sendThroughSmtp(
  url: string,
  from: string,
  args: Readonly<{ to: string; subject: string; text: string }>,
): Promise<SendResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { sent: false, detail: "JOB_ALERT_SMTP_URL is not a valid URL." };
  }
  if (parsed.protocol !== "smtp:" || parsed.username !== "" || parsed.password !== "") {
    return {
      sent: false,
      detail: "JOB_ALERT_SMTP_URL supports plain smtp://host:port only; use RESEND_API_KEY for anything more.",
    };
  }
  const host = parsed.hostname;
  const port = Number(parsed.port || 25);

  const message = [
    `From: ${from}`,
    `To: ${args.to}`,
    `Subject: ${args.subject.replace(/[\r\n]+/g, " ")}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    // SMTP DATA transparency: a line that is a single dot ends the message,
    // so a leading dot in the body is doubled (RFC 5321 §4.5.2).
    args.text.replace(/\r?\n/g, "\r\n").replace(/^\./gm, ".."),
  ].join("\r\n");

  return new Promise<SendResult>((resolvePromise) => {
    const socket = createConnection({ host, port });
    let buffer = "";
    let step = 0;
    let settled = false;

    const finish = (result: SendResult) => {
      if (settled) return;
      settled = true;
      socket.end();
      resolvePromise(result);
    };

    const commands: Array<{ send: string; expect: number }> = [
      { send: `EHLO alerts.local`, expect: 250 },
      { send: `MAIL FROM:<${extractAddress(from)}>`, expect: 250 },
      { send: `RCPT TO:<${extractAddress(args.to)}>`, expect: 250 },
      { send: "DATA", expect: 354 },
      { send: `${message}\r\n.`, expect: 250 },
      { send: "QUIT", expect: 221 },
    ];

    socket.setTimeout(10_000, () => finish({ sent: false, detail: "SMTP timed out." }));
    socket.on("error", () => finish({ sent: false, detail: "The SMTP host could not be reached." }));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      // A reply is complete at a "NNN " line (multiline replies use "NNN-").
      if (!/^\d{3} [^\n]*\r?\n$/m.test(buffer)) return;
      const code = Number(buffer.match(/^(\d{3}) /m)?.[1] ?? 0);
      buffer = "";
      const expected = step === 0 ? 220 : commands[step - 1]!.expect;
      if (code !== expected) {
        finish({ sent: false, detail: `SMTP answered ${code} where ${expected} was expected.` });
        return;
      }
      if (step === commands.length) {
        finish({ sent: true, detail: null });
        return;
      }
      socket.write(`${commands[step]!.send}\r\n`);
      step += 1;
    });
  });
}

function extractAddress(value: string): string {
  const bracketed = value.match(/<([^>]+)>/);
  return (bracketed ? bracketed[1]! : value).trim();
}
