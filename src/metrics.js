'use strict';
const db = require('./db');

/**
 * 统一指标层 (框架第58条)
 * 所有页面统计都从这里取，避免散落计算。
 */

function daysBetween(a, b) {
  const MS = 86400000;
  return Math.floor((new Date(b).setHours(0,0,0,0) - new Date(a).setHours(0,0,0,0)) / MS);
}

// 问题是否超期：有截止日期且未关闭且截止<今天
function isOverdue(issue, now) {
  if (!issue.rectificationDeadline) return false;
  if (['CLOSED', 'CANCELLED', 'DUPLICATE'].includes(issue.rectificationStatus || issue.finalStatus)) return false;
  return daysBetween(issue.rectificationDeadline, now) < 0;
}
function daysToDeadline(issue, now) {
  if (!issue.rectificationDeadline) return null;
  return daysBetween(now, issue.rectificationDeadline);
}

function getIssueCount(issues) { return issues.length; }
function getOpenIssueCount(issues) {
  return issues.filter((i) => !['CLOSED', 'CANCELLED', 'DUPLICATE'].includes(i.rectificationStatus || i.finalStatus)).length;
}
function getClosedIssueCount(issues) {
  return issues.filter((i) => (i.rectificationStatus || i.finalStatus) === 'CLOSED').length;
}
function getOverdueIssueCount(issues, now) {
  return issues.filter((i) => isOverdue(i, now)).length;
}
function getClosureRate(issues) {
  if (!issues.length) return 0;
  return getClosedIssueCount(issues) / issues.length;
}
function getSeverityDistribution(issues) {
  const m = { S1:0, S2:0, S3:0, S4:0, S5:0 };
  issues.forEach((i) => { if (m[i.severity] !== undefined) m[i.severity]++; });
  return m;
}
function getDisciplineDistribution(issues) {
  const m = {};
  issues.forEach((i) => { const d = i.disciplineName || '未分类'; m[d] = (m[d] || 0) + 1; });
  return m;
}
function getFloorDistribution(issues) {
  const m = {};
  issues.forEach((i) => { const f = i.floorName || '未定位'; m[f] = (m[f] || 0) + 1; });
  return m;
}

// 一次整改通过率 = 一次复查通过 / 已复查
function getFirstPassRate(reinspections) {
  if (!reinspections.length) return 0;
  const firstByIssue = {};
  reinspections
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .forEach((r) => {
      if (firstByIssue[r.issueId] === undefined) firstByIssue[r.issueId] = r.result;
    });
  const vals = Object.values(firstByIssue);
  const passed = vals.filter((v) => v === 'PASS').length;
  return vals.length ? passed / vals.length : 0;
}

// 按时整改率 = 按时完成 / 总整改
function getOnTimeRate(rectifications, issuesById) {
  const rectified = rectifications.filter((r) => r.actualDate);
  if (!rectified.length) return 0;
  let onTime = 0;
  rectified.forEach((r) => {
    const issue = issuesById[r.issueId];
    if (issue && issue.rectificationDeadline) {
      if (new Date(r.actualDate) <= new Date(issue.rectificationDeadline)) onTime++;
    } else {
      onTime++;
    }
  });
  return onTime / rectified.length;
}

// 责任单位排名 (框架第14条 责任单位榜)
function getResponsibilityRanking(issues, orgsById) {
  const m = {};
  issues.forEach((i) => {
    const oid = i.responsibleOrgId;
    if (!oid) return;
    if (!m[oid]) m[oid] = { orgId: oid, open: 0, closed: 0, overdue: 0, total: 0 };
    m[oid].total++;
    if ((i.rectificationStatus || i.finalStatus) === 'CLOSED') m[oid].closed++;
    else m[oid].open++;
  });
  return Object.values(m).map((x) => ({
    ...x,
    orgName: orgsById[x.orgId] ? orgsById[x.orgId].name : '未知单位',
  })).sort((a, b) => b.total - a.total);
}

// 每日趋势 (发现 vs 关闭)
function getDailyTrend(issues, reinspections, days) {
  const now = new Date();
  const out = [];
  for (let d = days - 1; d >= 0; d--) {
    const day = new Date(now);
    day.setDate(now.getDate() - d);
    const key = day.toISOString().slice(0, 10);
    const found = issues.filter((i) => (i.foundAt || i.createdAt || '').slice(0, 10) === key).length;
    const closed = reinspections.filter((r) => r.result === 'PASS' && (r.at || '').slice(0, 10) === key).length;
    out.push({ date: key, found, closed });
  }
  return out;
}

