'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const os = require('os');
const zlib = require('zlib');

const db = require('./src/db');
const C = require('./src/constants');
const sm = require('./src/statemachine');
const metrics = require('./src/metrics');
const excel = require('./src/excel');
const reports = require('./src/reports');
const ai = require('./src/ai');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const sessions = new Map(); // token -> userId

// 局域网 IP（供手机扫码访问）。默认绑定 0.0.0.0，手机与电脑同一 Wi-Fi 即可访问。
function getLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return '127.0.0.1';
}

// ---------- helpers ----------
// gzip 响应（静态资源与 JSON API 共用）：客户端支持 gzip 时压缩并标注 Vary，体积小或无法压缩时原样输出。
function respond(req, res, status, headers, buf) {
  const accept = req.headers['accept-encoding'] || '';
  if (/\bgzip\b/.test(accept) && buf.length > 512) {
    const gz = zlib.gzipSync(buf);
    if (gz.length < buf.length) {
      headers['Content-Encoding'] = 'gzip';
      headers['Vary'] = 'Accept-Encoding';
      headers['Content-Length'] = gz.length;
      res.writeHead(status, headers);
      res.end(gz);
      return;
    }
  }
  headers['Content-Length'] = buf.length;
  res.writeHead(status, headers);
  res.end(buf);
}
function send(res, status, obj) {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  respond(res._req || { headers: {} }, res, status, {
    'Content-Type': typeof obj === 'string' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
  }, Buffer.from(body, 'utf8'));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('JSON 解析失败')); }
    });
    req.on('error', reject);
  });
}
function getToken(req) {
  const h = req.headers['authorization'] || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  const c = parseCookies(req);
  return c.token || null;
}
function parseCookies(req) {
  const h = req.headers.cookie;
  if (!h) return {};
  return h.split(';').reduce((a, p) => {
    const i = p.indexOf('=');
    if (i < 0) return a;
    a[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
    return a;
  }, {});
}
// 浏览器通过 window.open / 直接导航打开的导出/查看接口不会带 Authorization 头，
// 因此用 HttpOnly Cookie 承载会话，使新标签页、打印、下载均可鉴权（深层修复）。
function authCookie(token) { return `token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`; }
function clearCookie() { return `token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`; }
function ensureCookie(req, res) {
  const t = getToken(req);
  if (t && sessions.has(t) && !res.headersSent) res.setHeader('Set-Cookie', authCookie(t));
}
function currentUser(req) {
  const t = getToken(req);
  if (!t) return null;
  const uid = sessions.get(t);
  if (!uid) return null;
  return db.get('users', uid);
}
function requireUser(req) {
  const u = currentUser(req);
  if (!u) { const e = new Error('未登录'); e.code = 401; throw e; }
  return u;
}
function reqUser(req) { return requireUser(req); }
function requireRole(req, roles) {
  const u = requireUser(req);
  if (roles && !roles.includes(u.role)) { const e = new Error('无权限'); e.code = 403; throw e; }
  return u;
}
// 按权限点校验（框架第28条：角色权限可配置）。超级管理员恒拥有全部权限。
function userPermissions(u) {
  if (!u) return [];
  if (u.role === C.ROLE.SUPER_ADMIN) return C.ALL_PERMISSIONS.slice();
  const role = db.list('roles').find((r) => r.name === u.role);
  if (role && Array.isArray(role.permissions)) return role.permissions.slice();
  const def = C.DEFAULT_ROLES.find((r) => r.name === u.role);
  return def ? def.permissions.slice() : [];
}
function requirePermission(req, perm) {
  const u = requireUser(req);
  const perms = userPermissions(u);
  if (!perms.includes(perm)) { const e = new Error('无权限：需要「' + (C.PERMISSIONS[perm] || perm) + '」权限'); e.code = 403; throw e; }
  return u;
}
function audit(user, action, entity, entityId, before, after, req) {
  db.insert('auditLogs', {
    id: db.genId('aud'),
    actorId: user ? user.id : null,
    actorName: user ? user.name : '系统',
    action, entity, entityId,
    before: before ?? null, after: after ?? null,
    device: (req && req.headers['user-agent']) || '',
    at: new Date().toISOString(),
  });
}
function logHistory(issue, action, from, to, actor, note) {
  db.insert('issueHistory', {
    id: db.genId('ih'), issueId: issue.id, action,
    fromStatus: from, toStatus: to,
    actorId: actor ? actor.id : null, actorName: actor ? actor.name : '',
    note: note || '', at: new Date().toISOString(),
  });
}
function enrichIssue(i) {
  if (!i) return i;
  const o = { ...i };
  if (i.disciplineId && !o.disciplineName) { const d = db.get('disciplines', i.disciplineId); o.disciplineName = d ? d.name : ''; }
  if (i.floorId && !o.floorName) { const f = db.get('floors', i.floorId); o.floorName = f ? f.name : ''; }
  if (i.zoneId && !o.zoneName) { const z = db.get('zones', i.zoneId); o.zoneName = z ? z.name : ''; }
  if (i.positionId && !o.positionName) { const pos = db.get('positions', i.positionId); o.positionName = pos ? pos.name : ''; }
  if (i.batchId && !o.batchName) { const b = db.get('inspectionBatches', i.batchId); o.batchName = b ? b.name : ''; }
  if (i.responsibleOrgId && !o.responsibleOrgName) { const g = db.get('organizations', i.responsibleOrgId); o.responsibleOrgName = g ? g.name : ''; }
  return o;
}
function issueFilter(query) {
  const { projectId, batchId, floorId, zoneId, positionId, discipline, severity, status, orgId, keyword, overdue, statusOpen, severityIn } = query;
  const now = new Date().toISOString();
  const closedSet = ['CLOSED', 'CANCELLED', 'DUPLICATE'];
  const sevIn = severityIn ? String(severityIn).split(',').filter(Boolean) : null;
  const statusSet = status ? String(status).split(',').filter(Boolean) : null;
  return db.list('issues').filter((i) => {
    if (projectId && i.projectId !== projectId) return false;
    if (batchId && i.batchId !== batchId) return false;
    if (floorId && i.floorId !== floorId) return false;
    if (zoneId && i.zoneId !== zoneId) return false;
    if (positionId && i.positionId !== positionId) return false;
    if (discipline && i.disciplineName !== discipline) return false;
    if (severity && i.severity !== severity) return false;
    if (sevIn && !sevIn.includes(i.severity)) return false;
    if (statusSet && !statusSet.includes(i.rectificationStatus) && !statusSet.includes(i.finalStatus)) return false;
    if (statusOpen === '1' && closedSet.includes(i.rectificationStatus)) return false;
    if (orgId && i.responsibleOrgId !== orgId) return false;
    if (overdue === '1' && !metrics.isOverdue(i, now)) return false;
    if (keyword) {
      const k = keyword.toLowerCase();
      const hay = ((i.issueNo||'')+(i.title||'')+(i.description||'')+(i.responsibleOrgName||'')+(i.floorName||'')+(i.positionName||'')+(i.batchName||'')).toLowerCase();
      if (!hay.includes(k)) return false;
    }
    return true;
  }).map(enrichIssue);
}

// ---------- routes ----------
const routes = [];

function route(method, pattern, handler) {
  // pattern like /api/projects/:id
  const keys = [];
  const regex = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ method, regex, keys, handler });
}

// Auth
route('POST', '/api/login', async (req, res, p, body) => {
  const { username, password } = body;
  const user = db.list('users').find((u) => u.username === username);
  if (!user || user.password !== password) return send(res, 401, { error: '用户名或密码错误' });
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, user.id);
  const { password: _pw, ...safe } = user;
  safe.permissions = userPermissions(user);
  res.setHeader('Set-Cookie', authCookie(token));
  return send(res, 200, { token, user: safe });
});
route('POST', '/api/logout', async (req, res) => {
  const t = getToken(req); if (t) sessions.delete(t);
  res.setHeader('Set-Cookie', clearCookie());
  return send(res, 200, { ok: true });
});
route('GET', '/api/me', async (req, res) => {
  const u = requireUser(req); const { password: _pw, ...safe } = u;
  safe.permissions = userPermissions(u);
  return send(res, 200, { user: safe });
});
route('GET', '/api/constants', async (req, res) => {
  return send(res, 200, {
    ISSUE_STATUS: C.ISSUE_STATUS, ISSUE_STATUS_LABEL: C.ISSUE_STATUS_LABEL,
    SEVERITY: C.SEVERITY, SEVERITY_LABEL: C.SEVERITY_LABEL, SEVERITY_ORDER: C.SEVERITY_ORDER,
    PRIORITY: C.PRIORITY, PRIORITY_LABEL: C.PRIORITY_LABEL,
    REINSPECTION_RESULT: C.REINSPECTION_RESULT, REINSPECTION_RESULT_LABEL: C.REINSPECTION_RESULT_LABEL,
    ORG_TYPE: C.ORG_TYPE, ROLE: C.ROLE,
    PERMISSIONS: C.PERMISSIONS, PERMISSION_GROUPS: C.PERMISSION_GROUPS, ROLES: C.DEFAULT_ROLES.map((r) => ({ key: r.key, name: r.name })),
    SOURCE_TYPE: C.SOURCE_TYPE, OVERDUE_COLOR: C.OVERDUE_COLOR,
    TRANSITIONS: Object.keys(C.TRANSITIONS),
    MERCHANT_STATUS: C.MERCHANT_STATUS, MERCHANT_STATUS_LABEL: C.MERCHANT_STATUS_LABEL,
    DOC_STATUS: C.DOC_STATUS, DOC_STATUS_LABEL: C.DOC_STATUS_LABEL,
    BIZ_CATEGORIES: getBizCategories(),
    MERCHANT_TRANSITIONS: Object.keys(C.MERCHANT_TRANSITIONS),
    DOC_TRANSITIONS: Object.keys(C.DOC_TRANSITIONS),
  });
});
// 业态（可配置，存于 db.bizCategories 字符串数组；首次访问时用默认值填充）
function getBizCategories() {
  const list = db.list('bizCategories');
  if (!list.length) {
    C.BIZ_CATEGORIES.forEach((x) => db.insert('bizCategories', x));
    return db.list('bizCategories');
  }
  return list;
}
route('GET', '/api/biz-categories', async (req, res) => {
  requireUser(req);
  return send(res, 200, { categories: getBizCategories() });
});
route('POST', '/api/biz-categories', async (req, res, p, body) => {
  const u = requireUser(req);
  const name = String(body.name || '').trim();
  if (!name) return send(res, 400, { error: '请填写业态名称' });
  const list = getBizCategories();
  if (list.includes(name)) return send(res, 400, { error: '业态「' + name + '」已存在' });
  db.insert('bizCategories', name);
  audit(u, 'CREATE_BIZ_CATEGORY', 'BizCategory', name, null, name, req);
  return send(res, 200, { categories: getBizCategories() });
});
route('PATCH', '/api/biz-categories/:name', async (req, res, p, body) => {
  const u = requireUser(req);
  const oldName = decodeURIComponent(p.name);
  const newName = String(body.newName || '').trim();
  if (!newName) return send(res, 400, { error: '请填写新名称' });
  const list = getBizCategories();
  if (!list.includes(oldName)) return send(res, 404, { error: '业态不存在' });
  if (list.includes(newName) && newName !== oldName) return send(res, 400, { error: '新名称已存在' });
  db.removeWhere('bizCategories', (x) => x === oldName);
  db.insert('bizCategories', newName);
  // 同步引用：商户 category、房源 category、资料类型 categories
  const now = new Date().toISOString();
  db.list('merchants').forEach((m) => { if (m.category === oldName) db.update('merchants', m.id, { category: newName, updatedAt: now }); });
  db.list('rooms').forEach((r) => { if (r.category === oldName) db.update('rooms', r.id, { category: newName, updatedAt: now }); });
  db.list('docTypes').forEach((t) => { if (t.categories && t.categories.includes(oldName)) db.update('docTypes', t.id, { categories: t.categories.map((x) => (x === oldName ? newName : x)) }); });
  audit(u, 'RENAME_BIZ_CATEGORY', 'BizCategory', oldName, oldName, newName, req);
  return send(res, 200, { categories: getBizCategories() });
});
route('DELETE', '/api/biz-categories/:name', async (req, res, p) => {
  const u = requireUser(req);
  const name = decodeURIComponent(p.name);
  const before = db.list('bizCategories').length;
  db.removeWhere('bizCategories', (x) => x === name);
  if (db.list('bizCategories').length === before) return send(res, 404, { error: '业态不存在' });
  audit(u, 'DELETE_BIZ_CATEGORY', 'BizCategory', name, name, null, req);
  return send(res, 200, { categories: getBizCategories() });
});

