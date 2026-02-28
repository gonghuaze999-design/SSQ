/**
 * POST /api/auth/login
 * Body: { username, password }
 * Returns: { token, user: { username, role, nickname } }
 */

import {
  successResponse, errorResponse, handleOptions,
  getUser, verifyPassword, createToken, writeLog, initDefaultUsers
} from '../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405);

  const kv = env.SSQ_KV;
  if (!kv) return errorResponse('KV Storage not configured', 500);

  // 首次访问时初始化默认用户
  await initDefaultUsers(kv);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body');
  }

  const { username, password } = body;
  if (!username || !password) {
    return errorResponse('用户名和密码不能为空');
  }

  // 查找用户
  const user = await getUser(kv, username.trim());
  if (!user) {
    return errorResponse('用户名或密码错误');
  }

  // 检查账号状态
  if (user.status === 'disabled') {
    return errorResponse('账号已被禁用，请联系管理员');
  }
  if (user.status === 'pending') {
    return errorResponse('账号待审核，请等待管理员激活');
  }

  // 验证密码
  const ok = await verifyPassword(password, user.password);
  if (!ok) {
    return errorResponse('用户名或密码错误');
  }

  // 创建 Token
  const { token, expires } = await createToken(kv, username, user.role);

  // 更新最后登录时间
  user.last_login = Date.now();
  const { SSQ_KV: kvRef } = env;
  await kvRef.put(`user:${username}`, JSON.stringify(user));

  // 写入操作日志
  await writeLog(kv, username, 'login', { ip: request.headers.get('CF-Connecting-IP') || 'unknown' });

  return successResponse({
    token,
    expires,
    user: {
      username,
      role: user.role,
      nickname: user.nickname || username,
      email: user.email || '',
      status: user.status,
    }
  }, '登录成功');
}
