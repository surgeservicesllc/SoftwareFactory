import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Signs a provider in, from the operator's own machine.
 *
 * The reason this exists as a CLI rather than a button: Anthropic and OpenAI
 * have no third-party OAuth. The only supported way to obtain a subscription
 * credential is their own tool running their own login in a browser. A button
 * in the control plane would have to impersonate the Claude Code CLI's private
 * OAuth client, which is undocumented and not ours to borrow.
 *
 * So the login happens here, where the provider's real tool already lives, and
 * only the result travels. The operator sees a browser they recognise and never
 * handles the token: it goes from the provider's tool to the control plane
 * without being printed, saved, or passed through a shell variable.
 *
 * Usage, produced for you by the console:
 *   npx -y tsx scripts/connect.mts claude --code <code> --host <origin>
 */

type Purpose = "claude" | "codex";

interface LoginPlan {
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
  /** Reads the credential the command produced. */
  readonly collect: (stdout: string) => Promise<string>;
}

/** Strips terminal control sequences before anything is matched against output. */
function clean(text: string): string {
  // Written as an explicit escape rather than a literal escape byte, which is
  // invisible in a diff. \u001B is the same character, spelled visibly.
  return text.replace(/\u001B\[[0-9;]*[A-Za-z]/g, "").trim();
}

const PLANS: Record<Purpose, LoginPlan> = {
  claude: {
    label: "Claude",
    command: "claude",
    args: ["setup-token"],
    // `claude setup-token` prints the long-lived token on stdout after the
    // browser approval. The last non-empty line is it.
    collect: async (stdout) => {
      const lines = clean(stdout).split("\n").map((line) => line.trim()).filter(Boolean);
      const candidate = [...lines].reverse().find((line) => /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(line));
      if (!candidate) {
        throw new Error(
          "Could not find a token in the output of `claude setup-token`. "
          + "Run it yourself to check it completed, then try again.",
        );
      }
      return candidate;
    },
  },
  codex: {
    label: "Codex",
    command: "codex",
    args: ["login"],
    // `codex login` writes the credential to disk rather than printing it.
    collect: async () => {
      const path = resolve(homedir(), ".codex/auth.json");
      try {
        const raw = await readFile(path, "utf8");
        JSON.parse(raw);
        return raw.trim();
      } catch {
        throw new Error(
          `Could not read ${path}. Run \`codex login\` yourself to check it completed, then try again.`,
        );
      }
    },
  },
};

function readFlag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

/**
 * Runs the provider's own login.
 *
 * stdin and stderr are inherited so the tool can prompt and open a browser;
 * only stdout is captured, because that is where a token would appear and it
 * must not reach the terminal.
 */
function runLogin(plan: LoginPlan): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(plan.command, [...plan.args], {
      stdio: ["inherit", "pipe", "inherit"],
    });

    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });

    child.on("error", () => {
      rejectPromise(new Error(
        `\`${plan.command}\` is not installed or not on PATH. Install it, sign in, and try again.`,
      ));
    });
    child.on("close", (code) => {
      if (code === 0) resolvePromise(stdout);
      else rejectPromise(new Error(`\`${plan.command} ${plan.args.join(" ")}\` exited with code ${code}.`));
    });
  });
}

/**
 * Account slots: `claude_2` runs the same login as `claude` but stores under
 * its own purpose, so further subscription accounts can be signed in
 * alongside the first — without limit. The number is only a name; the server
 * binds the seal to the exact purpose, so a token posted for one slot can
 * never be opened as another.
 */
const PURPOSE_PATTERN = /^(claude|codex)(?:_([2-9]|[1-9][0-9]{1,3}))?$/;

function planFor(purposeValue: string): LoginPlan | null {
  const match = PURPOSE_PATTERN.exec(purposeValue);
  if (!match) return null;
  return PLANS[match[1] as Purpose] ?? null;
}

async function main() {
  const purpose = process.argv[2];
  const code = readFlag("code");
  const host = readFlag("host");
  const plan = purpose ? planFor(purpose) : null;

  if (!purpose || !plan || !code || !host) {
    process.stderr.write(
      "Usage: tsx scripts/connect.mts <claude|codex|claude_2|codex_2|…> --code <code> --host <origin>\n"
      + "Start a sign-in from the SoftwareFactory console to get this command.\n",
    );
    process.exitCode = 1;
    return;
  }

  let origin: URL;
  try {
    origin = new URL(host);
  } catch {
    process.stderr.write("The --host value is not a valid URL.\n");
    process.exitCode = 1;
    return;
  }
  // The token is about to be posted to this origin. Refusing plain HTTP here is
  // the difference between an encrypted hop and a credential on the wire.
  if (origin.protocol !== "https:" && origin.hostname !== "localhost") {
    process.stderr.write("Refusing to send a credential over plain HTTP.\n");
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`Signing in to ${plan.label}. Your browser will open.\n`);

  let token: string;
  try {
    token = await plan.collect(await runLogin(plan));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "The login failed."}\n`);
    process.exitCode = 1;
    return;
  }

  const response = await fetch(new URL("/api/bots/connect/claim", origin), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, token }),
  });

  if (!response.ok) {
    // The server answers every failure identically on purpose, so there is no
    // detail to relay beyond "start again".
    process.stderr.write(
      "That sign-in link is no longer valid. Start a new one from the console.\n",
    );
    process.exitCode = 1;
    return;
  }

  // The token is never printed, here or anywhere. It went from the provider's
  // tool to the control plane without passing through the terminal.
  process.stdout.write(`${plan.label} is connected. You can close this terminal.\n`);
}

await main();
