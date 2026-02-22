# SSQ 双色球量化预测平台 — 项目交接文档
**版本：v1.4.0 → 准备开发 v1.5.0**
**文档生成日期：2026-02-22**

---

## 一、当前文件

| 文件 | 说明 |
|------|------|
| `ssq-platform-v1.4.0.html` | 主平台文件，1785KB，单文件纯前端，无需服务器 |
| `SSQ历史开奖号.csv` | 3413期历史数据（2003/2/23 — 2026/2/5） |

**运行方式**：直接用浏览器打开 html 文件即可，需要网络加载 TF.js / Tailwind CDN。

---

## 二、平台架构

### 技术栈
- **React 18**（无JSX，用 `h()` = `createElement`）
- **TensorFlow.js**（浏览器内 LSTM 训练推理）
- **Tailwind CSS**（CDN版，仅核心工具类）
- **内置图表**（自写 BarChart/LineChart，无 Recharts 依赖）
- **ErrorBoundary**（React.Component class，v1.4.0新增，防止白屏）

### 文件结构（单HTML内）
```
<script>
  // 1. 工具函数（comb, splitDataset, buildDataContext等）
  // 2. 内置图表组件（BarChart, LineChart）
  // 3. ML核心（buildModel, prepareTensors, runInference, trainModel）
  // 4. 投注计算（calcPrize, calcCompoundPrize, calcDanTuoPrize, generateBetPlan）
  // 5. 回测统计（calcSurvival, calcAvgGap, calcSurvivalCurve）
  // 6. 各Tab组件（DataViewer → ValidationResult → FeatureLab → ModelLab → BacktestLab → Dashboard → StatLab → DecisionLab）
  // 7. v1.4.0工具函数（calcCrowdingSignal, calcPoolStatus, calcQuadrant, extractDanCodes, generateDecisionPlan）
  // 8. App（顶层路由）
  // 9. ErrorBoundary class定义
  // 10. root.render(h(ErrorBoundary, null, h(App, null)))
</script>
```

---

## 三、Tab 数据传递链路（完整）

```
① 数据总控 (DataViewer)
   输入: CSV文件上传
   产出: data[]（全量，含usage='train'/'test'标记）
         report（字段校验报告）
   App state: data, report, ratio(训练/测试切分比例，默认80%)

② 数据契约 (ValidationResult)
   输入: report
   产出: 无（只读展示）

③ 特征实验 (FeatureLab)
   输入: data（全量）
   产出: 无（69维特征可视化，只读）

④ 模型实验 (ModelLab)
   输入: data, activeModel, setActiveModel
   产出: → App.model（训练好的LSTM权重）
         → App.infResult（当期推理结果：redProbs[33], blueProbs[16], uncertainty, variance）
         → App.stratResult（GA遗传算法三方案）

⑤ 历史回测 (BacktestLab)
   输入: data, externalModel(=App.model)
   产出: → App.btRecs（逐期交易记录数组）
         → App.btSum（汇总：ROI/RTP/winRate/avgJackpot/skipCount/levelCounts/survivalStats...）

⑥ 量化看板 (Dashboard)
   输入: data(train only), btSum, stratResult
   产出: 无（只读，凯利公式/生存曲线/三方案对比）

⑦ 统计检验 (StatLab)
   输入: data（全量）
   产出: 无（卡方/游程/自相关检验，只读）

⑧ 智能决策 (DecisionLab)
   输入: data, activeModel, inferenceResult(=infResult), btSum, btRecs
   产出: 本期投注方案（不写入App state，仅展示）
```

### App State 变量
```javascript
const [tab, setTab]             // 当前激活Tab
const [data, setData]           // 全量数据（带usage标记）
const [report, setReport]       // 数据契约校验报告
const [loading, setLoading]     // CSV加载中
const [ratio, setRatio]         // 训练/测试切分比（默认0.8）
const [model, setModel]         // 训练好的LSTM模型
const [infResult, setInfResult] // 模型推理结果
const [stratResult, setStratResult] // GA策略结果
const [btRecs, setBtRecs]       // 回测逐期记录
const [btSum, setBtSum]         // 回测汇总统计
```

---

## 四、各组件 Props 签名

```javascript
DataViewer({data})
ValidationResult({report})
FeatureLab({data})
ModelLab({data, activeModel, setActiveModel, inferenceResult, setInferenceResult, strategyResult, setStrategyResult})
BacktestLab({data, records, setRecords, summary, setSummary, externalModel, setExternalModel})
Dashboard({data, btSum, stratResult})
StatLab({data})
DecisionLab({data, activeModel, inferenceResult, btSum, btRecs})
```

