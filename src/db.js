'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const EMPTY_DB = {
  users: [],
  organizations: [],
  projects: [],
  floors: [],
  zones: [],
  positions: [],
  tenants: [],
  disciplines: [],
  issueCategories: [],
  checkpoints: [],
  inspectionBatches: [],
  inspectionTasks: [],
  issues: [],
  issueHistory: [],
  rectifications: [],
  reinspections: [],
  notifications: [],
  reports: [],
  reportTemplates: [],
  auditLogs: [],
  statBoards: [],
  merchants: [],
  docTypes: [],
  merchantDocs: [],
  rooms: [],
  bizCategories: [],
  meta: { seq: {} },
};

let cache = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  if (cache) return cache;
  ensureDir();
  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      cache = Object.assign({}, JSON.parse(JSON.stringify(EMPTY_DB)), JSON.parse(raw));
    } catch (e) {
      console.error('[db] 读取失败，使用空库:', e.message);
      cache = JSON.parse(JSON.stringify(EMPTY_DB));
    }
  } else {
    cache = JSON.parse(JSON.stringify(EMPTY_DB));
  }
  return cache;
}

let saveTimer = null;
function save() {
  ensureDir();
  // 同步写，保证演示数据不丢
  fs.writeFileSync(DB_FILE, JSON.stringify(cache, null, 2), 'utf8');
}
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; save(); }, 200);
}

function genId(prefix) {
  const db = load();
  db.meta.seq[prefix] = (db.meta.seq[prefix] || 0) + 1;
  const n = db.meta.seq[prefix];
  return `${prefix}_${Date.now().toString(36)}${n.toString(36)}`;
}

function genIssueNo(projectCode) {
  const db = load();
  const key = 'issue_' + (projectCode || 'GEN');
  db.meta.seq[key] = (db.meta.seq[key] || 0) + 1;
  const year = new Date().getFullYear();
  return `ISS-${year}-${String(db.meta.seq[key]).padStart(6, '0')}`;
}

// 通用集合操作
function list(collection) {
  const db = load();
  return db[collection] || [];
}
function get(collection, id) {
  return list(collection).find((x) => x.id === id) || null;
}
function insert(collection, obj) {
  const db = load();
  if (!db[collection]) db[collection] = [];
  db[collection].push(obj);
  saveSoon();
  return obj;
}
function update(collection, id, patch) {
  const db = load();
  const arr = db[collection] || [];
  const idx = arr.findIndex((x) => x.id === id);
  if (idx === -1) return null;
  arr[idx] = Object.assign({}, arr[idx], patch);
  saveSoon();
  return arr[idx];
}
function remove(collection, id) {
  const db = load();
  const arr = db[collection] || [];
  const idx = arr.findIndex((x) => x.id === id);
  if (idx === -1) return false;
  arr.splice(idx, 1);
  saveSoon();
  return true;
}
function removeWhere(collection, predicate) {
  const db = load();
  const arr = db[collection] || [];
  const before = arr.length;
  const kept = arr.filter((x) => !predicate(x));
  if (kept.length !== before) { db[collection] = kept; saveSoon(); return true; }
  return false;
}
function replaceAll(obj) {
  cache = obj;
  save();
}

module.exports = {
  DB_FILE, DATA_DIR,
  load, save, saveSoon,
  genId, genIssueNo,
  list, get, insert, update, remove, removeWhere, replaceAll,
};
