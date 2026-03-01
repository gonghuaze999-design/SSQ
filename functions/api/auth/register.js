// POST /api/auth/register
// Body: { username, password, nickname?, email? }

// ===== 内联工具函数 =====
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
// ===== 工具函数结束 =====

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return opts();
  if (request.method !== 'POST') return err('Method not allowed', 405);

  const kv = (typeof env !== "undefined" ? env.SSQ_KV : null) || SSQ_KV;
  if (!kv) return err('KV Storage not configured', 500);

  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON'); }

  const { username, password, nickname, email } = body;
  if (!username || !password) return err('用户名和密码不能为空');
  if (username.length < 3 || username.length > 20) return err('用户名长度应为 3-20 个字符');
  if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(username)) return err('用户名只能包含字母、数字、下划线和中文');
  if (password.length < 6) return err('密码长度不能少于 6 位');

  const existing = await kv.get(`user:${username}`);
  if (existing) return err('用户名已被占用');

  await kv.put(`user:${username}`, JSON.stringify({
    password: await hashPwd(password),
    role: 'basic',
    status: 'pending',
    nickname: nickname || username,
    email: email || '',
    created_at: Date.now(),
    last_login: null,
  }));

  const ts = Date.now();
  await kv.put(`log:${username}:${ts}`, JSON.stringify({ username, action: 'register', detail: {}, timestamp: ts, date: new Date(ts).toISOString() }));

  return ok({}, '注册成功，请等待管理员审核激活账号');
}
