# 云端部署指南

本应用是 **Node 全栈应用**（server.js + SPA + 文件存储），不能只部署静态页。下面给出**已通过本地验证**的腾讯云开发 CloudRun 部署步骤。

## 已就绪的部署文件（无需再改）

| 文件 | 作用 |
|---|---|
| `Dockerfile` | 基于 `node:22-alpine`，无外部依赖，CMD 启动 `node server.js` |
| `.dockerignore` | 排除 `_shots/` `_chrome_tmp/` `*.tmp` `.disposable_*` `_*.js` 等测试文件 |
| `server.js`（已更新） | 加了 `seedDemoIfEmpty()`：实例启动时若 `users` 表为空，自动注入演示数据；可设 `AUTO_SEED=0` 关闭 |
| `index.html`（已更新） | 补了 description/theme-color 等 meta，去掉 user-scalable=no |
| `public/js/app.js`（已更新） | 图表颜色优化（详见 README V1.12） |
| `server.js`（已更新） | gzip 压缩（app.js 217KB→61KB）+ 长缓存（CSS/JS 7 天） |

## 部署到 CloudRun（容器型）

### 步骤 1：开通 CloudBase 环境与云托管（已完成）
环境：`yrsf001-d5g6zc7i658446c3b`（ap-shanghai 体验版），云托管已开通。

### 步骤 2：在控制台创建容器型服务
访问 **https://console.cloud.tencent.com/tcb** → 进入 `yrsf001` 环境 → 左侧「**云托管**」→ 「**新建服务**」：

| 字段 | 取值 |
|---|---|
| 服务名称 | `cysb-platform` |
| 服务类型 | **容器型** |
| 计费套餐 | 试用版（已有） |
| 部署方式 | **本地上传代码包**（或选择代码仓库） |

> 选「本地上传代码包」最稳。先在项目根目录打包成 zip（**不要带 `_shots/` `_chrome_tmp/` `.workbuddy/` `*.tmp`**）：
> ```bash
> cd H:\腾讯workbuddy\承接查验
> # 清理后打包（PowerShell）
> Remove-Item -Recurse -Force _shots,_chrome_tmp,.workbuddy -ErrorAction SilentlyContinue
> Compress-Archive -Path * -DestinationPath ../cysb-platform.zip -Force
> ```
> 上传这个 zip 即可（`.dockerignore` 已在 zip 之外被剥离，但 zip 时手工排除更稳）。

### 步骤 3：服务配置（关键）

| 配置项 | 取值 | 说明 |
|---|---|---|
| 端口 | `3000` | 与 server.js 的 `process.env.PORT \|\| 3000` 一致 |
| 运行命令 | `node server.js` | Dockerfile 已设，可不填 |
| 资源规格 | CPU **0.5 核** / 内存 **1 GB** | 体验版可承受 |
| 实例数 | 最小 **1** / 最大 **1** | **必须单实例**：当前用本地文件存储 `data/db.json`，多实例数据会不一致 |
| 公网访问 | **开启** | 给所有用户访问的 URL；自动 HTTPS |
| 环境变量 | `NODE_ENV=production`<br>`AUTO_SEED=1` | 第一个变量是常规生产模式；第二个启用自动 seed（实例重启回演示数据） |
| 启动延迟 | `10` 秒 | 健康检查前的等待 |

### 步骤 4：部署
- 点「**完成/部署**」→ 控制台开始拉镜像（用项目里的 Dockerfile 自动构建 Node 22 alpine）→ 启动容器。
- 第一次构建约 1–2 分钟。构建日志和运行日志可在详情页查看。
- 启动后 `seedDemoIfEmpty()` 会检测 users 为空 → 自动注入演示数据（管理员账号 `admin/admin123` 等）。

### 步骤 5：拿到公网 URL
部署成功 → 服务详情页有「**默认域名**」形如 `https://cysb-platform-xxxxx.ap-shanghai.run.tcloudbase.com`，**这就是手机/电脑都能访问的入口**。
- 电脑：浏览器直接打开这个域名。
- 手机：同一域名（自带 HTTPS，无需配置）。
- 二维码：进入系统后「项目页 → 📱 项目二维码」自动用 `S.baseUrl` 生成，扫码 = 公网 URL。

### 步骤 6：验证
- 打开域名 → 看到登录页（演示账号 4 个 chip 可一键登录）。
- 登录 `admin/admin123` → 仪表盘图表已显示新配色（严重度分级色 + 专业/楼层分类调色板）。
- 移动端响应式正常（已 mobile-first）。

## 重要：数据持久化（演示模式说明）

当前实现 `data/db.json` 与 `uploads/` 存在**容器可写层**。容器被平台回收/重启后，**会回到镜像基线（演示数据）**。

- ✅ **适合场景**：演示、试运行、内部试用——重启=回到干净的演示数据，登录即可用。
- ❌ **不适合**：生产长期数据。生产化方案：
  1. **挂载 CFS/NFS 持久卷**（腾讯云文件存储），把 `/app/data` 和 `/app/uploads` 改为挂载点；
  2. 或把存储迁移到 **CloudBase NoSQL/PostgreSQL**（db.js 改造）；
  3. 或把 `uploads/` 改用 **CloudBase 云存储 COS** + 改写 `/api/uploads` 上传逻辑。

