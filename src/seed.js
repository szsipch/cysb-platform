'use strict';
const db = require('./db');
const C = require('./constants');

function seed() {
  const d = new Date();
  const iso = (daysAgo) => { const x = new Date(d); x.setDate(x.getDate() - daysAgo); return x.toISOString(); };

  // 角色与用户
  const orgA = { id: db.genId('org'), name: '中建总包单位', type: C.ORG_TYPE.GENERAL, contact: '13800000001' };
  const orgB = { id: db.genId('org'), name: '安信消防专业分包', type: C.ORG_TYPE.SPECIALIST, contact: '13800000002' };
  const orgC = { id: db.genId('org'), name: '美装精装修分包', type: C.ORG_TYPE.SPECIALIST, contact: '13800000003' };
  const orgD = { id: db.genId('org'), name: '机电设备安装公司', type: C.ORG_TYPE.SPECIALIST, contact: '13800000004' };
  const orgP = { id: db.genId('org'), name: '项目物业中心', type: C.ORG_TYPE.PROPERTY, contact: '13800000005' };
  [orgA, orgB, orgC, orgD, orgP].forEach((o) => db.insert('organizations', o));

  const admin = { id: db.genId('usr'), username: 'admin', password: 'admin123', name: '系统管理员', role: C.ROLE.SUPER_ADMIN, orgId: null, createdAt: iso(30) };
  const pm = { id: db.genId('usr'), username: 'pm', password: 'pm123', name: '王经理', role: C.ROLE.PROJECT_MANAGER, orgId: null, createdAt: iso(30) };
  const inspector = { id: db.genId('usr'), username: 'inspector', password: 'ins123', name: '李工', role: C.ROLE.INSPECTOR, orgId: null, createdAt: iso(30) };
  const contractor = { id: db.genId('usr'), username: 'contractor', password: 'con123', name: '赵队长', role: C.ROLE.CONTRACTOR, orgId: orgA.id, createdAt: iso(30) };
  [admin, pm, inspector, contractor].forEach((u) => db.insert('users', u));

  // 专业（可配置）
  C.DEFAULT_DISCIPLINES.forEach((name) => db.insert('disciplines', { id: db.genId('dis'), name, active: true }));

  // 项目
  const proj = { id: db.genId('prj'), name: 'XX商场2026年装修升级项目', code: 'MALL2026', address: '市中心人民路88号', manager: '王经理', status: '进行中', createdAt: iso(30), createdBy: admin.id };
  db.insert('projects', proj);

  // 默认统计表（仪表盘同款，可编辑/复制/新建多个）
  const defaultBoard = {
    id: db.genId('sb'), projectId: proj.id, name: '总体概览（默认）', isDefault: true, onDashboard: true,
    filters: {},
    tiles: ['total', 'open', 'closed', 'overdue', 'closureRate', 'majorIssueRate', 'firstPassRate', 'onTimeRate'],
    charts: ['trend', 'severity', 'discipline', 'floor', 'responsibility'],
    createdAt: iso(30), updatedAt: iso(30),
  };
  db.insert('statBoards', defaultBoard);

  // 楼层
  const floors = ['B2', 'B1', '1F', '2F', '3F'].map((name) => { const f = { id: db.genId('flr'), projectId: proj.id, name }; db.insert('floors', f); return f; });
  const f3 = floors.find((f) => f.name === '3F');
  const f1 = floors.find((f) => f.name === '1F');

  // 示例楼层平面图（SVG data URI，开箱即用；用户可在“系统设置→楼层”上传真实图替换）
  const PLAN_SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 500'><rect width='800' height='500' fill='#f8fafc' stroke='#94a3b8' stroke-width='4'/><text x='24' y='34' font-size='20' fill='#334155' font-family='sans-serif'>楼层平面示意图</text><rect x='350' y='50' width='100' height='410' fill='#e2e8f0'/><text x='362' y='260' font-size='15' fill='#64748b' font-family='sans-serif' transform='rotate(-90 362 260)'>公共走道</text><rect x='40' y='70' width='280' height='170' fill='#fff' stroke='#cbd5e1' stroke-width='2'/><text x='56' y='100' font-size='15' fill='#475569' font-family='sans-serif'>A区</text><rect x='40' y='280' width='280' height='170' fill='#fff' stroke='#cbd5e1' stroke-width='2'/><text x='56' y='310' font-size='15' fill='#475569' font-family='sans-serif'>B区</text><rect x='480' y='70' width='280' height='170' fill='#fff' stroke='#cbd5e1' stroke-width='2'/><text x='496' y='100' font-size='15' fill='#475569' font-family='sans-serif'>C区</text><rect x='480' y='280' width='280' height='170' fill='#fff' stroke='#cbd5e1' stroke-width='2'/><text x='496' y='310' font-size='15' fill='#475569' font-family='sans-serif'>D区</text></svg>`;
  const PLAN = 'data:image/svg+xml,' + encodeURIComponent(PLAN_SVG);
  db.update('floors', f3.id, { planImage: PLAN });
  db.update('floors', f1.id, { planImage: PLAN });
  // 区域
  const zones = ['东区', '中庭', '西区', '后勤区'].map((name) => { const z = { id: db.genId('zon'), floorId: f3.id, name }; db.insert('zones', z); return z; });
  const zEast = zones.find((z) => z.name === '东区');
  const zAtrium = zones.find((z) => z.name === '中庭');
  // 位置（区域位置）
  const mkPos = (zoneId, name, type, tags) => { const p = { id: db.genId('pos'), projectId: proj.id, zoneId, floorId: f3.id, name, type: type || '', tags: tags || [] }; db.insert('positions', p); return p; };
  const pSuShow = mkPos(zEast.id, '苏show', '非房源', ['地面']);
  const pSuCheng = mkPos(zEast.id, '苏城家宴', '非房源', ['地面']);
  const pHuaJie = mkPos(zEast.id, '花界', '非房源', ['地面']);

  // 批次
  const b1 = { id: db.genId('bat'), projectId: proj.id, name: '开业前综合查验第一轮', type: '开业前综合查验', status: '进行中', startDate: iso(10), endDate: '' };
  const b2 = { id: db.genId('bat'), projectId: proj.id, name: '消防专项查验', type: '消防专项查验', status: '进行中', startDate: iso(5), endDate: '' };
  db.insert('inspectionBatches', b1); db.insert('inspectionBatches', b2);

  const disc = (n) => db.list('disciplines').find((x) => x.name === n);
  const disDeco = disc('精装修'); const disFire = disc('消防'); const disMep = disc('给排水'); const disHvac = disc('暖通'); const disElec = disc('强电');

  const mkIssue = (o) => {
    const issue = {
      id: db.genId('iss'), issueNo: db.genIssueNo(proj.code),
      projectId: proj.id, batchId: o.batchId || b1.id,
      title: o.title, description: o.description || '',
      disciplineId: o.disciplineId, disciplineName: o.disciplineName,
      categoryName: o.categoryName || '',
      locationX: o.locationX != null ? o.locationX : null,
      locationY: o.locationY != null ? o.locationY : null,
      locationDesc: o.locationDesc || '',
      floorId: o.floorId || null, floorName: o.floorName || '',
      zoneId: o.zoneId || null, zoneName: o.zoneName || '',
      tenantId: null, severity: o.severity, priority: o.priority || 'P3',
      sourceType: C.SOURCE_TYPE.MANUAL, sourceUserId: inspector.id,
      foundAt: o.foundAt, photoIds: [], videoIds: [], attachmentIds: [],
      suggestedAction: o.suggestedAction || '', standardReference: o.standardReference || '',
      responsibleOrgId: o.responsibleOrgId, responsibleOrgName: o.responsibleOrgName,
      responsibleUserId: null, responsibleUserName: '',
      rectificationStatus: o.status, rectificationDeadline: o.deadline,
      rectificationDescription: o.rectDesc || '',
      rectificationPhotoIds: [], reinspectionStatus: null, reinspectionResult: null,
      reinspectionUserId: null, reinspectionAt: null, finalStatus: o.status,
      parentIssueId: null, duplicateOfIssueId: null,
      createdAt: o.foundAt, updatedAt: o.foundAt, closedAt: o.closedAt || null,
    };
    db.insert('issues', issue);
    return issue;
  };

  // 1) 已闭环问题（含整改+复查）
  const i1 = mkIssue({ title: '3F东区卫生间入口地砖破损及收口不顺', description: '地砖有3块破损，旁边收口不顺，影响观感。', disciplineId: disDeco.id, disciplineName: disDeco.name, floorId: f3.id, floorName: f3.name, zoneId: zEast.id, zoneName: zEast.name, positionId: pSuShow.id, positionName: pSuShow.name, severity: 'S4', priority: 'P3', batchId: b1.id, status: C.ISSUE_STATUS.OPEN, foundAt: iso(9), deadline: iso(-2), responsibleOrgId: orgC.id, responsibleOrgName: orgC.name, suggestedAction: '更换破损地砖并修整收口', locationX: 28, locationY: 35, locationDesc: '东区入口地面' });
  db.insert('rectifications', { id: db.genId('rec'), issueId: i1.id, orgId: orgC.id, userId: contractor.id, planDate: iso(-2), actualDate: iso(-1), description: '已更换破损地砖3块，重新收口打磨。', beforePhotos: [], afterPhotos: [], attachments: [], selfCheck: '自检合格', at: iso(-1) });
  db.insert('reinspections', { id: db.genId('rei'), issueId: i1.id, userId: inspector.id, at: iso(0), result: 'PASS', note: '整改到位，观感良好。', photos: [] });
  db.update('issues', i1.id, { rectificationStatus: C.ISSUE_STATUS.CLOSED, finalStatus: C.ISSUE_STATUS.CLOSED, reinspectionResult: 'PASS', reinspectionUserId: inspector.id, reinspectionAt: iso(0), closedAt: iso(0), rectificationDescription: '已更换破损地砖3块，重新收口打磨。' });

  // 2) 整改中
  const i2 = mkIssue({ title: '3F中庭南侧天花渗水痕迹', description: '疑似空调冷凝水，天花有两处水渍。', disciplineId: disHvac.id, disciplineName: disHvac.name, floorId: f3.id, floorName: f3.name, zoneId: zAtrium.id, zoneName: zAtrium.name, severity: 'S2', priority: 'P1', batchId: b1.id, status: C.ISSUE_STATUS.RECTIFYING, foundAt: iso(7), deadline: iso(1), responsibleOrgId: orgD.id, responsibleOrgName: orgD.name, suggestedAction: '排查冷凝水管路并做保温处理', locationX: 52, locationY: 55, locationDesc: '中庭南侧天花' });
  db.insert('rectifications', { id: db.genId('rec'), issueId: i2.id, orgId: orgD.id, userId: contractor.id, planDate: iso(1), actualDate: '', description: '正在排查冷凝水管，保温施工进行中。', beforePhotos: [], afterPhotos: [], attachments: [], selfCheck: '', at: iso(2) });

  // 3) 已指派待整改（超期）
  const i3 = mkIssue({ title: '1F中庭喷淋头安装方向异常', description: '喷头朝下方向偏差，可能影响布水。', disciplineId: disFire.id, disciplineName: disFire.name, floorId: f1.id, floorName: f1.name, zoneId: zAtrium.id, zoneName: zAtrium.name, severity: 'S2', priority: 'P1', batchId: b2.id, status: C.ISSUE_STATUS.ASSIGNED, foundAt: iso(6), deadline: iso(-1), responsibleOrgId: orgB.id, responsibleOrgName: orgB.name, suggestedAction: '调整喷头角度至规范方向', locationX: 50, locationY: 50, locationDesc: '中庭喷淋点位' });

  // 4) 待复查（已提交）
  const i4 = mkIssue({ title: 'B2机电设备房电缆桥架未封堵', description: '防火封堵缺失。', disciplineId: disElec.id, disciplineName: disElec.name, floorId: floors[0].id, floorName: floors[0].name, severity: 'S1', priority: 'P1', batchId: b1.id, status: C.ISSUE_STATUS.SUBMITTED, foundAt: iso(8), deadline: iso(2), responsibleOrgId: orgD.id, responsibleOrgName: orgD.name, suggestedAction: '采用防火泥封堵桥架孔洞' });
  db.insert('rectifications', { id: db.genId('rec'), issueId: i4.id, orgId: orgD.id, userId: contractor.id, planDate: iso(2), actualDate: iso(0), description: '已采用防火泥封堵全部桥架孔洞。', beforePhotos: [], afterPhotos: [], attachments: [], selfCheck: '自检合格', at: iso(0) });

  // 5-12 各类问题
  mkIssue({ title: '2F公共区墙面涂料色差', disciplineId: disDeco.id, disciplineName: disDeco.name, floorId: floors[3].id, floorName: floors[3].name, severity: 'S4', batchId: b1.id, status: C.ISSUE_STATUS.OPEN, foundAt: iso(5), deadline: iso(3), responsibleOrgId: orgC.id, responsibleOrgName: orgC.name });
  mkIssue({ title: '1F卫生间给排水管道渗漏', disciplineId: disMep.id, disciplineName: disMep.name, floorId: f1.id, floorName: f1.name, severity: 'S2', priority: 'P2', batchId: b1.id, status: C.ISSUE_STATUS.OPEN, foundAt: iso(4), deadline: iso(2), responsibleOrgId: orgA.id, responsibleOrgName: orgA.name, locationX: 20, locationY: 72, locationDesc: '1F卫生间' });
  mkIssue({ title: '3F西区防火门闭门器失效', disciplineId: disFire.id, disciplineName: disFire.name, floorId: f3.id, floorName: f3.name, zoneId: zones[2].id, zoneName: zones[2].name, severity: 'S3', batchId: b2.id, status: C.ISSUE_STATUS.ASSIGNED, foundAt: iso(4), deadline: iso(2), responsibleOrgId: orgB.id, responsibleOrgName: orgB.name, locationX: 80, locationY: 40, locationDesc: '3F西区防火门' });
  mkIssue({ title: 'B1车库标识导视缺失', disciplineId: disc('标识导视').id, disciplineName: '标识导视', floorId: floors[1].id, floorName: floors[1].name, severity: 'S5', batchId: b1.id, status: C.ISSUE_STATUS.OPEN, foundAt: iso(3), deadline: iso(5), responsibleOrgId: orgA.id, responsibleOrgName: orgA.name });
  mkIssue({ title: '3F东区吊顶龙骨间距超标', disciplineId: disDeco.id, disciplineName: disDeco.name, floorId: f3.id, floorName: f3.name, zoneId: zEast.id, zoneName: zEast.name, severity: 'S3', batchId: b1.id, status: C.ISSUE_STATUS.RECTIFYING, foundAt: iso(3), deadline: iso(1), responsibleOrgId: orgC.id, responsibleOrgName: orgC.name, locationX: 30, locationY: 62, locationDesc: '3F东区吊顶' });
  mkIssue({ title: '2F强电井接地测试不合格', disciplineId: disElec.id, disciplineName: disElec.name, floorId: floors[3].id, floorName: floors[3].name, severity: 'S1', priority: 'P1', batchId: b1.id, status: C.ISSUE_STATUS.OPEN, foundAt: iso(2), deadline: iso(1), responsibleOrgId: orgD.id, responsibleOrgName: orgD.name });
  mkIssue({ title: '中庭采光顶打胶不饱满', disciplineId: disc('幕墙').id, disciplineName: '幕墙', floorId: f1.id, floorName: f1.name, zoneId: zAtrium.id, zoneName: zAtrium.name, severity: 'S4', batchId: b1.id, status: C.ISSUE_STATUS.SUBMITTED, foundAt: iso(2), deadline: iso(0), responsibleOrgId: orgC.id, responsibleOrgName: orgC.name, locationX: 55, locationY: 28, locationDesc: '中庭采光顶' });
  mkIssue({ title: 'B2泵房减震垫缺失', disciplineId: disHvac.id, disciplineName: disHvac.name, floorId: floors[0].id, floorName: floors[0].name, severity: 'S3', batchId: b1.id, status: C.ISSUE_STATUS.OPEN, foundAt: iso(1), deadline: iso(4), responsibleOrgId: orgD.id, responsibleOrgName: orgD.name });

  // 审计示例
  db.insert('auditLogs', { id: db.genId('aud'), actorId: admin.id, actorName: '系统管理员', action: 'SEED', entity: 'System', entityId: 'seed', before: null, after: '初始化演示数据', device: 'seed', at: iso(0) });

  seedMerchants();

  db.save();
  console.log('✓ 演示数据已写入:', db.DB_FILE);
  console.log('  项目:', proj.name);
  console.log('  问题数:', db.list('issues').length);
  console.log('  商户数:', db.list('merchants').length);
  console.log('  账号: admin/admin123, pm/pm123, inspector/ins123, contractor/con123');
}

