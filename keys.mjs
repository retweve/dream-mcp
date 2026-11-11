/**
 * 公钥目录（TOFU：首次提交时登记作者声明）。
 *
 * 布局（DREAM_HOME 下）：
 *   keys/<keyId>.json          公钥 + 作者声明 + 首次登记时间（可公开）
 *   keys/<keyId>.private.pem   私钥（**绝不提交、绝不外发**）
 *   keys/server.json           服务器 STH 签名密钥的公钥部分
 *   keys/server.private.pem    服务器私钥
 *
 * keyId = sha256(原始 32 字节公钥) 的前 16 个 hex 字符。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// 独立解析 ROOT，避免与 core.mjs 形成循环依赖
const ROOT = process.env.DREAM_HOME || path.resolve(process.cwd(), 'dream', 'shared');

export const KEYS_DIR = path.join(ROOT, 'keys');

function ensureDir() {
  fs.mkdirSync(KEYS_DIR, { recursive: true });
}

export function rawPublicKey(publicKey) {
  // SPKI DER 末尾 32 字节即 Ed25519 原始公钥
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return der.subarray(der.length - 32);
}

export function keyIdOf(rawPub) {
  return crypto.createHash('sha256').update(rawPub).digest('hex').slice(0, 16);
}

/** 从原始 32 字节公钥重建 SPKI PEM（Ed25519 前缀固定）。 */
export function pemFromRaw(rawPub) {
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawPub]);
  return crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' }).export({ type: 'spki', format: 'pem' });
}

/** 生成密钥对；返回 { keyId, publicKeyPem, privateKeyPem, rawPublicKey }。 */
export function generateKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = rawPublicKey(publicKey);
  return {
    keyId: keyIdOf(raw),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    rawPublicKey: raw,
  };
}

/** 登记作者公钥（TOFU）。已存在且作者不同则拒绝。 */
export function registerKey({ keyId, publicKeyPem, author, note = null }) {
  ensureDir();
  const file = path.join(KEYS_DIR, `${keyId}.json`);
  if (fs.existsSync(file)) {
    const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (existing.author !== author) {
      throw new Error(`key ${keyId} already registered to a different author`);
    }
    return existing;
  }
  const entry = {
    keyId,
    author,
    publicKey: publicKeyPem,
    registeredAt: new Date().toISOString(),
    note,
    trust: 'tofu',
  };
  fs.writeFileSync(file, JSON.stringify(entry, null, 2) + '\n', 'utf8');
  return entry;
}

export function lookupKey(keyId) {
  const file = path.join(KEYS_DIR, `${keyId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** 保存私钥（0600）。 */
export function savePrivateKey(keyId, privateKeyPem) {
  ensureDir();
  const file = path.join(KEYS_DIR, `${keyId}.private.pem`);
  fs.writeFileSync(file, privateKeyPem, { encoding: 'utf8', mode: 0o600 });
  return file;
}

export function loadPrivateKey(keyId) {
  const file = path.join(KEYS_DIR, `${keyId}.private.pem`);
  if (!fs.existsSync(file)) throw new Error(`private key not found for ${keyId}`);
  return crypto.createPrivateKey(fs.readFileSync(file, 'utf8'));
}

/** 服务器 STH 密钥：不存在则生成并落盘。 */
export function ensureServerKey() {
  ensureDir();
  const pubFile = path.join(KEYS_DIR, 'server.json');
  const privFile = path.join(KEYS_DIR, 'server.private.pem');
  if (fs.existsSync(pubFile) && fs.existsSync(privFile)) {
    const meta = JSON.parse(fs.readFileSync(pubFile, 'utf8'));
    return { keyId: meta.keyId, publicKeyPem: meta.publicKey, privateKey: crypto.createPrivateKey(fs.readFileSync(privFile, 'utf8')) };
  }
  const kp = generateKeypair();
  fs.writeFileSync(privFile, kp.privateKeyPem, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(pubFile, JSON.stringify({ keyId: kp.keyId, publicKey: kp.publicKeyPem, role: 'sth-signing', createdAt: new Date().toISOString() }, null, 2) + '\n', 'utf8');
  return { keyId: kp.keyId, publicKeyPem: kp.publicKeyPem, privateKey: crypto.createPrivateKey(kp.privateKeyPem) };
}
