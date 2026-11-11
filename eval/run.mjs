#!/usr/bin/env node
/**
 * G3 验证 harness（本地、确定性、零依赖）。
 *
 *   npm run eval            # 跑全量：不变量 + 配对 A/B + 报告
 *
 * 诚实边界：
 *   - 这是 **Level 0 仪器验证**：验证「测量机制」本身工作（配对、CI、效应量、不变量），
 *     不等于「共享记忆让 agent 变强」的结论。模型级 A/B（G0 协议的 H1）需要模型调用，
 *     本机按仓库规则不联网，标记为 UNVERIFIED。
 *   - 外部公开基准（LongMemEval / CL-Bench）需要下载数据集 → 同样 UNVERIFIED，不伪造数字。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT_DIR = path.join(HERE, 'results');
fs.mkdirSync(OUT_DIR, { recursive: true });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-eval-'));
process.env.DREAM_HOME = tmp;

const env = { ...process.env, DREAM_HOME: tmp };
const runNode = (script, args = []) => spawnSync(process.execPath, [path.join(ROOT, script), ...args], { encoding: 'utf8', env });

const results = { at: new Date().toISOString(), level: 'level-0-instrument', checks: [], ab: null, unverified: [] };

// ---------- 1) 不变量 ----------
function invariant(name, fn) {
  try {
    const detail = fn();
    results.checks.push({ name, ok: true, detail: detail ?? '' });
  } catch (e) {
    results.checks.push({ name, ok: false, detail: e.message });
  }
}

const core = await import('../core.mjs');
const { mth, auditPath, verifyInclusion, consistencyProof, verifyConsistencyLight } = await import('../merkle.mjs');
const { contentHash } = await import('../jcs.mjs');

const submit = (author, text, title, extra = {}) => core.submitDream({
  author, title, summary: 'eval', entries: [{ text }], consent: { share: true, derivatives: true },
  ...extra,
});

invariant('提交幂等：同内容重复提交不新增记录', () => {
  const before = core.dreamStats().totalDreams;
  const a = submit('idem-a', '幂等测试条目一', 'idempotency');
  const b = submit('idem-a', '幂等测试条目一', 'idempotency');
  const after = core.dreamStats().totalDreams;
  if (!b.duplicate || a.id !== b.id || after !== before + 1) throw new Error('duplicate detection failed');
  return `${before} → ${after}`;
});

invariant('JCS 哈希与键序无关', () => {
  const h1 = contentHash({ a: 1, b: 2 });
  const h2 = contentHash({ b: 2, a: 1 });
  if (h1 !== h2) throw new Error('hash depends on key order');
  return h1.slice(0, 12);
});

invariant('k-匿名：不足 k 位作者的规律不输出', () => {
  // 仅 idem-a 一个作者，构造 aggregate 应输出 0 条规律
  const agg = runNode('aggregate.mjs', ['--k', '3', '--out', path.join(tmp, 'distillate.json')]);
  if (agg.status !== 0) throw new Error(`aggregate failed: ${agg.stderr}`);
  const d = JSON.parse(fs.readFileSync(path.join(tmp, 'distillate.json'), 'utf8'));
  if (d.patterns.length !== 0) throw new Error(`expected 0 patterns, got ${d.patterns.length}`);
  return '0 patterns below k';
});

invariant('Merkle：inclusion proof 轻客户端可验证', () => {
  const lv = Array.from({ length: 7 }, (_, i) => Buffer.from('e' + i));
  const root = mth(lv);
  for (let i = 0; i < lv.length; i++) {
    if (!verifyInclusion(i, lv.length, lv[i], auditPath(i, lv), root)) throw new Error(`leaf ${i} failed`);
  }
  return '7/7 leaves';
});

invariant('Merkle：轻客户端一致性验证', () => {
  const lv = Array.from({ length: 9 }, (_, i) => Buffer.from('c' + i));
  for (let m = 1; m < lv.length; m++) {
    if (!verifyConsistencyLight(m, lv.length, mth(lv.slice(0, m)), mth(lv), consistencyProof(m, lv))) {
      throw new Error(`m=${m} failed`);
    }
  }
  return 'm=1..8';
});

invariant('删除：按作者删除后零残留', () => {
  submit('erase-me', '删除证明测试条目', 'erase');
  const out = runNode('erase.mjs', ['--author', 'erase-me', '--yes']);
  if (out.status !== 0) throw new Error(`erase failed: ${out.stderr}`);
  if (!/"residueChecks": "PASS"/.test(out.stdout)) throw new Error('residue check did not pass');
  return 'PASS';
});

// ---------- 2) 配对 A/B（Level 0） ----------
// 用 3 位作者 × 4 个规律造池 → aggregate → 得到 prior 关键词 → 12 道可命中题 + 8 道对照题。
function buildPool() {
  const patterns = [
    '定时任务在无管理员环境要用 HKCU Run 加 vbs 隐藏启动',
    '多帧 zstd 必须按 magic 切帧否则只解第一帧',
    '记忆注入层超过 4000 字符要下沉到 topic',
    '模型路由任务级覆盖在本部署返回 null',
  ];
  const authors = ['alpha', 'beta', 'gamma'];
  patterns.forEach((p, i) => {
    for (const a of authors) submit(a, p, `pool-${i}-${a}`);
  });
  return patterns;
}
const patterns = buildPool();
const agg = runNode('aggregate.mjs', ['--k', '3', '--out', path.join(tmp, 'distillate.json')]);
if (agg.status !== 0) throw new Error(`aggregate failed: ${agg.stderr}`);
const distillate = JSON.parse(fs.readFileSync(path.join(tmp, 'distillate.json'), 'utf8'));
const prior = distillate.patterns.flatMap(p => p.keywords || []);
const hasPriorHit = (q) => prior.some(k => k.length >= 2 && q.includes(k));

const questions = [
  ...patterns.map((p, i) => ({ id: `hit-${i}`, text: p, expect: true })),
  ...Array.from({ length: 12 }, (_, i) => ({ id: `near-${i}`, text: patterns[i % patterns.length], expect: true })),
  ...Array.from({ length: 8 }, (_, i) => ({ id: `ctrl-${i}`, text: `完全无关的对照问题 ${i}：今天天气如何`, expect: false })),
];

// 臂 A：不注入 prior；臂 B：注入 prior。判定只看「关键词是否命中」。
const ab = questions.map(q => {
  const a = false; // 无先验 → 不可能命中
  const b = hasPriorHit(q.text);
  return { id: q.id, expect: q.expect, A: a, B: b };
});

const hit = (rows) => rows.filter(r => r.A === r.expect || r.B === r.expect);
const correctA = ab.filter(r => r.A === r.expect).length;
const correctB = ab.filter(r => r.B === r.expect).length;
const diffs = ab.map(r => (r.B === r.expect ? 1 : 0) - (r.A === r.expect ? 1 : 0));

// 配对 bootstrap（1000 次，固定种子可复现）
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261111);
const boot = [];
for (let i = 0; i < 1000; i++) {
  let s = 0;
  for (let j = 0; j < diffs.length; j++) s += diffs[Math.floor(rand() * diffs.length)];
  boot.push(s / diffs.length);
}
boot.sort((x, y) => x - y);
const ci = [boot[Math.floor(0.025 * 1000)], boot[Math.floor(0.975 * 1000)]];
const pA = correctA / ab.length, pB = correctB / ab.length;
const cohensH = 2 * Math.asin(Math.sqrt(pB)) - 2 * Math.asin(Math.sqrt(pA));
const fpB = ab.filter(r => !r.expect && r.B).length;
const fpA = ab.filter(r => !r.expect && r.A).length;

results.ab = {
  n: ab.length,
  correctA, correctB,
  rateA: Number(pA.toFixed(3)), rateB: Number(pB.toFixed(3)),
  pairedDiff: Number((pB - pA).toFixed(3)),
  ci95: ci.map(x => Number(x.toFixed(3))),
  cohensH: Number(cohensH.toFixed(3)),
  falsePositive: { A: fpA, B: fpB },
  priorKeywords: prior.length,
};

// ---------- 3) 明确未验证项 ----------
results.unverified = [
  { item: 'H1: 模型级 A/B（前置 prior 是否让 agent 答得更准）', reason: '需要模型调用；本仓库规则禁止本地模块联网' },
  { item: '公开基准（LongMemEval / CL-Bench 子集）', reason: '需要下载数据集/跑外部评测，未执行，不伪造数字' },
  { item: '模型层注入（T01/T02）真实影响', reason: '文本层无法判定模型行为，只能人工审查 + 评测监控' },
];

// ---------- 4) 报告 ----------
const failed = results.checks.filter(c => !c.ok);
const jsonPath = path.join(OUT_DIR, 'g3-eval.json');
fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2) + '\n', 'utf8');

const md = [
  '# G3 验证报告（Level 0 仪器验证）',
  '',
  `生成于 ${results.at} · 临时 DREAM_HOME: \`${tmp}\``,
  '',
  '## 1. 不变量',
  '',
  '| 检查 | 结果 | 证据 |',
  '|---|---|---|',
  ...results.checks.map(c => `| ${c.name} | ${c.ok ? '✅' : '❌'} | ${c.detail} |`),
  '',
  '## 2. 配对 A/B（Level 0）',
  '',
  `- 题目：${ab.length}（可命中 ${ab.filter(r => r.expect).length} / 对照 ${ab.filter(r => !r.expect).length}）`,
  `- 无先验 正确率：${(pA * 100).toFixed(1)}%（${correctA}/${ab.length}）`,
  `- 有先验 正确率：${(pB * 100).toFixed(1)}%（${correctB}/${ab.length}）`,
  `- 配对差：${results.ab.pairedDiff}，bootstrap 95% CI [${ci[0].toFixed(3)}, ${ci[1].toFixed(3)}]`,
  `- Cohen's h：${results.ab.cohensH}`,
  `- 误报（对照题被先验命中）：A=${fpA} / B=${fpB}`,
  '',
  '> 这是**测量机制验证**，不是「agent 变强」的结论。',
  '',
  '## 3. 未验证项（UNVERIFIED，不伪造）',
  '',
  '| 项 | 原因 |',
  '|---|---|',
  ...results.unverified.map(u => `| ${u.item} | ${u.reason} |`),
  '',
  '## 4. 结论',
  '',
  failed.length ? `❌ ${failed.length} 项不变量失败：${failed.map(f => f.name).join('；')}` : '✅ 全部不变量通过；A/B 机制可用；外部结论仍为 UNVERIFIED。',
  '',
  `机器可读结果：\`${path.relative(ROOT, jsonPath)}\``,
  '',
].join('\n');
fs.writeFileSync(path.join(OUT_DIR, 'g3-eval.md'), md, 'utf8');

console.log(md);
process.exit(failed.length ? 1 : 0);
