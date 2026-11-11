#!/usr/bin/env node
/**
 * H1 模型级验证 · 确定性评分（无模型参与）。
 *
 *   node eval/model-ab/grade.mjs [--answers <file> ...]
 *
 * 默认读取 eval/model-ab/answers/*.json（每个文件是一批答案）：
 *   [{ "id": "abc123", "arm": "A"|"B", "answer": "……" }]
 *
 * 评分：答案规范化后包含期望短语即正确（大小写不敏感、去空白）。
 * 产出：eval/model-ab/results.json、summary.md。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(fs.readFileSync(path.join(HERE, 'dataset.json'), 'utf8'));
const byId = new Map(dataset.questions.map(q => [q.id, q]));

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const answerFiles = [];
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--answers' && process.argv[i + 1]) answerFiles.push(process.argv[i + 1]);
}
if (!answerFiles.length) {
  const dir = path.join(HERE, 'answers');
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) answerFiles.push(path.join(dir, f));
}

// 评分规范化：小写、去空白、去所有非字母数字/汉字字符。
// 原因：期望短语可能带尾部斜杠或路径分隔符（如 "Linux/BSP/"），
// 严格包含会把它误判为错误；两侧同时规范化后按「包含」判定。
const norm = (s) => String(s || '')
  .toLowerCase()
  .replace(/\s+/g, '')
  .replace(/[^0-9a-z\u4e00-\u9fff]/g, '');
const answers = [];
for (const f of answerFiles) {
  const rows = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!Array.isArray(rows)) continue; // 跳过非答案文件（如批次输入）
  for (const r of rows) answers.push({ ...r, file: path.basename(f) });
}

const prior = fs.readFileSync(path.join(HERE, 'prior.md'), 'utf8');
const priorKeywords = [...prior.matchAll(/关键词：(.+)$/gm)]
  .flatMap(m => m[1].split('·').map(s => s.trim()))
  .filter(Boolean)
  .map(k => k.toLowerCase());

const rows = [];
for (const a of answers) {
  const q = byId.get(a.id);
  if (!q) continue;
  rows.push({
    ...a,
    expect: q.expect,
    split: q.split,
    correct: norm(a.answer).includes(norm(q.expect)),
  });
}

const pair = new Map();
for (const r of rows) {
  if (!pair.has(r.id)) pair.set(r.id, {});
  pair.get(r.id)[r.arm] = r;
}
const pairs = [...pair.entries()].filter(([, v]) => v.A && v.B);

const diffs = pairs.map(([, v]) => (v.B.correct ? 1 : 0) - (v.A.correct ? 1 : 0));
const correctA = pairs.filter(([, v]) => v.A.correct).length;
const correctB = pairs.filter(([, v]) => v.B.correct).length;
const n = pairs.length;
const pA = n ? correctA / n : 0;
const pB = n ? correctB / n : 0;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let ci = null;
if (n >= 2) {
  const rand = mulberry32(20261111);
  const boot = [];
  for (let i = 0; i < 1000; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += diffs[Math.floor(rand() * n)];
    boot.push(s / n);
  }
  boot.sort((a, b) => a - b);
  ci = [Number(boot[Math.floor(0.025 * 1000)].toFixed(3)), Number(boot[Math.floor(0.975 * 1000)].toFixed(3))];
}
const cohensH = (n && pA <= 1 && pB <= 1) ? 2 * Math.asin(Math.sqrt(pB)) - 2 * Math.asin(Math.sqrt(pA)) : null;

// H2 代理指标：B 臂答案里出现了「先验关键词」但答案本身错误 → 错误记忆嫌疑
const falseMemoryB = rows.filter(r => r.arm === 'B' && !r.correct && priorKeywords.some(k => norm(r.answer).includes(norm(k)))).length;
const falseMemoryA = rows.filter(r => r.arm === 'A' && !r.correct && priorKeywords.some(k => norm(r.answer).includes(norm(k)))).length;

const results = {
  at: new Date().toISOString(),
  datasetSha256: dataset.datasetSha256,
  answered: { total: rows.length, A: rows.filter(r => r.arm === 'A').length, B: rows.filter(r => r.arm === 'B').length },
  pairs: n,
  metrics: {
    correctA, correctB,
    rateA: Number(pA.toFixed(3)), rateB: Number(pB.toFixed(3)),
    pairedDiff: Number((pB - pA).toFixed(3)),
    ci95: ci,
    cohensH: cohensH === null ? null : Number(cohensH.toFixed(3)),
  },
  falseMemoryProxy: { A: falseMemoryA, B: falseMemoryB },
  rows,
};
fs.writeFileSync(path.join(HERE, 'results.json'), JSON.stringify(results, null, 2) + '\n', 'utf8');

const md = [
  '# H1 模型级验证（cloze）',
  '',
  `生成于 ${results.at} · dataset ${dataset.datasetSha256.slice(0, 16)}…`,
  '',
  `| 指标 | 值 |`,
  '|---|---|',
  `| 已作答 | ${rows.length}（A=${results.answered.A} / B=${results.answered.B}） |`,
  `| 完整配对题数 | ${n} / ${dataset.counts.test}（test 集） |`,
  `| 无先验正确率（A） | ${(pA * 100).toFixed(1)}%（${correctA}/${n}） |`,
  `| 有先验正确率（B） | ${(pB * 100).toFixed(1)}%（${correctB}/${n}） |`,
  `| 配对差 | ${results.metrics.pairedDiff} |`,
  `| bootstrap 95% CI | ${ci ? `[${ci[0]}, ${ci[1]}]` : '样本不足'} |`,
  `| Cohen's h | ${results.metrics.cohensH ?? '—'} |`,
  `| H2 代理（B 臂错误且含先验词） | A=${falseMemoryA} / B=${falseMemoryB} |`,
  '',
  '## 结论口径',
  '',
  '- 判据（预注册）：配对差 95% CI 下界 > 0 且点估计 ≥ 9pp 才算「支持 H1」。',
  '- cloze 任务是**机械上限测试**：先验只提供关键词，不提供语义；覆盖率见 build-report.json。',
  '- 不得用 dev 集调参；test 集冻结（datasetSha256）。',
  '',
].join('\n');
fs.writeFileSync(path.join(HERE, 'summary.md'), md, 'utf8');
console.log(md);
