import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROVE = path.join(HERE, '..', 'prove.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-prove-'));
process.env.DREAM_HOME = tmp;

const core = await import('../core.mjs');

const submit = (author, title) => core.submitDream({
  author, title, summary: 'demo',
  entries: [{ text: `entry ${title}` }],
  consent: { share: true, derivatives: true },
});

const run = (args) => spawnSync(process.execPath, [PROVE, ...args], {
  encoding: 'utf8',
  env: { ...process.env, DREAM_HOME: tmp },
});

test('STH 生成并签名', () => {
  submit('alice', 'a');
  submit('bob', 'b');
  const out = run([]);
  assert.equal(out.status, 0, out.stderr);
  const sth = JSON.parse(out.stdout);
  assert.equal(sth.treeSize, 2);
  assert.match(sth.rootHash, /^[0-9a-f]{64}$/);
  assert.equal(sth.signed, true);
  assert.ok(fs.existsSync(path.join(tmp, 'sth.jsonl')));
});

test('inclusion proof 可独立验证', () => {
  const r = submit('carol', 'c');
  const proofOut = run(['--id', r.id]);
  assert.equal(proofOut.status, 0, proofOut.stderr);
  const proofFile = path.join(tmp, 'proof.json');
  fs.writeFileSync(proofFile, proofOut.stdout, 'utf8');

  const verify = run(['--verify', proofFile]);
  assert.equal(verify.status, 0, verify.stdout + verify.stderr);
  const result = JSON.parse(verify.stdout);
  assert.equal(result.ok, true);
  assert.equal(result.sthOk, true);
});

test('篡改 proof 后验证失败', () => {
  const proofFile = path.join(tmp, 'proof.json');
  const proof = JSON.parse(fs.readFileSync(proofFile, 'utf8'));
  proof.path = proof.path.map((p, i) => (i === 0 ? Buffer.alloc(32, 0xff).toString('base64url') : p));
  const bad = path.join(tmp, 'proof-bad.json');
  fs.writeFileSync(bad, JSON.stringify(proof), 'utf8');
  const verify = run(['--verify', bad]);
  assert.equal(verify.status, 1);
});

test('一致性证明可生成并通过结构校验', () => {
  const out = run(['--consistency', '1']);
  assert.equal(out.status, 0, out.stderr);
  const data = JSON.parse(out.stdout);
  assert.equal(data.m, 1);
  assert.ok(Array.isArray(data.proof));
});

test('不存在的 id 返回非零', () => {
  const out = run(['--id', 'dream-does-not-exist']);
  assert.equal(out.status, 2);
});
