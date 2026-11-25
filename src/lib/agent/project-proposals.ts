/**
 * 首页 AI 的项目类建议卡（全页面 AI 写入，企业版只用项目时才给）：推进节点 / 定结局、记沟通（带下一步、可带卡点）、
 * 卡点我已完成、记 / 删回款、线索验证、改联系人、删客户。
 *
 * 和 proposals.ts 同一个分寸：AI 只出卡，人确认后才走原有的 server action（权限、字段权限、团队范围、操作记录都在那里面）。
 * 这里只放纯校验：不合法当场拒（让模型重说），还没填的照样出卡、由 项目卡缺 拦住确认。生成时和落库时各跑一遍。
 *
 * 目标（项目 / 回款 / 卡点 / 联系人 / 客户）按 id 记在 targetId；工具按名字找，找到不止一个时不猜，
 * 把几个都放进 候选，人在卡上挑一个（挑了把 候选.补 合进卡里，比如那个项目算好的「到哪」）。
 */
import { FOLLOW_TYPES, FOLLOW_TYPE_MAP } from "../constants";
import { 是币种 } from "../currency";
import { 认金额, 金额字带币, 币种对不上话 } from "../money-input";
import { parseDateInput } from "@/lib/date-input";
import { hasVisibleText } from "@/lib/form-validation";
import { 阶段们, 是阶段, 本套名, 结局叫法, 字典of, 终止结局, 下一步, 要写原因, 原因上限, type 位置, type 阶段字典 } from "../project/nodes";
import { 后售培育名 } from "../project/stage-dict";
import { 卡点类型们, 影响等级们, 描述上限, 原因最多, 清原因们 } from "../project/blocker-rules";
import { 性别们, 爱好上限, 联系人地址上限, 认生日 } from "../enterprise/customer-v2";

export const 项目卡种类 = [
  "project_node", "project_followup", "blocker_resolve", "payment_add", "payment_delete", "lead_verify", "contact_update", "customer_delete",
] as const;
export type 项目卡Kind = (typeof 项目卡种类)[number];

export function 是项目卡(k: unknown): k is 项目卡Kind {
  return typeof k === "string" && (项目卡种类 as readonly string[]).includes(k);
}

/** 按名字找到不止一个：人在卡上挑。补 = 挑了之后合进卡里的几格（那个项目算好的 到 / 步、客户…） */
export type 候选 = { id: string; 名: string; 说明?: string; 补?: Record<string, unknown> };

type 项目Base = {
  id: string;
  customerId: string;
  customerName: string;
  reason: string;
  现值?: Record<string, string>;
  /** 要动的那一条：项目 / 卡点 / 回款 / 联系人 / 客户的 id；空 = 还没挑（候选里挑） */
  targetId: string;
  targetName: string;
  /** 回款、卡点挂在哪个项目（「查看」打开它） */
  projectId?: string;
  候选?: 候选[];
};

/** 线索验证的几步（初判 = 销售初判；其余和 lib/project/lead-verify.ts 待哪步 一样） */
export const 验证步们 = ["初判", "市场复核", "销售终验", "总管理终判", "销售认领"] as const;
export type 验证步 = (typeof 验证步们)[number];
export const 每步能判: Record<验证步, readonly string[]> = {
  初判: ["有效", "无效", "还需培育"],
  市场复核: ["有效", "无效"],
  销售终验: ["接受", "异议"],
  总管理终判: ["有效", "无效"],
  销售认领: ["继续", "退回公海"],
};

/** 联系人卡能改的几格。电话、邮箱、微信不让 AI 改（号码要查重、字段权限会打码，留给联系人页） */
export const 联系人可改 = {
  name: "姓名", position: "职位", remark: "备注", gender: "性别", birthday: "生日", hobby: "爱好", address: "地址",
} as const;
export type 联系人可改字段 = keyof typeof 联系人可改;

