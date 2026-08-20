'use strict';
const { TRANSITIONS, ISSUE_STATUS } = require('./constants');

/**
 * 状态机 (框架第54条)
 * 禁止直接 issue.status = 'CLOSED'，统一走 transitionIssue。
 */
function canTransition(currentStatus, action) {
  const t = TRANSITIONS[action];
  if (!t) return false;
  return t.from.includes(currentStatus);
}

function nextStatus(currentStatus, action) {
  const t = TRANSITIONS[action];
  if (!t) throw new Error('未知动作: ' + action);
  if (!t.from.includes(currentStatus)) {
    throw new Error(
      `状态转换非法: ${currentStatus} --${action}--> ${t.to}`
    );
  }
  return t.to;
}

/**
 * 返回某个状态是否为“进行中/未关闭”
 */
function isOpen(status) {
  return status !== ISSUE_STATUS.CLOSED &&
    status !== ISSUE_STATUS.CANCELLED &&
    status !== ISSUE_STATUS.DUPLICATE;
}

/**
 * 是否可关闭 (结项规则基础，框架第46条)
 */
function isClosable(status) {
  return status === ISSUE_STATUS.REINSPECTION;
}

/**
 * 通用状态机（框架第54条：任何状态流转都走状态机，禁止直接赋值）。
 * 适用于商户状态、资料项状态等多表状态机。
 * transitions 形如 { ACTION: { from: [...], to: 'X' } }。
 */
function transitionOf(transitions, currentStatus, action) {
  const t = transitions[action];
  if (!t) throw new Error('未知动作: ' + action);
  if (!t.from.includes(currentStatus)) {
    throw new Error(`状态转换非法: ${currentStatus} --${action}--> ${t.to}`);
  }
  return t.to;
}

module.exports = { canTransition, nextStatus, isOpen, isClosable, transitionOf };
