---
name: fy-new-api-app-framework
description: Development framework for building an external Web app against new-api — identity (OAuth 2.0/OIDC), AI relay, quota/top-up/subscription billing, plus a reference outfit demo app (Next.js + Supabase + Vercel).
---

# new-api App Development Framework (Web)

This skill is the standard for building an external **Web** application that uses new-api as its identity provider and AI gateway. It applies to SaaS products, enterprise internal tools, and demos that must run the complete chain: stack and project structure, frontend standards, the Supabase backend, Vercel deployment, and the new-api contracts for identity, AI relay, users, quota, top-up, and subscriptions. The identity and billing chapters are new-api product contracts and stay valid when you deviate from the default stack; the stack chapters are defaults, not requirements.

Deviate only when an existing platform standard, an offline/on-premise requirement, a non-Web target, or a regulatory constraint makes the default stack impossible. When you deviate, **Step 2 (Identity)** and **Step 4 (Users, Quota, and Payments)** remain normative, and the security properties must survive: server-side secret storage, PKCE, state validation, token rotation, no token in logs.

## Default Stack

Next.js (App Router) · TypeScript strict · React 19 · Tailwind CSS v4 + DaisyUI 5 · Supabase (Auth, Postgres + RLS, Edge Functions, Storage) · Vercel · bun · new-api OAuth 2.0 / OIDC (Authorization Code + PKCE; confidential BFF or public client).

The consumer app uses Tailwind + DaisyUI. An admin console is the one deliberate exception: Ant Design 5 + `@refinedev/core`, in a separate route tree that never shares a layout with the consumer app.

## Reference Index

This file is the contract and index; read the matching file before implementing that layer.

| Topic | File |
|-------|------|
| Steps 0–8 in full: bootstrap, project tree, endpoint/scope tables, env vars, security checklist, token lifecycle, scopes, model whitelist | `references/playbook.md` |
| Production-bug constraints | `references/pitfalls.md` |
| Frontend framework, rendering, caching, performance | `references/standards/nextjs.md` |
| UI components and UI/UX principles | `references/standards/daisyui.md`, `references/standards/ui-ux.md` |
| Supabase: CLI, Auth, RLS, Edge Functions, Storage, limits | `references/standards/supabase.md` |
| API contract: pagination, envelope, error codes, i18n keys | `references/standards/api-contract.md` |
| Deployment on Vercel (env vars, preview, rollback) | `references/standards/vercel.md` |
| Admin console (Next.js + Ant Design + Refine + Supabase) | `references/standards/admin-dashboard.md` |
| Identity contract and code (Step 2) | `references/standards/identity.md` |
| AI relay: BFF proxy code, rules, direct calls (Step 3) | `references/standards/relay.md` |
| Quota, `userinfo`, PAT, sessions, payments, credits (Step 4) | `references/standards/billing.md` |
| Security checklist and token lifecycle, in full | `references/standards/security.md` |
| Local acceptance: Cloudflare Tunnel and Supabase URL config | `references/standards/local-acceptance.md` |
| Runnable demo app / vendor provenance | `references/web/outfit-demo/README.md`, `references/vendor/README.md` |
| Environment self-check and bootstrap scripts | `scripts/check-env.*`, `scripts/bootstrap.*` |

## Prerequisites

1. A new-api instance running and accessible over HTTPS, plus admin access to its dashboard to create an OAuth application.
2. One of: a backend (BFF) that can store `client_secret` (confidential client), or a browser SPA / mini-program using PKCE with a **public client** (`public_client = true`, no secret). Supabase direct mode uses the public option.

## Credential Surfaces

Each new-api surface accepts a different credential; sending the wrong one is the most common integration failure. OAuth access tokens work on `/v1/*` and `/oauth/*`; every `/api/*` dashboard endpoint rejects them; personal access tokens (`nap_...`) and browser sessions cover the dashboard and admin routes. App-scoped plans, products, top-up, quota, and usage need no dashboard session — `/oauth/*` covers them. Full endpoint table: `references/playbook.md` § Credential Surfaces.

## End-to-End Development Workflow

Deliver an external App from zero to production in this order. Every step has a CLI; do not skip one and do not leave the wiring for later.

1. **Create the new-api sub-project and the App repo.** `fy-newapi-cli` creates the OAuth app, scopes, and quota pool; `gh repo create` creates the sub-App repository. Confirm `client_id` (`nac_...`) and redirect URIs before moving on.
2. **Create the Supabase and Vercel projects.** Supabase CLI (`supabase init`, `supabase link --project-ref <ref>`, `supabase db push`) and Vercel CLI (`vercel link`); run Step 0's bootstrap/self-check so the `custom:newapi` provider and `GATEWAY_PUBLIC_URL` issuer agree.
3. **Develop the sub-App and deploy a test environment.** Build against Supabase (auth + RLS, Edge Functions, Storage), deploy a preview/staging environment with `vercel`, and verify login, relay, and billing there.
4. **Configure plans, products, and the payment callback.** `fy-newapi-cli plan create/update` and `product create/update` define App-scoped plans/products; wire the payment return/callback URL so `waffo_pancake`/online checkouts can confirm and credit the App pool.
5. **Go live.** `vercel --prod` promotes the verified environment. Update the three origins together (Vercel production domain, OAuth redirect + post-logout URIs, Supabase Site URL + redirect allow list) in one change window.