---

## 五、v1.4.0 核心功能

### 1. 69维特征工程
频率/冷热/奇偶/区间/间隔/连号/和值/跨度/AC值/奖池/销量/拥挤度/博弈信号 等维度

### 2. LSTM + MC Dropout 推理
- 模型结构：LSTM(64) + LayerNorm + Dropout(0.2) + Dense
- MC Dropout：推理时保持Dropout激活，多次采样估计不确定度
- 输出：33个红球概率 + 16个蓝球概率 + uncertainty + variance

### 3. 四象限博弈矩阵
| 象限 | 条件 | 策略 | 预算系数 |
|------|------|------|---------|
| Q1 最佳出击 | 奖池高+冷门 | 胆拖 | 1.5x |
| Q2 谨慎参与 | 奖池高+热门 | 复式 | 0.8x |
| Q3 保守观望 | 奖池低+冷门 | 单式 | 0.5x |
| Q4 建议跳过 | 奖池低+热门 | 跳过 | 0x |

### 4. 投注模式（BacktestLab）
- **单式**：每期1注固定
- **复式**：选N个红球，C(N,6)注覆盖
- **胆拖**：胆码固定+拖码组合，C(拖码数, 6-胆码数)注
- **🎯动态博弈（v1.4.0新增）**：每期根据奖池+拥挤度自动决策

### 5. 动态博弈配置参数（BacktestLab cfg）
```javascript
dynJpThreshold: 3e8,      // 奖池参与门槛（滑块0~20亿）
dynCrowdHot: 0.5,         // 拥挤度热门判断线（滑块10%~90%）
dynHotMode: 'single',     // 热门期策略：single/skip/compound
dynCoolMode: 'dangtuo',   // 冷门期策略：dangtuo/compound/single
dynDanN: 2,               // 动态胆拖胆码数（1/2/3）
dynTuoN: 8,               // 动态胆拖拖码数（6~10）
dynCompoundN: 7,          // 动态复式红球数（6~10）
dynBlueBalls: 1,          // 蓝球数（1/2）
```

---

## 六、v1.4.0 修复记录（本次会话）

| 问题 | 根因 | 修复方式 |
|------|------|---------|
| 智能决策白屏 | `ErrorBoundary`未定义，`root.render`直接崩溃 | 在render前注入`class ErrorBoundary extends React.Component` |
| 动态博弈白屏 | `crowdNorm_preview`在JSX中引用但未定义 | 在`testData=useMemo(...)`后注入`crowdNorm_preview=useMemo(...)` |
| 智能决策显示"正在重建" | 替换时用了残缺的2KB占位版本覆盖了19KB完整组件 | 重新用完整`decision_component.js`替换 |
| 历史回测括号不平衡 | patch时动态博弈配置面板多加了一层`)`闭合 | 精确定位多余括号并删除 |
| 2胆8拖注数错误 | `generateDecisionPlan`里用`comb(6,4)=15`算拖码数导致tuoN=3 | 固定用`comb(tuoReds.length, 6-danN)` |
| 凯利公式永远1注 | 彩票负期望，经典凯利输出不参与 | 改为联动奖池状态，显示参与建议+实测RTP |

### 验证方法（每次修改后必须执行）
```bash
python3 << 'EOF'
html = open('ssq-platform-v1.4.0.html','r').read()
script = html[html.rfind('<script>')+8:html.rfind('</script>')]
script_no_render = script.rsplit('class ErrorBoundary',1)[0]

import subprocess, tempfile, os
test_js = """
const window=globalThis; const document={getElementById:()=>null};
let _si=0; const _st={};
const React={createElement:(...a)=>null,useState:(init)=>{const k=_si++;if(!(k in _st))_st[k]=typeof init==='function'?init():init;return[_st[k],(v)=>{_st[k]=typeof v==='function'?v(_st[k]):v;}]},useMemo:(fn)=>{try{return fn()}catch(e){return null}},useCallback:(fn)=>fn,useRef:(init)=>({current:init}),useEffect:()=>{},Component:class{constructor(p){this.props=p;this.state={}}setState(s){}}};
const ReactDOM={createRoot:()=>({render:()=>{}})};
const tf={setBackend:()=>{},ready:()=>Promise.resolve(),getBackend:()=>'cpu',nextFrame:()=>Promise.resolve(),layers:{lstm:()=>({}),dense:()=>({}),dropout:()=>({}),batchNormalization:()=>({})},input:()=>({}),model:()=>({compile:()=>{},fit:()=>Promise.resolve({history:{loss:[]}}),predict:()=>({data:()=>Promise.resolve(new Float32Array(50))}),dispose:()=>{}}),tensor3d:()=>({dispose:()=>{},data:()=>Promise.resolve(new Float32Array(50))}),tidy:(fn)=>{try{return fn()}catch(e){return null}}};
""" + script_no_render + """
const T=[
  ['DecisionLab',()=>DecisionLab({data:[],activeModel:null,inferenceResult:null,btSum:null,btRecs:[]})],
  ['BacktestLab',()=>BacktestLab({data:[],records:[],setRecords:()=>{},summary:null,setSummary:()=>{},externalModel:null,setExternalModel:()=>{}})],
];
for(const[n,f]of T){try{_si=0;f();console.log('✅ '+n)}catch(e){console.log('❌ '+n+': '+e.message);e.stack.split('\\n').slice(1,4).forEach(l=>console.log(l))}}
"""
with tempfile.NamedTemporaryFile(mode='w',suffix='.js',delete=False) as f:
    f.write(test_js); tmp=f.name
r=subprocess.run(['node',tmp],capture_output=True,text=True,timeout=20)
os.unlink(tmp)
print(r.stdout)
EOF
```

