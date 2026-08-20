'use strict';
/**
 * 统一枚举层 (框架第59条)
 * 所有前后端共用，禁止在业务代码里硬编码专业/状态/等级。
 */

// 问题状态机 (框架第12/54条)
const ISSUE_STATUS = {
  OPEN: 'OPEN',
  ASSIGNED: 'ASSIGNED',
  RECTIFYING: 'RECTIFYING',
  SUBMITTED: 'SUBMITTED',
  REINSPECTION: 'REINSPECTION',
  CLOSED: 'CLOSED',
  PENDING: 'PENDING',
  ON_HOLD: 'ON_HOLD',
  CANCELLED: 'CANCELLED',
  DUPLICATE: 'DUPLICATE',
  REJECTED: 'REJECTED',
};

// 状态中文标签
const ISSUE_STATUS_LABEL = {
  OPEN: '待处理',
  ASSIGNED: '已指派',
  RECTIFYING: '整改中',
  SUBMITTED: '已提交',
  REINSPECTION: '复查中',
  CLOSED: '已关闭',
  PENDING: '待确认',
  ON_HOLD: '挂起',
  CANCELLED: '已取消',
  DUPLICATE: '重复',
  REJECTED: '已驳回',
};

// 状态机允许的转换 (action -> {from, to})
const TRANSITIONS = {
  ASSIGN: { from: ['OPEN', 'PENDING', 'ASSIGNED', 'REJECTED'], to: 'ASSIGNED' },
  START_RECTIFICATION: { from: ['ASSIGNED'], to: 'RECTIFYING' },
  SUBMIT: { from: ['RECTIFYING'], to: 'SUBMITTED' },
  REINSPECT: { from: ['SUBMITTED'], to: 'REINSPECTION' },
  PASS: { from: ['REINSPECTION'], to: 'CLOSED' },
  FAIL: { from: ['REINSPECTION'], to: 'RECTIFYING' },
  HOLD: { from: ['OPEN', 'ASSIGNED', 'RECTIFYING', 'SUBMITTED', 'REINSPECTION'], to: 'ON_HOLD' },
  CANCEL: { from: ['OPEN', 'ASSIGNED', 'PENDING', 'ON_HOLD'], to: 'CANCELLED' },
  MARK_DUPLICATE: { from: ['OPEN', 'ASSIGNED', 'PENDING'], to: 'DUPLICATE' },
  REOPEN: { from: ['CLOSED', 'CANCELLED', 'DUPLICATE', 'ON_HOLD', 'REJECTED'], to: 'OPEN' },
  REJECT: { from: ['OPEN', 'PENDING', 'ASSIGNED'], to: 'REJECTED' },
};

// 风险等级 (框架第8条)，可由规则自动计算
const SEVERITY = {
  S1: 'S1',
  S2: 'S2',
  S3: 'S3',
  S4: 'S4',
  S5: 'S5',
};
const SEVERITY_LABEL = {
  S1: '重大',
  S2: '高',
  S3: '中',
  S4: '低',
  S5: '观察项',
};
const SEVERITY_COLOR = {
  S1: '#dc2626',
  S2: '#ea580c',
  S3: '#ca8a04',
  S4: '#2563eb',
  S5: '#16a34a',
};
const SEVERITY_ORDER = ['S1', 'S2', 'S3', 'S4', 'S5'];

// 优先级
const PRIORITY = { P1: 'P1', P2: 'P2', P3: 'P3' };
const PRIORITY_LABEL = { P1: '紧急', P2: '重要', P3: '常规' };

// 复查结果
const REINSPECTION_RESULT = { PASS: 'PASS', FAIL: 'FAIL' };
const REINSPECTION_RESULT_LABEL = { PASS: '通过', FAIL: '驳回' };

// 责任单位类型 (框架第13条)
const ORG_TYPE = {
  GENERAL: '总包',
  SUB: '分包',
  SPECIALIST: '专业分包',
  DESIGN: '设计单位',
  VENDOR: '设备厂家',
  MERCHANT: '商户',
  PROPERTY: '物业',
  OPERATION: '运营',
  OWNER: '甲方',
};

// 角色 (框架第28条)
const ROLE = {
  SUPER_ADMIN: '超级管理员',
  PROJECT_MANAGER: '项目经理',
  INSPECTION_LEAD: '查验负责人',
  DISCIPLINE_LEAD: '专业负责人',
  INSPECTOR: '查验人员',
  RECTIFY_LEAD: '整改负责人',
  CONTRACTOR: '施工单位',
  SUPERVISOR: '监理',
  PROPERTY: '物业',
  OPERATION: '运营',
  READONLY: '只读/领导',
};

