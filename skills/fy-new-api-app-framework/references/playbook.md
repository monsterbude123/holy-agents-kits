# Implementation Playbook

Step-level detail for `fy-new-api-app-framework`. SKILL.md keeps the contract and the
non-negotiable rules; this file holds the commands, tables, and checklists for each step.

## Step 0: Environment Bootstrap

Install the toolchain and prove both sides of the trust chain agree. Run every command in the working copy you are building.

### 0.1 One command with optional auto-install

`./scripts/check-env.ps1 -Install` (Windows) / `./scripts/check-env.sh --install` (macOS/Linux). Without the flag they only verify and print the exact fix; with it they install missing CLIs through the platform package manager or npm (including `supabase` and `vercel`) and re-run the checks. `fy-newapi-cli` is bundled with the `fy-newapi-cli` skill and is verified, not installed.

### 0.2 Install the CLIs manually

```text
Windows:      winget install Oven-sh.Bun GoLang.Go Supabase.CLI Cloudflare.cloudflared
macOS/Linux:  brew install oven-sh/bun/bun go supabase/tap/supabase cloudflared
Both:         bun add -g vercel   ·   fy-newapi-cli --version   # verified, not installed
```

### 0.3 One-shot bootstrap

```text
Windows:      Copy-Item "<skill-root>/scripts/bootstrap.ps1" .\scripts\bootstrap.ps1; .\scripts\bootstrap.ps1 -ProjectName "My App" [-ClientIdOverride <id>] [-PackRoot <dir>]
macOS/Linux:  cp "<skill-root>/scripts/bootstrap.sh" scripts/bootstrap.sh; bash scripts/bootstrap.sh --project-name "My App" [--client-id <id>] [--pack-root <dir>]
```

Both scripts are project-agnostic (no hardcoded paths) and need `fy-newapi-cli` logged in, the `supabase` CLI, and `bun` only when a pack root is given. They run eight steps: probe login, self user, and OAuth apps (reusing an existing public client) → `supabase link` via that app's project ref → read anon + service_role keys → write `.env.local` → `supabase db push` → check or rebuild `custom:newapi` (DELETE + POST on issuer mismatch) → authorize smoke test (302 = OK) → resolve the first admin's `auth.users` UUID, insert `app_admins(role='owner')`, and write `INITIAL_ADMIN_SUB` back. bootstrap 自动把 scopes 设为 `openid profile email api:read api:write`，Supabase provider scopes 同步更新——这保证登录后你既拿到身份也拿到额度/充值/日志能力。

Manual equivalent: `supabase login`, `supabase init` (new `supabase/` only), `supabase link --project-ref <project-ref>`, `supabase db push`, `supabase functions deploy user-sync`.

### 0.4 Run the self-check

Both scripts verify the six CLIs exist, the four env vars below are set, `discovery.issuer` equals `GATEWAY_PUBLIC_URL`, `custom:newapi` exists with a matching issuer, and `GET <supabase>/auth/v1/authorize?provider=custom:newapi` returns 302/303/307. Any failure exits non-zero with the fix; do not continue to Step 1 until it passes.

```text
macOS/Linux:  GATEWAY_BASE_URL=... GATEWAY_PUBLIC_URL=... SUPABASE_URL=... SUPABASE_SECRET_KEY=... ./scripts/check-env.sh
Windows:      $env:GATEWAY_BASE_URL='...'; $env:GATEWAY_PUBLIC_URL='...'; $env:SUPABASE_URL='...'; $env:SUPABASE_SECRET_KEY='...'; ./scripts/check-env.ps1
```

### 0.5 Scaffold the Next.js app

`bunx create-next-app@latest my-app --typescript --app --tailwind --eslint --src-dir --import-alias "@/*"`, then `cd my-app && bun add @supabase/supabase-js @supabase/ssr && bun add -D daisyui@latest`. Enable DaisyUI in `src/app/globals.css` (`@import "tailwindcss";` + `@plugin "daisyui";`), then run `bun run dev` and `bun run build`.

## Step 1: Project Structure

Use the App Router: route handlers own server secrets; pages stay renderable on the server.

