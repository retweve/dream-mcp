import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-core-'));
process.env.DREAM_HOME = tmp;

const core = await import('../core.mjs');
const { prepareBody } = await import('../body.mjs');
const { signRecord } = await import('../sign.mjs');
const { generateKeypair, savePrivateKey, registerKey } = await import('../keys.mjs');

const base = () => ({
  author: 'alice',
  title: 'perf note',
  summary: 'demo',
  entries: [{ text: '先复现基线再改', type: 'rule', confidence: 'confirmed' }],
  tags: ['demo'],
  consent: { share: true, derivatives: true },
});

test('未签名提交：写 hashAlg、signed=false', () => {
  const r = core.submitDream(base());
  assert.equal(r.signed, false);
  assert.equal(r.hashAlg, 'jcs-sha256/v1');
  const rec = core.getDream({ id: r.id });
  assert.equal(rec.hashAlg, 'jcs-sha256/v1');
  assert.equal(rec.signed, false);
  assert.equal(rec.schema, 2);
  assert.match(rec.contentHash, /^[0-9a-f]{64}$/);
});

test('重复提交被识别', () => {
  const r1 = core.submitDream(base());
  const r2 = core.submitDream(base());
  assert.equal(r2.duplicate, true);
  assert.equal(r2.id, r1.id);
});

test('空 entries 被拒', () => {
  assert.throws(() => core.submitDream({ ...base(), entries: [] }), /entries must be a non-empty array/);
});

test('超长条目被拒', () => {
  assert.throws(() => core.submitDream({ ...base(), entries: [{ text: 'x'.repeat(301) }] }), /exceeds 300/);
});

test('脱敏在写入前生效', () => {
  const r = core.submitDream({ ...base(), title: 'contact a@b.com', entries: [{ text: 'id 110101199001011234' }] });
  const rec = core.getDream({ id: r.id });
  assert.match(rec.title, /\[email\]/);
  assert.match(rec.entries[0].text, /\[id\]/);
});

test('签名提交：验证通过、登记 TOFU、signed=true', () => {
  const kp = generateKeypair();
  savePrivateKey(kp.keyId, kp.privateKeyPem);
  const privateKey = crypto.createPrivateKey(kp.privateKeyPem);
  const prepared = prepareBody({ ...base(), author: 'bob', title: 'signed note' }).body;
  const sig = signRecord(prepared, privateKey, crypto.createPublicKey(privateKey));
  const r = core.submitDream({ ...prepared, sig });
  assert.equal(r.signed, true);
  const rec = core.getDream({ id: r.id });
  assert.equal(rec.signed, true);
  assert.equal(rec.sig.keyId, kp.keyId);
  assert.ok(fs.existsSync(path.join(tmp, 'keys', `${kp.keyId}.json`)));
});

test('篡改签名内容被拒', () => {
  const kp = generateKeypair();
  savePrivateKey(kp.keyId, kp.privateKeyPem);
  const privateKey = crypto.createPrivateKey(kp.privateKeyPem);
  const prepared = prepareBody({ ...base(), author: 'carol', title: 'signed note 2' }).body;
  const sig = signRecord(prepared, privateKey, crypto.createPublicKey(privateKey));
  assert.throws(
    () => core.submitDream({ ...prepared, title: 'tampered', sig }),
    /invalid signature/,
  );
});

test('公钥已登记为他人时拒绝', () => {
  const kp = generateKeypair();
  savePrivateKey(kp.keyId, kp.privateKeyPem);
  registerKey({ keyId: kp.keyId, publicKeyPem: kp.publicKeyPem, author: 'mallory' });
  const privateKey = crypto.createPrivateKey(kp.privateKeyPem);
  const prepared = prepareBody({ ...base(), author: 'dave', title: 'stolen key' }).body;
  const sig = signRecord(prepared, privateKey, crypto.createPublicKey(privateKey));
  assert.throws(() => core.submitDream({ ...prepared, sig }), /different author/);
});

test('stats 暴露 signed/legacy 计数', () => {
  const s = core.dreamStats();
  assert.ok(Number.isInteger(s.signedCount));
  assert.ok(Number.isInteger(s.legacyCount));
  assert.ok(s.totalDreams >= 1);
});
