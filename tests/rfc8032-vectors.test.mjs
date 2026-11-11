import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'rfc8032-ed25519.json'), 'utf8'));

// RFC 8032 §7.1 官方向量（从 RFC 原文提取，见 fixtures 说明）
// 原始私钥 32 字节 seed → PKCS8 DER 前缀固定
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

for (const v of vectors) {
  test(`RFC 8032 ${v.name}：签名与官方向量一致`, () => {
    const seed = Buffer.from(v.secretKey, 'hex');
    assert.equal(seed.length, 32, 'secret key must be 32 bytes');
    const privateKey = crypto.createPrivateKey({
      key: Buffer.concat([PKCS8_PREFIX, seed]),
      format: 'der',
      type: 'pkcs8',
    });
    const message = Buffer.from(v.message, 'hex');
    assert.equal(message.length, v.msgLen);

    const sig = crypto.sign(null, message, privateKey);
    assert.equal(sig.toString('hex'), v.signature, 'signature must match RFC vector');

    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, Buffer.from(v.publicKey, 'hex')]),
      format: 'der',
      type: 'spki',
    });
    assert.equal(crypto.verify(null, message, publicKey, sig), true);
  });

  test(`RFC 8032 ${v.name}：篡改消息/签名被拒`, () => {
    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, Buffer.from(v.publicKey, 'hex')]),
      format: 'der',
      type: 'spki',
    });
    const message = Buffer.from(v.message, 'hex');
    const sig = Buffer.from(v.signature, 'hex');
    // 空消息无法「翻转首字节」，改用追加一个字节来改变消息
    const tamperedMsg = message.length
      ? (() => { const b = Buffer.from(message); b[0] ^= 0xff; return b; })()
      : Buffer.from([0x00]);
    assert.equal(crypto.verify(null, tamperedMsg, publicKey, sig), false, 'tampered message must fail');
    const tamperedSig = Buffer.from(sig);
    tamperedSig[0] ^= 0xff;
    assert.equal(crypto.verify(null, message, publicKey, tamperedSig), false, 'tampered signature must fail');
  });
}

test('向量文件本身自洽：公钥可由私钥推导', () => {
  for (const v of vectors) {
    const privateKey = crypto.createPrivateKey({
      key: Buffer.concat([PKCS8_PREFIX, Buffer.from(v.secretKey, 'hex')]),
      format: 'der', type: 'pkcs8',
    });
    const derived = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).subarray(-32);
    assert.equal(derived.toString('hex'), v.publicKey, `${v.name} public key mismatch`);
  }
});
