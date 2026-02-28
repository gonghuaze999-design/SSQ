// 管理员 API
// GET  /api/admin/users         - 用户列表
// POST /api/admin/users/update  - 修改用户
// POST /api/admin/users/create  - 创建用户
// POST /api/admin/users/delete  - 删除用户
// GET  /api/admin/stats         - BI统计
// GET  /api/admin/logs          - 操作日志

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } });
}
const ok = (data = {}, msg = 'success') => jsonRes({ code: 0, message: msg, data });
const err = (msg, status = 400) => jsonRes({ code: -1, message: msg, data: null }, status);
const opts = () => new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } });

async function hashPwd(password) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(password + 'ssq_platform_salt_2024'));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getTokenData(kv, request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const raw = await kv.get(`token:${token}`);
  if (!raw) return null;
  const td = JSON.parse(raw);
  if (Date.now() > td.expires) { await kv.delete(`token:${token}`); return null; }
  return td;
}

async function listUsers(kv) {
  const result = await kv.list({ prefix: 'user:' });
  const users = [];
  for (const key of result.keys) {
    const raw = await kv.get(key.name);
    if (raw) {
      const u = JSON.parse(raw);
      delete u.password;
      users.push({ username: key.name.replace('user:', ''), ...u });
    }
  }
  return users;
}

async function writeLog(kv, username, action, detail = {}) {
  const ts = Date.now();
  await kv.put(`log:${username}:${ts}`, JSON.stringify({ username, action, detail, timestamp: ts, date: new Date(ts).toISOString() }));
  const today = new Date().toISOString().slice(0, 10);
  const statsKey = `stats:daily:${today}`;
  const raw = await kv.get(statsKey);
  const s = raw ? JSON.parse(raw) : { login: 0, calc: 0, total: 0 };
  s.total += 1;
  await kv.put(statsKey, JSON.stringify(s));
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return opts();

  const kv = SSQ_KV;
  if (!kv) return err('KV Storage not configured', 500);

  const td = await getTokenData(kv, request);
  if (!td) return err('未登录或 Token 已过期', 401);

  const url = new URL(request.url);
  const path = url.pathname;
  const isSuperadmin = td.role === 'superadmin';
  const isAdmin = isSuperadmin || td.role === 'professional';

  // GET /api/admin/users
  if (path.endsWith('/users') && request.method === 'GET') {
    if (!isAdmin) return err('权限不足', 403);
    const users = await listUsers(kv);
    return ok({ users, total: users.length });
  }

  // POST /api/admin/users/update
  if (path.endsWith('/update') && request.method === 'POST') {
    if (!isSuperadmin) return err('权限不足，仅超级管理员可修改用户', 403);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { username, role, status, nickname } = body;
    if (!username) return err('请指定用户名');
    const raw = await kv.get(`user:${username}`);
    if (!raw) return err('用户不存在');
    const u = JSON.parse(raw);
    if (username === td.username && role && role !== u.role) return err('不能修改自己的角色');
    if (role) u.role = role;
    if (status) u.status = status;
    if (nickname) u.nickname = nickname;
    await kv.put(`user:${username}`, JSON.stringify(u));
    await writeLog(kv, td.username, 'admin_update_user', { target: username, changes: { role, status, nickname } });
    return ok({}, '用户信息更新成功');
  }

  // POST /api/admin/users/create
  if (path.endsWith('/create') && request.method === 'POST') {
    if (!isSuperadmin) return err('权限不足', 403);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { username, password, role = 'basic', nickname, email = '' } = body;
    if (!username || !password) return err('用户名和密码不能为空');
    if (username.length < 3) return err('用户名长度至少 3 位');
    if (password.length < 6) return err('密码长度至少 6 位');
    if (await kv.get(`user:${username}`)) return err('用户名已存在');
    await kv.put(`user:${username}`, JSON.stringify({ password: await hashPwd(password), role, status: 'active', nickname: nickname || username, email, created_at: Date.now(), last_login: null }));
    await writeLog(kv, td.username, 'admin_create_user', { target: username, role });
    return ok({}, `用户 ${username} 创建成功`);
  }

  // POST /api/admin/users/delete
  if (path.endsWith('/delete') && request.method === 'POST') {
    if (!isSuperadmin) return err('权限不足', 403);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { username } = body;
    if (!username) return err('请指定用户名');
    if (username === td.username) return err('不能删除自己');
    if (!(await kv.get(`user:${username}`))) return err('用户不存在');
    await kv.delete(`user:${username}`);
    await writeLog(kv, td.username, 'admin_delete_user', { target: username });
    return ok({}, `用户 ${username} 已删除`);
  }

  // GET /api/admin/stats
  if (path.endsWith('/stats') && request.method === 'GET') {
    if (!isAdmin) return err('权限不足', 403);
    const statsArr = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const raw = await kv.get(`stats:daily:${dateStr}`);
      statsArr.push({ date: dateStr, ...(raw ? JSON.parse(raw) : { login: 0, calc: 0, total: 0 }) });
    }
    const users = await listUsers(kv);
    const roleCount = { basic: 0, professional: 0, superadmin: 0 };
    const statusCount = { active: 0, pending: 0, disabled: 0 };
    for (const u of users) {
      roleCount[u.role] = (roleCount[u.role] || 0) + 1;
      statusCount[u.status] = (statusCount[u.status] || 0) + 1;
    }
    return ok({ daily_stats: statsArr, total_users: users.length, role_distribution: roleCount, status_distribution: statusCount });
  }

  // GET /api/admin/logs
  if (path.endsWith('/logs') && request.method === 'GET') {
    if (!isSuperadmin) return err('权限不足', 403);
    const targetUser = url.searchParams.get('username') || '';
    const prefix = targetUser ? `log:${targetUser}:` : 'log:';
    const limit = parseInt(url.searchParams.get('limit') || '100');
    const result = await kv.list({ prefix, limit });
    const logs = [];
    for (const key of result.keys) {
      const raw = await kv.get(key.name);
      if (raw) logs.push(JSON.parse(raw));
    }
    logs.sort((a, b) => b.timestamp - a.timestamp);
    return ok({ logs, total: logs.length });
  }

  return err('Not Found', 404);
}
