import test from 'node:test';
import assert from 'node:assert/strict';
import { mth, auditPath, verifyInclusion, consistencyProof, verifyConsistency, verifyConsistencyLight, leafHash, isEmptyRoot } from '../merkle.mjs';
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

// ---------- 轻客户端一致性验证（G2） ----------
const many = (n) => Array.from({ length: n }, (_, i) => Buffer.from('L' + i));

test('轻客户端一致性：n=2..24 的每个 m 都通过', () => {
  for (let n = 2; n <= 24; n++) {
    const lv = many(n);
    const newRoot = mth(lv);
    for (let m = 1; m < n; m++) {
      const oldRoot = mth(lv.slice(0, m));
      const proof = consistencyProof(m, lv);
      assert.ok(verifyConsistencyLight(m, n, oldRoot, newRoot, proof), `m=${m} n=${n}`);
    }
  }
});

test('轻客户端一致性：篡改任一 proof 元素被拒', () => {
  const lv = many(9);
  const m = 5;
  const oldRoot = mth(lv.slice(0, m));
  const newRoot = mth(lv);
  const proof = consistencyProof(m, lv);
  assert.ok(verifyConsistencyLight(m, 9, oldRoot, newRoot, proof));
  for (let i = 0; i < proof.length; i++) {
    const bad = proof.map((b, j) => (j === i ? Buffer.alloc(32, 0xff) : b));
    assert.equal(verifyConsistencyLight(m, 9, oldRoot, newRoot, bad), false, `tampered element ${i}`);
  }
});

test('轻客户端一致性：proof 过短/过长被拒', () => {
  const lv = many(9);
  const m = 5;
  const oldRoot = mth(lv.slice(0, m));
  const newRoot = mth(lv);
  const proof = consistencyProof(m, lv);
  assert.equal(verifyConsistencyLight(m, 9, oldRoot, newRoot, proof.slice(0, -1)), false);
  assert.equal(verifyConsistencyLight(m, 9, oldRoot, newRoot, [...proof, proof[0]]), false);
});

test('轻客户端一致性：m == n 要求空 proof 且根相等', () => {
  const lv = many(5);
  const root = mth(lv);
  assert.ok(verifyConsistencyLight(5, 5, root, root, []));
  assert.equal(verifyConsistencyLight(5, 5, root, Buffer.alloc(32, 1), []), false);
});

test('轻客户端一致性：m == 0 要求空树根与空 proof', () => {
  const emptyRoot = mth([]);
  assert.ok(verifyConsistencyLight(0, 3, emptyRoot, mth(many(3)), []));
  assert.equal(verifyConsistencyLight(0, 3, Buffer.alloc(32, 2), mth(many(3)), []), false);
});

test('轻客户端一致性：错误 oldRoot 被拒', () => {
  const lv = many(8);
  const m = 3;
  const proof = consistencyProof(m, lv);
  const wrongOld = Buffer.alloc(32, 7);
  assert.equal(verifyConsistencyLight(m, 8, wrongOld, mth(lv), proof), false);
});
