// POST /api/auth/logout

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } });
}
const ok = (data = {}, msg = 'success') => jsonRes({ code: 0, message: msg, data });
const opts = () => new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } });

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return opts();

  const kv = env.SSQ_KV;
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (token && kv) {
    const raw = await kv.get(`token:${token}`);
    if (raw) {
      const td = JSON.parse(raw);
      const ts = Date.now();
      await kv.put(`log:${td.username}:${ts}`, JSON.stringify({ username: td.username, action: 'logout', detail: {}, timestamp: ts, date: new Date(ts).toISOString() }));
      await kv.delete(`token:${token}`);
    }
  }

  return ok({}, '已退出登录');
}
