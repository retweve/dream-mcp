#!/usr/bin/env node
/**
 * MCP stdio 适配层（协议很薄，逻辑在 core.mjs）。
 */
import readline from 'node:readline';
import { submitDream, listDreams, getDream, dreamStats, TOOL_DEFS } from './core.mjs';

const tools = { dream_submit: submitDream, dream_list: listDreams, dream_get: getDream, dream_stats: dreamStats };
const reply = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');

async function handle(req) {
  const { id, method, params } = req;
  const isNotification = id === undefined || id === null;
  if (method === 'initialize') {
    return { jsonrpc: '2.0', id, result: {
      protocolVersion: params?.protocolVersion || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'dream-mcp', version: '1.1.0' },
    } };
  }
  if (method === 'notifications/initialized' || method === 'initialized') return null;
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOL_DEFS } };
  if (method === 'tools/call') {
    const fn = tools[params?.name];
    if (!fn) return { jsonrpc: '2.0', id, error: { code: -32601, message: `unknown tool: ${params?.name}` } };
    try {
      const out = await fn(params?.arguments || {});
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out } };
    } catch (e) {
      return { jsonrpc: '2.0', id, error: { code: e.rpcCode || -32603, message: e.message } };
    }
  }
  if (isNotification) return null;
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } };
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try { req = JSON.parse(trimmed); }
  catch { reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); return; }
  const res = await handle(req);
  if (res) reply(res);
});
rl.on('close', () => process.exit(0));
