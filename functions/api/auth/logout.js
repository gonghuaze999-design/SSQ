/**
 * POST /api/auth/logout
 * Header: Authorization: Bearer {token}
 */

import {
  successResponse, errorResponse, handleOptions,
  extractToken, verifyToken, deleteToken, writeLog
} from '../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405);

  const kv = env.SSQ_KV;
  const token = extractToken(request);

  if (token) {
    const tokenData = await verifyToken(kv, token);
    if (tokenData) {
      await writeLog(kv, tokenData.username, 'logout', {});
      await deleteToken(kv, token);
    }
  }

  return successResponse({}, '已退出登录');
}