export type 项目卡 =
  | (项目Base & {
      kind: "project_node";
      /** 人话里的目标：节点名 / 出口叫法 / 结局 / 「下一步」/「终止」 */
      目标: string;
      /** 线索流失、丢单的原因；异常状态的备注 */
      原因: string;
      异常类别: string;
      异常类别们?: string[];
      /** 工具按项目现在的位置算好的落点；落库时按库里的位置重算一遍，对不上就不写 */
      到?: 位置 | null;
      /** 出卡时项目在哪个阶段（只给卡上那句「进了 X 就退不回 Y」用，落库不看） */
      从阶段?: string;
    })
  | (项目Base & {
      kind: "project_followup";
      type: string;
      content: string;
      下一步: string;
      下一步时间: string;
      要卡点: boolean;
      卡点类型: string;
      影响等级: string;
      /** 阻碍原因（11-19 起选了卡点类型就必填；字典里没有的发出去进「待审核」）。标题、卡点描述不再要 */
      阻碍原因: string[];
      /** 卡上阻碍原因下拉的选项：设置里启用的原因（工具出卡时带上），也能现打 */
      原因可选们?: string[];
      /** 11-19 前出的旧卡才有：确认时接在沟通内容后面（并进沟通内容），不悄悄丢 */
      卡点描述?: string;
      /** 开了超时回收、项目在线索 / 商机：下一步时间必填 */
      要时间?: boolean;
      /** 确认人是项目组员、不是能管项目的人（11-19 客户答复）：卡上不摆下一步、不要求，落库也不写项目的下一步 */
      组员记?: boolean;
      /** 售后回访（11-25，E-283）：候选是交付结清的项目——卡上锁着「售后回访」标、不摆下一步，确认时 记项目沟通Action 带 售后回访: true */
      售后回访?: boolean;
    })
  /** 最后一个 = false：确认人不是最后一个完成的（还有别人没点完成），方案 / 结果不必填，result 记成自己的处理说明。
      缺省 = 按「最后一个」算（必填），落库时 完成卡点 再按当时的人数兜一次 */
  | (项目Base & { kind: "blocker_resolve"; solution: string; result: string; 最后一个?: boolean })
  | (项目Base & { kind: "payment_add"; paidAt: string; currency: string; amount: number })
  | (项目Base & { kind: "payment_delete" })
  | (项目Base & { kind: "lead_verify"; 步: 验证步 | ""; 判: string; 说明: string; 无效原因: string; 无效原因们?: string[]; 下一步时间: string; 计划内容: string })
  | (项目Base & { kind: "contact_update"; 改: { field: 联系人可改字段; value: string }[] })
  | (项目Base & { kind: "customer_delete" });

export type 项目卡结果 = { ok: true; proposal: 项目卡 } | { ok: false; error: string };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v).slice(0, max) : "");
/**
 * 旧卡点的「卡点描述」（11-19 起界面不再有这一格）并进沟通内容：沟通内容里已经有这段就不重复，没有就接在后面。
 * 收卡（模型还传了这个参数）和落库（老对话里的旧卡）都走它
 */
export function 并进描述(content: string, 描述: string | null | undefined): string {
  const d = (描述 ?? "").trim();
  if (!d || content.includes(d)) return content;
  return content.trim() ? `${content}\n卡点：${d}` : d;
}

/** 阻碍原因：一个字符串或一串；去零宽字符和空白、去重、每个限长、限个数（blocker-rules.ts 清原因们，超长的截断不报错——卡上人还能改） */
function 收原因(v: unknown): string[] {
  const 原 = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[、,，;；]/) : [];
  return 清原因们(原).slice(0, 原因最多);
}
const 名单 = (v: unknown, max = 50) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim().slice(0, 60)).slice(0, max) : undefined);

/** 日子：给了就必须认得（YYYY-MM-DD，年月日写法也收）；没给 = "" */
function 收日子(v: unknown): string | null {
  const s = str(v, 40);
  if (!s) return "";
  const n = s.replace(/\//g, "-").replace(/[年月]/g, "-").replace(/日/g, "").trim();
  if (!parseDateInput(n)) return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(n);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
}

/** 模型交的字串用 认金额 认（和金额框、导入同一个：「3万」「3w」都认，「约5万」拒） */
function 收金额(v: unknown): number | null {
  if (v === undefined || v === null || String(v).trim() === "") return 0;
  const n = typeof v === "number" ? v : 认金额(String(v));
  if (n === null || !Number.isFinite(n) || n < 0 || n > 1e12) return null;
  return Math.round(n * 100) / 100;
}

function 收跟进类型(v: unknown): string | null {
  const s = str(v, 20);
  if (!s) return "PHONE";
  const t = FOLLOW_TYPE_MAP[s] ? s : FOLLOW_TYPES.find((x) => x.label === s)?.value ?? null;
  // 待办、提醒不是沟通（lib/project/wizard.ts 规整沟通 同样拦）
  return t && t !== "TASK" && t !== "REMIND" ? t : null;
}

function 收位置(v: unknown): 位置 | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const phase = str(o.phase, 10), node = str(o.node, 20), result = str(o.result, 10);
  return phase && node ? { phase, node, ...(result ? { result } : {}) } : null;
}

