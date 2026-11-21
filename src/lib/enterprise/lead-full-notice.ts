/**
 * 企业版自动分配「都已满额」「待分配」提醒（A8，2026-10-26；A10 11-01）：铃铛 + 飞书，一次点击（单条或批量）发一条，列出没分出去的线索。
 *
 * - 满额：自动分配因为能接的人都分满了、一条没分出去，告诉市场管理、总管理员去找销售的上级调配额。
 * - 待分配：新建线索选了自动分配、但这条业务线没人可分或业务线是「暂不分配」、定时分配到点分不出去、取消定时……线索留在新线索等人手动分，
 *   提醒能分配的人（P-转-38、X-85）：11-21 起和首页「待分配新线索」那一行同一个口径——谁的那一行数得到这条才发给谁
 *   （按能分的业务线、按他的可见范围；「线索分配」开关关着只有系统管理员，X-79），点进去 /leads?f=await-assign 就看得到。
 *   一批里各人数得到的不一样，就按人分开发，各人只列自己数得到的那几条。定时分配分不出去另给录入人一条（scheduled-assign.ts，P-转-38）。
 *
 * 11-21 起不再往每人的 Setting（entLeadFullNotice:<userId>）存快照、首页和新线索页顶上不再一条一张黄卡：
 * 首页改成一行「待分配新线索 N 条」，条数从库里现数，分走自动少（await-assign-core.ts / await-assign-scope.ts）。
 * 库里已有的老快照不清、不再读
 */
import { 管理员类别们of, type 组织 } from "./org-core";
import { 企业版 } from "./switch";
import { notify } from "./notify";
import { 规则开着 } from "./rules";
import { 挑不到原因, 待分配链接 } from "./await-assign-core";
import { 待分配范围 } from "./await-assign-scope";

export type 提醒原因 = "满额" | "待分配";

/**
 * 满额提醒的收件人：组织里的市场管理、总管理员（只认业务角色，11-01；账号管理员没设业务角色的收不到）。
 * 原因 = 待分配 时多算销售管理：能分配的人们（await-assign.ts）还在用这份粗名单（同号协同、待回复客户）；
 * 「待分配」提醒本身 11-21 起不走这里，按线索算（待分配提醒收件人）
 */
export function 满额提醒收件人(org: 组织, 原因: 提醒原因 = "满额", 只给总管理员 = false): string[] {
  return [...org.成员.keys()].filter((id) => {
    const 类们 = 管理员类别们of(org, id);
    if (只给总管理员) return 类们.has("总管理员");
    // 待分配的线索销售管理也能手动分（11-01 A7），一起提醒
    return 类们.has("市场管理") || 类们.has("总管理员") || (原因 === "待分配" && 类们.has("销售管理"));
  });
}

const 新id = (今: Date) => `${今.getTime().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const 名单of = (线索: readonly string[]) => `${线索.slice(0, 10).join("、")}${线索.length > 10 ? ` 等 ${线索.length} 条` : ""}`;

/** 满额（铃铛 + 飞书）：线索名是这一次点击里因都已满额没分出去的那几条；空的不发，不是企业版不发 */
export async function 发满额提醒(org: 组织, 线索: string[], 谁点的: string): Promise<void> {
  if (!企业版()) return;
  const 收件人 = 满额提醒收件人(org);
  if (!线索.length || !收件人.length) return;
  await notify(收件人, {
    kind: "满额",
    title: `自动分配没分出去：${线索.length} 条线索都已满额`,
    body: `${谁点的} 点的自动分配，能接的人都分满了：${名单of(线索)}。找销售的上级调配额，或者手动分。`,
    link: "/leads",
    key: `full:${新id(new Date())}`,
  });
}

/**
 * 「待分配」提醒发给谁（11-21）：能分配的人里（待分配范围 不为 null：开关开着 = 能分配线索的人，关着 = 系统管理员），
 * 各人首页那一行数得到这批里哪几条（list.ts 待分配看得到的）。回 人 → 项目 id；数不到的不发
 */
export async function 待分配提醒收件人(org: 组织, projectIds: readonly string[]): Promise<Map<string, string[]>> {
  if (!企业版() || !projectIds.length) return new Map();
  const 开着 = await 规则开着("线索分配");
  const 候选: string[] = [];
  for (const id of org.成员.keys()) if (await 待分配范围({ id }, { org, 开着 })) 候选.push(id);
  if (!候选.length) return new Map();
  // 动态引：list.ts → project/db.ts → await-assign.ts → 这里，静态引成环
  const { 待分配看得到的 } = await import("@/lib/project/list");
  return 待分配看得到的(候选, projectIds);
}

/**
 * 新建线索选了自动分配、没分出去（这条业务线没人可分）、批量自动分配挑不到人、定时分配到点分不出去、取消定时：留在新线索待分配，
 * 提醒能分配的人（收件人见 待分配提醒收件人）。一次点击（单条或批量）一人一条；各人只列自己数得到的那几条
 */
export async function 发待分配提醒(org: 组织, 线索: readonly { id: string; 名: string }[], 谁建的: string, 为什么原话: string, 今 = new Date()): Promise<void> {
  if (!企业版() || !线索.length) return;
  const 谁看得到 = await 待分配提醒收件人(org, 线索.map((x) => x.id));
  // 为什么只要原因本身：挑不到人回的那句带着「这条新线索留在原处，可以手动指派」，和后面「线索留在新线索」矛盾（11-21）
  const 为什么 = 为什么原话 ? 挑不到原因(为什么原话) : "";
  const id = 新id(今);
  // 数得到同一批的人合成一次发
  const 组 = new Map<string, string[]>();
  for (const [人, ids] of 谁看得到) {
    const k = [...ids].sort().join("\n");
    组.set(k, [...(组.get(k) ?? []), 人]);
  }
  for (const [k, 人们] of 组) {
    const 这批 = new Set(k.split("\n"));
    const 名们 = 线索.filter((x) => 这批.has(x.id)).map((x) => x.名);
    await notify(人们, {
      kind: "待分配",
      title: `待分配：${名们.length} 条新线索没自动分出去`,
      body: `${名单of(名们)}（${谁建的} 建的）。${为什么 ? `${为什么}。` : ""}线索留在新线索、没有负责人：去新线索手动分。`,
      link: 待分配链接,
      key: `full:${id}`,
    });
  }
}