如需后续生产化，可再开一轮改造。

## 验证部署后的关键指标

- 静态资源 `app.js` 应 ~60 KB（gzip 压缩后，原 217 KB）。
- 响应头应含 `Content-Encoding: gzip`、`Cache-Control: public, max-age=604800`（CSS/JS 7 天）。
- 启动日志应有 `✓ 已自动注入演示数据`。
- 二维码扫码进入移动端详情页可正常显示（无需登录、只读）。

## 部署命令对照（如果以后用 cloudbase CLI）

如果以后想用命令行部署，先安装 cloudbase CLI（`npm i -g @cloudbase/cli`），然后：

```bash
tcb login
tcb cloudrun deploy -e yrsf001-d5g6zc7i658446c3b -n cysb-platform \
  --type container --target . \
  --config '{"Port":3000,"Cpu":0.5,"Mem":1,"MinNum":1,"MaxNum":1,"OpenAccessTypes":["PUBLIC"]}'
```

## 故障排查

| 现象 | 排查 |
|---|---|
| 启动失败日志 | 服务详情 → 运行日志，看 `node server.js` 报错（一般是 db 初始化或端口） |
| 502/无法访问 | 检查安全域名：环境 → 安全配置，把你的域名加入（如果用了自定义域名） |
| 看不到演示数据 | 检查环境变量 `AUTO_SEED=1` 是否设置；启动日志有无 `已自动注入演示数据` |
| 二维码扫不出 | 早期版本用 `localhost`，新版会自动用 `/api/network` 返回的 IP。**云端部署后，S.baseUrl 应自动指向公网域名**——如果不对，需要在前端构造 baseUrl 时优先用 `window.location.origin` |

## 已尝试

本对话已通过 MCP 调用 `manageCloudRun action=deploy`，但 MCP 客户端在打包上传 + 构建阶段超时断开（"Connection closed"）。**剩余最后一步「触发部署」需要你在控制台点一下**，或换一台网络更稳定的环境跑 MCP。

---

# 方案 B：云函数部署（体验版原生支持，免费，零代码改造）

> **背景**：CloudBase 体验版（Trial）控制台**不显示「云托管」菜单**（云托管仅标准版及以上可见），但**云函数体验版可用**。
> 已写好云函数入口 `scf.js`（见项目根）：函数实例内启动一次完整 server.js，每次 HTTP 触发转发到本地端口，100% 复用现有代码，**零外部依赖、无需改任何业务代码**。本地已实测：登录 / Cookie 鉴权 / 静态资源全部 200。

## 云函数部署步骤（腾讯云开发控制台）

### 1. 进入云函数
控制台 → 环境 `yrsf001` → 左侧「**基础服务 → 云函数**」→ 右上角「**新建函数**」。

### 2. 新建函数配置
| 字段 | 取值 |
|---|---|
| 函数名称 | `cysb` |
| 运行环境 | **Nodejs 20.15**（或 18.15，选可用版本） |
| 创建方式 | 「**本地上传 zip**」→ 选 `cysb-platform.zip`（已含 scf.js） |
| 入口函数 | `scf.main`（文件名.导出名，控制台会预填，确认是 `scf.main`） |
| 内存 | 256 MB |
| 超时时间 | **60 秒**（首次冷启动要等后端起来 + 自动 seed，默认 3s 会超时） |
| 环境变量 | `NODE_ENV=production`、`AUTO_SEED=1`（PORT 不用设，默认 3000） |

### 3. 创建触发器（关键：路径要落在根）
函数详情页 → 「**触发管理**」→ 「创建触发器」：
- 触发方式：**HTTP 触发器（URL 请求）**（云开发控制台生成 `https://<env>-xxx.ap-shanghai.app.tcloudbase.com/<path>` 域名，**path 填 `/`**）
- 或选「API 网关」：创建后把网关**访问路径前缀改成 `/`**（否则默认 `/release/` 前缀会导致 `/css/style.css` 等绝对路径 404）

### 4. 验证
- 浏览器打开触发 URL → 登录页出现；
- 登录 `admin/admin123` → 仪表盘图表新配色；
- 手机浏览器打开同一 URL → 移动端正常。
- 冷启动首次访问约 2-5 秒（后端初始化 + seed），之后同一实例秒开。

## 方案 B 的局限（相比云托管）
| 项目 | 云托管 | 云函数（方案 B） |
|---|---|---|
| 成本 | 基础版 ¥30/月 | 体验版免费 |
| 冷启动 | 极快（实例常驻） | 首次 2-5 秒 |
| 数据持久 | 容器可写层，重启回 seed | 函数实例文件系统，回收后回 seed |
| 会话保持 | 单实例默认稳定 | 多实例并发时 Cookie 会话可能落到不同实例（演示单用户无感） |
| 长任务 | 适合 | 超时上限受限（演示够用） |

> 数据持久化结论同云托管：演示够用；生产需挂 CFS / 迁 NoSQL（见上文第 5 节）。
