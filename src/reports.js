'use strict';
const { SEVERITY_LABEL, ISSUE_STATUS_LABEL, REINSPECTION_RESULT_LABEL } = require('./constants');

/**
 * 报告引擎 (框架第57条)
 * 数据 -> 统计 -> 模板 -> HTML(可打印为PDF/Word)
 * 报告生成时保存数据快照，历史报告不被后续修改影响 (框架第45条)。
 *
 * 输出思路：以"汇报给甲方/上级"为阅读场景，默认进入就是干净的封面 + 摘要 + 建议版式。
 * 仅当 URL 携带 ?toolbar=1 时才显示一个紧凑的"打印"工具条（现场打印场景）。
 */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function pct(x) {
  if (x == null || isNaN(x)) return '0.0%';
  return (x * 100).toFixed(1) + '%';
}
function n0(v) { return v == null ? 0 : v; }

function issueTableRows(issues, withZone) {
  return issues.map((i) => `
    <tr>
      <td>${esc(i.issueNo)}</td>
      <td>${esc(i.floorName || '')}</td>
      ${withZone ? `<td>${esc(i.zoneName || '')}</td>` : ''}
      <td>${esc(i.disciplineName || '')}</td>
      <td>${esc(i.title)}</td>
      <td style="color:${sevColor(i.severity)};font-weight:600">${esc(SEVERITY_LABEL[i.severity] || i.severity)}</td>
      <td>${esc(i.responsibleOrgName || '')}</td>
      <td>${esc((i.rectificationDeadline || '').slice(0, 10))}</td>
      <td>${esc(ISSUE_STATUS_LABEL[i.rectificationStatus || i.finalStatus] || '')}</td>
    </tr>`).join('');
}
function sevColor(s) {
  return { S1: '#b91c1c', S2: '#ea580c', S3: '#ca8a04', S4: '#2563eb', S5: '#16a34a' }[s] || '#334155';
}

/** 风险等级：用于执行摘要徽章与文字判断 */
function deriveRiskLevel(scorecard) {
  if (n0(scorecard.overdue) > 0) return { level: 'high', label: '高风险', color: '#b91c1c' };
  if (scorecard.majorIssueRate >= 0.2) return { level: 'high', label: '高风险', color: '#b91c1c' };
  if (scorecard.majorIssueRate >= 0.1 || scorecard.closureRate < 0.4) return { level: 'mid', label: '中等风险', color: '#ea580c' };
  if (n0(scorecard.severityDistribution.S1) + n0(scorecard.severityDistribution.S2) > 0) return { level: 'mid', label: '中等风险', color: '#ea580c' };
  return { level: 'low', label: '总体可控', color: '#16a34a' };
}

