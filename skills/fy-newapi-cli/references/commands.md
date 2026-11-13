# Commands, flags, and examples

Full command surface of `fy-newapi-cli`. SKILL.md keeps the short index; read this file when you
need an exact flag, an example, or the read-modify-write semantics.

## Command tree

```text
auth login|status|logout
user   list [--p 1] [--page-size 20] [--app-id <id>] | get <id>
channel list [--p 1] [--page-size 20] | get <id>
token  list [--p 1] [--page-size 20] | get <id> | create --name <name> [flags]
log    list [--p 1] [--page-size 20] [--type <n>] [--start-timestamp <s>]
            [--end-timestamp <s>] [--model-name <m>] [--token-name <t>]
            [--group <g>] [--request-id <id>] [--upstream-request-id <id>]
            [--username <u>] [--channel <id>]
        | files
        | tail <file> [--lines N] [--follow]
        | search <keyword> [--since <duration>] [--limit N]
option get <key> | update <key>=<value>
plan   list [--p 1] [--page-size 20] [--app-id <id>]
        | create --title <title> [flags]
        | update <id> [flags]
product list [--app-id <id>] [--p 1] [--page-size 20]
        | create --app-id <id> --name <name> --price <amount> --quota <n> [flags]
        | update <id> [flags]
        | enable <id> | disable <id>
        | orders [--app-id <id>] [--user-id <id>] [--p 1] [--page-size 20]
        | complete-order <trade_no>
oauth-app list | get <id> | create [flags] | update <id> [flags] | delete <id>
version
self-update [--run]
api    <METHOD> </path> [--data '<json>' | --data @file.json]
```

Global flags: `--profile <name>`, `--pretty`.

## `token create` flags

- `--name` (required, max 50 characters).
- `--unlimited-quota` (default `true`): ignores `--quota`.
- `--quota` (default `500000`): only sent when `--unlimited-quota=false`.
- `--expires-in` (Go duration, e.g. `24h`, `720h`): empty means never expires
  (`expired_time = -1`). Invalid durations and negative quota return
  `usage_error` (exit 3).

The create response includes the new token `id` and its **full** `key`. This is
the only time the key is returned; later `token list` / `token get` calls are
masked. Capture it immediately if the caller needs the key.

## App-scoped plans and products

Every plan, product, and app wallet belongs to one app. Omit `--app-id` to see
the platform-wide view; pass it to read that app's data.

```bash
fy-newapi-cli user list --app-id 3                 # adds app_quota / app_used_quota
fy-newapi-cli plan list --app-id 3
fy-newapi-cli plan create --app-id 3 --title "Starter" --price 9.99 --total-amount 100000 \
  --duration-unit month --duration-value 1 --quota-reset-period monthly
fy-newapi-cli plan update 12 --price 12.99 --enabled=false
fy-newapi-cli product list --app-id 3
fy-newapi-cli product create --app-id 3 --name "Starter" --price 9.99 --quota 100000 \
  --description "Starter pack" --currency USD --max-purchase-per-user 1
fy-newapi-cli product update 12 --price 12.99 --enabled=false
fy-newapi-cli product disable 12
fy-newapi-cli product orders --app-id 3 --user-id 42
fy-newapi-cli product complete-order APO123         # write: credits the app wallet

# OAuth apps (外部 Web app)
fy-newapi-cli oauth-app list
fy-newapi-cli oauth-app get 7
fy-newapi-cli oauth-app create --name "My App" \
  --redirect-uris https://app.example.com/callback \
  --post-logout-redirect-uris https://app.example.com/logout \
  --scopes openid,profile,email,api:read,api:write --public-client
fy-newapi-cli oauth-app update 7 --redirect-uris https://app.example.com/callback,https://new.example.com/callback
fy-newapi-cli oauth-app update 7 --status 2
fy-newapi-cli oauth-app delete 7
```

`product create` flags:

- `--app-id`, `--name` (required), `--price` (required, `price_amount`),
  `--quota` (required, `quota_amount`).
- `--description`, `--currency` (default `USD`), `--sort-order`,
  `--max-purchase-per-user` (0 means unlimited), `--enabled` (default `true`),
  `--stripe-price-id`, `--creem-product-id`, `--waffo-pancake-product-id`.

`plan create` flags:

- `--title` (required), `--app-id` (default `0` = platform-wide), `--price`
  (`price_amount`), `--currency` (default `USD`), `--duration-unit`
  (default `month`; `year|month|day|hour|custom`), `--duration-value`
  (default `1`), `--custom-seconds`, `--enabled` (default `true`),
  `--sort-order`, `--allow-balance-pay` (default `true`),
  `--allow-wallet-overflow` (default `true`), `--stripe-price-id`,
  `--creem-product-id`, `--waffo-pancake-product-id`,
  `--max-purchase-per-user` (0 means unlimited), `--upgrade-group`,
  `--downgrade-group`, `--total-amount` (quota units, 0 means unlimited),
  `--quota-reset-period` (default `never`; `never|daily|weekly|monthly|custom`),
  `--quota-reset-custom-seconds`.

`oauth-app create` flags:

- `--name` (required), `--redirect-uris` (required, comma-separated),
  `--scopes` (required, comma-separated).
- `--post-logout-redirect-uris` (comma-separated), `--public-client` (bool,
  no client secret), `--logo-url`, `--supabase-project-ref`,
  `--waffo-pancake-return-url`. `oauth-app create` always yields an enabled
  app; `--status` exists only on `oauth-app update` (`1` enabled, `2`
  disabled).

## Update semantics and quirks

- `product update` reads the current product with `GET /api/app-products/<id>`,
  overlays the flags you pass, then `PUT`s the complete object. Fields you do
  not pass keep their current value, so `product update 12 --price 12.99`
  changes only the price.
- `plan update` and `oauth-app update` follow the same read-modify-write
  pattern. `plan update` reads the current record from the plan list (the
  admin API has no per-plan GET), overlays the passed flags, then `PUT`s the
  complete `{"plan": {...}}` object. `oauth-app update` reads with
  `GET /api/oauth-apps/<id>` then `PUT`s the full object.
- `plan list` returns every plan; the admin plans endpoint accepts the
  pagination flags but does not limit the result.
- `product orders` filters by app and user only; the endpoint has no product
  filter.
- Negative `--app-id`, `--price`, `--quota`, `--max-purchase-per-user`, or
  `--total-amount`, an empty `--title`/`--name`, and a missing required flag
  return `usage_error` (exit 3).

## Version and self-update

```bash
fy-newapi-cli version              # prints the version, then checks npm for updates
fy-newapi-cli self-update          # prints the command without running it
fy-newapi-cli self-update --run    # runs npm install -g @aswless_854771076/fy-newapi-cli@latest
```

`version` is non-fatal: a failed or unreachable registry lookup is silently
skipped. `self-update` refreshes the binary and the bundled `fy-newapi-cli` skill
(server default and skill version ship with the npm package).
