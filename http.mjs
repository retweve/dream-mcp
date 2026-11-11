#!/usr/bin/env node
/**
 * HTTP intake —— 让别人不用 Git、不用 MCP 客户端也能提交梦境记录。
 *
 *   DREAM_TOKEN=xxx node dream-mcp/http.mjs            # 127.0.0.1:8787
 *   DREAM_TOKEN=xxx PORT=9000 HOST=0.0.0.0 node http.mjs
 *
 * 端点：
 *   GET  /health                  → {ok:true}
 *   POST /submit                  → 同 dream_submit（Bearer token 必需）
 *   GET  /list?limit=&author=&tag= → 同 dream_list（需 token）
 *   GET  /dream/<id>              → 同 dream_get（需 token）
 *   GET  /stats                   → 同 dream_stats（需 token）
 *
 * 安全：
 *   - 必须显式设置 DREAM_TOKEN，否则拒绝启动（fail closed）
 *   - Bearer 常量时间比较
 *   - 请求体 ≤ 64KB；每 IP 每分钟 30 次
 *   - 只做 JSON，不解析 multipart，不提供静态文件
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { submitDream, listDreams, getDream, dreamStats } from './core.mjs';

const TOKEN = process.env.DREAM_TOKEN;
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 8787;
const MAX_BODY = 64 * 1024;
const RATE = { windowMs: 60_000, max: 30, hits: new Map() };

if (!TOKEN || TOKEN.length < 8) {
  console.error('[dream-mcp] refusing to start: set DREAM_TOKEN (>=8 chars)');
  process.exit(2);
}

function timingSafeEqual(a, b) {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
function authed(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer (.+)$/);
  return Boolean(m && timingSafeEqual(m[1], TOKEN));
}
function rateLimited(req) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const arr = (RATE.hits.get(ip) || []).filter(t => now - t < RATE.windowMs);
  if (arr.length >= RATE.max) { RATE.hits.set(ip, arr); return true; }
  arr.push(now);
  RATE.hits.set(ip, arr);
  return false;
}
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('payload too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') return send(res, 200, { ok: true, service: 'dream-mcp', version: '1.1.0' });
  if (rateLimited(req)) return send(res, 429, { error: 'rate limit: 30 req/min' });
  if (!authed(req)) return send(res, 401, { error: 'missing or invalid Bearer token' });

  try {
    if (req.method === 'POST' && url.pathname === '/submit') {
      const raw = await readBody(req);
      let body;
      try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'invalid JSON' }); }
      const out = submitDream(body);
      return send(res, out.duplicate ? 200 : 201, out);
    }
    if (req.method === 'GET' && url.pathname === '/list') {
      return send(res, 200, listDreams({
        limit: url.searchParams.get('limit'),
        author: url.searchParams.get('author'),
        tag: url.searchParams.get('tag'),
      }));
    }
    if (req.method === 'GET' && url.pathname.startsWith('/dream/')) {
      return send(res, 200, getDream({ id: decodeURIComponent(url.pathname.slice('/dream/'.length)) }));
    }
    if (req.method === 'GET' && url.pathname === '/stats') return send(res, 200, dreamStats());
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    const status = e.status || 400;
    return send(res, status, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`dream-mcp http listening on http://${HOST}:${PORT} (token auth on, ${RATE.max} req/min/IP)`);
});
