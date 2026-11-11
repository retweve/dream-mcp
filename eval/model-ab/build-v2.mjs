#!/usr/bin/env node
/**
 * H1-v2 扩充：构建 60 题数据集 + 等长占位文件，冻结 sha256。
 *   node eval/model-ab/build-v2.mjs
 *
 * 只读 v1 的 dataset.json（题面完全复用），产出 dataset-v2.json；
 * prior-v2.md 复制 v1 prior；placeholder-v2.md 与 prior 字节数严格相等。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const canon = (o) => Array.isArray(o) ? '[' + o.map(canon).join(',') + ']'
  : (o && typeof o === 'object') ? '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}'
  : JSON.stringify(o);

const v1 = JSON.parse(fs.readFileSync(path.join(HERE, 'dataset.json'), 'utf8'));
const questions = v1.questions.map(q => ({ id: q.id, topic: q.topic, question: q.question, expect: q.expect, split: q.split }));
if (questions.length !== 60) throw new Error(`expected 60 questions, got ${questions.length}`);

const dataset = {
  version: 2,
  kind: 'cloze',
  source: v1.source,
  builtAt: new Date().toISOString(),
  counts: { all: questions.length },
  notes: [
    'v2：使用 v1 冻结的全部 60 题（20 test + 40 dev）；dev 在 v1 全程未用于调参，故并入评估集。',
    'A 臂读取与 prior 等字节长度的 placeholder-v2.md，消除「多读文件」混杂。',
    '评分规范化：去空白与非字母数字/汉字字符后包含即正确。',
  ],
  questions,
};
dataset.datasetSha256 = sha(canon(questions));
fs.writeFileSync(path.join(HERE, 'dataset-v2.json'), JSON.stringify(dataset, null, 2) + '\n', 'utf8');

// prior-v2 = v1 prior（原样复制）
const prior = fs.readFileSync(path.join(HERE, 'prior.md'));
fs.writeFileSync(path.join(HERE, 'prior-v2.md'), prior);

// placeholder：与 prior 字节数严格相等的中性文本
const target = prior.length;
const filler = 'This is a neutral placeholder file used only to equalize the read step. ';
let text = '';
while (Buffer.byteLength(text, 'utf8') + Buffer.byteLength(filler, 'utf8') <= target) text += filler;
const pad = target - Buffer.byteLength(text, 'utf8');
text += ' '.repeat(pad);
const phBuf = Buffer.from(text, 'utf8');
if (phBuf.length !== target) throw new Error(`placeholder size mismatch: ${phBuf.length} vs ${target}`);
fs.writeFileSync(path.join(HERE, 'placeholder-v2.md'), phBuf);

const state = {
  datasetSha256: dataset.datasetSha256,
  datasetBytes: fs.statSync(path.join(HERE, 'dataset-v2.json')).size,
  prior: { bytes: prior.length, sha256: sha(prior) },
  placeholder: { bytes: phBuf.length, sha256: sha(phBuf) },
  totalQuestions: 60,
  batchSize: 5,
  batches: 12,
  completedBatches: [],
  nextBatch: 0,
  amended: [
    'v2 预注册见 evo/protocols/shared-memory-v2-amendment.md：n=60、读文件对齐、失败项剔除规则、双口径稳定性判据。',
  ],
};
fs.writeFileSync(path.join(HERE, 'state-v2.json'), JSON.stringify(state, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ questions: 60, datasetSha256: dataset.datasetSha256, priorBytes: prior.length, placeholderBytes: phBuf.length, batches: 12 }, null, 2));
