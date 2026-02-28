/**
 * SSQ Platform - Edge Functions 共享工具库
 * 包含：加密、Token管理、KV操作、响应格式化
 */

// ========== 响应工具 ==========

export function jsonResponse(data, status = 200) {
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

export function successResponse(data = {}, message = 'success') {
  return jsonResponse({ code: 0, message, data });
}

export function errorResponse(message, code = 400) {
  return jsonResponse({ code: -1, message, data: null }, code);
}

export function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// ========== 密码哈希 (使用 Web Crypto API) ==========

export async function hashPassword(password) {
  const encoder = new TextEncoder();
  const salt = 'ssq_platform_salt_2024'; // 固定 salt，生产环境建议用随机 salt 存储
  const data = encoder.encode(password + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPassword(password, hash) {
  const computed = await hashPassword(password);
  return computed === hash;
}

// ========== Token 管理 ==========

export function generateToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function createToken(kv, username, role) {
  const token = generateToken();
  const expires = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7天过期
  await kv.put(`token:${token}`, JSON.stringify({ username, role, expires }));
  return { token, expires };
}

export async function verifyToken(kv, token) {
  if (!token) return null;
  const raw = await kv.get(`token:${token}`);
  if (!raw) return null;
  const data = JSON.parse(raw);
  if (Date.now() > data.expires) {
    await kv.delete(`token:${token}`);
    return null;
  }
  return data; // { username, role, expires }
}

export async function deleteToken(kv, token) {
  await kv.delete(`token:${token}`);
}

// ========== Token 从请求头提取 ==========

export function extractToken(request) {
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

// ========== KV 用户操作 ==========

export async function getUser(kv, username) {
  const raw = await kv.get(`user:${username}`);
  if (!raw) return null;
  return JSON.parse(raw);
}

export async function saveUser(kv, username, userData) {
  await kv.put(`user:${username}`, JSON.stringify(userData));
}

export async function listUsers(kv) {
  const result = await kv.list({ prefix: 'user:' });
  const users = [];
  for (const key of result.keys) {
    const raw = await kv.get(key.name);
    if (raw) {
      const user = JSON.parse(raw);
      const username = key.name.replace('user:', '');
      users.push({ username, ...user, password: undefined }); // 不返回密码
    }
  }
  return users;
}

// ========== 操作日志 ==========

export async function writeLog(kv, username, action, detail = {}) {
  const ts = Date.now();
  const logKey = `log:${username}:${ts}`;
  const logData = {
    username,
    action,
    detail,
    timestamp: ts,
    date: new Date(ts).toISOString(),
  };
  await kv.put(logKey, JSON.stringify(logData));

  // 更新每日统计
  const today = new Date().toISOString().slice(0, 10);
  const statsKey = `stats:daily:${today}`;
  const rawStats = await kv.get(statsKey);
  const stats = rawStats ? JSON.parse(rawStats) : { login: 0, calc: 0, total: 0 };
  stats.total += 1;
  if (action === 'login') stats.login += 1;
  if (action === 'calculate') stats.calc += 1;
  await kv.put(statsKey, JSON.stringify(stats));
}

// ========== 权限检查 ==========

export function requireRole(tokenData, ...roles) {
  if (!tokenData) return false;
  return roles.includes(tokenData.role);
}

// ========== 初始化默认用户 (首次部署时调用) ==========

export async function initDefaultUsers(kv) {
  const superadminExists = await kv.get('user:admin');
  if (!superadminExists) {
    const passwordHash = await hashPassword('admin123456');
    await saveUser(kv, 'admin', {
      password: passwordHash,
      role: 'superadmin',
      status: 'active',
      nickname: '超级管理员',
      email: '',
      created_at: Date.now(),
      last_login: null,
    });
    // 创建演示专业用户
    const proHash = await hashPassword('pro123456');
    await saveUser(kv, 'prouser', {
      password: proHash,
      role: 'professional',
      status: 'active',
      nickname: '专业用户',
      email: '',
      created_at: Date.now(),
      last_login: null,
    });
    // 创建演示基础用户
    const basicHash = await hashPassword('basic123456');
    await saveUser(kv, 'basicuser', {
      password: basicHash,
      role: 'basic',
      status: 'active',
      nickname: '基础用户',
      email: '',
      created_at: Date.now(),
      last_login: null,
    });
    return true; // 初始化了
  }
  return false; // 已存在，跳过
}
