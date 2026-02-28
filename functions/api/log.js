/**
 * POST /api/log
 * 前端记录用户操作（如：预测计算、功能使用等）
 * Body: { action, detail? }
 */

import {
  successResponse, errorResponse, handleOptions,
  extractToken, verifyToken, writeLog
} from '../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405);

  const kv = env.SSQ_KV;
  const token = extractToken(request);
  const tokenData = await verifyToken(kv, token);

  if (!tokenData) {
    return errorResponse('未登录', 401);
  }

  let body;
  try { body = await request.json(); } catch { return errorResponse('Invalid JSON'); }

  const { action, detail = {} } = body;
  if (!action) return errorResponse('action 不能为空');

  // 允许的操作类型白名单
  const allowedActions = ['calculate', 'view_result', 'export', 'change_settings', 'view_history'];
  if (!allowedActions.includes(action)) {
    return errorResponse('无效的操作类型');
  }

  await writeLog(kv, tokenData.username, action, detail);

  return successResponse({}, 'OK');
}