// ---------- 权限中心 ----------
// 权限点目录（前端渲染勾选矩阵用）
route('GET', '/api/permissions', async (req, res) => {
  requireUser(req);
  return send(res, 200, { groups: C.PERMISSION_GROUPS, permissions: C.PERMISSIONS });
});
// 角色列表（含各角色权限集合）
route('GET', '/api/roles', async (req, res) => {
  const u = requirePermission(req, 'role_manage');
  const roles = db.list('roles');
  return send(res, 200, { roles });
});
// 更新角色权限（仅超级管理员可改；超级管理员角色锁定不可编辑）
route('PATCH', '/api/roles/:id', async (req, res, p, body) => {
  const u = requireRole(req, [C.ROLE.SUPER_ADMIN]);
  const before = db.get('roles', p.id); if (!before) return send(res, 404, { error: '角色不存在' });
  if (before.locked) return send(res, 403, { error: '该角色为系统内置，不可修改权限' });
  let perms = Array.isArray(body.permissions) ? body.permissions.filter((k) => C.PERMISSIONS[k]) : [];
  const updated = db.update('roles', p.id, { permissions: perms, updatedAt: new Date().toISOString() });
  audit(u, 'UPDATE_ROLE', 'Role', p.id, before.name, updated.name, req);
  return send(res, 200, { role: updated });
});

// Users
route('GET', '/api/users', async (req, res) => {
  requireUser(req);
  const users = db.list('users').map(({ password, ...u }) => u);
  return send(res, 200, { users });
});
route('POST', '/api/users', async (req, res, p, body) => {
  requireRole(req, [C.ROLE.SUPER_ADMIN]);
  const u = requireUser(req);
  const user = { id: db.genId('usr'), username: body.username, password: body.password || '123456',
    name: body.name, role: body.role || C.ROLE.INSPECTOR, orgId: body.orgId || null, createdAt: new Date().toISOString() };
  db.insert('users', user); audit(u, 'CREATE_USER', 'User', user.id, null, user.username, req);
  return send(res, 200, { user: { ...user, password: undefined } });
});
route('DELETE', '/api/users/:id', async (req, res, p) => {
  const u = requireRole(req, [C.ROLE.SUPER_ADMIN]);
  const before = db.get('users', p.id); if (!before) return send(res, 404, { error: '用户不存在' });
  db.remove('users', p.id); audit(u, 'DELETE_USER', 'User', p.id, before.username, null, req);
  return send(res, 200, { ok: true });
});
route('PATCH', '/api/users/:id', async (req, res, p, body) => {
  const u = requireRole(req, [C.ROLE.SUPER_ADMIN]);
  const before = db.get('users', p.id); if (!before) return send(res, 404, { error: '用户不存在' });
  const patch = {};
  if (body.name != null) patch.name = body.name;
  if (body.role != null) patch.role = body.role;
  if (body.orgId !== undefined) patch.orgId = body.orgId || null;
  if (body.password) patch.password = String(body.password);
  const updated = db.update('users', p.id, patch);
  audit(u, 'UPDATE_USER', 'User', p.id, before.name, updated.name, req);
  const { password: _p, ...safe } = updated;
  return send(res, 200, { user: safe });
});

// Projects
route('GET', '/api/projects', async (req, res) => {
  requireUser(req);
  return send(res, 200, { projects: db.list('projects') });
});
route('POST', '/api/projects', async (req, res, p, body) => {
  const u = requireRole(req, [C.ROLE.SUPER_ADMIN, C.ROLE.PROJECT_MANAGER]);
  const proj = { id: db.genId('prj'), name: body.name, code: body.code || '',
    address: body.address || '', manager: body.manager || '', status: '进行中',
    createdAt: new Date().toISOString(), createdBy: u.id };
  db.insert('projects', proj); audit(u, 'CREATE_PROJECT', 'Project', proj.id, null, proj.name, req);
  return send(res, 200, { project: proj });
});
route('GET', '/api/projects/:id', async (req, res, p) => {
  requireUser(req);
  const proj = db.get('projects', p.id); if (!proj) return send(res, 404, { error: '项目不存在' });
  return send(res, 200, { project: proj });
});
route('PATCH', '/api/projects/:id', async (req, res, p, body) => {
  const u = requireUser(req);
  const before = db.get('projects', p.id);
  const proj = db.update('projects', p.id, body); audit(u, 'UPDATE_PROJECT', 'Project', p.id, before.name, proj.name, req);
  return send(res, 200, { project: proj });
});
route('DELETE', '/api/projects/:id', async (req, res, p) => {
  const u = requireRole(req, [C.ROLE.SUPER_ADMIN, C.ROLE.PROJECT_MANAGER]);
  const proj = db.get('projects', p.id); if (!proj) return send(res, 404, { error: '项目不存在' });
  const pid = p.id;
  // 级联删除：问题及其整改/复查/历史
  const issueIds = new Set(db.list('issues').filter((i) => i.projectId === pid).map((i) => i.id));
  db.removeWhere('issues', (i) => i.projectId === pid);
  if (issueIds.size) {
    db.removeWhere('rectifications', (r) => issueIds.has(r.issueId));
    db.removeWhere('reinspections', (r) => issueIds.has(r.issueId));
    db.removeWhere('issueHistory', (h) => issueIds.has(h.issueId));
  }
  // 楼层 -> 区域 -> 位置
  const floorIds = new Set(db.list('floors').filter((f) => f.projectId === pid).map((f) => f.id));
  db.removeWhere('floors', (f) => f.projectId === pid);
  if (floorIds.size) {
    const zoneIds = new Set(db.list('zones').filter((z) => floorIds.has(z.floorId)).map((z) => z.id));
    db.removeWhere('zones', (z) => floorIds.has(z.floorId));
    db.removeWhere('positions', (x) => floorIds.has(x.floorId) || (zoneIds.size && zoneIds.has(x.zoneId)));
  }
  // 批次 / 统计表 / 报告 / 房源
  db.removeWhere('inspectionBatches', (b) => b.projectId === pid);
  db.removeWhere('statBoards', (b) => b.projectId === pid);
  db.removeWhere('reports', (r) => r.projectId === pid);
  db.removeWhere('rooms', (r) => r.projectId === pid);
  db.remove('projects', pid);
  audit(u, 'DELETE_PROJECT', 'Project', pid, proj.name, null, req);
  return send(res, 200, { ok: true });
});

// Floors
route('GET', '/api/projects/:pid/floors', async (req, res, p) => {
  requireUser(req);
  return send(res, 200, { floors: db.list('floors').filter((f) => f.projectId === p.pid) });
});
route('POST', '/api/floors', async (req, res, p, body) => {
  const u = requireUser(req);
  const f = { id: db.genId('flr'), projectId: body.projectId, name: body.name };
  db.insert('floors', f); audit(u, 'CREATE_FLOOR', 'Floor', f.id, null, f.name, req);
  return send(res, 200, { floor: f });
});
route('DELETE', '/api/floors/:id', async (req, res, p) => {
  const u = requireUser(req); const before = db.get('floors', p.id);
  db.remove('floors', p.id); audit(u, 'DELETE_FLOOR', 'Floor', p.id, before && before.name, null, req);
  return send(res, 200, { ok: true });
});
route('PATCH', '/api/floors/:id', async (req, res, p, body) => {
  const u = requireUser(req);
  const f = db.update('floors', p.id, body); audit(u, 'UPDATE_FLOOR', 'Floor', p.id, f.name, f.name, req);
  return send(res, 200, { floor: f });
});

