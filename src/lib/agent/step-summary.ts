/**
 * 把一轮里调过的工具折成一句人话，写在过程条上：「查了渠道清单，读了 1 位客户的记录」。
 *
 * 独立成文件、不引 tools.ts：这里要在浏览器里跑，tools.ts 带着 prisma。
 * 每个工具一句口语，**新加工具必须来这儿登记**——tests/agent-schemas.test.ts 会对一遍。
 * 2026-09-18 之前这张表是 HomeChat 里的一段 if，只认五个工具；后来加的六个
 * （渠道 / 线索 / 商机 / 跟进记录 / 签约 / 团队）一个都不认，于是明明查了渠道清单、
 * 答对了，过程条上却写「没有读取任何记录」——对用户来说这句话和"它没查就答"是一个意思。
 */
export const 工具口语: Record<string, (次: number, 客户: string) => string> = {
  search_customers: (n) => `搜了 ${n} 次`,
  find_person: (n) => `找了 ${n} 个人`,
  my_recap: () => "回顾了我这一段",
  get_customer: (n, 客户) => `读了 ${n} 位${客户}的记录`,
  query_metric: (n) => `查了 ${n} 个数`,
  get_watchlist: () => "看了盯盘",
  get_my_plans: () => "看了我的计划和待办",
  list_channels: () => "查了渠道清单",
  list_leads: () => "查了线索",
  list_projects: () => "查了项目",
  // 外贸里签约就是订单：说「成交记录」两个模版都对（F.3）
  list_contracts: () => "查了成交记录",
  list_users: () => "查了账号名单",
  search_followups: (n) => `搜了 ${n} 次跟进记录`,
  /*
    通用查询说「按条件查」就够了——**它到底查了什么，写在每一步的 detail 里**
    （lib/agent/query.ts 的 说人话()，形如「在客户里，找 跟进状态 是 意向较高，取 20 条」）。
    这一句是折叠起来时的那行摘要，不该把整条查询再抄一遍。
  */
  query_records: (n) => `按条件查了 ${n} 次`,
  // 建议卡那几个：过程条上另有卡片，这里只说一声
  propose_status_change: () => "拟了一张建议卡",
  propose_followup: () => "拟了一张建议卡",
  propose_plan: () => "拟了一张建议卡",
  propose_lead: () => "拟了一张建议卡",
  propose_customer_update: () => "拟了一张建议卡",
  propose_contract: () => "拟了一张建议卡",
  propose_channel_update: () => "拟了一张建议卡",
  propose_project_node: () => "拟了一张建议卡",
  propose_project_followup: () => "拟了一张建议卡",
  propose_blocker_add: () => "拟了一张建议卡",
  propose_blocker_resolve: () => "拟了一张建议卡",
  propose_payment_add: () => "拟了一张建议卡",
  propose_payment_delete: () => "拟了一张建议卡",
  propose_lead_verify: () => "拟了一张建议卡",
  propose_contact_update: () => "拟了一张建议卡",
  propose_customer_delete: () => "拟了一张建议卡",
};

/** 过程条上的 label 形如 `list_channels({})`，取括号前的工具名 */
const 工具名 = (label: string) => label.split("(")[0];

export function summarizeSteps(steps: { id: string; label: string }[], 客户: string): string {
  const 次数 = new Map<string, number>();
  for (const s of steps) {
    if (!s.id.startsWith("tool")) continue;
    const t = 工具名(s.label);
    次数.set(t, (次数.get(t) ?? 0) + 1);
  }
  const parts: string[] = [];
  const 说过 = new Set<string>();
  for (const [t, n] of 次数) {
    const 说 = 工具口语[t]?.(n, 客户) ?? `调了 ${t}`;
    if (说过.has(说)) continue; // 几张建议卡合成一句
    说过.add(说);
    parts.push(说);
  }
  // 一个工具都没调：0.37.3 起只有闲聊类问题会这样，如实写「没查数据」，别写「没有读取任何记录」
  return parts.join("，") || "没查数据";
}

/**
 * 单步的人话（2026-11-15 状态条）：状态条头部只写「正在做的那一件事」，展开后每行写「做完了什么」。
 * **不写工具名和参数**——那一串只在展开后的灰色小字里出现，给想核对的人看。
 * 和上面那张表一样，新加工具必须来这儿登记（tests/agent-schemas.test.ts 对一遍）。
 * 第二个参数是这家对客户的叫法（学员 / 客户）。
 */
