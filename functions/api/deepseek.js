// POST /api/deepseek - 代理转发 DeepSeek API 请求（key内置）
// Body: { promptData: {...} }  — 前端发送结构化数据，服务端拼接prompt（绕过WAF字符限制）
// 兼容旧格式: { contents: [{parts: [{text: string}]}] }

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

// 服务端拼接智能决策页prompt
function buildSsqAnalysisPrompt(d) {
  return `你是顶级彩票量化分析师，精通概率论、行为金融学、博弈论与风险管理。数据驱动、逻辑严谨、结论明确可操作。
[规则] 从1-33选6红球+1蓝球(1-16) | 总组合17,721,088种 | 单注¥2 | 理论RTP≈50% | 开奖周二/四/日
[市场状态] 期号:${d.issueNo} 目标:${d.nextIssue}期 | 奖池:${d.jp} | 销售:${d.sales} | 连续未开1等:${d.streakDepth}期 | 奖池状态:${d.poolStatusLabel} | 10期拥挤度:${d.crowdLabel} 趋势${d.crowdTrend} | 博弈象限:${d.quadrantQ}[${d.quadrantLabel}] ${d.quadrantDesc} | 预算系数:×${d.budgetMult}
[近10期开奖] ${d.recent10}
[近50期统计] 热号Top8:${d.hotReds} | 冷号Bottom8:${d.coldReds} | 热蓝Top5:${d.hotBlue} | 冷蓝Bottom5:${d.coldBlue} | 红球和值均值:${d.avgSum}(理论≈102) | 跨度均值:${d.avgSpan}(理论≈27)
${d.modelSection}
${d.btSection} ${d.histBtSection}
请按以下6个维度输出中文分析报告，每个维度用[序号.标题]开头，内容简洁：
[1.市场博弈环境] 奖池积累程度、拥挤度信号、历史同类规律，100字以内
[2.数据信号解读] 热冷号统计、和值跨度、LSTM概率分布综合，150字以内
[3.回测绩效评估] ROI/RTP趋势、最大回撤、中奖率，综合评级:优/良/一般/差，100字以内
[4.本期操作结论] 参与建议(强烈参与/正常参与/谨慎参与/建议跳过) | 投注模式(胆拖/复式/单式) | 胆码红球2-3个 | 拖码4-8个 | 蓝球1-2个 | 建议投入(参考预算基准¥${d.baseBudget}×象限系数) | 预期命中层级 | 风险提示一句话
[5.资金管理] 单期投入上限 | 回本周期估算(基于RTP和中奖率) | 资金平衡点(累计投入Y元期望回收Z元) | 止损阈值 | 娱乐定位提醒
[6.下期观察指标] 列出3个具体数据阈值(奖池/销售额/拥挤度)
---注意:本报告基于历史统计与模型分析，不构成购彩建议。双色球为随机游戏，长期期望收益为负(RTP≈50%)，请理性娱乐。---`;
}

// 服务端拼接AutoPilot prompt
function buildAutopilotPrompt(d) {
  return `你是顶级彩票量化分析师，精通机器学习模型评估与量化策略研究。分析双色球AutoPilot实验结果，输出专业中文报告。
[实验概况] 数据:${d.dataInfo} | 总组合:${d.doneLen}个(有效${d.doneValid}个) | 超额为正:${d.alphaPos}个(${(d.alphaPos/d.doneLen*100).toFixed(0)}%) | 最佳超额:+${d.bestAlpha}% | 最差:${d.worstAlpha}% | 全体均值:${d.avgAlpha}% | 均ROI:${d.avgROI}% | 均回撤:${d.avgDrawdown}% | 均中奖率:${d.avgWinRate}%
[博弈环境] ${d.gameEnvBlock}
[Top3详情] ${d.top3Summary}
[权益曲线] ${d.curveDesc}
[奖级分布] ${d.levelDesc}
[边际效应] ${d.marginalLines}
[稳定性] ${d.stableGroups}
[模型对比] ${d.modelCompare}
请按以下8个维度输出分析，每个维度用[序号.标题]开头：
[1.参数敏感性] 哪些参数影响最大，给出具体数据，100字以内
[2.最优策略推荐] 推荐最优组合及数据支撑理由，100字以内
[3.XGB vs LSTM对比] 哪种算法表现更好及原因，80字以内；若仅一种则写"本次仅运行单一模型"
[4.策略稳定性] 方差分析，哪个策略最稳定，80字以内
[5.博弈环境研判] 当前奖池水平、拥挤度信号、是否适合参与，80字以内
[6.风险等级] 等级:低/中/高 | 依据:结合回撤、中奖率、奖池环境，60字以内
[7.本期投注建议] 推荐策略(模型/LB/投注模式) | 投注模式+拥挤度原因 | 建议投入(结合奖池水平) | 核心逻辑一句话
[8.警惕信号] 2-3个具体注意事项，结合权益曲线和等级分布
---注意:本报告基于历史回测与模型实验，不构成购彩建议。双色球为随机游戏，长期期望收益为负(RTP≈50%)，请理性娱乐。---`;
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

  const { promptData, contents, model = DEFAULT_MODEL } = body;

  // 服务端拼接prompt（新格式）
  let prompt = '';
  if (promptData) {
    if (promptData.type === 'ssq_analysis') {
      prompt = buildSsqAnalysisPrompt(promptData);
    } else if (promptData.type === 'ssq_autopilot') {
      prompt = buildAutopilotPrompt(promptData);
    } else {
      return err('未知的promptData类型');
    }
  } else if (contents && Array.isArray(contents)) {
    // 兼容旧格式
    prompt = contents?.[0]?.parts?.[0]?.text;
  }

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

  return ok({ text });
}