function 收候选(v: unknown): 候选[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const 们 = v.slice(0, 10).flatMap((x) => {
    if (!x || typeof x !== "object") return [];
    const o = x as Record<string, unknown>;
    const id = str(o.id, 60), 名 = str(o.名, 80);
    if (!id || !名) return [];
    return [{ id, 名, ...(str(o.说明, 120) ? { 说明: str(o.说明, 120) } : {}), ...(o.补 && typeof o.补 === "object" && !Array.isArray(o.补) ? { 补: o.补 as Record<string, unknown> } : {}) }];
  });
  return 们.length ? 们 : undefined;
}

/**
 * 把卡收一遍（模型给的、人改过的都一样不可信）。base = proposals.ts buildProposal 收好的 id / 客户 / 理由
 */
export function buildProjectProposal(
  base: { id: string; customerId: string; customerName: string; reason: string },
  kind: 项目卡Kind,
  args: Record<string, unknown>,
  b?: { currency?: string },
): 项目卡结果 {
  const 候 = 收候选(args.候选);
  const 共 = {
    ...base,
    targetId: str(args.targetId, 60),
    targetName: str(args.targetName, 80),
    ...(str(args.projectId, 60) ? { projectId: str(args.projectId, 60) } : {}),
    ...(候 ? { 候选: 候 } : {}),
  };

  if (kind === "project_node") {
    const 到 = 收位置(args.到);
    const 们 = 名单(args.异常类别们);
    const 从阶段 = str(args.从阶段, 10);
    return {
      ok: true,
      proposal: { ...共, kind, 目标: str(args.目标, 20), 原因: str(args.原因, 原因上限), 异常类别: str(args.异常类别, 30), ...(们 ? { 异常类别们: 们 } : {}), ...(到 ? { 到 } : {}), ...(从阶段 ? { 从阶段 } : {}) },
    };
  }

  if (kind === "project_followup") {
    const type = 收跟进类型(args.type);
    if (!type) return { ok: false, error: `沟通方式不认得（可选：${FOLLOW_TYPES.filter((t) => t.value !== "TASK" && t.value !== "REMIND").map((t) => t.label).join(" / ")}）` };
    const 时间 = 收日子(args.下一步时间);
    if (时间 === null) return { ok: false, error: "下一步时间看不懂，写成 YYYY-MM-DD" };
    const 卡点类型 = str(args.卡点类型, 10);
    if (卡点类型 && !(卡点类型们 as readonly string[]).includes(卡点类型)) return { ok: false, error: `卡点类型只能是 ${卡点类型们.join(" / ")}` };
    const 影响等级 = str(args.影响等级, 10);
    if (影响等级 && !(影响等级们 as readonly string[]).includes(影响等级)) return { ok: false, error: `影响等级只能是 ${影响等级们.join(" / ")}` };
    const 可选 = 名单(args.原因可选们, 200);
    return {
      ok: true,
      proposal: {
        ...共, kind, type, content: 并进描述(str(args.content, 2000), str(args.卡点描述, 描述上限)), 下一步: str(args.下一步, 100), 下一步时间: 时间,
        要卡点: args.要卡点 === true, 卡点类型, 影响等级, 阻碍原因: 收原因(args.阻碍原因),
        ...(可选 ? { 原因可选们: 可选 } : {}),
        ...(args.要时间 === true ? { 要时间: true } : {}),
        ...(args.组员记 === true ? { 组员记: true } : {}),
        ...(args.售后回访 === true ? { 售后回访: true } : {}),
      },
    };
  }

  if (kind === "blocker_resolve") return { ok: true, proposal: { ...共, kind, solution: str(args.solution, 描述上限), result: str(args.result, 描述上限), ...(args.最后一个 === false ? { 最后一个: false } : {}) } };

  if (kind === "payment_add") {
    const paidAt = 收日子(args.paidAt);
    if (paidAt === null) return { ok: false, error: "回款时间看不懂，写成 YYYY-MM-DD" };
    const amount = 收金额(args.amount);
    if (amount === null) return { ok: false, error: "金额要是不小于 0 的数字" };
    const 字币 = 金额字带币(args.amount);
    const c = str(args.currency, 10).toUpperCase();
    // currency 没给：金额里写了记号就按记号，没写才按本位币；写了又和 currency 对不上就拒（审查 11-20）。
    // 记号也能算本位币（港币本位交「$5000」、日元本位交「¥50万」）就按本位币，不把「$」一律当美元（审查 11-20 第二轮）
    const 本位 = b?.currency ?? "CNY";
    const currency = c || (字币 ? (字币.可为.includes(本位) ? 本位 : 字币.币) : 本位);
    if (!是币种(currency)) return { ok: false, error: `不认得币种「${c}」` };
    if (字币 && !字币.可为.includes(currency)) return { ok: false, error: 币种对不上话(String(args.amount).trim(), 字币.币, currency) };
    return { ok: true, proposal: { ...共, kind, paidAt, currency, amount } };
  }

  if (kind === "payment_delete" || kind === "customer_delete") return { ok: true, proposal: { ...共, kind } };

  if (kind === "lead_verify") {
    const 步 = str(args.步, 10);
    if (步 && !(验证步们 as readonly string[]).includes(步)) return { ok: false, error: `没有「${步}」这一步` };
    const 判 = str(args.判, 10);
    if (判 && 步 && !每步能判[步 as 验证步].includes(判)) return { ok: false, error: `${步}只能判 ${每步能判[步 as 验证步].join(" / ")}` };
    const 时间 = 收日子(args.下一步时间);
    if (时间 === null) return { ok: false, error: "下一步时间看不懂，写成 YYYY-MM-DD" };
    const 们 = 名单(args.无效原因们);
    return {
      ok: true,
      proposal: {
        ...共, kind, 步: 步 as 验证步 | "", 判, 说明: str(args.说明, 原因上限), 无效原因: str(args.无效原因, 100), ...(们 ? { 无效原因们: 们 } : {}),
        下一步时间: 时间, 计划内容: str(args.计划内容, 原因上限),
      },
    };
  }

  // contact_update
  const 原 = Array.isArray(args.改) ? args.改 : [];
  if (!原.length) return { ok: false, error: `改 不能为空：要改哪几格（${Object.values(联系人可改).join("、")}）` };
  const 改: { field: 联系人可改字段; value: string }[] = [];
  for (const x of 原.slice(0, 10)) {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const f = str(o.field, 20);
    const field = (f in 联系人可改 ? f : (Object.keys(联系人可改) as 联系人可改字段[]).find((k) => 联系人可改[k] === f)) as 联系人可改字段 | undefined;
    if (!field) return { ok: false, error: `联系人只能改 ${Object.values(联系人可改).join("、")}；电话、邮箱、微信请到联系人页改` };
    const value = str(o.value, 200);
    if (field === "gender" && value && !(性别们 as readonly string[]).includes(value)) return { ok: false, error: `性别只能是 ${性别们.join(" / ")}` };
    if (field === "birthday" && value && 认生日(value) === undefined) return { ok: false, error: "生日要写成 YYYY-MM-DD，且是真实的日子" };
    if (field === "hobby" && value.length > 爱好上限) return { ok: false, error: `爱好最多 ${爱好上限} 个字` };
    if (field === "address" && value.length > 联系人地址上限) return { ok: false, error: `地址最多 ${联系人地址上限} 个字` };
    if (改.some((c) => c.field === field)) continue;
    改.push({ field, value });
  }
  return { ok: true, proposal: { ...共, kind, 改 } };
}