// 商户进场资料库演示数据（幂等：仅当 merchants 为空时生成）
function seedMerchants() {
  if (db.list('merchants').length > 0) return;
  const d = new Date();
  const iso = (daysAgo) => { const x = new Date(d); x.setDate(x.getDate() - daysAgo); return x.toISOString(); };
  const isoDate = (daysFromNow) => { const x = new Date(d); x.setDate(x.getDate() + daysFromNow); return x.toISOString().slice(0, 10); };

  // 资料类型库为空时预置默认库
  if (db.list('docTypes').length === 0) {
    C.DEFAULT_DOC_TYPES.forEach((t) => {
      db.insert('docTypes', {
        id: db.genId('dt'), name: t.name, hint: t.hint || '',
        categories: t.categories || ['*'], required: !!t.required,
        needVerify: t.needVerify !== false, hasExpiry: !!t.hasExpiry,
        remindDays: Number(t.remindDays) || 0, sort: Number(t.sort) || 0,
        active: true, createdAt: iso(0),
      });
    });
  }
  const proj = db.list('projects')[0];
  const floors = db.list('floors');
  const f3 = floors.find((f) => f.name === '3F') || floors[0];
  const f2 = floors.find((f) => f.name === '2F') || floors[0] || f3;
  const adminName = (db.list('users').find((u) => u.username === 'admin') || {}).name || '系统管理员';
  const upFiles = ['up_mswvwh7v1.png', 'up_mswzbsw62.png', 'up_msygpr9t3.png', 'up_msyhgewl3.png', 'up_msyho4ue4.png', 'up_msyhoje05.png', 'up_msyhonbk6.png', 'up_msyhosa87.png', 'up_msyhowk48.png'];
  let fi = 0;
  const nextFile = () => '/api/uploads/' + upFiles[fi++ % upFiles.length];

  const mkMerchant = (o) => {
    const now = iso(0);
    const m = {
      id: db.genId('mer'), projectId: proj ? proj.id : null,
      name: o.name, brand: o.brand || '', category: o.category,
      floorId: o.floorId || null, shopNo: o.shopNo || '',
      contactName: o.contactName || '', contactPhone: o.contactPhone || '',
      legalPerson: o.legalPerson || '', businessScope: o.businessScope || '',
      entryDate: o.entryDate || '', openDate: o.openDate || '',
      notes: o.notes || '', status: o.status, createdAt: now, updatedAt: now,
    };
    db.insert('merchants', m);
    return m;
  };
  const typeId = (name) => { const t = db.list('docTypes').find((x) => x.name === name); return t ? t.id : null; };
  const mkDoc = (m, typeName, status, opt) => {
    const tid = typeId(typeName);
    if (!tid) return;
    opt = opt || {};
    db.insert('merchantDocs', {
      id: db.genId('md'), merchantId: m.id, docTypeId: tid, status,
      fileUrl: opt.fileUrl || '', fileName: opt.fileName || '',
      expireDate: opt.expireDate || null, rejectedReason: opt.reason || '',
      submittedBy: opt.submittedBy || adminName, submittedAt: opt.submittedAt || iso(0),
      verifiedBy: opt.verifiedBy || adminName, verifiedAt: opt.verifiedAt || null,
      createdAt: iso(0), updatedAt: iso(0),
    });
  };

  // 商户1：苏show（零售，收集中）
  const m1 = mkMerchant({ name: '苏show', brand: '苏show 设计师品牌集合店', category: '零售', floorId: f3 ? f3.id : null, shopNo: '3F-01', contactName: '周店长', contactPhone: '13800001001', legalPerson: '周敏', businessScope: '服饰、配饰零售', entryDate: isoDate(-20), openDate: isoDate(35), notes: '', status: C.MERCHANT_STATUS.COLLECTING });
  mkDoc(m1, '营业执照（三证合一）', 'VERIFIED', { fileUrl: nextFile(), fileName: '营业执照.jpg', verifiedAt: iso(6) });
  mkDoc(m1, '法人/负责人身份证', 'VERIFIED', { fileUrl: nextFile(), fileName: '法人身份证.jpg', verifiedAt: iso(6) });
  mkDoc(m1, '品牌授权书/商标注册证', 'SUBMITTED', { fileUrl: nextFile(), fileName: '品牌授权书.pdf', submittedAt: iso(1) });
  mkDoc(m1, '租赁合同及进场确认单', 'VERIFIED', { fileUrl: nextFile(), fileName: '租赁合同.pdf', verifiedAt: iso(5) });
  mkDoc(m1, '公众责任险保单', 'MISSING');
  mkDoc(m1, '消防安全检查合格证明', 'MISSING');
  mkDoc(m1, '装修施工图及报批材料', 'VERIFIED', { fileUrl: nextFile(), fileName: '装修图纸.dwg.jpg', verifiedAt: iso(4) });
  mkDoc(m1, '装修押金/费用缴纳凭证', 'VERIFIED', { fileUrl: nextFile(), fileName: '押金收据.jpg', verifiedAt: iso(4) });

  // 商户2：苏城家宴（餐饮，审核中，含 1 个驳回 + 1 个临期证件）
  const m2 = mkMerchant({ name: '苏城家宴', brand: '苏城家宴·苏帮菜', category: '餐饮', floorId: f3 ? f3.id : null, shopNo: '3F-12', contactName: '陈经理', contactPhone: '13800001002', legalPerson: '陈国栋', businessScope: '中餐、苏帮菜、宴会', entryDate: isoDate(-45), openDate: isoDate(20), notes: '开业宴会厅需提前验收隔油池', status: C.MERCHANT_STATUS.REVIEWING });
  mkDoc(m2, '营业执照（三证合一）', 'VERIFIED', { fileUrl: nextFile(), fileName: '营业执照.jpg', verifiedAt: iso(30) });
  mkDoc(m2, '法人/负责人身份证', 'VERIFIED', { fileUrl: nextFile(), fileName: '法人身份证.jpg', verifiedAt: iso(30) });
  mkDoc(m2, '品牌授权书/商标注册证', 'VERIFIED', { fileUrl: nextFile(), fileName: '商标注册证.jpg', verifiedAt: iso(28) });
  mkDoc(m2, '租赁合同及进场确认单', 'VERIFIED', { fileUrl: nextFile(), fileName: '租赁合同.pdf', verifiedAt: iso(29) });
  mkDoc(m2, '公众责任险保单', 'SUBMITTED', { fileUrl: nextFile(), fileName: '公众责任险保单.pdf', submittedAt: iso(2) });
  mkDoc(m2, '消防安全检查合格证明', 'VERIFIED', { fileUrl: nextFile(), fileName: '消防合格证.jpg', expireDate: isoDate(300), verifiedAt: iso(20) });
  mkDoc(m2, '装修施工图及报批材料', 'VERIFIED', { fileUrl: nextFile(), fileName: '装修报批.zip.jpg', verifiedAt: iso(25) });
  mkDoc(m2, '装修押金/费用缴纳凭证', 'VERIFIED', { fileUrl: nextFile(), fileName: '押金收据.jpg', verifiedAt: iso(24) });
  mkDoc(m2, '食品经营许可证', 'VERIFIED', { fileUrl: nextFile(), fileName: '食品经营许可证.jpg', expireDate: isoDate(300), verifiedAt: iso(15) });
  mkDoc(m2, '员工健康证', 'VERIFIED', { fileUrl: nextFile(), fileName: '健康证.jpg', expireDate: isoDate(22), verifiedAt: iso(15) }); // 22 天后到期 → 临期提醒
  mkDoc(m2, '油烟净化设备检测报告', 'REJECTED', { fileUrl: nextFile(), fileName: '油烟检测报告.pdf', submittedAt: iso(3), reason: '报告为 2024 年出具，已超过 2 年有效期，请重新检测后提交' });
  mkDoc(m2, '排污/排水许可备案', 'SUBMITTED', { fileUrl: nextFile(), fileName: '排水备案.pdf', submittedAt: iso(2) });
  mkDoc(m2, '燃气报装/供气合同', 'VERIFIED', { fileUrl: nextFile(), fileName: '供气合同.pdf', verifiedAt: iso(18) });
  mkDoc(m2, '用电报装确认单', 'VERIFIED', { fileUrl: nextFile(), fileName: '用电确认单.jpg', verifiedAt: iso(18) });

  // 商户3：花界（生活服务，已完成）
  const m3 = mkMerchant({ name: '花界', brand: '花界美肌', category: '生活服务', floorId: f3 ? f3.id : null, shopNo: '3F-08', contactName: '刘店长', contactPhone: '13800001003', legalPerson: '刘芳', businessScope: '美容、美发', entryDate: isoDate(-90), openDate: isoDate(-20), notes: '', status: C.MERCHANT_STATUS.COMPLETED });
  ['营业执照（三证合一）', '法人/负责人身份证', '品牌授权书/商标注册证', '租赁合同及进场确认单', '公众责任险保单', '消防安全检查合格证明', '装修施工图及报批材料', '装修押金/费用缴纳凭证', '特种行业许可证'].forEach((n, i) => mkDoc(m3, n, 'VERIFIED', { fileUrl: nextFile(), fileName: n + '.jpg', verifiedAt: iso(60 - i * 3), expireDate: n === '特种行业许可证' ? isoDate(340) : null }));
  mkDoc(m3, '应急预案及演练记录', 'VERIFIED', { fileUrl: nextFile(), fileName: '应急预案.pdf', verifiedAt: iso(10) });

  // 商户4：星橙教育（教育培训，建档中，未生成清单）
  mkMerchant({ name: '星橙教育', brand: '星橙少儿艺术', category: '教育培训', floorId: f2 ? f2.id : null, shopNo: '2F-05', contactName: '王老师', contactPhone: '13800001004', legalPerson: '王建', businessScope: '少儿美术、口才培训', entryDate: '', openDate: isoDate(60), notes: '等待办学资质审批中', status: C.MERCHANT_STATUS.DRAFT });

  db.save();
  console.log('✓ 已生成商户资料演示数据（商户数: ' + db.list('merchants').length + '，资料项: ' + db.list('merchantDocs').length + '）');
}

if (require.main === module) {
  if (db.list('users').length === 0) seed();
  else if (db.list('merchants').length === 0) { seedMerchants(); db.save(); }
  else console.log('已存在数据，跳过 seed。如需重置请删除 data/db.json。');
}
module.exports = { seed, seedMerchants };
