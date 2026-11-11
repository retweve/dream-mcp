# 深入版任务简报：共享记忆 → 可验证的进化

> 这不是扩规模，是把同一件事做到**可证伪**。
> 原任务：「查有没有现成 dream MCP，没有就上线一个，让别人能提交 dream，用共享记忆让系统进化」。
> 本简报回答四个问题后，把它重写成有证据门槛的工程。

---

## 0. 四个前置问题（开工前必须书面回答）

### Q1 这个领域的顶尖专业人士，会做哪些你没要求的工作？

不是"多加功能"，而是**多加证据**：

1. **先写评测协议，再写代码**。预注册：baseline（只用本地记忆）vs treatment（加共享先验），
   指标、样本量、统计方法先定死，避免事后挑好看的数字。
2. **先做威胁模型，再开接口**。记忆投毒、跨租户越权、prompt injection 经由记忆进入上下文、
   sybil 刷票、k-匿名去匿名化、恶意超长负载、unicode 混淆绕过脱敏。
3. **读参考实现源码，不读博客**。Letta / Mem0 / Zep-Graphiti / Engram-MCP 的实际数据结构、
   合并策略、检索打分——博客只会告诉你"我们支持记忆"。
4. **出处与可验证性**：内容寻址（sha256）、作者签名（Ed25519）、透明日志（Merkle），
   让"这条是谁什么时候交的"可被第三方验证。
5. **数据治理**：目的限制、同意可撤回、保留期、删除证明（tombstone + 零残留测试）。
6. **成本模型**：每次提交/召回的 token、p50/p95 延迟、存储增长；预算硬上限。
7. **给提交者做 UX**：dry-run、错误信息可执行、示例、schema 自检。
8. **写 limitation 和 negative results**——"共享记忆在这类任务上没用"同样是有价值的结论。
9. **可观测性**：结构化日志 + trace，出问题能定位到具体 pattern/具体提交。
10. **失败模式目录**：错误记忆率、污染率、过期率——不是只报成功率。

### Q2 他们从哪些最原始的材料入手？