/** 文字结论模板（按组合分支，自动产出"汇报话术"） */
function deriveNarrative(ctx) {
  const { issues, scorecard } = ctx;
  const sev = scorecard.severityDistribution;
  const s1 = n0(sev.S1), s2 = n0(sev.S2);
  const open = scorecard.open, closed = scorecard.closed;
  const total = scorecard.total, overdue = scorecard.overdue;
  const closure = scorecard.closureRate;

  // 核心结论
  let headline;
  if (total === 0) {
    headline = '本期承接查验未发现需要整改的问题，项目查验整体通过，可进入下一阶段。';
  } else if (closure >= 0.8) {
    headline = `本期共发现 ${total} 项问题，已完成整改 ${closed} 项（闭环率 ${pct(closure)}），问题总量可控、整改节奏良好。`;
  } else if (closure >= 0.4) {
    headline = `本期共发现 ${total} 项问题，已完成整改 ${closed} 项（闭环率 ${pct(closure)}），整体推进中，但仍有 ${open} 项未关闭，需加快收口。`;
  } else if (overdue > 0) {
    headline = `本期共发现 ${total} 项问题，尚未关闭 ${open} 项，其中已超期 ${overdue} 项，整改节奏滞后，请重点关注。`;
  } else {
    headline = `本期共发现 ${total} 项问题，已整改 ${closed} 项，剩余 ${open} 项按计划推进，需加强责任单位跟进。`;
  }

  // 风险点（按优先级挑 1-3 条）
  const risks = [];
  if (s1 > 0) risks.push(`重大风险（S1）${s1} 项，是当前阻碍开业准出的核心卡点。`);
  else if (s2 > 0) risks.push(`高风险（S2）${s2} 项，应作为下一阶段整改的首要对象。`);
  if (overdue > 0) risks.push(`已超期未关闭问题 ${overdue} 项，已超过整改截止日期，节点压力较大。`);
  if (closure < 0.5 && total > 0) risks.push(`当前闭环率仅 ${pct(closure)}，距开业前清零目标尚有差距。`);
  if (risks.length === 0) risks.push('当前未见明显风险敞口，按既定节奏推进即可。');

  // 行动建议（基于数据自动推荐）
  const actions = [];
  const byDiscipline = {};
  issues.forEach((i) => { const d = i.disciplineName || '未分类'; byDiscipline[d] = (byDiscipline[d] || 0) + 1; });
  const topDiscipline = Object.entries(byDiscipline).sort((a, b) => b[1] - a[1])[0];
  if (s1 + s2 > 0) actions.push(`组织重大 / 高风险问题专题推进会，由项目经理挂帅督办闭环。`);
  if (overdue > 0) actions.push(`对超期未关闭问题下达"整改通知单 + 节点承诺"，明确回签日期与责任人。`);
  if (topDiscipline && topDiscipline[1] >= 3) actions.push(`对 ${topDiscipline[0]} 等问题集中的专业开展专项复盘，避免同类问题重复发生。`);
  if (closure < 0.6) actions.push(`将闭环率与一次通过率纳入周报 KPI，督促责任单位按周提交整改进度。`);
  if (actions.length === 0) actions.push('保持现有节奏，定期更新台账，确保开业前归零。');

  return { headline, risks, actions };
}

function coverBlock(project, type, generatedByName) {
  const subTitles = {
    summary: '承接查验总报告',
    closure: '整改闭环报告',
    detail: '问题明细报告',
  };
  return `
    <div class="rp-cover">
      <div class="rp-cover-mark">承接查验 · 阶段报告</div>
      <h1 class="rp-cover-title">${esc(project.name)}</h1>
      <div class="rp-cover-sub">${esc(subTitles[type] || '报告')}</div>
      <div class="rp-cover-meta">
        <div class="rp-meta-item"><span>项目编号</span><b>${esc(project.code || '-')}</b></div>
        <div class="rp-meta-item"><span>报告类型</span><b>${esc(subTitles[type] || '报告')}</b></div>
        <div class="rp-meta-item"><span>生成人</span><b>${esc(generatedByName || '系统')}</b></div>
        <div class="rp-meta-item"><span>生成时间</span><b>${esc(new Date().toLocaleString('zh-CN'))}</b></div>
      </div>
    </div>`;
}

