# Future GitHub App integration

Status: **Not Connected** in Phase 1A.

## Why a GitHub App

A GitHub App supports installation-scoped permissions, short-lived installation tokens, organization-controlled repository selection, signed webhooks, and auditable identity. It is preferred over shared personal access tokens for multi-tenant repository automation.

## Domain mapping

- A GitHub App installation becomes a provider-neutral `connection` owned by an organization/user.
- `project_connections` attaches that connection to a project for a declared purpose.
- Store installation/account/repository metadata and an opaque secret reference only.
- Never store the App private key, webhook secret, installation token, OAuth token, or user password in application tables.
- Agents reference connection capability; they do not become GitHub accounts.

## Proposed connection flow

1. An authenticated owner initiates installation from a server-generated, time-bound state value.
2. GitHub completes installation and returns identifiers, not a reusable browser token.
3. Trusted server code verifies state, membership/ownership, and the selected repositories.
4. The control plane stores installation metadata and creates an activity event.
5. Server code signs a JWT with the protected App private key only when needed, exchanges it for a short-lived installation token, and never returns that token to the browser.
6. A health check verifies installation identity/permissions before displaying Connected.

## Initial least-privilege scope

Begin read-only for repository metadata, contents, pull requests, checks, and issues only as required by Phase 1B. Add write scopes one at a time with an explicit feature, risk review, non-production test, and owner-approved installation update. Do not request administration, secrets, organization-owner, workflow-write, or broad repository access speculatively.

## Webhooks

- Verify GitHub's signature against the raw request body with the server-only webhook secret before parsing.
- Validate event/action shape and installation/repository membership.
- Store the delivery ID and process idempotently to prevent replay/duplication.
- Acknowledge quickly and enqueue durable work; do not perform long agent execution in the webhook request.
- Redact payloads and retain only fields required for reconciliation/audit.
- Handle out-of-order/missing delivery through periodic least-privilege reconciliation.

## Safe implementation stages

1. Register a development App with read-only permissions and a non-production webhook endpoint.
2. Implement install/uninstall/suspend and repository-selection reconciliation.
3. Add read-only project discovery and PR/check status.
4. Add signed webhook ingestion, deduplication, and audit events.
5. Add isolated draft-PR creation with repository allowlists.
6. Keep merging governed by `policies/AUTO_MERGE_POLICY.md`; Phase 1A never auto-merges.

## Definition of connected

Do not remove **Not Connected** until a fresh server-side check confirms the expected App identity, active installation, tenant ownership, allowed repository, required permissions, webhook verification, token exchange, failure handling, and redacted audit evidence. Configuration fields alone do not prove connectivity.
