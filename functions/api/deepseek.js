// POST /api/deepseek - 代理转发 DeepSeek API 请求（key内置）
// Body: { data: string } data是前端用CompressionStream gzip压缩后base64编码的prompt

const DEEPSEEK_API_KEY = 'sk-c648e93d82474a0880eda01639b1965f';
const DEFAULT_MODEL = 'deepseek-chat';

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
const ok = (data) => jsonRes({ code: 0, message: 'success', data });
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

// base64 → Uint8Array
function b64ToBytes(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return opts();
  if (request.method !== 'POST') return err('Method not allowed', 405);

  let kv = null;
  try { kv = env?.SSQ_KV || null; } catch(e) {}
  try { if (!kv) kv = SSQ_KV; } catch(e) {}
  if (!kv) return err('KV Storage not configured', 500);

  const td = await getTokenData(kv, request);
  if (td.error) return err(td.error, 401);

  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON'); }

  const { data: encodedData, model = DEFAULT_MODEL } = body;
  if (!encodedData) return err('缺少 data');

  // gzip解压
  let prompt;
  try {
    const compressed = b64ToBytes(encodedData);
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(compressed);
    writer.close();
    const chunks = [];
    const reader = ds.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { merged.set(c, offset); offset += c.length; }
    prompt = new TextDecoder().decode(merged);
  } catch(e) {
    return err('data解压失败: ' + e.message);
  }

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

  return ok({ text });
}
