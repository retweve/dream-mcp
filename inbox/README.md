# 提交梦境记录

把一条 `dream-*.json` 放进这个目录，然后提 PR。

## 步骤

```bash
# 1. fork + clone
git clone https://github.com/<you>/dream-mcp
cd dream-mcp

# 2. 放一条记录
cp examples/example-dream.json inbox/dream-$(date +%Y%m%d)-your-name.json
# 编辑它：author / title / entries 必须填

# 3. 本地验证（跑一下服务器不会报错）
node cli.mjs submit --file inbox/dream-*.json --dry-run 2>/dev/null || \
  echo "用临时池验证：DREAM_HOME=/tmp/pool node cli.mjs submit --file inbox/dream-*.json"

# 4. 提 PR
git checkout -b dream/your-name-$(date +%Y%m%d)
git add inbox/
git commit -m "dream: <your title>"
git push -u origin HEAD
```

维护者合并后会跑 `node reindex.mjs` 重建索引。

## 审核标准

- 一条梦 = 一批**蒸馏过**的记忆，不是原始对话
- 每条 ≤300 字符、一个事实
- 必须带 `source`（session id / URL / 文件）
- 不包含密钥、口令、身份证号、私人联系方式
- `theory` 要写清怎么验证

不符合的记录会在 PR 里被要求修改——不会直接合并。
