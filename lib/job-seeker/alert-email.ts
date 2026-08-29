import "server-only";

/**
 * The alert mailer: a thin REST client over Resend, env-gated.
 *
 * The project has no application-level email provider — Supabase Auth's SMTP
 * belongs to the auth mailer and the application never touches it — so this
 * builds one, the same way billing built its Stripe client: raw REST, no SDK,
 * secrets read server-side only, and a `connected` predicate the UI renders
 * as **Not Connected** until the owner supplies:
 *
 *   RESEND_API_KEY        an API key from resend.com
 *   JOB_ALERT_EMAIL_FROM  a from address on a domain verified with Resend
 *
 * Without both, nothing sends, nothing pretends to send, and the alert
 * controls say why.
 */

const RESEND_URL = "https://api.resend.com/emails";

export function alertEmailConnected(): boolean {
  return Boolean(process.env.RESEND_API_KEY) && Boolean(process.env.JOB_ALERT_EMAIL_FROM);
}

export type SendResult = Readonly<{ sent: boolean; detail: string | null }>;

export async function sendAlertEmail(args: Readonly<{
  to: string;
  subject: string;
  text: string;
}>): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.JOB_ALERT_EMAIL_FROM;
  if (!key || !from) {
    return { sent: false, detail: "Email is not configured (RESEND_API_KEY, JOB_ALERT_EMAIL_FROM)." };
  }
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