export const 单步口语: Record<string, { 在做: (客户: string) => string; 做完: (客户: string) => string }> = {
  search_customers: { 在做: (c) => `正在搜${c}`, 做完: (c) => `搜了${c}` },
  find_person: { 在做: () => "正在找人", 做完: () => "找了人" },
  my_recap: { 在做: () => "正在回顾你这一段", 做完: () => "回顾了你这一段" },
  get_customer: { 在做: (c) => `正在读${c}的记录`, 做完: (c) => `读了${c}的记录` },
  query_metric: { 在做: () => "正在算数", 做完: () => "查了数" },
  get_watchlist: { 在做: () => "正在看盯盘", 做完: () => "看了盯盘" },
  get_my_plans: { 在做: () => "正在看你的计划和待办", 做完: () => "看了你的计划和待办" },
  list_channels: { 在做: () => "正在查渠道清单", 做完: () => "查了渠道清单" },
  list_leads: { 在做: () => "正在查线索", 做完: () => "查了线索" },
  list_projects: { 在做: () => "正在查项目", 做完: () => "查了项目" },
  list_contracts: { 在做: () => "正在查成交记录", 做完: () => "查了成交记录" },
  list_users: { 在做: () => "正在查账号名单", 做完: () => "查了账号名单" },
  search_followups: { 在做: () => "正在搜跟进记录", 做完: () => "搜了跟进记录" },
  query_records: { 在做: () => "正在按条件查", 做完: () => "按条件查了一次" },
  propose_status_change: { 在做: () => "正在拟改状态的建议", 做完: () => "拟了改状态的建议" },
  propose_followup: { 在做: () => "正在拟一条跟进", 做完: () => "拟了一条跟进" },
  propose_plan: { 在做: () => "正在拟跟进计划", 做完: () => "拟了跟进计划" },
  propose_lead: { 在做: () => "正在拟新线索", 做完: () => "拟了新线索" },
  propose_customer_update: { 在做: (c) => `正在拟改${c}档案的建议`, 做完: (c) => `拟了改${c}档案的建议` },
  propose_contract: { 在做: () => "正在拟成交记录", 做完: () => "拟了成交记录" },
  propose_channel_update: { 在做: () => "正在拟改渠道的建议", 做完: () => "拟了改渠道的建议" },
  propose_project_node: { 在做: () => "正在拟推进项目的建议", 做完: () => "拟了推进项目的建议" },
  propose_project_followup: { 在做: () => "正在拟项目沟通", 做完: () => "拟了项目沟通" },
  propose_blocker_add: { 在做: () => "正在拟卡点", 做完: () => "拟了卡点" },
  propose_blocker_resolve: { 在做: () => "正在拟完成卡点的建议", 做完: () => "拟了完成卡点的建议" },
  propose_payment_add: { 在做: () => "正在拟一笔回款", 做完: () => "拟了一笔回款" },
  propose_payment_delete: { 在做: () => "正在拟删回款的建议", 做完: () => "拟了删回款的建议" },
  propose_lead_verify: { 在做: () => "正在拟线索验证", 做完: () => "拟了线索验证" },
  propose_contact_update: { 在做: () => "正在拟改联系人的建议", 做完: () => "拟了改联系人的建议" },
  propose_customer_delete: { 在做: (c) => `正在拟删${c}的建议`, 做完: (c) => `拟了删${c}的建议` },
};

/** 是不是一次工具调用（run.ts 的 step id 以 tool 开头）；简报那几步（load / think）、回答那步不是 */
export const 是工具步 = (s: { id: string }) => s.id.startsWith("tool");

/**
 * 一步的人话。工具步查表（没登记的说「正在查数据」，不至于露出工具名）；
 * 不是工具的那几步（简报的「读取记录」「生成智能总结」）label 本来就是人话，直接用。
 */
export function 一步人话(s: { id: string; label: string }, 进行中: boolean, 客户: string): string {
  if (!是工具步(s)) return 进行中 ? `正在${s.label}` : s.label;
  const 说 = 单步口语[工具名(s.label)];
  if (!说) return 进行中 ? "正在查数据" : "查了数据";
  return 进行中 ? 说.在做(客户) : 说.做完(客户);
}
