// GET  /api/user/profile  - 获取用户信息
// POST /api/user/profile  - 更新昵称/邮箱
// POST /api/user/password - 修改密码

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

async function writeLog(kv, username, action) {
  const ts = Date.now();
  await kv.put(`log:${username}:${ts}`, JSON.stringify({ username, action, detail: {}, timestamp: ts, date: new Date(ts).toISOString() }));
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return opts();

  const kv = (typeof env !== "undefined" ? env.SSQ_KV : null) || SSQ_KV;
  if (!kv) return err('KV Storage not configured', 500);

  const td = await getTokenData(kv, request);
  if (td.error) return err(td.error, 401);

  const path = new URL(request.url).pathname;

  // GET /api/user/profile
  if (path.endsWith('/profile') && request.method === 'GET') {
    const raw = await kv.get(`user:${td.username}`);
    if (!raw) return err('用户不存在', 404);
    const u = JSON.parse(raw);
    return ok({ username: td.username, role: u.role, nickname: u.nickname || td.username, email: u.email || '', status: u.status, created_at: u.created_at, last_login: u.last_login });
  }

  // POST /api/user/profile
  if (path.endsWith('/profile') && request.method === 'POST') {
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const raw = await kv.get(`user:${td.username}`);
    if (!raw) return err('用户不存在', 404);
    const u = JSON.parse(raw);
    if (body.nickname !== undefined) {
      if (body.nickname.length < 1 || body.nickname.length > 20) return err('昵称长度应为 1-20 个字符');
      u.nickname = body.nickname;
    }
    if (body.email !== undefined) u.email = body.email;
    await kv.put(`user:${td.username}`, JSON.stringify(u));
    await writeLog(kv, td.username, 'update_profile');
    return ok({}, '信息更新成功');
  }

  // POST /api/user/password
  if (path.endsWith('/password') && request.method === 'POST') {
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { old_password, new_password } = body;
    if (!old_password || !new_password) return err('请提供旧密码和新密码');
    if (new_password.length < 6) return err('新密码长度不能少于 6 位');
    const raw = await kv.get(`user:${td.username}`);
    if (!raw) return err('用户不存在', 404);
    const u = JSON.parse(raw);
    if ((await hashPwd(old_password)) !== u.password) return err('旧密码不正确');
    u.password = await hashPwd(new_password);
    await kv.put(`user:${td.username}`, JSON.stringify(u));
    await writeLog(kv, td.username, 'change_password');
    return ok({}, '密码修改成功');
  }

  // GET /api/user/data?type=bt_history|ai_history  — 拉取用户本地历史数据备份
  if (path.endsWith('/data') && request.method === 'GET') {
    const type = new URL(request.url).searchParams.get('type') || 'bt_history';
    if (!['bt_history', 'ai_history'].includes(type)) return err('无效的type');
    const key = `userdata:${td.username}:${type}`;
    const raw = await kv.get(key);
    return ok({ data: raw ? raw : null });
  }

  // POST /api/user/data  — 保存用户本地历史数据到KV（JSON字符串，最大500KB）
  if (path.endsWith('/data') && request.method === 'POST') {
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { type, data } = body;
    if (!type || !['bt_history', 'ai_history'].includes(type)) return err('无效的type');
    if (typeof data !== 'string') return err('data必须是JSON字符串');
    if (data.length > 512000) return err('数据超过500KB上限');
    const key = `userdata:${td.username}:${type}`;
    // 保存365天
    await kv.put(key, data, { expirationTtl: 60 * 60 * 24 * 365 });
    return ok({}, 'OK');
  }

  return err('Not Found', 404);
}
