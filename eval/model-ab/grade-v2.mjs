#!/usr/bin/env node
/**
 * H1-v2 评分：as-run 与 excluded 双口径（预注册见 shared-memory-v2-amendment.md）。
 *   node eval/model-ab/grade-v2.mjs
 *
 * 口径：
 *   as-run   —— agent 返回 null 视作「错误」并计入配对
 *   excluded —— 任一臂为 null 的题整对剔除（预注册 C3）
 * 判据（C4）：两种口径都必须满足 CI 下界 > 0 且点估计 ≥ 9pp 才算支持 H1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(fs.readFileSync(path.join(HERE, 'dataset-v2.json'), 'utf8'));
const byId = new Map(dataset.questions.map(q => [q.id, q]));
const state = JSON.parse(fs.readFileSync(path.join(HERE, 'state-v2.json'), 'utf8'));
const prior = fs.readFileSync(path.join(HERE, 'prior-v2.md'), 'utf8');
const priorKeywords = [...prior.matchAll(/关键词：(.+)$/gm)].flatMap(m => m[1].split('·').map(s => s.trim())).filter(Boolean);

const dir = path.join(HERE, 'answers-v2');
const rows = [];
if (fs.existsSync(dir)) {
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const arr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!Array.isArray(arr)) continue;
    for (const r of arr) rows.push({ ...r, file: f });
  }
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '').replace(/[^0-9a-z\u4e00-\u9fff]/g, '');
const clean = rows.map(r => {
  const q = byId.get(r.id);
  if (!q) return null;
  return { ...r, split: q.split, expect: q.expect, correct: r.answer != null && norm(r.answer).includes(norm(q.expect)) };
}).filter(Boolean);

function summarize(rowsIn, label) {
  const m = new Map();
  for (const r of rowsIn) { if (!m.has(r.id)) m.set(r.id, {}); m.get(r.id)[r.arm] = r; }
  const pairsAll = [...m.entries()].filter(([, v]) => v.A && v.B);
  const complete = pairsAll.filter(([, v]) => v.A.answer != null && v.B.answer != null);
  const pairs = label === 'excluded' ? complete : pairsAll;
  const n = pairs.length;
  if (!n) return { label, n: 0 };
  const A = pairs.filter(([, v]) => v.A.correct).length;
  const B = pairs.filter(([, v]) => v.B.correct).length;
  const diffs = pairs.map(([, v]) => (v.B.correct ? 1 : 0) - (v.A.correct ? 1 : 0));
  const rand = (s => () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; })(20261111);
  const boot = [];
  for (let i = 0; i < 1000; i++) { let s = 0; for (let j = 0; j < n; j++) s += diffs[Math.floor(rand() * n)]; boot.push(s / n); }
  boot.sort((a, b) => a - b);
  const ci = [Number(boot[25].toFixed(3)), Number(boot[974].toFixed(3))];
  const pA = A / n, pB = B / n;
  const h = 2 * Math.asin(Math.sqrt(pB)) - 2 * Math.asin(Math.sqrt(pA));
  const costA = pairs.reduce((s, [, v]) => s + (v.A.answerChars ?? 0), 0) / n;
  const costB = pairs.reduce((s, [, v]) => s + (v.B.answerChars ?? 0), 0) / n;
  const fpA = pairs.filter(([, v]) => v.A.answer != null && !v.A.correct && priorKeywords.some(k => norm(v.A.answer).includes(norm(k)))).length;
  const fpB = pairs.filter(([, v]) => v.B.answer != null && !v.B.correct && priorKeywords.some(k => norm(v.B.answer).includes(norm(k)))).length;
  return {
    label, n, correctA: A, correctB: B,
    rateA: Number(pA.toFixed(3)), rateB: Number(pB.toFixed(3)),
    pairedDiff: Number(((B - A) / n).toFixed(3)),
    ci95: ci, cohensH: Number(h.toFixed(3)),
    answerChars: { A: Number(costA.toFixed(1)), B: Number(costB.toFixed(1)) },
    falseMemoryProxy: { A: fpA, B: fpB },
    h1Met: ci[0] > 0 && (B - A) / n >= 0.09,
  };
}

const asRun = summarize(clean, 'as-run');
const excluded = summarize(clean, 'excluded');
const verdict = {
  supported: Boolean(asRun.h1Met && excluded.h1Met),
  asRunMet: Boolean(asRun.h1Met),
  excludedMet: Boolean(excluded.h1Met),
  reason: asRun.n === 0 ? 'no data yet' : (asRun.h1Met && excluded.h1Met ? 'both analyses meet pre-registered criteria' : 'at least one analysis fails pre-registered criteria'),
};

const out = {
  at: new Date().toISOString(),
  datasetSha256: dataset.datasetSha256,
  state,
  answered: {
    total: clean.length,
    A: clean.filter(r => r.arm === 'A').length,
    B: clean.filter(r => r.arm === 'B').length,
    nulls: clean.filter(r => r.answer == null).length,
  },
  priorCoverage: (() => { const kw = new Set(priorKeywords); return { covered: dataset.questions.filter(q => kw.has(q.expect)).length, total: dataset.questions.length }; })(),
  asRun, excluded, verdict,
};
fs.writeFileSync(path.join(HERE, 'results-v2.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');

const md = [
  '# H1-v2 扩充验证',
  '',
  `生成于 ${out.at} · dataset ${dataset.datasetSha256.slice(0, 16)}… · 已作答 ${out.answered.total}/120`,
  '',
  `| 口径 | n | A | B | 配对差 | 95% CI | h | H1 达标 |`,
  '|---|---|---|---|---|---|---|---|',
  ...(asRun.n ? [asRun, excluded].map(s => `| ${s.label} | ${s.n} | ${(s.rateA * 100).toFixed(1)}% | ${(s.rateB * 100).toFixed(1)}% | ${s.pairedDiff} | [${s.ci95.join(', ')}] | ${s.cohensH} | ${s.h1Met ? '✅' : '❌'} |`) : ['| — | 0 | — | — | — | — | — | — |']),
  '',
  `**判定：${verdict.supported ? '支持 H1（双口径均达标）' : '证据不足/未达标'}** — ${verdict.reason}`,
  '',
  `H2 代理：as-run A=${asRun.falseMemoryProxy?.A ?? '—'} / B=${asRun.falseMemoryProxy?.B ?? '—'}`,
  `H3 成本代理（答案字符）：as-run A=${asRun.answerChars?.A ?? '—'} / B=${asRun.answerChars?.B ?? '—'}；延迟 NOT MEASURED`,
  '',
].join('\n');
fs.writeFileSync(path.join(HERE, 'summary-v2.md'), md, 'utf8');
console.log(md);
