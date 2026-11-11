#!/usr/bin/env node
/**
 * 透明日志：Merkle 树 + Signed Tree Head + inclusion proof。
 *
 *   node prove.mjs                 # 输出当前 STH（并追加到 sth.jsonl）
 *   node prove.mjs --id <dream-id> # 输出该记录的 inclusion proof（JSON）
 *   node prove.mjs --verify <file> # 验证一份 proof JSON
 *   node prove.mjs --consistency <m> # 输出前 m 叶与当前树的一致性证明
 *
 * 叶数据 = JCS(提交内容含签名，不含服务器字段)，与 keys/sign 定义一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, INBOX } from './core.mjs';
import { leafDataBytes } from './sign.mjs';
import { mth, auditPath, verifyInclusion, consistencyProof, verifyConsistency, leafHash } from './merkle.mjs';
import { ensureServerKey, pemFromRaw, keyIdOf } from './keys.mjs';

const STH_LOG = path.join(ROOT, 'sth.jsonl');
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };

function loadRecords() {
  if (!fs.existsSync(INBOX)) return [];
  return fs.readdirSync(INBOX).filter(f => f.endsWith('.json'))
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(INBOX, f), 'utf8')); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => (a.submittedAt || '').localeCompare(b.submittedAt || '') || a.id.localeCompare(b.id));
}

function buildTree() {
  const records = loadRecords();
  const leaves = records.map(r => leafDataBytes(r));
  const root = mth(leaves);
  return { records, leaves, root };
}

function signSth(treeSize, rootHashHex) {
  const { keyId, privateKey, publicKeyPem } = ensureServerKey();
  const sthBody = { v: 1, treeSize, rootHash: rootHashHex, timestamp: new Date().toISOString() };
  const bytes = Buffer.from(JSON.stringify(sthBody), 'utf8');
  const signature = crypto.sign(null, bytes, privateKey);
  const der = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return {
    ...sthBody,
    sig: { alg: 'ed25519', keyId, publicKey: der.subarray(-32).toString('base64url'), value: signature.toString('base64url') },
  };
}

function verifySth(sth) {
  try {
    const { sig, ...body } = sth;
    const raw = Buffer.from(sig.publicKey, 'base64url');
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
    const key = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
    const ok = crypto.verify(null, Buffer.from(JSON.stringify(body), 'utf8'), key, Buffer.from(sig.value, 'base64url'));
    return ok && keyIdOf(raw) === sig.keyId;
  } catch { return false; }
}

const cmdVerify = arg('verify');
const cmdId = arg('id');
const cmdConsistency = arg('consistency');

if (cmdVerify) {
  const proof = JSON.parse(fs.readFileSync(cmdVerify, 'utf8'));
  const leaves = proof.leafData ? [Buffer.from(proof.leafData, 'base64url')] : [];
  const pathBufs = proof.path.map(p => Buffer.from(p, 'base64url'));
  const root = Buffer.from(proof.root, 'hex');
  const ok = verifyInclusion(proof.index, proof.treeSize, leaves[0], pathBufs, root);
  const sthOk = proof.sth ? verifySth(proof.sth) : false;
  console.log(JSON.stringify({ ok, sthOk }, null, 2));
  process.exit(ok && sthOk ? 0 : 1);
}

const tree = buildTree();
const sth = signSth(tree.leaves.length, tree.root.toString('hex'));

if (cmdId) {
  const index = tree.records.findIndex(r => r.id === cmdId);
  if (index < 0) { console.error(`dream not found: ${cmdId}`); process.exit(2); }
  const pathNodes = auditPath(index, tree.leaves);
  const proof = {
    id: cmdId,
    index,
    treeSize: tree.leaves.length,
    leafData: tree.leaves[index].toString('base64url'),
    path: pathNodes.map(b => b.toString('base64url')),
    root: tree.root.toString('hex'),
    sth,
  };
  console.log(JSON.stringify(proof, null, 2));
  process.exit(0);
}

if (cmdConsistency) {
  const m = Number(cmdConsistency);
  const proof = consistencyProof(m, tree.leaves);
  console.log(JSON.stringify({
    m,
    n: tree.leaves.length,
    oldRoot: mth(tree.leaves.slice(0, m)).toString('hex'),
    newRoot: tree.root.toString('hex'),
    proof: proof.map(b => b.toString('base64url')),
    sth,
  }, null, 2));
  const ok = verifyConsistency(m, tree.leaves, mth(tree.leaves.slice(0, m)), tree.root, proof);
  if (!ok) process.exit(1);
  process.exit(0);
}

fs.mkdirSync(ROOT, { recursive: true });
fs.appendFileSync(STH_LOG, JSON.stringify(sth) + '\n', 'utf8');
console.log(JSON.stringify({
  treeSize: sth.treeSize,
  rootHash: sth.rootHash,
  timestamp: sth.timestamp,
  signed: true,
  sthPath: STH_LOG,
}, null, 2));