// 默认专业 (框架第3.1条，可配置)
const DEFAULT_DISCIPLINES = [
  '建筑/装饰', '土建', '精装修', '给排水', '暖通', '强电', '弱电', '消防',
  '电梯', '智能化', '防水', '门窗', '幕墙', '标识导视', '照明', '景观',
  '无障碍', '运营安全', '环境卫生', '综合观感', '其他',
];

// 默认节点/批次类型 (框架第3.2条，可配置)
const DEFAULT_BATCH_TYPES = [
  '开业前综合查验', '隐蔽工程查验', '完工初验', '专项验收', '消防专项查验',
  '机电系统查验', '公共区域查验', '设备房查验', '租户交付查验',
  '开业前一周复查', '开业前一天最终检查',
];

// 整改状态
const RECT_STATUS = {
  NOT_STARTED: '未开始',
  IN_PROGRESS: '整改中',
  DONE: '已完成',
};

// 录入方式
const SOURCE_TYPE = {
  MANUAL: '手工',
  CHECKLIST: '检查表',
  FREE: '自由巡检',
  AI: 'AI辅助',
  VOICE: '语音',
};

// 超期颜色阈值
const OVERDUE_COLOR = {
  SOON: '#eab308',   // 即将到期
  TODAY: '#f97316',  // 当天到期
  OVER: '#dc2626',   // 已超期
};

// ============ 商户进场资料库（V1.5 模块） ============

// 商户状态机：建档 → 收集中 → 审核中 → 已完成（可回退重新收集）
const MERCHANT_STATUS = {
  DRAFT: 'DRAFT',             // 建档
  COLLECTING: 'COLLECTING',   // 资料收集中
  REVIEWING: 'REVIEWING',     // 审核中
  COMPLETED: 'COMPLETED',     // 已完成
};
const MERCHANT_STATUS_LABEL = {
  DRAFT: '建档中', COLLECTING: '收集中', REVIEWING: '审核中', COMPLETED: '已完成',
};
const MERCHANT_TRANSITIONS = {
  START: { from: ['DRAFT'], to: 'COLLECTING' },                              // 开始收集
  SUBMIT_REVIEW: { from: ['COLLECTING'], to: 'REVIEWING' },                  // 提交审核
  COMPLETE: { from: ['REVIEWING'], to: 'COMPLETED' },                        // 全部通过，完成归档
  REOPEN: { from: ['REVIEWING', 'COMPLETED'], to: 'COLLECTING' },            // 需补充/重开收集
};

// 资料项状态机：待提交 → 已提交 → 已通过 | 已驳回 →（再提交）
const DOC_STATUS = {
  MISSING: 'MISSING',         // 待提交
  SUBMITTED: 'SUBMITTED',     // 已提交，待核验
  VERIFIED: 'VERIFIED',       // 已核验通过
  REJECTED: 'REJECTED',       // 已驳回（需补齐后重新提交）
};
const DOC_STATUS_LABEL = {
  MISSING: '待提交', SUBMITTED: '待核验', VERIFIED: '已通过', REJECTED: '已驳回',
};
const DOC_TRANSITIONS = {
  SUBMIT: { from: ['MISSING', 'REJECTED'], to: 'SUBMITTED' },   // 提交资料
  VERIFY: { from: ['SUBMITTED'], to: 'VERIFIED' },              // 核验通过
  REJECT: { from: ['SUBMITTED'], to: 'REJECTED' },              // 驳回补齐
  RESET: { from: ['SUBMITTED', 'VERIFIED', 'REJECTED'], to: 'MISSING' }, // 撤销/重置
};

// 商户业态（进场资料按业态匹配清单）
const BIZ_CATEGORIES = [
  '餐饮', '零售', '娱乐休闲', '教育培训', '生活服务', '酒店', '办公', '其他',
];