/** 还差哪几样（空 = 能确认）。卡片拿它禁确认，落库那一步再兜一次 */
export function 项目卡缺(p: 项目卡): string[] {
  const miss: string[] = [];
  if (!p.targetId) miss.push("选哪一个");
  if (p.kind === "project_node") {
    if (!p.目标 || !p.到) miss.push("去哪一步");
    if (p.到 && 要写原因(p.到.result) && !p.原因.trim()) miss.push("原因");
    if (p.到?.result === "异常状态" && !p.异常类别) miss.push("异常类别");
  }
  if (p.kind === "project_followup") {
    // 只有空白 / 零宽字符的同空（同 记沟通卡 add_followup、框上「请填写沟通内容」的 hasVisibleText，11-26）
    if (!hasVisibleText(并进描述(p.content, p.卡点描述))) miss.push("沟通内容");
    if (!p.组员记 && !p.售后回访 && !p.下一步.trim()) miss.push("下一步计划");
    if (!p.组员记 && !p.售后回访 && p.要时间 && !p.下一步时间) miss.push("下一步时间");
    if (p.要卡点 && (!p.卡点类型 || p.卡点类型 === "暂无卡点")) miss.push("卡点类型");
    // 11-19：选了卡点类型，阻碍原因必填（落库时 规整发布 再兜一次）；老对话里的卡没有这一格，同样要人补
    if (p.要卡点 && !清原因们(p.阻碍原因 ?? []).length) miss.push("阻碍原因");
  }
  // 方案 / 结果只有最后一个完成的人必填（11-01 定稿）；其余人点完成只留处理说明，可空
  if (p.kind === "blocker_resolve" && p.最后一个 !== false) {
    if (!p.solution) miss.push("解决方案");
    if (!p.result) miss.push("解决结果");
  }
  if (p.kind === "payment_add") {
    if (!p.paidAt) miss.push("回款时间");
    if (!(p.amount > 0)) miss.push("金额");
  }
  if (p.kind === "lead_verify") {
    if (!p.步) miss.push("验证到哪一步");
    if (!p.判) miss.push("判定");
    if (p.步 === "初判" && p.判 === "无效" && !p.无效原因) miss.push("无效原因");
    if (p.判 === "还需培育") {
      if (!p.下一步时间) miss.push("下一步时间");
      if (!p.计划内容) miss.push("计划内容");
    }
    if (p.判 === "异议" && !p.说明) miss.push("说明");
  }
  if (p.kind === "contact_update" && p.改.some((c) => c.field === "name" && !c.value)) miss.push("姓名");
  return miss;
}

