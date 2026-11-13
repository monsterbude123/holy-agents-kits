---
name: fy-newapi-cli
description: >-
  Operate a running new-api instance from the terminal with the bundled
  `fy-newapi-cli` admin tool. Use when the user asks to log in to a new-api
  server, inspect or manage users, channels, API tokens, logs, server
  options, subscription plans, app products, or OAuth apps, create an API
  key for an agent, script admin API calls, or
  maintain a new-api deployment without the web dashboard. Also use when a
  task mentions `fy-newapi-cli`, `/cli/authorize`, `~/.fy-newapi-cli/config.json`,
  or a `nap_` personal access token.
---

# fy-newapi-cli Admin Workflow

`fy-newapi-cli` is a thin HTTP client for the new-api admin API. It never touches
the database directly and only needs a server URL plus a personal access token
(PAT). Source lives in `cmd/fy-newapi-cli/`; it depends only on the standard
library and `spf13/cobra`.

## Install

- npm: `npm install -g @aswless_854771076/fy-newapi-cli` installs the matching
  binary from the package's GitHub release on Windows, macOS, and Linux.
  Installing it as a project dependency also copies the bundled `fy-newapi-cli`
  and `fy-new-api-app-framework` skills to `.agents/skills/` in that project.
- From source: `go build -o fy-newapi-cli ./cmd/fy-newapi-cli` on macOS/Linux; on
  Windows the output is `fy-newapi-cli.exe`.
- PATH (macOS/Linux): if the npm global prefix is not on `PATH`, locate it with
  `npm prefix -g`; the binary is under `<prefix>/bin`.

`~/.fy-newapi-cli/config.json` resolves from the OS user home on Windows, macOS,
and Linux (no `%APPDATA%` special case). Examples use a POSIX shell; PowerShell
users pass the same arguments unchanged (`--data` quoting applies).

The server must be the same build that embeds the dashboard, because the login
flow is served by the web UI. Rebuild and restart the server after changing
either the frontend or `controller/cli_auth.go`.

## Authenticate

```bash
fy-newapi-cli auth login                      # uses the packaged server by default
fy-newapi-cli auth login --server https://api.example.com --name my-agent
fy-newapi-cli auth status
fy-newapi-cli auth logout
```

`auth login` prints a `/cli/authorize` URL. Open it in a browser while signed
in to the dashboard, review the pre-selected permission matrix, confirm, then
paste the one-time code (43 characters, single use) back into the CLI. The CLI
exchanges it at `POST /api/cli/exchange` for a PAT and stores it locally. The
code cannot be reused or widened by the CLI; the grant is exactly what the user
approved.

- Config: `~/.fy-newapi-cli/config.json` (0600, directory 0700), one entry per
  profile. Never commit or print this file.
- Server selection: `--server` > `NEWAPI_CLI_SERVER` > the profile's stored
  server > the build-time default baked into release binaries. Re-run
  `auth login --server <url>` to switch servers; keep each server as its own
  profile with `--profile`.
- Profiles: `--profile <name>` or `NEWAPI_CLI_PROFILE`; default profile is
  `default`. Use one profile per server/environment.
- Non-interactive: `--server` skips the prompt, but the authorization code must
  still come from a browser session. There is no password login for the CLI.

## Commands

```text
auth login|status|logout
user   list | get <id>
channel list | get <id>
token  list | get <id> | create --name <name> [flags]
log    list | files | tail <file> | search <keyword>
option get <key> | update <key>=<value>
plan   list | create --title <title> | update <id>
product list | create | update <id> | enable <id> | disable <id> | orders | complete-order <trade_no>
oauth-app list | get <id> | create | update <id> | delete <id>
version | self-update [--run]
api    <METHOD> </path> [--data '<json>' | --data @file.json]
```

Global flags: `--profile <name>`, `--pretty`. Exact flags, app-scoped examples,
and read-modify-write semantics: `references/commands.md`.

`token create` returns the new token's **full** key exactly once; later reads
are masked. Capture it immediately.

## Output and exit codes

- Default: the unwrapped `data` field as indented JSON on stdout; empty `data`
  prints `null`. Errors go to stderr as
  `{"error":{"message":"...","code":"..."}}`.
- `--pretty`: objects print as `key: value` lines, arrays as an aligned table;
  cells truncate at 48 runes, list envelopes append `total` / `page` /
  `page_size`. Use the JSON form when pagination matters to a script.

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | General/API error (business failure, not found, HTTP error) |
| 2 | Authentication/authorization (`not_logged_in`, 401, 403, `invalid_grant`) |
| 3 | Usage error (bad flag, invalid argument, malformed `--data`) |

A 403 with `ACCESS_TOKEN_SCOPE_DENIED` means the PAT is valid but under-scoped:
re-run `auth login` and grant the scope, do not retry. Scope-to-command mapping
and the preselected set: `references/scopes.md`. `billing:read` / `billing:write`
are **not** preselected — grant them before using `plan` or `product`.

## Safety rules

- Treat the PAT as a credential: never print it, echo it into logs, paste it in
  chat, or write it into a repository file. `~/.fy-newapi-cli/config.json` stays
  outside version control.
- Prefer HTTPS; the token is sent as `Authorization: Bearer <PAT>`.
- Confirm with the user before destructive or production-wide actions:
  `option update`, creating/editing channels, deleting tokens,
  `product complete-order`, and any `api DELETE`/`api PUT`.
- Do not bypass the CLI to edit the database, scrape browser cookies, or reuse
  an authorization code. If a scope is missing, re-authorize.
- Run `auth logout` on shared machines; it removes the active profile only.

## Smoke test

```bash
fy-newapi-cli auth status
fy-newapi-cli api GET /api/user/self
```

If `auth status` reports `not_logged_in`, run `auth login`. If a call returns
403 `ACCESS_TOKEN_SCOPE_DENIED`, the PAT is valid but under-scoped.

## References

| File | Read when |
| --- | --- |
| `references/commands.md` | need an exact flag, a plan/product/oauth-app example, or update semantics |
| `references/scopes.md` | a call returns 403, or you need to know which scope a command needs |
| `references/api.md` | the endpoint has no subcommand; OAuth-app raw calls; `self.id` vs `auth.users.id` |
