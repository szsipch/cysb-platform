# 承接查验平台 V1.12 优化与云端部署（已完成）

## 1. 图表颜色分配优化（核心诉求）

### 改造前
- 所有条形图统一一种渐变蓝；
- 严重度分布、专业分布、楼层分布、责任单位排名看不出差异；
- 唯一传颜色的是「责任单位排名」（单色橙 #ea580c）。

### 改造后
**app.js 引入 `PALETTE` 干净分类色板（10 色，色相均匀、柔和）**：

```
['#3b82f6', '#14b8a6', '#f59e0b', '#8b5cf6', '#ef4444',
 '#0ea5e9', '#22c55e', '#ec4899', '#6366f1', '#f97316']
```

**`bars(data, color)` 支持三种着色方式**（优先级递减）：
1. `data[i].c`（条目自带） → 用于严重度分级语义色；
2. `color` 为数组 → 分类调色板按序循环；
3. `color` 为单色 → 全部同色（向后兼容）。

**图表分配策略**：
| 图表 | 颜色 | 设计理由 |
|---|---|---|
| 严重度分布 | S1 红 / S2 橙 / S3 黄 / S4 蓝 / S5 绿（按 sevColor 语义） | 严重度自带分级语义，颜色强化等级感 |
| 专业分布 Top8 | PALETTE 循环 | 8 个分类，色相明显区分，便于横向对比 |
| 区域/楼层分布 | PALETTE 循环 | 楼层数可能 > 10，循环复用 |
| 责任单位排名 | PALETTE 循环 | 各单位差异化展示，比单色更易扫读 |
| 商户页业态分布 | PALETTE 逐条 | 同上 |
| 问题趋势折线 | 蓝（发现）/ 绿（关闭） | 红/绿已是关闭=好 的隐喻，保留 |
| 商户资料卡片状态边 | 蓝/橙/绿语义色 | 保留 V1.5 设计 |

**已截图验证**：`H:\腾讯workbuddy\承接查验\_shots\20-仪表盘-新配色.png`（首页仪表盘，6 个图表全部新配色）、`21-商户页-业态分布.png`、`22-统计表-图表.png`。

## 2. 其他 HTML/服务端优化

| 项目 | 改动 | 效果 |
|---|---|---|
| 静态资源 gzip | `server.js` 新增 `respond()` 辅助函数，对 >512B 响应自动 gzip | **app.js 217KB → 61KB（-72%）** |
| 静态资源缓存 | `serveStatic` 加 `Cache-Control: public, max-age=604800`（7 天），html 不缓存 | 二次访问基本秒开 |
| meta 完善 | `index.html` 补 description、theme-color、apple-mobile-web-app-capable、format-detection | SEO/移动端启动/PWA 体验更好 |
| viewport | 去掉 `maximum-scale=1, user-scalable=no` | 无障碍：允许用户缩放 |
| 静态资源版本号 | `?v=20260820h` → `?v=20260820j` | 配合新长缓存，强制刷新一次 |

## 3. 云端部署（任务 2）

### 现状
- 腾讯云开发 CloudBase 已连接，环境 `yrsf001-d5g6zc7i658446c3b`（ap-shanghai 体验版）；
- 已用 MCP 工具开通云托管（`initEnv`，Status=normal）；
- 4 次尝试 `manageCloudRun action=deploy`，**MCP 客户端在打包上传+构建阶段均 "Connection closed" 断开**（3 次重连 ripple retry 都失败）；
- CloudBase 服务列表确认未创建任何服务。

### 已就绪的部署物（用户可一键部署）
| 文件 | 大小 | 说明 |
|---|---|---|
| `H:\腾讯workbuddy\承接查验\Dockerfile` | 582 B | node:22-alpine，无外部依赖，CMD `node server.js` |
| `H:\腾讯workbuddy\承接查验\.dockerignore` | 285 B | 排除 `_shots/` `_chrome_tmp/` `.workbuddy/` `_*.js` 等 |
| `H:\腾讯workbuddy\承接查验\cysb-platform.zip` | **21.8 MB** | 37 个文件，可直接上传到云托管 |
| `H:\腾讯workbuddy\承接查验\DEPLOY.md` | 6.3 KB | 5 分钟手动控制台部署完整步骤 |
| `server.js` 新增 `seedDemoIfEmpty()` | — | 实例启动时自动注入演示数据，保证登录即可用 |

### 手动部署步骤（5 分钟）
详见 `DEPLOY.md`。简要：
1. 打开 https://console.cloud.tencent.com/tcb → 进入 `yrsf001` 环境
2. 左侧「云托管」→「新建服务」→ 容器型，名称 `cysb-platform`
3. 部署方式：**本地上传代码包** → 选 `cysb-platform.zip`
4. 服务配置：
   - 端口 `3000` / 资源 `0.5 核 + 1 GB` / **实例数 1-1（强制单实例）**
   - 公网访问 **开启**（自动 HTTPS）
   - 环境变量 `NODE_ENV=production`、`AUTO_SEED=1`
5. 启动延迟 10s，部署。
6. 拿到 `https://cysb-platform-xxxxx.ap-shanghai.run.tcloudbase.com` 公网域名，手机/电脑通用。

### 数据持久化说明
当前 `data/db.json` + `uploads/` 存于容器可写层，**实例重启会回到镜像基线（演示数据）**。
- ✅ 演示/试用：够用；
- ❌ 生产长期数据：需挂载 CFS 持久卷或迁移到 CloudBase NoSQL/PostgreSQL（详见 DEPLOY.md）。

## 4. 验证

- 本地 `node server.js` 启动 → 端口 3100 跑通；
- Chrome headless + CDP 截图：登录页、仪表盘（图表新配色）、商户页（业态分布调色板）、统计表（5 个图表）；
- gzip 头验证：`Content-Encoding: gzip`、`Vary: Accept-Encoding`、`Cache-Control: public, max-age=604800`。

## 5. 演示账号（不变）
- `admin / admin123`（超级管理员）
- `pm / pm123`（项目经理）
- `inspector / ins123`（查验人员）
- `contractor / con123`（施工单位）

## 6. 后续方向
- 若想真自动部署：换一台网络稳定的机器跑同一个 MCP `deploy`，或安装 cloudbase CLI 用 `tcb cloudrun deploy` 走 HTTP 长轮询。
- 生产化：data/uploads 持久化（DEPLOY.md 第 5 节有改造路径）。
