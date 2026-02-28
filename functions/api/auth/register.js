/**
 * POST /api/auth/register
 * Body: { username, password, nickname?, email? }
 * Returns: { message }
 */

import {
  successResponse, errorResponse, handleOptions,
  getUser, saveUser, hashPassword, writeLog, initDefaultUsers
} from '../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405);

  const kv = env.SSQ_KV;
  if (!kv) return errorResponse('KV Storage not configured', 500);

  await initDefaultUsers(kv);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body');
  }

  const { username, password, nickname, email } = body;

  // 验证输入
  if (!username || !password) {
    return errorResponse('用户名和密码不能为空');
  }
  if (username.length < 3 || username.length > 20) {
    return errorResponse('用户名长度应为 3-20 个字符');
  }
  if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(username)) {
    return errorResponse('用户名只能包含字母、数字、下划线和中文');
  }
  if (password.length < 6) {
    return errorResponse('密码长度不能少于 6 位');
  }

  // 检查用户是否已存在
  const existing = await getUser(kv, username);
  if (existing) {
    return errorResponse('用户名已被占用');
  }

  // 创建用户 (默认 basic 角色，pending 状态需管理员激活)
  const passwordHash = await hashPassword(password);
  await saveUser(kv, username, {
    password: passwordHash,
    role: 'basic',
    status: 'pending',  // 需要管理员审核激活
    nickname: nickname || username,
    email: email || '',
    created_at: Date.now(),
    last_login: null,
  });

  await writeLog(kv, username, 'register', { nickname: nickname || username });

  return successResponse({}, '注册成功，请等待管理员审核激活账号');
}
