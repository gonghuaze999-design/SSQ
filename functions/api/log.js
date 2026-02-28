// POST /api/log - 前端记录用户操作

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } });
}
const ok = (data = {}, msg = 'success') => jsonRes({ code: 0, message: msg, data });
const err = (msg, status = 400) => jsonRes({ code: -1, message: msg, data: null }, status);
const opts = () => new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } });

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

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return opts();
  if (request.method !== 'POST') return err('Method not allowed', 405);

  const kv = SSQ_KV;
  if (!kv) return err('KV Storage not configured', 500);

  const td = await getTokenData(kv, request);
  if (!td) return err('未登录', 401);

  let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
  const { action, detail = {} } = body;
  if (!action) return err('action 不能为空');

  const allowed = ['calculate', 'view_result', 'export', 'change_settings', 'view_history'];
  if (!allowed.includes(action)) return err('无效的操作类型');

  const ts = Date.now();
  await kv.put(`log:${td.username}:${ts}`, JSON.stringify({ username: td.username, action, detail, timestamp: ts, date: new Date(ts).toISOString() }));

  const today = new Date().toISOString().slice(0, 10);
  const statsKey = `stats:daily:${today}`;
  const rawStats = await kv.get(statsKey);
  const s = rawStats ? JSON.parse(rawStats) : { login: 0, calc: 0, total: 0 };
  s.total += 1;
  if (action === 'calculate') s.calc += 1;
  await kv.put(statsKey, JSON.stringify(s));

  return ok({}, 'OK');
}
