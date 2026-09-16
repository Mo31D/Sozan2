# Build notes

CI is mandatory from the first foundation commit. Dependency and type errors must be fixed before Cloudflare deployment.

Cloud bootstrap: the production deploy command applies pending D1 migrations before deploying the Worker. This note intentionally triggers the first migration-enabled Cloudflare build after the `DB` binding was established.
