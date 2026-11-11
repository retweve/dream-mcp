# REDTEAM — 共享梦境池攻击测试

生成于 2026-11-11T14:41:30.644Z（临时 DREAM_HOME: `C:\Users\86188\AppData\Local\Temp\dream-redteam-y1rDo4`）

**11 PASS / 0 FAIL / 2 SKIP**

| ID | 威胁 | 攻击 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|
| T01 | 记忆投毒（先验回灌） | 提交含指令文本的记录 3 份 → 聚合 → 检查先验关键词 | 关键词中不含指令词 | clean | PASS |
| T02 | 提示注入（先验层） | 检查 aggregate 的 INSTRUCTION_WORDS 过滤 | 过滤表覆盖 忽略/执行/指令 | 覆盖 3/3 | PASS |
| T04 | 去匿名化 | 聚合输出里搜作者名 | 不含任何作者名 | none | PASS |
| T06 | 路径穿越 | getDream({id:"../../etc/passwd"}) | 拒绝 | 拒绝: valid id is required | PASS |
| T07 | 重复提交 | 同内容提交两次 | 第二次返回 duplicate | duplicate=true | PASS |
| T08 | 超限条目 | 提交 301 字符条目 | 拒绝 | 拒绝 | PASS |
| T08b | 空 entries | 提交空 entries | 拒绝 | 拒绝 | PASS |
| T09 | HTTP 鉴权 | 无 token / 假 token / 真 token 请求 /stats | 401/401/200 | 401/401/200 | PASS |
| T11 | 删除零残留 | 按作者删除后断言 grep 无残留 | PASS | PASS | PASS |
| T14 | 伪造签名 | 提交签名值伪造的记录 | 拒绝 | 拒绝 | PASS |
| T15 | 伪造 Merkle 证明 | 篡改 inclusion proof 的一个节点 | 验证失败 | 验证失败 | PASS |
| T05 | Sybil 刷 k | 一人多密钥伪造多作者 | 当前无法防住（需外部背书） | 登记为已知风险 | SKIP |
| T10 | 限流绕过 | 反代后同 IP 多请求 | 按 IP 限流可被代理绕过 | 登记为已知风险 | SKIP |

## 未覆盖（SKIP 说明）

- **T05**：密钥不能绑定真实身份
- **T10**：需在反代层限流

## 结论

✅ 已实现控制全部生效；SKIP 项为已知未防住，公开部署前必须解决。
