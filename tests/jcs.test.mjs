import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, canonicalBytes, contentHash, JcsError } from '../jcs.mjs';

// RFC 8785 §3.2.2 样例 → §3.2.3 期望输出
const input = {
  numbers: [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],
  string: "\u20ac$\u000F\u000aA'\u0042\u0022\u005c\\\"\/",
  literals: [null, true, false],
};
const expected = '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}';
const expectedHex = '7b226c69746572616c73223a5b6e756c6c2c747275652c66616c73655d2c226e756d62657273223a5b3333333333333333332e333333333333332c31652b33302c342e352c302e3030322c31652d32375d2c22737472696e67223a22e282ac245c75303030665c6e4127425c225c5c5c5c5c222f227d';

test('JCS 规范化结果与 RFC 8785 §3.2.3 一致', () => {
  assert.equal(canonicalize(input), expected);
});

test('JCS UTF-8 字节与 RFC 8785 §3.2.4 一致', () => {
  assert.equal(canonicalBytes(input).toString('hex'), expectedHex);
});

test('JCS 键排序按 UTF-16 code unit', () => {
  const obj = {
    '\u20ac': 'Euro Sign', '\r': 'Carriage Return', '\ufb33': 'Hebrew Letter Dalet With Dagesh',
    '1': 'One', '\ud83d\ude00': 'Emoji: Grinning Face', '\u0080': 'Control',
    '\u00f6': 'Latin Small Letter O With Diaeresis',
  };
  const canon = canonicalize(obj);
  const order = [...canon.matchAll(/:("(?:[^"\\]|\\.)*")/g)].map(m => JSON.parse(m[1]));
  assert.deepEqual(order, [
    'Carriage Return', 'One', 'Control', 'Latin Small Letter O With Diaeresis',
    'Euro Sign', 'Emoji: Grinning Face', 'Hebrew Letter Dalet With Dagesh',
  ]);
});

test('键序不影响哈希', () => {
  assert.equal(contentHash({ a: 'x', b: 'y' }), contentHash({ b: 'y', a: 'x' }));
});

test('NaN / Infinity 必须拒绝', () => {
  assert.throws(() => canonicalize({ n: NaN }), JcsError);
  assert.throws(() => canonicalize({ n: Infinity }), JcsError);
});

test('孤立代理必须拒绝', () => {
  assert.throws(() => canonicalize({ s: '\ud800' }), JcsError);
});

test('数组中的 undefined 必须拒绝', () => {
  assert.throws(() => canonicalize([1, undefined]), JcsError);
});

test('对象中的 undefined 属性被省略（与 JSON.stringify 一致）', () => {
  assert.equal(canonicalize({ a: 1, b: undefined }), '{"a":1}');
});
