# 共享记忆如何"进化"——三层模型与硬边界

> 一句话：**共享记忆可以用来变强，但不能用来训练模型权重。**
> 前者是工程，后者是伦理+法律+技术三重不可行。

## 三层进化模型

```
L1 个体记忆层（私有）
   一个人的 dream → 自己的 team memory
   进化对象：这个 agent 在这个人身上的表现

L2 共享知识层（池子）
   opt-in 提交 → dream/shared/inbox
   进化对象：跨个体的共性知识（"大多数人在 X 上都会踩坑"）

L3 系统能力层（可分发）
   从共享池聚合出的 distillate → 技能 / 提示词 / 评测集
   进化对象：agent harness 本身（skills、prompts、evals、routing）
```

**关键区分**：L2→L3 改变的是**模型外部的系统**（提示词、技能库、评测、路由），
不是模型内部参数。前者可回滚、可审计、可解释；后者不可。

## 为什么不能拿别人的记忆训练 DeepSeek

| 维度 | 问题 |
|---|---|
| **授权** | 提交者只同意了"共享记录"，没同意"用于训练模型"；这两件事的同意范围不同 |
| **隐私** | 记忆天然含个人信息（偏好、病史、财务、关系、位置）；聚合不等于匿名 |
| **法务** | 模型权重归 DeepSeek，微调需其条款允许；跨用户数据训练还涉及 GDPR/个保法 |
| **技术** | 我们没有权重、没有训练管线、没有合适算力；靠几条记忆 fine-tune 只会灾难性遗忘 |
| **可逆性** | 权重一旦训练无法"撤销某人的记忆"；记忆库删一行就可以 |

**所以本项目的硬边界：**

1. 共享池**只用于**：生成 distillate（聚合规律）、构建评测集、改进提示词与技能
2. **绝不**把共享池内容写入模型权重、上传给任何训练服务、或打包进可分发权重
3. 每条记录的 `consent.derivatives` 默认为 **false**；只有显式 true 才能进入聚合
4. 聚合结果必须 **k-匿名**：同一规律至少来自 `k ≥ 3` 个不同作者才允许输出
5. 聚合产物只输出**规律**，不输出原文、不输出作者名

## 同意模型（consent）

提交时携带：

```json
{
  "consent": {
    "share": true,          // 必须 true，否则服务器拒收
    "derivatives": false,   // 是否允许用于聚合派生（默认 false）
    "anonymize": true       // 是否在聚合时脱敏（默认 true）
  }
}
```

- 缺省 `{share:true, derivatives:false}`：可以进池子被查看，但**不参与**任何聚合
- `derivatives:true` 是显式、可撤回的（删掉 inbox 文件即撤回，下次聚合不再计入）

## 自动脱敏（服务器侧，强制）

提交时对 `title / summary / entries[].text / source` 统一做：

- 邮箱 → `[email]`
- 手机号（11 位）→ `[phone]`
- 身份证（18 位）→ `[id]`
- 常见密钥前缀（`sk-` / `ghp_` / `gho_` / `xoxb-` / `AKIA`）→ `[secret]`
- 私网 IP → `[ip]`
- 长 hex（≥32）→ `[hex]`

**脱敏在写入前完成**，原文不落盘。这是底线，不依赖提交者自觉。

## 聚合能产出什么（L3 的原料）

`aggregate.mjs` 的输出 `distillate-<date>.json`：

```json
{
  "generatedAt": "…",
  "k": 3,
  "patterns": [
    {
      "theme": "windows-automation",
      "statement": "定时任务在无管理员环境下要用 HKCU Run + vbs 隐藏启动",
      "authors": 3,              // 只报数量，不报名
      "dreams": 7,
      "confidence": "high",
      "evidenceTypes": ["warning", "rule"]
    }
  ],
  "discarded": { "belowK": 12, "noConsent": 4 }
}
```

**pattern 是重写过的抽象陈述，不是原文**——原文不出池。

## 下游怎么用（都必须人审）

| 产物 | 用途 | 审核 |
|---|---|---|
| `distillate.json` | 给 Dream 的蒸馏器当「跨个体先验」 | 人审 diff |
| `eval/` 题目 | 共享池里高频问题 → 新评测题 | 人审视题 |
| `skills/` 补丁 | 高频坑 → 技能里的固定做法 | 人审 |
| `routing.json` | 高频任务类型 → 模型路由调整 | 人审 |

**没有一条路径通向模型权重。**

## 撤回

- 删除 `shared/inbox/<id>.json` + 重跑 `reindex.mjs` → 该记录从索引消失
- 已生成的 distillate 是快照，**不会**自动回溯；发布过的 distillate 需重新生成
- 这就是为什么 L3 产物必须可审查：它们可能已经流出，必须能被撤回和替换