// Rooms（房源管理）—— 楼栋/楼层/房号，与商户配对
function enrichRoom(r) {
  if (!r) return r;
  const m = r.merchantId ? db.get('merchants', r.merchantId) : null;
  return { ...r, merchantName: m ? m.name : '', merchantCategory: m ? m.category : '', merchantStatus: m ? m.status : '' };
}
route('GET', '/api/projects/:pid/rooms', async (req, res, p) => {
  requireUser(req);
  const all = db.list('rooms').filter((r) => r.projectId === p.pid).map(enrichRoom);
  return send(res, 200, { rooms: all, total: all.length });
});
route('GET', '/api/rooms/:id', async (req, res, p) => {
  requireUser(req);
  const r = db.get('rooms', p.id);
  if (!r) return send(res, 404, { error: '房源不存在' });
  return send(res, 200, { room: enrichRoom(r) });
});
route('POST', '/api/projects/:pid/rooms', async (req, res, p, body) => {
  const u = requireUser(req);
  if (!body.building) return send(res, 400, { error: '请填写楼栋' });
  if (!body.roomNo) return send(res, 400, { error: '请填写房号' });
  const now = new Date().toISOString();
  const r = {
    id: db.genId('rom'),
    projectId: p.pid,
    building: String(body.building || '').trim(),
    floor: String(body.floor || '').trim(),
    roomNo: String(body.roomNo || '').trim(),
    area: Number(body.area) || 0,
    category: String(body.category || '').trim(),
    merchantId: body.merchantId || null,
    note: String(body.note || '').trim(),
    createdAt: now, updatedAt: now,
  };
  db.insert('rooms', r);
  audit(u, 'CREATE_ROOM', 'Room', r.id, null, `${r.building} ${r.floor} ${r.roomNo}`, req);
  return send(res, 200, { room: enrichRoom(r) });
});
route('PATCH', '/api/rooms/:id', async (req, res, p, body) => {
  const u = requireUser(req);
  const patch = {};
  ['building', 'floor', 'roomNo', 'area', 'category', 'merchantId', 'note'].forEach((k) => { if (body[k] !== undefined) patch[k] = body[k]; });
  if (patch.area !== undefined) patch.area = Number(patch.area) || 0;
  patch.updatedAt = new Date().toISOString();
  const r = db.update('rooms', p.id, patch);
  if (!r) return send(res, 404, { error: '房源不存在' });
  audit(u, 'UPDATE_ROOM', 'Room', r.id, `${r.building} ${r.roomNo}`, null, req);
  return send(res, 200, { room: enrichRoom(r) });
});
route('DELETE', '/api/rooms/:id', async (req, res, p) => {
  const u = requireUser(req);
  const before = db.get('rooms', p.id);
  db.remove('rooms', p.id);
  audit(u, 'DELETE_ROOM', 'Room', p.id, before && `${before.building} ${before.roomNo}`, null, req);
  return send(res, 200, { ok: true });
});
// ---------- 极简 xlsx 解析（零依赖：zip 容器 + XML） ----------
function unzipEntries(buf) {
  const sig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  let eocd = buf.lastIndexOf(sig);
  if (eocd < 0) throw new Error('不是有效的 Excel(.xlsx)/zip 文件');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = {};
  let pos = cdOffset;
  for (let i = 0; i < count && pos + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const csize = buf.readUInt32LE(pos + 20);
    const lho = buf.readUInt32LE(pos + 42);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    if (lho + 30 <= buf.length) {
      const lMethod = buf.readUInt16LE(lho + 8);
      const lCsize = buf.readUInt32LE(lho + 18);
      const lNameLen = buf.readUInt16LE(lho + 26);
      const lExtraLen = buf.readUInt16LE(lho + 28);
      const start = lho + 30 + lNameLen + lExtraLen;
      entries[name] = { method: lMethod, data: buf.subarray(start, start + lCsize) };
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
function inflateEntry(entry) {
  if (!entry) return Buffer.alloc(0);
  if (entry.method === 0) return entry.data;
  return zlib.inflateRawSync(entry.data);
}
function xmlUnescape(s) { return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"); }
function colToNum(col) { let n = 0; for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
function parseXlsx(buf) {
  const entries = unzipEntries(buf);
  // 共享字符串表
  const shared = [];
  const ssXml = inflateEntry(entries['xl/sharedStrings.xml']).toString('utf8');
  if (ssXml) {
    const siRe = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = siRe.exec(ssXml))) {
      const ts = [...m[1].matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((x) => xmlUnescape(x[1]));
      shared.push(ts.join(''));
    }
  }
  // 第一个工作表（sheet1.xml）
  const sheetName = Object.keys(entries).find((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)) || 'xl/worksheets/sheet1.xml';
  const xml = inflateEntry(entries[sheetName]).toString('utf8');
  if (!xml) throw new Error('未找到工作表数据');
  const rows = [];
  const rowRe = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const cells = {};
    const cRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cm;
    while ((cm = cRe.exec(rm[1]))) {
      const attrs = cm[1];
      const ref = /r="([A-Z]+)\d+"/.exec(attrs);
      if (!ref) continue;
      const col = ref[1];
      const t = /t="([^"]+)"/.exec(attrs);
      const type = t ? t[1] : '';
      const inner = cm[2];
      let val = '';
      if (type === 's') { const v = /<v>([^<]*)<\/v>/.exec(inner); if (v) val = shared[parseInt(v[1], 10)] || ''; }
      else if (type === 'inlineStr') { const t2 = /<t(?:\s[^>]*)?>([^<]*)<\/t>/.exec(inner); if (t2) val = xmlUnescape(t2[1]); }
      else if (type === 'str') { const v = /<v>([^<]*)<\/v>/.exec(inner); if (v) val = xmlUnescape(v[1]); }
      else { const v = /<v>([^<]*)<\/v>/.exec(inner); if (v) val = xmlUnescape(v[1]); }
      if (val !== '') cells[col] = val;
    }
    const cols = Object.keys(cells).sort((a, b) => colToNum(a) - colToNum(b));
    rows.push(cols.map((c) => cells[c]));
  }
  return rows;
}
// 房源批量导入（支持 CSV 文本 body.csv 或 Excel xlsx 的 base64 body.xlsx；列：楼栋,楼层,房号,面积,业态,备注）
route('POST', '/api/projects/:pid/rooms/import', async (req, res, p, body) => {
  const u = requireUser(req);
  let grid;
  if (body.xlsx) {
    try { grid = parseXlsx(Buffer.from(body.xlsx, 'base64')); }
    catch (e) { return send(res, 400, { error: 'Excel 解析失败：' + e.message }); }
  } else {
    const csv = String(body.csv || '').replace(/^\uFEFF/, '');
    if (!csv.trim()) return send(res, 400, { error: '数据为空' });
    grid = csv.split(/\r?\n/).map((l) => l.split(','));
  }
  const lines = grid.map((r) => r.map((c) => String(c == null ? '' : c).trim())).filter((r) => r.some(Boolean));
  if (lines.length < 2) return send(res, 400, { error: '至少需要表头+1 行数据' });
  const header = lines[0];
  const findH = (...names) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const iB = Math.max(0, findH('楼栋', '楼号', '号楼'));
  const iF = findH('楼层');
  const iR = Math.max(0, findH('房号', '房间号', '房间'));
  const iA = findH('面积');
  const iC = findH('业态', '品类');
  const iN = findH('备注');
  const now = new Date().toISOString();
  let added = 0, skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i];
    if (!c[iB] || !c[iR]) { skipped++; continue; }
    db.insert('rooms', {
      id: db.genId('rom'),
      projectId: p.pid,
      building: (c[iB] || '').trim(),
      floor: (c[iF] || '').trim(),
      roomNo: (c[iR] || '').trim(),
      area: Number(c[iA]) || 0,
      category: (c[iC] || '').trim(),
      merchantId: null,
      note: (c[iN] || '').trim(),
      createdAt: now, updatedAt: now,
    });
    added++;
  }
  audit(u, 'IMPORT_ROOMS', 'Room', p.pid, null, `+${added}/跳过${skipped}`, req);
  return send(res, 200, { added, skipped, total: added + skipped });
});
// 房源导出（CSV）
route('GET', '/api/projects/:pid/rooms/export', async (req, res, p) => {
  requireUser(req);
  const rows = db.list('rooms').filter((r) => r.projectId === p.pid).map(enrichRoom);
  const escCsv = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = ['楼栋,楼层,房号,面积,业态,关联商户,备注'];
  rows.forEach((r) => lines.push([r.building, r.floor, r.roomNo, r.area, r.category, r.merchantName, r.note].map(escCsv).join(',')));
  const csv = '\uFEFF' + lines.join('\n');
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename=rooms-${p.pid}.csv` });
  res.end(csv);
});
// 房源模板（CSV）
route('GET', '/api/projects/:pid/rooms/template', async (req, res, p) => {
  requireUser(req);
  const sample = '李公堤B1号楼,B1,A1,86.5,餐饮,示例备注\n李公堤B1号楼,B1,A2,72.0,零售,\n李公堤01区号楼,1,B2-1,120.0,生活服务,';
  const csv = '\uFEFF楼栋,楼层,房号,面积,业态,备注\n' + sample;
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename=rooms-template.csv` });
  res.end(csv);
});
// 整栋改名（楼栋级批量更新）
route('PATCH', '/api/projects/:pid/buildings/rename', async (req, res, p, body) => {
  const u = requireUser(req);
  const oldName = String(body.oldName || '').trim();
  const newName = String(body.newName || '').trim();
  if (!oldName || !newName) return send(res, 400, { error: '请填写原名与新名' });
  if (oldName === newName) return send(res, 200, { ok: true, count: 0 });
  const now = new Date().toISOString();
  let count = 0;
  db.list('rooms').forEach((r) => { if (r.projectId === p.pid && r.building === oldName) { db.update('rooms', r.id, { building: newName, updatedAt: now }); count++; } });
  audit(u, 'RENAME_BUILDING', 'Room', p.pid, oldName, `${newName} (+${count})`, req);
  return send(res, 200, { ok: true, count });
});

