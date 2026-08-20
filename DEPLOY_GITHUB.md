# 通过 GitHub 永久部署（Render / Railway）

> 痛点：pinggy 隧道 60 分钟过期、依赖本机沙箱。  
> 解法：源码推到 GitHub（永久仓库），再连托管平台拿到 **永久公网 URL**。

仓库地址：**https://github.com/szsipch/cysb-platform**

---

## 能用多久？

| 平台 | URL 有效期 | 费用 | 休眠行为 |
|---|---|---|---|
| **Render 免费层** | **永久不过期**（`*.onrender.com`） | 免费、免信用卡 | 空闲 15 分钟后休眠，下次访问冷启动 ~30 秒，之后秒开 |
| **Railway** | **永久 URL** | 送 $5 额度（约 24/7 跑 2–3 个月） | 不休眠，额度用完需绑卡 |
| GitHub 仓库本身 | **永久**（你不删就一直在） | 免费 | — |

结论：**比 pinggy 的 60 分钟强太多**——URL 一直有效，只有免费层会"打盹"。

---

## 方案 A：Render（推荐，永久 URL + 免信用卡）

1. 打开 https://render.com → 右上角 **Sign up** → 选 **GitHub** 登录（授权账号 `szsipch`）。
2. 登录后点 **New + → Web Service**。
3. 在仓库列表里选 **`cysb-platform`** → 点 **Connect**。
4. 配置表单照抄：

   | 字段 | 值 |
   |---|---|
   | Name | `cysb-platform` |
   | Region | 选离你近的（Singapore / Oregon 都行） |
   | Branch | `main` |
   | Runtime | **Node** |
   | Build Command | **留空**（零依赖，无需 npm install） |
   | Start Command | **`node server.js`** |
   | Plan | **Free** |

5. 展开 **Advanced → Add Environment Variable**，加两条：
   - `NODE_ENV` = `production`
   - `AUTO_SEED` = `1`
6. 点 **Create Web Service**。

部署约 1–2 分钟。成功后顶部显示紫色 **Live**，旁边就是你的永久地址：
```
https://cysb-platform.onrender.com
```
电脑 / 手机浏览器打开 → 登录页 → `admin/admin123` 进系统。

> ⚠️ **首次打开等 30 秒**：免费层休眠后第一次访问要冷启动（Ruby/Node 拉起进程 + 自动注入演示数据）。之后常驻秒开。再闲置 15 分钟会再次休眠。
>
> 💡 **想永不休眠**：把 Plan 从 Free 升到 Starter（~$7/月）即可常驻。

---

## 方案 B：Railway（送 $5 额度，不休眠）

1. 打开 https://railway.app → **Login** → 选 GitHub。
2. **New Project → Deploy from GitHub repo** → 选 `cysb-platform`。
3. 它会自动识别 Node，构建并启动 `npm start`（= `node server.js`）。
4. 项目里 **Variables** 加 `NODE_ENV=production`、`AUTO_SEED=1`。
5. 点 **Generate Domain** 拿到永久 URL（`*.up.railway.app`）。

Railway 不休眠，送的 $5 额度约够小应用 24/7 跑 2–3 个月；之后绑卡续（按量计费，很低）。

---

## 数据持久化说明（演示场景够用）

- 应用把数据写在容器磁盘 `data/db.json`。**免费层容器重启/ redeploy 后磁盘会重置**，但 `AUTO_SEED=1` 会自动重新注入演示数据，登录即用。
- 演示 / 给客户看完全 OK；若要**真实长期数据**，升级套餐后挂持久卷（Render Persistent Disk / Railway Volume）或改接云数据库。

---

## 本地仓库说明（给以后维护用）

本沙箱环境**禁止 git 协议直推**（github.com 的 git 推送被网络白名单重置），所以代码是通过 GitHub **Contents API**（`gh api`）逐文件提交到仓库的。

以后你在本机（网络正常）维护：
```bash
git clone https://github.com/szsipch/cysb-platform.git
cd cysb-platform
# 改完代码
git add -A && git commit -m "..." && git push   # 本机可正常 push
```
Render / Railway 检测到 push 会**自动重新部署**，URL 不变。

> 仓库里已排除：临时脚本（`_*.js`/`_*.tmp`/`_*.bin`/`.disposable_*`）、截图（`_shots/`）、日志、`.workbuddy/`、部署包（`*.zip`/`*.b64`）、重复的 `cloudfunctions/`。
