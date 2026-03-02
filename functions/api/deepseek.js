// POST /api/deepseek - 代理转发 DeepSeek API 请求（key内置，用户无需配置）
// Body: { prompt: string, model?: string }

const DEEPSEEK_API_KEY = 'sk-c648e93d82474a0880eda01639b1965f';
const DEFAULT_MODEL = 'deepseek-chat'; // DeepSeek V3，速度快价格低

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
const err = (msg, status = 400) => jsonRes({ code: -1, message: msg, data: null }, status);
const opts = () => new Response(null, { status: 204, headers: CORS_HEADERS });

async function getTokenData(kv, request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return { error: '未携带 Authorization Token，请重新登录' };
  const raw = await kv.get(`token:${token}`);
  if (!raw) return { error: 'Token 在服务器不存在，请重新登录' };
  let td;
  try { td = JSON.parse(raw); } catch { return { error: 'Token 数据损坏，请重新登录' }; }
  if (Date.now() > td.expires) { await kv.delete(`token:${token}`); return { error: 'Token 已过期，请重新登录' }; }
  return td;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return opts();
  if (request.method !== 'POST') return err('Method not allowed', 405);

  // 验证登录
  const kv = (typeof env !== 'undefined' ? env.SSQ_KV : null) || SSQ_KV;
  if (!kv) return err('KV Storage not configured', 500);
  const td = await getTokenData(kv, request);
  if (td.error) return err(td.error, 401);

  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON'); }

  const { prompt, model = DEFAULT_MODEL } = body;
  if (!prompt) return err('缺少 prompt');

  let dsResp;
  try {
    dsResp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 8192,
        temperature: 0.6,
      }),
    });
  } catch (e) {
    return err(`代理请求失败: ${e.message}`, 502);
  }

  const respBody = await dsResp.text();
  let parsed;
  try { parsed = JSON.parse(respBody); } catch { return err('DeepSeek返回解析失败', 502); }

  if (!dsResp.ok) {
    return err(parsed?.error?.message || 'DeepSeek API错误', dsResp.status);
  }

  const text = parsed?.choices?.[0]?.message?.content || '';
  if (!text) return err('DeepSeek返回内容为空', 502);

  return jsonRes({ code: 0, message: 'success', data: { text } });
}
