/**
 * GET  /api/user/profile  - 获取当前用户信息
 * POST /api/user/profile  - 更新昵称/邮箱
 * POST /api/user/password - 修改密码
 */

import {
  successResponse, errorResponse, handleOptions,
  extractToken, verifyToken, getUser, saveUser,
  hashPassword, verifyPassword, writeLog
} from '../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return handleOptions();

  const kv = env.SSQ_KV;
  const token = extractToken(request);
  const tokenData = await verifyToken(kv, token);

  if (!tokenData) {
    return errorResponse('未登录或 Token 已过期，请重新登录', 401);
  }

  const url = new URL(request.url);
  const path = url.pathname;

  // --- GET /api/user/profile ---
  if (path.endsWith('/profile') && request.method === 'GET') {
    const user = await getUser(kv, tokenData.username);
    if (!user) return errorResponse('用户不存在', 404);

    return successResponse({
      username: tokenData.username,
      role: user.role,
      nickname: user.nickname || tokenData.username,
      email: user.email || '',
      status: user.status,
      created_at: user.created_at,
      last_login: user.last_login,
    });
  }

  // --- POST /api/user/profile ---
  if (path.endsWith('/profile') && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return errorResponse('Invalid JSON'); }

    const user = await getUser(kv, tokenData.username);
    if (!user) return errorResponse('用户不存在', 404);

    if (body.nickname !== undefined) {
      if (body.nickname.length < 1 || body.nickname.length > 20) {
        return errorResponse('昵称长度应为 1-20 个字符');
      }
      user.nickname = body.nickname;
    }
    if (body.email !== undefined) {
      user.email = body.email;
    }

    await saveUser(kv, tokenData.username, user);
    await writeLog(kv, tokenData.username, 'update_profile', {});
    return successResponse({}, '信息更新成功');
  }

  // --- POST /api/user/password ---
  if (path.endsWith('/password') && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return errorResponse('Invalid JSON'); }

    const { old_password, new_password } = body;
    if (!old_password || !new_password) {
      return errorResponse('请提供旧密码和新密码');
    }
    if (new_password.length < 6) {
      return errorResponse('新密码长度不能少于 6 位');
    }

    const user = await getUser(kv, tokenData.username);
    if (!user) return errorResponse('用户不存在', 404);

    const ok = await verifyPassword(old_password, user.password);
    if (!ok) return errorResponse('旧密码不正确');

    user.password = await hashPassword(new_password);
    await saveUser(kv, tokenData.username, user);
    await writeLog(kv, tokenData.username, 'change_password', {});

    return successResponse({}, '密码修改成功');
  }

  return errorResponse('Not Found', 404);
}