/** 确认之后撤不回来的（「此操作不可撤销」）：只有新记的回款能按 id 删回去 */
export function 不可撤销(kind: 项目卡Kind): boolean {
  return kind !== "payment_add";
}

const 名 = (p: 项目卡) => p.targetName || (p.候选?.length ? `（${p.候选.length} 个同名，待选）` : "…");

/**
 * 推节点卡往后跨阶段（线索→商机、商机→订单）时卡上那句提醒：企业版跨了阶段退不回去（nodes.ts 改节点问题）。
 * 同阶段、往回、定结局、还没挑项目（没落点）都不写
 */
export function 跨阶段提醒(p: 项目卡): string | null {
  if (p.kind !== "project_node" || !p.到 || p.到.result || !p.从阶段) return null;
  const 从 = p.从阶段, 到 = p.到.phase;
  if (!是阶段(从) || !是阶段(到) || 阶段们.indexOf(到) <= 阶段们.indexOf(从)) return null;
  return `进了${到}就退不回${从}`;
}

/** 卡片抬头 / 操作记录那句话。删除类一定带「删除」和名字 */
export function 描述项目卡(p: 项目卡): string {
  switch (p.kind) {
    case "project_node": {
      const r = p.到?.result;
      if (r) return `项目「${名(p)}」${p.目标 === "终止" ? "终止进程，" : ""}定结局「${结局叫法(r, 字典of(true))}」`;
      return `把项目「${名(p)}」推到 ${p.到 ? `${p.到.phase}·${p.到.node}` : p.目标 || "…"}`;
    }
    case "project_followup":
      return `在项目「${名(p)}」上记一条${FOLLOW_TYPE_MAP[p.type]?.label ?? "沟通"}${p.要卡点 ? `，并发布${p.卡点类型 || "卡点"}` : ""}`;
    case "blocker_resolve": return `卡点「${名(p)}」我已完成`;
    case "payment_add": return `给项目「${名(p)}」记一笔回款${p.amount ? ` ${p.currency} ${p.amount}` : ""}`;
    case "payment_delete": return `删除项目回款「${名(p)}」`;
    case "lead_verify": return `线索「${名(p)}」${p.步 || "验证"}：${p.判 || "…"}`;
    case "contact_update": return `改联系人「${名(p)}」的${p.改.map((c) => 联系人可改[c.field]).join("、")}`;
    case "customer_delete": return `删除客户「${名(p)}」`;
  }
}

