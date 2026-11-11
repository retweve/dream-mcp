import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// 必须在导入 keys/sign 之前设置 DREAM_HOME（它们在模块初始化时读取）
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-sign-'));
process.env.DREAM_HOME = tmp;

const { generateKeypair, savePrivateKey, registerKey, lookupKey, loadPrivateKey, keyIdOf, pemFromRaw } = await import('../keys.mjs');
const { prepareBody } = await import('../body.mjs');
const { signRecord, verifyRecordSignature, signingBody, leafDataBytes } = await import('../sign.mjs');

const kp = generateKeypair();
savePrivateKey(kp.keyId, kp.privateKeyPem);
registerKey({ keyId: kp.keyId, publicKeyPem: kp.publicKeyPem, author: 'alice', note: 'test' });

const rawBody = () => prepareBody({
  author: 'alice',
  title: 'windows pitfall',
  summary: 'demo',
  entries: [{ text: 'schtasks 被拒时用 HKCU Run', type: 'warning', confidence: 'confirmed' }],
  tags: ['windows'],
  consent: { share: true, derivatives: true },
}).body;

test('签名/验签往返通过', () => {
  const body = rawBody();
  const privateKey = loadPrivateKey(kp.keyId);
  const publicKey = crypto.createPublicKey(privateKey);
  const sig = signRecord(body, privateKey, publicKey);
  const result = verifyRecordSignature({ ...body, sig }, { requireKey: true });
  assert.equal(result.ok, true);
  assert.equal(result.keyId, kp.keyId);
});

test('篡改内容后验签失败', () => {
  const body = rawBody();
  const privateKey = loadPrivateKey(kp.keyId);
  const sig = signRecord(body, privateKey, crypto.createPublicKey(privateKey));
  const tampered = { ...body, title: 'different title' };
  assert.equal(verifyRecordSignature({ ...tampered, sig }, { requireKey: true }).ok, false);
});

test('keyId 与公钥不符时拒绝', () => {
  const body = rawBody();
  const privateKey = loadPrivateKey(kp.keyId);
  const sig = signRecord(body, privateKey, crypto.createPublicKey(privateKey));
  const bad = { ...sig, keyId: '0000000000000000' };
  const result = verifyRecordSignature({ ...body, sig: bad }, { requireKey: true });
  assert.equal(result.ok, false);
  assert.match(result.reason, /keyId/);
});

test('签名长度错误时拒绝', () => {
  const body = rawBody();
  const sig = { alg: 'ed25519', keyId: kp.keyId, publicKey: kp.rawPublicKey.toString('base64url'), value: Buffer.alloc(10).toString('base64url') };
  const result = verifyRecordSignature({ ...body, sig }, { requireKey: true });
  assert.equal(result.ok, false);
  assert.match(result.reason, /64 bytes/);
});

test('未签名记录在 requireKey 下被拒', () => {
  assert.equal(verifyRecordSignature(rawBody(), { requireKey: true }).ok, false);
  assert.equal(verifyRecordSignature(rawBody(), { requireKey: false }).ok, true);
});

test('同一公钥登记为不同作者会被拒绝', () => {
  assert.throws(() => registerKey({ keyId: kp.keyId, publicKeyPem: kp.publicKeyPem, author: 'mallory' }), /different author/);
});

test('pemFromRaw 重建的公钥与原始一致', () => {
  const pem = pemFromRaw(kp.rawPublicKey);
  const raw = crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' }).subarray(-32);
  assert.deepEqual(raw, kp.rawPublicKey);
  assert.equal(keyIdOf(raw), kp.keyId);
});

test('signingBody 只包含约定字段且叶数据稳定', () => {
  const body = rawBody();
  const record = { ...body, id: 'x', submittedAt: 'y', contentHash: 'z' };
  assert.deepEqual(Object.keys(signingBody(record)).sort(), ['author', 'consent', 'entries', 'lineage', 'summary', 'tags', 'title']);
  assert.deepEqual(leafDataBytes(record), leafDataBytes({ ...record, id: 'other', submittedAt: 'q' }));
});

test('sanitize 后的内容可签名（签名覆盖存储字节）', () => {
  const { body } = prepareBody({ author: 'alice', title: 'mail a@b.com', entries: [{ text: 'token sk-abcdefgh' }] });
  const privateKey = loadPrivateKey(kp.keyId);
  const sig = signRecord(body, privateKey, crypto.createPublicKey(privateKey));
  assert.equal(verifyRecordSignature({ ...body, sig }, { requireKey: true }).ok, true);
});