```text
my-app/
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx                    # root layout, theme, providers
│  │  ├─ globals.css                   # Tailwind v4 + @plugin "daisyui";
│  │  ├─ page.tsx                      # /
│  │  ├─ login/page.tsx                # /login
│  │  ├─ auth/
│  │  │  ├─ start/route.ts             # begins OAuth (BFF mode)
│  │  │  └─ callback/route.ts          # code exchange (BFF) or page.tsx (public)
│  │  ├─ wardrobe/page.tsx             # /wardrobe
│  │  ├─ history/page.tsx              # /history
│  │  ├─ profile/page.tsx              # /profile
│  │  └─ api/relay/[...path]/route.ts  # optional BFF proxy for /v1/*
│  ├─ components/                      # DaisyUI-composed UI
│  ├─ lib/
│  │    ├─ supabase/client.ts            # browser client (anon key)
│  │    ├─ supabase/server.ts            # server client (cookies)
│  │    ├─ gateway-session.ts            # gateway refresh + 401 retry
│  │    └─ gateway.ts                    # AI relay calls
│  └─ proxy.ts                         # Supabase session refresh (middleware.ts pre-16)
├─ supabase/{config.toml, migrations/<timestamp>_*.sql, functions/user-sync/index.ts}
└─ public/ · .env.example · next.config.ts · package.json · tsconfig.json
```

`src/lib/supabase/client.ts` uses only the anon/publishable key and is safe in the browser; `server.ts` reads cookies and still uses the anon key unless a route explicitly needs elevated privileges. The `service_role` / secret key is imported only by trusted server code or an Edge Function, never by a Client Component and never with a `NEXT_PUBLIC_` prefix. Business data access goes through Supabase + RLS; if you choose a BFF instead, business tables can live in your own database, but the identity and billing chapters still apply. The runnable reference app follows this layout, with the consumer routes under `(consumer)` route groups and an `admin/` tree for the Ant Design console; see `references/web/outfit-demo/README.md`.

## Step 4: Users, Quota, and Payments — endpoint contracts

| Endpoint | Scope | Contract |
|----------|-------|----------|
| `GET /oauth/userinfo` | `openid`; `api:read` for quota | `sub`, plus `username` / `name` (`profile`) and `email` (`email`). With `api:read`: `quota`, `used_quota`, `request_count`, `group`, and `app_quota` / `app_used_quota` for the token's App. |
| `GET /oauth/subscription/plans` | `api:read` | `{"plans":[{"plan":{...}}]}` — enabled plans owned by this App only. |
| `POST /oauth/subscription/checkout` | `api:write` | `{"plan_id":1,"payment_method":"balance"}`; balance returns `{"status":"success","payment_method":"balance"}`, online methods return a `pending` order with a checkout link. |
| `GET /oauth/products` | `api:read` | `{"products":[{id,name,description,price_amount,currency,quota_amount,max_purchase_per_user}]}` — enabled products of this App only. |
| `POST /oauth/products/checkout` | `api:write` | `{"product_id":1,"payment_method":"balance"}`; balance returns `{"status":"success","order_id":"...","quota_amount":...}`, `waffo_pancake` returns `checkout_url`. |
| `POST /oauth/topup/checkout` | `api:write` | `{"amount":10,"payment_method":"balance"}`; balance returns `{"status":"success","quota":...}`, `waffo_pancake` returns `checkout_url` / `order_id` / `expires_at`. |
| `GET /oauth/logs` | `api:read` | Redacted request logs of the token owner. |

- **Payment matrix** — plans: `balance`, `epay`, `stripe`, `creem`, `waffo_pancake`; products: `balance`, `waffo_pancake`; App top-up: `balance`, `waffo_pancake`. Any other value returns `400` `unsupported_payment_method`. `balance` on a plan or product debits the App pool; `balance` on top-up moves platform balance into the App pool.
- **Cross-App purchase is rejected**: a plan or product owned by another App, a disabled plan/product, or a reached per-user purchase limit returns `403 access_denied` or `400 checkout_failed`; a missing `plan_id` / `product_id` returns `400 invalid_request`, as does an omitted `payment_method` on plan or product checkout (top-up defaults to `waffo_pancake`).
- **No OAuth endpoint reads App subscription state or App order history yet**: treat the checkout response as an order handle, confirm top-up/product effects by re-reading `/oauth/userinfo` (`app_quota`), keep your own record for plans, and never treat a browser return URL or a `pending` order as proof of payment.
- Link accounts on `sub` from `GET /oauth/userinfo`; `username` and `email` are mutable and email may be empty. OAuth login never creates a new-api user.
- 外部 app 用 OAuth access token 调 `/oauth/userinfo` 拿身份与额度，站内充值走 `/oauth/topup/checkout`（modal），套餐/商品走 `/oauth/subscription/*` 和 `/oauth/products*`，日志走 `/oauth/logs`；不要跳 newapi 仪表板。
- 每个 App 在后台独立配置自己的套餐与商品（按 `app_id` 归属），外部 app 只看到自己 App 的那一份；后台按 App 筛选用户与订单见 `references/standards/api-contract.md`。
- PATs (`nap_...`, shown once, scoped, `expires_at` at least 1 hour ahead when set) need a browser session and a security proof; a PAT cannot mint another PAT and never exceeds the user's role.
- `amount` is in the configured display unit — never send a quota value as an `amount`.

