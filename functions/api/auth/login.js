// POST /api/auth/login
// Body: { username, password }

// ===== 内联工具函数 =====
function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
const ok = (data = {}, msg = 'success') => jsonRes({ code: 0, message: msg, data });
const err = (msg, status = 400) => jsonRes({ code: -1, message: msg, data: null }, status);
const opts = () => new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } });

async function hashPwd(password) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(password + 'ssq_platform_salt_2024'));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPwd(password, hash) {
  return (await hashPwd(password)) === hash;
}

function genToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function initDefaults(kv) {
  if (await kv.get('user:admin')) return;
  const a = await hashPwd('admin123456');
  const p = await hashPwd('pro123456');
  const b = await hashPwd('basic123456');
  const now = Date.now();
  await kv.put('user:admin',     JSON.stringify({ password: a, role: 'superadmin',   status: 'active', nickname: '超级管理员', email: '', created_at: now, last_login: null }));
  await kv.put('user:prouser',   JSON.stringify({ password: p, role: 'professional', status: 'active', nickname: '专业用户',   email: '', created_at: now, last_login: null }));
  await kv.put('user:basicuser', JSON.stringify({ password: b, role: 'basic',        status: 'active', nickname: '基础用户',   email: '', created_at: now, last_login: null }));
}

async function writeLog(kv, username, action, detail = {}) {
  const ts = Date.now();
  await kv.put(`log:${username}:${ts}`, JSON.stringify({ username, action, detail, timestamp: ts, date: new Date(ts).toISOString() }));
  const today = new Date().toISOString().slice(0, 10);
  const statsKey = `stats:daily:${today}`;
  const raw = await kv.get(statsKey);
  const s = raw ? JSON.parse(raw) : { login: 0, calc: 0, total: 0 };
  s.total += 1;
  if (action === 'login') s.login += 1;
  if (action === 'calculate') s.calc += 1;
  await kv.put(statsKey, JSON.stringify(s));
}
// ===== 工具函数结束 =====

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return opts();
  if (request.method !== 'POST') return err('Method not allowed', 405);

  const kv = env.SSQ_KV;
  if (!kv) return err('KV Storage not configured', 500);

  await initDefaults(kv);

  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON'); }

  const { username, password } = body;
  if (!username || !password) return err('用户名和密码不能为空');

  const raw = await kv.get(`user:${username.trim()}`);
  if (!raw) return err('用户名或密码错误');
  const user = JSON.parse(raw);

  if (user.status === 'disabled') return err('账号已被禁用，请联系管理员');
  if (user.status === 'pending')  return err('账号待审核，请等待管理员激活');

  if (!(await verifyPwd(password, user.password))) return err('用户名或密码错误');

  // 生成 Token
  const token = genToken();
  const expires = Date.now() + 7 * 24 * 60 * 60 * 1000;
  await kv.put(`token:${token}`, JSON.stringify({ username: username.trim(), role: user.role, expires }));

  // 更新最后登录时间
  user.last_login = Date.now();
  await kv.put(`user:${username.trim()}`, JSON.stringify(user));

  await writeLog(kv, username.trim(), 'login', { ip: request.headers.get('CF-Connecting-IP') || 'unknown' });

  return ok({ token, expires, user: { username: username.trim(), role: user.role, nickname: user.nickname || username, email: user.email || '', status: user.status } }, '登录成功');
}