### fy-newapi-cli updates must sync the skills (mandatory)

The `fy-newapi-cli` npm package bundles **both** this skill and `fy-newapi-cli` through the upstream repo's `cmd/fy-newapi-cli/npm/scripts/prepare-skill.js`, whose `SKILLS` array is `['fy-newapi-cli', 'fy-new-api-app-framework']`. Every time a `fy-newapi-cli` command or its behavior changes, update both `SKILL.md` files in the same change; never ship a CLI carrying an older skill.

## Step 0: Environment Bootstrap

Run the self-check before anything else: `./scripts/check-env.sh --install` (macOS/Linux) or `./scripts/check-env.ps1 -Install` (Windows) installs missing CLIs, verifies the gateway/Supabase env vars, asserts `discovery.issuer` equals `GATEWAY_PUBLIC_URL`, confirms `custom:newapi`, and runs the authorize smoke test. Non-zero exit means stop and fix. Commands, bootstrap arguments, and the scaffold command: `references/playbook.md` § Step 0.

## Step 1: Project Structure

App Router layout: `src/app/**` routes, `src/lib/supabase/{client,server}.ts`, `src/lib/gateway-session.ts` (refresh + 401 retry), `src/proxy.ts` (session refresh; `middleware.ts` before Next.js 16), `supabase/` migrations and functions. Only trusted server code imports the secret key, never a Client Component, never with a `NEXT_PUBLIC_` prefix. Full tree and reasoning: `references/playbook.md` § Step 1.

## Step 2: Identity (OAuth / OIDC)

new-api is the OIDC identity provider; your app never stores new-api passwords. Authorization Code + PKCE is the only supported flow. Full contract and code: `references/standards/identity.md`.

- **Public or confidential, decide once**: a server that can keep a secret uses a confidential client (BFF, `client_secret` server-only); an SPA or mini-program uses a public client (`public_client = true`, no secret, PKCE mandatory). Never enable public mode for a server-side app.
- Generate `state`, `nonce`, and the PKCE `code_verifier` on the server, keep them in HttpOnly / `Secure` / `SameSite=Lax` cookies, and validate `state` and the verifier on the callback.
- Supabase direct mode: the provider identifier must be exactly `custom:newapi`; the gateway must already be publicly reachable over HTTPS with an issuer equal to its public base URL **before** the provider is created; the app's redirect URI is `https://<project>.supabase.co/auth/v1/callback`.
- Supabase does not refresh a custom provider's token: refresh through `POST <gateway>/oauth/token` when less than 60 s remain of the 1 hour TTL (threshold per outfit-demo `gateway-session.ts`), store the rotated refresh token, sign out on `invalid_grant`, and revoke the refresh token on logout.

## Step 3: AI Relay Calls

All AI traffic goes to `/v1/*` with the OAuth access token; that token is not a dashboard credential and `/api/*` rejects it. Proxy code and rules: `references/standards/relay.md`.

- BFF: a Route Handler attaches the token and returns `upstream.body` so streams stay unbuffered; public clients call the gateway directly.
- Never log the `Authorization` header, token, request body, or upstream body; log method, path, status, latency, and a request id only. Never forward cookies, `client_secret`, or dashboard PATs upstream.
- Retry a `401` exactly once after refresh, then surface it.
- Relay billing for an OAuth access token is **App-scoped**: pre-consume, settlement, and refund use the quota pool of the App that owns the token (`app_quota`), never the user's platform wallet. Async task endpoints (video, music, Midjourney, other submissions) follow the same rule and are isolated by `app_id`: an App token can only read, remix, or cancel tasks its own App created.

## Step 4: Users, Quota, and Payments

The dashboard user system lives under `/api/*`, which OAuth tokens cannot reach. App-scoped identity, quota, plans, products, top-up, and usage are exposed under `/oauth/*` and accept the OAuth access token directly. Endpoint/scope table, payment matrix, and error codes: `references/playbook.md` § Step 4 and `references/standards/billing.md`.

- **Two balances, one billing rule**: `quota` is the platform wallet, `app_quota` is the App pool. Relay pre-consume, settlement, and refund for an OAuth token only touch that App pool.
- **An App pool starts empty** (wallet row created lazily with `0`) and grows only through top-up checkout or an App product purchase. Balance top-up is a transfer, not a grant.
- **A browser return URL or a `pending` order is never proof of payment**; confirm by re-reading `app_quota` from `/oauth/userinfo`, and link accounts on `sub` (never on mutable `username` / `email`).
- `amount` is always in the configured display unit — never send a quota value as an `amount`.

## Step 5: Backend on Supabase

Mandatory for any app that stores new-api users or business data in Supabase. Client/key matrix and Edge Function rules: `references/playbook.md` § Step 5; conventions: `references/standards/supabase.md`.

