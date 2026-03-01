// GET /api/auth/check
// 诊断接口：检查当前 token 的状态，返回详细信息帮助排查问题

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
const ok  = (data = {}, msg = 'success') => jsonRes({ code: 0, message: msg, data });
const err = (msg, status = 400) => jsonRes({ code: -1, message: msg, data: null }, status);
const opts = () => new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return opts();

  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  const diagnosis = {
    hasAuthHeader: !!auth,
    authHeaderValue: auth ? (auth.slice(0, 20) + '…') : '(empty)',
    hasToken: !!token,
    tokenPrefix: token ? token.slice(0, 8) + '…' : '(none)',
    kvAvailable: false,
    tokenFoundInKv: false,
    tokenExpired: false,
    tokenData: null,
    error: null,
  };

  const kv = (typeof env !== 'undefined' ? env.SSQ_KV : null) || SSQ_KV;
  diagnosis.kvAvailable = !!kv;

  if (!kv) {
    diagnosis.error = 'KV Storage (SSQ_KV) not available — 请在 EdgeOne 控制台确认 KV 命名空间已绑定，变量名为 SSQ_KV';
    return ok(diagnosis, '诊断完成（KV不可用）');
  }

  if (!token) {
    diagnosis.error = 'Authorization 头缺失，前端未传 token';
    return ok(diagnosis, '诊断完成（无token）');
  }

  try {
    const raw = await kv.get(`token:${token}`);
    diagnosis.tokenFoundInKv = !!raw;
    if (raw) {
      const td = JSON.parse(raw);
      diagnosis.tokenExpired = Date.now() > td.expires;
      diagnosis.tokenData = {
        username: td.username,
        role: td.role,
        expires: new Date(td.expires).toISOString(),
        isExpired: Date.now() > td.expires,
      };
    } else {
      diagnosis.error = `KV 中找不到 token:${token.slice(0, 8)}… — token 不存在（可能 login 写入另一个 KV，或已被清除）`;
    }
  } catch(e) {
    diagnosis.error = `KV 读取异常: ${e.message}`;
  }

  return ok(diagnosis, '诊断完成');
}
