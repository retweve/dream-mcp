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

没有任何依赖，Node 18+ 直接跑。

## 它是什么

一个零依赖的 MCP 服务器（stdio JSON-RPC 2.0），只做四件事：

| 工具 | 作用 |
|---|---|
| `dream_submit` | 提交一条梦（作者、标题、摘要、若干记忆条目、标签、谱系） |
| `dream_list` | 按时间倒序列出，可按作者/标签过滤 |
| `dream_get` | 按 id 取完整记录 |
| `dream_stats` | 总数、作者数、条目类型分布 |

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
  "lineage": { "parent": "leviathan-gen-1", "generation": 2 }
}
```

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
