---
name: GitHub PAT scopes
description: Which PAT to use for which GitHub operations
---

Two GitHub PATs are available in the Replit secrets:

- `GITHUB_PAT` — write access to osr21's own repos only (e.g. osr21/arc-stablecoin-dapp). Cannot comment on third-party org repos like circlefin/arc-node.
- `GITHUB_PERSONAL_ACCESS_TOKEN1` — has `public_repo` scope; can post comments on any public repo including circlefin/arc-node.

**Why:** Discovered when trying to comment on circlefin/arc-node — GITHUB_PAT returned "Resource not accessible by personal access token". GITHUB_PERSONAL_ACCESS_TOKEN1 succeeded.

**How to apply:** For any GitHub Contents API or push to osr21/* repos, use GITHUB_PAT. For commenting on third-party public repos, use GITHUB_PERSONAL_ACCESS_TOKEN1.
