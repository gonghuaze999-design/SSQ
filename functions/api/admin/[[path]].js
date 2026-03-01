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
  if (!token) return { error: '未携带 Authorization Token，请重新登录' };
  const raw = await kv.get(`token:${token}`);
  if (!raw) return { error: 'Token 在服务器不存在，请重新登录（或 KV 未绑定）' };
  let td;
  try { td = JSON.parse(raw); } catch { return { error: 'Token 数据损坏，请重新登录' }; }
  if (Date.now() > td.expires) { await kv.delete(`token:${token}`); return { error: 'Token 已过期，请重新登录' }; }
  return td;
}

async function listUsers(kv) {
  const result = await kv.list({ prefix: 'user:' });
  const keys = result.keys.map(k => k.name);
  const users = [];
  const batchSize = 20;
  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);
    const raws = await Promise.all(batch.map(k => kv.get(k)));
    raws.forEach((raw, j) => {
      if (raw) {
        const u = JSON.parse(raw);
        delete u.password;
        users.push({ username: keys[i + j].replace('user:', ''), ...u });
      }
    });
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

  let kv = null;
  try { kv = env?.SSQ_KV || null; } catch(e) {}
  try { if (!kv) kv = SSQ_KV; } catch(e) {}
  if (!kv) return err('KV Storage not configured', 500);

  const td = await getTokenData(kv, request);
  if (td.error) return err(td.error, 401);

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
    // 兼容前端传 userId 或 username
    const username = body.username || body.userId;
    if (!username) return err('请指定用户名');
    if (username === td.username) return err('不能删除自己');
    if (!(await kv.get(`user:${username}`))) return err('用户不存在');
    await kv.delete(`user:${username}`);
    await writeLog(kv, td.username, 'admin_delete_user', { target: username });
    return ok({}, `用户 ${username} 已删除`);
  }

  // POST /api/admin/upgrade/request — 用户申请升级，写入KV
  if (path.endsWith('/upgrade/request') && request.method === 'POST') {
    const username = td.username;
    const key = `upgrade:${username}`;
    const existing = await kv.get(key);
    if (existing) {
      const ex = JSON.parse(existing);
      if (ex.status === 'pending') return err('您已有一条待审批的升级申请');
    }
    await kv.put(key, JSON.stringify({ username, requestedAt: Date.now(), status: 'pending' }));
    await writeLog(kv, username, 'request_upgrade', {});
    return ok({}, '升级申请已提交，等待管理员审批');
  }

  // GET /api/admin/upgrade/list — 管理员获取所有升级申请
  if (path.endsWith('/upgrade/list') && request.method === 'GET') {
    if (!isSuperadmin) return err('权限不足', 403);
    const result = await kv.list({ prefix: 'upgrade:' });
    const keys = result.keys.map(k => k.name);
    const raws = await Promise.all(keys.map(k => kv.get(k)));
    const reqs = raws.filter(Boolean).map(r => JSON.parse(r));
    reqs.sort((a, b) => b.requestedAt - a.requestedAt);
    return ok({ reqs });
  }

  // POST /api/admin/upgrade/approve — 管理员审批
  if (path.endsWith('/upgrade/approve') && request.method === 'POST') {
    if (!isSuperadmin) return err('权限不足', 403);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { username, approve } = body;
    if (!username) return err('请指定用户名');
    const key = `upgrade:${username}`;
    const raw = await kv.get(key);
    if (!raw) return err('找不到该申请');
    const req = JSON.parse(raw);
    req.status = approve ? 'approved' : 'rejected';
    req.processedAt = Date.now();
    req.processedBy = td.username;
    await kv.put(key, JSON.stringify(req));
    if (approve) {
      const userRaw = await kv.get(`user:${username}`);
      if (userRaw) {
        const u = JSON.parse(userRaw);
        u.role = 'professional';
        await kv.put(`user:${username}`, JSON.stringify(u));
      }
    }
    await writeLog(kv, td.username, approve ? 'approve_upgrade' : 'reject_upgrade', { target: username });
    return ok({}, approve ? `已批准 ${username} 升级为专业版` : `已拒绝 ${username} 的升级申请`);
  }

  // GET /api/admin/stats
  if (path.endsWith('/stats') && request.method === 'GET') {
    if (!isAdmin) return err('权限不足', 403);
    const now = new Date();
    // 并发读取30天数据
    const dateStrs = Array.from({length:30}, (_,i) => {
      const d = new Date(now); d.setDate(d.getDate() - (29-i));
      return d.toISOString().slice(0, 10);
    });
    const raws = await Promise.all(dateStrs.map(ds => kv.get(`stats:daily:${ds}`)));
    const statsArr = dateStrs.map((ds, i) => ({ date: ds, ...(raws[i] ? JSON.parse(raws[i]) : { login: 0, calc: 0, total: 0 }) }));

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

    // 并发读取，最多20个并发
    const keys = result.keys.map(k => k.name);
    const logs = [];
    const batchSize = 20;
    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      const raws = await Promise.all(batch.map(k => kv.get(k)));
      raws.forEach(raw => { if (raw) logs.push(JSON.parse(raw)); });
    }
    logs.sort((a, b) => b.timestamp - a.timestamp);

    // 聚合分析
    const byUser = {};
    const actionCount = {};
    const backtestStats = { count: 0, avgRoi: 0, avgRtp: 0, avgWinRate: 0, modelTypes: {}, betModes: {} };
    const aiStats = { count: 0, quadrants: {}, withBacktest: 0, withInference: 0 };
    const tabDuration = {}; // tab -> total seconds
    const uploadCount = {};
    let totalOnlineSec = 0;

    for (const log of logs) {
      const u = log.username || 'unknown';
      if (!byUser[u]) byUser[u] = { logs: 0, backtests: 0, aiReports: 0, tabVisits: {}, onlineSec: 0 };
      byUser[u].logs++;

      const act = log.action || '';
      actionCount[act] = (actionCount[act] || 0) + 1;

      if (act === '回测完成' && log.detail) {
        const d = log.detail;
        backtestStats.count++;
        byUser[u].backtests++;
        backtestStats.avgRoi += parseFloat(d.roi || 0);
        backtestStats.avgRtp += parseFloat(d.rtp || 0);
        backtestStats.avgWinRate += parseFloat(d.winRate || 0);
        if (d.modelType) backtestStats.modelTypes[d.modelType] = (backtestStats.modelTypes[d.modelType] || 0) + 1;
        if (d.betMode) backtestStats.betModes[d.betMode] = (backtestStats.betModes[d.betMode] || 0) + 1;
      }

      if (act === 'AI报告生成' && log.detail) {
        const d = log.detail;
        aiStats.count++;
        byUser[u].aiReports++;
        if (d.quadrant) aiStats.quadrants[d.quadrant] = (aiStats.quadrants[d.quadrant] || 0) + 1;
        if (d.hasBacktest) aiStats.withBacktest++;
        if (d.hasInference) aiStats.withInference++;
      }

      if (act === 'Tab停留时长' && log.detail) {
        const tab = log.detail.tab || '';
        const sec = parseInt(log.detail.durationSec || 0);
        tabDuration[tab] = (tabDuration[tab] || 0) + sec;
        if (byUser[u]) byUser[u].onlineSec += sec;
      }

      if (act === '在线时长' && log.detail) {
        const sec = parseInt(log.detail.durationSec || 0);
        totalOnlineSec += sec;
        if (byUser[u]) byUser[u].onlineSec += sec;
      }

      if (act.startsWith('访问功能页:') && log.detail) {
        const tab = act.replace('访问功能页: ', '');
        byUser[u].tabVisits[tab] = (byUser[u].tabVisits[tab] || 0) + 1;
      }

      if (act === '上传数据文件') byUser[u].uploads = (byUser[u].uploads || 0) + 1;
    }

    if (backtestStats.count > 0) {
      backtestStats.avgRoi = (backtestStats.avgRoi / backtestStats.count).toFixed(2);
      backtestStats.avgRtp = (backtestStats.avgRtp / backtestStats.count).toFixed(1);
      backtestStats.avgWinRate = (backtestStats.avgWinRate / backtestStats.count).toFixed(2);
    }

    return ok({ logs, total: logs.length, analysis: { byUser, actionCount, backtestStats, aiStats, tabDuration, totalOnlineSec } });
  }

  // POST /api/admin/record/backtest — 存回测明细到KV
  if (path.endsWith('/record/backtest') && request.method === 'POST') {
    const username = td.username;
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const ts = Date.now();
    const key = `bt_rec:${username}:${ts}`;
    await kv.put(key, JSON.stringify({
      username,
      timestamp: ts,
      date: new Date(ts).toISOString(),
      ...body
    }), { expirationTtl: 60 * 60 * 24 * 180 }); // 保留180天
    return ok({}, 'OK');
  }

  // POST /api/admin/record/ai — 存AI报告明细到KV
  if (path.endsWith('/record/ai') && request.method === 'POST') {
    const username = td.username;
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const ts = Date.now();
    const key = `ai_rec:${username}:${ts}`;
    // content单独存（可能很大），meta分开存
    const { content, ...meta } = body;
    await kv.put(key, JSON.stringify({ username, timestamp: ts, date: new Date(ts).toISOString(), ...meta }), { expirationTtl: 60 * 60 * 24 * 180 });
    if (content) {
      await kv.put(`${key}:content`, content, { expirationTtl: 60 * 60 * 24 * 180 });
    }
    return ok({ key }, 'OK');
  }

  // GET /api/admin/record/list — 管理员查看明细列表
  if (path.endsWith('/record/list') && request.method === 'GET') {
    if (!isSuperadmin) return err('权限不足', 403);
    const type = url.searchParams.get('type') || 'backtest'; // backtest | ai
    const targetUser = url.searchParams.get('username') || '';
    const limit = parseInt(url.searchParams.get('limit') || '100');
    const prefix = type === 'ai'
      ? (targetUser ? `ai_rec:${targetUser}:` : 'ai_rec:')
      : (targetUser ? `bt_rec:${targetUser}:` : 'bt_rec:');
    const result = await kv.list({ prefix, limit });
    const records = [];
    for (const k of result.keys) {
      const raw = await kv.get(k.name);
      if (raw) records.push(JSON.parse(raw));
    }
    records.sort((a, b) => b.timestamp - a.timestamp);
    return ok({ records, total: records.length });
  }

  // GET /api/admin/record/ai-content — 管理员查看AI报告正文
  if (path.endsWith('/record/ai-content') && request.method === 'GET') {
    if (!isSuperadmin) return err('权限不足', 403);
    const key = url.searchParams.get('key');
    if (!key || !key.startsWith('ai_rec:')) return err('无效的key');
    const content = await kv.get(`${key}:content`);
    if (!content) return err('报告内容不存在或已过期');
    return ok({ content });
  }

  return err('Not Found', 404);
}
