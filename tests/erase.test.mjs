import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ERASE = path.join(HERE, '..', 'erase.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-erase-'));
process.env.DREAM_HOME = tmp;

const core = await import('../core.mjs');

const submit = (author, title) => core.submitDream({
  author, title, summary: 'demo',
  entries: [{ text: `entry for ${author} ${title}` }],
  consent: { share: true, derivatives: true },
});

const runErase = (args) => spawnSync(process.execPath, [ERASE, ...args], {
  encoding: 'utf8',
  env: { ...process.env, DREAM_HOME: tmp },
});

test('dry-run 不删除任何东西', () => {
  const r = submit('alice', 'keep me');
  const out = runErase(['--id', r.id, '--dry-run']);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /"dryRun": true/);
  assert.ok(fs.existsSync(path.join(tmp, 'inbox', `${r.id}.json`)));
});

test('按 id 删除：写 tombstone、重建索引、零残留', () => {
  const before = fs.readFileSync(path.join(tmp, 'index.jsonl'), 'utf8').trim().split('\n').filter(Boolean).length;
  const a = submit('alice', 'erase by id');
  const b = submit('bob', 'keep this one');
  const out = runErase(['--id', a.id, '--yes']);
  assert.equal(out.status, 0, `stdout=${out.stdout}\nstderr=${out.stderr}`);
  assert.match(out.stdout, /"residueChecks": "PASS"/);
  assert.equal(fs.existsSync(path.join(tmp, 'inbox', `${a.id}.json`)), false);
  assert.ok(fs.existsSync(path.join(tmp, 'inbox', `${b.id}.json`)));
  const index = fs.readFileSync(path.join(tmp, 'index.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.equal(index.length, before + 1); // 提交了 2 条、删了 1 条
  assert.ok(index.some(r => r.id === b.id));
  assert.equal(index.some(r => r.id === a.id), false);
  const tombs = fs.readFileSync(path.join(tmp, 'tombstones.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.equal(tombs.length, 1);
  assert.equal(tombs[0].id, a.id);
});

test('按作者删除：该作者全部记录被清除', () => {
  submit('carol', 'c1');
  submit('carol', 'c2');
  const out = runErase(['--author', 'carol', '--yes']);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /"residueChecks": "PASS"/);
  const remaining = fs.readdirSync(path.join(tmp, 'inbox')).map(f => JSON.parse(fs.readFileSync(path.join(tmp, 'inbox', f), 'utf8')));
  assert.equal(remaining.some(r => r.author === 'carol'), false);
});

test('缺少 --yes 且非 dry-run 时拒绝执行', () => {
  const out = runErase(['--author', 'nobody']);
  assert.equal(out.status, 2);
  assert.match(out.stderr, /refusing to erase/);
});
