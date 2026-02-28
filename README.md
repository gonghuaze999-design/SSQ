# SSQ 双色球大数据分析平台

基于历史公开数据的统计分析工具，仅供研究参考，不构成任何投注建议。

## 项目结构

```
ssq-platform/
├── public/
│   ├── index.html      # 主应用（单文件全功能）
│   ├── _headers        # HTTP 响应头配置
│   └── _redirects      # 路由重定向配置
├── functions/
│   └── api/            # Edge Functions API（第二阶段）
├── edgeone.json        # EdgeOne Pages 构建配置
└── README.md
```

## 部署到 EdgeOne Pages（国际版）

### 第一次部署

1. 访问 [https://edgeone.ai/register](https://edgeone.ai/register) 注册账号（支持 Google 登录）
2. 进入控制台 → 左侧菜单 → **Pages** → 立即开通
3. 点击 **绑定 GitHub** → 授权登录 GitHub
4. 选择本仓库 → 配置如下：
   - **构建命令**：留空
   - **输出目录**：`public`
   - **根目录**：留空（默认）
5. 点击 **开始部署**，等待约 30 秒完成
6. 自动获得 `https://xxx.edgeone.app` 访问地址

### 自定义域名（可选）

1. 控制台 → 项目设置 → 自定义域名
2. 添加你的域名，按提示配置 DNS CNAME 记录
3. 平台自动申请并续期 SSL 证书

### 更新部署

每次 `git push` 到 main 分支，EdgeOne Pages 自动触发重新部署。

---

## 版本历史

- **v1.5.7** - 用户管理系统（三级角色）+ 管理后台 + 登录页免责声明
- **v1.5.6** - AutoPilot LSTM 支持
- **v1.5.x** - 历史版本

## 免责声明

本平台仅基于双色球历史公开数据进行大数据统计分析，所有模型与策略均为实验性研究，不构成任何投注建议。彩票具有随机性，历史规律不代表未来走势，请理性参与，量力而行。
