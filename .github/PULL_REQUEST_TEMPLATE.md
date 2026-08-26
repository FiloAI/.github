<!-- PR 标题格式：<type>(<scope>): 描述；type ∈ feat/fix/refactor/perf/chore/docs/test/revert/build/ci -->
<!-- 本模板是 org 默认；filoai-frontend / FiloMailCenter 有更细的仓库级模板，以那边为准。 -->

## 这次改了什么

### 摘要

### 范围

- 关联 Issue：`Closes #N` / `Part of #N` / 无
- 明确不包含：

## 怎么验证的

### 自动验证

<!-- 贴实际命令与结果，不要只写「已测试」 -->

```text
```

### 手工验证 / 未执行的验证

<!-- 未执行的说明原因；没有则写「无」 -->

## 风险

### 影响与回滚

### 产品取舍（仅在 P0/P1 finding 选择延期或不修时填写）

产品取舍不能靠自然语言让合并管家放行。请在评论中使用结构化 marker，并让原 reviewer 或 FiloAI owner 明确授权：

```html
<!-- filoai:finding id=<stable-id> severity=P1 kind=<kind> -->
<!-- filoai:product-disposition finding=<stable-id> action=defer -->
<!-- filoai:product-disposition finding=<stable-id> action=accept-deferral -->
<!-- filoai:product-disposition finding=<stable-id> action=approve head=<40位当前head SHA> -->
<!-- filoai:product-disposition finding=<stable-id> action=withdraw head=<40位当前head SHA> -->
```

finding marker 只能放在正式 review 或 inline review comment 中；marker 的发布者由 GitHub 账号确定，不能写在正文里冒充；owner 作者的显式 `defer` 视为其自身产品决定。自由文本只能供人阅读，不能构成授权证据。格式错误、finding 不存在、权限不符或 head 过期都会保持阻塞。
