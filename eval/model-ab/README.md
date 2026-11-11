# H1 模型级验证 · 方法说明（数据不入库）

本目录的 `build.mjs` / `grade.mjs` 是可复现的方法脚本；
**数据集、先验、答案、结果均含本机记忆内容，按仓库规则不入库**（见 `.gitignore`）。

## 流程

```bash
node eval/model-ab/build.mjs     # 1) 从 team memory 构建 cloze 题 + 合成共享池 + prior.md（本地）
# 2) 按批用 workflow 跑配对 A/B（每批 5 题 × 2 臂），答案写入 eval/model-ab/answers/batch-N.json
node eval/model-ab/grade.mjs     # 3) 确定性评分 + 配对 bootstrap CI + Cohen's h
```

## 设计与口径

- **题目**：cloze——从记忆条目里移除一个最长英文标识符，要求只回答该短语；
  评分完全确定性（规范化后包含即正确）。
- **数据集冻结**：`dataset.json` 内 `datasetSha256` 记录题目哈希；test 20 题不得用于调参。
  当前已冻结：`0e5567522fae217c…`（67 条可用 → 20 test / 40 dev）。
- **先验**：由合成共享池（3 位作者 × test 事实）经 `aggregate.mjs --k 3` 得到，**只有关键词**。
  本批覆盖率 5/20（25%）——这是 B 臂可能占优的**机械上限**。
- **两臂**：A 无先验；B 提供 `prior.md` 作为「回忆线索（非事实）」。
- **判据（预注册）**：配对差 95% CI 下界 > 0 且点估计 ≥ 9pp 才算支持 H1；否则写「证据不足」。

## 已知偏差（必须随结果一起报告）

1. 题目来自**已提炼的 team memory 条目**，不是原始 transcript 全文（G0 协议要求原文挖题）。
2. 先验来自 **test 事实**的合成提交 → 上界机制测试，不代表真实他人数据分布。
3. cloze 是机械任务，不能替代「agent 答得更准」的语义评估。
4. 评分规范化在首轮后修正过一次（去掉尾部斜杠/路径分隔符造成的误判），已记入 `state.json` 的 `amended`。

## 隐私边界

- `dataset.json` / `prior.md` / `answers/` / `results.json` / `summary.md` 只留在本机。
- 公开仓库只收方法脚本；**结果摘要**（只有聚合数字、无题目原文）可脱敏后写进 whale 仓库的 `evo/sources/`。