// ---------- 一键打包下载（零依赖 zip STORE） ----------
// 极简 zip 写入器（PKZIP APPNOTE 6.3.x，STORE 模式，不压缩）
// 文件名编码用 UTF-8 + Language encoding flag(0x800) 通用 zip 工具均支持
function buildZip(files) {
  const local = []; const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const data = f.data || Buffer.alloc(0);
    const crc = zlib.crc32 ? zlib.crc32(data) : Number(crypto.createHash('crc32').update(data).digest('hex')); // 兼容（Node 22 已有 zlib.crc32）
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);             // version
    lh.writeUInt16LE(0x0800, 6);          // flags: UTF-8
    lh.writeUInt16LE(0, 8);               // method 0=STORE
    lh.writeUInt16LE(0, 10);              // mod time
    lh.writeUInt16LE(0, 12);              // mod date
    lh.writeUInt32LE(crc >>> 0, 14);
    lh.writeUInt32LE(data.length, 18);    // compressed size
    lh.writeUInt32LE(data.length, 22);    // uncompressed size
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);              // extra len
    local.push(lh, nameBuf, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc >>> 0, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + data.length;
  }
  const localPart = Buffer.concat(local);
  const centralPart = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localPart, centralPart, eocd]);
}
// 商户全部资料一键打包（zip）
route('GET', '/api/merchants/:id/docs-export-zip', async (req, res, p) => {
  const u = requireUser(req);
  const m = db.get('merchants', p.id);
  if (!m) return send(res, 404, { error: '商户不存在' });
  const docs = db.list('merchantDocs').filter((d) => d.merchantId === p.id && d.fileUrl);
  if (!docs.length) return send(res, 400, { error: '该商户暂无已上传资料' });
  const dtById = Object.fromEntries(db.list('docTypes').map((t) => [t.id, t]));
  const files = [];
  const usedNames = new Set();
  docs.forEach((d, idx) => {
    // fileUrl: /api/uploads/xxx
    const fname = d.fileName || (d.fileUrl.split('/').pop());
    let real;
    if (d.fileUrl.startsWith('/api/uploads/')) real = path.basename(d.fileUrl);
    else return;
    const fp = path.join(UPLOAD_DIR, real);
    if (!fs.existsSync(fp)) return;
    const data = fs.readFileSync(fp);
    const t = dtById[d.docTypeId];
    const docName = t ? t.name : ('资料' + (idx + 1));
    // 文件名去重
    const ext = (fname.split('.').pop() || '').toLowerCase();
    let base = (docName + (ext ? '.' + ext : '')).replace(/[\\/:*?"<>|]/g, '_');
    let name = base, n = 1;
    while (usedNames.has(name)) { name = base.replace(/\.[^.]*$/, '') + `(${++n})` + (ext ? '.' + ext : ''); }
    usedNames.add(name);
    files.push({ name, data });
  });
  if (!files.length) return send(res, 400, { error: '资料文件均已丢失' });
  // 附一份清单 CSV（编号/资料/文件名/上传时间/状态）
  const lines = ['序号,资料名称,文件名,上传时间,状态'];
  docs.forEach((d, idx) => { const t = dtById[d.docTypeId]; lines.push([idx + 1, t ? t.name : '', d.fileName || '', (d.updatedAt || '').slice(0, 19), d.status || ''].join(',')); });
  const csvBuf = Buffer.from('\uFEFF' + lines.join('\n'), 'utf8');
  files.push({ name: '资料清单.csv', data: csvBuf });
  const zip = buildZip(files);
  const safeName = String(m.name || 'merchant').replace(/[\\/:*?"<>|\s]/g, '_');
  audit(u, 'EXPORT_MERCHANT_DOCS_ZIP', 'Merchant', p.id, null, `+${files.length}`, req);
  res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safeName + '-资料.zip')}` });
  res.end(zip);
});

// ---------- AI 辅助录入/分类 (V1.5, DeepSeek) ----------
route('GET', '/api/ai/status', async (req, res) => {
  requireUser(req);
  return send(res, 200, { configured: ai.isConfigured(), mode: ai.isConfigured() ? 'deepseek' : 'local', baseUrl: ai.getBaseUrl(), model: ai.getModel() });
});
route('POST', '/api/ai/config', async (req, res, p, body) => {
  const u = requireRole(req, [C.ROLE.SUPER_ADMIN, C.ROLE.PROJECT_MANAGER]);
  ai.setConfig(body.apiKey, body.baseUrl, body.model);
  return send(res, 200, { ok: true, configured: ai.isConfigured(), mode: ai.isConfigured() ? 'deepseek' : 'local', model: ai.getModel() });
});
route('POST', '/api/ai/parse-issue', async (req, res, p, body) => {
  requireUser(req);
  if (!body.text) return send(res, 400, { error: '缺少描述文本' });
  const result = await ai.parseIssue(body.text, { contextNote: body.contextNote || '' });
  return send(res, 200, { result });
});
route('POST', '/api/ai/classify', async (req, res, p, body) => {
  requireUser(req);
  const text = (body.title || '') + ' ' + (body.description || '');
  if (!text.trim()) return send(res, 400, { error: '缺少标题或描述' });
  const result = await ai.parseIssue(text, {});
  return send(res, 200, { result });
});
// 多轮对话（右侧栏 AI 助手）
// 组装当前项目的实时数据上下文，注入模型，实现"基于数据回答/数据联动"
function buildAIContext(projectId, extra) {
  const proj = db.list('projects').find((p) => p.id === projectId) || null;
  const issues = db.list('issues').filter((i) => i.projectId === projectId);
  const orgById = Object.fromEntries(db.list('organizations').map((o) => [o.id, o]));
  const userById = Object.fromEntries(db.list('users').map((u) => [u.id, u]));
  const batches = db.list('inspectionBatches').filter((b) => b.projectId === projectId);
  const rects = db.list('rectifications').filter((r) => issues.some((i) => i.id === r.issueId));
  const reins = db.list('reinspections').filter((r) => rects.some((rc) => rc.id === r.rectificationId));
  const now = new Date();
  const closed = issues.filter((i) => i.rectificationStatus === 'CLOSED').length;
  const sev = metrics.getSeverityDistribution(issues);
  const disc = metrics.getDisciplineDistribution(issues);
  const flr = metrics.getFloorDistribution(issues);
  // 自定义维度分布
  const statusDist = {}, orgDist = {}, priDist = {}, zoneDist = {};
  issues.forEach((i) => {
    const s = i.rectificationStatus || 'UNKNOWN'; statusDist[s] = (statusDist[s] || 0) + 1;
    const o = (i.responsibleOrgId && orgById[i.responsibleOrgId]) ? orgById[i.responsibleOrgId].name : '未指派'; orgDist[o] = (orgDist[o] || 0) + 1;
    const p = i.priority || 'UNKNOWN'; priDist[p] = (priDist[p] || 0) + 1;
    const z = i.zoneName || '未分区域'; zoneDist[z] = (zoneDist[z] || 0) + 1;
  });
  const batchDist = batches.map((b) => ({ name: b.name, count: issues.filter((i) => i.batchId === b.id).length, startDate: b.startDate || '', endDate: b.endDate || '' }));
  const overdueList = issues.filter((i) => i.rectificationStatus !== 'CLOSED' && i.rectificationDeadline && new Date(i.rectificationDeadline) < now).slice(0, 30).map((i) => ({
    no: i.issueNo, title: i.title, deadline: (i.rectificationDeadline || '').slice(0, 10), floor: i.floorName || '', severity: i.severity,
    org: orgById[i.responsibleOrgId] ? orgById[i.responsibleOrgId].name : '未指派',
  }));
  const passRate = reins.length ? Math.round(reins.filter((r) => r.result === 'PASS').length / reins.length * 100) : 0;
  // ---- 商户模块（V1.5 进场资料库）----
  const merchants = db.list('merchants').filter((m) => m.projectId === projectId);
  const allDocs = db.list('merchantDocs');
  const docTypesById = Object.fromEntries(db.list('docTypes').map((t) => [t.id, t]));
  const mStatusDist = {}, mCatDist = {};
  merchants.forEach((m) => {
    mStatusDist[m.status] = (mStatusDist[m.status] || 0) + 1;
    mCatDist[m.category || '未分类'] = (mCatDist[m.category || '未分类'] || 0) + 1;
  });
  const docStats = { total: 0, VERIFIED: 0, SUBMITTED: 0, REJECTED: 0, MISSING: 0 };
  const expiryList = [];
  allDocs.forEach((d) => {
    if (!merchants.some((m) => m.id === d.merchantId)) return;
    docStats.total++; docStats[d.status] = (docStats[d.status] || 0) + 1;
    if (d.status === 'VERIFIED' && d.expireDate) {
      const days = Math.ceil((new Date(d.expireDate) - now) / 86400000);
      const m = merchants.find((x) => x.id === d.merchantId);
      const t = docTypesById[d.docTypeId];
      if (days < 0) expiryList.push({ flag: '已过期', days: -days, merchant: m ? m.name : '?', doc: t ? t.name : d.docTypeId, date: d.expireDate });
      else if (days <= (t ? t.remindDays || 30 : 30)) expiryList.push({ flag: '临期', days, merchant: m ? m.name : '?', doc: t ? t.name : d.docTypeId, date: d.expireDate });
    }
  });
  const ctx = {
    projectName: proj ? proj.name : '未指定项目',
    stats: {
      total: issues.length, open: issues.length - closed, closed,
      overdue: metrics.getOverdueIssueCount(issues, now),
      closureRate: issues.length ? Math.round(metrics.getClosureRate(issues) * 100) : 0,
      rectTotal: rects.length, reinsTotal: reins.length, passRate,
    },
    sev, disc, flr, statusDist, priDist, orgDist, zoneDist, batchDist, overdueList,
    recent: issues.slice(-12).reverse().map((i) => ({
      no: i.issueNo, title: i.title, floor: i.floorName || '', severity: i.severity,
      status: C.ISSUE_STATUS_LABEL[i.rectificationStatus] || i.rectificationStatus,
      org: (i.responsibleOrgId && orgById[i.responsibleOrgId]) ? orgById[i.responsibleOrgId].name : '',
    })),
    merchants: {
      total: merchants.length,
      completed: mStatusDist.COMPLETED || 0,
      uncomplete: merchants.length - (mStatusDist.COMPLETED || 0),
      mStatusDist, mCatDist,
      docTotal: docStats.total, docVerified: docStats.VERIFIED || 0, docSubmitted: docStats.SUBMITTED || 0,
      docRejected: docStats.REJECTED || 0, docMissing: docStats.MISSING || 0,
      expiryList,
      sample: merchants.slice(0, 8).map((m) => ({ name: m.name, category: m.category || '', shopNo: m.shopNo || '', status: m.status, openDate: m.openDate || '' })),
    },
  };
  if (extra && extra.floorDetail) ctx.floorDetail = extra.floorDetail;
  if (extra && extra.detail) ctx.detail = extra.detail;
  if (extra && extra.merchantDetail) ctx.merchantDetail = extra.merchantDetail;
  return ctx;
}
route('POST', '/api/ai/chat', async (req, res, p, body) => {
  requireUser(req);
  if (!Array.isArray(body.messages) || !body.messages.length) return send(res, 400, { error: '缺少对话消息' });
  const ctx = buildAIContext(body.projectId || '', body.extra);
  const r = await ai.chat(body.messages, { model: body.model, context: ctx });
  return send(res, 200, { content: r.content, mode: r.mode, model: r.model });
});

// Zones
route('GET', '/api/zones', async (req, res) => {
  requireUser(req);
  return send(res, 200, { zones: db.list('zones') });
});
route('GET', '/api/floors/:fid/zones', async (req, res, p) => {
  requireUser(req);
  return send(res, 200, { zones: db.list('zones').filter((z) => z.floorId === p.fid) });
});
route('POST', '/api/zones', async (req, res, p, body) => {
  const u = requireUser(req);
  const z = { id: db.genId('zon'), floorId: body.floorId, name: body.name };
  db.insert('zones', z); audit(u, 'CREATE_ZONE', 'Zone', z.id, null, z.name, req);
  return send(res, 200, { zone: z });
});
route('DELETE', '/api/zones/:id', async (req, res, p) => {
  const u = requireUser(req); db.remove('zones', p.id); return send(res, 200, { ok: true });
});

// Positions (区域位置 - leaf locations under zones)
route('GET', '/api/zones/:zid/positions', async (req, res, p) => {
  requireUser(req);
  return send(res, 200, { positions: db.list('positions').filter((x) => x.zoneId === p.zid) });
});
route('GET', '/api/projects/:pid/positions', async (req, res, p) => {
  requireUser(req);
  const floors = new Set(db.list('floors').filter((f) => f.projectId === p.pid).map((f) => f.id));
  const positions = db.list('positions').filter((x) => floors.has(x.floorId));
  return send(res, 200, { positions });
});
route('POST', '/api/positions', async (req, res, p, body) => {
  const u = requireUser(req);
  if (!body.zoneId) return send(res, 400, { error: '缺少所属区域' });
  const zone = db.get('zones', body.zoneId);
  const floor = zone ? db.get('floors', zone.floorId) : null;
  const now = new Date().toISOString();
  const pos = {
    id: db.genId('pos'), projectId: floor ? floor.projectId : (body.projectId || null),
    zoneId: body.zoneId, floorId: zone ? zone.floorId : (body.floorId || null),
    name: body.name || '', type: body.type || '', tags: Array.isArray(body.tags) ? body.tags : (body.tags ? String(body.tags).split(/[,，]/).map((s) => s.trim()).filter(Boolean) : []),
    createdAt: now, updatedAt: now,
  };
  db.insert('positions', pos); audit(u, 'CREATE_POSITION', 'Position', pos.id, null, pos.name, req);
  return send(res, 200, { position: pos });
});
route('PATCH', '/api/positions/:id', async (req, res, p, body) => {
  const u = requireUser(req);
  const before = db.get('positions', p.id); if (!before) return send(res, 404, { error: '位置不存在' });
  const patch = { updatedAt: new Date().toISOString() };
  ['name', 'type', 'tags'].forEach((k) => { if (k in body) patch[k] = body[k]; });
  if (body.tags) patch.tags = Array.isArray(body.tags) ? body.tags : String(body.tags).split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  const pos = db.update('positions', p.id, patch); audit(u, 'UPDATE_POSITION', 'Position', p.id, before.name, pos.name, req);
  return send(res, 200, { position: pos });
});
route('DELETE', '/api/positions/:id', async (req, res, p) => {
  const u = requireUser(req); const before = db.get('positions', p.id); db.remove('positions', p.id); audit(u, 'DELETE_POSITION', 'Position', p.id, before && before.name, null, req);
  return send(res, 200, { ok: true });
});

// Disciplines (settings, configurable - 框架3.1)
route('GET', '/api/disciplines', async (req, res) => {
  requireUser(req);
  return send(res, 200, { disciplines: db.list('disciplines') });
});
route('POST', '/api/disciplines', async (req, res, p, body) => {
  const u = requireRole(req, [C.ROLE.SUPER_ADMIN, C.ROLE.INSPECTION_LEAD, C.ROLE.PROJECT_MANAGER]);
  const d = { id: db.genId('dis'), name: body.name, active: true };
  db.insert('disciplines', d); audit(u, 'CREATE_DISCIPLINE', 'Discipline', d.id, null, d.name, req);
  return send(res, 200, { discipline: d });
});
route('PATCH', '/api/disciplines/:id', async (req, res, p, body) => {
  const u = requireUser(req);
  const d = db.update('disciplines', p.id, body); audit(u, 'UPDATE_DISCIPLINE', 'Discipline', p.id, d.name, d.name, req);
  return send(res, 200, { discipline: d });
});

// Organizations (责任单位)
route('GET', '/api/organizations', async (req, res) => {
  requireUser(req);
  return send(res, 200, { organizations: db.list('organizations') });
});
route('POST', '/api/organizations', async (req, res, p, body) => {
  const u = requireUser(req);
  const o = { id: db.genId('org'), name: body.name, type: body.type || C.ORG_TYPE.GENERAL, contact: body.contact || '' };
  db.insert('organizations', o); audit(u, 'CREATE_ORG', 'Organization', o.id, null, o.name, req);
  return send(res, 200, { organization: o });
});
route('PATCH', '/api/organizations/:id', async (req, res, p, body) => {
  const u = requireUser(req); const o = db.update('organizations', p.id, body); return send(res, 200, { organization: o });
});
route('DELETE', '/api/organizations/:id', async (req, res, p) => {
  const u = requireUser(req); db.remove('organizations', p.id); return send(res, 200, { ok: true });
});

// Batches (查验批次, configurable - 框架3.2)
route('GET', '/api/projects/:pid/batches', async (req, res, p) => {
  requireUser(req);
  return send(res, 200, { batches: db.list('inspectionBatches').filter((b) => b.projectId === p.pid) });
});
route('POST', '/api/batches', async (req, res, p, body) => {
  const u = requireUser(req);
  const b = { id: db.genId('bat'), projectId: body.projectId, name: body.name, type: body.type || '开业前综合查验',
    status: '进行中', startDate: body.startDate || '', endDate: body.endDate || '' };
  db.insert('inspectionBatches', b); audit(u, 'CREATE_BATCH', 'Batch', b.id, null, b.name, req);
  return send(res, 200, { batch: b });
});
route('PATCH', '/api/batches/:id', async (req, res, p, body) => {
  const u = requireUser(req); const b = db.update('inspectionBatches', p.id, body); return send(res, 200, { batch: b });
});
route('DELETE', '/api/batches/:id', async (req, res, p) => {
  const u = requireUser(req); const before = db.get('inspectionBatches', p.id); if (!before) return send(res, 404, { error: '批次不存在' });
  db.remove('inspectionBatches', p.id);
  audit(u, 'DELETE_BATCH', 'Batch', p.id, before && before.name, null, req);
  return send(res, 200, { ok: true });
});

// Issues
route('GET', '/api/issues', async (req, res, p, body, query) => {
  requireUser(req);
  const all = issueFilter(query).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const page = Math.max(1, parseInt(query.page) || 1);
  const pageSize = Math.max(1, Math.min(500, parseInt(query.pageSize) || 1000));
  const total = all.length;
  const issues = all.slice((page - 1) * pageSize, page * pageSize);
  return send(res, 200, { issues: issues.map(enrichIssue), total, page, pageSize });
});
route('POST', '/api/issues', async (req, res, p, body) => {
  const u = requireUser(req);
  if (!body.projectId) return send(res, 400, { error: '缺少项目' });
  if (!body.title) return send(res, 400, { error: '缺少标题' });
  const disc = body.disciplineId ? db.get('disciplines', body.disciplineId) : null;
  const floor = body.floorId ? db.get('floors', body.floorId) : null;
  const zone = body.zoneId ? db.get('zones', body.zoneId) : null;
  const position = body.positionId ? db.get('positions', body.positionId) : null;
  const org = body.responsibleOrgId ? db.get('organizations', body.responsibleOrgId) : null;
  const batch = body.batchId ? db.get('inspectionBatches', body.batchId) : null;
  if (body.batchId && batch && batch.status !== '进行中') return send(res, 400, { error: '所选检查批次已' + (batch.status || '关闭') + '，无法绑定问题' });
  const issue = {
    id: db.genId('iss'),
    issueNo: db.genIssueNo(body.projectCode || ''),
    projectId: body.projectId,
    batchId: batch ? batch.id : null,
    batchName: batch ? batch.name : null,
    title: body.title,
    description: body.description || '',
    disciplineId: disc ? disc.id : null,
    disciplineName: disc ? disc.name : null,
    categoryName: body.categoryName || '',
    floorId: floor ? floor.id : null,
    floorName: floor ? floor.name : null,
    zoneId: zone ? zone.id : null,
    zoneName: zone ? zone.name : null,
    positionId: position ? position.id : null,
    positionName: position ? position.name : null,
    locationX: body.locationX != null ? Number(body.locationX) : null,
    locationY: body.locationY != null ? Number(body.locationY) : null,
    locationDesc: body.locationDesc || '',
    tenantId: body.tenantId || null,
    severity: body.severity || 'S3',
    priority: body.priority || 'P3',
    sourceType: body.sourceType || C.SOURCE_TYPE.MANUAL,
    sourceUserId: u.id,
    foundAt: body.foundAt || new Date().toISOString(),
    reportedTime: body.reportedTime || body.foundAt || new Date().toISOString(), // 报修时间（新增）
    completedTime: null, // 完工时间（整改提交时写入）
    photoIds: body.photoIds || [],
    videoIds: [],
    attachmentIds: [],
    suggestedAction: body.suggestedAction || '',
    standardReference: body.standardReference || '',
    responsibleOrgId: org ? org.id : null,
    responsibleOrgName: org ? org.name : null,
    responsibleUserId: body.responsibleUserId || null,
    responsibleUserName: body.responsibleUserName || '',
    rectificationStatus: C.ISSUE_STATUS.OPEN,
    rectificationDeadline: body.rectificationDeadline || null,
    rectificationDescription: '',
    rectificationPhotoIds: [],
    reinspectionStatus: null,
    reinspectionResult: null,
    reinspectionUserId: null,
    reinspectionAt: null,
    finalStatus: C.ISSUE_STATUS.OPEN,
    parentIssueId: null,
    duplicateOfIssueId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    closedAt: null,
  };
  db.insert('issues', issue);
  logHistory(issue, 'CREATE', null, C.ISSUE_STATUS.OPEN, u, '');
  audit(u, 'CREATE_ISSUE', 'Issue', issue.id, null, issue.issueNo + ' ' + issue.title, req);
  return send(res, 200, { issue: enrichIssue(issue) });
});
route('GET', '/api/issues/:id', async (req, res, p) => {
  requireUser(req);
  const issue = db.get('issues', p.id); if (!issue) return send(res, 404, { error: '问题不存在' });
  const rects = db.list('rectifications').filter((r) => r.issueId === p.id);
  const reins = db.list('reinspections').filter((r) => r.issueId === p.id);
  const history = db.list('issueHistory').filter((h) => h.issueId === p.id).sort((a,b)=>new Date(a.at)-new Date(b.at));
  return send(res, 200, { issue: enrichIssue(issue), rectifications: rects, reinspections: reins, history });
});
route('PATCH', '/api/issues/:id', async (req, res, p, body) => {
  const u = requireUser(req);
  const before = db.get('issues', p.id); if (!before) return send(res, 404, { error: '问题不存在' });
  // 解析关联名称
  if (body.disciplineId) { const d = db.get('disciplines', body.disciplineId); if (d) { body.disciplineName = d.name; } }
  if (body.floorId) { const f = db.get('floors', body.floorId); if (f) { body.floorName = f.name; } }
  if (body.zoneId) { const z = db.get('zones', body.zoneId); if (z) { body.zoneName = z.name; } }
  if (body.positionId) { const pos = db.get('positions', body.positionId); if (pos) { body.positionName = pos.name; } }
  if (body.responsibleOrgId) { const o = db.get('organizations', body.responsibleOrgId); if (o) { body.responsibleOrgName = o.name; } }
  if ('batchId' in body) {
    const b = body.batchId ? db.get('inspectionBatches', body.batchId) : null;
    body.batchName = b ? b.name : null;
    if (body.batchId && b && b.status !== '进行中') return send(res, 400, { error: '所选检查批次已' + b.status + '，无法绑定问题' });
  }
  body.updatedAt = new Date().toISOString();
  const issue = db.update('issues', p.id, body);
  audit(u, 'UPDATE_ISSUE', 'Issue', p.id, before.title, issue.title, req);
  return send(res, 200, { issue: enrichIssue(issue) });
});
route('DELETE', '/api/issues/:id', async (req, res, p) => {
  const u = requirePermission(req, 'issue_delete');
  const before = db.get('issues', p.id); if (!before) return send(res, 404, { error: '问题不存在' });
  db.remove('issues', p.id);
  audit(u, 'DELETE_ISSUE', 'Issue', p.id, before && before.issueNo, null, req);
  return send(res, 200, { ok: true });
});
// 批量删除问题（权限中心可管控 issue_delete）
route('POST', '/api/issues/batch-delete', async (req, res, p, body) => {
  const u = requirePermission(req, 'issue_delete');
  const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
  if (!ids.length) return send(res, 400, { error: '请选择要删除的问题' });
  let removed = 0;
  ids.forEach((id) => {
    const before = db.get('issues', id);
    if (before) { db.remove('issues', id); audit(u, 'DELETE_ISSUE', 'Issue', id, before.issueNo, null, req); removed++; }
  });
  return send(res, 200, { ok: true, removed });
});

// Transition (状态机强制 - 框架54条)
route('POST', '/api/issues/:id/transition', async (req, res, p, body) => {
  const u = requireUser(req);
  const issue = db.get('issues', p.id); if (!issue) return send(res, 404, { error: '问题不存在' });
  const action = body.action;
  const from = issue.rectificationStatus || issue.finalStatus;
  let to;
  try { to = sm.nextStatus(from, action); } catch (e) { return send(res, 400, { error: e.message }); }
  const patch = { rectificationStatus: to, finalStatus: to, updatedAt: new Date().toISOString() };
  if (to === C.ISSUE_STATUS.CLOSED) patch.closedAt = new Date().toISOString();
  const updated = db.update('issues', p.id, patch);
  logHistory(updated, action, from, to, u, body.note || '');
  audit(u, 'TRANSITION_' + action, 'Issue', p.id, from, to, req);
  return send(res, 200, { issue: enrichIssue(updated) });
});

// Assign (指派责任单位)
route('POST', '/api/issues/:id/assign', async (req, res, p, body) => {
  const u = requireUser(req);
  const issue = db.get('issues', p.id); if (!issue) return send(res, 404, { error: '问题不存在' });
  const org = body.responsibleOrgId ? db.get('organizations', body.responsibleOrgId) : null;
  const patch = {
    responsibleOrgId: org ? org.id : issue.responsibleOrgId,
    responsibleOrgName: org ? org.name : issue.responsibleOrgName,
    responsibleUserId: body.responsibleUserId || issue.responsibleUserId,
    responsibleUserName: body.responsibleUserName || issue.responsibleUserName,
    rectificationDeadline: body.rectificationDeadline || issue.rectificationDeadline,
    updatedAt: new Date().toISOString(),
  };
  const from = issue.rectificationStatus;
  if (from === C.ISSUE_STATUS.OPEN || from === C.ISSUE_STATUS.PENDING || from === C.ISSUE_STATUS.REJECTED) {
    patch.rectificationStatus = C.ISSUE_STATUS.ASSIGNED; patch.finalStatus = C.ISSUE_STATUS.ASSIGNED;
    logHistory(issue, 'ASSIGN', from, C.ISSUE_STATUS.ASSIGNED, u, '');
    audit(u, 'ASSIGN', 'Issue', p.id, from, C.ISSUE_STATUS.ASSIGNED, req);
  } else {
    audit(u, 'REASSIGN', 'Issue', p.id, issue.responsibleOrgName, org && org.name, req);
  }
  const updated = db.update('issues', p.id, patch);
  return send(res, 200, { issue: enrichIssue(updated) });
});

// Rectify (整改提交)
route('POST', '/api/issues/:id/rectify', async (req, res, p, body) => {
  const u = requireUser(req);
  const issue = db.get('issues', p.id); if (!issue) return send(res, 404, { error: '问题不存在' });
  const rect = {
    id: db.genId('rec'), issueId: p.id,
    orgId: issue.responsibleOrgId, userId: u.id,
    planDate: issue.rectificationDeadline || '',
    actualDate: body.actualDate || new Date().toISOString(),
    description: body.description || '',
    beforePhotos: body.beforePhotos || issue.rectificationPhotoIds || [],
    afterPhotos: body.afterPhotos || [],
    attachments: body.attachments || [],
    selfCheck: body.selfCheck || '',
    at: new Date().toISOString(),
  };
  db.insert('rectifications', rect);
  // 状态推进 RECTIFYING -> SUBMITTED
  const from = issue.rectificationStatus;
  let to = from;
  if (from === C.ISSUE_STATUS.ASSIGNED) { to = C.ISSUE_STATUS.RECTIFYING; logHistory(issue, 'START_RECTIFICATION', from, to, u, ''); }
  if (to === C.ISSUE_STATUS.RECTIFYING || from === C.ISSUE_STATUS.RECTIFYING) { to = C.ISSUE_STATUS.SUBMITTED; }
  const patch = { rectificationStatus: to, finalStatus: to, rectificationDescription: rect.description,
    rectificationPhotoIds: rect.afterPhotos, updatedAt: new Date().toISOString() };
  // 完工时间：优先取表单填报，其次实际完成日期，最后当前时间
  patch.completedTime = body.completedTime || (body.actualDate ? new Date(body.actualDate).toISOString() : new Date().toISOString());
  const updated = db.update('issues', p.id, patch);
  logHistory(updated, 'SUBMIT', from, to, u, '');
  audit(u, 'RECTIFY', 'Issue', p.id, from, to, req);
  return send(res, 200, { issue: enrichIssue(updated), rectification: rect });
});

// Reinspect (复查)
route('POST', '/api/issues/:id/reinspect', async (req, res, p, body) => {
  const u = requireUser(req);
  const issue = db.get('issues', p.id); if (!issue) return send(res, 404, { error: '问题不存在' });
  const result = body.result === C.REINSPECTION_RESULT.PASS ? C.REINSPECTION_RESULT.PASS : C.REINSPECTION_RESULT.FAIL;
  const from = issue.rectificationStatus;
  const toRe = C.ISSUE_STATUS.REINSPECTION;
  // 推进到复查中
  const patchRe = { rectificationStatus: toRe, finalStatus: toRe, reinspectionStatus: toRe, updatedAt: new Date().toISOString() };
  let updated = db.update('issues', p.id, patchRe);
  logHistory(updated, 'REINSPECT', from, toRe, u, '');
  const reins = {
    id: db.genId('rei'), issueId: p.id, userId: u.id,
    at: new Date().toISOString(), result, note: body.note || '',
    photos: body.photos || [],
  };
  db.insert('reinspections', reins);
  // 最终结果
  const final = result === C.REINSPECTION_RESULT.PASS ? C.ISSUE_STATUS.CLOSED : C.ISSUE_STATUS.RECTIFYING;
  const patchFin = { rectificationStatus: final, finalStatus: final, reinspectionResult: result,
    reinspectionUserId: u.id, reinspectionAt: reins.at,
    closedAt: result === C.REINSPECTION_RESULT.PASS ? new Date().toISOString() : null,
    updatedAt: new Date().toISOString() };
  updated = db.update('issues', p.id, patchFin);
  logHistory(updated, result === C.REINSPECTION_RESULT.PASS ? 'PASS' : 'FAIL', toRe, final, u, body.note || '');
  audit(u, 'REINSPECT_' + result, 'Issue', p.id, toRe, final, req);
  return send(res, 200, { issue: enrichIssue(updated), reinspection: reins });
});

// Uploads (base64 -> file)
route('POST', '/api/uploads', async (req, res, p, body) => {
  const u = requireUser(req);
  const { filename, data } = body; // data: base64
  if (!data) return send(res, 400, { error: '缺少数据' });
  const ext = (filename || 'bin').split('.').pop().split('?')[0].slice(0, 5);
  const fname = db.genId('up') + '.' + ext;
  const buf = Buffer.from(data, 'base64');
  fs.writeFileSync(path.join(UPLOAD_DIR, fname), buf);
  return send(res, 200, { url: '/api/uploads/' + fname, file: fname });
});
route('GET', '/api/uploads/:file', async (req, res, p) => {
  const fp = path.join(UPLOAD_DIR, path.basename(p.file));
  if (!fs.existsSync(fp)) return send(res, 404, 'not found');
  const ext = fp.split('.').pop();
  const mime = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp', mp4:'video/mp4', pdf:'application/pdf' }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  const st = fs.createReadStream(fp);
  // 客户端中途断开（刷新/关闭/断网）会触发流 error，必须兜底，否则进程崩溃
  st.on('error', (e) => { console.error('[stream-err]', e.message); res.destroy(); });
  st.pipe(res);
});

// ============ 商户进场资料库 (V1.5) ============
// —— 辅助 ——
function enrichMerchant(m) {
  if (!m) return m;
  const o = { ...m };
  if (m.floorId && !o.floorName) { const f = db.get('floors', m.floorId); o.floorName = f ? f.name : ''; }
  const docs = db.list('merchantDocs').filter((d) => d.merchantId === m.id);
  const dtById = Object.fromEntries(db.list('docTypes').map((t) => [t.id, t]));
  o.progress = metrics.merchantProgress(docs, dtById);
  o.docTotal = docs.length;
  o.rejectedCount = docs.filter((d) => d.status === C.DOC_STATUS.REJECTED).length;
  return o;
}
// 按业态生成该商户的资料清单（幂等：已存在条目跳过）
function generateMerchantDocs(m) {
  const types = db.list('docTypes').filter((t) => t.active !== false &&
    (t.categories.includes('*') || t.categories.includes(m.category || '')));
  const exist = db.list('merchantDocs').filter((d) => d.merchantId === m.id).map((d) => d.docTypeId);
  const now = new Date().toISOString();
  types.forEach((t) => {
    if (!exist.includes(t.id)) {
      db.insert('merchantDocs', {
        id: db.genId('md'), merchantId: m.id, docTypeId: t.id,
        status: C.DOC_STATUS.MISSING, fileUrl: '', fileName: '',
        expireDate: null, rejectedReason: '',
        submittedBy: '', submittedAt: null, verifiedBy: '', verifiedAt: null,
        createdAt: now, updatedAt: now,
      });
    }
  });
  return types.length;
}
// 资料类型库（可配置）
route('GET', '/api/doc-types', async (req, res) => {
  requirePermission(req, 'merchant_view');
  const list = db.list('docTypes').slice().sort((a, b) => (a.sort || 0) - (b.sort || 0) || String(a.name).localeCompare(String(b.name)));
  return send(res, 200, { docTypes: list, bizCategories: getBizCategories() });
});
route('POST', '/api/doc-types', async (req, res, p, body) => {
  requirePermission(req, 'merchant_manage');
  const { name, hint, categories, required, needVerify, hasExpiry, remindDays, sort } = body;
  if (!name || !name.trim()) return send(res, 400, { error: '请填写资料名称' });
  const t = {
    id: db.genId('dt'), name: name.trim(), hint: hint || '',
    categories: (categories && categories.length ? categories : ['*']),
    required: required !== false, needVerify: needVerify !== false,
    hasExpiry: !!hasExpiry, remindDays: Number(remindDays) || 0,
    sort: Number(sort) || 0, active: true,
    createdAt: new Date().toISOString(),
  };
  db.insert('docTypes', t);
  audit(reqUser, 'DOC_TYPE_CREATE', 'DocType', t.id, null, t, req);
  return send(res, 200, { docType: t });
});
route('PATCH', '/api/doc-types/:id', async (req, res, p, body) => {
  requirePermission(req, 'merchant_manage');
  const t = db.get('docTypes', p.id);
  if (!t) return send(res, 404, { error: '资料类型不存在' });
  const before = { ...t };
  const patch = { name: body.name, hint: body.hint, categories: body.categories, required: body.required, needVerify: body.needVerify, hasExpiry: body.hasExpiry, remindDays: Number(body.remindDays), sort: Number(body.sort), active: body.active };
  Object.keys(patch).forEach((k) => { if (patch[k] === undefined) delete patch[k]; });
  const updated = db.update('docTypes', p.id, { ...patch, updatedAt: new Date().toISOString() });
  audit(reqUser, 'DOC_TYPE_UPDATE', 'DocType', p.id, before, updated, req);
  return send(res, 200, { docType: updated });
});
route('DELETE', '/api/doc-types/:id', async (req, res, p) => {
  requirePermission(req, 'merchant_manage');
  const t = db.get('docTypes', p.id);
  if (!t) return send(res, 404, { error: '资料类型不存在' });
  const used = db.list('merchantDocs').some((d) => d.docTypeId === p.id);
  if (used) return send(res, 400, { error: '该资料类型已有商户在用，无法删除，可改为停用' });
  db.remove('docTypes', p.id);
  audit(reqUser, 'DOC_TYPE_DELETE', 'DocType', p.id, t, null, req);
  return send(res, 200, { ok: true });
});

// 商户列表（支持筛选）
route('GET', '/api/merchants', async (req, res, p, body, query) => {
  requirePermission(req, 'merchant_view');
  const { projectId, category, status, keyword } = query;
  let list = db.list('merchants').slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  list = list.filter((m) => {
    if (projectId && m.projectId !== projectId) return false;
    if (category && m.category !== category) return false;
    if (status && m.status !== status) return false;
    if (keyword && !(`${m.name}${m.brand || ''}${m.shopNo || ''}${m.contactName || ''}`.includes(keyword))) return false;
    return true;
  });
  return send(res, 200, { merchants: list.map(enrichMerchant) });
});
route('POST', '/api/merchants', async (req, res, p, body) => {
  requirePermission(req, 'merchant_manage');
  const { name, brand, category, floorId, shopNo, contactName, contactPhone, legalPerson, entryDate, openDate, notes, projectId } = body;
  if (!name || !name.trim()) return send(res, 400, { error: '请填写商户名称' });
  const now = new Date().toISOString();
  const m = {
    id: db.genId('mer'), projectId: projectId || (db.list('projects')[0] || {}).id || null,
    name: name.trim(), brand: brand || '', category: category || '其他',
    floorId: floorId || null, shopNo: shopNo || '',
    contactName: contactName || '', contactPhone: contactPhone || '',
    legalPerson: legalPerson || '', businessScope: body.businessScope || '',
    entryDate: entryDate || '', openDate: openDate || '', notes: notes || '',
    status: C.MERCHANT_STATUS.DRAFT,
    createdAt: now, updatedAt: now,
  };
  db.insert('merchants', m);
  audit(reqUser, 'MERCHANT_CREATE', 'Merchant', m.id, null, m, req);
  return send(res, 200, { merchant: enrichMerchant(m) });
});
route('PATCH', '/api/merchants/:id', async (req, res, p, body) => {
  requirePermission(req, 'merchant_manage');
  const m = db.get('merchants', p.id);
  if (!m) return send(res, 404, { error: '商户不存在' });
  const before = { ...m };
  const allowed = ['name', 'brand', 'category', 'floorId', 'shopNo', 'contactName', 'contactPhone', 'legalPerson', 'businessScope', 'entryDate', 'openDate', 'notes'];
  const patch = {};
  allowed.forEach((k) => { if (body[k] !== undefined) patch[k] = body[k]; });
  const updated = db.update('merchants', p.id, { ...patch, updatedAt: new Date().toISOString() });
  audit(reqUser, 'MERCHANT_UPDATE', 'Merchant', p.id, before, updated, req);
  return send(res, 200, { merchant: enrichMerchant(updated) });
});
route('DELETE', '/api/merchants/:id', async (req, res, p) => {
  requirePermission(req, 'merchant_manage');
  const m = db.get('merchants', p.id);
  if (!m) return send(res, 404, { error: '商户不存在' });
  db.remove('merchants', p.id);
  db.removeWhere('merchantDocs', (d) => d.merchantId === p.id);
  // 同步解除该商户在房源中的配对
  db.list('rooms').forEach((r) => { if (r.merchantId === p.id) db.update('rooms', r.id, { merchantId: null, updatedAt: new Date().toISOString() }); });
  audit(reqUser, 'MERCHANT_DELETE', 'Merchant', p.id, m, null, req);
  return send(res, 200, { ok: true });
});
// 按业态一键生成资料清单（幂等）
route('POST', '/api/merchants/:id/generate-docs', async (req, res, p) => {
  requirePermission(req, 'merchant_manage');
  const m = db.get('merchants', p.id);
  if (!m) return send(res, 404, { error: '商户不存在' });
  const n = generateMerchantDocs(m);
  audit(reqUser, 'MERCHANT_GEN_DOCS', 'Merchant', p.id, null, { count: n }, req);
  return send(res, 200, { generated: n });
});
// 商户状态流转（走状态机）
route('POST', '/api/merchants/:id/status', async (req, res, p, body) => {
  requirePermission(req, 'merchant_manage');
  const m = db.get('merchants', p.id);
  if (!m) return send(res, 404, { error: '商户不存在' });
  const { action } = body;
  // 开始收集时自动按业态生成资料清单（人性化：少点一步）
  if (action === 'START' && !db.list('merchantDocs').some((d) => d.merchantId === m.id)) {
    generateMerchantDocs(m);
  }
  // 完成前校验：全部必传资料必须已核验通过（人性化提示）
  if (action === 'COMPLETE') {
    const docs = db.list('merchantDocs').filter((d) => d.merchantId === m.id);
    const dtById = Object.fromEntries(db.list('docTypes').map((t) => [t.id, t]));
    const need = docs.filter((d) => dtById[d.docTypeId] && dtById[d.docTypeId].required);
    const unpassed = need.filter((d) => d.status !== C.DOC_STATUS.VERIFIED);
    if (unpassed.length) {
      const names = unpassed.slice(0, 3).map((d) => (dtById[d.docTypeId] || {}).name || '未知').join('、');
      return send(res, 400, { error: `还有 ${unpassed.length} 项必传资料未通过（${names}…），请先完成核验` });
    }
  }
  const from = m.status;
  const to = sm.transitionOf(C.MERCHANT_TRANSITIONS, from, action);
  const updated = db.update('merchants', p.id, { status: to, updatedAt: new Date().toISOString() });
  audit(reqUser, 'MERCHANT_STATUS_' + action, 'Merchant', p.id, from, to, req);
  return send(res, 200, { merchant: enrichMerchant(updated) });
});

// 商户资料清单（join 资料类型信息）
route('GET', '/api/merchants/:id/docs', async (req, res, p) => {
  requirePermission(req, 'merchant_view');
  const m = db.get('merchants', p.id);
  if (!m) return send(res, 404, { error: '商户不存在' });
  const dtById = Object.fromEntries(db.list('docTypes').map((t) => [t.id, t]));
  const docs = db.list('merchantDocs').filter((d) => d.merchantId === p.id)
    .map((d) => ({ ...d, docType: dtById[d.docTypeId] || null }))
    .sort((a, b) => {
      const ta = a.docType || {}, tb = b.docType || {};
      return ((ta.sort || 0) - (tb.sort || 0)) || String(ta.name || '').localeCompare(String(tb.name || ''));
    });
  return send(res, 200, { merchant: enrichMerchant(m), docs });
});
// 资料项状态流转（SUBMIT/VERIFY/REJECT/RESET，走状态机）
route('POST', '/api/merchant-docs/:id/status', async (req, res, p, body) => {
  requirePermission(req, 'merchant_manage');
  const d = db.get('merchantDocs', p.id);
  if (!d) return send(res, 404, { error: '资料项不存在' });
  const { action, reason, expireDate } = body;
  if (action === 'SUBMIT' && !d.fileUrl) return send(res, 400, { error: '请先上传资料文件再提交' });
  if (action === 'REJECT' && !(reason && reason.trim())) return send(res, 400, { error: '驳回时请填写原因，方便商户补齐' });
  const from = d.status;
  const to = sm.transitionOf(C.DOC_TRANSITIONS, from, action);
  const u = reqUser(req);
  const patch = { status: to, updatedAt: new Date().toISOString(), rejectedReason: '' };
  if (action === 'SUBMIT') { patch.submittedBy = u.id; patch.submittedAt = new Date().toISOString(); }
  if (action === 'VERIFY') { patch.verifiedBy = u.id; patch.verifiedAt = new Date().toISOString(); if (expireDate) patch.expireDate = expireDate; }
  if (action === 'REJECT') { patch.rejectedReason = (reason || '').trim(); }
  const updated = db.update('merchantDocs', p.id, patch);
  audit(u, 'DOC_' + action, 'MerchantDoc', p.id, { from, fileUrl: d.fileUrl }, { to, reason }, req);
  return send(res, 200, { doc: updated });
});
// 资料项绑定上传文件
route('POST', '/api/merchant-docs/:id/upload', async (req, res, p, body) => {
  requirePermission(req, 'merchant_manage');
  const d = db.get('merchantDocs', p.id);
  if (!d) return send(res, 404, { error: '资料项不存在' });
  const { fileUrl, fileName } = body;
  if (!fileUrl) return send(res, 400, { error: '缺少文件地址' });
  const updated = db.update('merchantDocs', p.id, { fileUrl, fileName: fileName || fileUrl.split('/').pop() || '', updatedAt: new Date().toISOString() });
  audit(reqUser, 'DOC_UPLOAD', 'MerchantDoc', p.id, null, { fileUrl }, req);
  return send(res, 200, { doc: updated });
});

// 商户资料库总览统计
route('GET', '/api/merchant-summary', async (req, res, p, body, query) => {
  requirePermission(req, 'merchant_view');
  const { projectId } = query;
  let merchants = db.list('merchants');
  if (projectId) merchants = merchants.filter((m) => m.projectId === projectId);
  const summary = metrics.getMerchantSummary(
    merchants, db.list('merchantDocs'), db.list('docTypes'), new Date().toISOString()
  );
  return send(res, 200, { summary });
});


route('GET', '/api/projects/:pid/dashboard', async (req, res, p, body, query) => {
  requireUser(req);
  const now = new Date().toISOString();
  const issues = issueFilter({ ...query, projectId: p.pid });
  const issueIds = new Set(issues.map((i) => i.id));
  const reins = db.list('reinspections').filter((r) => issueIds.has(r.issueId));
  const rects = db.list('rectifications').filter((r) => issueIds.has(r.issueId));
  const orgsById = Object.fromEntries(db.list('organizations').map((o) => [o.id, o]));
  const scorecard = metrics.getScorecard(issues, reins, rects, now);
  return send(res, 200, {
    scorecard,
    severity: metrics.getSeverityDistribution(issues),
    discipline: metrics.getDisciplineDistribution(issues),
    floor: metrics.getFloorDistribution(issues),
    responsibility: metrics.getResponsibilityRanking(issues, orgsById),
    trend: metrics.getDailyTrend(issues, reins, 14),
    total: issues.length,
  });
});

// 局域网访问信息（公开，供前端生成手机可扫的二维码基址）
route('GET', '/api/network', async (req, res) => {
  return send(res, 200, { ip: getLanIp(), port: PORT });
});

// 问题只读分享（公开，供手机扫码免登录查看）。token 为每问题随机串，不可猜测。
route('GET', '/api/share/issue/:token', async (req, res, p) => {
  const issue = db.list('issues').find((i) => i.shareToken === p.token);
  if (!issue) return send(res, 404, { error: '分享链接无效或已失效' });
  const e = enrichIssue(issue);
  const rects = db.list('rectifications').filter((r) => r.issueId === issue.id);
  const reins = db.list('reinspections').filter((r) => r.issueId === issue.id);
  return send(res, 200, {
    issue: e,
    photoUrls: (issue.photoIds || []),
    rectifications: rects,
    reinspections: reins,
    statusLabel: C.ISSUE_STATUS_LABEL[e.rectificationStatus] || e.rectificationStatus,
    severityLabel: C.SEVERITY_LABEL[e.severity] || '',
  });
});

// 统计表（可多个、可自由编辑）
route('GET', '/api/projects/:pid/statboards', async (req, res, p) => {
  requireUser(req);
  const list = db.list('statBoards').filter((b) => b.projectId === p.pid);
  return send(res, 200, { statBoards: list });
});
route('POST', '/api/projects/:pid/statboards', async (req, res, p, body) => {
  requireUser(req);
  const board = {
    id: db.genId('sb'), projectId: p.pid,
    name: (body.name || '未命名统计表').trim() || '未命名统计表',
    isDefault: !!body.isDefault,
    onDashboard: !!body.onDashboard,
    filters: body.filters || {},
    tiles: Array.isArray(body.tiles) ? body.tiles : ['total', 'open', 'closed', 'overdue'],
    charts: Array.isArray(body.charts) ? body.charts : ['trend', 'severity', 'discipline', 'floor', 'responsibility'],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  if (board.isDefault) db.list('statBoards').forEach((b) => { if (b.projectId === p.pid) db.update('statBoards', b.id, { isDefault: false }); });
  db.insert('statBoards', board);
  return send(res, 200, { statBoard: board });
});
route('PATCH', '/api/projects/:pid/statboards/:id', async (req, res, p, body) => {
  requireUser(req);
  const cur = db.get('statBoards', p.id); if (!cur) return send(res, 404, { error: '统计表不存在' });
  const patch = {};
  ['name', 'isDefault', 'onDashboard', 'filters', 'tiles', 'charts'].forEach((k) => { if (k in body) patch[k] = body[k]; });
  patch.updatedAt = new Date().toISOString();
  if (patch.isDefault) db.list('statBoards').forEach((b) => { if (b.projectId === p.pid && b.id !== p.id) db.update('statBoards', b.id, { isDefault: false }); });
  const updated = db.update('statBoards', p.id, patch);
  return send(res, 200, { statBoard: updated });
});
route('DELETE', '/api/projects/:pid/statboards/:id', async (req, res, p) => {
  requireUser(req);
  const ok = db.remove('statBoards', p.id);
  return send(res, 200, { ok });
});

// Excel export/import
route('GET', '/api/projects/:pid/issues/export', async (req, res, p, body, query) => {
  requireUser(req);
  ensureCookie(req, res);
  const issues = issueFilter({ ...query, projectId: p.pid });
  const headers = ['序号','问题编号','标题','描述','专业','问题大类','楼层','区域','位置','检查批次','严重度','优先级','发现时间','责任单位','责任人','计划完成日期','整改说明','建议措施','标准依据','状态'];
  const rows = issues.map((i, idx) => [idx + 1, i.issueNo, i.title, i.description, i.disciplineName, i.categoryName, i.floorName, i.zoneName, i.positionName, i.batchName,
    C.SEVERITY_LABEL[i.severity] || i.severity, C.PRIORITY_LABEL[i.priority] || i.priority, (i.foundAt||'').slice(0,10), i.responsibleOrgName, i.responsibleUserName, (i.rectificationDeadline||'').slice(0,10),
    i.rectificationDescription, i.suggestedAction, i.standardReference,
    C.ISSUE_STATUS_LABEL[i.rectificationStatus || i.finalStatus] || i.rectificationStatus || '']);
  const format = query.format || 'csv';
  if (format === 'xls') {
    const xml = excel.toHtmlSpreadsheet([{ name: '问题导出', rows: [headers, ...rows] }]);
    res.writeHead(200, { 'Content-Type': 'application/vnd.ms-excel', 'Content-Disposition': 'attachment; filename="issues.xls"' });
    res.end(xml); return;
  }
  if (format === 'doc') {
    const thead = '<tr>' + headers.map((h) => `<th>${h}</th>`).join('') + '</tr>';
    const tbody = rows.map((r) => '<tr>' + r.map((c) => `<td>${String(c == null ? '' : c).replace(/</g, '&lt;')}</td>`).join('') + '</tr>').join('');
    const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>issues</title><style>table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px 8px;font-size:12px}</style></head><body><h2>承接查验问题清单</h2><table><thead>${thead}</thead><tbody>${tbody}</tbody></table></body></html>`;
    res.writeHead(200, { 'Content-Type': 'application/msword; charset=utf-8', 'Content-Disposition': 'attachment; filename="issues.doc"' });
    res.end(doc); return;
  }
  const csv = excel.toCSV([headers, ...rows]);
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="issues.csv"' });
  res.end('﻿' + csv); return;
});
route('GET', '/api/issues/template', async (req, res) => {
  requireUser(req);
  ensureCookie(req, res);
  const csv = excel.toCSV([excel.ISSUE_TEMPLATE_HEADERS]);
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="issue_import_template.csv"' });
  return res.end('﻿' + csv);
});
route('POST', '/api/projects/:pid/issues/import', async (req, res, p, body) => {
  const u = requireUser(req);
  const ctx = {
    disciplines: db.list('disciplines'),
    floors: db.list('floors').filter((f) => f.projectId === p.pid),
    zones: db.list('zones'),
    orgs: db.list('organizations'),
  };
  const result = excel.importIssuesFromCSV(body.csvText || '', ctx);
  if (result.errors && !result.inserted) return send(res, 200, { ok: 0, errors: result.errors });
  const proj = db.get('projects', p.pid);
  let n = 0;
  (result.inserted || []).forEach((it) => {
    const issue = {
      id: db.genId('iss'), issueNo: it.issueNo || db.genIssueNo(proj.code),
      projectId: p.pid, batchId: null, title: it.title, description: it.description || '',
      disciplineId: it.disciplineId, disciplineName: it.disciplineName, categoryName: it.categoryName || '',
      floorId: it.floorId, floorName: it.floorName, zoneId: it.zoneId, zoneName: it.zoneName,
      tenantId: null, severity: it.severity, priority: it.priority,
      sourceType: C.SOURCE_TYPE.MANUAL, sourceUserId: u.id, foundAt: it.foundAt,
      photoIds: [], videoIds: [], attachmentIds: [],
      suggestedAction: it.suggestedAction || '', standardReference: it.standardReference || '',
      responsibleOrgId: it.responsibleOrgId, responsibleOrgName: it.responsibleOrgName,
      responsibleUserId: null, responsibleUserName: it.responsibleUserName || '',
      rectificationStatus: C.ISSUE_STATUS.OPEN, rectificationDeadline: it.rectificationDeadline,
      rectificationDescription: it.rectificationDescription || '', rectificationPhotoIds: [],
      reinspectionStatus: null, reinspectionResult: null, reinspectionUserId: null, reinspectionAt: null,
      finalStatus: C.ISSUE_STATUS.OPEN, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), closedAt: null,
    };
    db.insert('issues', issue); n++;
  });
  audit(u, 'IMPORT_ISSUES', 'Issue', p.pid, null, '导入' + n + '条', req);
  return send(res, 200, { ok: n, errors: result.errors || [] });
});