/**
 * 「去哪一步」认成落点（纯函数，工具出卡和落库各算一遍）：
 *   节点名（新旧名都认）→ 那个节点；「下一步 / 推进」→ 往前一步；「终止」→ 这一阶段没走成的结局；
 *   出口叫法 / 结局名 → 这一阶段的那个出口（走成且不是结局的 = 进下一阶段第一个节点）。
 * 前后能不能这么走（跳步、跨阶段回退、交付还差几项）不在这里判，交给 改项目节点 / 终止项目进程 原样说
 */
export function 认目标(目标: string, 当前: 位置, 字典: 阶段字典): { ok: true; 到: 位置; 终止?: true } | { ok: false; error: string } {
  const s = (目标 ?? "").trim();
  if (!s) return { ok: false, error: "要推到哪一步？" };
  if (!是阶段(当前.phase)) return { ok: false, error: "认不出这个项目现在在哪个阶段" };
  const 阶 = 当前.phase;
  if (s === "终止" || s === "终止进程") {
    const r = 终止结局(当前, 字典);
    if (!r) return { ok: false, error: "这个项目已经有结局了，不能再终止" };
    return { ok: true, 到: { phase: 阶, node: 本套名(当前.node, 字典), result: r }, 终止: true };
  }
  if (["下一步", "推进", "往前推", "推到下一步", "下一个"].includes(s)) {
    const n = 下一步(当前, 字典);
    if (!n) return { ok: false, error: 当前.result ? "这个项目已经有结局了，先恢复再推" : "已经是最后一个进程了，只剩定结局" };
    return { ok: true, 到: n };
  }
  // 后售培育只是潜客培育的显示名（after-sale.ts）：「退回后售培育」= 退回潜客培育
  const 新 = 本套名(s === 后售培育名 ? "潜客培育" : s, 字典);
  for (const ph of 阶段们) {
    if (字典.节点们[ph].includes(新)) return { ok: true, 到: { phase: ph, node: 新 } };
  }
  for (const ph of 阶段们) {
    for (const o of 字典.出口们[ph]) {
      if (o.叫法 !== s && o.结局 !== 新) continue;
      if (ph !== 阶) return { ok: false, error: `「${o.叫法}」只能在${ph}阶段点，项目现在在${阶}阶段` };
      if (当前.result) return { ok: false, error: "这个项目已经有结局了，先恢复再改" };
      if (!o.结局) {
        const 下阶段 = 阶段们[阶段们.indexOf(ph) + 1];
        return 下阶段 ? { ok: true, 到: { phase: 下阶段, node: 字典.节点们[下阶段][0] } } : { ok: false, error: "没有下一阶段了" };
      }
      return { ok: true, 到: { phase: 阶, node: 本套名(当前.node, 字典), result: o.结局 } };
    }
  }
  const 说 = 阶段们.map((ph) => `${ph}：${[...字典.节点们[ph], ...字典.出口们[ph].map((o) => o.叫法)].join(" / ")}`).join("；");
  return { ok: false, error: `认不出「${s}」。可以说进程名或出口（${说}），或「下一步」「终止」` };
}

/** 两个落点是不是同一个（落库时拿库里位置重算的 和 卡上的 比） */
export function 同一落点(a: 位置 | null | undefined, b: 位置 | null | undefined): boolean {
  return !!a && !!b && a.phase === b.phase && a.node === b.node && (a.result ?? null) === (b.result ?? null);
}
