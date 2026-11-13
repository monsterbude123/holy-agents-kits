# Escape hatch: `api`

Use `api` for endpoints without a dedicated subcommand. OAuth apps now have a
dedicated `oauth-app` subcommand (see `commands.md`), which is preferred over the raw
`api` calls below; the raw form remains for scripting and for fields the
subcommand does not expose (for example `ai_model_whitelist`).

```bash
fy-newapi-cli api GET /api/user/self
fy-newapi-cli api GET '/api/log/?p=1&page_size=20&type=2'
fy-newapi-cli api POST /api/channel/ --data '{"mode":"single","channel":{"name":"upstream","type":1,"key":"sk-..."}}'
fy-newapi-cli api POST /api/token/ --data @token.json

# === OAuth apps (外部 Web app 最关键) ===
fy-newapi-cli api GET /api/oauth-apps                                        # 列出所有
fy-newapi-cli api GET /api/oauth-apps/<id>                                   # 查单条（拿当前 redirect_uris 再追加）
fy-newapi-cli api POST /api/oauth-apps --data '{                              # 创建 public client
  "name": "My App",
  "redirect_uris": ["https://<project>.supabase.co/auth/v1/callback"],
  "post_logout_redirect_uris": ["https://<app>/logout-done"],
  "scopes": ["openid","profile","email","api:read","api:write"],
  "public_client": true,
  "status": 1
}'
fy-newapi-cli api PUT /api/oauth-apps/<id> --data '{                          # 追加 redirect_uri（先 GET 当前数组，再追加，不要直接覆盖）
  "redirect_uris": ["https://old...","https://tunnel-xxx.trycloudflare.com/auth/callback"]
}'
fy-newapi-cli api DELETE /api/oauth-apps/<id>

# auth status 拿到 server URL（自动探测 .env.local 用）
fy-newapi-cli auth status   # → {"server":"https://gateway.example.com","..."}
```

- METHOD must be uppercase; path must start with `/`.
- `--data` accepts inline JSON or `@file`; it must be valid JSON.
- Channel creation wraps the object as `{"mode":"single","channel":{...}}`.
- List endpoints take `p` and `page_size` query parameters.
- `auth status` **不**需要 scope，在任何脚本里都能调，拿 `server` 字段是
  探测 `.env.local` 里 `NEXT_PUBLIC_GATEWAY_BASE_URL` 的最稳妥方式。
- `GET /api/oauth-apps` 返回的对象里带 `supabase_project_ref`（如果该 app
  是 outfit-demo 形态），可以直接用于自动 `supabase link`。
- **追加 redirect_uri 的正确姿势**：先 `GET /api/oauth-apps/<id>` 拿当前
  `redirect_uris` 数组，追加新条目后 `PUT` 回去。直接覆盖会丢掉已有值。
- **`self.id` vs `auth.users.id`**：`fy-newapi-cli api GET /api/user/self`
  返回的 `id`（整数）就是 OAuth `sub` 声明，存放在 Supabase
  `auth.users.raw_user_meta_data->>'sub'`。但 `auth.users.id`（UUID）才是
  业务表（如 `app_admins.user_id`）需要的值。两者不能混用。映射 SQL：

  ```sql
  SELECT id::text FROM auth.users
  WHERE raw_user_meta_data->>'sub' = '<self.id>'
    AND raw_app_meta_data->>'provider' = 'custom:newapi';
  ```