function renderReport(type, ctx) {
  const { project, generatedByName } = ctx;
  const header = `
    <div class="rp-toolbar" id="rpToolbar">
      <button onclick="window.print()" class="rp-print-btn">🖨 打印 / 另存为 PDF</button>
      <span class="rp-toolbar-hint">提示：本页可直接打印输出 PDF；Word 版本请在系统报告列表页下载。</span>
    </div>
    <script>
      // 只有携带 ?toolbar=1 才显示工具条：默认进入是干净的汇报版
      (function () {
        try {
          if (location.search.indexOf('toolbar=1') >= 0) document.body.classList.add('rp-show-toolbar');
        } catch (e) {}
      })();
    </script>`;

  let body = '';
  if (type === 'summary') body = summaryBody(ctx);
  else if (type === 'closure') body = closureBody(ctx);
  else body = detailBody(ctx);

  const css = `
    :root { --c:#0f172a; --m:#64748b; --bd:#e2e8f0; --bg:#f8fafc; --acc:#2563eb; }
    * { box-sizing: border-box; }
    html, body { background: #f1f5f9; }
    body {
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
      color: var(--c); margin: 0;
      padding: 48px 24px 64px;
      line-height: 1.7;
      font-size: 14px;
    }
    .rp-doc {
      max-width: 920px; margin: 0 auto;
      background: #fff;
      padding: 56px 64px 72px;
      border-radius: 10px;
      box-shadow: 0 6px 20px rgba(15, 23, 42, 0.06);
    }
    .rp-toolbar {
      position: sticky; top: 0; z-index: 10;
      max-width: 920px; margin: 0 auto 12px;
      background: #fff; border: 1px solid var(--bd); border-radius: 8px;
      padding: 10px 14px; display: none; align-items: center; gap: 10px;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
    }
    body.rp-show-toolbar .rp-toolbar { display: flex; }
    .rp-print-btn {
      background: var(--acc); color: #fff; border: none;
      border-radius: 6px; padding: 7px 14px; font-size: 13px;
      cursor: pointer;
    }
    .rp-toolbar-hint { color: var(--m); font-size: 12px; }

    /* 封面 */
    .rp-cover { padding: 8px 0 32px; border-bottom: 3px solid var(--acc); margin-bottom: 36px; }
    .rp-cover-mark {
      display: inline-block; font-size: 12px; letter-spacing: 4px;
      color: var(--acc); background: #eff6ff;
      padding: 4px 10px; border-radius: 4px; margin-bottom: 18px;
    }
    .rp-cover-title { font-size: 34px; margin: 0 0 8px; font-weight: 700; line-height: 1.25; }
    .rp-cover-sub { font-size: 16px; color: var(--m); margin-bottom: 28px; }
    .rp-cover-meta {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;
      background: var(--bg); border: 1px solid var(--bd);
      border-radius: 8px; padding: 14px 18px;
    }
    .rp-meta-item span { display: block; font-size: 11px; color: var(--m); margin-bottom: 2px; }
    .rp-meta-item b { font-size: 13px; color: var(--c); font-weight: 600; }

    /* 章节 */
    h2 {
      font-size: 20px; margin: 44px 0 14px;
      padding-left: 12px; border-left: 4px solid var(--acc);
      font-weight: 700;
    }
    h3 { font-size: 15px; margin: 24px 0 10px; color: var(--c); font-weight: 600; }
    p { margin: 10px 0; line-height: 1.85; color: #334155; }
    ul.bullets { margin: 10px 0; padding-left: 22px; }
    ul.bullets li { margin: 6px 0; line-height: 1.8; color: #334155; }

    /* KPI */
    .kpi {
      display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px;
      margin: 16px 0 8px;
    }
    .kpi .box {
      border: 1px solid var(--bd); border-radius: 8px;
      padding: 14px 14px 12px; background: #fff;
      border-top: 3px solid var(--acc);
    }
    .kpi .box.red    { border-top-color: #b91c1c; }
    .kpi .box.orange { border-top-color: #ea580c; }
    .kpi .box.green  { border-top-color: #16a34a; }
    .kpi .n { font-size: 22px; font-weight: 700; line-height: 1.2; }
    .kpi .l { font-size: 12px; color: var(--m); margin-top: 4px; }

    /* 摘要块 */
    .summary-card {
      background: #f8fafc; border: 1px solid var(--bd);
      border-left: 4px solid var(--acc);
      border-radius: 8px; padding: 18px 22px; margin: 12px 0 8px;
    }
    .summary-card .row + .row { margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--bd); }
    .summary-card h3 { margin: 0 0 8px; font-size: 14px; }
    .summary-card.risk  { border-left-color: #b91c1c; background: #fef2f2; }
    .summary-card.act   { border-left-color: #16a34a; background: #f0fdf4; }
    .badge {
      display: inline-block; padding: 3px 10px; border-radius: 999px;
      font-size: 12px; font-weight: 600; color: #fff;
      vertical-align: middle; margin-right: 8px;
    }
    .badge.high { background: #b91c1c; }
    .badge.mid  { background: #ea580c; }
    .badge.low  { background: #16a34a; }

    /* 分布图 */
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin: 8px 0 4px; }
    .bar { display: flex; align-items: center; margin: 6px 0; font-size: 13px; }
    .bar .name { width: 96px; color: #334155; }
    .bar .track {
      flex: 1; background: #eff6ff; border-radius: 4px; height: 14px; overflow: hidden;
      border: 1px solid #e0e7ff;
    }
    .bar .fill { height: 100%; border-radius: 3px; }
    .bar .val  { width: 52px; text-align: right; color: var(--m); font-variant-numeric: tabular-nums; }
    .bar .name.bold { font-weight: 600; }

    /* 表格 */
    table {
      border-collapse: collapse; width: 100%;
      font-size: 13px; margin: 12px 0 4px;
      page-break-inside: auto;
    }
    th, td {
      border: 1px solid var(--bd); padding: 10px 12px; text-align: left;
      line-height: 1.55; vertical-align: top;
    }
    th { background: #f1f5f9; font-weight: 600; color: #334155; }
    tr:nth-child(even) td { background: #fafbfc; }

    /* 脚注 */
    .rp-foot {
      margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--bd);
      color: var(--m); font-size: 11px; line-height: 1.7;
    }

    /* 打印：纸面化 */
    @page { size: A4; margin: 16mm 14mm; }
    @media print {
      html, body { background: #fff; }
      body { padding: 0; }
      .rp-toolbar { display: none !important; }
      .rp-doc {
        box-shadow: none; border-radius: 0;
        padding: 0; max-width: none;
      }
      .rp-cover { page-break-after: avoid; }
      h2 { page-break-after: avoid; }
      table { page-break-inside: auto; }
      tr, th, td { page-break-inside: avoid; }
    }
  `;

  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${esc(project.name)} ${esc(reportTitle(type))}</title>
<style>${css}</style></head><body>
${header}
<div class="rp-doc">
${coverBlock(project, type, ctx.generatedByName)}
${body}
<div class="rp-foot">
  本报告由系统依据生成时的数据快照自动生成，可作为正式查验文档底稿。
  AI 输出为分析建议，不替代正式专业结论；如对数据口径有疑问，请联系项目管理员。
</div>
</div>
</body></html>`;
  return { title: `${project.name}_${reportTitle(type)}`, html };
}

function reportTitle(type) {
  return { summary: '承接查验总报告', closure: '整改闭环报告', detail: '问题明细报告' }[type] || '报告';
}

/* ============== 各场景内容 ============== */

function summaryBody(ctx) {
  const { issues, scorecard } = ctx;
  const sev = scorecard.severityDistribution;
  const byDiscipline = {};
  issues.forEach((i) => { const d = i.disciplineName || '未分类'; byDiscipline[d] = (byDiscipline[d] || 0) + 1; });
  const maxD = Math.max(1, ...Object.values(byDiscipline));
  const disciplineBars = Object.entries(byDiscipline).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
    `<div class="bar"><div class="name">${esc(k)}</div><div class="track"><div class="fill" style="width:${v / maxD * 100}%;background:${sevColor('S1')}"></div></div><div class="val">${v} 项</div></div>`).join('');

  const risk = deriveRiskLevel(scorecard);
  const { headline, risks, actions } = deriveNarrative(ctx);

  const focusList = issues
    .filter((i) => i.severity === 'S1' || i.severity === 'S2')
    .slice(0, 50);

  const orgs = ctx.responsibilityRanking || [];

  return `
  <h2>执行摘要</h2>
  <div class="summary-card">
    <div class="row">
      <h3><span class="badge ${risk.level}">${esc(risk.label)}</span>核心结论</h3>
      <p>${esc(headline)}</p>
    </div>
    <div class="row summary-card risk">
      <h3>风险点</h3>
      <ul class="bullets">${risks.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    </div>
    <div class="row summary-card act">
      <h3>行动建议</h3>
      <ul class="bullets">${actions.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    </div>
  </div>

  <h2>一、总体态势</h2>
  <div class="kpi">
    <div class="box"><div class="n">${scorecard.total}</div><div class="l">问题总数</div></div>
    <div class="box"><div class="n">${scorecard.open}</div><div class="l">未关闭</div></div>
    <div class="box green"><div class="n">${scorecard.closed}</div><div class="l">已关闭</div></div>
    <div class="box ${scorecard.overdue ? 'red' : ''}"><div class="n" style="${scorecard.overdue ? 'color:#b91c1c' : ''}">${scorecard.overdue}</div><div class="l">已超期</div></div>
    <div class="box"><div class="n">${pct(scorecard.closureRate)}</div><div class="l">闭环率</div></div>
    <div class="box ${scorecard.majorIssueRate >= 0.2 ? 'orange' : ''}"><div class="n">${pct(scorecard.majorIssueRate)}</div><div class="l">重大 / 高风险率</div></div>
  </div>
  <p>截至本报告生成时刻，项目共发现 ${scorecard.total} 项承接查验问题，已关闭 ${scorecard.closed} 项（占比 ${pct(scorecard.closureRate)}），剩余 ${scorecard.open} 项在整改中。其中重大（S1）${n0(sev.S1)} 项、高风险（S2）${n0(sev.S2)} 项，已超期未关闭 ${scorecard.overdue} 项。</p>

  <h2>二、问题分布</h2>
  <div class="two">
    <div>
      <h3>严重度分布</h3>
      ${['S1', 'S2', 'S3', 'S4', 'S5'].map((s) => `<div class="bar"><div class="name bold">${s} ${esc(SEVERITY_LABEL[s])}</div><div class="track"><div class="fill" style="width:${(sev[s] || 0) / Math.max(1, scorecard.total) * 100}%;background:${sevColor(s)}"></div></div><div class="val">${sev[s] || 0} 项</div></div>`).join('')}
    </div>
    <div>
      <h3>专业分布</h3>
      ${disciplineBars || '<p>暂无数据。</p>'}
    </div>
  </div>

  <h2>三、各专业问题占比</h2>
  <table><thead><tr><th>专业</th><th>问题数</th><th>占比</th><th>说明</th></tr></thead><tbody>
    ${Object.entries(byDiscipline).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
      const ratio = v / (scorecard.total || 1);
      const note = ratio >= 0.3 ? '问题集中，建议专项推进' : ratio >= 0.15 ? '需持续关注' : '保持现有节奏';
      return `<tr><td>${esc(k)}</td><td>${v}</td><td>${pct(ratio)}</td><td>${esc(note)}</td></tr>`;
    }).join('')}
  </tbody></table>

  <h2>四、重点关注（S1 / S2 问题清单）</h2>
  <p>下列问题影响开业准出 / 客户感知，建议作为下一周期整改的优先对象，由项目经理督办。</p>
  <table><thead><tr><th>编号</th><th>楼层</th><th>专业</th><th>问题</th><th>严重度</th><th>责任单位</th><th>截止</th><th>状态</th></tr></thead><tbody>
    ${focusList.length ? issueTableRows(focusList, false) : '<tr><td colspan="7" style="text-align:center;color:#64748b;padding:22px">本周期无 S1 / S2 问题。</td></tr>'}
  </tbody></table>

  ${orgs.length ? `
  <h2>五、责任单位分布</h2>
  <table><thead><tr><th>责任单位</th><th>问题总数</th><th>未关闭</th><th>已关闭</th><th>闭环率</th></tr></thead><tbody>
    ${orgs.map((x) => `<tr><td>${esc(x.orgName)}</td><td>${x.total}</td><td>${x.open}</td><td>${x.closed}</td><td>${pct(x.total ? x.closed / x.total : 0)}</td></tr>`).join('')}
  </tbody></table>` : ''}

  <h2>${orgs.length ? '六' : '五'}、风险与建议</h2>
  <p>结合当前问题规模、严重度结构、闭环节奏，给出下一步重点动作：</p>
  <ul class="bullets">
    ${actions.map((r) => `<li>${esc(r)}</li>`).join('')}
  </ul>
  <p style="color:#64748b;font-size:12px;margin-top:18px">本报告由系统根据当前数据快照自动生成。所有结论与建议均基于本周期数据，请结合项目实际情况决策。</p>
  `;
}

function closureBody(ctx) {
  const { issues, reinspections, rectifications, scorecard } = ctx;
  const closed = issues.filter((i) => (i.rectificationStatus || i.finalStatus) === 'CLOSED');
  const open = scorecard.open;
  const overdue = scorecard.overdue;
  const rej = reinspections.filter((r) => r.result === 'FAIL').length;
  const risk = deriveRiskLevel(scorecard);
  const { headline, risks, actions } = deriveNarrative(ctx);

  // 整改前后照片对比
  const photosHtml = rectifications.filter((r) => r.beforePhotos && r.afterPhotos).slice(0, 8).map((r) => `
    <div class="ph-pair">
      <div class="ph-title">${esc(r.issueTitle || '')}</div>
      <div class="photos">
        ${r.beforePhotos.slice(0, 1).map((p) => `<div><div class="ph-tag">整改前</div><img src="${esc(p)}"></div>`).join('')}
        ${r.afterPhotos.slice(0, 1).map((p) => `<div><div class="ph-tag">整改后</div><img src="${esc(p)}"></div>`).join('')}
      </div>
    </div>`).join('');

  return `
  <h2>执行摘要</h2>
  <div class="summary-card">
    <div class="row">
      <h3><span class="badge ${risk.level}">${esc(risk.label)}</span>核心结论</h3>
      <p>${esc(headline)}</p>
    </div>
    <div class="row summary-card risk">
      <h3>未闭环风险</h3>
      <ul class="bullets">${risks.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    </div>
    <div class="row summary-card act">
      <h3>推进建议</h3>
      <ul class="bullets">${actions.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    </div>
  </div>

  <h2>一、整改概况</h2>
  <div class="kpi">
    <div class="box"><div class="n">${issues.length}</div><div class="l">问题总量</div></div>
    <div class="box green"><div class="n">${closed.length}</div><div class="l">已关闭</div></div>
    <div class="box"><div class="n">${open}</div><div class="l">未关闭</div></div>
    <div class="box ${overdue ? 'red' : ''}"><div class="n" style="${overdue ? 'color:#b91c1c' : ''}">${overdue}</div><div class="l">超期</div></div>
    <div class="box"><div class="n">${pct(scorecard.firstPassRate)}</div><div class="l">一次通过率</div></div>
    <div class="box"><div class="n">${rej}</div><div class="l">二次整改</div></div>
  </div>
  <p>截止当前，问题总量 ${issues.length} 项，已完成整改 ${closed.length} 项（一次通过率 ${pct(scorecard.firstPassRate)}）。其中仍有 ${open} 项未关闭，超期 ${overdue} 项，建议对未关闭 + 超期问题下发专项督办通知。</p>

  <h2>二、未关闭问题清单（按严重度优先排序）</h2>
  <table><thead><tr><th>编号</th><th>楼层</th><th>专业</th><th>问题</th><th>严重度</th><th>责任单位</th><th>截止</th><th>状态</th></tr></thead><tbody>
    ${issueTableRows(issues.filter((i) => (i.rectificationStatus || i.finalStatus) !== 'CLOSED').sort((a, b) => (a.severity > b.severity ? -1 : 1)).slice(0, 50), false)}
  </tbody></table>

  <h2>三、责任单位分析</h2>
  <table><thead><tr><th>责任单位</th><th>问题数</th><th>未关闭</th><th>已关闭</th><th>闭环率</th></tr></thead><tbody>
    ${ctx.responsibilityRanking.map((x) => `<tr><td>${esc(x.orgName)}</td><td>${x.total}</td><td>${x.open}</td><td>${x.closed}</td><td>${pct(x.total ? x.closed / x.total : 0)}</td></tr>`).join('')}
  </tbody></table>

  <h2>四、整改前后照片对比</h2>
  ${photosHtml || '<p>暂无整改前后对比照片。</p>'}

  <style>
    .ph-pair { margin: 14px 0 20px; }
    .ph-title { font-weight: 600; margin-bottom: 6px; color: #334155; }
    .photos { display: flex; gap: 14px; flex-wrap: wrap; }
    .photos img { width: 220px; height: 160px; object-fit: cover; border: 1px solid var(--bd); border-radius: 6px; }
    .ph-tag { font-size: 11px; color: var(--m); margin-bottom: 4px; }
  </style>
  `;
}

function detailBody(ctx) {
  const { issues } = ctx;
  const sev = issues.reduce((m, i) => { m[i.severity] = (m[i.severity] || 0) + 1; return m; }, {});
  const risk = deriveRiskLevel(ctx.scorecard);

  return `
  <h2>执行摘要</h2>
  <div class="summary-card">
    <div class="row">
      <h3><span class="badge ${risk.level}">${esc(risk.label)}</span>问题规模概览</h3>
      <p>本周期共记录问题 ${issues.length} 项，其中重大 ${n0(sev.S1)} 项、高 ${n0(sev.S2)} 项。详细清单见下方表格。</p>
    </div>
  </div>

  <h2>问题明细（共 ${issues.length} 项）</h2>
  <table><thead><tr><th>编号</th><th>楼层</th><th>区域</th><th>专业</th><th>问题</th><th>严重度</th><th>责任单位</th><th>截止日期</th><th>状态</th></tr></thead><tbody>
    ${issueTableRows(issues, true)}
  </tbody></table>
  `;
}

module.exports = { renderReport };
