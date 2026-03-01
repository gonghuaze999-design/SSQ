// POST /api/gemini - 代理转发 Gemini API 请求（解决中国大陆直连被封问题）
// Body: { key: string, model?: string, contents: any[], generationConfig?: any }
// 此接口将请求通过 EdgeOne 边缘节点（境外）转发至 Google API

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
const ok = (data = {}, msg = 'success') => jsonRes({ code: 0, message: msg, data });
const err = (msg, status = 400) => jsonRes({ code: -1, message: msg, data: null }, status);
const opts = () => new Response(null, { status: 204, headers: CORS_HEADERS });

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

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return opts();
  if (request.method !== 'POST') return err('Method not allowed', 405);

  // 验证登录（防止 key 被滥用）
  const kv = (typeof env !== 'undefined' ? env.SSQ_KV : null) || SSQ_KV;
  if (!kv) return err('KV Storage not configured - 请检查 EdgeOne 控制台 KV 绑定', 500);
  const td = await getTokenData(kv, request);
  if (td.error) return err(td.error, 401);

  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON'); }

  const { key, model = 'gemini-2.5-flash', contents, generationConfig } = body;
  if (!key) return err('缺少 Gemini API Key');
  if (!contents || !Array.isArray(contents)) return err('缺少 contents');

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

  const payload = { contents };
  if (generationConfig) payload.generationConfig = generationConfig;

  let googleResp;
  try {
    googleResp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return err(`代理请求失败: ${e.message}`, 502);
  }

  const respBody = await googleResp.text();

  // 透传 Google 返回（保持原始结构，前端按原逻辑解析）
  return new Response(respBody, {
    status: googleResp.status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}
