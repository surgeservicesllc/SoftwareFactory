# Security guide

SoftwareFactory treats the browser, provider responses, webhook payloads, repository content, and model output as untrusted. Next.js server code is the application authorization boundary, and Supabase Row Level Security is an independent tenant-isolation boundary.

## Non-negotiable rules

- Privileged keys, service-role credentials, tokens, passwords, and private keys never enter browser code, props, logs, source maps, database rows, fixtures, reports, or source control.
- Every sensitive read and mutation authenticates the user and checks organization membership/resource ownership on the server.
- RLS remains enabled and is tested for allowed access plus cross-tenant and anonymous denial.
- Connections store provider-neutral metadata and an opaque server-side secret reference, not credential material.
- RED actions require exact, current, explicit owner approval in Phase 1.
- External mutations use least privilege, idempotency, replay protection, bounded retries, redaction, and audit events.
- CI has read-only repository access and no merge/deploy credentials.

The local repository-memory write switch is disabled by default and is safe only for a trusted, single-user local process. It must remain disabled in hosted environments until an authenticated multi-tenant file-write boundary and version history are implemented.

See [the complete security model](SECURITY_MODEL.md), [environment-variable rules](ENVIRONMENT_VARIABLES.md), and `policies/PROTECTED_RESOURCES.md`. Report vulnerabilities through the private process in the repository-root `SECURITY.md`.
