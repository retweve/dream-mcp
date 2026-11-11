#!/usr/bin/env node
/**
 * dream-mcp CLI —— 给人和脚本用的提交入口（不需要 MCP 客户端）。
 *
 *   node dream-mcp/cli.mjs submit --file my-dream.json
 *   node dream-mcp/cli.mjs list [--limit 10] [--author 鲸鱼]
 *   node dream-mcp/cli.mjs stats
 *   echo '{...}' | node dream-mcp/cli.mjs submit --stdin
 *
 * 这等价于调用 MCP 的 dream_submit / dream_list / dream_stats，
 * 但直接读写同一个存储（dream/shared）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, 'server.mjs');

function call(name, args) {
  const input = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) + '\n';
  const res = spawnSync(process.execPath, [SERVER], { input, encoding: 'utf8' });
  if (res.error) throw res.error;
  const lines = res.stdout.trim().split('\n').filter(Boolean);
  const out = JSON.parse(lines[lines.length - 1]);
  if (out.error) throw new Error(out.error.message);
  return out.result.structuredContent;
}

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name) => { const i = argv.indexOf(`--${name}`); return i > -1 ? argv[i + 1] : null; };

try {
  if (cmd === 'submit') {
    let body;
    if (argv.includes('--stdin')) body = JSON.parse(fs.readFileSync(0, 'utf8'));
    else {
      const file = flag('file');
      if (!file) { console.error('usage: submit --file <json> | --stdin'); process.exit(2); }
      body = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    console.log(JSON.stringify(call('dream_submit', body), null, 2));
  } else if (cmd === 'list') {
    const args = {};
    if (flag('limit')) args.limit = Number(flag('limit'));
    if (flag('author')) args.author = flag('author');
    if (flag('tag')) args.tag = flag('tag');
    const r = call('dream_list', args);
    console.log(`共 ${r.total} 条，显示 ${r.returned} 条\n`);
    for (const d of r.dreams) console.log(`${d.submittedAt.slice(0, 16)}  ${d.author.padEnd(12)} ${d.title}  (${d.entries} entries)  ${d.id}`);
  } else if (cmd === 'stats') {
    console.log(JSON.stringify(call('dream_stats', {}), null, 2));
  } else {
    console.log(`dream-mcp CLI
  submit --file <json> | --stdin   提交一条梦
  list [--limit N] [--author X]    列出梦境池
  stats                            统计`);
  }
} catch (e) {
  console.error('error:', e.message);
  process.exit(1);
}
