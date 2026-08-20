'use strict';
/* ============================================================
 * 云函数入口（腾讯云开发 SCF / 腾讯云函数 HTTP 触发器）
 * ------------------------------------------------------------
 * 原理：require('./server') 在函数实例内启动一次完整后端（监听 127.0.0.1:<PORT>），
 * 每次 HTTP 触发把事件转发给内置后端，再把响应组装返回。
 *  → 现有 server.js / 路由 / 状态机 / 审计 / 报告 100% 复用，零外部依赖。
 *  → 函数实例回收后重启，server.js 的 seedDemoIfEmpty() 自动注入演示数据。
 * 部署入口：scf.main（文件名.函数名）
 * 创建触发器：HTTP 触发器（URL 请求 / API 网关），触发路径建议填 "/"。
 * ============================================================ */
const http = require('http');

// 在函数实例内启动后端（模块缓存保证单例；顶层会 listen 3000）
require('./server');

const PORT = process.env.PORT || 3000;
let ready = false;
let readyPromise = null;

// 首次调用时等待后端端口就绪（server.js 有端口占用自动重试逻辑，最长约 30s）
function ensureServer() {
  if (ready) return Promise.resolve();
  if (readyPromise) return readyPromise;
  readyPromise = new Promise((resolve, reject) => {
    const probe = (attempt) => {
      if (attempt > 40) return reject(new Error('后端启动超时（40s）'));
      const sock = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 1200 }, () => {
        sock.destroy();
        ready = true;
        resolve();
      });
      sock.on('timeout', () => { sock.destroy(); setTimeout(() => probe(attempt + 1), 1000); });
      sock.on('error', () => setTimeout(() => probe(attempt + 1), 1000));
    };
    probe(0);
  });
  return readyPromise;
}

exports.main = async (event) => {
  await ensureServer();
  const method = event.httpMethod || 'GET';
  const path = event.path || '/';
  const qs = event.queryString || event.queryStringParameters || event.query || {};
  const headers = Object.assign({}, event.headers || {});
  delete headers['accept-encoding']; // 本地 gzip 不转发，由网关按需压缩（避免双重编码）
  delete headers['content-length'];  // 由 http.request 按 body 重新计算
  let body = event.body || null;
  if (body && event.isBase64Encoded) body = Buffer.from(body, 'base64');

  const queryStr = typeof qs === 'string' ? qs : new URLSearchParams(qs).toString();
  const reqPath = path + (queryStr ? '?' + queryStr : '');

  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path: reqPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const outHeaders = {};
        const setCookies = [];
        for (let i = 0; i < res.rawHeaders.length; i += 2) {
          const k = res.rawHeaders[i].toLowerCase();
          const v = res.rawHeaders[i + 1];
          if (k === 'set-cookie') setCookies.push(v); // 鉴权 Cookie 可能多条，必须保留
          else if (!outHeaders[k]) outHeaders[k] = v;
        }
        if (setCookies.length) outHeaders['Set-Cookie'] = setCookies.length === 1 ? setCookies[0] : setCookies;
        // 移除内部响应头，避免网关冲突
        delete outHeaders['content-length'];
        resolve({
          statusCode: res.statusCode,
          headers: outHeaders,
          body: buf.toString('utf8'),
          isBase64Encoded: false,
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
};
