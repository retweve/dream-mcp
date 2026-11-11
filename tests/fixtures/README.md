# RFC 8032 §7.1 测试向量（Ed25519）

- 来源：<https://www.rfc-editor.org/rfc/rfc8032.txt> §7.1 "Test Vectors for Ed25519"
- 提取时间：2026-11-11；提取方式：从 RFC 原文按 `-----TEST n` 块解析 secret/public/message/signature，
  保持十六进制原样，未做任何改写。
- 收录：TEST 1（空消息）、TEST 2（1 字节）、TEST 3（2 字节）、TEST 1024（1023 字节）。
- 用途：`tests/rfc8032-vectors.test.mjs` 逐条验证「签名结果与官方向量逐字节一致」以及
  「公钥可由私钥推导」「篡改消息/签名被拒」。
- 说明：RFC 同时说明这些向量取自 [ED25519-TEST-VECTORS] 与 [ED25519-LIBGCRYPT-TEST-VECTORS]，
  并去掉了私钥后缀的公钥与签名中的消息部分。