// Reports
route('POST', '/api/reports/generate', async (req, res, p, body) => {
  const u = requireUser(req);
  const projectId = body.projectId; const type = body.type || 'summary';
  const project = db.get('projects', projectId); if (!project) return send(res, 404, { error: '项目不存在' });
  const issues = db.list('issues').filter((i) => i.projectId === projectId).map(enrichIssue);
  const issueIds = new Set(issues.map((i) => i.id));
  const reins = db.list('reinspections').filter((r) => issueIds.has(r.issueId));
  const rects = db.list('rectifications').filter((r) => issueIds.has(r.issueId)).map((r) => ({ ...r, issueTitle: (issues.find(i=>i.id===r.issueId)||{}).title }));
  const orgsById = Object.fromEntries(db.list('organizations').map((o) => [o.id, o]));
  const now = new Date().toISOString();
  const scorecard = metrics.getScorecard(issues, reins, rects, now);
  const responsibility = metrics.getResponsibilityRanking(issues, orgsById);
  const ctx = {
    project, issues, reinspections: reins, rectifications: rects, scorecard, now,
    responsibilityRanking: responsibility,
    generatedByName: u.name, generatedAt: new Date().toISOString(),
  };
  const { title, html } = reports.renderReport(type, ctx);
  const report = {
    id: db.genId('rep'), projectId, type, title,
    generatedBy: u.id, generatedByName: u.name,
    createdAt: new Date().toISOString(),
    snapshot: { issues: issues.length, scorecard },
  };
  db.insert('reports', report);
  // 保存静态 HTML 快照
  const htmlFile = path.join(__dirname, 'data', 'reports');
  if (!fs.existsSync(htmlFile)) fs.mkdirSync(htmlFile, { recursive: true });
  fs.writeFileSync(path.join(htmlFile, report.id + '.html'), html, 'utf8');
  return send(res, 200, { report: { ...report, html } });
});
route('GET', '/api/reports', async (req, res) => {
  requireUser(req);
  return send(res, 200, { reports: db.list('reports').sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)) });
});
route('GET', '/api/reports/:id', async (req, res, p) => {
  requireUser(req);
  const report = db.get('reports', p.id); if (!report) return send(res, 404, { error: '报告不存在' });
  return send(res, 200, { report });
});
route('GET', '/api/reports/:id/view', async (req, res, p) => {
  requireUser(req);
  ensureCookie(req, res);
  const fp = path.join(__dirname, 'data', 'reports', p.id + '.html');
  if (!fs.existsSync(fp)) return send(res, 404, '报告快照不存在');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  const st = fs.createReadStream(fp);
  st.on('error', (e) => { console.error('[stream-err]', e.message); res.destroy(); });
  st.pipe(res);
  return;
});
// 原生 Word 导出（.doc，Office 可打开，零依赖）
route('GET', '/api/reports/:id/export-doc', async (req, res, p) => {
  requireUser(req);
  ensureCookie(req, res);
  const fp = path.join(__dirname, 'data', 'reports', p.id + '.html');
  if (!fs.existsSync(fp)) return send(res, 404, '报告不存在');
  let html = fs.readFileSync(fp, 'utf8');
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] || html;
  const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><meta name="ProgId" content="Word.Document"><title>report</title></head><body>${body}</body></html>`;
  res.writeHead(200, { 'Content-Type': 'application/msword; charset=utf-8', 'Content-Disposition': 'attachment; filename="report_' + p.id + '.doc"' });
  res.end(doc); return;
});
// 原生 Excel 导出（HTML 表格伪 .xls，Excel 打开无"格式不匹配"警告）— 与问题中心列表一致的单 sheet
route('GET', '/api/projects/:pid/issues-export-xls', async (req, res, p, body, query) => {
  requireUser(req);
  ensureCookie(req, res);
  const all = issueFilter({ ...query, projectId: p.pid });
  const headers = ['序号','问题编号','标题','描述','专业','问题大类','楼层','区域','位置','检查批次','严重度','优先级','发现时间','责任单位','责任人','计划完成日期','整改说明','建议措施','标准依据','状态'];
  const rows = all.map((i, idx) => [idx + 1, i.issueNo, i.title, i.description, i.disciplineName, i.categoryName, i.floorName, i.zoneName, i.positionName, i.batchName,
    C.SEVERITY_LABEL[i.severity] || i.severity, C.PRIORITY_LABEL[i.priority] || i.priority, (i.foundAt||'').slice(0,10), i.responsibleOrgName, i.responsibleUserName, (i.rectificationDeadline||'').slice(0,10),
    i.rectificationDescription, i.suggestedAction, i.standardReference,
    C.ISSUE_STATUS_LABEL[i.rectificationStatus || i.finalStatus] || i.rectificationStatus || '']);
  const xml = excel.toHtmlSpreadsheet([{ name: '问题明细', rows: [headers, ...rows] }]);
  res.writeHead(200, { 'Content-Type': 'application/vnd.ms-excel', 'Content-Disposition': 'attachment; filename="issues.xls"' });
  res.end(xml); return;
});

// Audit
route('GET', '/api/audit', async (req, res, p, body, query) => {
  requireRole(req, [C.ROLE.SUPER_ADMIN, C.ROLE.PROJECT_MANAGER, C.ROLE.INSPECTION_LEAD]);
  let logs = db.list('auditLogs').sort((a,b)=>new Date(b.at)-new Date(a.at));
  if (query.entity) logs = logs.filter((l)=>l.entity===query.entity);
  if (query.limit) logs = logs.slice(0, parseInt(query.limit));
  return send(res, 200, { logs });
});

// ---------- static ----------
const MIME = { '.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.json':'application/json', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp', '.pdf':'application/pdf', '.doc':'application/msword', '.xls':'application/vnd.ms-excel' };
// 带版本指纹的静态资源（app.js?v=…）可长缓存；html 不缓存避免更新后拿旧壳
const LONG_CACHE = 604800, HTML_CACHE = 0;
function serveStatic(req, res, pathname) {
  let fp = pathname === '/' ? '/index.html' : pathname;
  fp = path.join(PUBLIC_DIR, path.normalize(fp).replace(/^(\.\.[/\\])+/, ''));
  if (!fp.startsWith(PUBLIC_DIR)) return send(res, 403, 'forbidden');
  if (!fs.existsSync(fp)) return send(res, 404, 'not found');
  const ext = path.extname(fp);
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
  if (ext === '.html') headers['Cache-Control'] = 'no-cache';
  else headers['Cache-Control'] = 'public, max-age=' + LONG_CACHE;
  respond(res._req || { headers: {} }, res, 200, headers, fs.readFileSync(fp));
}

// ---------- server ----------
// 启动时为已有问题补充分享令牌（保证手机扫码分享可用）
(function backfillShareTokens() {
  try {
    db.list('issues').forEach((i) => {
      if (!i.shareToken) db.update('issues', i.id, { shareToken: crypto.randomBytes(6).toString('hex') });
    });
  } catch (e) { /* 忽略 */ }
})();

const server = http.createServer(async (req, res) => {
  res._req = req; // 供 send/serveStatic 读取请求头（gzip 协商）
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const query = parsed.query || {};
  try {
    if (pathname.startsWith('/api/')) {
      const m = req.method;
      for (const r of routes) {
        if (r.method !== m) continue;
        const match = pathname.match(r.regex);
        if (!match) continue;
        const headerToken = getToken(req);
        const params = {};
        r.keys.forEach((k, idx) => (params[k] = decodeURIComponent(match[idx + 1])));
        const body = (m === 'POST' || m === 'PATCH' || m === 'DELETE') ? await readBody(req) : {};
        const out = await r.handler(req, res, params, body, query);
        if (out !== undefined && !res.writableEnded) {
          if (headerToken && sessions.has(headerToken) && !res.headersSent) res.setHeader('Set-Cookie', authCookie(headerToken));
          send(res, 200, out);
        } else if (headerToken && sessions.has(headerToken) && !res.headersSent) {
          res.setHeader('Set-Cookie', authCookie(headerToken));
        }
        return;
      }
      return send(res, 404, { error: '接口不存在: ' + pathname });
    }
    return serveStatic(req, res, pathname);
  } catch (e) {
    console.error('[err]', e);
    send(res, e.code || 500, { error: e.message || '服务器错误' });
  }
});

// 进程级兜底：单个请求的意外错误只记录日志，不让整个服务退出（演示/生产均适用）
process.on('uncaughtException', (e) => {
  console.error('[uncaught]', e && e.stack || e);
});
process.on('unhandledRejection', (e) => {
  console.error('[unhandledRejection]', e && e.stack || e);
});

// 启动：端口被占用（如 TIME_WAIT）时自动重试，避免直接崩溃
function startServer(attempt) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && attempt < 15) {
      console.log(`端口 ${PORT} 暂被占用，2 秒后重试 (${attempt}/15)…`);
      setTimeout(() => startServer(attempt + 1), 2000);
    } else { throw e; }
  });
  server.listen(PORT, () => {
    console.log(`\n  商场装修承接查验平台已启动`);
    console.log(`  ➜  http://localhost:${PORT}  （手机请用局域网地址访问）\n`);
  });
}
// 角色权限集合自动初始化（框架第28条：角色可配置，缺省时按常量兜底生成）
function seedRolesIfEmpty() {
  try {
    if (db.list('roles').length === 0) {
      C.DEFAULT_ROLES.forEach((r) => {
        db.insert('roles', {
          id: db.genId('role'), key: r.key, name: r.name, locked: !!r.locked,
          permissions: r.permissions.slice(), createdAt: new Date().toISOString(),
        });
      });
      db.save();
      console.log('✓ 已初始化 ' + C.DEFAULT_ROLES.length + ' 个默认角色（权限中心可用）');
    }
  } catch (e) { console.error('[seedRoles]', e && e.message); }
}
seedRolesIfEmpty();

