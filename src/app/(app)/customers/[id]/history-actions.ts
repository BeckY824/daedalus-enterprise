"use server";

/**
 * 客户详情「历史变更」弹窗取数（11-24，HistoryChanges.tsx）：点开才取，不进页面首屏。
 * 每个动作都先过客户详情同一道（限定层看得到这位客户），项目再过客户详情项目页签同一把尺（history-data.ts 客户页可看项目）；
 * 看不到的项目不回名字也不回变更，只回个数
 */
import { requireUser } from "@/lib/auth";
import { 企业版 } from "@/lib/enterprise/switch";
import { 企业版只用项目 } from "@/lib/enterprise/project-only";
import { 看得到的客户, 客户历史页, 客户页可看项目, 历史项目们, 项目历史页 } from "./history-data";
import { 是历史筛选, type 历史游标 } from "./history-types";

const 不在 = { ok: false as const, error: "这位客户不存在或当前账号无权查看，请刷新确认" };
const 项目不在 = { ok: false as const, error: "这个项目不存在或当前账号无权查看，请刷新确认" };
const 游标坏了 = { ok: false as const, error: "历史变更的页码已失效，请关掉重开" };
const 是id = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 256;
const 游标对 = (b: unknown): b is 历史游标 | undefined | null => b == null || (typeof b === "object" && 是id((b as 历史游标).id)
  && typeof (b as 历史游标).at === "string" && Number.isFinite(new Date((b as 历史游标).at).getTime())
  && new Date((b as 历史游标).at).toISOString() === (b as 历史游标).at);

/** 客户块一页：类型筛选在服务端筛（翻页跟着筛）；第一页带建档一格 */
export async function 读客户历史(customerId: string, 筛: string, before?: 历史游标 | null) {
  const me = await requireUser();
  if (!企业版() || !是id(customerId)) return 不在;
  if (!是历史筛选(筛) || !游标对(before)) return 游标坏了;
  const c = await 看得到的客户(customerId);
  if (!c) return 不在;
  // 同号再次录入挂在我看不到的项目上的不出：可看项目和项目块同一份
  const 可看 = (await 企业版只用项目()) ? (await 客户页可看项目(me, customerId)).map((p) => p.id) : [];
  return { ok: true as const, ...(await 客户历史页(me, c, 筛, 可看, before)) };
}

/** 项目块：看得到的项目一节一节（名字、阶段、条数）+ 看不到的个数；展开 = 顺带取这一个的第一页（当前打开的项目默认展开） */
export async function 读项目历史们(customerId: string, 展开?: string | null) {
  const me = await requireUser();
  if (!企业版() || !是id(customerId)) return 不在;
  if (!(await 看得到的客户(customerId))) return 不在;
  if (!(await 企业版只用项目())) return { ok: true as const, 项目们: [], 看不到: 0, 展开: null };
  const r = await 历史项目们(me, customerId);
  const 开 = 是id(展开) && r.项目们.some((p) => p.id === 展开) ? 展开 : null;
  return { ok: true as const, ...r, 展开: 开 ? { id: 开, ...(await 项目历史页(开)) } : null };
}

/** 一个项目的一页（展开别的项目、往下翻「更早的」）：项目必须在客户页可看项目里 */
export async function 读项目历史(customerId: string, projectId: string, before?: 历史游标 | null) {
  const me = await requireUser();
  if (!企业版() || !是id(customerId)) return 不在;
  if (!是id(projectId)) return 项目不在;
  if (!游标对(before)) return 游标坏了;
  if (!(await 看得到的客户(customerId))) return 不在;
  if (!(await 企业版只用项目())) return 项目不在;
  if (!(await 客户页可看项目(me, customerId)).some((p) => p.id === projectId)) return 项目不在;
  return { ok: true as const, ...(await 项目历史页(projectId, before)) };
}