// 预置商户进场资料类型库（可配置，categories: '*'=通用；required 表示适用业态内必传）
const DEFAULT_DOC_TYPES = [
  // —— 通用（所有业态） ——
  { name: '营业执照（三证合一）', hint: '加盖公章的最新版执照，经营范围需涵盖实际经营内容', categories: ['*'], required: true, needVerify: true, hasExpiry: false, remindDays: 30, sort: 10 },
  { name: '法人/负责人身份证', hint: '正反面复印件，加盖公章或法人签字', categories: ['*'], required: true, needVerify: false, hasExpiry: false, remindDays: 0, sort: 20 },
  { name: '品牌授权书/商标注册证', hint: '连锁品牌提供品牌方授权；自有品牌提供商标注册证', categories: ['*'], required: true, needVerify: true, hasExpiry: true, remindDays: 60, sort: 30 },
  { name: '租赁合同及进场确认单', hint: '与商场签署的租赁合同及物业进场确认单据', categories: ['*'], required: true, needVerify: true, hasExpiry: false, remindDays: 0, sort: 40 },
  { name: '公众责任险保单', hint: '保额不低于合同约定，须覆盖整个经营期', categories: ['*'], required: true, needVerify: true, hasExpiry: true, remindDays: 30, sort: 50 },
  { name: '消防安全检查合格证明', hint: '公众聚集场所投入使用、营业前消防安全检查合格证', categories: ['*'], required: true, needVerify: true, hasExpiry: true, remindDays: 60, sort: 60 },
  { name: '装修施工图及报批材料', hint: '含消防、结构、机电专业图纸及装修报批回执', categories: ['*'], required: true, needVerify: true, hasExpiry: false, remindDays: 0, sort: 70 },
  { name: '装修押金/费用缴纳凭证', hint: '装修保证金及物业相关费用缴纳回执', categories: ['*'], required: true, needVerify: false, hasExpiry: false, remindDays: 0, sort: 80 },
  { name: '从业人员花名册', hint: '进场人员名单及岗位信息，用于出入证办理', categories: ['*'], required: false, needVerify: false, hasExpiry: false, remindDays: 0, sort: 90 },
  { name: '应急预案及演练记录', hint: '商户应急预案文本及开业前演练照片/记录', categories: ['*'], required: false, needVerify: true, hasExpiry: false, remindDays: 0, sort: 100 },
  // —— 餐饮 ——
  { name: '食品经营许可证', hint: '经营范围须涵盖实际经营项目（热食/冷食/生食等）', categories: ['餐饮'], required: true, needVerify: true, hasExpiry: true, remindDays: 60, sort: 110 },
  { name: '员工健康证', hint: '所有直接接触食品的从业人员，一人一证', categories: ['餐饮'], required: true, needVerify: true, hasExpiry: true, remindDays: 30, sort: 120 },
  { name: '油烟净化设备检测报告', hint: '第三方检测报告，符合当地排放标准', categories: ['餐饮'], required: true, needVerify: true, hasExpiry: true, remindDays: 90, sort: 130 },
  { name: '排污/排水许可备案', hint: '含油废水隔油池设置说明及排放备案', categories: ['餐饮'], required: true, needVerify: true, hasExpiry: true, remindDays: 90, sort: 140 },
  { name: '燃气报装/供气合同', hint: '使用燃气的商户提供', categories: ['餐饮'], required: true, needVerify: true, hasExpiry: false, remindDays: 0, sort: 150 },
  { name: '用电报装确认单', hint: '餐饮大功率设备用电容量确认', categories: ['餐饮'], required: true, needVerify: false, hasExpiry: false, remindDays: 0, sort: 160 },
  // —— 娱乐休闲 ——
  { name: '娱乐经营许可证', hint: 'KTV/电玩/密室等娱乐业态所需', categories: ['娱乐休闲'], required: true, needVerify: true, hasExpiry: true, remindDays: 60, sort: 210 },
  { name: '噪声排放/环保备案', hint: '环境影响登记或噪声检测达标材料', categories: ['娱乐休闲'], required: true, needVerify: true, hasExpiry: true, remindDays: 90, sort: 220 },
  // —— 教育培训 ——
  { name: '办学许可证/培训资质', hint: '主管部门审批的办学或培训资质', categories: ['教育培训'], required: true, needVerify: true, hasExpiry: true, remindDays: 60, sort: 310 },
  { name: '教师资格/聘用备案', hint: '主要授课人员资格证明或聘用备案', categories: ['教育培训'], required: true, needVerify: false, hasExpiry: false, remindDays: 0, sort: 320 },
  // —— 生活服务/酒店 ——
  { name: '特种行业许可证', hint: '住宿、美容美发、棋牌等特种行业所需', categories: ['生活服务', '酒店'], required: true, needVerify: true, hasExpiry: true, remindDays: 60, sort: 410 },
  // —— 零售 ——
  { name: '出版物经营许可证', hint: '经营图书报刊的零售商户', categories: ['零售'], required: false, needVerify: true, hasExpiry: true, remindDays: 60, sort: 510 },
];

