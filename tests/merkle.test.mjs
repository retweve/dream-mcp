import test from 'node:test';
import assert from 'node:assert/strict';
import { mth, auditPath, verifyInclusion, consistencyProof, verifyConsistency, leafHash, isEmptyRoot } from '../merkle.mjs';
import crypto from 'node:crypto';

const leaves = Array.from({ length: 7 }, (_, i) => Buffer.from('d' + i));
const root = mth(leaves);

test('空树根 = SHA-256(空)', () => {
  assert.ok(isEmptyRoot(mth([])));
  assert.equal(mth(0 === 0 ? [] : []).toString('hex'), crypto.createHash('sha256').digest('hex'));
});

test('单叶根 = 叶哈希', () => {
  assert.deepEqual(mth([leaves[0]]), leafHash(leaves[0]));
});

test('7 叶全部 inclusion proof 可通过轻客户端验证', () => {
  for (let i = 0; i < leaves.length; i++) {
    const path = auditPath(i, leaves);
    assert.ok(verifyInclusion(i, leaves.length, leaves[i], path, root), `leaf ${i}`);
  }
});

test('篡改叶数据后 proof 失败', () => {
  const path = auditPath(3, leaves);
  assert.equal(verifyInclusion(3, leaves.length, Buffer.from('d3-tampered'), path, root), false);
});

test('下标越界返回 false', () => {
  assert.equal(verifyInclusion(7, 7, leaves[0], auditPath(0, leaves), root), false);
});

test('proof 截断返回 false', () => {
  const path = auditPath(1, leaves).slice(0, -1);
  assert.equal(verifyInclusion(1, leaves.length, leaves[1], path, root), false);
});

test('一致性证明可验证（m = 1..6）', () => {
  for (let m = 1; m < leaves.length; m++) {
    const proof = consistencyProof(m, leaves);
    const oldRoot = mth(leaves.slice(0, m));
    assert.ok(verifyConsistency(m, leaves, oldRoot, root, proof), `m=${m}`);
  }
});

test('篡改一致性证明会被拒绝', () => {
  const m = 3;
  const proof = consistencyProof(m, leaves);
  const bad = proof.map((b, i) => (i === 0 ? Buffer.alloc(32, 0xff) : b));
  assert.equal(verifyConsistency(m, leaves, mth(leaves.slice(0, m)), root, bad), false);
});

test('audit path 长度 ≤ ceil(log2 n)+1', () => {
  for (let i = 0; i < leaves.length; i++) {
    assert.ok(auditPath(i, leaves).length <= Math.ceil(Math.log2(leaves.length)) + 1);
  }
});
