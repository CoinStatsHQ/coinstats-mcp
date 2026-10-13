# Agent instructions

## This repository is public

`CoinStatsHQ/coinstats-mcp` is open source. Anyone can read everything that lands here: code, comments, tests, fixtures, commit messages, branch names, PR titles and descriptions, and review comments. Write all of it for an outside reader.

- **No secrets or account identifiers.** Don't commit API keys, tokens, OAuth client secrets, Cloudflare account IDs, or internal hostnames and IPs. Configuration comes from the environment (see `README.md`).
- **No internal details.** Don't name private CoinStats repositories, internal file paths, function or class names, database collections, dashboards, tickets or chat threads. When upstream behavior matters, describe it in terms of the public CoinStats API ("connects the exchange on first use"), not the code behind it.
- **No real user data.** Don't paste production logs, traces, portfolio IDs, user IDs, emails, or wallet addresses that belong to real users. Use clearly fake fixtures. Well-known public addresses such as `vitalik.eth` are fine.
- **Keep working notes out.** Investigation output, AI review transcripts and scratch files stay out of the repo and out of PR descriptions.
- **One clean commit per PR.** Squash before merging, and make the commit message and PR description stand on their own.

Force-pushing or editing a PR doesn't remove something from GitHub. If anything sensitive gets pushed, stop and tell a maintainer so it can be rotated or purged.