// 权限点目录（框架第28条：角色与权限可配置）
// 按功能模块分组，UI 直接渲染成勾选矩阵
const PERMISSION_GROUPS = [
  { group: '概览', items: [
    { key: 'dashboard', label: '查看仪表盘' },
  ] },
  { group: '问题管理', items: [
    { key: 'issue_view', label: '查看问题' },
    { key: 'issue_create', label: '新增问题' },
    { key: 'issue_edit', label: '编辑问题' },
    { key: 'issue_delete', label: '删除问题' },
    { key: 'issue_export', label: '导出问题明细' },
  ] },
  { group: '整改与复查', items: [
    { key: 'rectify', label: '整改操作' },
    { key: 'reinspect', label: '复查操作' },
  ] },
  { group: '商户资料库', items: [
    { key: 'merchant_view', label: '查看商户资料' },
    { key: 'merchant_manage', label: '管理商户资料' },
  ] },
  { group: '汇报报告', items: [
    { key: 'report_export', label: '导出汇报报告' },
  ] },
  { group: '基础数据', items: [
    { key: 'plan_manage', label: '平面图管理' },
    { key: 'statboard_manage', label: '统计表管理' },
  ] },
  { group: '系统管理', items: [
    { key: 'project_manage', label: '项目管理' },
    { key: 'system_settings', label: '系统设置' },
    { key: 'account_manage', label: '账号管理' },
    { key: 'role_manage', label: '角色权限管理' },
    { key: 'audit_view', label: '查看审计日志' },
  ] },
];
// 扁平化权限点（key -> label），便于后端校验与前端判断
const PERMISSIONS = {};
PERMISSION_GROUPS.forEach((g) => g.items.forEach((it) => { PERMISSIONS[it.key] = it.label; }));
// 全部权限 key（超级管理员默认拥有）
const ALL_PERMISSIONS = Object.keys(PERMISSIONS);

// 默认角色（框架第28条：角色可配置）。name 与 ROLE 常量对应，permissions 为默认权限集合。
const DEFAULT_ROLES = [
  { key: 'super_admin', name: ROLE.SUPER_ADMIN, locked: true, permissions: ALL_PERMISSIONS.slice() },
  { key: 'project_manager', name: ROLE.PROJECT_MANAGER, locked: false, permissions: [
    'dashboard', 'issue_view', 'issue_create', 'issue_edit', 'issue_delete', 'issue_export',
    'rectify', 'reinspect', 'report_export', 'plan_manage', 'statboard_manage',
    'merchant_view', 'merchant_manage',
    'audit_view', 'project_manage', 'system_settings', 'account_manage',
  ] },
  { key: 'inspection_lead', name: ROLE.INSPECTION_LEAD, locked: false, permissions: [
    'dashboard', 'issue_view', 'issue_create', 'issue_edit', 'issue_delete', 'issue_export',
    'rectify', 'reinspect', 'report_export', 'merchant_view',
  ] },
  { key: 'discipline_lead', name: ROLE.DISCIPLINE_LEAD, locked: false, permissions: [
    'dashboard', 'issue_view', 'issue_create', 'issue_edit', 'rectify', 'reinspect', 'merchant_view',
  ] },
  { key: 'inspector', name: ROLE.INSPECTOR, locked: false, permissions: [
    'dashboard', 'issue_view', 'issue_create', 'rectify', 'merchant_view',
  ] },
  { key: 'rectify_lead', name: ROLE.RECTIFY_LEAD, locked: false, permissions: [
    'dashboard', 'issue_view', 'rectify',
  ] },
  { key: 'contractor', name: ROLE.CONTRACTOR, locked: false, permissions: [
    'dashboard', 'issue_view', 'rectify',
  ] },
  { key: 'supervisor', name: ROLE.SUPERVISOR, locked: false, permissions: [
    'dashboard', 'issue_view', 'issue_create', 'issue_edit', 'reinspect', 'report_export', 'merchant_view',
  ] },
  { key: 'property', name: ROLE.PROPERTY, locked: false, permissions: [
    'dashboard', 'issue_view', 'report_export', 'merchant_view', 'merchant_manage',
  ] },
  { key: 'operation', name: ROLE.OPERATION, locked: false, permissions: [
    'dashboard', 'issue_view', 'report_export', 'merchant_view', 'merchant_manage',
  ] },
  { key: 'readonly', name: ROLE.READONLY, locked: false, permissions: [
    'dashboard', 'issue_view', 'merchant_view',
  ] },
];

module.exports = {
  ISSUE_STATUS, ISSUE_STATUS_LABEL, TRANSITIONS,
  SEVERITY, SEVERITY_LABEL, SEVERITY_COLOR, SEVERITY_ORDER,
  PRIORITY, PRIORITY_LABEL,
  REINSPECTION_RESULT, REINSPECTION_RESULT_LABEL,
  ORG_TYPE, ROLE,
  DEFAULT_DISCIPLINES, DEFAULT_BATCH_TYPES,
  RECT_STATUS, SOURCE_TYPE, OVERDUE_COLOR,
  PERMISSION_GROUPS, PERMISSIONS, ALL_PERMISSIONS, DEFAULT_ROLES,
  MERCHANT_STATUS, MERCHANT_STATUS_LABEL, MERCHANT_TRANSITIONS,
  DOC_STATUS, DOC_STATUS_LABEL, DOC_TRANSITIONS,
  BIZ_CATEGORIES, DEFAULT_DOC_TYPES,
};
