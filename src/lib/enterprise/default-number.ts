/**
 * 联系人「主号」（12-15 第三批 B，机制总表 P-合并-05；客户 E-331 行 77「定一个主号」、E-335 行 41、E-337 行 13「主号按现状默认」）。
 * 界面叫「主号」，代码里叫「默认号」：`lib/phone.ts` 的 `主号()` 是「去掉分机后的号码」，两套意思不混在一处。
 *
 *   - 默认号 = 联系人主表的「电话」格（Contact.phone），不新增字段；号码几行（ContactMethod）里同号的那一行就是它，其余另列。
 *   - 设为默认号 = 把选中的那个手机号写进电话格；原来电话格的号照样在号码几行里（不在就补一行），两条都不删。
 *   - 只有「手机」这一类（kind = phone）能当默认号：电话格本来就只认第一个手机（customer-v2.ts 的 老三格）。
 *   - 查重、撞号、导入跳过照旧按全部号码比，不看默认号（M-导入-29）。
 *
 * 纯函数（默认号排前、是默认号）浏览器和服务端都用；设默认号 只用调用方给的 tx（调用方判权限、开事务）。
 */
import type { Prisma } from "@/generated/prisma";
import { 联系人号查重键, 验一行号码, 内置号码种类, 每人最多号码, type 号码种类 } from "./customer-v2";
import { 验号码 } from "./contact-format";
import { 号码归属地 } from "./phone-region";

/** 能当默认号的号码类型（电话格只认手机） */
export const 默认号种类 = "phone";

/** 这一行号码是不是这位联系人的默认号（电话格里那个）：手机一类、规整后同号 */
export function 是默认号(电话格: string | null | undefined, 行: { kind: string; value: string }): boolean {
  if (行.kind !== 默认号种类) return false;
  const 键 = 联系人号查重键(默认号种类, 电话格);
  return !!键 && 联系人号查重键(默认号种类, 行.value) === 键;
}

/**
 * 号码几行里默认号那一行挪到最前（其余照原来的先后）：客户页、编辑框、只读卡拿第一行当默认的地方都跟着默认号走；
 * 编辑框照这个顺序交回来，老三格（第一个手机）算出来还是默认号，存一次不会把默认号换掉
 */
export function 默认号排前<T extends { kind: string; value: string }>(电话格: string | null | undefined, 行们: readonly T[]): T[] {
  const i = 行们.findIndex((x) => 是默认号(电话格, x));
  if (i <= 0) return [...行们];
  return [行们[i], ...行们.slice(0, i), ...行们.slice(i + 1)];
}

export type 设默认号结果 =
  /** 原号满了 = 他号码已经记满（每人最多号码），原主号没补进号码几行，只留在电话格的改动记录里 */
  | { ok: true; 原: string | null; 新: string; 没变: boolean; 补了原号: boolean; 原号满了?: true }
  | { ok: false; error: string };

export const 不是手机话 = "只有手机号能设为主号";
export const 号不在话 = "这个号已经不在这位联系人身上了，刷新看看";

/** 补原号时按哪几类认：先按手机验，不是手机再按座机验（电话格是改版前的老格子，座机、乱填的字都可能有） */
const 补号种类: readonly 号码种类[] = [
  { 名: "手机", kind: 内置号码种类[0].kind, 验: 内置号码种类[0].验 },
  { 名: "座机", kind: 内置号码种类[1].kind },
];

/**
 * 电话格原来的号补进号码几行时那一行长什么样（12-15 第三批 B 审查 1）：
 *   - 按手机过得了 → 手机（规整后的号、归属地），状态 ok；
 *   - 不是手机、按座机过得了 → 座机，状态 ok（座机不能当主号，之后不会被设回电话格）；
 *   - 都过不了（乱填的字、打了码的）→ 照原样记成手机一类，状态照实写 验号码 的结果（格式错误 / 无法识别），查重键算不出就空着（空键不拿来比）。
 * 老数据原样留着：占位号放过（同回访核对、编辑框原有行的口径）
 */
function 补的那行(原: string): { kind: string; value: string; numberKey: string; formatStatus: string; region: string | null } {
  for (const 种 of 补号种类) {
    const r = 验一行号码(种, 原, { 放过占位: true });
    if (r.ok) return { kind: 种.kind, value: r.值, numberKey: r.键, formatStatus: "ok", region: 种.kind === 默认号种类 ? 号码归属地("手机号", r.值)?.文字 ?? null : null };
  }
  const 验 = 验号码("手机号", 原.trim(), { 放过占位: true });
  return { kind: 默认号种类, value: 原, numberKey: 联系人号查重键(默认号种类, 原), formatStatus: 验.ok ? "格式错误" : 验.状态, region: null };
}

/**
 * 把这位联系人号码几行里的那一行设成默认号（事务里调，权限调用方判过）：
 *   - 那一行要挂在这位身上、是手机；已经是默认号的什么都不写（没变）
 *   - 电话格原来的号：号码几行里没有同号的（改版前的老数据、只写了电话格的）补一行挂在他身上，两条都不删；
 *     补成它该是的类型、照实写格式状态（补的那行）。他号码已经记满（每人最多号码）就不补：主号照换，原号留在改动记录里（原号满了）
 *   - 电话格写成选中那一行的号
 */
export async function 设默认号(tx: Prisma.TransactionClient, contactId: string, 号码id: string): Promise<设默认号结果> {
  const 人 = await tx.contact.findFirst({ where: { id: contactId, deletedAt: null }, select: { id: true, customerId: true, phone: true } });
  if (!人) return { ok: false, error: "这位联系人已经不在了，刷新看看" };
  const 行 = await tx.contactMethod.findFirst({ where: { id: 号码id, contactId }, select: { kind: true, value: true } });
  if (!行) return { ok: false, error: 号不在话 };
  if (行.kind !== 默认号种类) return { ok: false, error: 不是手机话 };
  const 原 = 人.phone?.trim() ? 人.phone : null;
  if (是默认号(原, 行)) return { ok: true, 原, 新: 行.value, 没变: true, 补了原号: false };
  let 补了原号 = false;
  let 原号满了 = false;
  if (原) {
    const 补 = 补的那行(原);
    const 他的 = await tx.contactMethod.findMany({ where: { contactId }, select: { kind: true, value: true, numberKey: true } });
    // 同类同号的已经有了不补：键算得出比键（库里老行的键可能没记，现算一次），算不出比原样
    const 同号 = (x: { kind: string; value: string; numberKey: string }) =>
      x.kind === 补.kind && (补.numberKey ? (x.numberKey || 联系人号查重键(x.kind, x.value)) === 补.numberKey : x.value.trim() === 原.trim());
    if (!他的.some(同号)) {
      if (他的.length >= 每人最多号码) 原号满了 = true;
      else {
        await tx.contactMethod.create({ data: { customerId: 人.customerId, contactId, ...补 } });
        补了原号 = true;
      }
    }
  }
  await tx.contact.update({ where: { id: contactId }, data: { phone: 行.value } });
  return { ok: true, 原, 新: 行.value, 没变: false, 补了原号, ...(原号满了 ? { 原号满了: true as const } : {}) };
}
