#!/usr/bin/env node
/**
 * H1 模型级验证 · 数据构建（确定性，可复算）。
 *
 *   node eval/model-ab/build.mjs
 *
 * 产物：
 *   eval/model-ab/dataset.json   60 个 cloze 题（20 冻结 test + 40 dev），含 sha256
 *   eval/model-ab/prior.md       B 臂先验（由 test 事实 × 3 合成作者聚合，k=3，仅关键词）
 *   eval/model-ab/build-report.json
 *
 * 重要口径（写进报告，不隐瞒）：
 *   - 题目来自本机 team memory 的条目（可追溯到 session），不是原始 transcript 全文；
 *     相对 G0 协议是**偏差**：原始 transcript 挖题需要模型抽取，成本高，先做 cloze 子集。
 *   - prior 由 **test 事实** 的 3 份合成提交聚合而来 → 这是「上界机制测试」，
 *     不是真实他人数据分布；结论只能说明「关键词先验是否提供召回线索」。
 *   - test 集构建后冻结：sha256 写入 dataset.json，后续轮次不得修改。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const HOME = process.env.USERPROFILE || process.env.HOME;
const TEAM = path.join(HOME, '.dsh', 'bot', 'memory', 'team');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const canon = (o) => {
  // 简单稳定序列化：按 key 排序（题目本身只用 ASCII 字段与中文文本，足够稳定）
  if (Array.isArray(o)) return '[' + o.map(canon).join(',') + ']';
  if (o && typeof o === 'object') return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}';
  return JSON.stringify(o);
};

// ---------- 1) 从 team memory 抽 cloze 题 ----------
const entries = [];
for (const f of fs.readdirSync(TEAM).filter(f => f.endsWith('.md') && f !== 'MEMORY.md' && f !== 'global.md')) {
  const text = fs.readFileSync(path.join(TEAM, f), 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^-\s+(.+)$/);
    if (!m) continue;
    const body = m[1].replace(/\[source:[^\]]*\]\s*$/, '').trim();
    if (body.length < 20) continue;
    entries.push({ topic: f.replace(/\.md$/, ''), text: body });
  }
}

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'node', 'true', 'false', 'http', 'https', 'json', 'html']);
function pickToken(text) {
  const cands = [...text.matchAll(/[A-Za-z][A-Za-z0-9_.\-/\\]{3,}/g)]
    .map(m => m[0])
    .filter(t => !STOP.has(t.toLowerCase()) && t.length >= 4);
  if (!cands.length) return null;
  // 取最长的作为「缺失短语」，更容易唯一判定
  cands.sort((a, b) => b.length - a.length);
  return cands[0];
}

const items = [];
for (const e of entries) {
  const token = pickToken(e.text);
  if (!token) continue;
  const masked = e.text.replace(token, '____');
  if (masked === e.text) continue;
  const id = sha(e.topic + '|' + e.text + '|' + token).slice(0, 10);
  items.push({ id, topic: e.topic, question: `填空（只回答缺失的短语，不要解释）：${masked}`, expect: token });
}
// 去重（同一个 token 可能出现在多条）
const seen = new Set();
const unique = items.filter(i => (seen.has(i.expect + i.question) ? false : (seen.add(i.expect + i.question), true)));
unique.sort((a, b) => a.id.localeCompare(b.id));

const TEST_N = 20;
if (unique.length < TEST_N + 10) throw new Error(`题库不足：只有 ${unique.length} 条可用（需要 ≥30）`);
const test = unique.slice(0, TEST_N).map((x, i) => ({ ...x, split: 'test', idx: i }));
const dev = unique.slice(TEST_N, TEST_N + 40).map((x, i) => ({ ...x, split: 'dev', idx: TEST_N + i }));

const dataset = {
  version: 1,
  kind: 'cloze',
  source: '~/.dsh/bot/memory/team/*.md（条目可追溯到 session）',
  builtAt: new Date().toISOString(),
  counts: { all: unique.length, test: test.length, dev: dev.length },
  notes: [
    '题目为 cloze：从记忆条目中移除一个最长英文标识符，要求只回答该短语。',
    '评分完全确定性：答案规范化后包含期望短语即正确。',
    'test 集冻结：内容 sha256 = datasetSha256，后续轮次不得修改或调参。',
  ],
  questions: [...test, ...dev],
};
dataset.datasetSha256 = sha(canon(dataset.questions));
fs.writeFileSync(path.join(HERE, 'dataset.json'), JSON.stringify(dataset, null, 2) + '\n', 'utf8');

// ---------- 2) 合成共享池 + 先验（用 test 事实 × 3 作者，k=3） ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-modelab-'));
const env = { ...process.env, DREAM_HOME: tmp };
const run = (script, args) => spawnSync(process.execPath, [path.join(ROOT, script), ...args], { encoding: 'utf8', env });

const authors = ['author-alpha', 'author-beta', 'author-gamma'];
for (const a of authors) {
  for (const q of test) {
    const rec = {
      author: a,
      title: `pool-${q.id}`,
      summary: 'synthetic pool for H1',
      entries: [{
        text: q.question.replace('填空（只回答缺失的短语，不要解释）：', '').replace('____', q.expect).slice(0, 300),
        type: 'fact', confidence: 'confirmed',
      }],
      tags: ['h1-pool'],
      consent: { share: true, derivatives: true },
    };
    const f = path.join(tmp, `rec-${a}-${q.id}.json`);
    fs.writeFileSync(f, JSON.stringify(rec), 'utf8');
    const out = run('cli.mjs', ['submit', '--file', f]);
    if (out.status !== 0 && !/duplicate/.test(out.stdout || '')) throw new Error(`submit failed: ${out.stderr}`);
  }
}
const agg = run('aggregate.mjs', ['--k', '3', '--out', path.join(tmp, 'distillate.json')]);
if (agg.status !== 0) throw new Error(`aggregate failed: ${agg.stderr}`);
const distillate = JSON.parse(fs.readFileSync(path.join(tmp, 'distillate.json'), 'utf8'));

const priorLines = [
  '# 跨个体先验（H1 实验用，非事实来源）',
  '',
  '> 由合成共享池（3 位作者 × test 事实）经 k=3 聚合得到，只含关键词与计数。',
  '> 用途：给 B 臂提供回忆线索；不得当作事实陈述。',
  '',
];
for (const p of distillate.patterns) {
  priorLines.push(`- [${p.theme || 'untagged'}] ${p.authors} 位作者 / ${p.entries} 条 · 关键词：${(p.keywords || []).join(' · ')}`);
}
fs.writeFileSync(path.join(HERE, 'prior.md'), priorLines.join('\n') + '\n', 'utf8');

const build = {
  at: new Date().toISOString(),
  datasetSha256: dataset.datasetSha256,
  counts: dataset.counts,
  pool: { authors: authors.length, submitted: authors.length * test.length, patterns: distillate.patterns.length, k: distillate.source?.k },
  priorKeywords: distillate.patterns.reduce((n, p) => n + (p.keywords || []).length, 0),
  coverage: (() => {
    // test 期望短语有多少出现在先验关键词里 —— 决定 B 臂是否可能占优（上界）
    const kw = new Set(distillate.patterns.flatMap(p => p.keywords || []));
    const hit = test.filter(q => kw.has(q.expect)).length;
    return { testTokensCovered: hit, testTotal: test.length, rate: Number((hit / test.length).toFixed(2)) };
  })(),
};
fs.writeFileSync(path.join(HERE, 'build-report.json'), JSON.stringify(build, null, 2) + '\n', 'utf8');
fs.rmSync(tmp, { recursive: true, force: true });

console.log(JSON.stringify(build, null, 2));
