# 第二阶段部署指南 - Edge Functions + KV Storage

## 文件结构说明

```
functions/                          ← 上传到 GitHub 仓库根目录
├── _routes.json                    ← 路由规则：/api/* 走 Functions
├── _utils.js                       ← 共享工具库（加密、KV、Token）
└── api/
    ├── auth/
    │   ├── login.js                POST /api/auth/login
    │   ├── register.js             POST /api/auth/register
    │   └── logout.js               POST /api/auth/logout
    ├── user/
    │   └── [[path]].js             GET/POST /api/user/profile, /api/user/password
    ├── admin/
    │   └── [[path]].js             GET/POST /api/admin/users, /stats, /logs
    └── log.js                      POST /api/log
```

## 部署步骤

### Step 1：在 EdgeOne 控制台创建 KV 命名空间

1. 进入 EdgeOne 控制台 → 你的项目 → **KV Storage**
2. 点击 **创建命名空间**
3. 命名为 `SSQ_KV`（名字随意，但后面绑定时要一致）
4. 记录命名空间 ID

### Step 2：绑定 KV 到项目

1. 进入项目 → **Project Settings** → **Environment Variables**（或 Functions 配置）
2. 找到 KV Bindings（KV 绑定）
3. 添加绑定：
   - Variable Name（变量名）：`SSQ_KV`
   - KV Namespace：选择刚才创建的 `SSQ_KV`
4. 保存

### Step 3：上传 functions 文件夹到 GitHub

将解压出来的 `functions/` 文件夹放入 GitHub 仓库根目录：

```
你的仓库/
├── public/                ← 原有静态文件
│   ├── index.html
│   ├── _headers
│   └── _redirects
├── functions/             ← 新增！
│   ├── _routes.json
│   ├── _utils.js
│   └── api/...
├── package.json
└── edgeone.json
```

### Step 4：Push 到 GitHub，等待自动部署

```bash
git add functions/
git commit -m "feat: Add Phase 2 Edge Functions API"
git push
```

EdgeOne 会自动检测到 `functions/` 目录并部署为 Edge Functions。

---

## API 文档

### 登录
```
POST /api/auth/login
Content-Type: application/json

{ "username": "admin", "password": "admin123456" }

响应：
{ "code": 0, "data": { "token": "xxx", "user": { "username", "role", "nickname" } } }
```

### 注册
```
POST /api/auth/register
{ "username": "newuser", "password": "pass123", "nickname": "昵称" }
```

### 获取用户信息
```
GET /api/user/profile
Authorization: Bearer {token}
```

### 修改密码
```
POST /api/user/password
Authorization: Bearer {token}
{ "old_password": "xxx", "new_password": "yyy" }
```

### 管理员：用户列表
```
GET /api/admin/users
Authorization: Bearer {superadmin_token}
```

### 管理员：修改用户
```
POST /api/admin/users/update
Authorization: Bearer {superadmin_token}
{ "username": "user1", "role": "professional", "status": "active" }
```

### 管理员：BI 统计数据
```
GET /api/admin/stats
Authorization: Bearer {superadmin_token}
```

### 记录操作日志
```
POST /api/log
Authorization: Bearer {token}
{ "action": "calculate", "detail": { "mode": "standard" } }
```

---

## 默认账号（首次访问自动初始化）

| 用户名 | 密码 | 角色 |
|--------|------|------|
| admin | admin123456 | superadmin |
| prouser | pro123456 | professional |
| basicuser | basic123456 | basic |

> ⚠️ 上线后请立即修改默认密码！

---

## 前端对接说明

前端需要改造的部分（第三阶段工作）：
1. 登录时调用 `/api/auth/login`，把返回的 `token` 存入 `localStorage`
2. 每次请求加上 `Authorization: Bearer {token}` 请求头
3. Token 过期（401）时自动跳转登录页
4. 用户信息从 API 获取，不再硬编码
