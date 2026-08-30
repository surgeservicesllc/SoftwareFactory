// @vitest-environment node

import { createServer, type Server, type Socket } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { alertEmailConnected, sendAlertEmail } from "@/lib/job-seeker/alert-email";

/**
 * The SMTP transport, against a real socket: an in-test server speaks just
 * enough SMTP to accept one message, and the assertions read what actually
 * crossed the wire. The refusal cases matter as much as the delivery — the
 * transport is for the local stack's Mailpit sink, and anything that smells
 * like production SMTP (TLS, credentials) is refused rather than half done.
 */

type Captured = { commands: string[]; data: string };

function startSmtpServer(): Promise<{ server: Server; port: number; captured: Captured }> {
  const captured: Captured = { commands: [], data: "" };
  const server = createServer((socket: Socket) => {
    let inData = false;
    let buffer = "";
    socket.write("220 test ready\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end === -1) return;
          captured.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          socket.write("250 ok stored\r\n");
          continue;
        }
        const lineEnd = buffer.indexOf("\r\n");
        if (lineEnd === -1) return;
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        captured.commands.push(line);
        if (line === "DATA") {
          inData = true;
          socket.write("354 go ahead\r\n");
        } else if (line === "QUIT") {
          socket.write("221 bye\r\n");
        } else {
          socket.write("250 ok\r\n");
        }
      }
    });
  });
  return new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolvePromise({ server, port, captured });
    });
  });
}

let server: Server | null = null;

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  if (server) {
    await new Promise((done) => server?.close(done));
    server = null;
  }
});

describe("the SMTP transport", () => {
  it("counts as connected with an SMTP URL and a from address, without any Resend key", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("JOB_ALERT_SMTP_URL", "smtp://127.0.0.1:2525");
    vi.stubEnv("JOB_ALERT_EMAIL_FROM", "alerts@example.org");
    expect(alertEmailConnected()).toBe(true);
  });

  it("delivers the message over a real socket, with the facts intact", async () => {
    const started = await startSmtpServer();
    server = started.server;
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("JOB_ALERT_SMTP_URL", `smtp://127.0.0.1:${started.port}`);
    vi.stubEnv("JOB_ALERT_EMAIL_FROM", "Job Alerts <alerts@example.org>");

    const result = await sendAlertEmail({
      to: "seeker@example.org",
      subject: "1 new job for Remote marketing",
      text: "Contra — Growth Marketing Manager\nApply: https://remotive.com/remote-jobs/1\n.starts with a dot",
    });

    expect(result).toEqual({ sent: true, detail: null });
    expect(started.captured.commands).toContain("MAIL FROM:<alerts@example.org>");
    expect(started.captured.commands).toContain("RCPT TO:<seeker@example.org>");
    expect(started.captured.data).toContain("Subject: 1 new job for Remote marketing");
    expect(started.captured.data).toContain("Contra — Growth Marketing Manager");
    expect(started.captured.data).toContain("Apply: https://remotive.com/remote-jobs/1");
    // RFC 5321 dot transparency: the leading dot was doubled on the wire.
    expect(started.captured.data).toContain("\r\n..starts with a dot");
  });

  it("refuses TLS or credentialed URLs instead of half-implementing security", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("JOB_ALERT_EMAIL_FROM", "alerts@example.org");

    vi.stubEnv("JOB_ALERT_SMTP_URL", "smtps://mail.example.org:465");
    let result = await sendAlertEmail({ to: "a@b.c", subject: "s", text: "t" });
    expect(result.sent).toBe(false);
    expect(result.detail).toMatch(/plain smtp/);

    vi.stubEnv("JOB_ALERT_SMTP_URL", "smtp://user:pass@mail.example.org:25");
    result = await sendAlertEmail({ to: "a@b.c", subject: "s", text: "t" });
    expect(result.sent).toBe(false);
    expect(result.detail).toMatch(/plain smtp/);
  });

  it("reports an unreachable host as a failed send, never as a sent one", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("JOB_ALERT_SMTP_URL", "smtp://127.0.0.1:1");
    vi.stubEnv("JOB_ALERT_EMAIL_FROM", "alerts@example.org");
    const result = await sendAlertEmail({ to: "a@b.c", subject: "s", text: "t" });
    expect(result.sent).toBe(false);
  });

  it("prefers Resend when both transports are configured", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      vi.stubEnv("RESEND_API_KEY", "resendkeyfortests");
      vi.stubEnv("JOB_ALERT_SMTP_URL", "smtp://127.0.0.1:2525");
      vi.stubEnv("JOB_ALERT_EMAIL_FROM", "alerts@example.org");
      const result = await sendAlertEmail({ to: "a@b.c", subject: "s", text: "t" });
      expect(result.sent).toBe(true);
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
