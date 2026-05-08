# FiloAI / FiloMail 仓库职责地图

FiloMail 是 AI-first 邮件产品。这个组织下包含当前产品客户端、后端服务、Agent 运行时、内部工具、历史仓库和少量实验项目。

这份 README 是工程、产品、QA 和 AI Agent 的**主入口地图**。排查问题、创建 issue 或提交 PR 前，先按下面的职责边界选择仓库；不要从 legacy / utility 仓库开始，除非具体 owner 明确指向。

---

## 优先从这些仓库开始

| 需求 | 主仓库 | 说明 |
| --- | --- | --- |
| 跨客户端 issue、产品/QA 任务分发 | [`filo-ai-workspace`](https://github.com/FiloAI/filo-ai-workspace) | 跨端问题和分发入口。影响多个客户端或需要 owner 路由时先在这里追踪。 |
| 当前 iOS / Android / Desktop 客户端代码 | [`filoai-frontend`](https://github.com/FiloAI/filoai-frontend) | 当前活跃客户端 monorepo。优先级高于 legacy 单端仓库。 |
| Agent runtime、对话、工具、memory、trigger、quota | [`FiloClaw`](https://github.com/FiloAI/FiloClaw) | Agent 决策层和 LLM/tool 执行层。 |
| 邮件后端、账号/邮件 API、邮件处理、订阅支付、推送能力 | [`FiloMailCenter`](https://github.com/FiloAI/FiloMailCenter) | 邮件主站服务和基础能力层，供客户端和 FiloClaw 调用。 |

其他仓库请见下方「辅助仓库」和「legacy / utility 仓库」。

---

## 核心职责边界

### `FiloClaw` — Agent 平台和决策层

适合在这里处理：

- Agent 对话运行时、模型调用、工具执行、HITL 审批、memory、events、长上下文。
- Gmail / Outlook connection trigger 进入 Agent run 的链路。
- trigger queue、user queue、并发、抢占、后台自动化。
- Agent 生成的 assistant message 是否应该通知用户：`should_notify` / hidden / silent。
- Agent 消息完成后调用主站 push 能力。
- Agent 侧 token quota、paywall、Plus quota 集成。

不要把 `FiloClaw` 当作普通邮件存储、通用邮件 API、支付 source of truth 或设备 push 基础设施的 owner；这些属于 `FiloMailCenter`。

### `FiloMailCenter` — 邮件后端和平台能力层

适合在这里处理：

- 用户/账号鉴权桥接、mail server accounts、Gmail / Outlook 邮件 API、邮件同步、label、conversation、message、task、summary。
- Kafka / SSE 邮件处理流水线，以及普通新邮件通知基础设施。
- 客户端和 FiloClaw 使用的 PushService / device push 能力。
- `PushService`、`TaskService`、`SubscriptionService`、`AuthService` 等后端服务实现。
- membership / subscription / payment source of truth，包括被其他服务消费的 Plus 状态。
- Mail notification preferences、label/global 通知设置、device registration。

除非代码路径明确属于普通邮件通知基础设施，否则不要把 Agent LLM 通知决策放到这里。Filo Agent 消息是否通知由 `FiloClaw` 决定；`FiloMailCenter` 提供推送能力和邮件数据/服务。

### `filoai-frontend` — 当前客户端 monorepo

适合在这里处理：

- 当前 Android、iOS、macOS、Windows / Desktop 客户端代码。
- Agent UI、chat timeline、tool cards、push deeplink、local cache、客户端路由、release/version policy。
- 跨平台客户端行为和共享产品体验。

除非团队明确说明问题在 standalone legacy 仓库，否则优先查 `filoai-frontend`，不要优先查 `filo-android` / `filo-ios` / `filo-desktop`。

### `filo-ai-workspace` — issue 分发和仓库元信息

适合在这里处理：

- 跨客户端 bug 和 feature request。
- 需要分发到多个仓库或多个 owner 的产品/QA 问题。
- workspace metadata 和自动化入口。

它是协调层，不是大多数业务修复的代码仓库。

---

## 重要系统链路

### 普通新邮件 push

主 owner：`FiloMailCenter`

典型链路：

```text
Mail provider webhook
  → FiloMailCenter mail processing / ruler pipeline
  → mail-push-notification handling
  → FiloMailCenter PushService / device push capability
  → clients render NEW_MAIL notification
```

普通 inbox / mail notification、mail notification preferences、label/global 通知设置、device push capability 问题，优先按这条链路查。

### Agent 邮件 trigger 消息 push

主 owner：`FiloClaw`；delivery capability 由 `FiloMailCenter` 提供。

典型链路：

```text
Gmail/Outlook webhook endpoint in FiloClaw
  → email-push service
  → triggerQueue
  → Agent run / trigger propagation prompt
  → assistant message should_notify decision
  → FiloClaw run-manager
  → FiloMailCenter PushService / Web Push
  → clients open Agent message by deeplink
```

如果现象是 Agent 总结/回复某封邮件后通知用户，关键决策在 `FiloClaw`；`FiloMailCenter` 只负责 delivery。

### Mail tasks / todos

主 owner 拆分：

- `FiloClaw`：Agent intent 和工具调用。
- `FiloMailCenter`：task storage / TaskService 能力。
- `filoai-frontend`：展示、交互、deeplink。

Agent 创建 Todo、Todo 跳转、Task 列表展示、缺少 source-mail context 等问题，按这个拆分查。

### Plus / quota / paywall

主 owner 拆分：

- `FiloMailCenter`：subscription / payment / membership source of truth。
- `FiloClaw`：Agent quota window、token accounting、paywall、Agent 侧 enforcement。
- `filoai-frontend`：购买入口、paywall UI、客户端展示。

### Release / client versioning

主 owner：`filoai-frontend`

客户端 monorepo 使用 repo-level release tag，例如 `vX.Y.Z`；beta checkpoint 使用 `vX.Y.(Z+1)-beta.N`。除非 release policy 改变，不要在 monorepo 里按 Android / iOS / Desktop 分端创建 tag。

---

## 辅助仓库

这些仓库有明确用途，但不是大多数产品事故的第一入口：

- [`filo-admin`](https://github.com/FiloAI/filo-admin) — 内部后台和运营管理。
- [`filo-www`](https://github.com/FiloAI/filo-www) — 官网、营销页、下载页。
- [`language-resources`](https://github.com/FiloAI/language-resources) — 客户端文案和多语言资源。
- [`filo-doc`](https://github.com/FiloAI/filo-doc) — 开发文档和参考资料。
- [`filo-doc-reader`](https://github.com/FiloAI/filo-doc-reader) — 附件/文档解析微服务，供后端流程调用。
- [`filo-stt`](https://github.com/FiloAI/filo-stt) — speech-to-text 服务。
- [`filo-issue-bot`](https://github.com/FiloAI/filo-issue-bot) — issue 自动化 bot。
- [`filo-issue-attachment`](https://github.com/FiloAI/filo-issue-attachment) — 私有 issue 附件存储。
- [`filo-ai-workflow`](https://github.com/FiloAI/filo-ai-workflow) — AI coding workflow / automation 实验。
- [`Filo-Marketing`](https://github.com/FiloAI/Filo-Marketing) — marketing assets / workflow。
- [`filo-design`](https://github.com/FiloAI/filo-design) 和 [`Interactivepageprototype`](https://github.com/FiloAI/Interactivepageprototype) — 设计和原型材料。

---

## Legacy / utility 仓库：不要作为主入口

这些仓库可能仍有历史代码或小工具，但除非 maintainer 明确指向，不要作为新产品工作的主入口：

- [`filo-android`](https://github.com/FiloAI/filo-android) — legacy Android client。当前客户端工作通常去 `filoai-frontend`。
- [`filo-ios`](https://github.com/FiloAI/filo-ios) — legacy iOS client。当前客户端工作通常去 `filoai-frontend`。
- [`filo-desktop`](https://github.com/FiloAI/filo-desktop) — legacy Desktop client。当前客户端工作通常去 `filoai-frontend`。
- [`filo-chat-web-app`](https://github.com/FiloAI/filo-chat-web-app) — 旧 chat/web app，使用前先确认。
- [`electron-macos-widget`](https://github.com/FiloAI/electron-macos-widget) — Electron / macOS utility plugin。
- [`electron-native-auth`](https://github.com/FiloAI/electron-native-auth) — Electron native auth utility。
- [`filo-ios-spm-tapdb`](https://github.com/FiloAI/filo-ios-spm-tapdb) — iOS TapDB package utility。
- [`transform-dom-to-dark`](https://github.com/FiloAI/transform-dom-to-dark) — email HTML dark-mode utility。
- [`cli-slg`](https://github.com/FiloAI/cli-slg) — 无关/实验游戏项目，不是 FiloMail 产品入口。

---

## 开始修复前先判断

1. 先判断现象属于：普通 mail 行为、Agent 行为、client rendering，还是跨仓库协调。
2. 按上面的主 owner 选择仓库。
3. 跨端 issue 先在 `filo-ai-workspace` 追踪，再链接实现 PR。
4. 不要用 legacy repo 证明当前行为，除非活跃仓库明确依赖它。
5. push / notification 问题必须先拆：
   - 普通新邮件 push → `FiloMailCenter`
   - Agent email-trigger message push → `FiloClaw` 决策 + `FiloMailCenter` delivery capability

边界先判断清楚，可以避免修错仓库和产生噪音 PR。
