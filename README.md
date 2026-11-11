# dream-mcp — 共享梦境池

**已上线：<https://github.com/retweve/dream-mcp>（MIT，公开）**

> 让**别人/别的 agent** 把 dream 记录交进来，形成一个可以共同积累的记忆池。
>
> 背景：GitHub 上已有 [dream-mcp](https://github.com/JamieSetch/dream-mcp)、
> [Pseudolife-MCP](https://github.com/Pseudogiant-xr/Pseudolife-MCP)、
> [Mnemosyne](https://github.com/nianpangzhi233/Mnemosyne-AI-Memory) 等 dream 类 MCP，
> 但它们都是**单机单人记忆**——没有一个是"共享收件箱"。这个服务器补的就是这一层。

## 30 秒上手

```bash
git clone https://github.com/retweve/dream-mcp
cd dream-mcp
node cli.mjs submit --file examples/example-dream.json
node cli.mjs list
```

## 完整性原语（G1，v1.2）

| 能力 | 命令 | 依据 |
|---|---|---|
| 规范化哈希（键序无关） | 提交时自动 `hashAlg: "jcs-sha256/v1"` | RFC 8785 |
| Ed25519 签名 | `node sign.mjs keygen --author 名字` → `node sign.mjs sign --file raw.json --key <keyId>` | RFC 8032 |
| 验签 | `node sign.mjs verify --file signed.json` | RFC 8032 |
| Merkle 透明日志 | `node prove.mjs` 输出并签名 STH | RFC 6962 |
| inclusion proof | `node prove.mjs --id <id>` → `node prove.mjs --verify proof.json` | RFC 6962 |
| 一致性证明 | `node prove.mjs --consistency <m>` | RFC 6962 |
| 删除证明 | `node erase.mjs --id <id> --yes`（tombstone + 重建索引 + 零残留断言） | GDPR Art.17 |
**签名覆盖什么**：`JCS({author,title,summary,entries,tags,lineage,consent})`，
服务器附加字段（id/submittedAt/contentHash）不参与签名。签名封套在顶层 `.sig`：

```json
{ "alg": "ed25519", "keyId": "sha256:<16hex>", "publicKey": "<base64url 32B>", "value": "<base64url 64B>" }
```

**公钥目录（TOFU）**：`keys/<keyId>.json` 记录作者声明；同一公钥被登记为不同作者会被拒绝。
私钥 `keys/<keyId>.private.pem` 只在本地、权限 0600、**永不入库**。

**迁移兼容**：旧记录（`hashAlg` 缺失）标为 `legacy-jsonstringify`，不重算哈希、不做签名验证；
新记录一律 `jcs-sha256/v1`。去重只在同 `hashAlg` 组内比较。

**已验证（2026-11-11，G2 补强）**：
- 一致性证明**轻客户端验证**已实现：`verifyConsistencyLight(m, n, oldRoot, newRoot, proof)`，
  测试覆盖 n=2..24 的全部 m、篡改单元素、proof 过短/过长、错误 oldRoot、m=0/m=n 边界。
- **RFC 8032 §7.1 官方向量** TEST 1/2/3/1024 已落成测试：签名逐字节比对 RFC 结果，
  并验证公钥可由私钥推导、篡改消息/签名被拒（向量来源见 `tests/fixtures/README.md`）。
- `npm test` **59/59 通过**。

**已知限制**：暂无功能缺口；G3 待补红队报告与公开基准对比。

## G3 验证（独立可复现）

```bash
npm test        # 59 个单元测试（JCS / Merkle / 签名 / 核心 / prove / erase / RFC 向量）
npm run eval    # 不变量 + 配对 A/B（Level 0）+ 生成 eval/results/g3-eval.md
npm run redteam # 威胁模型逐条攻击 + 生成 security/REDTEAM.md
npm run verify  # eval + redteam 一起跑（CI 用）
```

**本次结果**（生成文件里带时间戳与临时路径，以下为摘要）：

- 不变量：6/6 通过（幂等、JCS 键序无关、k-匿名、inclusion、轻客户端一致性、删除零残留）
- 配对 A/B（Level 0 仪器验证）：24 题，正确率 33.3% → 100%，配对差 0.667，
  bootstrap 95% CI [0.500, 0.833]，Cohen's h = 1.911，对照题误报 0
- 红队：**11 PASS / 0 FAIL / 2 SKIP**（SKIP = T05 Sybil、T10 反代限流，均为已知未防住）

**诚实边界（UNVERIFIED，不伪造）**：

| 项 | 原因 |
|---|---|
| H1 模型级 A/B（先验是否让 agent 答得更准） | ✅ 已跑首轮 n=20：diff=20pp，CI [0.05,0.40]；**但敏感性分析剔除 1 个 agent 失败后 CI [0,0.368] → 结论脆弱**，不据此宣称有效 |
| 公开基准（LongMemEval / CL-Bench 子集） | 需要下载数据集并跑外部评测，未执行 |
| 模型层注入（T01/T02）的真实影响 | 文本层无法判定模型行为，只能人工审查 + 评测监控 |

> Level 0 只验证「测量机制能用」（配对、CI、效应量、不变量、攻击检测），
> **不是**「共享记忆让 agent 变强」的结论。H1 首轮见 `eval/model-ab/`（数据只留本机）。

**H1-v2（扩充，已完成 n=60）**：A/B 两臂都读取等长文件（A 读占位、B 读先验），
消除 v1 的"读文件"混杂；预注册见 whale 仓库 `evo/protocols/shared-memory-v2-amendment.md`。
最终结果：A 95.0% / B 88.3%，配对差 **-6.7pp**，CI [-0.150, 0.000]（excluded [-0.136, 0.017]）——
**证据不足，未证明先验有正收益**；v1 的 +20pp 可归因于读文件混杂。

没有任何依赖，Node 18+ 直接跑。

## 它是什么

一个零依赖的 MCP 服务器（stdio JSON-RPC 2.0），只做四件事：

| 工具 | 作用 |
|---|---|
| `dream_submit` | 提交一条梦（作者、标题、摘要、若干记忆条目、标签、谱系） |
| `dream_list` | 按时间倒序列出，可按作者/标签过滤 |
| `dream_get` | 按 id 取完整记录 |
| `dream_stats` | 总数、作者数、条目类型分布 |

## 共享之后怎么"进化"（重要）

见 [EVOLUTION.md](EVOLUTION.md)。一句话：**共享记忆用来进化系统，不进化模型权重。**

```
L1 个体记忆  →  L2 共享池  →  L3 系统能力（技能/提示词/评测/路由）
                                  ↑ aggregate.mjs + LLM 重写 + 人审
```

- **绝不**拿共享池训练模型权重（授权、隐私、法务、可逆性四重不可行）
- `aggregate.mjs` 只输出「关键词 + 计数 + 类型」，不输出原文、不输出作者名
- **k-匿名**：同一规律至少来自 `k ≥ 3` 个不同作者才允许输出
- 每条记录 `consent.derivatives` **默认 false**，显式 true 才参与聚合

```bash
node aggregate.mjs --k 3
# → 池子 4 条，同意派生 3 条，可输出规律 1 条
#   [windows-automation] 3 位作者 / 3 条
#   keywords: hkcu · wscript · 定时任务 · schtasks · 无管理员
```

## 强制脱敏

提交时对 `title / summary / entries[].text / source` 统一脱敏，**原文不落盘**：

| 类型 | 替换 |
|---|---|
| 邮箱 | `[email]` |
| 手机号 | `[phone]` |
| 身份证 | `[id]` |
| 密钥（`sk-`/`ghp_`/`AKIA`/`xoxb-`） | `[secret]` |
| URL 里的 token/key/sig 参数 | `[secret]` |
| 私网 IP / 长 hex | `[ip]` / `[hex]` |

## 存储（git 友好）

```
dream/shared/
├── inbox/
│   └── dream-<ts>-<slug>-<hash6>.json   # 一条梦一个文件，不可变
└── index.jsonl                          # 追加索引，一行一条
```

- 一条梦 = 一个不可变 JSON 文件，**适合直接 git 提交/PR 评审**
- `contentHash` 去重：同样的梦重复提交会返回已有 id，不会重复入库

## 别人怎么提交（三种方式）

### 1) MCP 客户端（推荐）

任何支持 MCP 的 agent（Claude Code / Cursor / DSH / 自建）加上这段配置即可：

```json
{
  "mcpServers": {
    "dream": {
      "command": "node",
      "args": ["/绝对路径/dream-mcp/server.mjs"],
      "env": { "DREAM_HOME": "/绝对路径/dream/shared" }
    }
  }
}
```

然后 agent 就能调用 `dream_submit`。

### 2) 命令行

```bash
node dream-mcp/cli.mjs submit --file my-dream.json
node dream-mcp/cli.mjs list
node dream-mcp/cli.mjs stats
```

### 3) Git PR（跨机器 / 陌生人）

把 `inbox/dream-*.json` 放进自己仓库的 `dream-mcp/inbox/`，提 PR 到本仓库。
维护者合并后在本地跑一次重建索引：

```bash
node dream-mcp/reindex.mjs
```

## 提交格式

```json
{
  "author": "谁在做梦（人或 agent 名）",
  "title": "一句话标题",
  "summary": "这次巩固了什么、为什么重要",
  "entries": [
    {
      "text": "一条事实/决策/教训，≤300 字符",
      "type": "fact|decision|preference|lesson|rule|warning|theory|plan",
      "confidence": "confirmed|unconfirmed|theory",
      "source": "出处（session id / url / 文件）"
    }
  ],
  "tags": ["memory", "architecture"],
  "lineage": { "parent": "leviathan-gen-1", "generation": 2 },
  "consent": { "share": true, "derivatives": false, "anonymize": true }
}
```

`consent.derivatives` 默认 **false**：记录可以在池子里被查看，但不参与任何聚合派生。

## 安全边界（写死在 server.mjs）

| 限制 | 值 |
|---|---|
| 单条梦 | ≤ 64 KB |
| entries | 1–50 条 |
| 单条 text | ≤ 300 字符 |
| title / summary | ≤120 / ≤800 字符 |
| tags | ≤ 8 个 |
| 路径 | 只读写 `DREAM_HOME/inbox`，不做代码执行 |
| 内容 | 一律当**数据**，不解释执行 |

**不含**：身份认证、去重之外的审核、加密。公开部署请自行加一层鉴权（反代 / token）。

## 部署

本机已跑通（见 `dream/shared/` 的示例记录）。要对外提供服务：

```bash
DREAM_HOME=/srv/dream node dream-mcp/server.mjs     # stdio，给本机 agent
```

跨机器共享两种做法：

1. **Git 仓库**：把 `dream/shared/inbox` 当数据目录，PR 即提交（最简单，天然有评审）
2. **HTTP 包装**：用任何小 server 把 `server.mjs` 的四个工具映射成 REST（未内置，按需加）

## 设计取舍

- **不做自动合并**：别人提交的梦不会自动进我的记忆库——和 Dream 一样，必须先人审
- **不做 embedding 检索**：池子小的时候文件 + 标签足够；过千条再考虑
- **不做多租户**：`author` 是自报的，不是认证身份；公开场景需要自己加鉴权

## 与本地 Dream 的关系

```
本地 Dream → 产出待审 diff → 人审 → 合并进 team memory
                              ↓ （可选）
                       dream_submit → 共享梦境池 → 别人可以取用/引用
```

共享池是**出口**，不是入口：别人的梦不会直接改我的记忆，只作为参考材料。
