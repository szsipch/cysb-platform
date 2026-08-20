'use strict';
/**
 * AI 辅助录入/分类模块 (V1.5)
 * - 接入 DeepSeek API（默认 https://api.deepseek.com，可配置 baseUrl）
 * - 无 API Key 时回退到本地规则解析，保证离线可用
 * - 配置优先级：环境变量 > data/ai-config.json
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CFG_FILE = path.join(DATA_DIR, 'ai-config.json');

const DISCIPLINE_HINT = '建筑/装饰, 土建, 精装修, 给排水, 暖通, 强电, 弱电, 消防, 电梯, 智能化, 防水, 门窗, 幕墙, 标识导视, 照明, 景观, 无障碍, 运营安全, 环境卫生, 综合观感, 其他';
const SEVERITY_HINT = 'S1 重大, S2 高, S3 中, S4 低, S5 观察项';

function loadCfg() {
  try { return JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch (e) { return {}; }
}
function saveCfg(cfg) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}
function getKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  return loadCfg().apiKey || '';
}
function getBaseUrl() {
  if (process.env.DEEPSEEK_BASE_URL) return process.env.DEEPSEEK_BASE_URL;
  return loadCfg().baseUrl || 'https://api.deepseek.com';
}
function isConfigured() { return !!getKey(); }
function setConfig(apiKey, baseUrl, model) {
  const cfg = loadCfg();
  if (apiKey !== undefined) cfg.apiKey = apiKey;
  if (baseUrl !== undefined) cfg.baseUrl = baseUrl;
  if (model !== undefined) cfg.model = model;
  saveCfg(cfg);
}

// ---------- HTTP ----------
function httpPostJson(urlStr, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const data = JSON.stringify(bodyObj);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, headers),
    }, (res) => {
      let s = '';
      res.on('data', (c) => (s += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(s) }); }
        catch (e) { resolve({ status: res.statusCode, body: s }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('AI 请求超时')));
    req.write(data);
    req.end();
  });
}

// ---------- prompt ----------
function buildSystemPrompt(ctx) {
  return `你是商场装修承接查验智能助手。用户会给出一段现场巡查的中文描述，请提取结构化信息并以 JSON 返回（不要任何额外文字，只返回 JSON）。
字段说明：
- title: 问题标题（简洁，含位置+现象，如"3F东区地砖空鼓"）
- description: 现场现象详细描述
- discipline: 所属专业，必须从候选中选一：${DISCIPLINE_HINT}
- categoryName: 问题大类（如 墙地面/天花/机电/消防/防水 等，可自行归纳）
- floorName: 楼层（如 B1/1F/3F 等，若描述中有）
- zoneName: 区域（如 东区/中庭/卫生间，若描述中有）
- severity: 严重度等级，从 ${SEVERITY_HINT} 选一，依据风险判断（结构安全/消防/重大功能缺陷→S1/S2；一般质量观感→S3/S4；轻微观察→S5）
- priority: 优先级 P1/P2/P3
- locationDesc: 具体位置描述（如"距A入口约5米右侧墙面"）
- suggestedAction: 建议整改措施
- standardReference: 可能适用的规范标准（如 GB50210、GB50016，不确定可空）
- responsibilityHint: 推断的责任单位类型（如 精装修分包/消防专业/机电安装/总包/物业，不确定可空）
${ctx && ctx.contextNote ? '补充背景：' + ctx.contextNote : ''}
仅返回 JSON。`;
}
function parseContent(content) {
  let t = String(content || '').trim();
  const m = t.match(/\{[\s\S]*\}/);
  if (m) t = m[0];
  try { return JSON.parse(t); } catch (e) { return null; }
}

// ---------- 解析入口 ----------
async function parseIssue(text, ctx) {
  const key = getKey();
  if (!key) return Object.assign(localParse(text), { _mode: 'local' });
  try {
    const r = await httpPostJson(getBaseUrl() + '/v1/chat/completions', {
      Authorization: 'Bearer ' + key,
    }, {
      model: getModel(),
      messages: [
        { role: 'system', content: buildSystemPrompt(ctx) },
        { role: 'user', content: text },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });
    if (r.status !== 200) throw new Error('DeepSeek 返回 ' + r.status + ': ' + JSON.stringify(r.body).slice(0, 200));
    const content = (r.body.choices && r.body.choices[0] && r.body.choices[0].message && r.body.choices[0].message.content) || '';
    const parsed = parseContent(content);
    if (!parsed) throw new Error('AI 返回无法解析');
    parsed._mode = 'deepseek';
    return parsed;
  } catch (e) {
    const lp = localParse(text);
    lp._mode = 'deepseek_fallback';
    lp._error = e.message;
    return lp;
  }
}

// ---------- 本地规则回退 ----------
function localParse(text) {
  const t = String(text || '');
  const map = {
    '精装修': '精装修', '装饰': '建筑/装饰', '土建': '土建', '给排水': '给排水', '排水': '给排水', '暖通': '暖通', '空调': '暖通',
    '强电': '强电', '电气': '强电', '弱电': '弱电', '消防': '消防', '喷淋': '消防', '报警': '弱电', '电梯': '电梯',
    '智能化': '智能化', '智能': '智能化', '监控': '弱电', '门禁': '弱电', '防水': '防水', '渗漏': '防水', '门窗': '门窗',
    '幕墙': '幕墙', '玻璃': '幕墙', '标识': '标识导视', '导视': '标识导视', '照明': '照明', '灯光': '照明', '景观': '景观',
    '无障碍': '无障碍', '运营安全': '运营安全', '卫生': '环境卫生', '环境': '环境卫生', '观感': '综合观感',
    '墙面': '精装修', '地砖': '精装修', '瓷砖': '精装修', '吊顶': '精装修', '天花': '精装修', '地面': '精装修',
  };
  let discipline = '其他';
  for (const k of Object.keys(map)) { if (t.includes(k)) { discipline = map[k]; break; } }

  const sevMap = { '重大': 'S1', '严重': 'S1', '坍塌': 'S1', '结构': 'S1', '高': 'S2', '消防': 'S2', '隐患': 'S2', '中': 'S3', '空鼓': 'S3', '破损': 'S3', '低': 'S4', '轻微': 'S5', '观察': 'S5', '色差': 'S4' };
  let severity = 'S3';
  for (const k of Object.keys(sevMap)) { if (t.includes(k)) { severity = sevMap[k]; break; } }

  const flr = t.match(/(B?\d+)\s*[Ff层楼]/);
  const floorName = flr ? flr[1].toUpperCase().replace('B', 'B') + 'F' : '';
  let zoneName = '';
  ['东区', '西区', '南区', '北区', '中庭', '卫生间', '后勤区', '入口', '电梯厅', '走廊', '车库', '设备房', '商铺'].forEach((z) => { if (t.includes(z)) zoneName = z; });

  let title = t.split(/[。；;!\n]/)[0].slice(0, 40);
  if (floorName && !title.includes(floorName)) title = floorName + ' ' + title;
  const priority = (severity === 'S1' || severity === 'S2') ? 'P1' : (severity === 'S3' ? 'P2' : 'P3');

  return {
    title, description: t, discipline, categoryName: '', floorName, zoneName,
    severity, priority, locationDesc: '', suggestedAction: '', standardReference: '', responsibilityHint: '',
  };
}

// ---------- 多轮对话 ----------
function getModel() {
  const cfg = loadCfg();
  return cfg.model || 'deepseek-v4-pro';
}
// 把平台实时数据拼成一段上下文文本（无数据时返回空串）
function buildContextText(ctx) {
  if (!ctx) return '';
  const L = [];
  L.push(`【当前项目实时数据：${ctx.projectName || '未指定'}】】`.replace('】】', '】'));
  if (ctx.stats) {
    const s = ctx.stats;
    L.push(`问题总数 ${s.total}，未关闭 ${s.open}，已关闭 ${s.closed}，逾期未整改 ${s.overdue}，关闭率 ${s.closureRate}%`);
    if (s.rectTotal != null) L.push(`整改记录 ${s.rectTotal} 条，复查记录 ${s.reinsTotal || 0} 条，复发查通过率 ${s.passRate || 0}%`);
  }
  const fmt = (o) => { const e = Object.entries(o || {}); return e.length ? e.map(([k, v]) => `${k} ${v}`).join('、') : '无'; };
  if (ctx.sev) L.push(`严重度分布：${fmt(ctx.sev)}`);
  if (ctx.priDist && Object.keys(ctx.priDist).length) L.push(`优先级分布：${fmt(ctx.priDist)}`);
  if (ctx.statusDist && Object.keys(ctx.statusDist).length) L.push(`状态分布：${fmt(ctx.statusDist)}`);
  if (ctx.disc) L.push(`专业分布：${fmt(ctx.disc)}`);
  if (ctx.flr) L.push(`楼层分布：${fmt(ctx.flr)}`);
  if (ctx.zoneDist && Object.keys(ctx.zoneDist).length) L.push(`区域分布：${fmt(ctx.zoneDist)}`);
  if (ctx.orgDist && Object.keys(ctx.orgDist).length) L.push(`责任单位分布：${fmt(ctx.orgDist)}`);
  if (ctx.batchDist && ctx.batchDist.length) {
    L.push('检查批次（名称/问题数/起止日期）：');
    ctx.batchDist.forEach((b) => L.push(`- ${b.name} ${b.count} 项${b.startDate ? '（' + b.startDate + '至' + (b.endDate || '今') + '）' : ''}`));
  }
  if (ctx.overdueList && ctx.overdueList.length) {
    L.push('逾期问题明细（编号/标题/楼层/严重度/责任单位/截止日）：');
    ctx.overdueList.forEach((r) => L.push(`- ${r.no} ${r.title}（${r.floor}，${r.severity}，${r.org}，截止${r.deadline}）`));
  }
  if (ctx.recent && ctx.recent.length) {
    L.push('最近问题明细（编号/标题/楼层/严重度/状态/责任单位）：');
    ctx.recent.forEach((r) => L.push(`- ${r.no} ${r.title}（${r.floor || '-'}，${r.severity || '-'}，${r.status || '-'}，${r.org || '未指派'}）`));
  }
  if (ctx.floorDetail && ctx.floorDetail.issues && ctx.floorDetail.issues.length) {
    L.push(`用户问到楼层「${ctx.floorDetail.floorName}」的 ${ctx.floorDetail.issues.length} 个问题明细（编号/标题/严重度/优先级/状态/责任单位）：`);
    ctx.floorDetail.issues.forEach((r) => L.push(`- ${r.no} ${r.title}（${r.severity || '-'}，优先级${r.priority || '-'}，${r.status || '-'}，${r.org || '未指派'}）`));
  }
  if (ctx.detail && ctx.detail.issues && ctx.detail.issues.length) {
    const label = ctx.detail.floorName ? `楼层「${ctx.detail.floorName}」`
      : ctx.detail.disciplineName ? `专业「${ctx.detail.disciplineName}」`
      : ctx.detail.batchName ? `检查批次「${ctx.detail.batchName}」`
      : `筛选条件 ${JSON.stringify(ctx.detail.filter || {})}`;
    L.push(`用户问到${label}的 ${ctx.detail.issues.length} 个问题明细（编号/标题/严重度/优先级/状态/责任单位）：`);
    ctx.detail.issues.forEach((r) => L.push(`- ${r.no} ${r.title}（${r.severity || '-'}，优先级${r.priority || '-'}，${r.status || '-'}，${r.org || '未指派'}）`));
  }
  // ---- 商户模块 ----
  if (ctx.merchants) {
    const mo = ctx.merchants;
    L.push(`【商户进场资料模块】商户总数 ${mo.total}，已完成 ${mo.completed}，未完成 ${mo.uncomplete}；资料共 ${mo.docTotal} 条：已验证 ${mo.docVerified}、待审核 ${mo.docSubmitted}、被驳回 ${mo.docRejected}、缺项 ${mo.docMissing}`);
    if (mo.mStatusDist && Object.keys(mo.mStatusDist).length) L.push(`商户状态分布：${fmt(mo.mStatusDist)}`);
    if (mo.mCatDist && Object.keys(mo.mCatDist).length) L.push(`商户业态分布：${fmt(mo.mCatDist)}`);
    if (mo.expiryList && mo.expiryList.length) {
      L.push('证件临期/过期提醒：');
      mo.expiryList.slice(0, 15).forEach((r) => L.push(`- ${r.flag} ${r.days} 天｜${r.merchant}｜${r.doc}（${r.date}）`));
    }
    if (mo.sample && mo.sample.length) {
      L.push('商户样例（名称/业态/铺位/状态/开业日）：');
      mo.sample.forEach((r) => L.push(`- ${r.name}（${r.category}，${r.shopNo || '-'}，${r.status}，${r.openDate || '未定'}）`));
    }
  }
  if (ctx.merchantDetail && ctx.merchantDetail.merchant) {
    const md = ctx.merchantDetail;
    L.push(`用户问到商户「${md.merchant.name}」（${md.merchant.category}，铺位${md.merchant.shopNo || '-'}，状态${md.merchant.status}，开业日${md.merchant.openDate || '未定'}）的 ${(md.docs || []).length} 份资料明细（资料名/状态/有效期/文件名）：`);
    (md.docs || []).forEach((d) => L.push(`- ${d.doc}｜${d.status}${d.expireDate ? '｜到期' + d.expireDate : ''}${d.fileName ? '｜' + d.fileName : ''}`));
  }
  return L.join('\n');
}
function buildChatSystemPrompt(ctxText) {
  return `你是"商场装修承接查验智能助手"，嵌入在一个 Web 管理平台（承接查验与整改闭环）的右侧栏里，帮助用户快速完成日常工作。
平台核心能力：
- 问题管理：创建/编辑/派单/整改/复查/关闭问题；字段含 专业、楼层、区域、位置、严重度(S1重大/S2高/S3中/S4低/S5观察)、优先级(P1/P2/P3)、责任单位、责任人、计划完成日、检查批次、现场照片、平面图定位。
- 商户进场资料：商户档案（名称/品牌/业态/铺位/状态/开业日）与进场资料清单（营业执照、证件等，状态含 已验证/待审核/被驳回/缺项），支持证件临期/过期提醒。
- 你可以用自然语言帮用户：①把一段巡查口述整理成结构化问题；②生成整改通知单/工作联系单文本；③总结某项目/楼层/商户的问题或资料情况与风险；④起草复查结论；⑤解释规范条款。
当用户要"生成内容"时，直接给出可复制使用的文本（整改通知、总结、清单等）。当用户给巡查描述要建问题时，返回 JSON：{title,description,discipline,severity,priority,floorName,zoneName,locationDesc,suggestedAction,standardReference,responsibilityHint}。
语气简洁专业，用中文；不编造平台不存在的功能。
${ctxText ? '以下是系统为你注入的平台实时数据，回答项目/问题相关问题【必须】基于这些数据展开分析（如统计分布、逾期风险、楼层/专业集中度、逐条明细等），不要编造数据；数据未覆盖的细节请如实说明，并建议用户在对应页面查看。\n\n' + ctxText : ''}`;
}
function localChat(messages, ctxText) {
  const last = (messages[messages.length - 1] || {}).content || '';
  const t = String(last);
  if (ctxText && /总结|汇总|分析|分布|风险|概况|怎么样/.test(t)) {
    return `基于当前项目实时数据，为你小结如下：\n\n${ctxText.split('\n').slice(1).join('\n')}\n\n（当前为本地规则模式：只能展示统计快照，无法做更深入的多维分析。配置 DeepSeek 密钥后，可基于同一数据给出风险研判、重点整改建议等。）`;
  }
  if (/整改通知|整改单|工作联系单|通知单/.test(t)) {
    return `【整改通知单（模板）】

致：______（责任单位）
项目：______    楼层/区域：______
问题编号：______    严重度：______    优先级：______
存在问题：
（在此粘贴现场问题描述，或把现场照片/描述发给我，我帮你整理）

整改要求：
1. 请于 ____ 年 __ 月 __ 日前完成整改并反馈；
2. 整改后报监理/查验方复查，复查通过方可关闭；
3. 逾期未改将按合同约定处置。

查验方：______    日期：______

提示：在「问题中心」打开对应问题，点"生成整改"可一键导出带照片的正式通知单。`;
  }
  if (/总结|汇总|分析|分布|风险|概况/.test(t)) {
    return `我目前是「本地规则模式」（未配置 DeepSeek 密钥），无法读取你的实时数据做总结。\n\n两种方式解锁：\n1. 进入「系统设置 → AI 配置」填入 DeepSeek API Key，之后我可直接汇总项目问题；\n2. 把问题清单文本贴给我，我帮你做分类统计与风险归纳。`;
  }
  if (/录入|巡查|口述|现场描述|建(个|立|一)?.{0,4}问题/.test(t)) {
    return `把现场巡查的口述或文字发给我，例如：\n"3F东区地砖空鼓，约2㎡，敲击有空响，疑似砂浆不饱满，需返工"\n\n我会整理成结构化问题（专业/楼层/区域/严重度/优先级等），并给出建议措施与责任单位提示，方便你一键录入。`;
  }
  return `我是承接查验智能助手（本地规则模式）。我可以帮你：
• 把巡查描述整理成结构化问题
• 生成整改通知单 / 工作联系单模板
• 总结问题分布与风险（配置密钥后可读实时数据）
• 起草复查结论、解释规范条款

试试：① 粘贴一段现场描述让我建问题；② 说"生成整改通知单"；③ 进入「系统设置 → AI 配置」填 DeepSeek Key 解锁完整对话能力。`;
}
async function chat(messages, opts) {
  opts = opts || {};
  const key = getKey();
  const ctxText = buildContextText(opts.context);
  if (!key) return { content: localChat(messages, ctxText), mode: 'local', model: 'local' };
  const msgs = [{ role: 'system', content: buildChatSystemPrompt(ctxText) }].concat((messages || []).slice(-20));
  try {
    const r = await httpPostJson(getBaseUrl() + '/v1/chat/completions', { Authorization: 'Bearer ' + key }, {
      model: opts.model || getModel(),
      messages: msgs,
      temperature: 0.7,
      stream: false,
    });
    if (r.status !== 200) throw new Error('AI 返回 ' + r.status + ': ' + JSON.stringify(r.body).slice(0, 160));
    const c = r.body.choices && r.body.choices[0] && r.body.choices[0].message && r.body.choices[0].message.content;
    if (!c) throw new Error('AI 返回为空');
    return { content: c, mode: 'deepseek', model: opts.model || getModel() };
  } catch (e) {
    return { content: '⚠️ DeepSeek 调用失败（' + e.message + '），已回退本地能力：\n\n' + localChat(messages), mode: 'deepseek_fallback', model: opts.model || getModel() };
  }
}

module.exports = {
  isConfigured, getKey, getBaseUrl, getModel, setConfig, parseIssue, localParse, chat, buildContextText,
  DISCIPLINE_HINT, SEVERITY_HINT, buildSystemPrompt,
};
