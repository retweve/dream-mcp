#!/usr/bin/env node
/**
 * 共享梦境池聚合器 —— L2 → L3 的唯一通道。
 *
 *   node dream-mcp/aggregate.mjs                 # 默认 k=3，输出 distillate
 *   node dream-mcp/aggregate.mjs --k 2 --out x.json
 *   DREAM_HOME=/path node dream-mcp/aggregate.mjs
 *
 * 三条硬规则（见 EVOLUTION.md）：
 *   1. 只聚合 consent.derivatives === true 的记录
 *   2. k-匿名：同一规律必须来自 ≥ k 个**不同作者**才允许输出
 *   3. 只输出「关键词 + 计数 + 类型」，不输出原文、不输出作者名
 *      （把关键词改写成人类可读的 statement 由 LLM 步骤完成，不是本脚本的职责）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.env.DREAM_HOME || path.resolve(process.cwd(), 'dream', 'shared');
const INBOX = path.join(ROOT, 'inbox');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const K = Number(arg('k', 3));
const OUT = arg('out', path.join(ROOT, `distillate-${new Date().toISOString().slice(0, 10)}.json`));
const MIN_SIM = Number(arg('min-sim', 0.34));

if (!fs.existsSync(INBOX)) { console.error('no inbox:', INBOX); process.exit(2); }

const records = [];
for (const f of fs.readdirSync(INBOX).filter(f => f.endsWith('.json'))) {
  try { records.push(JSON.parse(fs.readFileSync(path.join(INBOX, f), 'utf8'))); } catch { /* skip */ }
}

// --- 同意过滤 ---
const eligible = records.filter(r => r.consent?.derivatives === true);
const discarded = {
  noConsent: records.length - eligible.length,
};

// --- 归一化 + 词项集合 ---
// 跨措辞的相似度用「关键词包含度」而不是字符 shingle：
// 中文改写后 4-gram Jaccard 只有 0.2 左右，会把同一件事拆成很多簇。
const STOP = /[^\p{Script=Han}A-Za-z0-9]/gu;
const STOPWORD = /^(这个|那个|可以|需要|已经|因为|所以|但是|如果|就是|还是|一个|不是|没有|什么|怎么|这样|那样|现在|时候|问题|东西|我们|他们|使用|进行|采用|改用|必须|才能|配合|环境|情况下|the|and|for|with|that|this)$/;

function termsOf(text) {
  const set = new Set();
  // 英文标识符（HKCU / vbs / wscript / pnpm …）
  for (const w of text.match(/[A-Za-z][A-Za-z0-9_.\-/\\]{2,}/g) || []) set.add(w.toLowerCase());
  // 中文 2-gram（够细，能抓住"定时任务/隐藏启动"这类术语）
  const han = (text.match(/[\p{Script=Han}]+/gu) || []).join('');
  for (let i = 0; i + 1 < han.length; i++) {
    const g = han.slice(i, i + 2);
    if (!STOPWORD.test(g)) set.add(g);
  }
  return set;
}
function containment(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / Math.min(a.size, b.size);
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function keywordsOf(text) {
  const words = [
    ...(text.match(/[A-Za-z][A-Za-z0-9_.\-/\\]{3,}/g) || []).map(w => w.toLowerCase()),
    ...[...text.matchAll(/[\p{Script=Han}]{2,4}/gu)].map(m => m[0]),
  ];
  const freq = new Map();
  for (const w of words) {
    if (/^(这个|那个|可以|需要|已经|因为|所以|但是|如果|就是|还是|一个|不是|没有|什么|怎么|这样|那样|现在|时候|问题|东西|the|and|for|with)$/.test(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w]) => w);
}

// --- 贪心聚类（关键词包含度） ---
const clusters = [];
for (const r of eligible) {
  for (const e of r.entries || []) {
    const item = { author: r.author, tags: r.tags || [], type: e.type || 'fact', text: e.text, terms: termsOf(e.text) };
    let best = null;
    let bestSim = 0;
    for (const c of clusters) {
      const sim = Math.max(containment(item.terms, c.centroid), jaccard(item.terms, c.centroid) * 1.2);
      if (sim > bestSim) { bestSim = sim; best = c; }
    }
    if (best && bestSim >= MIN_SIM) {
      best.items.push(item);
      // 质心用并集，避免先入为主的条目主导聚类
      for (const t of item.terms) best.centroid.add(t);
    } else {
      clusters.push({ centroid: new Set(item.terms), items: [item] });
    }
  }
}

// --- k-匿名过滤 ---
const patterns = [];
let belowK = 0;
for (const c of clusters) {
  const authors = new Set(c.items.map(i => i.author));
  if (authors.size < K) { belowK++; continue; }
  const kwFreq = new Map();
  for (const item of c.items) for (const w of keywordsOf(item.text)) kwFreq.set(w, (kwFreq.get(w) || 0) + 1);
  const keywords = [...kwFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w]) => w);
  const typeFreq = new Map();
  for (const item of c.items) typeFreq.set(item.type, (typeFreq.get(item.type) || 0) + 1);
  const tagFreq = new Map();
  for (const item of c.items) for (const t of item.tags) tagFreq.set(t, (tagFreq.get(t) || 0) + 1);
  patterns.push({
    theme: [...tagFreq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
    keywords,
    authors: authors.size,
    entries: c.items.length,
    evidenceTypes: [...typeFreq.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ type: t, n })),
    // 注意：这里没有原文、没有作者名。statement 由 LLM 步骤基于 keywords 重写。
  });
}
patterns.sort((a, b) => b.authors - a.authors || b.entries - a.entries);

const distillate = {
  generatedAt: new Date().toISOString(),
  source: { pool: ROOT, records: records.length, eligible: eligible.length, k: K, minSim: MIN_SIM },
  patterns,
  discarded: { ...discarded, belowK },
  fingerprints: {
    // 只放哈希，便于比对两份 distillate 是否同源，不泄露内容
    records: records.map(r => crypto.createHash('sha256').update(r.id).digest('hex').slice(0, 12)),
  },
  nextStep: 'patterns[].keywords → LLM 重写成 statement → 人工审查 → 技能/评测/提示词补丁（绝不进模型权重）',
};

fs.writeFileSync(OUT, JSON.stringify(distillate, null, 2) + '\n', 'utf8');

console.log(`# 共享梦境聚合  k=${K}`);
console.log(`池子 ${records.length} 条，同意派生 ${eligible.length} 条，可输出规律 ${patterns.length} 条\n`);
if (patterns.length === 0) {
  console.log('没有达到 k-匿名阈值的规律。');
  console.log(discarded.noConsent ? `（${discarded.noConsent} 条未授权派生，${belowK} 个簇不足 ${K} 位作者）` : `（${belowK} 个簇不足 ${K} 位作者）`);
} else {
  for (const p of patterns) {
    console.log(`- [${p.theme || 'untagged'}] ${p.authors} 位作者 / ${p.entries} 条`);
    console.log(`  keywords: ${p.keywords.join(' · ')}`);
    console.log(`  types: ${p.evidenceTypes.map(e => `${e.type}×${e.n}`).join(', ')}`);
  }
}
console.log(`\n输出: ${OUT}`);
