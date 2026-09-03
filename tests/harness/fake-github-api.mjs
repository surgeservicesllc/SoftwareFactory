/**
 * A fake of the three GitHub API endpoints the release base needs, for the
 * fake-data journey lane only.
 *
 * The application pins its GitHub client to https://api.github.com and never
 * accepts another origin, so this fake is reached the way a person would fake
 * a host: the lane points api.github.com at 127.0.0.1 in /etc/hosts and trusts
 * a self-signed certificate for that name through NODE_EXTRA_CA_CERTS. No
 * production code changes, no switch that could ever point production at a
 * fake. Everything served here is fake data: an installation token that opens
 * nothing, a branch tip that names no real commit, and a release policy
 * written for the seeded fake-owner/storefront repository.
 *
 * Endpoints:
 *   POST /app/installations/{id}/access_tokens          the installation token
 *   GET  /repos/{owner}/{repo}/git/ref/heads/{branch}    the branch reference
 *   GET  /repos/{owner}/{repo}/contents/{path}?ref=...   the release policy
 * Everything else answers 404 like GitHub does, and every request is logged.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:https";

const port = Number(process.env.FAKE_GITHUB_PORT ?? "443");
const installationId = process.env.FAKE_GITHUB_INSTALLATION_ID ?? "700123";
const repository = process.env.FAKE_GITHUB_REPOSITORY ?? "fake-owner/storefront";
const branch = process.env.FAKE_GITHUB_BRANCH ?? "main";
const baseSha = (process.env.FAKE_GITHUB_BASE_SHA ?? "f0e1d2c3b4a5968778695a4b3c2d1e0f10203040").toLowerCase();
const requiredChecks = (process.env.FAKE_GITHUB_REQUIRED_CHECKS ?? "Lint, typecheck, test, and build")
  .split("|").map((name) => name.trim()).filter(Boolean);
const policyPath = ".softwarefactory/release-policy.json";
const policy = `${JSON.stringify({ version: 1, requiredChecks }, null, 2)}\n`;
const policyBytes = Buffer.from(policy, "utf8");

if (!/^[0-9a-f]{40}$/.test(baseSha)) {
  console.error("FAKE_GITHUB_BASE_SHA must be 40 hex characters.");
  process.exit(2);
}

const [owner, name] = repository.split("/");
const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "x-github-request-id": `FAKE-${randomBytes(4).toString("hex")}`,
  });
  response.end(payload);
}

const server = createServer(
  {
    key: readFileSync(process.env.FAKE_GITHUB_TLS_KEY ?? ".fake-github/tls-key.pem"),
    cert: readFileSync(process.env.FAKE_GITHUB_TLS_CERT ?? ".fake-github/tls-cert.pem"),
  },
  (request, response) => {
    const url = new URL(request.url ?? "/", "https://api.github.com");
    const line = `${request.method} ${url.pathname}${url.search}`;
    if (!request.headers.authorization) {
      console.log(`${line} -> 401 (no Authorization header)`);
      json(response, 401, { message: "Requires authentication" });
      return;
    }
    if (request.method === "POST" && url.pathname === `/app/installations/${installationId}/access_tokens`) {
      console.log(`${line} -> 201`);
      json(response, 201, {
        token: `fake-installation-token-${randomBytes(12).toString("hex")}`,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        permissions: { contents: "read", metadata: "read" },
        repository_selection: "selected",
      });
      return;
    }
    if (request.method === "GET" && url.pathname === `${repoPath}/git/ref/heads/${encodeURIComponent(branch)}`) {
      console.log(`${line} -> 200`);
      json(response, 200, {
        ref: `refs/heads/${branch}`,
        node_id: "FAKE_REF",
        url: `https://api.github.com${repoPath}/git/refs/heads/${branch}`,
        object: { type: "commit", sha: baseSha, url: `https://api.github.com${repoPath}/git/commits/${baseSha}` },
      });
      return;
    }
    if (request.method === "GET" && url.pathname === `${repoPath}/contents/${policyPath}`) {
      const ref = url.searchParams.get("ref");
      if (ref !== baseSha) {
        console.log(`${line} -> 404 (ref is not the fake branch tip)`);
        json(response, 404, { message: "Not Found" });
        return;
      }
      console.log(`${line} -> 200`);
      json(response, 200, {
        name: "release-policy.json",
        path: policyPath,
        type: "file",
        sha: createHash("sha1").update(`blob ${policyBytes.length}\0`).update(policyBytes).digest("hex"),
        size: policyBytes.length,
        html_url: null,
        encoding: "base64",
        content: policyBytes.toString("base64"),
      });
      return;
    }
    console.log(`${line} -> 404`);
    json(response, 404, { message: "Not Found" });
  },
);

server.listen(port, "127.0.0.1", () => {
  console.log(`fake GitHub API for ${repository}@${branch} (${baseSha}) listening on 127.0.0.1:${port}`);
});