## Step 5: Backend on Supabase — client matrix

| Client | Key | Rule |
|--------|-----|------|
| Browser | anon / publishable | Relies on RLS for authorization |
| Server | `@supabase/ssr` + cookies | Same session in Server Components and Route Handlers |
| Session refresh | `proxy.ts` (`middleware.ts` before Next.js 16) | `getUser()` keeps the cookie session fresh and protects routes |
| Trusted server / Edge Function | `service_role` / secret | Bypasses RLS; never expose it and never prefix it with `NEXT_PUBLIC_` |

- Edge Functions verify the caller with `supabase.auth.getUser()`, resolve `gateway_user_id` / `client_id` through the same protected provider identity and server mapping/config, and use the service-role key only inside the function. Work beyond the function limits returns a job id (see **Long-Running Work and Supabase Limits** in `references/standards/supabase.md`).
- The app-side `seed-assets.ts` uploads a `pack.json` asset library and upserts by `(client_id, provider_id)`; bootstrap runs it when a pack root is given (see **Seeding the Asset Packs** in `references/standards/supabase.md`).

## Step 6: Frontend standards

- Server Components by default; `'use client'` only on the smallest interactive leaf.
- Reuse an existing component before writing markup; compose DaisyUI (`btn`, `card`, `navbar`, `drawer`, `modal`, `table`, `tabs`, `alert`, `loading`, `skeleton`) and set the theme once with `data-theme` on `<html>`.
- **Only invalid DaisyUI 5 classes**: `input-bordered`, `textarea-bordered`, `select-bordered`, `card-compact`, `card-bordered`, `tabs-boxed`, the removed `btn-group`/`input-group`, and the non-existent `chip-*` silently do nothing. Use `input` / `textarea` / `select` / `card-sm` / `card-border` / `tabs-box`/`tabs-border`; for grouped controls use `join` + `join-item` (the official DaisyUI 5 replacement for `btn-group`/`input-group`, verified against daisyui.com upgrade docs), or `label.input` for an input with an icon, and `btn btn-xs` for filter chips. Run the acceptance commands in `references/standards/daisyui.md#8` before delivery.
- **Compose, do not rebuild**: containers, inputs, alerts, and dialogs must be `card` + `card-body`, `input` / `textarea` / `select`, `alert`, and `dialog.modal` + `modal-box`; Tailwind utilities are for layout only.

## Step 7: Deploy with Vercel — environment variables

| Variable | Exposure | Purpose |
|----------|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser | Supabase anon/publishable key, protected by RLS |
| `SUPABASE_SECRET_KEY` | Server only | Admin API, Edge Function secrets, migrations |
| `GATEWAY_BASE_URL` | Server; `NEXT_PUBLIC_GATEWAY_BASE_URL` in public mode | Gateway origin used by Route Handlers or the browser |
| `GATEWAY_PUBLIC_URL` | Server | Public issuer; must equal the Supabase provider issuer |
| `GATEWAY_CLIENT_ID` | Browser or server; `NEXT_PUBLIC_GATEWAY_CLIENT_ID` in public mode | `nac_...`, safe to expose |
| `GATEWAY_CLIENT_SECRET` | Server only | Confidential client secret, never `NEXT_PUBLIC_` |
| `APP_ORIGIN` | Server | Stable production origin for redirects |
| `INITIAL_ADMIN_SUB` | Server (optional) | Developer's `sub` (`oauth_apps.created_by`) for the one-time first-owner grant |

- Preview deployments get a new origin each time: do not register a wildcard redirect URI. Changing the Supabase project domain changes the callback URL, so recreate `custom:newapi` afterwards. Never treat a preview or tunnel URL as a permanent deployment address.

