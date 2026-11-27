# 目录聚合体积（dirsize）—— 拿网盘官方体积的正确接口

**别用枚举文件的方式量目录。** openapi 的 `list` / `filemetas` 对**目录的 `size` 恒为 0**，
只有对文件才有值，也没有"目录聚合体积"字段。想拿目录真实体积，只能用网盘自己的 dirsize 接口。

实测（2026-11-27，一个 十几 TB 量级 网盘）：

| 接口 | 认证 | 实测结果 |
|---|---|---|
| `GET /rest/2.0/xpan/file?method=dirsize&path=<目录>&access_token=<token>` | **openapi token 即可** | ✅ 返回 `{"taskid":"...","appid":118351269}` |
| `GET /rest/2.0/xpan/multimedia?method=taskquery&taskid=<id>&appid=<id>&access_token=<token>` | openapi token | ⚠️ 参数被识别（缺 appid 报 "appid empty"，缺 taskid 报 "taskid empty"），但**服务端恒返回 errno 1「服务器错误」** |
| `GET /mid_mucw/api/ostp/file/dirsize?path=<目录>` | **BDUSS cookie** | ✅ web 端，UI 用的就是这个 |
| `GET /mid_mucw/api/ostp/file/taskQuery?taskid=<id>` | **BDUSS cookie** | ✅ 取任务结果 |
| `GET /api/ostp/file/metaByPath?path=<路径>` | **BDUSS cookie** | ✅ 按路径取元信息 |

后三条端点是从网盘自己的 JS bundle 里挖出来的（`https://nd-static.bdstatic.com/m-static/v20-main/home/js/*.js`，
grep `dirsize` / `taskQuery` / `metaByPath`）：

```js
lpe = {
  fileMetaByPathUrl: "/api/ostp/file/metaByPath",
  folderSize: "/mid_mucw/api/ostp/file/dirsize",
  taskQuery:  "/mid_mucw/api/ostp/file/taskQuery",
}
```

## 关键结论

- **百度只把"提交任务"这一半开放给了 openapi，"取结果"那一半还在 web 端（要 BDUSS）**。
- 拿 openapi token 打 web 端接口，一律 `errno -6 "login method error"`；
  把 token 当 `BDUSS` cookie 传，回 `errno -6 "用户未登录"`。
- 所以**要拿权威目录体积，必须有一个 BDUSS 会话 cookie**（第三方网盘工具如 alist/rclone 也是要 BDUSS）。
  两种拿到它的方式：
  - 用户从已登录的 Chrome 里复制 `BDUSS` cookie 值 → 纯 API，无浏览器
  - 在受控浏览器实例里登录一次 → 用页面上下文 `fetch()` 转发（cookie 自动带上）

## dirsize 的重要细节

- **`path` 支持逗号分隔多个目录**，一次请求可提交一批：
  `?method=dirsize&path=/99_索引,/00_正在做` → 同样返回 taskid。
  这让"整树体积"降到 **每批 1 次提交 + 1 次查询**，而不是每目录 2 次。
- 每��� dirsize 调用都会**新建一个 taskid**（不是复用缓存），提交后要拿 taskid 去 taskQuery 轮询。
- 结果里有目录的**字节数 + 文件数 + 文件夹数**（与 UI「详细信息」弹窗显示的一致）。

## 怎么在 JS bundle 里找未知接口

网盘前端是 SPA，接口定义都在静态 JS 里，不用登录就能抓：

```bash
# 1) 页面 HTML 里列出了全部 chunk 的 CDN 地址
curl -s https://pan.baidu.com/disk/main | grep -oE 'https://[^"]+\.js' | sort -u
# 2) 并发抓取，grep 关键词
#    关键词：/api/ 、dircache、dirsize、taskquery、metaByPath
```

这是找"网盘到底调了哪个接口"最快的路子——比猜接口名靠谱得多。
