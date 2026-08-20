'use strict';
/* 商场装修承接查验平台 - 前端 SPA (移动优先, 零依赖) */
(function () {
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (s) => (s ? String(s).slice(0, 10) : '-');
// ISO → datetime-local 输入框格式（YYYY-MM-DDTHH:mm）
function toLocalDT(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
// ISO → 紧凑展示（MM-DD HH:mm）
function fmtDT(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// ISO → 完整展示（YYYY-MM-DD HH:mm）
function fmtFull(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).slice(0, 19).replace('T', ' ');
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// 审计日志等需要“年月日 时分秒”的简单格式（去掉 T/Z 与毫秒）
function fmtTs(s) {
  if (!s) return '-';
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s).slice(0, 19).replace('T', ' ');
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const S = { token: null, user: null, C: null, projects: [], projectId: null,
  floors: [], zones: [], positions: [], disciplines: [], orgs: [], batches: [],
  filters: {}, view: 'dashboard', params: {},
  baseUrl: location.origin, statBoards: [], activeBoardId: null, _preset: null };

async function api(method, path, body) {
  const opt = { method, headers: {} };
  if (S.token) opt.headers['Authorization'] = 'Bearer ' + S.token;
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(path, opt);
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch (e) { data = text; }
  if (r.status === 401) { logout(); throw new Error('登录已失效'); }
  if (!r.ok) throw new Error((data && data.error) || '请求失败');
  return data;
}
function toast(msg, type) {
  const t = $('#toast');
  const cls = type || (/失败|错误|无效|不可|未填|请/.test(msg) ? 'err' : (/已|成功|完成|保存|生成|创建|导出|关闭/.test(msg) ? 'ok' : 'info'));
  t.className = 'toast ' + cls;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2400);
}
function closeModal(m) { if (!m || m._closing) return; m._closing = true; m.classList.remove('show'); setTimeout(() => { if (m.parentNode) m.parentNode.removeChild(m); }, 200); }
function modal(html, wide) {
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="box ${wide ? 'wide' : ''}">${html}</div>`;
  document.body.appendChild(m);
  requestAnimationFrame(() => requestAnimationFrame(() => m.classList.add('show')));
  // 未保存修改保护：用户实际编辑过（input/change 事件）的表单，点遮罩关闭前先确认，避免误触导致输入内容丢失
  m._dirty = false;
  $$('input, select, textarea', m).forEach(el => {
    if (el.type === 'button' || el.type === 'submit' || el.type === 'file' || el.type === 'hidden') return;
    const mark = () => { m._dirty = true; };
    el.addEventListener('input', mark);
    el.addEventListener('change', mark);
  });
  m.addEventListener('mousedown', (e) => { m._mdOnMask = e.target === m; });
  m.addEventListener('click', (e) => {
    if (e.target === m) {
      // 仅在按下与松开都在遮罩上时才视为“关闭意图”（点弹窗边缘阴影/拖选不会误关）
      if (!m._mdOnMask) return;
      if (m._dirty) { confirmDlg('当前表单有尚未保存的修改，确定放弃并关闭吗？', () => closeModal(m), '放弃修改', '未保存提醒'); }
      else closeModal(m);
    }
  });
  m.remove = () => closeModal(m);
  return m;
}
// 自研确认/输入弹窗（避免 iframe/沙箱环境下原生 confirm/prompt 被拦截无反应）
const WARN_SVG = '<svg viewBox="0 0 24 24" width="44" height="44"><path d="M12 2L1 21h22L12 2zm0 5.5L19.5 19h-15L12 7.5zm-1 4v4h2v-4h-2zm0 5v2h2v-2h-2z" fill="currentColor"/></svg>';
const INFO_SVG = '<svg viewBox="0 0 24 24" width="44" height="44"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" fill="currentColor"/></svg>';
function _dlgTitle(okLabel) {
  if (!okLabel) return '请确认';
  if (/删除|移除/.test(okLabel)) return '删除确认';
  if (/完成|关闭/.test(okLabel)) return '完成确认';
  if (/取消/.test(okLabel)) return '取消确认';
  return '操作确认';
}
function confirmDlg(msg, onOk, okLabel, title) {
  const isDanger = /删除|移除|取消/.test(okLabel || '');
  const iconSvg = isDanger ? WARN_SVG : INFO_SVG;
  const t = title || _dlgTitle(okLabel);
  const m = modal(`<div class="dlg ${isDanger ? 'danger' : ''}">
    <div class="dlg-icon">${iconSvg}</div>
    <div class="dlg-body">
      <div class="dlg-title">${esc(t)}</div>
      <div class="dlg-msg">${esc(msg)}</div>
    </div>
    <div class="dlg-foot">
      <button class="btn ghost" data-no>取消</button>
      <button class="btn ${isDanger ? 'danger' : ''}" data-yes>${esc(okLabel || '确定')}</button>
    </div></div>`, true);
  m.querySelector('[data-no]').onclick = () => closeModal(m);
  m.querySelector('[data-yes]').onclick = () => { closeModal(m); onOk(); };
}
function promptDlg(msg, placeholder, onOk, title) {
  const t = title || '请输入';
  const m = modal(`<div class="dlg">
    <div class="dlg-icon" style="color:var(--primary)">${INFO_SVG}</div>
    <div class="dlg-body">
      <div class="dlg-title">${esc(t)}</div>
      <div class="dlg-msg">${esc(msg)}</div>
      <input id="pdInput" class="dlg-input" placeholder="${esc(placeholder || '')}" maxlength="60">
    </div>
    <div class="dlg-foot">
      <button class="btn ghost" data-no>取消</button>
      <button class="btn" data-yes>确定</button>
    </div></div>`, true);
  const inp = m.querySelector('#pdInput');
  const ok = () => { const v = inp.value.trim(); if (!v) return toast('请填写内容'); closeModal(m); onOk(v); };
  m.querySelector('[data-no]').onclick = () => closeModal(m);
  m.querySelector('[data-yes]').onclick = ok;
  inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
  setTimeout(() => inp.focus(), 60);
}

// ---------- icons (inline SVG, lucide-style, no CDN) ----------
const _ic = (p) => `<svg class="ic" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICONS = {
  dashboard: _ic('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  projects: _ic('<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>'),
  issues: _ic('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'),
  ai: _ic('<path d="M12 3l1.9 5.7 5.7 1.9-5.7 1.9L12 18.2l-1.9-5.7-5.7-1.9 5.7-1.9L12 3z"/><path d="M19 15l.9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9L19 15z"/>'),
  merchants: _ic('<path d="M3 9l1.5-5h15L21 9"/><path d="M3 9v1a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0 3 3v-1"/><path d="M5 13v8h14v-8"/><path d="M9 21v-6h6v6"/>'),
  rectifications: _ic('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'),
  reinspections: _ic('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 14l2 2 4-4"/>'),
  plan: _ic('<path d="M9 3L3 6v15l6-3 6 3 6-3V3l-6 3-6-3z"/><path d="M9 3v15"/><path d="M15 6v15"/>'),
  statboards: _ic('<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6" rx=".5"/><rect x="12" y="8" width="3" height="10" rx=".5"/><rect x="17" y="5" width="3" height="13" rx=".5"/>'),
  settings: _ic('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><circle cx="12" cy="12" r="3"/>'),
  audit: _ic('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'),
  accounts: _ic('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  perm: _ic('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>'),
  menu: _ic('<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>'),
  logout: _ic('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'),
  user: _ic('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  plus: _ic('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  plusCircle: _ic('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>'),
  chevronDown: _ic('<polyline points="6 9 12 15 18 9"/>'),
  chevronRight: _ic('<polyline points="9 6 15 12 9 18"/>'),
  building: _ic('<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h2M14 6h2M8 10h2M14 10h2M8 14h2M14 14h2"/>'),
  shieldCheck: _ic('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>'),
  search: _ic('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
  download: _ic('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  fileExcel: _ic('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><line x1="12" y1="13" x2="12" y2="17"/>'),
  filePDF: _ic('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15h1.5a1.5 1.5 0 0 1 0 3H9v-3zm0 0v-2h4"/>'),
  fileWord: _ic('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'),
  alertTriangle: _ic('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
  clock: _ic('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  mapPin: _ic('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'),
  qr: _ic('<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><path d="M15 15h3v3h-3z"/><path d="M21 15v.01M18 18v.01M15 21h.01M21 18v.01"/>'),
  camera: _ic('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
  edit: _ic('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>'),
  trash: _ic('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  x: _ic('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  checkCircle: _ic('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'),
  key: _ic('<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>'),
  arrowRight: _ic('<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>'),
  eye: _ic('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
  phone: _ic('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>'),
  layers: _ic('<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>'),
  zap: _ic('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
  refresh: _ic('<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>'),
  trending: _ic('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'),
  clipboard: _ic('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><line x1="8" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="12" y2="15"/>'),
  calendar: _ic('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
};
// 导航分组配置（仅影响侧边栏展示层级，不改 NAV 数组结构）
const NAV_GROUPS = [
  { title: '工作台', items: ['dashboard', 'projects', 'issues', 'rectifications', 'reinspections'] },
  { title: '现场与资料', items: ['ai', 'plan', 'rooms', 'merchants', 'statboards'] },
  { title: '系统管理', items: ['settings', 'audit'] },
];

// ---------- charts (SVG, no CDN) ----------
// 干净分类调色板：色相均匀分布、饱和度适中（避免刺眼），供专业/楼层/责任单位等分类图循环使用。
// 优先级：条目自带 d.c（语义色，如严重度分级）> color 数组（分类调色板，按序循环）> color 单色 > CSS 默认渐变。
const PALETTE = ['#3b82f6', '#14b8a6', '#f59e0b', '#8b5cf6', '#ef4444', '#0ea5e9', '#22c55e', '#ec4899', '#6366f1', '#f97316'];
function bars(data, color) {
  const max = Math.max(1, ...data.map((d) => d.v));
  return `<div class="chart">${data.map((d, i) => {
    const c = d.c || (Array.isArray(color) ? color[i % color.length] : color);
    return `
    <div class="bar-row"><div class="name" title="${esc(d.k)}">${esc(d.k)}</div>
    <div class="track"><div class="fill" style="transform:scaleX(${(d.v / max).toFixed(3)});${c ? `background:${c}` : ''}"></div></div>
    <div class="val" ${c ? `style="color:${c}"` : ''}>${d.v}</div></div>`;
  }).join('')}</div>`;
}
function lineChart(data) {
  const w = 560, h = 190, pl = 30, pr = 14, pt = 26, pb = 28;
  const max = Math.max(1, ...data.flatMap((d) => [d.found, d.closed]));
  const n = data.length || 1;
  const X = (i) => pl + (i / (n - 1 || 1)) * (w - pl - pr);
  const Y = (v) => pt + (1 - v / max) * (h - pt - pb);
  const pts = (key) => data.map((d, i) => `${X(i).toFixed(1)},${Y(d[key]).toFixed(1)}`).join(' ');
  const area = (key) => `${X(0).toFixed(1)},${(h - pb).toFixed(1)} ${pts(key)} ${X(n - 1).toFixed(1)},${(h - pb).toFixed(1)}`;
  const grid = [0, .5, 1].map((g) => { const y = (pt + g * (h - pt - pb)).toFixed(1); return `<line x1="${pl}" y1="${y}" x2="${w - pr}" y2="${y}" stroke="#eef2f7" stroke-width="1"/>`; }).join('');
  const labels = data.map((d, i) => `<text x="${X(i).toFixed(1)}" y="${h - 9}" font-size="10" fill="#94a3b8" text-anchor="middle">${esc(d.date.slice(5))}</text>`).join('');
  const dots = (key, col) => data.map((d, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(d[key]).toFixed(1)}" r="2.8" fill="#fff" stroke="${col}" stroke-width="2"/>`).join('');
  return `<svg class="chart" viewBox="0 0 ${w} ${h}">
    <defs><linearGradient id="gFound" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2563eb" stop-opacity=".18"/><stop offset="100%" stop-color="#2563eb" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    <polygon points="${area('found')}" fill="url(#gFound)"/>
    <polyline points="${pts('found')}" fill="none" stroke="#2563eb" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline points="${pts('closed')}" fill="none" stroke="#16a34a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots('found', '#2563eb')}${dots('closed', '#16a34a')}
    ${labels}
    <g font-size="11" font-weight="700"><text x="${pl}" y="15" fill="#2563eb">● 发现</text><text x="${pl + 56}" y="15" fill="#16a34a">● 关闭</text></g>
  </svg>`;
}

// ---------- auth ----------
async function login(username, password) {
  const r = await api('POST', '/api/login', { username, password });
  S.token = r.token; S.user = r.user;
  localStorage.setItem('token', r.token); localStorage.setItem('user', JSON.stringify(r.user));
  await boot();
}
function logout() { S.token = null; S.user = null; localStorage.removeItem('token'); localStorage.removeItem('user'); $('#root').innerHTML = ''; renderLogin(); }

async function boot() {
  try {
    S.C = await api('GET', '/api/constants');
    const me = await api('GET', '/api/me'); S.user = me.user;
    const p = await api('GET', '/api/projects'); S.projects = p.projects;
    S.projectId = S.projects[0] ? S.projects[0].id : null;
    // 取局域网基址，用于生成手机可扫的二维码（避免 localhost 在手机上不可达）
    try { const net = await api('GET', '/api/network'); if (net && net.ip) S.baseUrl = `http://${net.ip}:${net.port}`; } catch (e) {}
    renderApp();
  } catch (e) { logout(); }
}

// ---------- shell ----------
const NAV = [
  { view: 'dashboard', label: '仪表盘', icon: 'dashboard' },
  { view: 'projects', label: '项目', icon: 'projects' },
  { view: 'issues', label: '问题中心', icon: 'issues' },
  { view: 'ai', label: 'AI 录入', icon: 'ai' },
  { view: 'rooms', label: '房源管理', icon: 'building' },
  { view: 'merchants', label: '商户资料', icon: 'merchants' },
  { view: 'rectifications', label: '整改中心', icon: 'rectifications' },
  { view: 'reinspections', label: '复查中心', icon: 'reinspections' },
  { view: 'plan', label: '平面图', icon: 'plan' },
  { view: 'statboards', label: '统计表', icon: 'statboards' },
  { view: 'settings', label: '系统设置', icon: 'settings' },
  { view: 'audit', label: '审计日志', icon: 'audit' },
];
const ADMIN_NAV = [{ view: 'accounts', label: '账号管理', icon: 'accounts' }, { view: 'perm', label: '权限中心', icon: 'perm' }];
function isAdmin() { return !!(S.user && (S.user.role === '超级管理员' || (S.user.permissions && S.user.permissions.includes('role_manage')))); }
function allNav() { return isAdmin() ? [...NAV, ...ADMIN_NAV] : NAV; }
function navItem(view) { return allNav().find(n => n.view === view); }
// 顶栏用户下拉：点击其它区域自动收起（具名函数，避免重复注册累积）
function closeTbDrop(e) { const d = document.getElementById('tbDrop'); if (d && !d.contains(e.target)) d.classList.remove('open'); }
// 渲染侧边栏：按 NAV_GROUPS 分组，管理员项归入「系统管理」组；分组可点击折叠/展开（localStorage 持久化）
function navCollapsedSet() {
  try { return JSON.parse(localStorage.getItem('wb_nav_collapsed') || '[]'); } catch (e) { return []; }
}
function navGroupView(group) { return NAV_GROUPS.find((g) => g.title === group); }
function renderSidebarNav() {
  const admin = isAdmin();
  const groups = NAV_GROUPS.map(g => ({ ...g, items: g.items.filter(v => navItem(v)) }));
  if (admin) groups[groups.length - 1].items = [...groups[groups.length - 1].items, ...ADMIN_NAV.map(n => n.view)];
  const link = (n) => `<a data-view="${n.view}" title="${esc(n.label)}">${ICONS[n.icon] || ICONS.clipboard}<span>${esc(n.label)}</span></a>`;
  const collapsed = new Set(navCollapsedSet());
  return groups.map(g => {
    if (!g.items.length) return '';
    const on = !collapsed.has(g.title);
    return `<div class="nav-group ${on ? '' : 'collapsed'}" data-group="${esc(g.title)}">
      <div class="nav-group-title" data-navtoggle="${esc(g.title)}" title="点击折叠/展开">${ICONS.chevronDown}<span>${esc(g.title)}</span></div>
      <div class="nav-group-items">${g.items.map(v => link(navItem(v))).join('')}</div>
    </div>`;
  }).join('');
}
function expandNavGroupFor(view) {
  const g = NAV_GROUPS.find((grp) => grp.items.includes(view) || (isAdmin() && ADMIN_NAV.some((a) => a.view === view)));
  if (!g) return;
  const el = [...document.querySelectorAll('.nav-group')].find((x) => x.dataset.group === g.title);
  if (el && el.classList.contains('collapsed')) el.classList.remove('collapsed');
  const list = navCollapsedSet().filter((x) => x !== g.title);
  localStorage.setItem('wb_nav_collapsed', JSON.stringify(list));
}
function initNavCollapse() {
  $$('.nav-group-title[data-navtoggle]').forEach((hd) => {
    hd.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      const grp = hd.parentElement;
      grp.classList.toggle('collapsed');
      const set = navCollapsedSet();
      const t = hd.dataset.navtoggle;
      const i = set.indexOf(t);
      if (grp.classList.contains('collapsed')) { if (i < 0) set.push(t); }
      else if (i >= 0) set.splice(i, 1);
      localStorage.setItem('wb_nav_collapsed', JSON.stringify(set));
    };
  });
}
function renderApp() {
  const root = $('#root');
  const u = S.user || {};
  const initial = (u.name || '用')[0] || '用';
  const roleClass = (u.role || '').includes('管理员') ? 'adm' : ((u.role || '').includes('项目经理') ? 'pm' : 'op');
  root.innerHTML = `
  <div id="app" class="${localStorage.getItem('wb_sb_mini') === '1' ? 'app-mini' : ''}">
    <aside class="sidebar" id="sidebar">
      <div class="brand">
        <span class="brand-logo">${ICONS.building}</span>
        <div class="brand-tx"><b>承接查验平台</b><small>商场装修开业查验闭环</small></div>
        <button class="brand-fold" id="sbFold" title="折叠/展开侧边栏" aria-label="折叠/展开侧边栏">${ICONS.chevronDown}</button>
      </div>
      <nav class="nav" id="nav">${renderSidebarNav()}</nav>
      <div class="me" id="meCard">
        <div class="me-avatar ${roleClass}">${esc(initial)}</div>
        <div class="me-info"><b>${esc(u.name || '')}</b><span>${esc(u.role || '')}</span></div>
        <button class="me-btn" id="logout" title="退出登录">${ICONS.logout}</button>
      </div>
    </aside>
    <div class="main">
      <div class="topbar">
        <button class="menu-btn" id="menuBtn">${ICONS.menu}<span>菜单</span></button>
        <div class="tb-title"><h1 id="pageTitle">仪表盘</h1><span class="tb-sub" id="pageSub"></span></div>
        <div class="spacer"></div>
        <div class="proj-pick">
          <span class="pp-label">${ICONS.building}<em>当前项目</em></span>
          <select id="projSel">${S.projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
          ${ICONS.chevronDown}
        </div>
        <div class="tb-user" id="tbUser">
          <div class="me-avatar ${roleClass} sm">${esc(initial)}</div>
          <div class="tb-user-tx"><b>${esc(u.name || '')}</b><span>${esc(u.role || '')}</span></div>
          ${ICONS.chevronDown}
          <div class="tb-drop" id="tbDrop">
            <div class="tb-drop-hd"><span class="me-avatar ${roleClass}">${esc(initial)}</span><div><b>${esc(u.name || '')}</b><span>${esc(u.role || '')}</span></div></div>
            <a data-act="settings">${ICONS.settings}<span>系统设置</span></a>
            <a data-act="logout">${ICONS.logout}<span>退出登录</span></a>
          </div>
        </div>
      </div>
      <div class="content" id="content"></div>
    </div>
    <nav class="bottom-nav">
      ${[NAV[0], NAV[2], { view: 'new', label: '新增' }, NAV[3], { view: 'settings', label: '我的' }].map(n => `<a data-view="${n.view}">${ICONS[n.icon] || ICONS.plusCircle}<span>${esc(n.label)}</span></a>`).join('')}
    </nav>
  </div>`;
  $('#projSel').value = S.projectId || '';
  $('#projSel').onchange = (e) => { S.projectId = e.target.value; go(S.view); };
  $('#logout').onclick = logout;
  // 侧边栏总折叠/展开（迷你模式，localStorage 持久化）
  const sbFold = $('#sbFold');
  const syncFold = () => {
    const mini = $('#app').classList.contains('app-mini');
    sbFold.title = mini ? '展开侧边栏' : '折叠侧边栏';
    sbFold.setAttribute('aria-label', mini ? '展开侧边栏' : '折叠侧边栏');
    sbFold.classList.toggle('folded', mini);
  };
  sbFold.onclick = () => {
    const app = $('#app');
    app.classList.toggle('app-mini');
    localStorage.setItem('wb_sb_mini', app.classList.contains('app-mini') ? '1' : '0');
    syncFold();
  };
  syncFold();
  $('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
  // 顶栏用户下拉
  const tbUser = $('#tbUser'), tbDrop = $('#tbDrop');
  tbUser.onclick = (e) => { e.stopPropagation(); tbDrop.classList.toggle('open'); };
  document.removeEventListener('click', closeTbDrop);
  document.addEventListener('click', closeTbDrop);
  $$('#tbDrop a').forEach(a => a.onclick = (e) => { e.stopPropagation(); tbDrop.classList.remove('open'); const act = a.dataset.act; if (act === 'logout') logout(); else if (act === 'settings') go('settings'); });
  // 侧边栏点击后自动收起（移动端）
  $$('#nav a, .bottom-nav a').forEach(a => a.onclick = () => { const v = a.dataset.view; if (v === 'new') return openIssueModal(); go(v); $('#sidebar').classList.remove('open'); });
  initNavCollapse();
  loadProjectData().then(() => go(S.view || 'dashboard'));
  initAIPanel();
}
function setActiveNav(view) {
  expandNavGroupFor(view);
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  $$('.bottom-nav a').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  const nav = navItem(view);
  $('#pageTitle').textContent = nav ? nav.label : '承接查验';
  const sub = $('#pageSub');
  if (sub) {
    let group = '';
    for (const g of NAV_GROUPS) { if (g.items.includes(view)) { group = g.title; break; } }
    if (!group && (view === 'accounts' || view === 'perm')) group = '系统管理';
    sub.textContent = group;
  }
}
async function loadProjectData() {
  if (!S.projectId) return;
  const [f, z, pos, d, o, b] = await Promise.all([
    api('GET', `/api/projects/${S.projectId}/floors`),
    api('GET', '/api/zones').catch(() => ({ zones: [] })),
    api('GET', `/api/projects/${S.projectId}/positions`).catch(() => ({ positions: [] })),
    api('GET', '/api/disciplines'),
    api('GET', '/api/organizations'),
    api('GET', `/api/projects/${S.projectId}/batches`),
  ]);
  S.floors = f.floors; S.positions = pos.positions || [];
  S.disciplines = d.disciplines; S.orgs = o.organizations; S.batches = b.batches;
  const zAll = await api('GET', '/api/zones').catch(() => ({ zones: [] })); S.zones = zAll.zones;
}
function go(view, params) {
  S.view = view; S.params = params || {};
  setActiveNav(view);
  const c = $('#content');
  const map = { dashboard: viewDashboard, projects: viewProjects, issues: viewIssues,
    ai: viewAI, plan: viewPlan, rooms: viewRooms, merchants: viewMerchants, docTypes: viewDocTypes,
    rectifications: () => viewIssueList('rectifications'), reinspections: () => viewIssueList('reinspections'),
    statboards: viewStatBoards, settings: viewSettings, audit: viewAudit,
    accounts: viewAccounts, perm: viewPermissionCenter };
  (map[view] || viewDashboard)(c);
}

// ---------- 右侧栏 AI 助手 ----------
function mdText(s) {
  let t = esc(String(s || ''));
  t = t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  t = t.replace(/\n/g, '<br>');
  return t;
}
function initAIPanel() {
  if (document.getElementById('aiPanel')) return; // 幂等：只挂一次
  const fab = document.createElement('button');
  fab.id = 'aiFab'; fab.className = 'ai-fab'; fab.title = 'AI 助手'; fab.innerHTML = ICONS.ai;
  const panel = document.createElement('aside');
  panel.id = 'aiPanel'; panel.className = 'ai-panel';
  panel.innerHTML = `
    <header class="ai-head">
      <b>AI 助手</b>
      <select id="aiModelSel" class="ai-mode-sel" title="切换模型">
        <option value="deepseek-v4-pro">V4 Pro</option>
        <option value="deepseek-v4-flash">V4 Flash</option>
        <option value="deepseek-reasoner">Reasoner</option>
        <option value="deepseek-chat">Chat（旧）</option>
      </select>
      <button id="aiClose" class="ai-x" title="收起">×</button>
    </header>
    <div id="aiMsgs" class="ai-msgs"></div>
    <div class="ai-quick">
      <button data-q="帮我录入一段现场巡查描述，整理成结构化问题">录入巡查</button>
      <button data-q="请生成一份整改通知单模板">整改通知单</button>
      <button data-q="基于当前项目数据，总结问题分布与风险，并给出整改优先级建议">项目总结</button>
      <button data-q="3F 有哪些问题？逐条列出">楼层明细</button>
    </div>
    <div class="ai-gen">
      <button id="genExcel" title="导出当前项目全部问题为 .xls">${ICONS.fileExcel} Excel</button>
      <button id="genPDF" title="生成当前项目问题清单 PDF">${ICONS.filePDF} PDF</button>
      <button id="genWord" title="生成整改通知单 Word">${ICONS.fileWord} Word</button>
    </div>
    <div class="ai-input">
      <textarea id="aiIn" rows="2" placeholder="问我任何关于查验/整改的问题，或粘贴现场描述…"></textarea>
      <button id="aiSend" class="btn primary sm">发送</button>
    </div>`;
  document.body.appendChild(fab);
  document.body.appendChild(panel);
  S._aiHist = S._aiHist || [];
  const msgs = $('#aiMsgs', panel);
  const input = $('#aiIn', panel);
  function renderMsg(role, content) {
    const d = document.createElement('div');
    d.className = 'ai-msg ' + (role === 'user' ? 'user' : 'bot');
    d.innerHTML = mdText(content);
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
  }
  function welcome() {
    msgs.innerHTML = '';
    renderMsg('bot', '你好，我是承接查验智能助手。可以帮你录入巡查问题、生成整改通知单、总结项目风险。先试试下面的快捷指令，或直接在下方输入。');
  }
  function setMode() {
    api('GET', '/api/ai/status').then((r) => {
      const sel = $('#aiModelSel', panel);
      if (sel) sel.value = r.model || 'deepseek-v4-pro';
    }).catch(() => {});
  }
  $('#aiModelSel', panel).onchange = async (e) => {
    const model = e.target.value;
    try {
      await api('POST', '/api/ai/config', { model });
      renderMsg('bot', '已切换模型：**' + model + '**（下一次对话生效）');
    } catch (err) { renderMsg('bot', '切换失败：' + err.message); }
  };
  // 三个文档生成函数（对话指令和按钮共用）
  async function fetchProjectIssues() {
    return api('GET', `/api/issues?projectId=${S.projectId}&pageSize=1000`).then((r) => r.issues || []);
  }
  const projectName = () => (S.projects.find((p) => p.id === S.projectId) || {}).name || '项目';
  async function genExcelDoc() {
    const r = await fetch('/api/projects/' + S.projectId + '/issues-export-xls', { headers: { Authorization: 'Bearer ' + S.token } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const blob = await r.blob();
    downloadBlob(blob, `${projectName()}_问题清单.xlsx`);
  }
  async function genPDFDoc() {
    const issues = await fetchProjectIssues();
    const proj = projectName();
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const tmp = document.createElement('div');
    tmp.style.cssText = 'position:fixed;left:-99999px;top:0;width:1200px;background:#fff;padding:24px;font-family:"Microsoft YaHei",宋体,sans-serif;color:#000;';
    tmp.innerHTML = `<h2 style="margin:0 0 6px">${esc(proj)} · 问题清单</h2><p style="margin:0 0 14px;color:#666;font-size:12px">生成时间：${new Date().toLocaleString()}　问题总数：${issues.length}</p><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#2563eb;color:#fff"><th style="padding:6px;border:1px solid #d4dbe6">#</th><th style="padding:6px;border:1px solid #d4dbe6">编号</th><th style="padding:6px;border:1px solid #d4dbe6">标题</th><th style="padding:6px;border:1px solid #d4dbe6">专业</th><th style="padding:6px;border:1px solid #d4dbe6">楼层/区域</th><th style="padding:6px;border:1px solid #d4dbe6">严重度</th><th style="padding:6px;border:1px solid #d4dbe6">优先级</th><th style="padding:6px;border:1px solid #d4dbe6">状态</th><th style="padding:6px;border:1px solid #d4dbe6">责任单位</th></tr></thead><tbody>${issues.map((i, idx) => `<tr><td style="padding:5px;border:1px solid #e7ebf2">${idx + 1}</td><td style="padding:5px;border:1px solid #e7ebf2">${esc(i.issueNo)}</td><td style="padding:5px;border:1px solid #e7ebf2">${esc(i.title)}</td><td style="padding:5px;border:1px solid #e7ebf2">${esc(i.disciplineName)}</td><td style="padding:5px;border:1px solid #e7ebf2">${esc(i.floorName)}/${esc(i.zoneName)}</td><td style="padding:5px;border:1px solid #e7ebf2">${esc(i.severity)}</td><td style="padding:5px;border:1px solid #e7ebf2">${esc(i.priority)}</td><td style="padding:5px;border:1px solid #e7ebf2">${esc(S.C.ISSUE_STATUS_LABEL[i.rectificationStatus] || i.rectificationStatus)}</td><td style="padding:5px;border:1px solid #e7ebf2">${esc(i.responsibleOrgName)}</td></tr>`).join('')}</tbody></table>`;
    document.body.appendChild(tmp);
    const canvas = await html2canvas(tmp, { scale: 2, backgroundColor: '#fff' });
    document.body.removeChild(tmp);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    const imgW = pw;
    const imgH = canvas.height * pw / canvas.width;
    let heightLeft = imgH, position = 0;
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, position, imgW, imgH);
    heightLeft -= ph;
    while (heightLeft > 0) {
      position = heightLeft - imgH;
      doc.addPage();
      doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, position, imgW, imgH);
      heightLeft -= ph;
    }
    doc.save(`${proj}_问题清单.pdf`);
  }
  async function genWordDoc() {
    const issues = await fetchProjectIssues();
    const proj = projectName();
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rows = issues.map((i, idx) => `<tr><td>${idx + 1}</td><td>${esc(i.issueNo)}</td><td>${esc(i.title)}</td><td>${esc(i.disciplineName)}</td><td>${esc(i.floorName)}/${esc(i.zoneName)}</td><td>${esc(i.severity)}</td><td>${esc(i.priority)}</td><td>${esc(S.C.ISSUE_STATUS_LABEL[i.rectificationStatus] || i.rectificationStatus)}</td><td>${esc(i.responsibleOrgName)}</td></tr>`).join('');
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(proj)} 问题清单</title><style>body{font-family:宋体;font-size:11pt}h1{font-size:16pt}table{border-collapse:collapse;width:100%}th,td{border:1px solid #888;padding:4px 6px}th{background:#2563eb;color:#fff}</style></head><body><h1>${esc(proj)} 问题整改清单</h1><p>生成时间：${new Date().toLocaleString()}　问题总数：${issues.length}</p><table><thead><tr><th>#</th><th>编号</th><th>标题</th><th>专业</th><th>楼层/区域</th><th>严重度</th><th>优先级</th><th>状态</th><th>责任单位</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    const blob = new Blob(['\ufeff' + html], { type: 'application/msword' });
    downloadBlob(blob, `${proj}_问题清单.doc`);
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  // 文档意图识别：对话里说"生成/导出 + Word/PDF/Excel" → 直接生成文件下载
  function detectDocIntent(text) {
    if (/excel|xlsx|表格/.test(text)) return 'excel';
    if (/word|doc|整改通知|联系单|通知单/.test(text)) return 'word';
    if (/pdf|报告|report/.test(text)) return 'pdf';
    return null;
  }
  const DOC_LABEL = { excel: 'Excel 问题清单', pdf: 'PDF 问题清单', word: 'Word 问题清单' };
  async function runDocGen(type) {
    try {
      if (type === 'excel') await genExcelDoc();
      else if (type === 'pdf') await genPDFDoc();
      else await genWordDoc();
      return { ok: true, msg: '已生成 ' + DOC_LABEL[type] + '，文件已开始下载（基于当前项目真实数据）。' };
    } catch (e) { return { ok: false, msg: DOC_LABEL[type] + ' 生成失败：' + e.message }; }
  }
  $('#genExcel', panel).onclick = async () => { const r = await runDocGen('excel'); renderMsg('bot', r.msg); };
  $('#genPDF', panel).onclick = async () => { const r = await runDocGen('pdf'); renderMsg('bot', r.msg); };
  $('#genWord', panel).onclick = async () => { const r = await runDocGen('word'); renderMsg('bot', r.msg); };
  function matchContext(text) {
    const m = {};
    const floorHit = (S.floors || []).find((f) => f.name && text.includes(f.name));
    if (floorHit) m.floorId = floorHit.id;
    const discHit = (S.disciplines || []).find((d) => d.name && text.includes(d.name));
    if (discHit) m.disciplineId = discHit.id;
    if (/S[1-5]/.test(text)) { const s = text.match(/S[1-5]/)[0]; m.severity = s; }
    if (/P[1-3]/.test(text)) { const p = text.match(/P[1-3]/)[0]; m.priority = p; }
    if (/逾期|超期/.test(text)) m.overdue = 1;
    if (/未关闭|未整改|待整改|未处理/.test(text)) m.status = 'OPEN';
    if (/已关闭|已整改/.test(text)) m.status = 'CLOSED';
    if (/整改中/.test(text)) m.status = 'IN_RECTIFICATION';
    if (/复查中|待复查|复查驳回/.test(text)) m.status = 'REINSPECT';
    const batchHit = (S.batches || []).find((b) => b.name && text.includes(b.name));
    if (batchHit) m.batchId = batchHit.id;
    return m;
  }
  async function sendMsg(text) {
    text = (text || '').trim();
    if (!text) return;
    S._aiHist.push({ role: 'user', content: text });
    renderMsg('user', text);
    input.value = '';
    // 文档生成指令：说"生成/导出/下载 + Word/PDF/Excel" → 直接产出文件，不走对话模型
    if (/生成|导出|下载/.test(text)) {
      const dt = detectDocIntent(text);
      if (dt) {
        const w = document.createElement('div');
        w.className = 'ai-msg bot waiting'; w.textContent = '正在读取项目数据并生成 ' + DOC_LABEL[dt] + '…';
        msgs.appendChild(w); msgs.scrollTop = msgs.scrollHeight;
        const r = await runDocGen(dt);
        w.remove();
        renderMsg('bot', r.msg);
        return;
      }
    }
    const wait = document.createElement('div');
    wait.className = 'ai-msg bot waiting'; wait.textContent = '正在读取项目数据并思考…';
    msgs.appendChild(wait); msgs.scrollTop = msgs.scrollHeight;
    // 数据联动：命中楼层/专业/批次/状态/严重度 → 拉真实明细
    const extra = {};
    const ctxMatch = matchContext(text);
    if (Object.keys(ctxMatch).length) {
      try {
        const params = new URLSearchParams(Object.assign({ projectId: S.projectId }, ctxMatch));
        const r = await api('GET', `/api/issues?${params}`);
        const detail = {
          filter: ctxMatch,
          floorName: ctxMatch.floorId ? (S.floors.find((f) => f.id === ctxMatch.floorId) || {}).name : '',
          disciplineName: ctxMatch.disciplineId ? (S.disciplines.find((d) => d.id === ctxMatch.disciplineId) || {}).name : '',
          issues: (r.issues || []).map((i) => ({
            no: i.issueNo, title: i.title, severity: i.severity, priority: i.priority,
            status: S.C.ISSUE_STATUS_LABEL[i.rectificationStatus] || i.rectificationStatus,
            org: i.responsibleOrgName || '',
          })),
        };
        extra.detail = detail;
        wait.textContent = '已按筛选载入 ' + (r.issues || []).length + ' 条问题，正在分析…';
      } catch (e) {}
    }
    // 数据联动：命中商户名 → 拉该商户资料明细
    if (/商户|资料|证件|执照|进场|开业/.test(text)) {
      try {
        const mr = await api('GET', '/api/merchants');
        const hit = (mr.merchants || []).find((x) => (x.name && text.includes(x.name)) || (x.brand && text.includes(x.brand)));
        if (hit) {
          const dr = await api('GET', `/api/merchants/${hit.id}/docs`);
          extra.merchantDetail = {
            merchant: { name: hit.name, category: hit.category, shopNo: hit.shopNo, status: hit.status, openDate: hit.openDate },
            docs: (dr.docs || []).map((d) => ({
              doc: (d.docType && d.docType.name) || d.docTypeId,
              status: d.status, expireDate: d.expireDate, fileName: d.fileName,
            })),
          };
          wait.textContent = '已载入商户「' + hit.name + '」的 ' + (dr.docs || []).length + ' 份资料，正在分析…';
        }
      } catch (e) {}
    }
    try {
      const r = await api('POST', '/api/ai/chat', { messages: S._aiHist, projectId: S.projectId, extra });
      wait.remove();
      S._aiHist.push({ role: 'assistant', content: r.content });
      renderMsg('assistant', r.content);
      if (r.mode === 'local' || r.mode === 'deepseek_fallback') { const sel = $('#aiModelSel', panel); if (sel) { sel.classList.add('fb'); sel.title = 'DeepSeek 调用失败，已回退本地规则'; setTimeout(() => sel.classList.remove('fb'), 3000); } }
    } catch (e) {
      wait.remove();
      renderMsg('bot', '请求失败：' + e.message);
    }
  }
  $('#aiSend', panel).onclick = () => sendMsg(input.value);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(input.value); } });
  $$('.ai-quick button', panel).forEach((b) => (b.onclick = () => sendMsg(b.dataset.q)));
  $('#aiClose', panel).onclick = () => panel.classList.remove('open');
  fab.onclick = () => {
    panel.classList.toggle('open');
    if (panel.classList.contains('open') && !msgs.children.length) { welcome(); setMode(); }
  };
}

// ---------- login ----------
function renderLogin() {
  $('#root').innerHTML = `
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-brand">
        <div class="lb-logo">${ICONS.shieldCheck}</div>
        <div class="lb-tx"><b>承接查验平台</b><span>Handover & Inspection Platform</span></div>
        <h2>商场装修承接查验</h2>
        <p class="lb-sub">开业前承接查验 · 整改闭环 · 数字化协同管理<br>覆盖查验建档、问题追踪、整改复查与资料归档全流程</p>
        <div class="lb-feats">
          <div class="lb-f"><span class="lb-f-ic c1">${ICONS.clipboard}</span><div><b>全流程闭环</b><small>查验 → 整改 → 复查 → 归档</small></div></div>
          <div class="lb-f"><span class="lb-f-ic c2">${ICONS.zap}</span><div><b>AI 智能录入</b><small>现场描述一键结构化</small></div></div>
          <div class="lb-f"><span class="lb-f-ic c3">${ICONS.qr}</span><div><b>扫码协同</b><small>手机扫码直达，现场即录</small></div></div>
          <div class="lb-f"><span class="lb-f-ic c4">${ICONS.fileExcel}</span><div><b>一键汇报</b><small>Excel / PDF / Word 原生导出</small></div></div>
        </div>
        <div class="lb-foot">商场装修开业 · 承接查验与整改闭环</div>
      </div>
      <div class="login-panel">
        <div class="lp-eyebrow">欢迎回来</div>
        <h3>登录系统</h3>
        <div class="lp-sub">请输入您的账号信息以继续</div>
        <label>用户名</label>
        <div class="field">${ICONS.user}<input id="u" placeholder="请输入用户名" autocomplete="username"></div>
        <label>密码</label>
        <div class="field">${ICONS.key}<input id="p" type="password" placeholder="请输入密码" autocomplete="current-password"><button type="button" class="pw-eye" id="pwEye" title="显示/隐藏密码">${ICONS.eye}</button></div>
        <button class="btn lp-btn" id="loginBtn">${ICONS.arrowRight}<span>登 录</span></button>
        <div class="lp-hint">${ICONS.shieldCheck} 登录即表示您同意本平台的使用规范与数据安全要求</div>
      </div>
    </div>
  </div>`;
  const doLogin = (u, p) => {
    if (!u || !p) return toast('请填写用户名与密码', 'err');
    const b = $('#loginBtn'); b.classList.add('loading'); b.disabled = true;
    login(u, p).catch(e => { toast(e.message, 'err'); b.classList.remove('loading'); b.disabled = false; });
  };
  $('#loginBtn').onclick = () => doLogin($('#u').value.trim(), $('#p').value);
  $('#p').onkeydown = (e) => { if (e.key === 'Enter') doLogin($('#u').value.trim(), $('#p').value); };
  $('#pwEye').onclick = () => { const p = $('#p'); p.type = p.type === 'password' ? 'text' : 'password'; $('#pwEye').classList.toggle('on'); };
}

// ---------- dashboard ----------
// KPI 卡片点击 → 下钻到问题中心（按对应条件过滤）
const KPI_FILTERS = {
  total: {},
  open: { statusOpen: true },
  closed: { status: 'CLOSED' },
  overdue: { overdue: true },
  closureRate: { status: 'CLOSED' },
  majorIssueRate: { severityIn: 'S1,S2' },
  firstPassRate: { status: 'CLOSED' },
  onTimeRate: { status: 'CLOSED' },
};
function drillToIssues(preset) { S._preset = preset || {}; go('issues'); }

async function viewDashboard(c) {
  const proj = (S.projects || []).find(p => p.id === S.projectId);
  const today = new Date();
  const wd = ['日', '一', '二', '三', '四', '五', '六'][today.getDay()];
  c.innerHTML = `<div class="page-head">
    <div class="ph-main"><h2>仪表盘</h2><div class="ph-sub">${ICONS.building}<span>${esc(proj ? proj.name : '全部项目')} · 承接查验实时概况</span></div></div>
    <div class="spacer"></div>
    <span class="ph-date">${today.getMonth() + 1}月${today.getDate()}日 周${wd}</span>
    <button class="btn ghost sm" id="mgSb">${ICONS.statboards} 管理统计表</button>
  </div><div id="dashWrap"><div class="empty">加载中…</div></div>`;
  $('#mgSb', c).onclick = () => go('statboards');
  const r = await api('GET', `/api/projects/${S.projectId}/statboards`).catch(() => ({ statBoards: [] }));
  const boards = r.statBoards || [];
  // 显示在仪表盘上的表（勾选“生成到仪表盘”）；若都没有勾选，回退到默认表，确保首页不空
  let dash = boards.filter(b => b.onDashboard);
  if (!dash.length) { const def = boards.find(b => b.isDefault) || (boards[0] || null); if (def) dash = [def]; }
  const wrap = $('#dashWrap', c);
  if (!dash.length) {
    // 兜底：没有任何统计表时按原固定指标展示
    const d = await api('GET', `/api/projects/${S.projectId}/dashboard`).catch(() => null);
    if (!d) { wrap.innerHTML = `<div class="empty">暂无数据，请先创建项目与问题。</div>`; return; }
    const sc = d.scorecard;
    wrap.innerHTML = `<div class="kpis">
      ${kpi('total', sc.total, '问题总数')}${kpi('open', sc.open, '未关闭')}${kpi('closed', sc.closed, '已关闭')}
      ${kpi('overdue', sc.overdue, '已超期', sc.overdue > 0)}${kpi('closureRate', pct(sc.closureRate), '闭环率')}
      ${kpi('majorIssueRate', pct(sc.majorIssueRate), '重大/高风险率')}${kpi('firstPassRate', pct(sc.firstPassRate), '一次通过率')}${kpi('onTimeRate', pct(sc.onTimeRate), '按时整改率')}
    </div><div class="muted" style="font-size:12px;margin:-4px 2px 10px">提示：点击上方任一指标卡，可下钻到对应的问题清单。可在「统计表」中勾选“生成到仪表盘”自定义首页。</div>`;
    $$('#dashWrap .kpi').forEach(el => el.onclick = () => drillToIssues(KPI_FILTERS[el.dataset.kpi] || {}));
    return;
  }
  wrap.innerHTML = '';
  for (const board of dash) {
    const sec = document.createElement('div');
    sec.className = 'dash-sec';
    sec.innerHTML = `<div class="dash-sec-head"><h3>${esc(board.name)}</h3>${dash.length > 1 ? '<span class="tag sm">已置顶首页</span>' : ''}<a class="link" data-edit="${board.id}">编辑</a></div><div class="dash-sec-body"></div>`;
    wrap.appendChild(sec);
    await loadStatBoardBody($('.dash-sec-body', sec), board);
    const ed = $('[data-edit]', sec); if (ed) ed.onclick = () => openBoardModal(boards.find(b => b.id === ed.dataset.edit));
  }
}
const KPI_ACCENT = { total:'#2563eb', open:'#ca8a04', closed:'#16a34a', overdue:'#dc2626', closureRate:'#16a34a', majorIssueRate:'#dc2626', firstPassRate:'#2563eb', onTimeRate:'#0891b2' };
const KPI_ICONS = { total:'layers', open:'clock', closed:'checkCircle', overdue:'alertTriangle', closureRate:'trending', majorIssueRate:'shieldCheck', firstPassRate:'zap', onTimeRate:'trending' };
function kpi(key, n, l, alert) { const a = (alert ? '#dc2626' : (KPI_ACCENT[key] || '#2563eb')); return `<div class="kpi clickable ${alert ? 'alert' : ''}" data-kpi="${key}" style="--accent:${a}"><div class="kpi-top"><span class="kpi-ic">${ICONS[KPI_ICONS[key]] || ICONS.layers}</span><span class="kpi-l">${esc(l)}</span></div><div class="n">${esc(n)}</div></div>`; }
function kpiStatic(key, n, l, accent, alert) { const a = alert ? '#dc2626' : (accent || KPI_ACCENT[key] || '#2563eb'); return `<div class="kpi ${alert ? 'alert' : ''}" style="--accent:${a}"><div class="kpi-top"><span class="kpi-ic">${ICONS[KPI_ICONS[key]] || ICONS.layers}</span><span class="kpi-l">${esc(l)}</span></div><div class="n">${esc(n)}</div></div>`; }
function pct(x) { return (x * 100).toFixed(0) + '%'; }

// ---------- projects ----------
async function viewProjects(c) {
  c.innerHTML = `
  <div class="page-head"><h2>项目管理</h2><div class="spacer"></div><button class="btn ghost" id="projQr">项目二维码</button><button class="btn" id="addProj">+ 新建项目</button></div>
  <div id="projList"></div>`;
  const render = async () => {
    const p = await api('GET', '/api/projects'); S.projects = p.projects;
    $('#projList').innerHTML = p.projects.length ? `<div class="grid3">${p.projects.map(pr => `
      <div class="card pad hoverable">
        <div class="row" style="align-items:center;gap:8px;margin-bottom:8px">
          <div style="font-weight:800;font-size:15px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(pr.name)}</div>
          <span class="st ${/进行中|启用|开业/.test(pr.status||'')?'closed':''}" style="font-size:10px;padding:2px 8px;white-space:nowrap">${esc(pr.status || '未开始')}</span>
        </div>
        <div class="muted" style="font-size:12px;margin:2px 0">编号：${esc(pr.code || '-')}</div>
        <div class="muted" style="font-size:12px">${esc(pr.address || '未填')}</div>
        <div class="row" style="margin-top:14px">
          <button class="btn sec sm" data-open="${pr.id}">进入</button>
          <button class="btn ghost sm" data-edit="${pr.id}">编辑</button>
          ${['超级管理员', '项目经理'].includes(S.user && S.user.role) ? `<button class="btn ghost sm" data-del="${pr.id}" style="color:var(--red);border-color:var(--red-bg)">删除</button>` : ''}
        </div>
      </div>`).join('')}</div>` : `<div class="empty">暂无项目，点击右上角「+ 新建项目」开始</div>`;
    $$('#projList [data-open]').forEach(b => b.onclick = () => { S.projectId = b.dataset.open; const sel = $('#projSel'); if (sel) sel.value = S.projectId; loadProjectData().then(() => go('dashboard')); });
    $$('#projList [data-edit]').forEach(b => b.onclick = () => openProjModal(b.dataset.edit));
    $$('#projList [data-del]').forEach(b => b.onclick = () => confirmDlg('确定删除该项目？其下所有问题、楼层/区域/位置、批次、统计表与报告将一并删除，且不可恢复！', async () => {
      await api('DELETE', `/api/projects/${b.dataset.del}`);
      toast('项目已删除');
      if (S.projectId === b.dataset.del) { S.projectId = null; boot(); } else render();
    }, '删除'));
  };
  $('#addProj').onclick = () => openProjModal(null, render);
  $('#projQr').onclick = () => { const m = modal(`<header><h3>项目二维码</h3><div class="spacer"></div><button class="btn ghost sm" id="x">关闭</button></header><div class="body"><div id="pqr"></div><div class="note">用手机扫码可直达本项目并快速录入问题（手机与电脑需在同一 Wi-Fi/局域网）。</div></div>`); $('#x', m).onclick = () => m.remove(); renderQR($('#pqr', m), S.baseUrl + '/?project=' + S.projectId + '&entry=1'); };
  render();
}
function openProjModal(id, after) {
  const pr = id ? S.projects.find(p => p.id === id) : null;
  const m = modal(`<header><h3>${pr ? '编辑项目' : '新建项目'}</h3><div class="spacer"></div><button class="btn ghost sm" id="x">关闭</button></header>
    <div class="body">
      <label>项目名称</label><input id="name" value="${esc(pr ? pr.name : '')}">
      <label>项目编号</label><input id="code" value="${esc(pr ? pr.code : '')}">
      <label>地址</label><input id="addr" value="${esc(pr ? pr.address : '')}">
      <label>项目经理</label><input id="mgr" value="${esc(pr ? pr.manager : '')}">
    </div>
    <footer><button class="btn" id="save">保存</button></footer>`);
  $('#x', m).onclick = () => m.remove();
  $('#save', m).onclick = async () => {
    const body = { name: $('#name', m).value.trim(), code: $('#code', m).value.trim(), address: $('#addr', m).value.trim(), manager: $('#mgr', m).value.trim() };
    try {
      if (pr) await api('PATCH', `/api/projects/${pr.id}`, body); else await api('POST', '/api/projects', body);
      m.remove(); toast('已保存'); if (after) after(); else boot();
    } catch (e) { toast(e.message); }
  };
}

// ---------- issues ----------
async function viewIssues(c) {
  const canDelete = !!(S.user.permissions && S.user.permissions.includes('issue_delete'));
  c.innerHTML = `
  <div class="page-head"><h2>问题中心</h2><div class="spacer"></div>
    <button class="btn" id="add">+ 快速新增问题</button>
  </div>
  <div class="card pad rpt-toolbar">
    <div class="row" style="align-items:center;gap:10px;flex-wrap:wrap">
      <span class="rpt-label">导出</span>
      <span class="muted" style="font-size:12px">Excel=下方问题明细（含当前筛选）&nbsp;·&nbsp;PDF/Word=汇报用总报告（概况/严重度分级/责任排名/总结）</span>
      <div class="spacer"></div>
      <button class="btn sec" id="exp_xls" title="导出当前筛选条件下的问题明细 Excel">导出 Excel</button>
      <button class="btn ghost" id="exp_pdf" title="生成汇报用总报告 PDF（含检查概况、严重度分级配色、责任单位排名与总结）">导出 PDF</button>
      <button class="btn ghost" id="exp_doc" title="生成汇报用总报告 Word">导出 Word</button>
    </div>
  </div>
  <div class="filters card pad">
    <div class="f search-input"><label>关键词</label><input id="f_kw" placeholder="编号/标题/责任单位"></div>
    <div class="f"><label>专业</label><select id="f_dis"><option value="">全部</option>${S.disciplines.map(d => `<option>${esc(d.name)}</option>`).join('')}</select></div>
    <div class="f"><label>楼层</label><select id="f_fl"><option value="">全部</option>${S.floors.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select></div>
    <div class="f"><label>区域</label><select id="f_zn"><option value="">全部</option>${S.zones.map(z => `<option value="${z.id}">${esc(z.name)}</option>`).join('')}</select></div>
    <div class="f"><label>检查批次</label><select id="f_bt"><option value="">全部</option>${S.batches.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>
    <div class="f"><label>严重度</label><select id="f_sev"><option value="">全部</option>${S.C.SEVERITY_ORDER.map(s => `<option value="${s}">${s} ${esc(S.C.SEVERITY_LABEL[s])}</option>`).join('')}</select></div>
    <div class="f"><label>状态</label><select id="f_st"><option value="">全部</option>${Object.entries(S.C.ISSUE_STATUS_LABEL).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
    <div class="f" style="flex:0"><label>仅超期</label><div><input type="checkbox" id="f_od" style="width:auto;margin-top:10px"></div></div>
    <div class="f" style="flex:0"><button class="btn sec" id="reset" style="margin-top:24px">重置</button></div>
    ${canDelete ? `<div class="f" style="flex:0"><button class="btn danger" id="bdel" style="margin-top:24px">批量删除</button></div>` : ''}
  </div>
  <div class="tbl-wrap"><table><thead><tr>
    <th style="width:34px"><input type="checkbox" id="selAll" title="全选/取消"></th>
    <th style="width:46px">#</th><th>编号</th><th>标题</th><th>专业</th><th>楼层/区域/位置</th><th>检查批次</th><th>严重度</th><th>责任单位</th><th>报修时间</th><th>完工时间</th><th>截止</th><th>状态</th>
    <th style="width:84px">操作</th>
  </tr></thead><tbody id="tbody"></tbody></table></div>
  <div id="pager" class="pager"></div>`;
  $('#add').onclick = () => openIssueModal();
  // 导出工具条：Excel=问题明细（含当前筛选）；PDF/Word=汇报用总报告（检查概况/严重度分级配色/责任排名/总结）
  async function downloadBlob(url, filename, mimeHint) {
    try {
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + (S.token || '') }, credentials: 'include' });
      if (!r.ok) {
        let err = '下载失败（HTTP ' + r.status + '）';
        try { const j = await r.json(); if (j && j.error) err = j.error; } catch (e) {}
        throw new Error(err);
      }
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
      toast('已下载：' + filename);
    } catch (e) { toast(e.message); }
  }
  $('#exp_xls').onclick = async () => {
    const b = $('#exp_xls'); b.classList.add('loading'); b.disabled = true;
    try { await downloadBlob(`/api/projects/${S.projectId}/issues/export?format=xls&` + issueQueryStr(), '问题明细.xls'); }
    finally { b.classList.remove('loading'); b.disabled = false; }
  };
  // 总报告 PDF：生成 summary 报告 → 渲染 HTML 快照为 PDF（含检查概况/严重度分级配色/责任排名/总结）
  $('#exp_pdf').onclick = async () => {
    const b = $('#exp_pdf'); b.classList.add('loading'); b.disabled = true;
    try {
      toast('正在生成汇报总报告 PDF…');
      const r = await api('POST', '/api/reports/generate', { projectId: S.projectId, type: 'summary' });
      await exportReportPDF(r.report.id);
    } catch (e) { toast('PDF 生成失败：' + e.message); }
    b.classList.remove('loading'); b.disabled = false;
  };
  // 总报告 Word：生成 summary 报告 → 下载 .doc（HTML 兼容格式）
  $('#exp_doc').onclick = async () => {
    const b = $('#exp_doc'); b.classList.add('loading'); b.disabled = true;
    try {
      const r = await api('POST', '/api/reports/generate', { projectId: S.projectId, type: 'summary' });
      await downloadBlob(`/api/reports/${r.report.id}/export-doc`, '汇报总报告.doc');
    } catch (e) { toast(e.message); }
    b.classList.remove('loading'); b.disabled = false;
  };
  let _pg = 1, _ps = 10, _total = 0;
  const renderPager = () => {
    const totalPages = Math.max(1, Math.ceil(_total / _ps));
    const pages = [];
    for (let p = 1; p <= totalPages; p++) pages.push(p);
    const pp = pages.slice(0, 7); // 简易：前 7 页
    $('#pager').innerHTML = `
      <span class="muted" style="font-size:12px">共 ${_total} 条</span>
      <select id="pg_ps" class="pg-ps">
        ${[10,20,30,50,100].map(n => `<option value="${n}" ${n===_ps?'selected':''}>${n} 条/页</option>`).join('')}
      </select>
      <button class="btn ghost sm pg-btn" data-pg="${Math.max(1, _pg - 1)}" ${_pg <= 1 ? 'disabled' : ''}>上一页</button>
      ${pp.map(p => `<button class="btn ${p===_pg?'':'ghost'} sm pg-btn" data-pg="${p}">${p}</button>`).join('')}
      ${totalPages > 7 ? `<span class="muted">…</span>` : ''}
      <button class="btn ghost sm pg-btn" data-pg="${Math.min(totalPages, _pg + 1)}" ${_pg >= totalPages ? 'disabled' : ''}>下一页</button>
      <span class="muted" style="font-size:12px">第 ${_pg} / ${totalPages} 页</span>
    `;
    $$('#pager [data-pg]').forEach(b => b.onclick = () => { _pg = parseInt(b.dataset.pg); fetchList(); });
    $('#pg_ps').onchange = (e) => { _ps = parseInt(e.target.value) || 10; _pg = 1; fetchList(); };
  };
  const fetchList = async () => {
    const q = new URLSearchParams({ projectId: S.projectId, page: _pg, pageSize: _ps });
    const kw = $('#f_kw').value.trim(); if (kw) q.set('keyword', kw);
    const dis = $('#f_dis').value; if (dis) q.set('discipline', dis);
    const fl = $('#f_fl').value; if (fl) q.set('floorId', fl);
    const zn = $('#f_zn').value; if (zn) q.set('zoneId', zn);
    const bt = $('#f_bt').value; if (bt) q.set('batchId', bt);
    const sev = $('#f_sev').value; if (sev) q.set('severity', sev);
    const st = $('#f_st').value; if (st) q.set('status', st);
    if ($('#f_od').checked) q.set('overdue', '1');
    // 来自仪表盘/统计表下钻的额外过滤（无对应下拉项时）
    const extra = S._presetExtra || {};
    Object.entries(extra).forEach(([k, v]) => { if (v) q.set(k, v); });
    const r = await api('GET', `/api/issues?` + q.toString());
    _total = r.total || (r.issues && r.issues.length) || 0;
    const tb = $('#tbody');
    if (!r.issues.length) { tb.innerHTML = `<tr><td colspan="12" class="center muted" style="padding:30px">暂无问题</td></tr>`; renderPager(); return; }
    tb.innerHTML = r.issues.map((i, idx) => {
      const od = i.rectificationDeadline && ['CLOSED', 'CANCELLED', 'DUPLICATE'].indexOf(i.rectificationStatus) < 0 && new Date(i.rectificationDeadline) < new Date();
      const stCls = i.rectificationStatus === 'CLOSED' ? 'closed' : od ? 'overdue' : (i.rectificationStatus === 'OPEN' ? 'open' : '');
      const sn = (_pg - 1) * _ps + idx + 1;
      return `<tr data-id="${i.id}" style="cursor:pointer">
        <td style="text-align:center"><input type="checkbox" class="rowchk" value="${i.id}"></td>
        <td class="muted" style="text-align:center">${sn}</td>
        <td>${esc(i.issueNo)}</td><td>${esc(i.title)}</td>
        <td><span class="tag">${esc(i.disciplineName || '-')}</span></td>
        <td>${[i.floorName, i.zoneName, i.positionName].filter(Boolean).map(esc).join('/') || '-'}</td>
        <td>${esc(i.batchName || '-')}</td>
        <td><span class="badge b-${esc(i.severity)}">${esc(i.severity)}</span></td>
        <td>${esc(i.responsibleOrgName || '-')}</td>
        <td title="${esc(i.reportedTime || '')}" style="white-space:nowrap">${fmtDT(i.reportedTime)}</td>
        <td title="${esc(i.completedTime || '')}" style="white-space:nowrap">${fmtDT(i.completedTime)}</td>
        <td class="${od ? 'st overdue' : ''}">${fmt(i.rectificationDeadline)}</td>
        <td><span class="st ${stCls}">${esc(S.C.ISSUE_STATUS_LABEL[i.rectificationStatus] || i.rectificationStatus)}</span></td>
        <td>${canDelete ? `<button class="btn xs danger-ghost" data-del="${i.id}" title="删除该问题">删除</button>` : ''}</td>
      </tr>`;
    }).join('');
    $$('#tbody tr').forEach(tr => tr.onclick = () => viewIssueDetail($('#content'), tr.dataset.id));
    // 行选择框：阻止冒泡，避免触发详情
    $$('#tbody .rowchk').forEach(cb => cb.onclick = (e) => e.stopPropagation());
    // 单行删除
    if (canDelete) $$('#tbody [data-del]').forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      const id = b.dataset.del;
      confirmDlg('确定删除该问题？此操作不可恢复。', async () => {
        try { await api('DELETE', `/api/issues/${id}`); toast('已删除'); fetchList(); }
        catch (er) { toast(er.message, 'err'); }
      }, '删除');
    });
    // 全选/取消
    const selAll = $('#selAll');
    if (selAll) selAll.onchange = () => { $$('#tbody .rowchk').forEach(cb => cb.checked = selAll.checked); };
    renderPager();
  };
  ['#f_kw', '#f_dis', '#f_fl', '#f_zn', '#f_bt', '#f_sev', '#f_st', '#f_od'].forEach(s => $(s).addEventListener('change', () => { _pg = 1; fetchList(); }));
  $('#f_kw').addEventListener('input', debounce(() => { _pg = 1; fetchList(); }, 350));
  $('#reset').onclick = () => { $('#f_kw').value = ''; ['#f_dis', '#f_fl', '#f_zn', '#f_bt', '#f_sev', '#f_st'].forEach(s => s && ($(s).value = '')); $('#f_od').checked = false; S._presetExtra = {}; _pg = 1; fetchList(); };
  // 批量删除
  const bdel = $('#bdel');
  if (bdel) bdel.onclick = () => {
    const ids = $$('#tbody .rowchk').filter(cb => cb.checked).map(cb => cb.value);
    if (!ids.length) return toast('请先勾选要删除的问题', 'err');
    confirmDlg(`确定批量删除选中的 ${ids.length} 条问题？此操作不可恢复。`, async () => {
      try { const r = await api('POST', '/api/issues/batch-delete', { ids }); toast(`已删除 ${r.removed} 条`); if ($('#selAll')) $('#selAll').checked = false; fetchList(); }
      catch (er) { toast(er.message, 'err'); }
    }, '批量删除');
  };
  // 应用来自仪表盘/统计表的下钻预设
  if (S._preset) {
    const p = S._preset; S._preset = null; S._presetExtra = {};
    if (p.keyword) $('#f_kw').value = p.keyword;
    if (p.discipline) $('#f_dis').value = p.discipline;
    if (p.floorId) $('#f_fl').value = p.floorId;
    if (p.severity) $('#f_sev').value = p.severity;
    if (p.status) $('#f_st').value = p.status;
    if (p.overdue) $('#f_od').checked = true;
    if (p.statusOpen) S._presetExtra.statusOpen = '1';
    if (p.severityIn) S._presetExtra.severityIn = p.severityIn;
  }
  fetchList();
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// 整改中心 / 复查中心：按状态过滤的问题列表
async function viewIssueList(kind, c) {
  c = c || $('#content');
  const map = { rectifications: { title: '整改中心', st: '', hint: '已指派 / 整改中 / 已提交待复查' }, reinspections: { title: '复查中心', st: 'SUBMITTED', hint: '已提交待复查' } };
  const cfg = map[kind] || map.rectifications;
  c.innerHTML = `<div class="page-head"><h2>${cfg.title}</h2><span class="tag">${cfg.hint}</span></div><div class="tbl-wrap"><table><thead><tr><th>编号</th><th>标题</th><th>专业</th><th>检查批次</th><th>责任单位</th><th>报修时间</th><th>完工时间</th><th>截止</th><th>状态</th><th></th></tr></thead><tbody id="tb2"></tbody></table></div>`;
  const q = new URLSearchParams({ projectId: S.projectId, status: cfg.st || 'ASSIGNED,RECTIFYING,SUBMITTED' });
  const r = await api('GET', `/api/issues?` + q.toString()).catch(() => ({ issues: [] }));
  const tb = $('#tb2', c);
  const list = cfg.st ? r.issues.filter(i => i.rectificationStatus === 'SUBMITTED') : r.issues.filter(i => ['ASSIGNED', 'RECTIFYING', 'SUBMITTED'].includes(i.rectificationStatus));
  if (!list.length) { tb.innerHTML = `<tr><td colspan="10" class="center muted" style="padding:30px">暂无待处理项</td></tr>`; return; }
  tb.innerHTML = list.map(i => `<tr data-id="${i.id}" style="cursor:pointer">
    <td>${esc(i.issueNo)}</td><td>${esc(i.title)}</td><td><span class="tag">${esc(i.disciplineName || '-')}</span></td>
    <td>${esc(i.batchName || '-')}</td>
    <td>${esc(i.responsibleOrgName || '-')}</td>
    <td title="${esc(i.reportedTime || '')}" style="white-space:nowrap">${fmtDT(i.reportedTime)}</td>
    <td title="${esc(i.completedTime || '')}" style="white-space:nowrap">${fmtDT(i.completedTime)}</td>
    <td>${fmt(i.rectificationDeadline)}</td>
    <td><span class="st">${esc(S.C.ISSUE_STATUS_LABEL[i.rectificationStatus])}</span></td>
    <td><button class="btn sec sm" data-go="${i.id}">处理</button></td></tr>`).join('');
  $$('#tb2 tr').forEach(tr => { const go = () => viewIssueDetail($('#content'), tr.dataset.id); tr.onclick = go; const b = tr.querySelector('[data-go]'); if (b) b.onclick = (e) => { e.stopPropagation(); go(); }; });
}

// ---------- issue detail ----------
async function viewIssueDetail(c, id) {
  c.innerHTML = `<div class="empty noicon"><span class="spinner"></span>加载中…</div>`;
  const r = await api('GET', `/api/issues/${id}`);
  const i = r.issue; const rects = r.rectifications; const reins = r.reinspections; const hist = r.history;
  const st = i.rectificationStatus;
  const stCls = st === 'CLOSED' ? 'closed' : 'open';
  c.innerHTML = `
  <div class="page-head"><button class="btn ghost sm" id="back">返回</button><h2>${esc(i.issueNo)}</h2>
    <span class="st ${stCls}">${esc(S.C.ISSUE_STATUS_LABEL[st] || st)}</span>
    <span class="badge b-${esc(i.severity)}">${esc(i.severity)} ${esc(S.C.SEVERITY_LABEL[i.severity])}</span>
    <div class="spacer"></div>
    <button class="btn ghost sm" id="edit">编辑</button>
  </div>
  <div class="grid2">
    <div class="card pad">
      <h3 style="margin-bottom:8px">问题信息</h3>
      <div style="font-weight:700;font-size:16px;margin-bottom:6px">${esc(i.title)}</div>
      <p class="muted">${esc(i.description || '无描述')}</p>
      <div class="row" style="margin-top:8px">
        <div class="col"><div class="muted" style="font-size:12px">专业</div><b>${esc(i.disciplineName || '-')}</b></div>
        <div class="col"><div class="muted" style="font-size:12px">楼层/区域</div><b>${esc(i.floorName || '-')}/${esc(i.zoneName || '-')}</b></div>
        <div class="col"><div class="muted" style="font-size:12px">位置</div><b>${esc(i.positionName || '-')}</b></div>
        <div class="col"><div class="muted" style="font-size:12px">优先级</div><b>${esc(S.C.PRIORITY_LABEL[i.priority] || i.priority)}</b></div>
        <div class="col"><div class="muted" style="font-size:12px">严重程度</div><b>${esc(i.severity || '-')} ${esc(S.C.SEVERITY_LABEL[i.severity] || '')}</b></div>
      </div>
      <div class="row" style="margin-top:8px">
        <div class="col"><div class="muted" style="font-size:12px">责任单位</div><b>${esc(i.responsibleOrgName || '未指派')}</b></div>
        <div class="col"><div class="muted" style="font-size:12px">责任人</div><b>${esc(i.responsibleUserName || '-')}</b></div>
        <div class="col"><div class="muted" style="font-size:12px">计划完成</div><b>${fmt(i.rectificationDeadline)}</b></div>
        <div class="col"><div class="muted" style="font-size:12px">检查批次</div><b>${esc(i.batchName || '-')}</b></div>
      </div>
      <div class="row" style="margin-top:8px">
        <div class="col"><div class="muted" style="font-size:12px">报修时间</div><b>${esc(fmtFull(i.reportedTime))}</b></div>
        <div class="col"><div class="muted" style="font-size:12px">完工时间</div><b>${i.completedTime ? esc(fmtFull(i.completedTime)) : '<span class="muted" style="font-weight:400">未完工</span>'}</b></div>
        <div class="col"><div class="muted" style="font-size:12px">发现时间</div><b>${esc(fmtFull(i.foundAt))}</b></div>
        <div class="col"><div class="muted" style="font-size:12px">创建时间</div><b>${esc(fmtFull(i.createdAt))}</b></div>
      </div>
      ${i.suggestedAction ? `<div style="margin-top:8px"><div class="muted" style="font-size:12px">建议措施</div>${esc(i.suggestedAction)}</div>` : ''}
      ${i.standardReference ? `<div style="margin-top:6px"><div class="muted" style="font-size:12px">标准依据</div>${esc(i.standardReference)}</div>` : ''}
      <div style="margin-top:10px"><div class="muted" style="font-size:12px">发现照片</div>${photosBlock(i.photoIds)}</div>
      <div style="margin-top:10px"><div class="muted" style="font-size:12px">问题二维码（扫码在手机直达）</div><div id="qrSlot"></div></div>
      <div style="margin-top:10px"><div class="muted" style="font-size:12px">平面图定位</div><div id="detailPlanSlot"></div></div>
    </div>
    <div class="card pad">
      <h3 style="margin-bottom:8px">操作</h3>
      <div id="actions" class="row"></div>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0">
      <h3 style="margin-bottom:8px">生命周期</h3>
      <div class="timeline">${timeline(hist, rects, reins)}</div>
    </div>
  </div>`;
  renderQR($('#qrSlot'), S.baseUrl + '/?issue=' + i.id + '&share=' + (i.shareToken || ''));
  renderDetailPlan($('#detailPlanSlot'), i);
  $('#back').onclick = () => go(S.view === 'issues' ? 'issues' : (S.view || 'issues'));
  $('#edit').onclick = () => openIssueModal(i, () => viewIssueDetail(c, id));
  bindActions($('#actions'), i, () => viewIssueDetail(c, id));
}
// 全局图片/PDF 灯箱（点击缩略图不新开页）
function openLightbox(url) {
  let lb = document.getElementById('wbLightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'wbLightbox';
    lb.className = 'lightbox';
    lb.innerHTML = `<button class="lb-close" title="关闭（Esc）" aria-label="关闭"></button><div class="lb-body"></div><div class="lb-cap"></div>`;
    document.body.appendChild(lb);
    lb.addEventListener('click', (e) => { if (e.target === lb) closeLightbox(); });
    lb.querySelector('.lb-close').addEventListener('click', closeLightbox);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });
  }
  const isPdf = /\.pdf(\?|$)/i.test(url);
  const body = lb.querySelector('.lb-body');
  body.innerHTML = isPdf
    ? `<iframe src="${esc(url)}" class="lb-frame" title="预览"></iframe>`
    : `<img class="lb-img" src="${esc(url)}" alt="">`;
  lb.querySelector('.lb-cap').textContent = isPdf ? 'PDF 文档（Esc 关闭）' : '点击空白处或按 Esc 关闭';
  lb.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeLightbox() {
  const lb = document.getElementById('wbLightbox');
  if (lb) { lb.classList.remove('open'); document.body.style.overflow = ''; const b = lb.querySelector('.lb-body'); if (b) b.innerHTML = ''; }
}
// 全局委托：所有带 data-lb 的缩略图均可在灯箱中放大
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-lb]');
  if (t) { e.preventDefault(); openLightbox(t.dataset.lb); }
});
function photosBlock(arr) {
  if (!arr || !arr.length) return `<div class="muted" style="font-size:12px">无照片</div>`;
  return `<div class="photos">${arr.map(u => {
    const isPdf = /\.pdf(\?|$)/i.test(u);
    const inner = isPdf
      ? `<div class="ph-pdf"><span class="ph-pdf-ic"></span><span>PDF</span></div>`
      : `<img src="${esc(u)}" alt="">`;
    return `<div class="ph"><div class="ph-thumb" data-lb="${esc(u)}" role="button" title="${isPdf ? '点击查看 PDF' : '点击放大'}">${inner}</div></div>`;
  }).join('')}</div>`;
}
function timeline(hist, rects, reins) {
  let html = hist.map(h => `<div class="tl-item"><div class="t">${fmt(h.at)} · ${esc(h.actorName)}</div><div class="x">${esc(actionLabel(h.action))}</div>${h.note ? `<div class="muted" style="font-size:12px">${esc(h.note)}</div>` : ''}</div>`).join('');
  rects.forEach(r => { html += `<div class="tl-item"><div class="t">${fmt(r.at)} · 整改</div><div class="x">${esc(r.description || '提交整改')}</div>${photosBlock(r.afterPhotos)}</div>`; });
  reins.forEach(r => { const rlabel = (S.C && S.C.REINSPECTION_RESULT_LABEL) ? (S.C.REINSPECTION_RESULT_LABEL[r.result] || r.result) : r.result; html += `<div class="tl-item"><div class="t">${fmt(r.at)} · 复查(${esc(rlabel)})</div><div class="x">${esc(r.note || '')}</div>${photosBlock(r.photos)}</div>`; });
  return html || `<div class="muted">暂无记录</div>`;
}
function actionLabel(a) { const m = { CREATE: '创建问题', ASSIGN: '指派责任单位', REASSIGN: '重新指派', START_RECTIFICATION: '开始整改', SUBMIT: '提交整改', REINSPECT: '进入复查', PASS: '复查通过→关闭', FAIL: '复查驳回→退回整改', HOLD: '挂起', CANCEL: '取消', REOPEN: '重新打开', REJECT: '驳回' }; return m[a] || a; }

function bindActions(box, i, refresh) {
  const st = i.rectificationStatus;
  const btn = (label, cls, fn) => { const b = document.createElement('button'); b.className = 'btn ' + (cls || ''); b.textContent = label; b.onclick = fn; box.appendChild(b); };
  if (st === 'OPEN' || st === 'PENDING' || st === 'REJECTED') btn('指派责任单位', '', () => openAssignModal(i, refresh));
  if (st === 'ASSIGNED') { btn('提交整改', '', () => openRectifyModal(i, refresh)); btn('重新指派', 'ghost', () => openAssignModal(i, refresh)); }
  if (st === 'RECTIFYING') btn('提交整改', '', () => openRectifyModal(i, refresh));
  if (st === 'SUBMITTED') btn('复查（通过/驳回）', '', () => openReinspectModal(i, refresh));
  if (st === 'CLOSED') btn('重新打开', 'ghost', () => doTransition(i, 'REOPEN', refresh));
  btn('挂起', 'ghost', () => doTransition(i, 'HOLD', refresh));
  if (['OPEN', 'ASSIGNED', 'PENDING'].includes(st)) btn('取消', 'ghost', () => doTransition(i, 'CANCEL', refresh));
}
async function doTransition(i, action, refresh) {
  try { await api('POST', `/api/issues/${i.id}/transition`, { action }); toast('已更新'); refresh(); } catch (e) { toast(e.message); }
}
function openAssignModal(i, refresh) {
  const m = modal(`<header><h3>指派责任单位</h3><div class="spacer"></div><button class="btn ghost sm" id="x">关闭</button></header>
    <div class="body">
      <label>责任单位</label><select id="org">${S.orgs.map(o => `<option value="${o.id}" ${i.responsibleOrgId === o.id ? 'selected' : ''}>${esc(o.name)}（${esc(o.type)}）</option>`).join('')}</select>
      <label>责任人</label><input id="ru" value="${esc(i.responsibleUserName || '')}" placeholder="姓名">
      <label>计划完成日期</label><input id="dl" type="date" value="${esc((i.rectificationDeadline || '').slice(0, 10))}">
    </div><footer><button class="btn" id="ok">指派</button></footer>`);
  $('#x', m).onclick = () => m.remove();
  $('#ok', m).onclick = async () => {
    try { await api('POST', `/api/issues/${i.id}/assign`, { responsibleOrgId: $('#org', m).value, responsibleUserName: $('#ru', m).value, rectificationDeadline: $('#dl', m).value }); m.remove(); toast('已指派'); refresh(); } catch (e) { toast(e.message); }
  };
}
// ---------- 图片上传（实时预览 + 可删除） ----------
let PHOTO_TARGETS = {};
function setupPhotos(targets) { // targets: { label: { arr, container } }
  PHOTO_TARGETS = targets;
  Object.entries(targets).forEach(([label, t]) => renderPhotoBox(t.container, t.arr, label));
}
function renderPhotoBox(container, arr, label) {
  if (!container) return;
  const t = PHOTO_TARGETS[label] || {};
  const max = t.max || 0;
  const filled = (arr || []).length;
  const counter = max ? `<div class="ph-counter">已选 ${filled} / ${max}</div>` : '';
  const showUpload = !max || filled < max;
  container.innerHTML = (arr || []).map((u, idx) => `<div class="ph"><div class="ph-thumb" data-lb="${esc(u)}" role="button" title="点击放大"><img src="${esc(u)}" alt=""></div><button type="button" class="ph-x" data-i="${idx}">×</button></div>`).join('')
    + (showUpload ? `<div class="photo-up" onclick="this.parentElement.querySelector('input').click()">+ 上传<input type="file" accept="image/*" multiple hidden onchange="window.__up(this,'${esc(label)}')"></div>` : '')
    + counter;
  container.querySelectorAll('.ph-x').forEach((b) => (b.onclick = () => {
    const a = PHOTO_TARGETS[label].arr; a.splice(+b.dataset.i, 1); renderPhotoBox(container, a, label);
  }));
}
async function uploadOne(inp, arr) {
  for (const f of inp.files) {
    const dataUrl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(f); });
    if (!dataUrl) continue;
    const r = await api('POST', '/api/uploads', { filename: f.name, data: dataUrl.split(',')[1] });
    arr.push(r.url || r);
  }
}
window.__up = async (inp, label) => {
  const t = PHOTO_TARGETS[label]; if (!t) return;
  const max = t.max || 0;
  const room = max ? Math.max(0, max - t.arr.length) : Infinity;
  if (max && inp.files.length > room) toast(`最多上传 ${max} 张，已自动选取前 ${room} 张`);
  let added = 0;
  for (const f of inp.files) {
    if (room !== Infinity && added >= room) break;
    const dataUrl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(f); });
    if (!dataUrl) continue;
    const r = await api('POST', '/api/uploads', { filename: f.name, data: dataUrl.split(',')[1] });
    t.arr.push(r.url || r);
    added++;
  }
  renderPhotoBox(t.container, t.arr, label);
};
function openRectifyModal(i, refresh) {
  const m = modal(`<header><h3>提交整改</h3><div class="spacer"></div><button class="btn ghost sm" id="x">关闭</button></header>
    <div class="body">
      <label>整改说明</label><textarea id="desc" rows="3" placeholder="整改内容与结果">${esc(i.rectificationDescription || '')}</textarea>
      <label>整改前照片</label><div class="photos" id="phBefore"></div>
      <label>整改后照片</label><div class="photos" id="phAfter"></div>
      <div class="row">
        <div class="col"><label>完工时间</label><input id="ct" type="datetime-local" value="${esc(toLocalDT(new Date().toISOString()))}" title="本次整改实际完工时间"></div>
        <div class="col"><label>自检结果</label><input id="sc" value="自检合格" placeholder="自检结论"></div>
      </div>
    </div><footer><button class="btn" id="ok">提交整改</button></footer>`, true);
  const before = [], after = [];
  setupPhotos({ '整改前': { arr: before, container: $('#phBefore', m) }, '整改后': { arr: after, container: $('#phAfter', m) } });
  $('#x', m).onclick = () => m.remove();
  $('#ok', m).onclick = async () => {
    try {
      await api('POST', `/api/issues/${i.id}/rectify`, {
        description: $('#desc', m).value, beforePhotos: before, afterPhotos: after,
        actualDate: $('#ct', m).value ? new Date($('#ct', m).value).toISOString() : undefined,
        completedTime: $('#ct', m).value ? new Date($('#ct', m).value).toISOString() : undefined,
        selfCheck: $('#sc', m).value,
      });
      m.remove(); toast('整改已提交'); refresh();
    } catch (e) { toast(e.message); }
  };
}
function openReinspectModal(i, refresh) {
  const m = modal(`<header><h3>复查</h3><div class="spacer"></div><button class="btn ghost sm" id="x">关闭</button></header>
    <div class="body">
      <label>复查结论</label>
      <div class="seg" style="width:100%"><button data-r="PASS" class="active" style="flex:1">通过→关闭</button><button data-r="FAIL" style="flex:1">驳回→退回</button></div>
      <label>复查意见</label><textarea id="note" rows="3" placeholder="复查结论说明"></textarea>
      <label>复查照片</label><div class="photos" id="phRein"></div>
    </div><footer><button class="btn" id="ok">提交复查</button></footer>`, true);
  let result = 'PASS';
  $$('.seg button', m).forEach(b => b.onclick = () => { $$('.seg button', m).forEach(x => x.classList.remove('active')); b.classList.add('active'); result = b.dataset.r; });
  const photos = [];
  setupPhotos({ '复查照片': { arr: photos, container: $('#phRein', m) } });
  $('#x', m).onclick = () => m.remove();
  $('#ok', m).onclick = async () => {
    try { await api('POST', `/api/issues/${i.id}/reinspect`, { result, note: $('#note', m).value, photos }); m.remove(); toast(result === 'PASS' ? '复查通过，问题关闭' : '已驳回，退回整改'); refresh(); } catch (e) { toast(e.message); }
  };
}

// ---------- quick add issue (30s entry) ----------
function openIssueModal(preset, after) {
  const i = preset || {};
  const m = modal(`<header><h3>${preset ? '编辑问题' : '快速新增问题'}</h3><div class="spacer"></div><button class="btn ghost sm" id="x">关闭</button></header>
    <div class="body">
      <label>标题 *</label><input id="title" value="${esc(i.title || '')}" placeholder="如：3F东区墙砖空鼓">
      <label>描述</label><textarea id="desc" rows="2" placeholder="现场情况描述">${esc(i.description || '')}</textarea>
      <label>检查批次（本次问题由哪批查验发现）</label>
      <select id="bat"><option value="">未选（非批次检查）</option>${S.batches.filter(b => !b.status || b.status === '进行中').map(b => `<option value="${b.id}" ${i.batchId===b.id?'selected':''}>${esc(b.name)}</option>`).join('')}${i.batchId && S.batches.some(b => b.id === i.batchId && b.status && b.status !== '进行中') ? `<option value="${S.batches.find(b => b.id === i.batchId).id}" selected>${esc(S.batches.find(b => b.id === i.batchId).name)}（已${S.batches.find(b => b.id === i.batchId).status}，仅供查阅）</option>` : ''}</select>
      <div class="row">
        <div class="col"><label>专业 *</label><select id="dis">${S.disciplines.filter(d=>d.active!==false).map(d => `<option value="${d.id}" ${i.disciplineId===d.id?'selected':''}>${esc(d.name)}</option>`).join('')}</select></div>
        <div class="col"><label>问题大类</label><input id="cat" value="${esc(i.categoryName || '')}" placeholder="如：墙地面"></div>
      </div>
      <div class="row">
        <div class="col"><label>楼层</label><select id="fl"><option value="">未定位</option>${S.floors.map(f => `<option value="${f.id}" ${i.floorId===f.id?'selected':''}>${esc(f.name)}</option>`).join('')}</select></div>
        <div class="col"><label>区域</label><select id="zn"><option value="">未选</option>${S.zones.map(z => `<option value="${z.id}" ${i.zoneId===z.id?'selected':''}>${esc(z.name)}</option>`).join('')}</select></div>
        <div class="col"><label>位置</label><select id="pos"><option value="">未选</option>${S.positions.filter(p => p.zoneId === i.zoneId).map(p => `<option value="${p.id}" ${i.positionId===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div>
      </div>
      <label>平面图定位（在平面图上点选位置）</label>
      <div id="planSlot"></div>
      <label>定位描述（可选）</label><input id="locdesc" value="${esc(i.locationDesc||'')}" placeholder="如：距A入口约5米右侧墙面">
      <div class="row">
        <div class="col"><label>严重度 *</label><select id="sev">${S.C.SEVERITY_ORDER.map(s => `<option value="${s}" ${i.severity===s?'selected':''}>${s} ${esc(S.C.SEVERITY_LABEL[s])}</option>`).join('')}</select></div>
        <div class="col"><label>优先级</label><select id="pri">${Object.entries(S.C.PRIORITY_LABEL).map(([k,v])=>`<option value="${k}" ${i.priority===k?'selected':''}>${esc(v)}</option>`).join('')}</select></div>
        <div class="col"><label>计划完成</label><input id="dl" type="date" value="${esc((i.rectificationDeadline||'').slice(0,10))}"></div>
      </div>
      <div class="row">
        <div class="col"><label>报修时间</label><input id="rt" type="datetime-local" value="${esc(toLocalDT(i.reportedTime || new Date().toISOString()))}" title="问题上报/报修时间"></div>
        <div class="col"><label>责任单位</label><select id="org"><option value="">未指派</option>${S.orgs.map(o => `<option value="${o.id}" ${i.responsibleOrgId===o.id?'selected':''}>${esc(o.name)}</option>`).join('')}</select></div>
        <div class="col"><label>责任人</label><input id="ru" value="${esc(i.responsibleUserName||'')}"></div>
      </div>
      <label>建议措施</label><input id="act" value="${esc(i.suggestedAction||'')}">
      <label>标准依据</label><input id="std" value="${esc(i.standardReference||'')}" placeholder="如：GB50210-2018">
      <label>发现照片</label><div class="photos" id="phBox"></div>
    </div><footer><button class="btn" id="ok">${preset?'保存':'提交问题'}</button></footer>`, true);
  const photos = (i.photoIds || []).slice();
  S._locX = (i.locationX != null) ? i.locationX : null;
  S._locY = (i.locationY != null) ? i.locationY : null;
  setupPhotos({ '发现照片': { arr: photos, container: $('#phBox', m) } });
  const renderPosOpts = (zoneId, sel) => {
    const selEl = $('#pos', m);
    const opts = S.positions.filter((p) => p.zoneId === zoneId);
    selEl.innerHTML = `<option value="">未选</option>` + opts.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  };
  const renderZoneOpts = (floorId, sel) => {
    const selEl = $('#zn', m);
    const opts = S.zones.filter((z) => z.floorId === floorId);
    selEl.innerHTML = `<option value="">未选</option>` + opts.map((z) => `<option value="${z.id}" ${z.id === sel ? 'selected' : ''}>${esc(z.name)}</option>`).join('');
  };
  renderPlanPicker(m, i);
  $('#fl', m).onchange = () => {
    renderPlanPicker(m, i);
    renderZoneOpts($('#fl', m).value, '');
    renderPosOpts('', '');
  };
  $('#zn', m).onchange = () => renderPosOpts($('#zn', m).value, '');
  $('#x', m).onclick = () => m.remove();
  $('#ok', m).onclick = async () => {
    const body = {
      projectId: S.projectId, title: $('#title', m).value.trim(), description: $('#desc', m).value,
      batchId: $('#bat', m).value || null,
      disciplineId: $('#dis', m).value, categoryName: $('#cat', m).value,
      floorId: $('#fl', m).value || null, zoneId: $('#zn', m).value || null, positionId: $('#pos', m).value || null,
      locationX: S._locX, locationY: S._locY, locationDesc: $('#locdesc', m).value,
      severity: $('#sev', m).value, priority: $('#pri', m).value,
      rectificationDeadline: $('#dl', m).value || null,
      reportedTime: $('#rt', m).value ? new Date($('#rt', m).value).toISOString() : undefined,
      responsibleOrgId: $('#org', m).value || null, responsibleUserName: $('#ru', m).value,
      suggestedAction: $('#act', m).value, standardReference: $('#std', m).value,
      photoIds: photos, sourceType: 'MANUAL',
    };
    if (!body.title) return toast('请填写标题');
    if (!body.disciplineId) return toast('请选择专业');
    try {
      if (preset) await api('PATCH', `/api/issues/${preset.id}`, body);
      else await api('POST', '/api/issues', body);
      m.remove(); toast(preset ? '已保存' : '问题已提交'); if (after) after(); else go('issues');
    } catch (e) { toast(e.message); }
  };
}

// ---------- settings ----------
async function viewSettings(c) {
  c.innerHTML = `<div class="page-head"><h2>系统设置</h2></div>
    <div class="seg" id="tabs" style="margin-bottom:14px">
      <button data-t="dis" class="active">专业</button><button data-t="fl">楼层/区域</button>
      <button data-t="bat">查验批次</button><button data-t="org">责任单位</button><button data-t="biz">业态</button><button data-t="usr">人员/角色</button>
    </div><div id="setBody"></div>`;
  const tabs = { dis: renderDis, fl: renderLocationTree, bat: renderBat, org: renderOrg, biz: renderBiz, usr: renderUsers };
  const show = (t) => { $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.t === t)); tabs[t]($('#setBody')); };
  $$('#tabs button').forEach(b => b.onclick = () => show(b.dataset.t));
  show('dis');
}
// 业态管理（可配置：新增 / 重命名 / 删除；重命名会同步商户、房源与资料类型）
async function renderBiz(c) {
  c.innerHTML = `<div class="card pad">
    <div class="muted" style="font-size:12px;margin-bottom:12px;line-height:1.7">商户「业态」用于匹配进场资料清单，也用于房源与筛选。新增后即可在商户/房源表单中选用；重命名会同步更新已有商户、房源与资料类型的引用。</div>
    <div class="row" style="align-items:center;gap:10px;margin-bottom:14px">
      <input id="nbz" placeholder="新增业态名称，如：影院" style="max-width:260px">
      <button class="btn" id="addBiz">＋ 添加</button>
    </div>
    <div class="biz-list" id="bizList"></div>
  </div>`;
  const ref = async () => {
    const r = await api('GET', '/api/biz-categories');
    S.C.BIZ_CATEGORIES = r.categories || [];
    const list = r.categories || [];
    $('#bizList').innerHTML = list.length
      ? list.map((x) => `<div class="biz-item">
          <span class="cat-tag" style="font-size:12px;padding:4px 11px">${esc(x)}</span>
          <button class="link biz-edit" data-b="${esc(x)}">改名</button>
          <button class="link biz-del" data-b="${esc(x)}" style="color:var(--red-tx)">删除</button>
        </div>`).join('')
      : `<div class="muted" style="font-size:12px">暂无业态，请先添加。</div>`;
    $$('.biz-del', c).forEach((b) => b.onclick = async () => {
      const name = b.dataset.b;
      let used = 0;
      try { const mr = await api('GET', '/api/merchants'); used = (mr.merchants || []).filter((m) => m.category === name).length; } catch (e) { /* 忽略 */ }
      confirmDlg(used ? `「${name}」已被 ${used} 个商户使用，删除后这些商户仍保留该名称（但将不再出现在下拉选项中）。确定删除？` : `确定删除业态「${name}」？`, async () => {
        try { await api('DELETE', `/api/biz-categories/${encodeURIComponent(name)}`); toast('已删除'); ref(); }
        catch (e) { toast(e.message, 'err'); }
      }, '删除');
    });
    $$('.biz-edit', c).forEach((b) => b.onclick = () => {
      const name = b.dataset.b;
      promptDlg(`将业态「${name}」重命名为：`, '', async (v) => {
        if (!v) return;
        try { await api('PATCH', `/api/biz-categories/${encodeURIComponent(name)}`, { newName: v }); toast('已重命名，并同步更新相关引用'); ref(); }
        catch (e) { toast(e.message, 'err'); }
      }, '重命名业态');
    });
  };
  $('#addBiz', c).onclick = async () => {
    const v = $('#nbz', c).value.trim(); if (!v) return toast('请填写业态名称', 'err');
    try { await api('POST', '/api/biz-categories', { name: v }); $('#nbz', c).value = ''; toast('已添加'); ref(); }
    catch (e) { toast(e.message, 'err'); }
  };
  $('#nbz', c).onkeydown = (e) => { if (e.key === 'Enter') $('#addBiz', c).click(); };
  ref();
}
async function renderDis(c) {
  c.innerHTML = `<div class="card pad"><div class="row"><input id="nd" placeholder="新增专业名称"><button class="btn" id="add">+ 添加</button></div>
    <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>专业</th><th>状态</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div>`;
  const ref = async () => { const d = await api('GET', '/api/disciplines'); S.disciplines = d.disciplines; $('#tb').innerHTML = d.disciplines.map(x => `<tr><td>${esc(x.name)}</td><td>${x.active ? '<span class="st closed">启用</span>' : '<span class="st open">停用</span>'}</td><td><button class="btn ghost sm" data-tg="${x.id}">${x.active ? '停用' : '启用'}</button></td></tr>`).join(''); $$('#tb [data-tg]').forEach(b => b.onclick = async () => { await api('PATCH', `/api/disciplines/${b.dataset.tg}`, { active: !S.disciplines.find(d => d.id === b.dataset.tg).active }); ref(); }); };
  $('#add').onclick = async () => { const n = $('#nd').value.trim(); if (!n) return; await api('POST', '/api/disciplines', { name: n }); $('#nd').value = ''; ref(); };
  ref();
}
async function renderLocationTree(c) {
  c.innerHTML = `
  <div class="loc-layout">
    <div class="loc-tree card pad" id="locTree"></div>
    <div class="loc-panel" id="locPanel"></div>
  </div>`;
  let selectedFloorId = null;
  let selectedZoneId = null;
  const ref = async () => {
    const [f, zAll, pAll] = await Promise.all([
      api('GET', `/api/projects/${S.projectId}/floors`),
      api('GET', '/api/zones').catch(() => ({ zones: [] })),
      api('GET', `/api/projects/${S.projectId}/positions`).catch(() => ({ positions: [] })),
    ]);
    S.floors = f.floors; S.zones = zAll.zones; S.positions = pAll.positions || [];
    renderTree();
    if (selectedZoneId && zoneMap()[selectedZoneId]) renderPanel(selectedZoneId);
    else if (selectedFloorId && floorMap()[selectedFloorId]) renderFloorPanel(selectedFloorId);
    else if (S.floors.length) { selectedFloorId = S.floors[0].id; renderTree(); renderFloorPanel(selectedFloorId); }
    else $('#locPanel').innerHTML = `<div class="card pad"><div class="empty">暂无楼层，点击左侧「+ 添加楼层/楼栋」开始</div></div>`;
  };
  const floorMap = () => Object.fromEntries(S.floors.map((f) => [f.id, f]));
  const zoneMap = () => Object.fromEntries(S.zones.map((z) => [z.id, z]));
  const posForZone = (zid) => S.positions.filter((p) => p.zoneId === zid);
  const renderTree = () => {
    const fmap = floorMap();
    const zonesByFloor = {};
    S.zones.forEach((z) => { (zonesByFloor[z.floorId] ||= []).push(z); });
    const html = S.floors.map((f) => {
      const zones = zonesByFloor[f.id] || [];
      const isF = f.id === selectedFloorId;
      return `
      <div class="loc-floor">
        <div class="loc-floor-hd ${isF ? 'on' : ''}" data-f="${f.id}">
          <span class="loc-toggle">▾</span>
          <span class="loc-name">${esc(f.name)}</span>
          <span class="loc-acts"><button class="link" data-add-zone="${f.id}">添加区域</button><button class="link" data-up-plan="${f.id}">平面图</button><button class="link" data-del-floor="${f.id}">删除</button></span>
        </div>
        <div class="loc-children open" id="fch-${f.id}">
          ${zones.map((z) => `
          <div class="loc-zone ${z.id === selectedZoneId ? 'on' : ''}" data-z="${z.id}" title="${esc(fmap[z.floorId]?.name || '')} › ${esc(z.name)}">
            <span class="loc-name">${esc(z.name)}</span>
            <span class="loc-acts"><button class="link" data-del-zone="${z.id}">删除</button></span>
          </div>`).join('')}
        </div>
      </div>`;
    }).join('')
    + `<div class="loc-floor" style="margin-top:10px"><button class="btn sm" id="addFloor">+ 添加楼层/楼栋</button></div>`;
    $('#locTree').innerHTML = html;
    $$('#locTree .loc-floor-hd').forEach((hd) => {
      const f = floorMap()[hd.dataset.f]; if (!f) return;
      const ch = $(`#fch-${f.id}`); if (!ch) return;
      const toggle = () => { const open = ch.classList.toggle('open'); hd.querySelector('.loc-toggle').textContent = open ? '▾' : '▸'; };
      hd.onclick = (e) => {
        if (e.target.closest('.loc-acts')) return;
        if (e.target.closest('.loc-toggle')) { toggle(); return; }
        // 点击楼层主体：选中该楼层并在右侧展示其区域管理
        selectedFloorId = f.id; selectedZoneId = null;
        if (!ch.classList.contains('open')) toggle();
        renderTree();
        renderFloorPanel(f.id);
      };
    });
    $$('#locTree [data-add-zone]').forEach((b) => b.onclick = (e) => { e.stopPropagation();
      promptDlg('区域名称（如：东区）', '请输入区域名称', async (name) => {
        await api('POST', '/api/zones', { floorId: b.dataset.addZone, name }); ref();
      });
    });
    $$('#locTree [data-del-zone]').forEach((b) => b.onclick = (e) => { e.stopPropagation();
      confirmDlg('确定删除该区域？其下位置将一并失效。', async () => {
        await api('DELETE', `/api/zones/${b.dataset.delZone}`); if (selectedZoneId === b.dataset.delZone) selectedZoneId = null; ref();
      }, '删除');
    });
    $$('#locTree [data-del-floor]').forEach((b) => b.onclick = (e) => { e.stopPropagation();
      confirmDlg('确定删除该楼层/楼栋？其下区域和位置将一并失效。', async () => {
        await api('DELETE', `/api/floors/${b.dataset.delFloor}`); if (selectedFloorId === b.dataset.delFloor) selectedFloorId = null; ref();
      }, '删除');
    });
    $$('#locTree [data-up-plan]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); uploadPlan(b.dataset.upPlan, ref); });
    $('#addFloor').onclick = () => promptDlg('楼层/楼栋名称', '如：1F、B1、2号楼', async (n) => {
      await api('POST', '/api/floors', { projectId: S.projectId, name: n }); selectedFloorId = null; ref();
    });
    $$('#locTree .loc-zone').forEach((z) => z.onclick = (e) => {
      if (e.target.closest('.loc-acts')) return;
      const zone = zoneMap()[z.dataset.z];
      selectedZoneId = z.dataset.z; if (zone) selectedFloorId = zone.floorId;
      renderTree(); renderPanel(selectedZoneId);
    });
  };
  // 楼层面板：该楼层下的区域管理
  const renderFloorPanel = (fid) => {
    const f = floorMap()[fid]; if (!f) return;
    const zones = S.zones.filter((z) => z.floorId === fid);
    $('#locPanel').innerHTML = `
      <div class="card pad" style="height:100%;display:flex;flex-direction:column">
        <div class="loc-crumbs">${esc(f.name)} <span class="muted">› 区域管理</span></div>
        <div class="row" style="margin:12px 0;gap:8px">
          <input id="nzName" placeholder="区域名称，如：东区" style="flex:1">
          <button class="btn" id="addZone">+ 添加区域</button>
        </div>
        <div class="tbl-wrap" style="flex:1">
          <table>
            <thead><tr><th>区域名称</th><th>位置数量</th><th></th></tr></thead>
            <tbody id="zoneTb"></tbody>
          </table>
        </div>
      </div>`;
    const renderZ = () => {
      $('#zoneTb').innerHTML = zones.length ? zones.map((z) => `
        <tr>
          <td>${esc(z.name)}</td>
          <td>${posForZone(z.id).length}</td>
          <td><button class="btn ghost sm" data-open-zone="${z.id}">管理位置</button> <button class="btn ghost sm" data-del-zone2="${z.id}">删除区域</button></td>
        </tr>`).join('') : `<tr><td colspan="3" class="muted" style="text-align:center">暂无区域，点击上方「+ 添加区域」</td></tr>`;
      $$('#zoneTb [data-open-zone]').forEach((b) => b.onclick = () => { selectedZoneId = b.dataset.openZone; renderTree(); renderPanel(selectedZoneId); });
      $$('#zoneTb [data-del-zone2]').forEach((b) => b.onclick = () => confirmDlg('确定删除该区域？其下位置将一并失效。', async () => {
        await api('DELETE', `/api/zones/${b.dataset.delZone2}`); ref();
      }, '删除'));
    };
    renderZ();
    $('#addZone').onclick = async () => {
      const name = $('#nzName').value.trim(); if (!name) return toast('请填写区域名称');
      await api('POST', '/api/zones', { floorId: fid, name }); $('#nzName').value = ''; ref();
    };
  };
  // 区域面板：该区域下的位置管理
  const renderPanel = (zid) => {
    const z = zoneMap()[zid]; const f = z ? floorMap()[z.floorId] : null;
    if (!z) return;
    $('#locPanel').innerHTML = `
      <div class="card pad" style="height:100%;display:flex;flex-direction:column">
        <div class="row" style="align-items:center;gap:10px">
          <button class="btn ghost sm" id="backFloor">返回楼层</button>
          <div class="loc-crumbs" style="margin:0">${esc(f ? f.name : '-')} <span class="muted">›</span> ${esc(z.name)}</div>
        </div>
        <div class="row" style="margin:12px 0;gap:8px">
          <input id="npName" placeholder="位置名称" style="flex:1">
          <input id="npType" placeholder="类型（如：非房源）" style="width:120px">
          <input id="npTags" placeholder="标签（如：地面，多个用逗号）" style="width:160px">
          <button class="btn" id="addPos">+ 新增位置</button>
        </div>
        <div class="tbl-wrap" style="flex:1">
          <table>
            <thead><tr><th>位置名称</th><th>所属区域</th><th>类型</th><th>位置标签</th><th></th></tr></thead>
            <tbody id="posTb"></tbody>
          </table>
        </div>
      </div>`;
    $('#backFloor').onclick = () => { selectedZoneId = null; renderTree(); renderFloorPanel(z.floorId); };
    const renderPos = () => {
      const rows = posForZone(zid);
      $('#posTb').innerHTML = rows.length ? rows.map((p) => `
        <tr>
          <td>${esc(p.name)}</td>
          <td>${esc(f ? f.name : '-')}/${esc(z.name)}</td>
          <td>${esc(p.type || '-')}</td>
          <td>${(p.tags || []).map((t) => `<span class="tag sm">${esc(t)}</span>`).join('') || '-'}</td>
          <td><button class="btn ghost sm" data-dp="${p.id}">删除</button></td>
        </tr>`).join('') : `<tr><td colspan="5" class="muted" style="text-align:center">暂无位置，点击上方「+ 新增位置」</td></tr>`;
      $$('#posTb [data-dp]').forEach((b) => b.onclick = () => confirmDlg('确定删除该位置？', async () => {
        await api('DELETE', `/api/positions/${b.dataset.dp}`); ref();
      }, '删除'));
    };
    renderPos();
    $('#addPos').onclick = async () => {
      const name = $('#npName').value.trim(); if (!name) return toast('请填写位置名称');
      await api('POST', '/api/positions', { zoneId: zid, name, type: $('#npType').value.trim(), tags: $('#npTags').value.trim() });
      $('#npName').value = ''; $('#npType').value = ''; $('#npTags').value = ''; ref();
    };
  };
  ref();
}
async function uploadPlan(floorId, after) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try {
      const fr = new FileReader();
      const url = await new Promise((res, rej) => { fr.onload = async () => { try { res((await api('POST', '/api/uploads', { filename: f.name, data: fr.result.split(',')[1] })).url); } catch (e) { rej(e); } }; fr.onerror = rej; fr.readAsDataURL(f); });
      await api('PATCH', `/api/floors/${floorId}`, { planImage: url });
      toast('平面图已上传'); if (after) after();
    } catch (e) { toast(e.message); }
  };
  inp.click();
}
async function renderZn(c) {
  c.innerHTML = `<div class="card pad"><div class="row"><select id="zf">${S.floors.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select><input id="nz" placeholder="区域名称，如 东区"><button class="btn" id="add">+ 添加</button></div>
    <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>区域</th><th>所属楼层</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div>`;
  const ref = async () => { const z = await api('GET', '/api/zones'); S.zones = z.zones; const fl = Object.fromEntries(S.floors.map(f => [f.id, f.name])); $('#tb').innerHTML = z.zones.filter(z => S.floors.some(f => f.id === z.floorId)).map(x => `<tr><td>${esc(x.name)}</td><td>${esc(fl[x.floorId] || '-')}</td><td><button class="btn ghost sm" data-d="${x.id}">删除</button></td></tr>`).join(''); $$('#tb [data-d]').forEach(b => b.onclick = async () => { await api('DELETE', `/api/zones/${b.dataset.d}`); ref(); }); };
  $('#add').onclick = async () => { const n = $('#nz').value.trim(); if (!n) return; await api('POST', '/api/zones', { floorId: $('#zf').value, name: n }); $('#nz').value = ''; ref(); };
  ref();
}
async function renderBat(c) {
  c.innerHTML = `<div class="card pad">
    <div class="row"><input id="nb" placeholder="批次名称，如 开业前综合查验第一轮" style="flex:1"><select id="bt" style="width:180px">${batTypes()}</select><button class="btn" id="add">+ 添加</button></div>
    <div class="muted" style="font-size:12px;margin-top:8px">批次「闭合」后不能再绑定新问题（已存在的问题不受影响），可随时重新打开。状态释义：<b>进行中</b>=可继续登记/编辑问题；<b>已完成</b>=该批次检查已结束（可查阅历史）；<b>已取消</b>=作废。</div>
    <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>批次</th><th>类型</th><th>状态</th><th>起始</th><th>结束</th><th></th></tr></thead><tbody id="tb"></tbody></table></div>
  </div>`;
  const stColor = (s) => s === '已完成' ? 'closed' : (s === '已取消' ? 'rejected' : 'open');
  const ref = async () => {
    const r = await api('GET', `/api/projects/${S.projectId}/batches`);
    S.batches = r.batches;
    if (!r.batches.length) { $('#tb').innerHTML = `<tr><td colspan="6" class="center muted" style="padding:30px">暂无批次，点击上方添加</td></tr>`; return; }
    $('#tb').innerHTML = r.batches.map((x) => {
      const s = x.status || '进行中';
      const acts = s === '进行中'
        ? `<button class="link" data-cmp="${x.id}">完成批次</button> <button class="link" data-can="${x.id}">取消</button> <button class="link" data-d="${x.id}">删除</button>`
        : `<button class="link" data-reo="${x.id}">重新打开</button> <button class="link" data-d="${x.id}">删除</button>`;
      return `<tr>
        <td><b>${esc(x.name)}</b></td>
        <td>${esc(x.type || '-')}</td>
        <td><span class="st ${stColor(s)}">${esc(s)}</span></td>
        <td>${esc((x.startDate || '').slice(0, 10)) || '-'}</td>
        <td>${esc((x.endDate || '').slice(0, 10)) || '-'}</td>
        <td>${acts}</td>
      </tr>`;
    }).join('');
    $$('#tb [data-cmp]').forEach((b) => b.onclick = () => confirmDlg('确定完成该批次？完成后不能再向该批次新增/绑定问题。', async () => {
      await api('PATCH', `/api/batches/${b.dataset.cmp}`, { status: '已完成', endDate: new Date().toISOString().slice(0, 10) });
      toast('批次已完成'); ref();
    }, '完成'));
    $$('#tb [data-reo]').forEach((b) => b.onclick = async () => { await api('PATCH', `/api/batches/${b.dataset.reo}`, { status: '进行中', endDate: '' }); toast('已重新打开'); ref(); });
    $$('#tb [data-can]').forEach((b) => b.onclick = () => confirmDlg('确定取消该批次？已绑定的问题不受影响，但不能再向其新增。', async () => {
      await api('PATCH', `/api/batches/${b.dataset.can}`, { status: '已取消', endDate: new Date().toISOString().slice(0, 10) });
      toast('批次已取消'); ref();
    }, '取消'));
    $$('#tb [data-d]').forEach((b) => b.onclick = () => confirmDlg('确定删除该批次？已绑定问题将保留批次名称，但批次将不再出现在下拉中。', async () => {
      await api('DELETE', `/api/batches/${b.dataset.d}`); toast('已删除'); ref();
    }, '删除'));
  };
  $('#add').onclick = async () => { const n = $('#nb').value.trim(); if (!n) return toast('请填写批次名称'); await api('POST', '/api/batches', { projectId: S.projectId, name: n, type: $('#bt').value, status: '进行中', startDate: new Date().toISOString().slice(0, 10) }); $('#nb').value = ''; ref(); };
  ref();
}
function batTypes() { const t = ['开业前综合查验', '隐蔽工程查验', '完工初验', '专项验收', '消防专项查验', '机电系统查验', '公共区域查验', '设备房查验', '租户交付查验', '开业前一周复查', '开业前一天最终检查']; return t.map(x => `<option>${x}</option>`).join(''); }
async function renderOrg(c) {
  c.innerHTML = `<div class="card pad"><div class="row"><input id="no" placeholder="单位名称"><select id="ot">${Object.entries(S.C.ORG_TYPE).map(([k,v])=>`<option value="${v}">${v}</option>`).join('')}</select><button class="btn" id="add">+ 添加</button></div>
    <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>责任单位</th><th>类型</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div>`;
  const ref = async () => { const o = await api('GET', '/api/organizations'); S.orgs = o.organizations; $('#tb').innerHTML = o.organizations.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.type)}</td><td><button class="btn ghost sm" data-d="${x.id}">删除</button></td></tr>`).join(''); $$('#tb [data-d]').forEach(b => b.onclick = async () => { await api('DELETE', `/api/organizations/${b.dataset.d}`); ref(); }); };
  $('#add').onclick = async () => { const n = $('#no').value.trim(); if (!n) return; await api('POST', '/api/organizations', { name: n, type: $('#ot').value }); $('#no').value = ''; ref(); };
  ref();
}
async function renderUsers(c) {
  const canEdit = ['超级管理员'].includes(S.user.role);
  const roleOpts = Object.entries(S.C.ROLE).map(([k, v]) => `<option value="${v}">${v}</option>`).join('');
  const orgOpts = `<option value="">不绑定责任单位</option>` + (S.orgs || []).map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('');
  const orgName = (id) => { const o = (S.orgs || []).find(x => x.id === id); return o ? o.name : '—'; };
  c.innerHTML = `<div class="card pad">
    ${canEdit ? `<div class="row" style="flex-wrap:wrap;gap:8px">
        <input id="nu" placeholder="登录用户名">
        <input id="nn" placeholder="姓名">
        <select id="nr">${roleOpts}</select>
        <select id="no" title="责任单位">${orgOpts}</select>
        <input id="np" placeholder="初始密码" value="123456" style="max-width:120px">
        <button class="btn" id="add">+ 新建账号</button>
      </div>
      <div class="note">总管理账号（超级管理员）可自由创建账号并分配<b>角色</b>与<b>责任单位</b>；初始密码 123456，登录后可在对接系统修改。删除账号不可恢复。</div>`
      : `<div class="note">仅超级管理员可管理账号。当前角色为「${esc(S.user.role)}」，可查看人员列表。</div>`}
    <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>用户名</th><th>姓名</th><th>角色</th><th>责任单位</th><th></th></tr></thead><tbody id="tb"></tbody></table></div>
  </div>`;
  const ref = async () => {
    const u = await api('GET', '/api/users');
    if (canEdit && S.orgs == null) { try { const o = await api('GET', '/api/organizations'); S.orgs = o.organizations; } catch (e) {} }
    $('#tb').innerHTML = u.users.map(x => `<tr>
      <td>${esc(x.username)}</td><td>${esc(x.name || '-')}</td>
      <td><span class="tag">${esc(x.role)}</span></td>
      <td>${esc(orgName(x.orgId))}</td>
      <td>${canEdit ? `<button class="btn ghost sm" data-e="${x.id}">编辑</button> <button class="btn ghost sm" data-d="${x.id}">删除</button>` : ''}</td>
    </tr>`).join('');
    $$('#tb [data-d]').forEach(b => b.onclick = async () => { if (!confirm('确认删除该账号？此操作不可恢复')) return; try { await api('DELETE', `/api/users/${b.dataset.d}`); toast('已删除'); ref(); } catch (e) { toast(e.message); } });
    $$('#tb [data-e]').forEach(b => b.onclick = () => openUserEditor(b.dataset.e, ref));
  };
  if (canEdit) {
    $('#add').onclick = async () => {
      const username = $('#nu').value.trim(), name = $('#nn').value.trim(), role = $('#nr').value, orgId = $('#no').value || null, password = $('#np').value.trim() || '123456';
      if (!username || !name) return toast('请填写用户名与姓名');
      try { await api('POST', '/api/users', { username, name, role, orgId, password }); $('#nu').value = ''; $('#nn').value = ''; $('#no').value = ''; toast('账号已创建'); ref(); } catch (e) { toast(e.message); }
    };
  }
  ref();
}
async function viewAccounts(c) { return renderUsers(c); }
// ---------- 权限中心 ----------
async function viewPermissionCenter(c) {
  const groups = (S.C && S.C.PERMISSION_GROUPS) || [];
  c.innerHTML = `<div class="page-head"><h2>权限中心</h2><span class="tag">角色权限可配置 · 给不同管理员分发权限</span></div>
    <div class="tabs" id="permTabs">
      <button class="tab active" data-t="roles">角色与权限</button>
      <button class="tab" data-t="users">账号与角色</button>
    </div>
    <div id="permBody" class="card pad" style="margin-top:12px"></div>`;
  const body = $('#permBody');
  async function renderRoles() {
    const r = await api('GET', '/api/roles');
    body.innerHTML = `<div class="muted" style="margin-bottom:12px">勾选角色拥有的权限，保存后即时生效。超级管理员为内置角色，拥有全部权限且不可修改。</div>` +
      r.roles.map((role) => {
        const isLocked = role.locked;
        const checks = groups.map((g) => `<div class="perm-group"><div class="perm-g-title">${esc(g.group)}</div><div class="perm-items">` +
          g.items.map((it) => `<label class="perm-chk"><input type="checkbox" data-perm="${it.key}" ${role.permissions.includes(it.key) ? 'checked' : ''} ${isLocked ? 'disabled' : ''}> ${esc(it.label)}</label>`).join('') +
          `</div></div>`).join('');
        return `<div class="role-card">
          <div class="role-head"><b>${esc(role.name)}</b>${isLocked ? ' <span class="tag" style="background:var(--red-bg);color:var(--red-tx)">内置·不可改</span>' : ''} <span class="muted" style="font-size:12px">（${role.permissions.length} 项权限）</span>${!isLocked ? '<button class="btn sec sm" data-save="' + role.id + '" style="margin-left:auto">保存</button>' : ''}</div>
          <div class="perm-grid">${checks}</div>
        </div>`;
      }).join('');
    $$('#permBody [data-save]').forEach((b) => b.onclick = async () => {
      const id = b.dataset.save;
      const card = b.closest('.role-card');
      const perms = $$('input[data-perm]', card).filter((x) => x.checked).map((x) => x.dataset.perm);
      try { await api('PATCH', `/api/roles/${id}`, { permissions: perms }); toast('已保存角色权限'); renderRoles(); }
      catch (e) { toast(e.message, 'err'); }
    });
  }
  async function renderUsers() {
    const u = await api('GET', '/api/users');
    const roleOpts = (sel) => Object.entries(S.C.ROLE).map(([k, v]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${v}</option>`).join('');
    const orgName = (id) => { const o = (S.orgs || []).find((x) => x.id === id); return o ? o.name : '—'; };
    body.innerHTML = `<div class="muted" style="margin-bottom:12px">给每个账号分配角色，角色决定其可用功能（新增/编辑/删除问题、导出报告、管理账号等）。修改即时生效。</div>
      <div class="tbl-wrap"><table><thead><tr><th>用户名</th><th>姓名</th><th>责任单位</th><th>角色</th></tr></thead><tbody id="utb"></tbody></table></div>`;
    $('#utb').innerHTML = u.users.map((x) => `<tr>
      <td>${esc(x.username)}</td><td>${esc(x.name || '-')}</td><td>${esc(orgName(x.orgId))}</td>
      <td><select class="role-sel" data-uid="${x.id}">${roleOpts(x.role)}</select></td>
    </tr>`).join('');
    $$('#utb .role-sel').forEach((sel) => sel.onchange = async () => {
      const uid = sel.dataset.uid, role = sel.value;
      try { await api('PATCH', `/api/users/${uid}`, { role }); toast('已更新角色：' + role); }
      catch (e) { toast(e.message, 'err'); renderUsers(); }
    });
  }
  $$('#permTabs .tab').forEach((t) => t.onclick = () => {
    $$('#permTabs .tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    t.dataset.t === 'users' ? renderUsers() : renderRoles();
  });
  renderRoles();
}
function openUserEditor(id, ref) {
  api('GET', '/api/users').then(u => {
    const x = u.users.find(y => y.id === id); if (!x) return;
    const roleOpts = Object.entries(S.C.ROLE).map(([k, v]) => `<option value="${v}" ${v === x.role ? 'selected' : ''}>${v}</option>`).join('');
    const orgOpts = `<option value="">不绑定责任单位</option>` + (S.orgs || []).map(o => `<option value="${o.id}" ${o.id === x.orgId ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
    const m = modal(`<header><h3>编辑账号 · ${esc(x.username)}</h3><div class="spacer"></div><button class="btn ghost sm" id="x">关闭</button></header>
      <div class="body">
        <label>姓名</label><input id="e_name" value="${esc(x.name || '')}">
        <label>角色</label><select id="e_role">${roleOpts}</select>
        <label>责任单位</label><select id="e_org">${orgOpts}</select>
        <label>重置密码（留空则不修改）</label><input id="e_pw" type="password" placeholder="留空 = 不修改">
        <button class="btn" id="save" style="width:100%;margin-top:8px">保存</button>
      </div>`);
    $('#x', m).onclick = () => m.remove();
    $('#save', m).onclick = async () => {
      const body = { name: $('#e_name', m).value.trim(), role: $('#e_role', m).value, orgId: $('#e_org', m).value || null };
      const pw = $('#e_pw', m).value.trim(); if (pw) body.password = pw;
      try { await api('PATCH', `/api/users/${id}`, body); toast('已保存'); m.remove(); ref && ref(); } catch (e) { toast(e.message); }
    };
  }).catch(e => toast(e.message));
}

// ---------- reports ----------
async function viewReports(c) {
  c.innerHTML = `<div class="page-head"><h2>报告中心</h2><div class="spacer"></div>
    <button class="btn" id="g_all">一键生成全套报告</button>
    <button class="btn ghost" id="g_sum">总报告</button>
    <button class="btn ghost" id="g_clo">整改闭环</button>
    <button class="btn ghost" id="g_det">问题明细</button></div>
  <div class="grid3" id="list" style="margin-top:8px"></div>`;
  const refresh = async () => { const r = await api('GET', '/api/reports'); $('#list').innerHTML = r.reports.length ? r.reports.map(rp => `<div class="card pad"><div style="font-weight:700">${esc(rp.title)}</div><div class="muted" style="font-size:12px;margin:4px 0">${fmt(rp.createdAt)} · ${esc(rp.generatedByName)}</div><div class="row"><button class="btn sec sm" data-v="${rp.id}">查看/打印</button><button class="btn ghost sm" data-pdf="${rp.id}">PDF</button><button class="btn ghost sm" data-doc="${rp.id}">Word</button></div></div>`).join('') : `<div class="empty" style="grid-column:1/-1">暂无报告，点击上方按钮生成</div>`; $$('#list [data-v]').forEach(b => b.onclick = () => window.open(`/api/reports/${b.dataset.v}/view?toolbar=1`, '_blank')); $$('#list [data-pdf]').forEach(b => b.onclick = () => exportReportPDF(b.dataset.pdf)); $$('#list [data-doc]').forEach(b => b.onclick = () => window.open(`/api/reports/${b.dataset.doc}/export-doc`)); };
  const genOne = async (type) => { try { await api('POST', '/api/reports/generate', { projectId: S.projectId, type }); toast('报告已生成，点击下方“查看”可打印 / 另存为 PDF'); refresh(); } catch (e) { toast(e.message); } };
  $('#g_all').onclick = async () => {
    const b = $('#g_all'); b.classList.add('loading'); b.disabled = true;
    try {
      for (const t of ['summary', 'closure', 'detail']) await api('POST', '/api/reports/generate', { projectId: S.projectId, type: t });
      toast('全套报告已生成（总报告 / 整改闭环 / 问题明细，共 3 份）');
    } catch (e) { toast(e.message); }
    b.classList.remove('loading'); b.disabled = false; refresh();
  };
  $('#g_sum').onclick = () => genOne('summary'); $('#g_clo').onclick = () => genOne('closure'); $('#g_det').onclick = () => genOne('detail');
  refresh();
}

// ---------- audit ----------
async function viewAudit(c) {
  c.innerHTML = `<div class="page-head"><h2>审计日志</h2><span class="tag">所有核心操作可追溯</span></div>
    <div class="tbl-wrap"><table><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>说明</th></tr></thead><tbody id="tb"></tbody></table></div>`;
  const r = await api('GET', '/api/audit?limit=200');
  $('#tb').innerHTML = r.logs.map(l => `<tr><td>${esc(fmtTs(l.at))}</td><td>${esc(l.actorName)}</td><td><span class="tag">${esc(l.action)}</span></td><td>${esc(l.entity)}</td><td class="muted">${esc(l.after || '')}</td></tr>`).join('') || `<tr><td colspan="5" class="center muted">暂无日志</td></tr>`;
}

// ---------- V1.5: QR 二维码 ----------
function renderQR(el, text) {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text); qr.make();
    el.innerHTML = `<div class="qr-box">${qr.createImgTag(5, 8)}<div class="cap">${esc(text)}</div></div>`;
  } catch (e) { el.innerHTML = `<div class="muted">二维码生成失败</div>`; }
}
function sevColor(s) { return { S1:'#dc2626', S2:'#ea580c', S3:'#ca8a04', S4:'#2563eb', S5:'#16a34a' }[s] || '#999'; }

// ---------- V1.5: 平面图点选定位（新增/编辑问题） ----------
function renderPlanPicker(m, preset) {
  const slot = $('#planSlot', m); if (!slot) return;
  const fid = $('#fl', m).value;
  const floor = S.floors.find((f) => f.id === fid);
  if (!floor) {
    slot.innerHTML = `<div class="muted" style="font-size:12px">请先选择楼层，再点选定位。</div>`;
    return;
  }
  if (floor.planImage) {
    slot.innerHTML = `<div class="plan-viewport" id="pv" style="height:480px">
      <div class="plan-stage" id="ps"><img src="${esc(floor.planImage)}" id="pimg" draggable="false"><div class="plan-markers" id="pm"></div></div>
    </div>
    <div class="muted" style="font-size:12px;margin-top:6px">滚轮缩放 · 拖拽平移 · 点击平面图选/改位置</div>`;
  } else {
    slot.innerHTML = `<div class="plan-viewport" id="pv" style="height:300px">
      <div class="plan-stage plan-stage-grid" id="ps"><div class="plan-markers" id="pm"></div></div>
    </div>
    <div class="note">该楼层尚未上传平面图，点击网格选择大致位置（可在"系统设置→楼层"上传真实平面图）。</div>`;
  }
  const pw = $('#pv', m);
  const pm = $('#pm', m);
  // 选中态：把红色准星插进 .plan-markers（位于被 transform 的 stage 内），与缩放/平移自动同步
  function drawPick() {
    pm.querySelectorAll('.plan-pick').forEach((e) => e.remove());
    if (S._locX != null) {
      const mk = document.createElement('div');
      mk.className = 'plan-marker plan-pick';
      mk.style.left = S._locX + '%'; mk.style.top = S._locY + '%';
      mk.style.background = '#dc2626';
      mk.title = '当前位置（点击平面图更换）';
      pm.appendChild(mk);
    }
  }
  setupPlanZoom(pw, floor, {
    markers: [],
    onPick: (x, y) => {
      S._locX = Math.round(x * 10) / 10; S._locY = Math.round(y * 10) / 10;
      drawPick();
      toast('已选位置：' + S._locX + '%, ' + S._locY + '%（保存后生效）');
    },
  });
  if (preset && preset.locationX != null) { S._locX = preset.locationX; S._locY = preset.locationY; }
  drawPick();
}
function renderDetailPlan(el, issue) {
  const floor = S.floors.find((f) => f.id === issue.floorId);
  if (issue.locationX != null && floor && floor.planImage) {
    el.innerHTML = `<div class="plan-wrap" style="max-width:340px"><img src="${esc(floor.planImage)}"><div class="plan-marker" style="left:${issue.locationX}%;top:${issue.locationY}%;background:#dc2626"></div></div><div class="muted" style="font-size:12px;margin-top:4px">${esc(issue.locationDesc || '')}</div>`;
  } else if (issue.locationX != null && floor) {
    el.innerHTML = `<div class="plan-wrap plan-grid" style="height:240px;max-width:340px"><div class="plan-marker" style="left:${issue.locationX}%;top:${issue.locationY}%;background:#dc2626"></div></div><div class="muted" style="font-size:12px;margin-top:4px">未上传平面图，按网格大致定位｜${esc(issue.locationDesc || '')}</div>`;
  } else if (issue.locationDesc) {
    el.innerHTML = `<div class="muted">${esc(issue.locationDesc)}</div>`;
  } else {
    el.innerHTML = `<div class="muted" style="font-size:12px">未定位</div>`;
  }
}

// ---------- V1.5: 平面图视图（按楼层叠加问题点） ----------
async function viewPlan(c) {
  c.innerHTML = `<div class="page-head"><h2>平面图定位</h2><div class="spacer"></div>
    <select id="pf"><option value="">选择楼层</option>${S.floors.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select>
    <div class="zoombar" id="zoombar" style="display:none">
      <button class="btn ghost sm" id="zout" title="缩小">−</button>
      <span id="zpct" class="muted">100%</span>
      <button class="btn ghost sm" id="zin" title="放大">＋</button>
      <button class="btn ghost sm" id="zfit" title="适应屏幕">适应</button>
    </div></div>
    <div id="planView"></div>`;
  const render = async () => {
    const fid = $('#pf').value;
    if (!fid) { $('#planView').innerHTML = `<div class="empty">请选择楼层查看问题分布</div>`; $('#zoombar').style.display = 'none'; return; }
    const floor = S.floors.find((f) => f.id === fid);
    const r = await api('GET', `/api/issues?projectId=${S.projectId}&floorId=${fid}`);
    const issues = r.issues;
    const located = issues.filter((i) => i.locationX != null);
    const legend = S.C.SEVERITY_ORDER.map((s) => `<span><i style="background:${sevColor(s)}"></i>${s} ${esc(S.C.SEVERITY_LABEL[s] || '')}</span>`).join('');
    let inner;
    if (floor.planImage) {
      inner = `<div class="plan-viewport" id="pv"><div class="plan-stage" id="ps"><img src="${esc(floor.planImage)}" id="pimg" draggable="false"><div class="plan-markers" id="pm"></div></div></div>`;
    } else if (located.length) {
      inner = `<div class="plan-viewport" id="pv"><div class="plan-stage plan-stage-grid" id="ps"><div class="plan-markers" id="pm"></div></div></div><div class="note">该楼层未上传平面图，当前为示意坐标网格。在"系统设置→楼层"上传后显示真实平面图。</div>`;
    } else {
      inner = `<div class="empty">该楼层暂无问题，滚轮缩放可查看平面图细节。</div>`;
    }
    $('#planView').innerHTML = inner + `<div class="plan-legend">${legend}</div><div class="muted" style="font-size:12px;margin-top:6px">共 ${issues.length} 个问题，其中已定位 ${located.length} 个。滚轮缩放 · 拖拽平移 · 点击圆点看详情；同位置多个问题会自动聚合成数字气泡，点击展开。</div>`;
    // 只要有视图就启用缩放（包括无问题楼层也可缩放查看平面图细节）
    if (floor.planImage || located.length) {
      $('#zoombar').style.display = 'inline-flex';
      setupPlanZoom($('#pv'), floor, { markers: located });
    } else {
      $('#zoombar').style.display = 'none';
    }
  };
  $('#pf').onchange = render;
  $('#zin').onclick = () => zoomBtn(1.25);
  $('#zout').onclick = () => zoomBtn(0.8);
  $('#zfit').onclick = () => { const v = document.getElementById('content').querySelector('#pv'); if (v && v._planCtrl) v._planCtrl.fit(); };
  if (S.floors[0]) $('#pf').value = S.floors[0].id;
  render();
}
function setupPlanZoom(pv, floor, opts) {
  const o = opts || {}; const located = o.markers || [];
  const ps = pv.querySelector('.plan-stage'); const pm = pv.querySelector('.plan-markers');
  const img = ps ? ps.querySelector('img') : null;
  const FIT_PAD = 28;
  let zoom = 1, tx = 0, ty = 0, baseW = 1200, baseH = 750;
  const MINZ = 0.2, MAXZ = 8;
  function apply() {
    if (ps) ps.style.transform = `translate(${tx}px,${ty}px) scale(${zoom})`;
    pv.style.setProperty('--z', zoom);
    const zp = document.getElementById('zpct'); if (zp) zp.textContent = Math.round(zoom * 100) + '%';
  }
  function fit() {
    if (img && img.complete && img.naturalWidth) { baseW = img.naturalWidth; baseH = img.naturalHeight; }
    else if (!floor.planImage) { baseW = 1200; baseH = 750; }
    if (ps) { ps.style.width = baseW + 'px'; ps.style.height = baseH + 'px'; }
    const vw = pv.clientWidth - FIT_PAD, vh = pv.clientHeight - FIT_PAD;
    const z = Math.min(vw / baseW, vh / baseH, 1) || 1;
    zoom = z;
    tx = FIT_PAD / 2 + (vw - baseW * z) / 2;
    ty = FIT_PAD / 2 + (vh - baseH * z) / 2;
    apply(); drawMarkers();
  }
  function drawMarkers() {
    if (!pm) return; pm.innerHTML = '';
    if (!located.length) return;
    const thr = 18;
    const pts = located.map((i) => ({
      i,
      sx: tx + (i.locationX / 100) * baseW * zoom,
      sy: ty + (i.locationY / 100) * baseH * zoom,
    }));
    const used = new Array(pts.length).fill(false);
    const groups = [];
    for (let a = 0; a < pts.length; a++) {
      if (used[a]) continue;
      const g = [pts[a]]; used[a] = true;
      for (let b = 0; b < pts.length; b++) {
        if (used[b]) continue;
        if (Math.hypot(pts[a].sx - pts[b].sx, pts[a].sy - pts[b].sy) <= thr) { g.push(pts[b]); used[b] = true; }
      }
      groups.push(g);
    }
    groups.forEach((g) => {
      const x = g[0].i.locationX, y = g[0].i.locationY;
      const el = document.createElement('div');
      if (g.length === 1) {
        const i = g[0].i;
        el.className = 'plan-marker';
        el.dataset.id = i.id;
        el.style.background = sevColor(i.severity);
        el.title = `${i.issueNo} ${i.title}`;
      } else {
        el.className = 'plan-cluster';
        el.textContent = g.length;
        el._issues = g.map((p) => p.i);
        el.title = `该位置 ${g.length} 个问题，点击展开`;
      }
      el.style.left = x + '%'; el.style.top = y + '%';
      pm.appendChild(el);
    });
  }
  function zoomAt(cx, cy, factor) {
    const nz = Math.min(MAXZ, Math.max(MINZ, zoom * factor));
    const sx = (cx - tx) / zoom, sy = (cy - ty) / zoom;
    tx = cx - sx * nz; ty = cy - sy * nz; zoom = nz; apply(); drawMarkers();
  }
  function activate(el) {
    if (!el) return;
    if (el.classList.contains('plan-cluster')) showClusterList(el._issues || []);
    else if (el.dataset.id) viewIssueDetail($('#content'), el.dataset.id);
  }
  // 交互：用"按下到松手的总位移"区分「点击/点选」与「拖拽平移」，避免小圆点被拖拽吞掉点击
  let dragging = false, moved = false, startX = 0, startY = 0, downX = 0, downY = 0, downEl = null;
  const CLICK_TOL = 6; // 像素容差，>6px 视为拖拽
  pv.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startX = downX = e.clientX; startY = downY = e.clientY; moved = false;
    downEl = e.target.closest('.plan-marker,.plan-cluster');
    if (!downEl) { dragging = true; pv.classList.add('grabbing'); if (pv.setPointerCapture) try { pv.setPointerCapture(e.pointerId); } catch (_) {} }
  });
  pv.addEventListener('pointermove', (e) => {
    if (Math.abs(e.clientX - startX) > CLICK_TOL || Math.abs(e.clientY - startY) > CLICK_TOL) moved = true;
    if (dragging) { tx += e.clientX - downX; ty += e.clientY - downY; downX = e.clientX; downY = e.clientY; apply(); }
  });
  pv.addEventListener('pointerup', (e) => {
    const isClick = !moved;
    if (isClick && downEl) activate(downEl);
    else if (isClick && !downEl && o.onPick) {
      // 点选模式：直接用 stage 的真实屏幕矩形换算百分比（免疫 transform 平移/缩放/边框的计算误差）
      const r = ps.getBoundingClientRect();
      if (r.width && r.height) {
        const x = (e.clientX - r.left) / r.width * 100;
        const y = (e.clientY - r.top) / r.height * 100;
        const clamp = (v) => Math.max(0, Math.min(100, v));
        if (x >= -5 && x <= 105 && y >= -5 && y <= 105) o.onPick(clamp(x), clamp(y));
      }
    }
    dragging = false; pv.classList.remove('grabbing'); downEl = null;
  });
  pv.addEventListener('pointercancel', () => { dragging = false; pv.classList.remove('grabbing'); downEl = null; });
  pv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = pv.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.18 : 1 / 1.18);
  }, { passive: false });
  // 把控制器挂到 pv 上，避免多个平面图（弹窗 vs 页面）用全局变量互相覆盖
  pv._planCtrl = { zoomAt, fit };
  if (ps && img) { if (img.complete) fit(); else img.onload = fit; }
  else fit();
}
function showClusterList(grp) {
  const ov = document.createElement('div'); ov.className = 'pk-ov';
  ov.innerHTML = `<div class="pk-modal"><div class="pk-hd"><b>该位置堆叠 ${grp.length} 个问题</b><button class="btn ghost sm" id="pkClose">关闭</button></div>
  <div class="pk-bd">${grp.map((i) => `<div class="cluster-item" data-id="${i.id}"><span class="dot" style="background:${sevColor(i.severity)}"></span><b>${esc(i.issueNo)}</b> ${esc(i.title)}</div>`).join('')}</div></div>`;
  document.body.appendChild(ov);
  ov.onclick = (e) => { if (e.target === ov || e.target.id === 'pkClose') ov.remove(); };
  ov.querySelectorAll('.cluster-item').forEach((it) => it.onclick = () => { ov.remove(); viewIssueDetail($('#content'), it.dataset.id); });
}
function zoomBtn(f) { const pv = document.getElementById('content').querySelector('#pv'); if (!pv || !pv._planCtrl) return; const r = pv.getBoundingClientRect(); pv._planCtrl.zoomAt(r.width / 2, r.height / 2, f); }

// ---------- V1.5: AI 智能录入 ----------
async function viewAI(c) {
  const st = await api('GET', '/api/ai/status').catch(() => null);
  const canCfg = ['超级管理员', '项目经理'].includes(S.user.role);
  c.innerHTML = `
  <div class="page-head"><h2>AI 智能录入</h2><span class="ai-status ${st && st.configured ? 'ok' : 'local'}">${st && st.configured ? 'DeepSeek 已接入' : '本地规则模式（未配置密钥）'}</span></div>
  ${canCfg ? `<div class="ai-box ai-cfg" style="margin-bottom:14px">
    <h3 style="margin-bottom:8px">AI 配置（DeepSeek）</h3>
    <div class="row"><div class="col"><label>API Key</label><input id="ak" type="password" placeholder="sk-... 留空则使用本地规则"></div>
    <div class="col"><label>Base URL</label><input id="au" value="${esc(st ? st.baseUrl : 'https://api.deepseek.com')}"></div>
    <div class="col"><label>模型</label><select id="am">${['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-reasoner', 'deepseek-chat'].map((m) => `<option value="${m}" ${(st && st.model === m) ? 'selected' : ''}>${m}${m === 'deepseek-v4-pro' ? '（推荐·思考模式）' : m === 'deepseek-v4-flash' ? '（思考模式·更省）' : m === 'deepseek-reasoner' ? '（R1 推理）' : '（旧版）'}</option>`).join('')}</select></div></div>
    <div class="row" style="margin-top:10px"><button class="btn sm" id="saveCfg">保存配置</button><span id="cfgMsg" class="muted" style="align-self:center"></span></div>
    <div class="note">模型可随时切换：v4-pro 能力最强（默认带思考），v4-flash 更便宜，reasoner 为深度推理（较慢）。密钥保存在本地 data/ai-config.json，不会上传第三方。未配置时自动使用内置规则解析。</div>
  </div>` : ''}
  <div class="ai-box">
    <label style="font-weight:700">粘贴现场巡查描述（支持多行、口语化）</label>
    <textarea id="aiText" class="ai-text" placeholder="例：今天在3F东区发现卫生间入口有3块地砖破损，还有收口不顺，影响观感。另外中庭南侧天花有渗水痕迹，怀疑是空调冷凝水。"></textarea>
    <div class="row" style="margin-top:10px"><button class="btn" id="parse">智能解析</button><span id="aiMode" class="muted"></span></div>
    <div id="aiResult"></div>
  </div>`;
  if (canCfg) {
    $('#saveCfg').onclick = async () => {
      try { const r = await api('POST', '/api/ai/config', { apiKey: $('#ak').value.trim(), baseUrl: $('#au').value.trim(), model: $('#am').value }); $('#cfgMsg').textContent = r.configured ? '已保存，当前模型：' + (r.model || '') : '已保存（密钥为空，使用本地规则）'; } catch (e) { toast(e.message); }
    };
  }
  $('#parse').onclick = async () => {
    const text = $('#aiText').value.trim(); if (!text) return toast('请先输入描述');
    $('#aiMode').textContent = '解析中…';
    try {
      const r = await api('POST', '/api/ai/parse-issue', { text });
      const res = r.result;
      $('#aiMode').textContent = res._mode === 'deepseek' ? '· DeepSeek 解析' : (res._mode === 'deepseek_fallback' ? '· DeepSeek 失败，已回退本地规则' : '· 本地规则解析');
      showAIPreview($('#aiResult'), res);
    } catch (e) { $('#aiMode').textContent = ''; toast(e.message); }
  };
}
function showAIPreview(container, res) {
  const disc = S.disciplines.find((d) => d.name === res.discipline)
    || S.disciplines.find((d) => d.name.includes(res.discipline) || res.discipline.includes(d.name)) || null;
  const fl = S.floors.find((f) => f.name === res.floorName)
    || (res.floorName && S.floors.find((f) => f.name.includes(res.floorName) || res.floorName.includes(f.name))) || null;
  const matchedZones = fl ? S.zones.filter((z) => z.floorId === fl.id) : S.zones;
  const zn = matchedZones.find((z) => z.name === res.zoneName)
    || (res.zoneName && matchedZones.find((z) => z.name.includes(res.zoneName) || res.zoneName.includes(z.name))) || null;
  const matchedPos = zn ? S.positions.filter((p) => p.zoneId === zn.id) : [];
  const pos = matchedPos.find((p) => p.name === res.positionName)
    || (res.positionName && matchedPos.find((p) => p.name.includes(res.positionName) || res.positionName.includes(p.name))) || null;
  const sev = S.C.SEVERITY_ORDER.includes(res.severity) ? res.severity : 'S3';
  container.innerHTML = `<div class="ai-result">
    <div class="row"><div class="col"><div class="muted" style="font-size:12px">标题</div><b>${esc(res.title || '')}</b></div>
      <div class="col"><div class="muted" style="font-size:12px">严重度</div><b>${sev} ${esc(S.C.SEVERITY_LABEL[sev] || '')}</b></div>
      <div class="col"><div class="muted" style="font-size:12px">优先级</div><b>${esc(res.priority || 'P3')}</b></div></div>
    <div class="row"><div class="col"><div class="muted" style="font-size:12px">专业</div><b>${esc(res.discipline || '')} ${disc ? '已匹配' : '（请在下拉选择）'}</b></div>
      <div class="col"><div class="muted" style="font-size:12px">楼层/区域/位置</div><b>${esc(res.floorName || '-')}/${esc(res.zoneName || '-')}/${esc(res.positionName || '-')}</b></div></div>
    ${res.suggestedAction ? `<div class="muted" style="font-size:12px;margin-top:6px">建议措施</div>${esc(res.suggestedAction)}` : ''}
    ${res.standardReference ? `<div class="muted" style="font-size:12px;margin-top:6px">标准依据</div>${esc(res.standardReference)}` : ''}
    ${res.responsibilityHint ? `<div class="muted" style="font-size:12px;margin-top:6px">责任单位建议</div>${esc(res.responsibilityHint)}` : ''}
    <div style="margin-top:10px">
      <label style="margin:6px 0 4px">专业（可调整）</label>
      <select id="aiDis">${S.disciplines.filter((d) => d.active !== false).map((d) => `<option value="${d.id}" ${disc && disc.id === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
      <label style="margin:6px 0 4px">检查批次（可调整）</label>
      <select id="aiBat"><option value="">未选（非批次检查）</option>${S.batches.filter(b => !b.status || b.status === '进行中').map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select>
      <div class="row">
        <div class="col"><label>楼层</label><select id="aiFl"><option value="">未定位</option>${S.floors.map((f) => `<option value="${f.id}" ${fl && fl.id === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>
        <div class="col"><label>区域</label><select id="aiZn"><option value="">未选</option></select></div>
        <div class="col"><label>位置</label><select id="aiPos"><option value="">未选</option></select></div>
      </div>
    </div>
    <label style="margin:10px 0 4px">现场照片（最多 5 张，可一次多选或逐张添加）</label>
    <div class="photos" id="aiPhotos"></div>
    <button class="btn" id="aiCreate" style="margin-top:12px;width:100%">一键创建问题</button>
  </div>`;
  const aiPhotos = [];
  setupPhotos({ 'AI现场照片': { arr: aiPhotos, container: $('#aiPhotos', container), max: 5 } });
  const aiFl = $('#aiFl', container), aiZn = $('#aiZn', container), aiPos = $('#aiPos', container);
  const renderZones = (floorId, sel) => {
    const opts = floorId ? S.zones.filter((z) => z.floorId === floorId) : [];
    aiZn.innerHTML = `<option value="">未选</option>` + opts.map((z) => `<option value="${z.id}" ${z.id === sel ? 'selected' : ''}>${esc(z.name)}</option>`).join('');
  };
  const renderPositions = (zoneId, sel) => {
    const opts = zoneId ? S.positions.filter((p) => p.zoneId === zoneId) : [];
    aiPos.innerHTML = `<option value="">未选</option>` + opts.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  };
  renderZones(fl ? fl.id : '', zn ? zn.id : '');
  renderPositions(zn ? zn.id : '', pos ? pos.id : '');
  aiFl.onchange = () => { renderZones(aiFl.value, ''); renderPositions('', ''); };
  aiZn.onchange = () => renderPositions(aiZn.value, '');
  $('#aiCreate', container).onclick = async () => {
    const body = {
      projectId: S.projectId, title: res.title || 'AI 解析问题', description: res.description || '',
      disciplineId: $('#aiDis', container).value, categoryName: res.categoryName || '',
      batchId: $('#aiBat', container).value || null,
      floorId: aiFl.value || null, zoneId: aiZn.value || null, positionId: aiPos.value || null,
      severity: sev, priority: res.priority || 'P3',
      suggestedAction: res.suggestedAction || '', standardReference: res.standardReference || '',
      locationDesc: res.locationDesc || '', sourceType: 'AI', photoIds: aiPhotos,
    };
    try { const cr = await api('POST', '/api/issues', body); toast('问题已创建：' + cr.issue.issueNo); container.innerHTML = ''; go('issues'); } catch (e) { toast(e.message); }
  };
}

// ---------- V1.5: 原生 PDF / Word 导出 ----------
function issueQueryStr() {
  const q = new URLSearchParams({ projectId: S.projectId });
  const kw = $('#f_kw').value.trim(); if (kw) q.set('keyword', kw);
  const dis = $('#f_dis').value; if (dis) q.set('discipline', dis);
  const fl = $('#f_fl').value; if (fl) q.set('floorId', fl);
  const bt = $('#f_bt').value; if (bt) q.set('batchId', bt);
  const sev = $('#f_sev').value; if (sev) q.set('severity', sev);
  const st = $('#f_st').value; if (st) q.set('status', st);
  if ($('#f_od') && $('#f_od').checked) q.set('overdue', '1');
  return q.toString();
}
async function exportPDFfromElement(el, filename) {
  toast('正在生成 PDF…');
  try {
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'pt', 'a4');
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    const imgW = pw;
    const imgH = (canvas.height * imgW) / canvas.width;
    const img = canvas.toDataURL('image/jpeg', 0.92);
    let heightLeft = imgH; let position = 0;
    doc.addImage(img, 'JPEG', 0, 0, imgW, imgH);
    heightLeft -= ph;
    while (heightLeft > 0) { position -= ph; doc.addPage(); doc.addImage(img, 'JPEG', 0, position, imgW, imgH); heightLeft -= ph; }
    doc.save(filename);
    toast('PDF 已导出');
  } catch (e) { toast('PDF 生成失败：' + e.message); }
}
async function exportReportPDF(id) {
  try {
    const html = await (await fetch(`/api/reports/${id}/view`)).text();
    const bm = html.match(/<body[^>]*>([\s\S]*)<\/body>/i); const body = bm ? bm[1] : html;
    const sm = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i); const style = sm ? `<style>${sm[1]}</style>` : '';
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:820px;background:#fff';
    holder.innerHTML = style + '<div>' + body + '</div>';
    document.body.appendChild(holder);
    await exportPDFfromElement(holder, '汇报总报告.pdf');
    setTimeout(() => holder.remove(), 600);
  } catch (e) { toast('PDF 生成失败：' + e.message); }
}
async function exportIssuesPDF() {
  try {
    const r = await api('GET', `/api/issues?` + issueQueryStr());
    const issues = r.issues;
    const rows = issues.map((i) => `<tr><td>${esc(i.issueNo)}</td><td>${esc(i.floorName || '')}</td><td>${esc(i.zoneName || '')}</td><td>${esc(i.positionName || '')}</td><td>${esc(i.disciplineName || '')}</td><td>${esc(i.batchName || '')}</td><td>${esc(i.title)}</td><td>${esc(i.severity)}</td><td>${esc(i.responsibleOrgName || '')}</td><td>${esc((i.rectificationDeadline || '').slice(0, 10))}</td><td>${esc(S.C.ISSUE_STATUS_LABEL[i.rectificationStatus] || '')}</td></tr>`).join('');
    const html = `<div style="font-family:sans-serif;padding:22px;background:#fff"><h2>承接查验问题清单（共 ${issues.length} 项）</h2>
      <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;font-size:12px">
      <thead><tr><th>编号</th><th>楼层</th><th>区域</th><th>位置</th><th>专业</th><th>检查批次</th><th>问题</th><th>严重度</th><th>责任单位</th><th>截止</th><th>状态</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:820px;background:#fff';
    holder.innerHTML = html; document.body.appendChild(holder);
    await exportPDFfromElement(holder, '承接查验问题清单.pdf');
    setTimeout(() => holder.remove(), 600);
  } catch (e) { toast('PDF 生成失败：' + e.message); }
}

// ---------- 统计表（可多个、可自由编辑） ----------
const TILE_DEFS = [
  { key: 'total', label: '问题总数' }, { key: 'open', label: '未关闭' }, { key: 'closed', label: '已关闭' },
  { key: 'overdue', label: '已超期' }, { key: 'closureRate', label: '闭环率' },
  { key: 'majorIssueRate', label: '重大/高风险率' }, { key: 'firstPassRate', label: '一次通过率' }, { key: 'onTimeRate', label: '按时整改率' },
];
const CHART_DEFS = [
  { key: 'trend', label: '问题趋势' }, { key: 'severity', label: '严重度分布' }, { key: 'discipline', label: '专业分布' },
  { key: 'floor', label: '区域/楼层分布' }, { key: 'responsibility', label: '责任单位排名' },
];
async function viewStatBoards(c) {
  c.innerHTML = `<div class="empty noicon"><span class="spinner"></span>加载中…</div>`;
  const r = await api('GET', `/api/projects/${S.projectId}/statboards`).catch(() => ({ statBoards: [] }));
  S.statBoards = r.statBoards || [];
  if (!S.statBoards.length) { c.innerHTML = `<div class="empty">暂无统计表，点击右上角「+ 新建」开始。</div>`; return; }
  const active = S.statBoards.find(b => b.id === S.activeBoardId) || S.statBoards.find(b => b.isDefault) || S.statBoards[0];
  S.activeBoardId = active.id;
  renderStatBoard(c, active);
}
function renderStatBoard(c, board) {
  const list = S.statBoards.map(b => `
    <div class="sb-item ${b.id === board.id ? 'on' : ''}" data-id="${b.id}">
      <div class="sb-item-main">
        <button class="sb-pick link" data-id="${b.id}">${esc(b.name)}</button>
        ${b.isDefault ? '<span class="tag sm def">默认仪表盘</span>' : ''}
        ${b.onDashboard ? '<span class="tag sm dash">首页展示</span>' : ''}
      </div>
      <div class="sb-item-acts">
        <label class="chk sm"><input type="checkbox" data-dash="${b.id}" ${b.onDashboard ? 'checked' : ''}> 放仪表盘</label>
        <button class="btn ghost sm" data-def="${b.id}">设为默认仪表盘</button>
        <button class="btn ghost sm" data-del="${b.id}">删除</button>
      </div>
    </div>`).join('');
  c.innerHTML = `
  <div class="page-head"><h2>统计表</h2><div class="spacer"></div>
    <button class="btn ghost sm" id="sbNew">+ 新建</button>
    <button class="btn ghost sm" id="sbEdit">编辑当前表</button>
  </div>
  <div class="note" style="margin-bottom:10px">在下方每张表上即可操作：勾选「放仪表盘」让它出现在首页仪表盘（可多张）；点「设为默认仪表盘」一键将其设为默认（无任何表勾选「放仪表盘」时，仪表盘显示默认表）。「编辑当前表」可改指标卡/图表/过滤。</div>
  <div class="sb-manage">${list}</div>
  <div id="sbBody"><div class="empty noicon"><span class="spinner"></span>加载中…</div></div>`;
  // 切换查看某张表
  $$('.sb-pick', c).forEach(b => b.onclick = () => { S.activeBoardId = b.dataset.id; renderStatBoard(c, S.statBoards.find(x => x.id === b.dataset.id)); });
  // 放仪表盘（可多张）
  $$('[data-dash]', c).forEach(ch => ch.onchange = async () => {
    await api('PATCH', `/api/projects/${S.projectId}/statboards/${ch.dataset.dash}`, { onDashboard: ch.checked }).catch(() => {});
    const b = S.statBoards.find(x => x.id === ch.dataset.dash); if (b) b.onDashboard = ch.checked;
    renderStatBoard(c, board);
  });
  // 一键设为默认仪表盘
  $$('[data-def]', c).forEach(b => b.onclick = async () => {
    await api('PATCH', `/api/projects/${S.projectId}/statboards/${b.dataset.def}`, { isDefault: true, onDashboard: true }).catch(() => {});
    S.statBoards.forEach(x => { x.isDefault = (x.id === b.dataset.def); if (x.id === b.dataset.def) x.onDashboard = true; });
    toast('已设为默认仪表盘');
    renderStatBoard(c, board);
  });
  // 删除
  $$('[data-del]', c).forEach(b => b.onclick = async () => {
    const t = S.statBoards.find(x => x.id === b.dataset.del);
    if (!confirm(`确认删除统计表「${t ? t.name : ''}」？`)) return;
    await api('DELETE', `/api/projects/${S.projectId}/statboards/${b.dataset.del}`).catch(() => {});
    S.statBoards = S.statBoards.filter(x => x.id !== b.dataset.del);
    if (!S.statBoards.length) { c.innerHTML = `<div class="empty">暂无统计表，点击右上角「+ 新建」开始。</div>`; return; }
    S.activeBoardId = S.statBoards[0].id;
    renderStatBoard(c, S.statBoards[0]);
  });
  $('#sbNew', c).onclick = () => openBoardModal(null);
  $('#sbEdit', c).onclick = () => openBoardModal(board);
  loadStatBoardBody($('#sbBody', c), board);
}
async function loadStatBoardBody(el, board) {
  el.innerHTML = `<div class="empty noicon"><span class="spinner"></span>加载中…</div>`;
  const q = new URLSearchParams(Object.assign({ projectId: S.projectId }, board.filters || {}));
  const d = await api('GET', `/api/projects/${S.projectId}/dashboard?` + q.toString()).catch(() => null);
  if (!d) { el.innerHTML = `<div class="empty">暂无数据</div>`; return; }
  const sc = d.scorecard;
  const KPI = {
    total: sc.total, open: sc.open, closed: sc.closed, overdue: sc.overdue,
    closureRate: pct(sc.closureRate), majorIssueRate: pct(sc.majorIssueRate),
    firstPassRate: pct(sc.firstPassRate), onTimeRate: pct(sc.onTimeRate),
  };
  const tiles = (board.tiles && board.tiles.length) ? board.tiles : ['total', 'open', 'closed', 'overdue'];
  const kpis = tiles.map(k => { const def = TILE_DEFS.find(t => t.key === k); return kpi(k, KPI[k], def ? def.label : k); }).join('');
  const sevData = Object.entries(d.severity).map(([k, v]) => ({ k: k + ' ' + (S.C.SEVERITY_LABEL[k] || ''), v, c: sevColor(k) }));
  const disData = Object.entries(d.discipline).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ k, v }));
  const flrData = Object.entries(d.floor).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ k, v }));
  const orgData = d.responsibility.slice(0, 8).map(x => ({ k: x.orgName, v: x.total }));
  const charts = board.charts || [];
  const chartCard = (icon, title, body) => `<div class="card pad chart-card"><div class="chart-title">${ICONS[icon] || ICONS.statboards}<span>${esc(title)}</span></div>${body}</div>`;
  let html = `<div class="kpis">${kpis}</div>`;
  if (charts.length) {
    html += `<div class="grid2">`;
    if (charts.includes('trend')) html += chartCard('trending', '问题趋势（近14天）', lineChart(d.trend));
    if (charts.includes('severity')) html += chartCard('alertTriangle', '严重度分布', bars(sevData));
    if (charts.includes('discipline')) html += chartCard('projects', '专业分布 Top8', bars(disData, PALETTE));
    if (charts.includes('floor')) html += chartCard('building', '区域/楼层分布', bars(flrData, PALETTE));
    if (charts.includes('responsibility')) html += chartCard('accounts', '责任单位排名', bars(orgData, PALETTE));
    html += `</div>`;
  }
  el.innerHTML = html;
  $$('#sbBody .kpi').forEach(el2 => el2.onclick = () => drillToIssues(Object.assign({}, board.filters || {}, KPI_FILTERS[el2.dataset.kpi] || {})));
}
function openBoardModal(board) {
  const isEdit = !!board;
  const f = board ? (board.filters || {}) : {};
  const tiles = board ? (board.tiles || []) : ['total', 'open', 'closed', 'overdue'];
  const charts = board ? (board.charts || []) : ['trend', 'severity', 'discipline', 'floor', 'responsibility'];
  const tileChecks = TILE_DEFS.map(t => `<label class="chk"><input type="checkbox" data-tile="${t.key}" ${tiles.includes(t.key) ? 'checked' : ''}> ${esc(t.label)}</label>`).join('');
  const chartChecks = CHART_DEFS.map(c => `<label class="chk"><input type="checkbox" data-chart="${c.key}" ${charts.includes(c.key) ? 'checked' : ''}> ${esc(c.label)}</label>`).join('');
  const m = modal(`<header><h3>${isEdit ? '编辑统计表' : '新建统计表'}</h3><div class="spacer"></div><button class="btn ghost sm" id="x">关闭</button></header>
  <div class="body">
    <label>名称</label><input id="bname" value="${esc(isEdit ? board.name : '')}">
    <label class="chk" style="margin:8px 0"><input type="checkbox" id="bdef" ${isEdit && board.isDefault ? 'checked' : ''}> 设为默认统计表</label>
    <label class="chk" style="margin:8px 0"><input type="checkbox" id="bdash" ${isEdit && board.onDashboard ? 'checked' : ''}> 生成到仪表盘（在首页显示）</label>
    <h4 style="margin:14px 0 6px">过滤条件（留空 = 统计全部）</h4>
    <div class="filters card pad">
      <div class="f"><label>专业</label><select id="bdis"><option value="">全部</option>${S.disciplines.map(d => `<option ${f.discipline === d.name ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div>
      <div class="f"><label>楼层</label><select id="bfl"><option value="">全部</option>${S.floors.map(fl => `<option value="${fl.id}" ${f.floorId === fl.id ? 'selected' : ''}>${esc(fl.name)}</option>`).join('')}</select></div>
      <div class="f"><label>严重度</label><select id="bsev"><option value="">全部</option>${S.C.SEVERITY_ORDER.map(s => `<option value="${s}" ${f.severity === s ? 'selected' : ''}>${s} ${esc(S.C.SEVERITY_LABEL[s])}</option>`).join('')}</select></div>
      <div class="f"><label>状态</label><select id="bst"><option value="">全部</option>${Object.entries(S.C.ISSUE_STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
      <div class="f" style="flex:0"><label>仅超期</label><div><input type="checkbox" id="bod" ${f.overdue ? 'checked' : ''} style="width:auto;margin-top:10px"></div></div>
    </div>
    <h4 style="margin:14px 0 6px">显示指标卡</h4><div class="chk-grid">${tileChecks}</div>
    <h4 style="margin:14px 0 6px">显示图表</h4><div class="chk-grid">${chartChecks}</div>
  </div>
  <footer><button class="btn" id="save">${isEdit ? '保存' : '创建'}</button></footer>`, true);
  $('#x', m).onclick = () => m.remove();
  $('#save', m).onclick = async () => {
    const filters = {};
    const dis = $('#bdis', m).value; if (dis) filters.discipline = dis;
    const fl = $('#bfl', m).value; if (fl) filters.floorId = fl;
    const sev = $('#bsev', m).value; if (sev) filters.severity = sev;
    const st = $('#bst', m).value; if (st) filters.status = st;
    if ($('#bod', m).checked) filters.overdue = true;
    const tl = $$('[data-tile]', m).filter(x => x.checked).map(x => x.dataset.tile);
    const ch = $$('[data-chart]', m).filter(x => x.checked).map(x => x.dataset.chart);
    const body = { name: $('#bname', m).value.trim() || '未命名统计表', isDefault: $('#bdef', m).checked, onDashboard: $('#bdash', m).checked, filters, tiles: tl, charts: ch };
    try {
      if (isEdit) { await api('PATCH', `/api/projects/${S.projectId}/statboards/${board.id}`, body); toast('已保存'); }
      else { await api('POST', `/api/projects/${S.projectId}/statboards`, body); toast('已创建'); }
      m.remove();
      const r = await api('GET', `/api/projects/${S.projectId}/statboards`);
      S.statBoards = r.statBoards || [];
      if (!isEdit && S.statBoards.length) S.activeBoardId = S.statBoards[S.statBoards.length - 1].id;
      go('statboards');
    } catch (e) { toast(e.message); }
  };
}

// ---------- 手机扫码只读分享视图（免登录） ----------
async function viewShareIssue(token) {
  const root = $('#root');
  root.innerHTML = `<div class="login-wrap"><div class="empty noicon" style="color:#cbd5e1"><span class="spinner" style="border-top-color:#fff"></span>加载中…</div></div>`;
  try {
    const r = await fetch('/api/share/issue/' + encodeURIComponent(token));
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { root.innerHTML = `<div class="login-wrap"><div class="login-card plain"><h2>分享链接不可用</h2><div class="sub">${esc(data.error || '链接无效或已失效')}</div></div></div>`; return; }
    const i = data.issue || {};
    root.innerHTML = `
    <div class="login-wrap"><div class="login-card plain" style="text-align:left;max-width:600px;width:100%">
      <div class="sub" style="margin-bottom:8px">问题分享查看（只读）</div>
      <h2 style="font-size:18px;margin-bottom:6px">${esc(i.issueNo || '')}</h2>
      <div style="font-weight:700;font-size:16px;margin-bottom:6px">${esc(i.title || '')}</div>
      <p class="muted">${esc(i.description || '无描述')}</p>
      <div class="row">
        <div class="col"><div class="muted" style="font-size:12px">专业</div><b>${esc(i.disciplineName || '-')}</b></div>
        <div class="col"><div class="muted" style="font-size:12px">楼层/区域</div><b>${esc(i.floorName || '-')}/${esc(i.zoneName || '-')}</b></div>
        <div class="col"><div class="muted" style="font-size:12px">位置</div><b>${esc(i.positionName || '-')}</b></div>
        <div class="col"><div class="muted" style="font-size:12px">严重度</div><b>${esc(i.severity || '-')} ${esc(data.severityLabel || '')}</b></div>
      </div>
      <div class="row" style="margin-top:8px">
        <div class="col"><div class="muted" style="font-size:12px">责任单位</div><b>${esc(i.responsibleOrgName || '未指派')}</b></div>
        <div class="col"><div class="muted" style="font-size:12px">状态</div><b>${esc(data.statusLabel || '')}</b></div>
        <div class="col"><div class="muted" style="font-size:12px">计划完成</div><b>${fmt(i.rectificationDeadline)}</b></div>
        <div class="col"><div class="muted" style="font-size:12px">检查批次</div><b>${esc(i.batchName || '-')}</b></div>
      </div>
      <div style="margin-top:10px"><div class="muted" style="font-size:12px">发现照片</div>${photosBlock(data.photoUrls || [])}</div>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0">
      <h3 style="margin-bottom:8px">整改与复查记录</h3>
      <div class="timeline">${timeline([], data.rectifications || [], data.reinspections || [])}</div>
    </div></div>`;
  } catch (e) {
    root.innerHTML = `<div class="login-wrap"><div class="login-card plain"><h2>加载失败</h2><div class="sub">${esc(e.message)}</div></div></div>`;
  }
}

// ============ 房源管理 (V1.7) ============
async function viewRooms(c) {
  if (!hasPerm('merchant_view')) { c.innerHTML = `<div class="card pad center muted">暂无「查看商户资料」权限，请联系管理员。</div>`; return; }
  c.innerHTML = `<div class="center pad"><span class="spinner"></span> 加载中…</div>`;
  const [roomsR, merchR] = await Promise.all([
    api('GET', `/api/projects/${S.projectId}/rooms`).catch(() => ({ rooms: [] })),
    api('GET', '/api/merchants').catch(() => ({ merchants: [] })),
  ]);
  const all = roomsR.rooms || [];
  const merchants = (merchR.merchants || []).filter((m) => !S.projectId || m.projectId === S.projectId);
  const merchById = Object.fromEntries(merchants.map((m) => [m.id, m]));
  const S_FILTERS = S.filters.r || (S.filters.r = { building: '', category: '', roomNo: '' });
  const f = S_FILTERS;
  const list = all.filter((r) =>
    (!f.building || r.building === f.building) &&
    (!f.category || r.category === f.category) &&
    (!f.roomNo || String(r.roomNo).includes(f.roomNo))
  );
  // 分组：building -> floor
  const byBuilding = {};
  list.forEach((r) => { (byBuilding[r.building] ||= {}); (byBuilding[r.building][r.floor || '—'] ||= []).push(r); });
  const buildings = Object.keys(byBuilding).sort();
  // 统计
  const totalRooms = list.length;
  const totalBuildings = buildings.length;
  const totalArea = list.reduce((s, r) => s + (Number(r.area) || 0), 0);
  // 楼号选项（来自全部房源，不受筛选影响）
  const allBuildings = [...new Set(all.map((r) => r.building).filter(Boolean))].sort();
  // 已选 building 优先排在最前
  const bOpts = [`<option value="">全部楼栋</option>`, ...allBuildings.map((b) => `<option value="${esc(b)}" ${f.building === b ? 'selected' : ''}>${esc(b)}</option>`)].join('');

  c.innerHTML = `
  <div class="rooms-head">
    <div class="crumbs"><span class="muted">基础信息</span> <span class="sep">/</span> <b>房源管理</b> <span class="sep">/</span> <b>房源管理</b></div>
    <div class="spacer"></div>
  </div>
  <div class="rooms-filters card pad">
    <div class="row">
      <div class="f" style="min-width:140px"><label>项目业态</label><select id="rCat"><option value="">全部业态</option>${(S.C.BIZ_CATEGORIES || []).map((x) => `<option ${f.category === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
      <div class="f" style="min-width:140px"><label>楼号</label><select id="rBuilding">${bOpts}</select></div>
      <div class="f" style="min-width:140px"><label>房号</label><input id="rRoom" placeholder="如 A1 / B2" value="${esc(f.roomNo)}"></div>
      <div class="f" style="flex:0 0 auto"><button class="btn" id="rQ">${ICONS.search}<span>查询</span></button></div>
      <div class="f" style="flex:0 0 auto"><button class="btn sec" id="rAdd">${ICONS.plus}<span>添加房源</span></button></div>
      <div class="f" style="flex:0 0 auto"><button class="btn ghost" id="rTpl">下载模板</button></div>
      <div class="f" style="flex:0 0 auto"><button class="btn ghost" id="rImp">批量导入</button></div>
      <div class="f" style="flex:0 0 auto"><button class="btn ghost" id="rExp">导出房源</button></div>
    </div>
  </div>
  <div class="rooms-stats">
    <div class="rs-card"><span class="rs-ic c1">${ICONS.building}</span><div><b>${totalBuildings}</b><small>楼栋数</small></div></div>
    <div class="rs-card"><span class="rs-ic c2">${ICONS.layers}</span><div><b>${totalRooms}</b><small>房源数</small></div></div>
    <div class="rs-card"><span class="rs-ic c3">${ICONS.fileWord}</span><div><b>${totalArea.toFixed(2)}</b><small>总面积（㎡）</small></div></div>
  </div>
  ${totalRooms ? `<div class="rooms-list">${buildings.map((b) => {
    const floors = byBuilding[b];
    const floorKeys = Object.keys(floors).sort((a, bk) => { const na = parseFloat(a), nb = parseFloat(bk); if (!isNaN(na) && !isNaN(nb)) return na - nb; if (!isNaN(na)) return -1; if (!isNaN(nb)) return 1; return String(a).localeCompare(String(bk), 'zh-CN'); });
    const bCount = floorKeys.reduce((s, k) => s + floors[k].length, 0);
    return `<div class="building" data-building="${esc(b)}">
      <div class="building-hd" title="双击楼栋名可改名">
        <span class="bh-name" data-rename="${esc(b)}">${esc(b)}</span>
        <span class="bh-edit-ic" title="双击楼栋名可改名">${ICONS.edit}</span>
        <span class="bh-count">${bCount} 间</span>
      </div>
      <div class="building-bd">${floorKeys.map((fk) => `<div class="floor-row" data-floor="${esc(fk)}">
        <button class="floor-toggle" type="button" title="点击折叠/展开 ${esc(fk)}层">
          <span class="floor-label">${esc(fk)}层</span>
          <span class="floor-count">${floors[fk].length} 间</span>
          <span class="floor-toggle-ic">${ICONS.chevronDown}</span>
        </button>
        <div class="floor-rooms">${floors[fk].map((r) => {
          const m = r.merchantId ? merchById[r.merchantId] : null;
          const mName = m ? m.name : '';
          return `<div class="room-chip card hoverable" data-id="${r.id}">
            <div class="rc-name">${esc(r.roomNo)}</div>
            <div class="rc-meta">${r.category ? `<span class="cat-tag">${esc(r.category)}</span>` : ''}${r.area ? `<span class="muted" style="font-size:11px">${Number(r.area).toFixed(1)}㎡</span>` : ''}</div>
            ${mName ? `<div class="rc-merchant" title="${esc(mName)}">${ICONS.merchants}<span>${esc(mName)}</span><button class="rc-x" data-unbind="${r.id}" title="解除配对">${ICONS.x}</button></div>` : `<div class="rc-merchant empty"><button class="link rc-bind" data-bind="${r.id}">+ 配对商户</button></div>`}
            <div class="rc-ops">
              <button class="link rc-edit" data-edit="${r.id}">编辑</button>
              <button class="link rc-del" data-del="${r.id}" style="color:var(--red-tx)">删除</button>
            </div>
          </div>`;
        }).join('')}</div>
      </div></div>`).join('')}</div>
    </div>`;
  }).join('')}</div>` : `<div class="card pad center" style="padding:50px 18px">
    <div class="empty-ic">${ICONS.building}</div>
    <b>${all.length ? '没有符合条件的房源' : '还没有房源'}</b>
    <div class="muted" style="font-size:12.5px;margin-top:6px;line-height:1.8">${all.length ? '请调整筛选条件，或' : '点击右上角「添加房源」开始建档；也可「下载模板」→ 批量导入。'}<br>房号可与「商户资料」按业态/铺位配对，进度与告警自动汇总。</div>
    ${all.length ? '' : (hasPerm('merchant_manage') ? `<button class="btn sm" id="rAdd2" style="margin-top:14px">＋ 添加第一个房源</button>` : '')}
  </div>`}`;

  // 事件
  const doQuery = () => { f.building = $('#rBuilding', c).value; f.category = $('#rCat', c).value; f.roomNo = $('#rRoom', c).value.trim(); viewRooms(c); };
  if ($('#rQ', c)) $('#rQ', c).onclick = doQuery;
  if ($('#rBuilding', c)) $('#rBuilding', c).onchange = doQuery;
  if ($('#rCat', c)) $('#rCat', c).onchange = doQuery;
  if ($('#rRoom', c)) $('#rRoom', c).onkeydown = (e) => { if (e.key === 'Enter') doQuery(); };
  if ($('#rAdd', c)) $('#rAdd', c).onclick = () => roomForm(null, merchants, () => viewRooms(c));
  if ($('#rAdd2', c)) $('#rAdd2', c).onclick = () => roomForm(null, merchants, () => viewRooms(c));
  if ($('#rTpl', c)) $('#rTpl', c).onclick = () => downloadFile(`/api/projects/${S.projectId}/rooms/template`, 'rooms-template.csv');
  if ($('#rExp', c)) $('#rExp', c).onclick = () => downloadFile(`/api/projects/${S.projectId}/rooms/export`, 'rooms.csv');
  if ($('#rImp', c)) $('#rImp', c).onclick = () => roomImportDialog(merchants, () => viewRooms(c));
  $$('.rc-edit', c).forEach((b) => b.onclick = () => roomForm(all.find((r) => r.id === b.dataset.edit), merchants, () => viewRooms(c)));
  $$('.rc-del', c).forEach((b) => b.onclick = () => {
    const r = all.find((x) => x.id === b.dataset.del);
    confirmDlg(`确定删除「${r.building} ${r.floor} ${r.roomNo}」房源？此操作不可恢复。`, async () => {
      try { await api('DELETE', `/api/rooms/${r.id}`); toast('已删除'); viewRooms(c); } catch (e) { toast(e.message, 'err'); }
    }, '删除');
  });
  $$('.rc-bind', c).forEach((b) => b.onclick = () => roomBindDialog(b.dataset.bind, merchants, () => viewRooms(c)));
  $$('.rc-x', c).forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const r = all.find((x) => x.id === b.dataset.unbind);
    if (!r) return;
    confirmDlg(`确定解除「${r.building} ${r.roomNo}」与商户的配对？`, async () => {
      try { await api('PATCH', `/api/rooms/${r.id}`, { merchantId: null }); toast('已解除配对'); viewRooms(c); } catch (e) { toast(e.message, 'err'); }
    }, '解除配对');
  });
  // 楼栋名双击改名
  $$('.bh-name', c).forEach((nm) => {
    nm.addEventListener('dblclick', (e) => { e.stopPropagation(); startBuildingRename(nm, c); });
  });
  // 楼层折叠/展开（点击 .floor-toggle 按钮切换 floor-row 的折叠态）
  $$('.floor-toggle', c).forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const row = btn.closest('.floor-row');
      if (row) row.classList.toggle('collapsed');
    });
  });
  // 修正 DOM 结构：浏览器 HTML parser 在复杂 chip 模板下有时会把后续 .floor-row 提升到 .building 直接子位置（left 偏离 18px），强制归位到 .building-bd
  $$('.building', c).forEach((b) => {
    const bd = b.querySelector(':scope > .building-bd');
    if (!bd) return;
    [...b.querySelectorAll(':scope > .floor-row')].forEach((r) => bd.appendChild(r));
  });
}
function downloadFile(url, name) {
  fetch(url, { headers: { Authorization: 'Bearer ' + (S.token || '') } })
    .then((r) => { if (!r.ok) throw new Error('下载失败'); return r.blob(); })
    .then((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500); toast('已下载：' + name); })
    .catch((e) => toast(e.message, 'err'));
}
function roomForm(r, merchants, refresh) {
  const isEdit = !!r;
  const m = r || { building: '', floor: '', roomNo: '', area: '', category: '', merchantId: null, note: '' };
  const merchantOptions = [`<option value="">未配对</option>`, ...merchants.map((x) => `<option value="${x.id}" ${m.merchantId === x.id ? 'selected' : ''}>${esc(x.name)}（${esc(x.category || '')}）</option>`)].join('');
  const md = modal(`<header><h3>${isEdit ? '编辑房源' : '添加房源'}</h3><button class="btn ghost sm" style="margin-left:auto" data-close>${ICONS.x}</button></header>
    <div class="body">
      <div class="row">
        <div class="col"><label>楼栋 *</label><input id="rbB" value="${esc(m.building)}" placeholder="如：01号楼"></div>
        <div class="col"><label>楼层</label><input id="rbF" value="${esc(m.floor)}" placeholder="如：B1 / 1 / 2"></div>
      </div>
      <div class="row">
        <div class="col"><label>房号 *</label><input id="rbN" value="${esc(m.roomNo)}" placeholder="如：A1 / B2-1"></div>
        <div class="col"><label>面积（㎡）</label><input id="rbA" value="${esc(m.area || '')}" placeholder="如：86.5"></div>
      </div>
      <div class="row">
        <div class="col"><label>业态</label><select id="rbC"><option value="">不指定</option>${(S.C.BIZ_CATEGORIES || []).map((x) => `<option ${m.category === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
        <div class="col"><label>配对商户</label><select id="rbM">${merchantOptions}</select></div>
      </div>
      <label>备注</label><input id="rbNote" value="${esc(m.note || '')}" placeholder="选填">
    </div>
    <footer><button class="btn ghost" data-close>取消</button><button class="btn" id="rbSave">${isEdit ? '保存' : '添加'}</button></footer>`, true);
  md.querySelectorAll('[data-close]').forEach((el) => el.onclick = () => closeModal(md));
  $('#rbSave', md).onclick = async () => {
    const body = { building: $('#rbB', md).value.trim(), floor: $('#rbF', md).value.trim(), roomNo: $('#rbN', md).value.trim(), area: Number($('#rbA', md).value) || 0, category: $('#rbC', md).value, merchantId: $('#rbM', md).value || null, note: $('#rbNote', md).value.trim() };
    if (!body.building) return toast('请填写楼栋', 'err');
    if (!body.roomNo) return toast('请填写房号', 'err');
    try {
      if (isEdit) await api('PATCH', `/api/rooms/${r.id}`, body); else await api('POST', `/api/projects/${S.projectId}/rooms`, body);
      closeModal(md); toast('已保存'); refresh();
    } catch (e) { toast(e.message, 'err'); }
  };
}
function roomBindDialog(roomId, merchants, refresh) {
  const md = modal(`<header><h3>配对商户</h3><button class="btn ghost sm" style="margin-left:auto" data-close>${ICONS.x}</button></header>
    <div class="body">
      <label>选择商户</label>
      <select id="bdSel" style="height:38px"><option value="">未配对</option>${merchants.map((x) => `<option value="${x.id}">${esc(x.name)}（${esc(x.category || '')}${x.shopNo ? ' · ' + esc(x.shopNo) : ''}）</option>`).join('')}</select>
      <div class="muted" style="font-size:11.5px;margin-top:10px;line-height:1.7">${ICONS.alertTriangle} 一个商户同时只能配对一个房号；如该商户已配对其它房号，会被自动解绑。</div>
    </div>
    <footer><button class="btn ghost" data-close>取消</button><button class="btn" id="bdOk">确定</button></footer>`, true);
  md.querySelectorAll('[data-close]').forEach((el) => el.onclick = () => closeModal(md));
  $('#bdOk', md).onclick = async () => {
    const v = $('#bdSel', md).value || null;
    try { await api('PATCH', `/api/rooms/${roomId}`, { merchantId: v }); closeModal(md); toast('已配对'); refresh(); }
    catch (e) { toast(e.message, 'err'); }
  };
}
function startBuildingRename(nm, c) {
  if (nm.classList.contains('editing')) return;
  if (!hasPerm('merchant_manage')) return toast('请联系管理员或检查权限', 'err');
  const oldName = nm.dataset.rename;
  // 记下原始文本宽度，避免变成 input 后塌缩
  const w = Math.max(160, nm.offsetWidth + 40);
  nm.classList.add('editing');
  nm.innerHTML = `<input class="bh-name-edit" value="${esc(oldName)}" style="width:${w}px" maxlength="40">`;
  const inp = nm.querySelector('.bh-name-edit');
  setTimeout(() => { inp.focus(); inp.select(); }, 20);
  const finish = async (save) => {
    const v = inp.value.trim();
    nm.classList.remove('editing');
    if (!save || !v || v === oldName) { nm.textContent = oldName; return; }
    try {
      const r = await api('PATCH', `/api/projects/${S.projectId}/buildings/rename`, { oldName, newName: v });
      toast(`已更新 ${r.count} 个房号的楼栋名`);
      viewRooms(c);
    } catch (e) { toast(e.message, 'err'); nm.textContent = oldName; }
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    e.stopPropagation();
  });
  inp.addEventListener('click', (e) => e.stopPropagation());
  inp.addEventListener('blur', () => finish(true));
}
function roomImportDialog(merchants, refresh) {
  const md = modal(`<header><h3>批量导入房源</h3><button class="btn ghost sm" style="margin-left:auto" data-close>${ICONS.x}</button></header>
    <div class="body">
      <div class="muted" style="font-size:12.5px;line-height:1.8;margin-bottom:10px">支持 <b>Excel（.xlsx）</b> 或 <b>CSV（UTF-8 with BOM）</b>。列顺序：<b>楼栋, 楼层, 房号, 面积, 业态, 备注</b>（楼栋/房号必填，业态须与「系统设置·商户资料」一致）。<br>可先 <a class="link" id="dlTpl" style="cursor:pointer">下载模板</a> 填好后上传。</div>
      <label>选择 Excel / CSV 文件</label>
      <input type="file" id="impFile" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="height:auto;padding:8px">
    </div>
    <footer><button class="btn ghost" data-close>取消</button><button class="btn" id="impOk">开始导入</button></footer>`, true);
  md.querySelectorAll('[data-close]').forEach((el) => el.onclick = () => closeModal(md));
  $('#dlTpl', md).onclick = (e) => { e.preventDefault(); downloadFile(`/api/projects/${S.projectId}/rooms/template`, 'rooms-template.csv'); };
  $('#impOk', md).onclick = async () => {
    const f = $('#impFile', md).files[0]; if (!f) return toast('请先选择文件', 'err');
    const btn = $('#impOk', md); btn.classList.add('loading'); btn.disabled = true;
    try {
      const isXlsx = /\.xlsx$/i.test(f.name);
      if (isXlsx && f.size > 10 * 1024 * 1024) return toast('Excel 文件不能超过 10MB', 'err');
      let body;
      if (isXlsx) {
        const ab = await f.arrayBuffer();
        const bytes = new Uint8Array(ab);
        let bin = ''; const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        body = { xlsx: btoa(bin) };
      } else {
        body = { csv: await f.text() };
      }
      const r = await api('POST', `/api/projects/${S.projectId}/rooms/import`, body);
      toast(`已导入 ${r.added} 条${r.skipped ? `（跳过 ${r.skipped}）` : ''}`);
      closeModal(md); refresh();
    } catch (e) { toast(e.message, 'err'); }
    finally { btn.classList.remove('loading'); btn.disabled = false; }
  };
}

// ============ 商户进场资料库 (V1.5) ============
function hasPerm(k) {
  const u = S.user || {};
  if (u.role === '超级管理员') return true;
  return (u.permissions || []).includes(k);
}
function mStatusColor(st) {
  return { DRAFT: '#64748b', COLLECTING: '#2563eb', REVIEWING: '#ea580c', COMPLETED: '#16a34a' }[st] || '#94a3b8';
}
function dStatusColor(st) {
  return { MISSING: '#94a3b8', SUBMITTED: '#2563eb', VERIFIED: '#16a34a', REJECTED: '#dc2626' }[st] || '#94a3b8';
}
function ringSvg(pct, size) {
  const p = Math.max(0, Math.min(1, pct || 0));
  const color = p >= 1 ? '#16a34a' : p >= 0.6 ? '#2563eb' : p >= 0.3 ? '#ea580c' : '#dc2626';
  const r = (size - 10) / 2, c = 2 * Math.PI * r;
  const off = c * (1 - p);
  return `<svg class="m-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#eef2f7" stroke-width="6"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"
      stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="50%" dy=".36em" text-anchor="middle" font-size="${Math.round(size * 0.24)}" font-weight="800" fill="${color}">${Math.round(p * 100)}%</text>
  </svg>`;
}
function mBadge(st) { return `<span class="bm bm-${esc(st)}">${esc(S.C.MERCHANT_STATUS_LABEL[st] || st)}</span>`; }
function dBadge(st) { return `<span class="bd bd-${esc(st)}">${esc(S.C.DOC_STATUS_LABEL[st] || st)}</span>`; }
function catTag(cat) { return `<span class="cat-tag">${esc(cat || '其他')}</span>`; }

async function viewMerchants(c) {
  if (!hasPerm('merchant_view')) { c.innerHTML = `<div class="card pad center muted">暂无「查看商户资料」权限，请联系管理员。</div>`; return; }
  if (S.params.id) return renderMerchantDetail(c, S.params.id);
  return renderMerchantList(c);
}

async function renderMerchantList(c) {
  c.innerHTML = `<div class="center pad"><span class="spinner"></span> 加载中…</div>`;
  let merchants = [], sum = {};
  try {
    const [lr, sr] = await Promise.all([
      api('GET', '/api/merchants'),
      api('GET', '/api/merchant-summary'),
    ]);
    merchants = lr.merchants || []; sum = sr.summary || {};
  } catch (e) { c.innerHTML = `<div class="card pad center muted">${esc(e.message)}</div>`; return; }
  const can = hasPerm('merchant_manage');
  const f = S.filters.m || (S.filters.m = { cat: '', status: '', kw: '', floor: '' });

  // 本地过滤
  const list = merchants.filter((m) =>
    (!f.cat || m.category === f.cat) &&
    (!f.status || m.status === f.status) &&
    (!f.floor || (f.floor === 'none' ? !m.floorId : m.floorId === f.floor)) &&
    (!f.kw || `${m.name}${m.brand || ''}${m.shopNo || ''}`.includes(f.kw))
  );
  // 临期证件按商户聚合
  const expByMerchant = {};
  (sum.expiredSoon || []).forEach((e) => { (expByMerchant[e.merchantId] = expByMerchant[e.merchantId] || []).push(e); });
  const maxCat = Math.max(1, ...(sum.byCategory || []).map((x) => x.avgRate));

  c.innerHTML = `
  <div class="merch-head">
    <h2>商户进场资料库</h2>
    <div class="spacer"></div>
    ${can ? `<button class="btn sm" id="mAdd">＋ 新增商户</button>
    <button class="btn ghost sm" id="mTypes">资料类型</button>` : ''}
  </div>
  <div class="kpis">
    ${kpiStatic('total', sum.total || 0, '商户总数', '#2563eb')}
    ${kpiStatic('closureRate', Math.round((sum.completeRate || 0) * 100) + '%', '资料完整率', '#16a34a')}
    ${kpiStatic('onTimeRate', sum.pendingVerify || 0, '待核验资料', '#ea580c')}
    ${kpiStatic('overdue', sum.expiredSoonCount || 0, '临期证件', '#dc2626', !!sum.expiredSoonCount)}
  </div>
  ${(sum.expiredSoon || []).length ? `<div class="warn-strip">${ICONS.alertTriangle}<b>证件临期提醒：</b>${(sum.expiredSoon || []).slice(0, 4).map((e) =>
    `<span class="exp-item">「${esc(e.merchantName)}」${esc(e.docName)} ${e.daysLeft < 0 ? '已过期' : e.daysLeft + ' 天后到期'}</span>`).join('<span style="opacity:.5">|</span>')}</div>` : ''}
  <div class="card pad" style="margin-bottom:16px">
    <div style="font-weight:800;font-size:14px;margin-bottom:10px">业态分布 · 平均资料进度</div>
    ${(sum.byCategory || []).length ? `<div class="cat-bars">${(sum.byCategory || []).map((x, i) => `
      <div class="cb-row"><span class="cb-name">${esc(x.name)}</span>
      <div class="cb-track"><div class="cb-fill" style="width:${Math.max(3, (x.avgRate / maxCat) * 100)}%;background:${PALETTE[i % PALETTE.length]}"></div></div>
      <span class="cb-val">${x.count} 户 · ${x.avgRate}%</span></div>`).join('')}</div>`
    : `<div class="muted" style="font-size:12px">暂无商户，先点击右上角「新增商户」建档吧。</div>`}
  </div>
  <div class="filters">
    <div class="f"><label>楼层</label><select id="fFl"><option value="">全部楼层</option><option value="none" ${f.floor === 'none' ? 'selected' : ''}>未指定楼层</option>${(S.floors || []).map((fl) => `<option value="${fl.id}" ${f.floor === fl.id ? 'selected' : ''}>${esc(fl.name)}</option>`).join('')}</select></div>
    <div class="f"><label>业态</label><select id="fCat"><option value="">全部业态</option>${(S.C.BIZ_CATEGORIES || []).map((x) => `<option ${f.cat === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
    <div class="f"><label>状态</label><select id="fSt"><option value="">全部状态</option>${Object.keys(S.C.MERCHANT_STATUS_LABEL || {}).map((k) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${esc(S.C.MERCHANT_STATUS_LABEL[k])}</option>`).join('')}</select></div>
    <div class="f" style="min-width:180px"><label>搜索</label><input id="fKw" placeholder="名称 / 品牌 / 铺位号" value="${esc(f.kw)}"></div>
  </div>
  <div class="muted" style="font-size:12px;margin:-6px 2px 12px">共 ${list.length} 户${(f.floor || f.cat || f.status || f.kw) ? '（已按筛选条件过滤）' : ''}</div>
  ${list.length ? `<div class="mgrid">${list.map((m) => {
    const p = m.progress || { verified: 0, total: 0, rate: 0 };
    const exps = expByMerchant[m.id] || [];
    return `<div class="mcard card" style="--mc:${mStatusColor(m.status)}" data-id="${m.id}">
      <div class="mcard-top">
        ${ringSvg(p.rate, 64)}
        <div style="flex:1;min-width:0">
          <div class="m-name">${esc(m.name)} ${catTag(m.category)}</div>
          <div class="m-shop">${esc(m.shopNo || '—')}${m.floorName ? ' · ' + esc(m.floorName) : ''}</div>
          <div class="m-tags">${mBadge(m.status)}${exps.length ? `<span class="bd bd-REJECTED" style="margin-left:auto">${ICONS.alertTriangle} ${exps.length} 项临期</span>` : ''}</div>
        </div>
      </div>
      <div class="m-prog">
        <div class="row1"><span>必传资料 ${p.verified}/${p.total} 已通过</span><span style="color:${dStatusColor('REJECTED')}">${m.rejectedCount ? m.rejectedCount + ' 项驳回' : ''}</span></div>
        <div class="track"><div class="fill" style="width:${Math.round(p.rate * 100)}%"></div></div>
      </div>
      <div class="m-actions">
        <button class="btn sm" data-open="${m.id}">查看资料</button>
        ${can ? `<button class="btn ghost sm" data-edit="${m.id}">编辑</button>
        <button class="btn ghost sm danger-ghost" data-del="${m.id}" style="margin-left:auto">删除</button>` : ''}
      </div>
    </div>`; }).join('')}</div>`
    : (merchants.length ? `<div class="card pad center" style="padding:40px 18px">
      <div class="empty-ic">${ICONS.search}</div>
      <b>没有符合条件的商户</b>
      <div class="muted" style="font-size:12.5px;margin-top:6px">请调整楼层 / 业态 / 状态 / 关键词筛选条件后重试</div>
      <button class="btn ghost sm" id="mReset" style="margin-top:14px">清空筛选</button>
    </div>` : `<div class="card pad center" style="padding:40px 18px">
      <div class="empty-ic">${ICONS.merchants}</div>
      <b>还没有商户</b>
      <div class="muted" style="font-size:12.5px;margin-top:6px;line-height:1.8">1. 点击「新增商户」建档 → 2. 「开始收集」自动按业态生成资料清单<br>3. 上传证照文件 → 4. 物业核验、驳回补齐 → 全部通过即完成归档</div>
      ${can ? `<button class="btn sm" id="mAdd2" style="margin-top:14px">＋ 新增第一个商户</button>` : ''}
    </div>`)}`;

  if ($('#fKw', c)) $('#fKw', c).oninput = (e) => { f.kw = e.target.value.trim(); renderMerchantList(c); };
  if ($('#fCat', c)) $('#fCat', c).onchange = (e) => { f.cat = e.target.value; renderMerchantList(c); };
  if ($('#fSt', c)) $('#fSt', c).onchange = (e) => { f.status = e.target.value; renderMerchantList(c); };
  if ($('#fFl', c)) $('#fFl', c).onchange = (e) => { f.floor = e.target.value; renderMerchantList(c); };
  if ($('#mReset', c)) $('#mReset', c).onclick = () => { S.filters.m = { cat: '', status: '', kw: '', floor: '' }; renderMerchantList(c); };
  if ($('#mAdd', c)) $('#mAdd', c).onclick = () => merchantForm();
  if ($('#mAdd2', c)) $('#mAdd2', c).onclick = () => merchantForm();
  if ($('#mTypes', c)) $('#mTypes', c).onclick = () => go('docTypes');
  $$('.mcard [data-open]', c).forEach((el) => el.onclick = () => go('merchants', { id: el.dataset.open }));
  $$('.mcard [data-edit]', c).forEach((el) => el.onclick = () => { const m = merchants.find((x) => x.id === el.dataset.edit); if (m) merchantForm(m); });
  $$('.mcard [data-del]', c).forEach((el) => el.onclick = () => {
    const m = merchants.find((x) => x.id === el.dataset.del);
    confirmDlg(`确定删除商户「${m.name}」吗？其全部资料记录将一并删除，此操作不可恢复。`, async () => {
      try { await api('DELETE', `/api/merchants/${m.id}`); toast('已删除'); renderMerchantList(c); }
      catch (e) { toast(e.message, 'err'); }
    }, '删除');
  });
}

function merchantForm(m) {
  const isEdit = !!m;
  const floors = S.floors || [];
  const now = new Date().toISOString().slice(0, 10);
  const modalEl = modal(`<header><h3>${isEdit ? '编辑商户' : '新增商户'}</h3><button class="btn ghost sm" style="margin-left:auto" data-close>✕</button></header>
  <div class="body">
    <div class="row">
      <div class="col"><label>商户名称 *</label><input id="mfName" placeholder="如：苏城家宴" value="${esc(m ? m.name : '')}"></div>
      <div class="col"><label>品牌</label><input id="mfBrand" placeholder="所属品牌" value="${esc(m ? m.brand || '' : '')}"></div>
    </div>
    <div class="row">
      <div class="col"><label>业态 *（决定资料清单）</label><select id="mfCat">${(S.C.BIZ_CATEGORIES || []).map((x) => `<option ${m && m.category === x ? 'selected' : (!m && x === '餐饮' ? 'selected' : '')}>${esc(x)}</option>`).join('')}</select></div>
      <div class="col"><label>铺位号</label><input id="mfShop" placeholder="如：3F-12" value="${esc(m ? m.shopNo || '' : '')}"></div>
    </div>
    <div class="row">
      <div class="col"><label>所在楼层</label><select id="mfFloor"><option value="">未指定</option>${floors.map((x) => `<option value="${x.id}" ${m && m.floorId === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div class="col"><label>计划开业日期</label><input id="mfOpen" type="date" value="${m && m.openDate ? String(m.openDate).slice(0, 10) : ''}"></div>
    </div>
    <div class="row">
      <div class="col"><label>联系人</label><input id="mfContact" value="${esc(m ? m.contactName || '' : '')}"></div>
      <div class="col"><label>联系电话</label><input id="mfPhone" placeholder="手机号" value="${esc(m ? m.contactPhone || '' : '')}"></div>
    </div>
    <div class="row">
      <div class="col"><label>法人/负责人</label><input id="mfLegal" value="${esc(m ? m.legalPerson || '' : '')}"></div>
      <div class="col"><label>进场日期</label><input id="mfEntry" type="date" value="${m && m.entryDate ? String(m.entryDate).slice(0, 10) : now}"></div>
    </div>
    <label>经营范围 / 备注</label><textarea id="mfNotes" rows="2" placeholder="经营内容、特殊要求等">${esc(m ? m.notes || '' : '')}</textarea>
  </div>
  <footer><button class="btn ghost" data-close>取消</button><button class="btn" id="mfSave">${isEdit ? '保存修改' : '创建商户'}</button></footer>`, true);
  modalEl.querySelectorAll('[data-close]').forEach((el) => el.onclick = () => closeModal(modalEl));
  $('#mfSave', modalEl).onclick = async () => {
    const name = $('#mfName', modalEl).value.trim();
    if (!name) return toast('请填写商户名称', 'err');
    const body = {
      name, brand: $('#mfBrand', modalEl).value.trim(), category: $('#mfCat', modalEl).value,
      floorId: $('#mfFloor', modalEl).value || null, shopNo: $('#mfShop', modalEl).value.trim(),
      contactName: $('#mfContact', modalEl).value.trim(), contactPhone: $('#mfPhone', modalEl).value.trim(),
      legalPerson: $('#mfLegal', modalEl).value.trim(), openDate: $('#mfOpen', modalEl).value,
      entryDate: $('#mfEntry', modalEl).value, notes: $('#mfNotes', modalEl).value.trim(),
    };
    const btn = $('#mfSave', modalEl); btn.classList.add('loading'); btn.disabled = true;
    try {
      if (isEdit) await api('PATCH', `/api/merchants/${m.id}`, body);
      else await api('POST', '/api/merchants', body);
      closeModal(modalEl); toast(isEdit ? '已保存' : '已建档，可在详情页「开始收集」生成资料清单');
      renderMerchantList($('#content'));
    } catch (e) { toast(e.message, 'err'); btn.classList.remove('loading'); btn.disabled = false; }
  };
}

// ---------- 商户详情 ----------
async function renderMerchantDetail(c, id) {
  c.innerHTML = `<div class="center pad"><span class="spinner"></span> 加载中…</div>`;
  let merchant, docs;
  try { const r = await api('GET', `/api/merchants/${id}/docs`); merchant = r.merchant; docs = r.docs || []; }
  catch (e) { c.innerHTML = `<div class="card pad center muted">${esc(e.message)}</div>`; return; }
  const can = hasPerm('merchant_manage');
  const p = merchant.progress || { verified: 0, total: 0, rate: 0 };
  const need = docs.filter((d) => d.docType && d.docType.required);
  const needVerified = need.filter((d) => d.status === 'VERIFIED').length;
  const pendingVerify = docs.filter((d) => d.status === 'SUBMITTED').length;
  const rejected = docs.filter((d) => d.status === 'REJECTED');
  const grp = (req) => docs.filter((d) => d.docType && d.docType.required === req);
  const st = merchant.status;
  c._mid = id;

  c.innerHTML = `
  <div class="m-detail-top">
    <button class="back-btn" id="mBack">← 返回列表</button>
    <h2 style="font-size:19px;font-weight:800">${esc(merchant.name)}</h2>
    ${mBadge(st)}
    <div class="spacer"></div>
    ${can ? `<button class="btn ghost sm" id="mEdit">编辑</button>
    <button class="btn ghost sm danger-ghost" id="mDel">删除</button>` : ''}
  </div>

  <div class="card pad" style="margin-bottom:16px">
    <div class="m-summary">
      ${ringSvg(p.rate, 92)}
      <div style="flex:1;min-width:220px">
        <div class="m-info-grid">
          <div class="it"><span class="k">业态</span><span class="v">${catTag(merchant.category)}</span></div>
          <div class="it"><span class="k">铺位 / 楼层</span><span class="v">${esc(merchant.shopNo || '—')} ${merchant.floorName ? '· ' + esc(merchant.floorName) : ''}</span></div>
          <div class="it"><span class="k">联系人</span><span class="v">${esc(merchant.contactName || '—')}${merchant.contactPhone ? ' ' + esc(merchant.contactPhone) : ''}</span></div>
          <div class="it"><span class="k">法人/负责人</span><span class="v">${esc(merchant.legalPerson || '—')}</span></div>
          <div class="it"><span class="k">进场日期</span><span class="v">${esc(merchant.entryDate ? String(merchant.entryDate).slice(0, 10) : '—')}</span></div>
          <div class="it"><span class="k">计划开业</span><span class="v">${esc(merchant.openDate ? String(merchant.openDate).slice(0, 10) : '—')}</span></div>
        </div>
        ${merchant.notes ? `<div class="muted" style="font-size:12px;margin-top:10px">备注：${esc(merchant.notes)}</div>` : ''}
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;text-align:center">
        <div class="big"><b>${needVerified}/${need.length}</b><span>必传已通过</span></div>
        <div class="big"><b style="color:#ea580c">${pendingVerify}</b><span>待核验</span></div>
        <div class="big"><b style="color:${rejected.length ? '#dc2626' : '#16a34a'}">${rejected.length}</b><span>已驳回</span></div>
      </div>
    </div>
    <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
      ${merchantStatusBtns(st, can, docs, needVerified, need.length)}
      ${!docs.length && can ? `<button class="btn sec sm" id="mGenDocs">${ICONS.zap} 一键生成资料清单</button>` : ''}
    </div>
  </div>

  ${docs.length ? `
  <div style="display:flex;align-items:center;gap:10px;margin:6px 0 4px">
    <div class="doc-grp-title" style="margin:0;flex:1">${ICONS.checkCircle} 必传资料（${need.length}）<span class="muted" style="font-weight:500">${needVerified}/${need.length} 已通过</span></div>
    <button class="btn ghost xs" id="mDlAll" title="将该商户全部已上传资料打包为 zip 下载">${ICONS.download} 一键打包下载</button>
  </div>
  ${grp(true).map((d) => docRowHtml(d, can)).join('') || '<div class="muted" style="font-size:12px">无必传项</div>'}
  <div class="doc-grp-title">${ICONS.layers} 选传资料（${docs.length - need.length}）</div>
  ${grp(false).map((d) => docRowHtml(d, can)).join('') || '<div class="muted" style="font-size:12px">无选传项</div>'}
  <div class="muted" style="font-size:11.5px;margin-top:14px">${ICONS.zap} 操作提示：点击「上传」选择证照/PDF 即可自动提交；无需核验的资料上传后自动通过；驳回项请补齐后重新上传。点击文件可放大预览。</div>
  <input type="file" id="docFile" accept="image/*,application/pdf" hidden>`
  : `<div class="card pad center" style="padding:40px">
    <div class="empty-ic">${ICONS.layers}</div>
    <b>尚未生成资料清单</b>
    <div class="muted" style="font-size:12.5px;margin-top:6px">点击「开始收集」或「一键生成资料清单」，将按业态（${esc(merchant.category)}）自动匹配进场资料要求。</div>
  </div>`}`;

  $('#mBack', c).onclick = () => go('merchants');
  if ($('#mEdit', c)) $('#mEdit', c).onclick = () => merchantForm(merchant);
  if ($('#mDel', c)) $('#mDel', c).onclick = () => confirmDlg(`确定删除商户「${merchant.name}」及其全部资料吗？`, async () => {
    try { await api('DELETE', `/api/merchants/${id}`); toast('已删除'); go('merchants'); } catch (e) { toast(e.message, 'err'); }
  }, '删除');
  if ($('#mGenDocs', c)) $('#mGenDocs', c).onclick = async () => {
    try { await api('POST', `/api/merchants/${id}/generate-docs`); toast('资料清单已生成'); renderMerchantDetail(c, id); }
    catch (e) { toast(e.message, 'err'); }
  };
  $$('#detailOps [data-mact]', c).forEach((el) => el.onclick = () => merchantStatusAction(id, el.dataset.mact, c));
  $$('.doc-row [data-dact]', c).forEach((el) => el.onclick = () => docStatusAction(el.dataset.dact, el.dataset.id, c));
  // 上传
  const fileInput = $('#docFile', c);
  if (fileInput) fileInput.onchange = () => { if (fileInput.files[0]) uploadDocFile(fileInput, c); };
  $$('.doc-row [data-upload]', c).forEach((el) => el.onclick = () => { const inp = $('#docFile', c); inp.dataset.docId = el.dataset.upload; inp.click(); });
  // 一键打包下载
  const dlAll = $('#mDlAll', c);
  if (dlAll) dlAll.onclick = async () => {
    const have = docs.some((d) => d.fileUrl);
    if (!have) return toast('该商户暂无已上传资料', 'err');
    const btn = dlAll; const orig = btn.innerHTML;
    btn.classList.add('loading'); btn.disabled = true;
    try {
      const r = await fetch(`/api/merchants/${id}/docs-export-zip`, { headers: { Authorization: 'Bearer ' + (S.token || '') } });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || ('下载失败（HTTP ' + r.status + '）')); }
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(merchant.name || 'merchant').replace(/[\\/:*?"<>|\s]/g, '_')}-资料.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
      toast('已下载：' + a.download);
    } catch (e) { toast(e.message, 'err'); }
    finally { btn.classList.remove('loading'); btn.disabled = false; btn.innerHTML = orig; }
  };
}

function merchantStatusBtns(st, can, docs, needVerified, needTotal) {
  if (!can) return '';
  const btns = {
    DRAFT: `<button class="btn sm" data-mact="START">▶ 开始收集资料</button>`,
    COLLECTING: `<button class="btn sm" data-mact="SUBMIT_REVIEW">提交审核</button>`,
    REVIEWING: `<button class="btn sm" data-mact="COMPLETE">✓ 完成归档</button><button class="btn ghost sm" data-mact="REOPEN">重新收集</button>`,
    COMPLETED: `<button class="btn ghost sm" data-mact="REOPEN">重新收集</button>`,
  }[st];
  return btns ? `<div id="detailOps">${btns}</div>` : '';
}
async function merchantStatusAction(id, action, c) {
  try {
    const r = await api('POST', `/api/merchants/${id}/status`, { action });
    const to = r.merchant.status;
    toast({ START: '已开始收集，资料清单已自动生成', SUBMIT_REVIEW: '已提交审核', COMPLETE: '🎉 已归档完成', REOPEN: '已重新开始收集' }[action] || '状态已更新');
    renderMerchantDetail(c, id);
  } catch (e) { toast(e.message, 'err'); }
}

function docRowHtml(d, can) {
  const t = d.docType || {};
  const ops = [];
  const isImg = d.fileUrl && /\.(jpe?g|png|gif|webp|bmp)(\?|$)/i.test(d.fileUrl);
  const isPdf = d.fileUrl && /\.pdf(\?|$)/i.test(d.fileUrl);
  const view = d.fileUrl
    ? (isImg || isPdf
        ? `<a class="d-file" data-lb="${esc(d.fileUrl)}" href="javascript:void(0)" role="button" title="点击放大">${isPdf ? ICONS.filePDF : ICONS.fileWord} ${esc(d.fileName || '查看')}</a>`
        : `<a class="d-file" href="${esc(d.fileUrl)}" target="_blank" rel="noopener">${ICONS.fileWord} ${esc(d.fileName || '查看')}</a>`)
    : '';
  if (d.status === 'MISSING' || d.status === 'REJECTED') {
    if (can) ops.push(`<button class="btn xs sec" data-upload="${d.id}" data-needverify="${t.needVerify === false ? 0 : 1}">上传资料</button>`);
  } else if (d.status === 'SUBMITTED') {
    if (can && t.needVerify) ops.push(`<button class="btn xs" data-dact="VERIFY" data-id="${d.id}" data-hasexpiry="${t.hasExpiry ? 1 : 0}">✓ 核验通过</button><button class="btn xs danger" data-dact="REJECT" data-id="${d.id}">驳回补齐</button>`);
    if (!t.needVerify) ops.push(`<span class="muted" style="font-size:11px">无需核验</span>`);
  } else if (d.status === 'VERIFIED') {
    if (can) ops.push(`<button class="btn xs ghost" data-dact="RESET" data-id="${d.id}">重置</button>`);
  }
  const expireHtml = (t.hasExpiry && d.status === 'VERIFIED') ? expireTag(d.expireDate) : '';
  return `<div class="doc-row ${d.status === 'REJECTED' ? 'rejected' : ''}">
    <div style="flex:1;min-width:220px">
      <div class="d-name">${t.required ? '<span class="req-star">*</span>' : ''}${esc(t.name || '未命名资料')} ${dBadge(d.status)}${expireHtml}</div>
      ${t.hint ? `<div class="d-hint">${esc(t.hint)}</div>` : ''}
      ${d.fileName ? `<div style="font-size:11.5px;color:var(--muted);margin-top:3px">文件：${esc(d.fileName)} ${view ? '· ' + view : ''}</div>` : (view ? `<div style="margin-top:4px">${view}</div>` : '')}
      ${d.rejectedReason ? `<div class="d-reason">驳回原因：${esc(d.rejectedReason)}</div>` : ''}
      ${d.status === 'VERIFIED' && d.verifiedAt ? `<div class="muted" style="font-size:11px;margin-top:3px">核验人：${esc(d.verifiedBy || '')} · ${fmtTs(d.verifiedAt)}</div>` : ''}
    </div>
    <div class="d-ops">${ops.join('')}</div>
  </div>`;
}
function expireTag(expireDate) {
  if (!expireDate) return `<span class="d-expire soon">未填有效期</span>`;
  const left = Math.ceil((new Date(expireDate) - new Date()) / 86400000);
  const cls = left < 0 ? 'over' : left <= 30 ? 'soon' : '';
  return `<span class="d-expire ${cls}">有效期至 ${String(expireDate).slice(0, 10)}${left < 0 ? '（已过期）' : left <= 30 ? `（剩 ${left} 天）` : ''}</span>`;
}

// 文件上传：base64 → /api/uploads → 绑定 → 自动提交（无需核验则自动通过）
async function uploadDocFile(input, c) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) return toast('文件不能超过 8MB', 'err');
  const docId = input.dataset.docId;
  const btn = c.querySelector(`[data-upload="${docId}"]`);
  const needVerify = btn ? btn.dataset.needverify === '1' : true;
  input.value = '';
  if (btn) { btn.classList.add('loading'); btn.disabled = true; }
  toast('上传中…');
  try {
    const b64 = await new Promise((res, rej) => {
      const rd = new FileReader();
      rd.onload = () => res(String(rd.result).split(',')[1]);
      rd.onerror = () => rej(new Error('读取文件失败'));
      rd.readAsDataURL(file);
    });
    const up = await api('POST', '/api/uploads', { filename: file.name, data: b64 });
    await api('POST', `/api/merchant-docs/${docId}/upload`, { fileUrl: up.url, fileName: file.name });
    // 自动提交（走状态机）
    await api('POST', `/api/merchant-docs/${docId}/status`, { action: 'SUBMIT' });
    if (!needVerify) {
      await api('POST', `/api/merchant-docs/${docId}/status`, { action: 'VERIFY' });
      toast('已上传并自动通过');
    } else toast('已上传，待核验');
    renderMerchantDetail(c, c._mid);
  } catch (e) { toast(e.message, 'err'); if (btn) { btn.classList.remove('loading'); btn.disabled = false; } }
}
async function docStatusAction(action, id, c) {
  if (action === 'REJECT') {
    promptDlg('请填写驳回原因（将展示给商户，方便其补齐）：', '如：证件已过期、信息不清晰…', async (reason) => {
      if (!reason) return toast('请填写驳回原因', 'err');
      try { await api('POST', `/api/merchant-docs/${id}/status`, { action, reason }); toast('已驳回，等待补齐'); renderMerchantDetail(c, c._mid); }
      catch (e) { toast(e.message, 'err'); }
    }, '驳回补齐');
    return;
  }
  if (action === 'VERIFY') {
    const btn = c.querySelector(`[data-dact="VERIFY"][data-id="${id}"]`);
    const hasExpiry = btn ? btn.dataset.hasexpiry === '1' : false;
    if (hasExpiry) {
      promptDlg('请填写证件到期日期（YYYY-MM-DD，可留空稍后补）：', '如：2027-08-19', async (exp) => {
        try { await api('POST', `/api/merchant-docs/${id}/status`, { action, expireDate: exp || null }); toast('已核验通过'); renderMerchantDetail(c, c._mid); }
        catch (e) { toast(e.message, 'err'); }
      }, '核验通过');
      return;
    }
  }
  try {
    await api('POST', `/api/merchant-docs/${id}/status`, { action });
    toast(action === 'RESET' ? '已重置为待提交' : '操作成功');
    renderMerchantDetail(c, c._mid);
  } catch (e) { toast(e.message, 'err'); }
}

// ---------- 资料类型管理 ----------
async function viewDocTypes(c) {
  if (!hasPerm('merchant_view')) { c.innerHTML = `<div class="card pad center muted">无查看权限</div>`; return; }
  c.innerHTML = `<div class="center pad"><span class="spinner"></span> 加载中…</div>`;
  let docTypes = [];
  try { const r = await api('GET', '/api/doc-types'); docTypes = r.docTypes || []; }
  catch (e) { c.innerHTML = `<div class="card pad center muted">${esc(e.message)}</div>`; return; }
  const can = hasPerm('merchant_manage');
  // 按主分组归类：通用(*) 一组，其余按首个适用业态归类；停用的也显示（可重新启用）
  const mainCat = (t) => (t.categories && t.categories.includes('*')) ? '*' : (t.categories && t.categories[0]) || '其他';
  const groups = [['*', '通用（所有业态）'], ...(S.C.BIZ_CATEGORIES || []).map((x) => [x, x])];
  $('#pageTitle').textContent = '资料类型管理';

  c.innerHTML = `
  <div class="page-head"><h2>资料类型管理</h2><div class="spacer"></div>
    <button class="btn ghost sm" id="dtBack">← 返回资料库</button>
    ${can ? `<button class="btn sm" id="dtAdd">＋ 新增资料类型</button>` : ''}
  </div>
  <div class="muted" style="font-size:12.5px;margin-bottom:12px">预置了常见进场资料库，可按实际要求增删改。带 <span class="req-star">*</span> 的为该业态必传项，新建商户时会按业态自动匹配清单。</div>
  ${groups.map(([g, glabel]) => {
    const list = docTypes.filter((t) => mainCat(t) === g);
    if (!list.length) return '';
    return `
    <div class="doc-grp-title">${esc(glabel)} <span class="muted" style="font-weight:500;font-size:11px">${list.length} 项</span></div>
    ${list.map((t) => `
      <div class="dt-row ${t.active === false ? 'inactive' : ''}">
        <div class="dt-name">${t.required ? '<span class="req-star">*</span>' : ''}${esc(t.name)}</div>
        <div class="dt-cats">${t.categories.map((x) => x === '*' ? '<span class="cat-tag" style="background:#f1f5f9;color:#64748b;border-color:#e2e8f0">通用</span>' : `<span class="cat-tag">${esc(x)}</span>`).join('')}</div>
        ${t.hasExpiry ? `<span class="tag">有效期+${t.remindDays || 30}天提醒</span>` : ''}
        ${t.needVerify ? '' : '<span class="tag">无需核验</span>'}
        ${t.active === false ? '<span class="tag" style="background:var(--red-bg);color:var(--red-tx)">已停用</span>' : ''}
        <div class="dt-hint">${esc(t.hint || '')}</div>
        <div class="dt-ops">${can ? `<button class="btn xs ghost" data-edit="${t.id}">编辑</button>
        ${t.active === false
          ? `<button class="btn xs sec" data-on="${t.id}">启用</button>`
          : `<button class="btn xs ghost" data-off="${t.id}">停用</button>`}
        <button class="btn xs ghost danger-ghost" data-del="${t.id}">删除</button>` : ''}</div>
      </div>`).join('')}`;
  }).join('')}`;

  $('#dtBack', c).onclick = () => go('merchants');
  if ($('#dtAdd', c)) $('#dtAdd', c).onclick = () => docTypeForm(null, () => viewDocTypes(c));
  $$('[data-edit]', c).forEach((el) => el.onclick = () => { const t = docTypes.find((x) => x.id === el.dataset.edit); if (t) docTypeForm(t, () => viewDocTypes(c)); });
  $$('[data-off]', c).forEach((el) => el.onclick = async () => { try { await api('PATCH', `/api/doc-types/${el.dataset.off}`, { active: false }); toast('已停用'); viewDocTypes(c); } catch (e) { toast(e.message, 'err'); } });
  $$('[data-on]', c).forEach((el) => el.onclick = async () => { try { await api('PATCH', `/api/doc-types/${el.dataset.on}`, { active: true }); toast('已启用'); viewDocTypes(c); } catch (e) { toast(e.message, 'err'); } });
  $$('[data-del]', c).forEach((el) => el.onclick = () => {
    const t = docTypes.find((x) => x.id === el.dataset.del);
    confirmDlg(`确定删除资料类型「${t.name}」吗？`, async () => {
      try { await api('DELETE', `/api/doc-types/${t.id}`); toast('已删除'); viewDocTypes(c); }
      catch (e) { toast(e.message, 'err'); }
    }, '删除');
  });
}
function docTypeForm(t, after) {
  const isEdit = !!t;
  const cats = S.C.BIZ_CATEGORIES || [];
  const modalEl = modal(`<header><h3>${isEdit ? '编辑资料类型' : '新增资料类型'}</h3><button class="btn ghost sm" style="margin-left:auto" data-close>✕</button></header>
  <div class="body">
    <label>资料名称 *</label><input id="dtName" placeholder="如：食品经营许可证" value="${esc(t ? t.name : '')}">
    <label>适用业态（勾选）</label><div class="row" style="gap:8px">
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;margin:4px 0"><input type="checkbox" id="dtAll" ${!t || t.categories.includes('*') ? 'checked' : ''} style="width:auto"> 通用（所有业态）</label>
      ${cats.map((x) => `<label style="display:flex;align-items:center;gap:6px;font-size:13px;margin:4px 0"><input type="checkbox" class="dtCat" value="${esc(x)}" ${t && t.categories.includes(x) ? 'checked' : ''} style="width:auto"> ${esc(x)}</label>`).join('')}
    </div>
    <div class="row">
      <label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" id="dtReq" ${!t || t.required ? 'checked' : ''} style="width:auto"> 必传</label>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" id="dtVerify" ${!t || t.needVerify !== false ? 'checked' : ''} style="width:auto"> 需核验</label>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" id="dtExp" ${t && t.hasExpiry ? 'checked' : ''} style="width:auto"> 有有效期</label>
    </div>
    <label>到期提醒（天，有有效期时生效）</label><input id="dtRemind" type="number" min="0" value="${t ? t.remindDays || 30 : 30}">
    <label>填报说明（提示商户）</label><textarea id="dtHint" rows="2" placeholder="如：经营范围须涵盖实际经营项目">${esc(t ? t.hint || '' : '')}</textarea>
  </div>
  <footer><button class="btn ghost" data-close>取消</button><button class="btn" id="dtSave">保存</button></footer>`, true);
  modalEl.querySelectorAll('[data-close]').forEach((el) => el.onclick = () => closeModal(modalEl));
  $('#dtAll', modalEl).onchange = (e) => { $$('.dtCat', modalEl).forEach((el) => { el.checked = e.target.checked ? false : el.checked; }); };
  $('#dtSave', modalEl).onclick = async () => {
    const name = $('#dtName', modalEl).value.trim();
    if (!name) return toast('请填写资料名称', 'err');
    const categories = $('#dtAll', modalEl).checked ? ['*'] : $$('.dtCat', modalEl).filter((el) => el.checked).map((el) => el.value);
    if (!categories.length) return toast('请至少选择一种适用业态', 'err');
    const body = {
      name, categories,
      required: $('#dtReq', modalEl).checked,
      needVerify: $('#dtVerify', modalEl).checked,
      hasExpiry: $('#dtExp', modalEl).checked,
      remindDays: Number($('#dtRemind', modalEl).value) || 0,
      hint: $('#dtHint', modalEl).value.trim(),
    };
    try {
      if (isEdit) await api('PATCH', `/api/doc-types/${t.id}`, body);
      else await api('POST', '/api/doc-types', body);
      closeModal(modalEl); toast('已保存'); if (after) after();
    } catch (e) { toast(e.message, 'err'); }
  };
}

// ---------- init ----------
(async function init() {
  const params = new URLSearchParams(location.search);
  if (params.get('share')) { viewShareIssue(params.get('share')); return; }
  const t = localStorage.getItem('token');
  if (t) {
    S.token = t; S.user = JSON.parse(localStorage.getItem('user') || 'null');
    try {
      await boot();
      if (params.get('issue')) { S.view = 'issues'; viewIssueDetail($('#content'), params.get('issue')); }
      else if (params.get('project')) {
        S.projectId = params.get('project'); const sel = $('#projSel'); if (sel) sel.value = S.projectId;
        await loadProjectData();
        if (params.get('entry') === '1') openIssueModal(); else go('dashboard');
      }
      return;
    } catch (e) {}
  }
  renderLogin();
})();
})();