// 综合评分指标 (框架第15条)
function getScorecard(issues, reinspections, rectifications, now) {
  const total = issues.length;
  const closed = getClosedIssueCount(issues);
  const sev = getSeverityDistribution(issues);
  const major = (sev.S1 || 0) + (sev.S2 || 0);
  return {
    total,
    closed,
    open: getOpenIssueCount(issues),
    overdue: getOverdueIssueCount(issues, now),
    closureRate: getClosureRate(issues),
    majorIssueRate: total ? major / total : 0,
    firstPassRate: getFirstPassRate(reinspections),
    onTimeRate: getOnTimeRate(rectifications, Object.fromEntries(issues.map((i) => [i.id, i]))),
    severityDistribution: sev,
  };
}

// ============ 商户进场资料统计（V1.5 模块） ============

/**
 * 商户资料进度：核验通过的必传资料数 / 必传资料总数。
 * requiredDocs: merchantDocs 中对应 docType.required===true 的条目
 * 返回 { verified, total, rate, done }（done=全部必传已核验）
 */
function merchantProgress(merchantDocs, docTypeById) {
  const required = merchantDocs.filter((d) => {
    const t = docTypeById[d.docTypeId];
    return t && t.required;
  });
  const verified = required.filter((d) => d.status === 'VERIFIED').length;
  const total = required.length;
  return { verified, total, rate: total ? verified / total : 0, done: total > 0 && verified === total };
}

/**
 * 商户资料库总览统计：
 * - total 商户数、complete 已完整商户数、completeRate 完整率
 * - pendingVerify 待核验资料数、missingCount 待提交(必传)数
 * - expiredSoon 临期/过期证件清单（有有效期且已核验通过，但距离到期 ≤ remindDays）
 * - overdueDocs 已过期/临期未补齐的必传证件数
 * - byCategory 各业态 { count, avgRate }
 */
function getMerchantSummary(merchants, merchantDocs, docTypes, now) {
  const docTypeById = Object.fromEntries(docTypes.map((t) => [t.id, t]));
  const docsByMerchant = {};
  merchantDocs.forEach((d) => {
    (docsByMerchant[d.merchantId] = docsByMerchant[d.merchantId] || []).push(d);
  });

  let complete = 0;
  let pendingVerify = 0;
  let missingRequired = 0;
  const expiredSoon = [];   // 临期/过期证件提醒
  const overdueRequired = []; // 必传但驳回/未提交且超期？——简化为"必传且已驳回"与"必传且临期"计数
  const catAgg = {};

  merchants.forEach((m) => {
    const docs = docsByMerchant[m.id] || [];
    const prog = merchantProgress(docs, docTypeById);
    if (prog.done) complete++;
    const cat = m.category || '其他';
    if (!catAgg[cat]) catAgg[cat] = { count: 0, rateSum: 0 };
    catAgg[cat].count++;
    catAgg[cat].rateSum += prog.rate;

    docs.forEach((d) => {
      const t = docTypeById[d.docTypeId];
      if (!t) return;
      if (d.status === 'SUBMITTED') pendingVerify++;
      if (t.required && d.status === 'MISSING') missingRequired++;
      if (t.required && d.status === 'REJECTED') overdueRequired.push({ merchant: m, doc: d, docType: t });
      // 临期提醒：已通过、有有效期、有到期日
      if (t.hasExpiry && d.status === 'VERIFIED' && d.expireDate) {
        const left = daysBetween(now, d.expireDate);
        const remind = t.remindDays || 30;
        if (left <= remind) {
          expiredSoon.push({
            merchantId: m.id, merchantName: m.name, shopNo: m.shopNo,
            docName: t.name, expireDate: d.expireDate, daysLeft: left,
          });
        }
      }
    });
  });

  const byCategory = Object.entries(catAgg).map(([name, v]) => ({
    name, count: v.count, avgRate: v.count ? Math.round((v.rateSum / v.count) * 100) : 0,
  })).sort((a, b) => b.count - a.count);

  expiredSoon.sort((a, b) => a.daysLeft - b.daysLeft);

  return {
    total: merchants.length,
    complete,
    completeRate: merchants.length ? complete / merchants.length : 0,
    pendingVerify,
    missingRequired,
    overdueRequiredCount: overdueRequired.length,
    expiredSoon,
    expiredSoonCount: expiredSoon.length,
    byCategory,
  };
}

module.exports = {
  daysBetween, daysToDeadline, isOverdue,
  getIssueCount, getOpenIssueCount, getClosedIssueCount, getOverdueIssueCount,
  getClosureRate, getSeverityDistribution, getDisciplineDistribution, getFloorDistribution,
  getFirstPassRate, getOnTimeRate, getResponsibilityRanking, getDailyTrend, getScorecard,
  merchantProgress, getMerchantSummary,
};
