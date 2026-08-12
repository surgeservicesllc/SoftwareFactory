# Security policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or include credentials, private repository content, personal data, or exploit details in public channels.

Use GitHub's private vulnerability reporting/security-advisory flow for this repository when available. If it is not enabled, contact the repository owner through an already approved private channel and request a secure reporting path. Include the affected area, impact, reproducible steps, and a minimal redacted proof; never include a live secret.

## Immediate credential exposure response

If a credential may have been disclosed, revoke or rotate it immediately through the provider, stop affected automation, and notify the owner. Deleting the value from a file or Git history does not make the old credential safe.

## Supported phase

SoftwareFactory is currently a Phase 1A control-plane foundation. Live provider integrations and autonomous production execution are not supported. Security reports about unsafe claims, tenant isolation, RLS, authorization, audit integrity, or browser-exposed secrets are in scope.