| 层级 | 一手材料 | 不要用什么 |
|---|---|---|
| 数据 | **原始会话 transcript**（`session.v4.jsonl.zstd` 解出的全文）、**真实他人提交** | 我们的 `digest.md`（已截断）、合成的 demo 记录 |
| 规范 | MCP 规范原文（[modelcontextprotocol.io](https://modelcontextprotocol.io/docs/)）、JSON-RPC 2.0、JSON Schema；RFC 8785（JCS 规范化）、RFC 6962（透明日志）、RFC 8032（Ed25519）、RFC 6750（Bearer）、RFC 6585（429） | 二手"最佳实践"清单 |
| 论文 | [Anthropic《The components of agent memory》](https://www.anthropic.com/research/components-of-agent-memory)、[Letta sleep-time compute（arXiv:2504.13171）](https://arxiv.org/abs/2504.13171)、[Generative Agents（arXiv:2304.03442）](http://export.arxiv.org/abs/2304.03442) 的**原文**；Mem0、Zep/Graphiti、LongMemEval、[CL-Bench](https://continual-learning-bench.com/news/cl-bench-1-0/) 的论文与**源码** | 论文的二手解读 |
| 合规 | GDPR 条文（Art.5 目的限制、Art.17 删除）、[NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework)、ISO/IEC 42001、[OWASP MCP Top 10](https://owasp.org/projects/mcp-top-10) | 律所博客 |
| 失败样本 | 我们自己的 `verify` 里 `absent`/`needs-llm-review`、`eval` 的 `misses`、真实提交的错误 | 精选的成功案例 |

### Q3 具体方法与工具

| 环节 | 方法 | 工具 |
|---|---|---|
| 文献 | claim→evidence→caveat 矩阵，逐条记"证据强度/反例" | 表格 + 原文链接 |
| 评测 | **配对设计**（同题 baseline/treatment）、bootstrap 置信区间、效应量；不报单次结果 | Node 内置 `node --test`、固定种子 |
| 消融 | consent 过滤 on/off、k 取值、去重开关、prior on/off 四组 | 同一 harness |
| 安全 | STRIDE + 红队 payload 集；属性测试（幂等、k-匿名不变量、脱敏全覆盖）；模糊测试 | 自建 fuzz + property tests |
| 完整性 | 内容寻址 + Ed25519 签名 + Merkle 透明日志 + RFC 8785 canonical JSON | Node `crypto` |
| 治理 | consent ledger、tombstone、保留期作业、删除后零残留 grep 断言 | 脚本 + CI |
| 观测 | 结构化日志、p50/p95、每 pattern 的命中/误用计数 | 轻量自建（不引重依赖） |
| 复现 | 一条命令从干净 checkout 出同样数字；版本与种子固定 | `node --test` + `make eval` |

### Q4 除了你我的判断，什么能证明结果是对的？

1. **第三方可复现**：干净克隆 → 一条命令 → 同样的数字（数据+种子+版本都固定）。
2. **公开基准**：LongMemEval / CL-Bench 子集上，baseline vs treatment 的数字 + 置信区间。
3. **独立重实现核对**：另一个人/agent 从原始 transcript 独立跑一遍，结论一致。
4. **密码学可验证**：提交签名可验、Merkle 根可公开、任何人能验证"某条记录在日志里"。
5. **统计证据**：配对 bootstrap 的 CI 不跨零；效应量而非 p 值哨兵。
6. **红队报告**：注入/投毒/越权/去匿名化的攻击成功率，公开失败。
7. **形式性质测试**：schema 符合、提交幂等、k-匿名不变量、删除后零残留——全部自动化。
8. **同行评审**：GitHub issue/PR、外部贡献者、公开 limitation。
9. **纵向部署数据**：连续 4 周的真实指标（命中率、错误记忆率、过期率），而不是单次 demo。

---

## 1. 改写后的提示词

> 以下是可以直接交给执行 agent 的版本。

---

**目标（深度优先，不扩规模）**

把"共享梦境池"做成一个**可证伪**的系统：能回答「共享记忆到底让 agent 变好了多少」，
并且这个答案能被第三方独立验证。**不增加功能面**，只把已有四个端点、聚合、先验做扎实。

**非目标（写死）**

- 不做模型权重训练/微调，不把共享数据送任何训练服务
- 不扩新协议、不做多租户 SaaS、不做前端
- 不追求提交量，追求每一条提交的可验证性与可撤回性

**开工前置（G0，未完成不得写业务代码）**

1. **评测协议**：写清 baseline / treatment、任务集来源（原始 transcript 取样，非 digest）、
   指标（可达率、错误记忆率、token 成本、p95 延迟）、样本量、统计方法（配对 bootstrap，1000 次重采样）。
   协议落盘为 `eval/PROTOCOL.md`，之后**不得**因结果不好而改指标。
2. **威胁模型**：STRIDE + 记忆投毒 + 去匿名化 + 注入，落盘 `security/THREAT-MODEL.md`，
   每条威胁对应一个测试用例编号。
3. **一手材料清单**：每篇论文/每个规范标注"读了哪一节、得出什么约束"，落盘 `research/SOURCES.md`。
   **只允许引用一手链接**；二手解读必须标明"二手"。

**G1 实现（只做四件事，但做透）**

1. `core.mjs` 的边界校验升级为 **JSON Schema 等价实现 + 属性测试**（幂等、上限、脱敏全覆盖）
2. 提交 **Ed25519 签名**（可选字段 `signature`/`publicKey`），提供 `verify.mjs`；
   未签名的记录在池子里标记 `unsigned`
3. **透明日志**：每条记录进 Merkle 树，周期性发布根；提供 `prove.mjs --id` 输出 inclusion proof
4. **删除证明**：`erase.mjs --author` 写 tombstone + 重建索引 + 断言 grep 零残留

**G2 聚合与先验（做深，不扩）**

1. 聚类与 k-匿名保留，但补 **去匿名化攻击测试**：k=3 时，给定标签+时间能否反推作者
2. `aggregate.mjs` 输出增加 `effectSize` 与 `sampleDreams`，并做 **消融**：
   consent 过滤开/关、k=2/3/5、去重开/关
3. `prior.mjs` 的注入必须可关闭，且评测里必须有 **prior-off 对照**

**G3 独立验证（交付的核心）**

1. `make eval`：干净 checkout 一条命令跑完整评测，输出 JSON + 人读报告
2. 在 **LongMemEval 或 CL-Bench 子集**上跑 baseline vs treatment，报 CI 与效应量
3. 红队报告：`security/REDTEAM.md`，列出每条攻击的成功/失败与修复
4. 删除后零残留、提交幂等、k-匿名不变量，全部进 CI

**G4 纵向（最小可行）**

连续 4 周记录：pattern 命中次数、被采纳/被忽略比例、过期条数、错误记忆条数。
**允许得出"没用"的结论**，并如实写进 limitation。

**交付物**

```
eval/PROTOCOL.md  research/SOURCES.md  security/THREAT-MODEL.md  security/REDTEAM.md
core.mjs(+schema/property tests)  verify.mjs  prove.mjs  erase.mjs
aggregate.mjs(+消融)  prior.mjs(+对照)  make eval  CI
```

**完成定义（DoD）**

- [ ] 协议先落盘，指标未被事后修改
- [ ] 第三方从干净克隆能复现同一组数字
- [ ] 至少一个公开基准上给出 baseline vs treatment + CI
- [ ] 红队每条威胁有测试与结论
- [ ] 删除/签名/透明日志可被独立验证
- [ ] limitation 写明，包含至少一条 negative result

**硬边界**

- 共享数据只用于：聚合规律、构建评测、改进提示词/技能/路由；**永不进权重**
- 无同意（`consent.derivatives=false`）的记录不参与聚合
- k-匿名不足 3 位作者的规律不输出
- 任何"看起来变好了"的结论，必须有可复算的证据，否则视为未发生
