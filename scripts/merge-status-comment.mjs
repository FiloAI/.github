const MAX_REASON_LENGTH = 1200

function clean(value) {
  return String(value || '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/```/g, "'''")
    .trim()
}

export const MERGE_STATUS_MARKER = '<!-- filoai-merge-steward:status -->'

function splitReasons(reason) {
  return String(reason || '')
    .split(/\s*[；;]\s*/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function checkNamesFromReason(reason) {
  const match = String(reason || '').match(/required checks 未通过:\s*(.+?)(?:；|$)/i)
  if (!match) return []
  return match[1]
    .split(/\s*,\s*/)
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * 把脚本内部的门禁原因翻译成 PR 作者能执行的动作。
 * 该函数故意保持纯函数，避免文案改动影响 fail-closed 判定。
 */
export function humanizeMergeReason(reason, { state = 'blocked' } = {}) {
  const raw = String(reason || '').trim()
  const clauses = splitReasons(raw)
  const summaries = []
  const actions = []
  let owner = '合并管家'

  for (const clause of clauses) {
    if (/mergeable=CONFLICTING/i.test(clause)) {
      summaries.push('PR 分支和最新 main 有代码冲突，GitHub 不允许直接合并。')
      actions.push('请 PR 作者把最新 main 合并到该分支，解决冲突并 push；push 后合并管家会自动重新检查。')
      owner = 'PR 作者/负责人'
    } else if (/mergeable=UNKNOWN/i.test(clause)) {
      summaries.push('GitHub 还在计算这个 PR 是否可合并，当前结果不可靠。')
      actions.push('作者暂时不用改代码；合并管家会稍后自动重试。')
    } else if (/^draft$/i.test(clause) || /仍是? draft|isDraft=true/i.test(clause)) {
      summaries.push('这个 PR 仍处于 Draft（草稿）状态。')
      actions.push('准备合并时请 PR 作者点“Ready for review”；在此之前管家不会合并。')
      owner = 'PR 作者/负责人'
    } else if (/required checks 未通过/i.test(clause)) {
      const checks = checkNamesFromReason(clause)
      summaries.push(checks.length
        ? `必需 CI 检查未通过：${checks.join('、')}。`
        : '必需 CI 检查未通过。')
      actions.push('请先修复或重跑列出的 CI 检查；检查变绿后合并管家会自动复查。')
      owner = 'PR 作者/CI 维护者'
    } else if (/CI bridge 失败详情/i.test(clause)) {
      summaries.push(`CI 失败详情已同步：${clause.replace(/^CI bridge 失败详情：?/i, '')}`)
      actions.push('这不是误报；以 GitHub 当前 head 的具体 check 为准处理，旧 head 的失败不会沿用。')
      owner = 'PR 作者/CI 维护者'
    } else if (/未解决 review thread/i.test(clause)) {
      summaries.push(`还有 ${clause.replace(/个未解决 review thread.*/i, '').trim()} 条 review 讨论未解决。`)
      actions.push('请逐条修复并 resolve 这些讨论；全部 resolve 后管家会自动复查。')
      owner = 'PR 作者与对应 reviewer'
    } else if (/当前 head 尚无可审计/i.test(clause) || /等待审核/i.test(clause)) {
      summaries.push('当前提交（head）还没有可审计的审核结论。')
      actions.push('作者通常不用操作；合并管家会继续安排/执行当前 head 的审核，不会因为一次提示就停止。')
    } else if (/高风险改动待/i.test(clause)) {
      summaries.push(`这是高风险改动，${clause.replace(/^高风险改动待\s*/i, '')}。`)
      actions.push('请 Chris 或 Bobo 针对当前 head 确认；确认后管家会自动复查。')
      owner = 'Chris 或 Bobo'
    } else if (/成员明确阻止/i.test(clause)) {
      summaries.push(`有具备权限的成员明确阻止合并：${clause.replace(/^成员明确阻止检查失败（fail-closed）：?/i, '')}`)
      actions.push('请该成员针对当前 head 明确放行，或由 PR 作者处理其指出的问题；之后管家会自动复查。')
      owner = '明确阻止合并的成员'
    } else if (/no-automerge/i.test(clause)) {
      summaries.push('PR 带有 no-automerge 标签，表示不允许自动合并。')
      actions.push('如果希望管家继续，请 PR 负责人移除 no-automerge 标签；否则无需操作。')
      owner = 'PR 作者/负责人'
    } else if (/head 已变化/i.test(clause)) {
      summaries.push('检查期间 PR 又产生了新提交，之前的检查结果已失效。')
      actions.push('作者不用回滚；管家会以最新 head 重新检查。')
    } else if (/base=.*不在允许列表/i.test(clause)) {
      summaries.push('这个 PR 的目标分支不是合并管家允许的主线分支。')
      actions.push('请 PR 作者把目标分支改为 main（或按仓库约定的允许分支）。')
      owner = 'PR 作者/负责人'
    } else if (clause) {
      summaries.push(clause)
    }
  }

  if (state === 'ready') {
    return {
      title: '确定性门禁已通过，正在审核当前 head',
      summary: 'CI、分支、线程等确定性门禁目前没有阻塞；只是当前 head 还缺少可审计的审核答复。',
      owner: '合并管家（作者通常无需操作）',
      action: '管家会继续完成当前 head 的审核并自动复查；这不是“报一次后就停止”，也不是要求外部 AI 必须在线。',
    }
  }

  return {
    title: '本轮未自动合并',
    summary: (summaries.join('；').replaceAll('。；', '；')) || 'GitHub 未返回具体原因。',
    owner,
    action: (actions.join('；').replaceAll('。；', '；')) || '处理上面的阻塞后，合并管家会自动重新检查。',
  }
}

export function buildMergeStatusComment({ headOid, reason, state = 'blocked' }) {
  const cleanReason = clean(reason) || 'GitHub 未返回具体原因'
  const clipped = cleanReason.length > MAX_REASON_LENGTH
    ? `${cleanReason.slice(0, MAX_REASON_LENGTH - 1)}…`
    : cleanReason
  const merged = state === 'merged'
  const ready = state === 'ready'
  if (merged) {
    return `${MERGE_STATUS_MARKER}
ℹ️ **合并管家：已合并**

- **当前 head**：\`${String(headOid || '').slice(0, 7) || 'unknown'}\`
- **结论**：GitHub 已确认该 PR 为 MERGED；这条状态不再表示阻塞。

<details><summary>技术细节</summary>

${clipped}
</details>`
  }
  const human = humanizeMergeReason(cleanReason, { state })
  return `${MERGE_STATUS_MARKER}
ℹ️ **合并管家：${human.title}**

- **当前 head**：\`${String(headOid || '').slice(0, 7) || 'unknown'}\`
- **结论**：${human.summary}
- **谁需要处理**：${human.owner}
- **下一步**：${human.action}
- **自动复查**：会。head、CI 或审核状态变化后，管家会继续检查；不会绕过 CI、覆盖率、审核或 GitHub 规则。

<details><summary>技术细节（给维护者）</summary>

${clipped}
</details>`
}

export function buildMergeStatusCommentArgs({ repo, number, body, commentId = null }) {
  if (commentId) {
    return ['api', `repos/${repo}/issues/comments/${commentId}`, '--method', 'PATCH', '-f', `body=${body}`]
  }
  return ['api', `repos/${repo}/issues/${number}/comments`, '--method', 'POST', '-f', `body=${body}`]
}
