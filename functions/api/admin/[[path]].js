/**
 * 管理员用户管理 API (superadmin + professional 可访问)
 *
 * GET  /api/admin/users          - 获取所有用户列表
 * POST /api/admin/users/update   - 修改用户角色/状态/昵称
 * POST /api/admin/users/create   - 管理员直接创建用户
 * POST /api/admin/users/delete   - 删除用户
 * GET  /api/admin/stats          - BI 数据聚合
 * GET  /api/admin/logs           - 操作日志查询
 */

import {
  successResponse, errorResponse, handleOptions,
  extractToken, verifyToken, getUser, saveUser, listUsers,
  hashPassword, writeLog, requireRole
} from '../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return handleOptions();

  const kv = env.SSQ_KV;
  const token = extractToken(request);
  const tokenData = await verifyToken(kv, token);

  if (!tokenData) {
    return errorResponse('未登录或 Token 已过期', 401);
  }

  const url = new URL(request.url);
  const path = url.pathname;

  // ===== GET /api/admin/users =====
  if (path.endsWith('/users') && request.method === 'GET') {
    if (!requireRole(tokenData, 'superadmin', 'professional')) {
      return errorResponse('权限不足', 403);
    }
    const users = await listUsers(kv);
    return successResponse({ users, total: users.length });
  }

  // ===== POST /api/admin/users/update =====
  if (path.endsWith('/update') && request.method === 'POST') {
    if (!requireRole(tokenData, 'superadmin')) {
      return errorResponse('权限不足，仅超级管理员可修改用户', 403);
    }

    let body;
    try { body = await request.json(); } catch { return errorResponse('Invalid JSON'); }

    const { username, role, status, nickname } = body;
    if (!username) return errorResponse('请指定用户名');

    const user = await getUser(kv, username);
    if (!user) return errorResponse('用户不存在');

    // 不能修改自己的角色
    if (username === tokenData.username && role && role !== user.role) {
      return errorResponse('不能修改自己的角色');
    }

    if (role) user.role = role;
    if (status) user.status = status;
    if (nickname) user.nickname = nickname;

    await saveUser(kv, username, user);
    await writeLog(kv, tokenData.username, 'admin_update_user', { target: username, changes: { role, status, nickname } });

    return successResponse({}, '用户信息更新成功');
  }

  // ===== POST /api/admin/users/create =====
  if (path.endsWith('/create') && request.method === 'POST') {
    if (!requireRole(tokenData, 'superadmin')) {
      return errorResponse('权限不足', 403);
    }

    let body;
    try { body = await request.json(); } catch { return errorResponse('Invalid JSON'); }

    const { username, password, role = 'basic', nickname, email = '' } = body;
    if (!username || !password) return errorResponse('用户名和密码不能为空');
    if (username.length < 3) return errorResponse('用户名长度至少 3 位');
    if (password.length < 6) return errorResponse('密码长度至少 6 位');

    const existing = await getUser(kv, username);
    if (existing) return errorResponse('用户名已存在');

    const passwordHash = await hashPassword(password);
    await saveUser(kv, username, {
      password: passwordHash,
      role,
      status: 'active',
      nickname: nickname || username,
      email,
      created_at: Date.now(),
      last_login: null,
    });

    await writeLog(kv, tokenData.username, 'admin_create_user', { target: username, role });

    return successResponse({}, `用户 ${username} 创建成功`);
  }

  // ===== POST /api/admin/users/delete =====
  if (path.endsWith('/delete') && request.method === 'POST') {
    if (!requireRole(tokenData, 'superadmin')) {
      return errorResponse('权限不足', 403);
    }

    let body;
    try { body = await request.json(); } catch { return errorResponse('Invalid JSON'); }

    const { username } = body;
    if (!username) return errorResponse('请指定用户名');
    if (username === tokenData.username) return errorResponse('不能删除自己');

    const user = await getUser(kv, username);
    if (!user) return errorResponse('用户不存在');

    await kv.delete(`user:${username}`);
    await writeLog(kv, tokenData.username, 'admin_delete_user', { target: username });

    return successResponse({}, `用户 ${username} 已删除`);
  }

  // ===== GET /api/admin/stats =====
  if (path.endsWith('/stats') && request.method === 'GET') {
    if (!requireRole(tokenData, 'superadmin', 'professional')) {
      return errorResponse('权限不足', 403);
    }

    // 获取最近 30 天统计
    const statsArr = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const raw = await kv.get(`stats:daily:${dateStr}`);
      const stat = raw ? JSON.parse(raw) : { login: 0, calc: 0, total: 0 };
      statsArr.push({ date: dateStr, ...stat });
    }

    // 获取用户总数和角色分布
    const users = await listUsers(kv);
    const roleCount = { basic: 0, professional: 0, superadmin: 0 };
    const statusCount = { active: 0, pending: 0, disabled: 0 };
    for (const u of users) {
      roleCount[u.role] = (roleCount[u.role] || 0) + 1;
      statusCount[u.status] = (statusCount[u.status] || 0) + 1;
    }

    return successResponse({
      daily_stats: statsArr,
      total_users: users.length,
      role_distribution: roleCount,
      status_distribution: statusCount,
    });
  }

  // ===== GET /api/admin/logs =====
  if (path.endsWith('/logs') && request.method === 'GET') {
    if (!requireRole(tokenData, 'superadmin')) {
      return errorResponse('权限不足', 403);
    }

    const targetUser = url.searchParams.get('username') || '';
    const prefix = targetUser ? `log:${targetUser}:` : 'log:';
    const limit = parseInt(url.searchParams.get('limit') || '100');

    const result = await kv.list({ prefix, limit });
    const logs = [];
    for (const key of result.keys) {
      const raw = await kv.get(key.name);
      if (raw) logs.push(JSON.parse(raw));
    }

    // 按时间倒序
    logs.sort((a, b) => b.timestamp - a.timestamp);

    return successResponse({ logs, total: logs.length });
  }

  return errorResponse('Not Found', 404);
}
