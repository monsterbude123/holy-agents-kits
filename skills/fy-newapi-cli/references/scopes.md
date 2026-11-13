# Permissions carried by the PAT

The PAT carries Casbin scopes. A command whose resource/action is missing
fails with HTTP 403, code `ACCESS_TOKEN_SCOPE_DENIED`, exit code 2 — re-run
`auth login` and grant the missing scope rather than retrying.

| Commands | Scopes |
| --- | --- |
| `user list`, `user get` | `user:read` |
| `channel list`, `channel get` | `channel:read` |
| `token list`, `token get`, `token create` | `api_key:read`, `api_key:write` |
| `log list` | `log:read` |
| `log files`, `log tail`, `log search` | `ops:read` (also requires a root-role token) |
| `option get` | `option:read` |
| `option update` | `option:write` |
| `plan list`, `product list`, `product orders` | `billing:read` |
| `plan create` | `billing:write` |
| `plan update <id>`, `product update <id>` | `billing:read`, `billing:write` |
| `product create`, `product enable`, `product disable`, `product complete-order` | `billing:write` |
| `oauth-app list`, `oauth-app get <id>` | `option:read` |
| `oauth-app create`, `oauth-app update <id>`, `oauth-app delete <id>` | `option:write` |
| `api ...` | the scope of the target endpoint |
| `auth status` | none (local config only) |

The authorize page preselects `profile:read`, `usage:read`, `api_key:read`,
`api_key:write`, `user:read`, `user:write`, `channel:read`, `log:read`,
`model:read`, `model:write`, `deployment:read`, `deployment:write`,
`option:read`, `option:write`. `billing:read` and `billing:write` are not
preselected, so grant them on the authorize page before using `plan` or
`product`.