// 演示数据自动兜底：云端实例首次启动（或重启回到镜像基线）时若库为空，
// 自动注入完整演示数据（项目/问题/商户/统计表等），保证登录即可用。
// 本地有数据时不会触发。可通过环境变量 AUTO_SEED=0 关闭。
function seedDemoIfEmpty() {
  if (process.env.AUTO_SEED === '0') return;
  try {
    if (db.list('users').length === 0) {
      const seed = require('./src/seed');
      seed.seed();
      db.save();
      console.log('✓ 已自动注入演示数据（用户/项目/问题/商户/统计表等）');
    }
  } catch (e) { console.error('[autoSeed]', e && e.message); }
}
seedDemoIfEmpty();

// 预置商户进场资料类型库自动初始化（可配置，仅首次生成）
function initDocTypesIfEmpty() {
  try {
    if (db.list('docTypes').length === 0) {
      C.DEFAULT_DOC_TYPES.forEach((t) => {
        db.insert('docTypes', {
          id: db.genId('dt'), name: t.name, hint: t.hint || '',
          categories: t.categories || ['*'], required: !!t.required,
          needVerify: t.needVerify !== false, hasExpiry: !!t.hasExpiry,
          remindDays: Number(t.remindDays) || 0, sort: Number(t.sort) || 0,
          active: true, createdAt: new Date().toISOString(),
        });
      });
      db.save();
      console.log('✓ 已初始化商户进场资料类型库（' + C.DEFAULT_DOC_TYPES.length + ' 项，可在“商户资料→资料类型”调整）');
    }
  } catch (e) { console.error('[initDocTypes]', e && e.message); }
}
initDocTypesIfEmpty();

startServer(1);

module.exports = server;