- **RLS + `client_id` is the enforcement point**: every business table carries `client_id text not null`; policies enforce both `current_app_client_id()` and `auth.uid()`, bound to exactly one verified `auth.identities` row with `provider = 'custom:newapi'`. Missing, malformed, mismatched, or ambiguous identities must deny access.
- Never trust `user_metadata`, `raw_user_meta_data`, or request fields for tenant, gateway identity, or admin grants; any server-written mapping must first verify the provider identity and issuer. Empty RLS results are not a reason to fall back to editable claims or anon Storage access.
- **Media goes to Supabase Storage**: the database keeps only `bucket` + `path` (`{client_id}/{user_id}/{uuid}.{ext}`), reads use short-lived signed URLs from private buckets, and MIME type and size are validated server-side.

## Step 6: Frontend Standards

Conventions: `references/standards/nextjs.md`, `references/standards/daisyui.md`, `references/standards/ui-ux.md`, plus `references/vendor/`.

- Server Components by default; `'use client'` only on the smallest interactive leaf. Never pass an access token, refresh token, `client_secret`, or service-role key into a Client Component.
- **Compose, do not rebuild**: containers are `card` + `card-body`, inputs are `input` / `textarea` / `select`, dialogs are `dialog.modal` + `modal-box`; Tailwind utilities are for layout only. Invalid DaisyUI 5 classes (`input-bordered`, `card-compact`, `tabs-boxed`, `chip-*`, ...) silently do nothing; the removed `btn-group` / `input-group` map to the valid `join` / `join-item` — valid/invalid list in `references/playbook.md` § Step 6 and `references/standards/daisyui.md#8`.
- **OAuth callback is server-side and single-use**: exchange the code in a Route Handler `GET` with exactly one `exchangeCodeForSession`. Never call it from a client effect — React 19 StrictMode runs it twice and Supabase returns `invalid flow state`.
- Every data view needs loading, empty, and error states; destructive actions need confirmation; payment and logout show the resulting state.

## Step 7: Deploy with Vercel

Deployment commands, preview handling, rollback, and the environment-variable table: `references/standards/vercel.md` and `references/playbook.md` § Step 7.

- **Update the three origins together** in one change window: the Vercel production domain (`APP_ORIGIN`), the new-api OAuth app redirect and post-logout URIs, and Supabase Auth (Site URL + redirect allow list). In direct mode the redirect URI stays `https://<project>.supabase.co/auth/v1/callback`.
- Preview deployments get a new origin each time: never register a wildcard redirect URI, never treat a preview or tunnel URL as a permanent address.

## Step 8: Admin Dashboard

Optional surface: Next.js App Router + Ant Design 5 + `@refinedev/core` + Supabase. Conventions: `references/standards/admin-dashboard.md`.

- **The app's admin role is not the new-api role** (`1` / `10` / `100`): store it in `auth.users.app_metadata.admin_role` (service-role writes only) or in an `app_admins` table; never read a role from `user_metadata`, a query string, or a request body.
- Every admin Route Handler and the admin layout call the same `requireAdmin()`; client checks and `proxy.ts` are not authorization boundaries. Ant Design and DaisyUI never share a layout or route tree.
- The first admin is the OAuth app creator (`INITIAL_ADMIN_SUB` → `app_admins`); no endpoint or "first signup wins" rule may create one.

## Known Failure Modes

Nine rules distilled from production bugs: authorize redirect back to the gateway, `X-Forwarded-Proto` behind a TLS proxy, consent CSRF, MySQL reserved words, plaintext CLI servers, resumable serverless work, per-model billing, render order, inviter persistence. Read `references/pitfalls.md` before reviewing a flow that touches them.

## Security Checklist and Token Lifecycle

Non-negotiables: secrets stay server-side, `state` / PKCE are validated on callback, tokens are never logged or written to `user_metadata`, a rotated refresh token replaces the old one, and a browser return URL is never payment proof. Full checklist, token TTLs (access 1 hour, refresh 30 days, code 60 seconds), and the refresh procedure: `references/playbook.md` and `references/standards/security.md`.

## Scopes Reference

| Scope | Grants access to |
|-------|-----------------|
| `openid` | User ID (sub claim) — required for OIDC |
| `profile` | Username, display name |
| `email` | Email address |
| `api:read` | Read-only AI endpoints (`GET` / `HEAD` / `OPTIONS`), quota in `/oauth/userinfo`, App plans/products, `/oauth/logs` |
| `api:write` | Non-read AI endpoints (chat, images, embeddings, ...) and plan/product/top-up checkout |

These scopes belong to OAuth access tokens only. Dashboard PATs use a separate catalog (`profile:*`, `wallet:*`, `billing:*`, ...); list it with `GET /api/user/access_tokens/scopes`. Per-App model restriction (`ai_model_whitelist`) and scope details: `references/playbook.md` § Scopes Reference.

> 反馈：本技能来自 [holy-agents-kits](https://github.com/monsterbude123/holy-agents-kits)。发现错误、缺步骤或命令跑不通，直接开 issue：https://github.com/monsterbude123/holy-agents-kits/issues/new
