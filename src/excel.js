'use strict';
const { SEVERITY_LABEL, PRIORITY_LABEL } = require('./constants');

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function toCSV(rows) {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// SpreadsheetML 2003 —— 单文件 XML，Excel 可直接打开（零依赖导出真 .xls）
function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function toSpreadsheetML(sheets) {
  // sheets: [{name, rows: [[...]]}]
  const ws = sheets.map((sh) => {
    const cells = sh.rows.map((r, ri) => {
      const cs = r.map((c, ci) => {
        const isNum = typeof c === 'number';
        const t = isNum ? 'Number' : 'String';
        const val = isNum ? c : xmlEscape(c);
        return `<Cell><Data ss:Type="${t}">${val}</Data></Cell>`;
      }).join('');
      return `<Row>${cs}</Row>`;
    }).join('');
    return `<Worksheet ss:Name="${xmlEscape(sh.name)}"><Table>${cells}</Table></Worksheet>`;
  }).join('');
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${ws}
</Workbook>`;
}

// HTML 表格伪 .xls —— Excel 打开无"格式不匹配"警告，单 sheet 直接显示为标准表格。
// sheets: [{name, rows: [[...]]}]
function toHtmlSpreadsheet(sheets) {
  const esc = xmlEscape;
  const sheetBlocks = sheets.map((sh) => {
    const headerRow = sh.rows[0] || [];
    const dataRows = sh.rows.slice(1);
    const thead = '<tr>' + headerRow.map((h) => `<th style="background:#f0f4fa;font-weight:700;border:1px solid #cbd5e1;padding:6px 10px">${esc(h)}</th>`).join('') + '</tr>';
    const tbody = dataRows.map((r) => '<tr>' + r.map((c) => {
      const s = c === null || c === undefined ? '' : String(c);
      const align = /^\d+(\.\d+)?$/.test(s) ? 'right' : 'left';
      return `<td style="border:1px solid #e2e8f0;padding:6px 10px;text-align:${align}">${esc(s).replace(/\n/g, '<br>')}</td>`;
    }).join('') + '</tr>').join('');
    return `<h3 style="font-family:sans-serif;margin:18px 0 8px">${esc(sh.name || 'Sheet1')}</h3>
<table style="border-collapse:collapse;font-family:sans-serif;font-size:12px">
<thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
  }).join('');
  return `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<meta name="ProgId" content="Excel.Sheet">
<meta name="Generator" content="Microsoft Excel 15">
<style>td,th{mso-number-format:"\\@"}</style>
<title>Export</title>
</head><body style="font-family:sans-serif">
${sheetBlocks}
</body></html>`;
}

// 问题导入模板表头
const ISSUE_TEMPLATE_HEADERS = [
  '问题编号', '标题', '描述', '专业', '问题大类', '楼层', '区域', '严重度',
  '优先级', '发现时间', '责任单位', '责任人', '计划完成日期', '整改说明', '建议措施', '标准依据',
];

const SEV_MAP = { S1:'S1', S2:'S2', S3:'S3', S4:'S4', S5:'S5',
  '重大':'S1', '高':'S2', '中':'S3', '低':'S4', '观察项':'S5' };
const PRI_MAP = { P1:'P1', P2:'P2', P3:'P3', '紧急':'P1', '重要':'P2', '常规':'P3' };

/**
 * 解析 CSV 文本为问题对象 (框架第60条：字段映射/格式检查/枚举检查/存在性检查/错误行报告)
 * ctx: { disciplines:[{name}], floors:[{name}], zones:[{name}], orgs:[{name}] }
 */
function importIssuesFromCSV(text, ctx) {
  const rows = parseCSV(text);
  if (!rows.length) return { ok: 0, errors: ['文件为空'] };
  const header = rows[0].map((h) => h.trim());
  const idx = {};
  ISSUE_TEMPLATE_HEADERS.forEach((h) => { idx[h] = header.indexOf(h); });
  if (idx['标题'] === -1) return { ok: 0, errors: ['缺少表头“标题”，请使用导入模板'] };

  const out = [];
  const errors = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.every((c) => !c || !c.trim())) continue; // 空行跳过
    const lineNo = i + 1;
    const get = (h) => (idx[h] >= 0 ? (r[idx[h]] || '').trim() : '');
    const title = get('标题');
    if (!title) { errors.push(`第${lineNo}行：标题不能为空`); continue; }

    const disciplineName = get('专业');
    const disc = ctx.disciplines.find((d) => d.name === disciplineName);
    if (disciplineName && !disc) { errors.push(`第${lineNo}行：专业“${disciplineName}”不存在`); continue; }

    const floorName = get('楼层');
    const floor = ctx.floors.find((f) => f.name === floorName);
    if (floorName && !floor) { errors.push(`第${lineNo}行：楼层“${floorName}”不存在`); continue; }

    const zoneName = get('区域');
    const zone = ctx.zones.find((z) => z.name === zoneName);
    if (zoneName && !zone) { errors.push(`第${lineNo}行：区域“${zoneName}”不存在`); continue; }

    let severity = get('严重度');
    severity = SEV_MAP[severity] || '';
    if (!severity) { errors.push(`第${lineNo}行：严重度非法（应为 S1-S5 或 重大/高/中/低/观察项）`); continue; }

    let priority = get('优先级');
    priority = PRI_MAP[priority] || 'P3';

    const orgName = get('责任单位');
    const org = ctx.orgs.find((o) => o.name === orgName);
    if (orgName && !org) { errors.push(`第${lineNo}行：责任单位“${orgName}”不存在`); continue; }

    const deadline = get('计划完成日期');
    if (deadline && !/^\d{4}-\d{2}-\d{2}/.test(deadline)) {
      errors.push(`第${lineNo}行：计划完成日期格式应为 YYYY-MM-DD`); continue;
    }

    out.push({
      issueNo: get('问题编号') || null,
      title,
      description: get('描述'),
      disciplineName: disc ? disc.name : null,
      disciplineId: disc ? disc.id : null,
      categoryName: get('问题大类'),
      floorName: floor ? floor.name : null,
      floorId: floor ? floor.id : null,
      zoneName: zone ? zone.name : null,
      zoneId: zone ? zone.id : null,
      severity,
      priority,
      foundAt: get('发现时间') || new Date().toISOString(),
      responsibleOrgId: org ? org.id : null,
      responsibleOrgName: org ? org.name : null,
      responsibleUserName: get('责任人'),
      rectificationDeadline: deadline || null,
      suggestedAction: get('建议措施'),
      standardReference: get('标准依据'),
      rectificationDescription: get('整改说明'),
    });
  }
  return { ok: out.length, inserted: out, errors };
}

module.exports = {
  toCSV, parseCSV, toSpreadsheetML, toHtmlSpreadsheet, importIssuesFromCSV, ISSUE_TEMPLATE_HEADERS,
};