## Step 8: Admin dashboard

- What OAuth gives the console: `sub` always, `username` / `name` with `profile`, `email` with `email`; the `id_token` carries no name, email, or role. Key the admin account on `sub`.
- **The app's admin role is not the new-api role** (`1` / `10` / `100`): store it in `auth.users.app_metadata.admin_role` (service-role writes only) or in an `app_admins` table; never read a role from `user_metadata`, a query string, or a request body.
- Every admin Route Handler and the admin layout call the same `requireAdmin()`; client checks and `proxy.ts` are not authorization boundaries.
- Ant Design (admin) and Tailwind + DaisyUI (consumer) never share a layout or route tree; `accessControlProvider` mirrors the server guard, never replaces it.
- **The first admin defaults to the developer who created the OAuth app**: `oauth_apps.created_by` equals their `sub`, so set `INITIAL_ADMIN_SUB` and seed `app_admins` once out of band. No endpoint or "first signup wins" rule may create an admin; block self-promotion and removing the last owner.

## Security Checklist

- [ ] Confidential clients keep `client_secret` in backend env vars only; public clients have no secret and rely on PKCE.
- [ ] `redirect_uri` exactly matches a registered URI, and the PKCE verifier from that request is validated on callback.
- [ ] `state` is validated against a server-held value; `nonce` is per request and validated when an `id_token` is consumed.
- [ ] State, verifier, and session cookies are `HttpOnly`, `Secure` in production, and `SameSite=Lax`.
- [ ] Gateway tokens stay in memory and are never logged or written to `user_metadata`; a rotated refresh token replaces the old one.
- [ ] OAuth tokens are used for `/v1/*` and `/oauth/*` (`userinfo`, `subscription/*`, `products*`, `topup/checkout`, `logs`) only; every `/api/*` dashboard endpoint rejects them.
- [ ] Async tasks and Midjourney calls made with an App access token settle against the App quota pool and can only access tasks created by the same App (`app_id` isolation); no `app_task_unsupported` capability limit applies.
- [ ] A browser return URL or `pending` order is never proof of payment; admin permissions come from your own store and the server guard.
- [ ] `SUPABASE_SECRET_KEY` is imported only by `server-only` code and never exposed through `NEXT_PUBLIC_*`.
- [ ] All media lives in Supabase Storage private buckets; only `bucket` + `path` is in Postgres.
- [ ] Balance, credits, orders, and usage come from new-api; there is no local ledger.

Full list: `references/standards/security.md`.

## Token Lifecycle

- **Access token**: JWT, 1 hour TTL, used to call AI APIs and userinfo.
- **Refresh token**: Opaque, 30 day TTL, rotated on each use.
- **Authorization code**: Single-use, 60 second TTL.
- **The provider token is not refreshed for you**: read `provider_token` / `provider_refresh_token` at login, refresh via `POST <gateway>/oauth/token` (`grant_type=refresh_token`) when less than 60 s remain, persist the rotated refresh token, and on `invalid_grant` clear local state and send the user through login again. A relay `401` is retried once with a fresh token, never in a loop.

Details: `references/standards/security.md`.

## Scopes Reference

| Scope | Grants access to |
|-------|-----------------|
| `openid` | User ID (sub claim) — required for OIDC |
| `profile` | Username, display name |
| `email` | Email address |
| `api:read` | Read-only AI endpoints (`GET` / `HEAD` / `OPTIONS`, e.g. `/v1/models`), quota in `/oauth/userinfo`, App plans/products, and `/oauth/logs` |
| `api:write` | Non-read AI endpoints (chat, images, embeddings, ...) and plan/product/top-up checkout. Request both if the app also reads. |

These scopes belong to OAuth access tokens only. Dashboard personal access tokens use a separate catalog (`profile:read`, `profile:write`, `account_security:write`, `wallet:read`, `wallet:write`, `billing:read`, `billing:write`, ...); list it with `GET /api/user/access_tokens/scopes`.

## Model Whitelist per App

Each OAuth App in new-api can restrict which AI models are available:

```sql
-- In new-api admin, set on the OAuth App:
ai_model_whitelist = '["gpt-4o-mini","gpt-4o"]'
```

When set, the relay rejects any model not in the list. Leave empty to allow all models. This is enforced in `controller/relay.go` via `service.CheckOAuthAppModelWhitelist()`.