---

## 七、已知注意事项

1. **括号平衡**：每次修改JSX后，用以下代码检查所有组件括号差为0：
   ```python
   for comp in ['BacktestLab','DecisionLab','ModelLab','StatLab','App']:
       s=html.find(f'function {comp}(')
       e=html.find('\nfunction ',s+100)
       seg=html[s:e]
       diff=seg.count('(')-seg.count(')')
       print(f"{comp}: 差{diff} {'✅' if diff==0 else '❌'}")
   ```

2. **模板字符串**：JS代码里反引号（`` ` ``）在Python字符串中要小心处理，建议用文件读写而非字符串替换

3. **useMemo vs React.useMemo**：script顶部解构了 `const {useState,useMemo,...}=React`，代码里统一用 `useMemo`，不用 `React.useMemo`

4. **动态博弈按钮UI**：投注模式按钮是数组`[{m,label,desc}]`渲染，新增模式要加到数组里，不是改 `<option>`

5. **ErrorBoundary位置**：必须在 `root.render` **之前**定义，在 `tf.setBackend()` **之前**注入

---

## 八、v1.5.0 开发计划（待实施）

### 目标：XGBoost 对照实验
在现有 LSTM 回测基础上，新增 XGBoost 模型作为对照组，在同一测试集上对比两种模型的预测质量。

### 核心设计

**1. 模型选择**
- 方案A：浏览器内用 JS 实现轻量 GBM（约200行，梯度提升决策树）
- 方案B：用 TF.js Decision Forest（如有支持）
- **推荐方案A**：自实现，不增加外部依赖，可控

**2. 特征输入**
与 LSTM 相同的69维特征，但 XGBoost 用扁平化的单期特征向量（不需要时序窗口）
- LSTM：lookBack期时序窗口 → shape [1, lookBack, 69]
- XGBoost：当前期单点特征 → shape [1, 69]

**3. 输出对比维度**
- 红球命中率（预测Top-6 vs 实际）
- 蓝球命中率
- 各等级奖中奖次数
- 实际ROI对比
- 预测概率分布相关性（Pearson r）

**4. UI位置**
在 ModelLab 内新增 "XGBoost对照" 子Tab，或在 BacktestLab 增加模型选择（LSTM / XGBoost / 集成）

**5. 实现步骤**
```
Step1: 实现 trainXGBoost(features, labels) → model
Step2: 实现 predictXGBoost(model, features) → probs[33]
Step3: BacktestLab 增加 modelType: 'lstm' | 'xgboost' | 'ensemble' 配置
Step4: 回测结果新增对照列（LSTM vs XGBoost vs 随机基准）
Step5: 量化看板增加模型对比图表
```

### 开发注意事项
- XGBoost 训练目标：每个红球号码独立建一棵树（33棵），预测该号码出现概率
- 避免标签泄露：用与 LSTM 相同的 trainCtx 归一化上下文
- 内存控制：浏览器内33棵树，每棵深度限制在4~6层

---

## 九、新对话开启方式

**上传文件**：
1. `ssq-platform-v1.4.0.html`（当前平台）
2. 本文档 `SSQ平台交接文档_v1.4.0.md`

**开场语**：
> 我在开发一个双色球量化预测平台，交接文档和当前代码都在附件里。请先读交接文档了解项目背景，然后开始实现 v1.5.0 的 XGBoost 对照实验功能。

---

*文档结束 — 祝开发顺利*
