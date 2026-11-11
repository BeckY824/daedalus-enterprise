"use server";
/**
 * 企业版「组织架构」设置页的写操作（2026-10-24）：部门增改删、给人定部门 / 角色 / 业务线 / 上级。
 *
 * 只在企业版开着时可用；11-01 起只认业务角色：总管理（director，没勾「不管设置」）能改，管理员（admin）只能看。
 * 账号 ADMIN 不再多出权限。总管理能给、能改总管理 / 管理员这两个角色，但至少要留一位能管设置的系统管理员。
 * 系统管理员标记（P-判定-06）：系统管理员和业务线两个身份并存，成员管理里的开关走 设系统管理员。
 * 设成员 只在「他是唯一一位能管设置的系统管理员」时设线自动带上标记（不带就一位不剩）；还有别的系统管理员时设线照旧变成条线总管理，要并存由别的系统管理员打开开关。
 * 规则检查都在 lib/enterprise/org.ts 的纯函数里，这里只负责读库、写库、留痕。
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, type SessionUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 不在了 } from "@/lib/not-there";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 企业版 } from "@/lib/enterprise/switch";
import { 规则, type 规则名 } from "@/lib/enterprise/rules";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 读组织, 建组织, 拆角色, 合角色, 部门挪动问题, 上级设置问题, 权限组织, 填组织设置, 规整只看某人, 回收站副手键, 只看某人键, 系统管理员标记键, 是系统管理员of, 能管设置of, 有人能管设置, 读组织于, 留一位系统管理员错, 留一位系统管理员话, 直属上级of, type 组织, type 组织部门 } from "@/lib/enterprise/org";
import type { Prisma } from "@/generated/prisma";
import { 能改后台设置 } from "@/lib/enterprise/permissions";
import { 是业务角色, 角色名, type 业务角色 } from "@/lib/sync/dept-policy";
import { 规整字段配置, 字段权限key } from "@/lib/enterprise/field-perm";
import { 市场部门key, 市场成员key, 规整市场部门 } from "@/lib/enterprise/market";
import { 挡改设置, 规整改权限, 改权限key, 设置项, 设置项们, 谁能改的话, type 设置项名 } from "@/lib/enterprise/edit-perm";
import {
  通讯录来源们, 通讯录来源名, 读通讯录设置, 读凭据概况, 开关通讯录同步, 存角色对照, 存通讯录凭据, 存通讯录间隔, 同步通讯录, 对照能给的角色,
  type 通讯录来源, type 通讯录设置, type 凭据概况, type 通讯录一次结果, type 通讯录间隔,
} from "@/lib/enterprise/org-sync";
import { 测试飞书连接, 读飞书表配置, 存飞书表, 主表们, type 测试结果, type 飞书表概况 } from "@/lib/enterprise/feishu-connect";
import { 视图外部拒 } from "@/lib/enterprise/view-as";

/** ok 时可带一句提示（设线自动保留 / 失去系统管理员）；改自己会失去系统管理员时回 要确认（界面弹二次确认，确认了带 确认 再来） */
type 结果 = { ok: true; 提示?: string } | { ok: false; error: string; 要确认?: string };

/** 组织、规则一改，谁看得到谁的客户就变了：页面和限定层的缓存一起清 */
function 改完了() {
  忘掉企业版范围();
  revalidatePath("/settings");
}

/** 能改组织架构、业务角色、规则的人（11-01 只认业务角色）：总管理 director，勾了「不管设置」的不行；管理员 admin 只读。不能改返回 null */
async function 能改的人() {
  if (!企业版()) return null;
  const me = await requireUser();
  return 能改后台设置(me, await 权限组织()) ? { me } : null;
}
const 不能改 = { ok: false as const, error: "只有总管理能改组织架构" };

/** 组织架构写操作的库：交互式事务里传 tx（企业版库只开一条连接，事务一个个排队，读→改→写不会和别人的交叉） */
type 库 = Prisma.TransactionClient;
const 事务选项 = { maxWait: 15_000, timeout: 20_000 };
const 留一位总管 = 留一位系统管理员话;

/** 事务里读一份组织架构的原料：人、组织行、部门、只看某人、系统管理员标记原文，加上建好的组织 */
async function 读原(tx: 库) {
  const users = await tx.user.findMany({ select: { id: true, name: true, role: true, active: true } });
  const members = await tx.entMember.findMany();
  const depts = await tx.entDept.findMany({ select: { id: true, name: true, parentId: true, sort: true } });
  const 只看 = (await tx.setting.findUnique({ where: { key: 只看某人键 }, select: { value: true } }))?.value ?? null;
  const 标记原文 = (await tx.setting.findUnique({ where: { key: 系统管理员标记键 }, select: { value: true } }))?.value ?? null;
  return { users, members, depts, 只看, 标记原文, 原: 填组织设置(建组织(users, members, depts), null, 只看, 标记原文) };
}

/** 标记原文里的 userId（不按在职滤：停用的人复职回来标记还在）；存坏了当空 */
function 标记名单(原文: string | null): Set<string> {
  let v: unknown = null;
  try { v = 原文 ? JSON.parse(原文) : null; } catch { v = 原文; }
  const 们 = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  return new Set(们.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean));
}
/** 事务里存标记：空了存 null（同 setSetting 的存法）。提交后调用方清设置缓存 */
async function 存标记(tx: 库, 们: ReadonlySet<string>): Promise<string[] | null> {
  const 存 = 们.size ? [...们].sort() : null;
  const value = JSON.stringify(存);
  await tx.setting.upsert({ where: { key: 系统管理员标记键 }, update: { value }, create: { key: 系统管理员标记键, value } });
  return 存;
}

/** 事务里一律走到底再回结果；守卫没过就抛这个，事务回滚，外面换成一句话 */
function 回话(e: unknown): 结果 {
  if (e instanceof 留一位系统管理员错) return { ok: false, error: e.message };
  return 不在了(e);
}

async function 全部部门(): Promise<Map<string, 组织部门>> {
  const ds = await prisma.entDept.findMany({ select: { id: true, name: true, parentId: true, sort: true } });
  return new Map(ds.map((d) => [d.id, d]));
}

function 名字问题(部门: ReadonlyMap<string, 组织部门>, name: string, parentId: string | null, 自己?: string): string | null {
  if (!name) return "部门名不能为空";
  if (name.length > 40) return "部门名最多 40 个字";
  for (const d of 部门.values()) if (d.id !== 自己 && (d.parentId ?? null) === parentId && d.name === name) return "同一级已经有这个部门了";
  return null;
}

export async function 建部门(名: string, parentId: string | null): Promise<结果> {
  const who = await 能改的人();
  if (!who) return 不能改;
  try {
    const name = 名.trim();
    const 部门 = await 全部部门();
    const 问题 = 名字问题(部门, name, parentId) ?? 部门挪动问题(部门, null, parentId);
    if (问题) return { ok: false, error: 问题 };
    const sort = [...部门.values()].filter((d) => (d.parentId ?? null) === parentId).reduce((m, d) => Math.max(m, d.sort + 1), 0);
    const d = await prisma.entDept.create({ data: { name, parentId, sort } });
    await recordAudit({ user: who.me, action: "create", entity: "EntDept", entityId: d.id, summary: `新建部门「${name}」` });
    改完了();
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

export async function 改部门(id: string, 改: { name: string; parentId: string | null }): Promise<结果> {
  const who = await 能改的人();
  if (!who) return 不能改;
  try {
    const name = 改.name.trim();
    const 部门 = await 全部部门();
    const 原 = 部门.get(id);
    if (!原) return { ok: false, error: "这个部门已经不在了，刷新看看" };
    const 问题 = 名字问题(部门, name, 改.parentId, id) ?? 部门挪动问题(部门, id, 改.parentId);
    if (问题) return { ok: false, error: 问题 };
    await prisma.entDept.update({ where: { id }, data: { name, parentId: 改.parentId } });
    const 说 = [原.name !== name && `改名为「${name}」`, (原.parentId ?? null) !== 改.parentId && `挪到「${改.parentId ? 部门.get(改.parentId)!.name : "最上层"}」底下`].filter(Boolean).join("，");
    await recordAudit({ user: who.me, action: "update", entity: "EntDept", entityId: id, summary: `部门「${原.name}」${说 || "没有变化"}` });
    改完了();
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

export async function 删部门(id: string): Promise<结果> {
  const who = await 能改的人();
  if (!who) return 不能改;
  try {
    const 部门 = await 全部部门();
    const 原 = 部门.get(id);
    if (!原) return { ok: false, error: "这个部门已经不在了，刷新看看" };
    if ([...部门.values()].some((d) => d.parentId === id)) return { ok: false, error: "先删掉或挪走它下面的部门" };
    const 人数 = await prisma.entMember.count({ where: { deptId: id } });
    if (人数) return { ok: false, error: `还有 ${人数} 个人在这个部门，先把他们换到别的部门` };
    await prisma.entDept.delete({ where: { id } });
    await recordAudit({ user: who.me, action: "delete", entity: "EntDept", entityId: id, summary: `删除部门「${原.name}」` });
    改完了();
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

export type 成员改动 = {
  deptId?: string | null;
  /** 业务角色可多选（10-27），存逗号串；传数组也收 */
  bizRole?: string | string[];
  line?: string | null;
  managerId?: string | null;
  dottedManagerId?: string | null;
};

const 可改字段 = ["deptId", "bizRole", "line", "managerId", "dottedManagerId"] as const;

/** 改完会不会让这个人不再是系统管理员：改自己的先要确认（界面弹二次确认，确认了带 确认 再来一次） */
const 自己失去话 = (line: string | null | undefined) =>
  line ? `设成${line}后你将不再是系统管理员（只管${line}线），进不了设置、改不了组织架构。确定吗？` : "改完你将不再是系统管理员，进不了设置、改不了组织架构。确定吗？";

/**
 * 给人定部门 / 角色 / 业务线 / 上级。系统管理员标记（P-判定-06）跟着动：
 *   - 他是唯一一位能管设置的系统管理员、这次又带着线：自动带上标记（不带就一位不剩），回一句提示；
 *   - 还有别的系统管理员时设线不带：只变成条线总管理，要并存由别的系统管理员在成员管理里打开；
 *   - 线清空（两边都做）、或不再是总管理：标记摘掉（没设线的总管理本来就是系统管理员，留着的旧标记下回设线会悄悄生效）。
 * 读→改→写和「留一位」守卫在一个事务里，写完在事务里重查一遍，一位能管设置的系统管理员都不剩就回滚。
 * 这次改动让他不再是系统管理员：改的是自己，没带 确认 先回 要确认；改别人的回一句提示
 */
export async function 设成员(userId: string, 传来的: 成员改动, 确认 = false): Promise<结果> {
  const who = await 能改的人();
  if (!who) return 不能改;
  // 接口能直调：只收这几个字段，别的、值是 undefined 的都丢掉
  const 改: 成员改动 = Object.fromEntries(可改字段.filter((k) => 传来的?.[k] !== undefined).map((k) => [k, 传来的[k]]));
  if (!Object.keys(改).length) return { ok: true };
  let 新角色们: 业务角色[] | null = null;
  if (改.bizRole !== undefined) {
    const 传 = (Array.isArray(改.bizRole) ? 改.bizRole : String(改.bizRole).split(",")).map((r) => String(r).trim()).filter(Boolean);
    if (!传.length) return { ok: false, error: "至少要有一个角色" };
    if (!传.every(是业务角色)) return { ok: false, error: "没有这个角色" };
    新角色们 = 拆角色(传.join(","));
    改.bizRole = 合角色(新角色们);
  }
  if (改.line !== undefined && 改.line !== null && 改.line !== "内贸" && 改.line !== "外贸") return { ok: false, error: "业务线只能是内贸、外贸或两边都做" };
  try {
    const r = await prisma.$transaction(async (tx) => {
      const { users, members, depts, 只看, 标记原文, 原 } = await 读原(tx);
      const 人 = users.find((u) => u.id === userId);
      if (!人 || !人.active) return { ok: false as const, error: "这个人不在职" };
      if (改.deptId && !depts.some((d) => d.id === 改.deptId)) return { ok: false as const, error: "这个部门已经不在了，刷新看看" };
      const 原角色们 = 原.成员.get(userId)!.角色们;

      // 带着这次改动重建一遍再查上级：一次同时改部门和上级时按改完的样子算
      const 旧行 = members.find((m) => m.userId === userId);
      const 新行 = {
        userId,
        deptId: 旧行?.deptId ?? null,
        line: 旧行?.line ?? null,
        managerId: 旧行?.managerId ?? null,
        dottedManagerId: 旧行?.dottedManagerId ?? null,
        ...改,
        bizRole: 新角色们 ? 合角色(新角色们) : (旧行?.bizRole ?? 合角色(原角色们)),
      };
      const 新线 = 新行.line === "内贸" || 新行.line === "外贸" ? 新行.line : null;
      const 原标记 = 标记名单(标记原文);
      const 新标记 = new Set(原标记);
      const 新是总管理 = (新角色们 ?? 原角色们).includes("director");
      const 唯一系管 = 能管设置of(原, userId) && !有人能管设置(原, userId);
      if (!新是总管理 || !新线) 新标记.delete(userId);
      else if (唯一系管) 新标记.add(userId);
      // 带上「只看某人」名单：设了的人不能当别人的实线上级（只认手填的直属上级，V3.5.1 / 11-03 C10-1）
      const 新 = 填组织设置(建组织(users, [...members.filter((m) => m.userId !== userId), 新行], depts), null, 只看, JSON.stringify([...新标记]));
      const 原有 = 有人能管设置(原);
      if (原有 && !有人能管设置(新)) return { ok: false as const, error: 留一位总管 };
      const 问题 =
        (改.managerId !== undefined ? 上级设置问题(新, userId, 改.managerId, "直属") : null) ??
        (改.dottedManagerId !== undefined ? 上级设置问题(新, userId, 改.dottedManagerId, "虚线") : null) ??
        只看某人当了上级(新);
      if (问题) return { ok: false as const, error: 问题 };
      const 失去 = 是系统管理员of(原, userId) && !是系统管理员of(新, userId);
      if (失去 && userId === who.me.id && !确认) return { ok: false as const, error: "要你确认一下", 要确认: 自己失去话(新是总管理 ? 新线 : null) };

      const 标记变了 = 新标记.has(userId) !== 原标记.has(userId);
      if (标记变了) await 存标记(tx, 新标记);
      await tx.entMember.upsert({ where: { userId }, create: 新行, update: { ...改, bizRole: 新角色们 ? 合角色(新角色们) : undefined } });
      // 写完重查：并发里别人刚把另一位关掉，这里照样能看出一位不剩
      if (原有 && !有人能管设置(await 读组织于(tx))) throw new 留一位系统管理员错(留一位总管);
      return { ok: true as const, 人名: 人.name, users, depts, 新线: 新是总管理 ? 新线 : null, 失去, 保留: 标记变了 && 新标记.has(userId), 标记变了 };
    }, 事务选项);
    if (!r.ok) return r;
    if (r.标记变了) invalidateSettingsCache();

    const 名 = (id: string | null | undefined) => (id ? r.users.find((u) => u.id === id)?.name ?? id : "不指定");
    const 说 = [
      改.deptId !== undefined && `部门 → ${改.deptId ? r.depts.find((d) => d.id === 改.deptId)!.name : "未分部门"}`,
      新角色们 && `角色 → ${新角色们.map((x) => 角色名[x]).join("、")}`,
      改.line !== undefined && `业务线 → ${改.line ?? "两边都做"}`,
      改.managerId !== undefined && `直属上级 → ${名(改.managerId)}`,
      改.dottedManagerId !== undefined && `虚线上级 → ${名(改.dottedManagerId)}`,
      r.保留 && "仍是系统管理员",
      r.失去 && "不再是系统管理员",
    ].filter(Boolean);
    await recordAudit({ user: who.me, action: "update", entity: "EntMember", entityId: userId, summary: `组织架构：${r.人名} ${说.join("，")}`, detail: 改 });
    改完了();
    if (r.保留) return { ok: true, 提示: `${r.人名} 是唯一的系统管理员，已保留系统管理员权限` };
    if (r.失去) {
      return {
        ok: true,
        提示: userId === who.me.id
          ? `你不再是系统管理员${r.新线 ? `，只管${r.新线}线` : ""}，设置页刷新后就进不去了`
          : `${r.人名} 不再是系统管理员${r.新线 ? `，只管${r.新线}线（要并存，到成员管理里打开「系统管理员」）` : ""}`,
      };
    }
    return { ok: true };
  } catch (e) {
    return 回话(e);
  }
}

/**
 * 「不管设置」（C1，迁移 108）：系统管理员勾上以后进不了设置页，其余权限照旧。只有能管设置的系统管理员能勾。
 * 勾完不能一位能管设置的系统管理员都不剩：事务里先查、写完再查一遍
 */
export async function 设不管设置(userId: string, on: boolean): Promise<结果> {
  const who = await 能改的人();
  if (!who) return 不能改;
  if (typeof on !== "boolean") return { ok: false, error: "只能勾或不勾" };
  try {
    const r = await prisma.$transaction(async (tx) => {
      const { users, 原 } = await 读原(tx);
      const 人 = users.find((u) => u.id === userId);
      if (!人 || !人.active) return { ok: false as const, error: "这个人不在职" };
      const 他 = 原.成员.get(userId);
      const 原有 = 有人能管设置(原);
      if (on && 能管设置of(原, userId) && !有人能管设置(原, userId)) return { ok: false as const, error: 留一位总管 };
      await tx.entMember.upsert({
        where: { userId },
        create: { userId, bizRole: 合角色(他?.角色们 ?? []), noSettings: on },
        update: { noSettings: on },
      });
      if (原有 && !有人能管设置(await 读组织于(tx))) throw new 留一位系统管理员错(留一位总管);
      return { ok: true as const, 人名: 人.name };
    }, 事务选项);
    if (!r.ok) return r;
    await recordAudit({ user: who.me, action: "update", entity: "EntMember", entityId: userId, summary: `组织架构：${r.人名} ${on ? "勾上" : "取消"}「不管设置」` });
    改完了();
    return { ok: true };
  } catch (e) {
    return 回话(e);
  }
}

/**
 * 「系统管理员」开关（P-判定-06，成员管理里总管理那一格）：系统管理员和业务线两个身份并存。只有能管设置的系统管理员能拨。
 * 只对总管理有意义：没设业务线的总管理读时就是系统管理员，关不掉（要只当条线总管理，先给他设业务线再关）；
 * 设了线的总管理打开 = 系统管理员 + 本线条线总管理，关掉 = 只是条线总管理。
 * 读→改→写在一个事务里（同时一开一关不丢更新），写完重查，不能把最后一位能管设置的系统管理员关掉。关自己的先要确认
 */
export async function 设系统管理员(userId: string, on: boolean, 确认 = false): Promise<结果> {
  const who = await 能改的人();
  if (!who) return 不能改;
  if (typeof on !== "boolean") return { ok: false, error: "只能开或关" };
  try {
    const r = await prisma.$transaction(async (tx) => {
      const { users, 标记原文, 原 } = await 读原(tx);
      const 人 = users.find((u) => u.id === userId);
      if (!人 || !人.active) return { ok: false as const, error: "这个人不在职" };
      const 他 = 原.成员.get(userId)!;
      if (!他.角色们.includes("director")) return { ok: false as const, error: "只有业务角色是总管理的人能设成系统管理员" };
      if (on === 是系统管理员of(原, userId)) return { ok: true as const, 没变: true as const };
      if (!他.line) return { ok: false as const, error: "没设业务线的总管理就是系统管理员；要只当条线总管理，先在组织架构里给他设业务线" };
      const 原有 = 有人能管设置(原);
      if (!on && 能管设置of(原, userId) && !有人能管设置(原, userId)) return { ok: false as const, error: 留一位总管 };
      if (!on && userId === who.me.id && !确认) return { ok: false as const, error: "要你确认一下", 要确认: `关掉后你将不再是系统管理员（只管${他.line}线），进不了设置、改不了组织架构。确定吗？` };
      const 新标记 = 标记名单(标记原文);
      if (on) 新标记.add(userId);
      else 新标记.delete(userId);
      const 存 = await 存标记(tx, 新标记);
      if (原有 && !有人能管设置(await 读组织于(tx))) throw new 留一位系统管理员错(留一位总管);
      return { ok: true as const, 人名: 人.name, 线: 他.line, 存 };
    }, 事务选项);
    if (!r.ok) return r;
    if ("没变" in r) return { ok: true };
    invalidateSettingsCache();
    await recordAudit({
      user: who.me, action: "update", entity: "Setting", entityId: 系统管理员标记键,
      summary: `成员管理：${r.人名} ${on ? "设为系统管理员" : "取消系统管理员"}（业务线 ${r.线}${on ? "，同时是本线条线总管理" : "，只是条线总管理"}）`, detail: r.存,
    });
    改完了();
    if (on) return { ok: true };
    return { ok: true, 提示: userId === who.me.id ? `你不再是系统管理员，只管${r.线}线，设置页刷新后就进不去了` : `${r.人名} 不再是系统管理员，只管${r.线}线` };
  } catch (e) {
    return 回话(e);
  }
}

/** 拨「按组织架构看客户」规则开关（默认关） */
export async function 设规则(on: boolean, 名: 规则名 = "按组织看客户"): Promise<结果> {
  const who = await 能改的人();
  if (!who) return 不能改;
  if (typeof on !== "boolean") return { ok: false, error: "开关只能开或关" };
  if (!Object.hasOwn(规则, 名)) return { ok: false, error: "没有这条规则" };
  const r = 规则[名];
  try {
    await setSetting(r.key, on);
    await recordAudit({ user: who.me, action: "update", entity: "Setting", entityId: r.key, summary: `${on ? "打开" : "关掉"}规则「${r.名}」` });
    改完了();
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

/** 「后台设置谁能改」里管的那几样（字段权限表等）：企业版，再按表查；能改给 me，不能改给那句话 */
async function 能改这项(项: 设置项名): Promise<{ me: SessionUser } | { error: string }> {
  if (!企业版()) return { error: "这是企业版组织架构里的设置" };
  const me = await requireUser();
  const 挡 = await 挡改设置(me, 项);
  return 挡 ? { error: `${设置项[项].名}${挡}` } : { me };
}

/** 存「角色 × 字段」表（规则「字段权限」开着才生效）；交来的先规整，只存和默认不一样的格 */
export async function 设字段权限(配置: unknown): Promise<结果> {
  const who = await 能改这项("字段权限");
  if ("error" in who) return { ok: false, error: who.error };
  try {
    const 存 = 规整字段配置(配置);
    await setSetting(字段权限key, 存);
    const 格数 = Object.values(存).reduce((n, 行) => n + Object.keys(行 ?? {}).length, 0);
    await recordAudit({ user: who.me, action: "update", entity: "Setting", entityId: 字段权限key, summary: `改字段权限表（${格数} 格不是「能改」）`, detail: 存 });
    改完了();
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

/**
 * 存「后台设置谁能改」表（B2 第 6 条，10-26）：七样后台设置各由哪几类人改，没存的项 = 默认建议。
 * 只有总管理能改这张表本身（和组织架构同一道门）。
 */
export async function 设改权限(配置: unknown): Promise<结果> {
  const who = await 能改的人();
  if (!who) return 不能改;
  try {
    const 存 = 规整改权限(配置);
    await setSetting(改权限key, 存);
    const 说 = 设置项们.map((项) => `${设置项[项].名}：${谁能改的话(存, 项).replace(/^只有|能改$/g, "")}`).join("；");
    await recordAudit({ user: who.me, action: "update", entity: "Setting", entityId: 改权限key, summary: `改后台设置谁能改（${说}）`, detail: 存 });
    改完了();
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

/**
 * 存「市场部门」（10-31）：哪几个部门（连下级）的人算市场成员——他们建的、负责过的客户转给销售后还看得到（只读，lib/enterprise/market.ts）。
 * 空 = 恢复默认（名字带「市场」的部门和下级）。只有总管理能改（和组织架构同一道门）。
 * 人：另外逐人算市场成员的（11-01，岗位调整试行期、部门不动的人）；不传 = 不动，空 = 清掉
 */
export async function 设市场部门(ids: unknown, 人?: unknown): Promise<结果> {
  const who = await 能改的人();
  if (!who) return 不能改;
  try {
    const 设 = 规整市场部门(ids);
    if (!设) return { ok: false, error: "市场部门没选对，刷新再试" };
    const 设人 = 人 === undefined ? undefined : 规整市场部门(人);
    if (设人 === null) return { ok: false, error: "市场成员没选对，刷新再试" };
    const 部门 = await 全部部门();
    if (设.some((id) => !部门.has(id))) return { ok: false, error: "选的部门有的已经不在了，刷新再选" };
    const org = 设人?.length ? await 读组织() : null;
    if (org && 设人!.some((id) => !org.成员.has(id))) return { ok: false, error: "选的人有的已经不在组织里了，刷新再选" };
    const 存 = 设.length ? 设 : null;
    await setSetting(市场部门key, 存);
    const 说 = 存 ? 存.map((id) => 部门.get(id)!.name).join("、") : "恢复默认（名字带「市场」的部门）";
    await recordAudit({ user: who.me, action: "update", entity: "Setting", entityId: 市场部门key, summary: `改市场部门（${说}）`, detail: 存 });
    if (设人 !== undefined) {
      const 存人 = 设人.length ? 设人 : null;
      await setSetting(市场成员key, 存人);
      const 名 = 存人 ? (await prisma.user.findMany({ where: { id: { in: 存人 } }, select: { name: true } })).map((u) => u.name).join("、") : "清空";
      await recordAudit({ user: who.me, action: "update", entity: "Setting", entityId: 市场成员key, summary: `改逐人设的市场成员（${名}）`, detail: 存人 });
    }
    改完了();
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

/** 设了「只看某人」的人有没有被谁当实线上级（只认手填的直属上级）：有就回那一句 */
function 只看某人当了上级(org: 组织): string | null {
  for (const id of org.成员.keys()) {
    const 上 = 直属上级of(org, id);
    if (上 && org.只看某人?.has(上)) return "有人以设了「只看某人」的成员为实线上级，先给那些人换上级";
  }
  return null;
}

/**
 * 「只看某人」（V3.5.1 市管特例）：本人只看 那个人 是创建人或负责人的数据，公海照常；不当负责人、不编、不转、不删。
 * 那个人 = null 是取消。设之前本人不能是任何人的实线上级（只认手填的直属上级）
 */
export async function 设只看某人(本人: string, 那个人: string | null): Promise<结果> {
  const who = await 能改的人();
  if (!who) return 不能改;
  try {
    const org = await 读组织();
    if (!org.成员.has(本人)) return { ok: false, error: "这个人不在职" };
    if (那个人 !== null && !org.成员.has(那个人)) return { ok: false, error: "选的人不在职" };
    if (那个人 === 本人) return { ok: false, error: "不能只看自己" };
    const 表 = new Map(org.只看某人 ?? []);
    if (那个人) 表.set(本人, 那个人);
    else 表.delete(本人);
    const 新 = { ...org, 只看某人: 表 };
    if (那个人) {
      const 下属 = [...org.成员.keys()].filter((id) => 直属上级of(新, id) === 本人);
      if (下属.length) {
        const 名 = (await prisma.user.findMany({ where: { id: { in: 下属 } }, select: { name: true } })).map((u) => u.name).join("、");
        return { ok: false, error: `${名} 以他为直属上级，先给他们换上级再设「只看某人」` };
      }
    }
    const 存 = 表.size ? Object.fromEntries(规整只看某人(Object.fromEntries(表), org)) : null;
    await setSetting(只看某人键, 存);
    const 名们 = new Map((await prisma.user.findMany({ where: { id: { in: [本人, ...(那个人 ? [那个人] : [])] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    await recordAudit({
      user: who.me, action: "update", entity: "Setting", entityId: 只看某人键,
      summary: 那个人 ? `${名们.get(本人)} 设为只看 ${名们.get(那个人)}` : `${名们.get(本人)} 取消「只看某人」`, detail: 存,
    });
    改完了();
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

/** 回收站副手（V3.5.1）：系统管理员之外能看、能恢复回收站的人；彻底删除仍只有系统管理员。空 = 清空 */
export async function 设回收站副手(ids: unknown): Promise<结果> {
  const who = await 能改的人();
  if (!who) return 不能改;
  try {
    const 设 = 规整市场部门(ids);
    if (!设) return { ok: false, error: "选的人不对，刷新再试" };
    const org = await 读组织();
    if (设.some((id) => !org.成员.has(id))) return { ok: false, error: "选的人有的已经不在组织里了，刷新再选" };
    const 存 = 设.length ? 设 : null;
    await setSetting(回收站副手键, 存);
    const 名 = 设.length ? (await prisma.user.findMany({ where: { id: { in: 设 } }, select: { name: true } })).map((u) => u.name).join("、") : "清空";
    await recordAudit({ user: who.me, action: "update", entity: "Setting", entityId: 回收站副手键, summary: `改回收站副手（${名}）`, detail: 存 });
    改完了();
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

/* ───────── 通讯录同步（飞书 / 钉钉 → 组织架构，10-26） ───────── */

export type 通讯录一栏 = {
  源: 通讯录来源;
  名: string;
  开: boolean;
  上次: 通讯录设置["上次"];
  角色对照: 通讯录设置["角色对照"];
  职务们: string[];
  凭据: 凭据概况;
  间隔分钟: 通讯录间隔;
};

const 是来源 = (v: unknown): v is 通讯录来源 => typeof v === "string" && (通讯录来源们 as string[]).includes(v);

/** 设置页那一栏：凭据里的密钥只说填没填，不回原文；只给能改组织架构的人看 */
export async function 通讯录概况(): Promise<{ ok: true; 来源们: 通讯录一栏[]; 角色们: { value: string; label: string }[] } | { ok: false; error: string }> {
  const who = await 能改的人();
  if (!who) return 不能改;
  try {
    const 来源们 = await Promise.all(
      通讯录来源们.map(async (源) => {
        const s = await 读通讯录设置(源);
        return { 源, 名: 通讯录来源名[源], 开: s.开, 上次: s.上次, 角色对照: s.角色对照, 职务们: s.职务们, 凭据: await 读凭据概况(源), 间隔分钟: (s.间隔分钟 === 30 ? 30 : 60) as 通讯录间隔 };
      }),
    );
    const 角色们 = Object.entries(角色名).filter(([k]) => 对照能给的角色(k)).map(([value, label]) => ({ value, label }));
    return { ok: true, 来源们, 角色们 };
  } catch (e) {
    return 不在了(e);
  }
}

export async function 设通讯录同步(源: 通讯录来源, 开: boolean): Promise<结果> {
  const who = await 能改的人();
  if (!who) return 不能改;
  if (!是来源(源) || typeof 开 !== "boolean") return { ok: false, error: "参数不对" };
  try {
    if (开 && !(await 读凭据概况(源)).齐了) return { ok: false, error: `先填好${通讯录来源名[源]}的连接凭据再打开` };
    await 开关通讯录同步(源, 开, who.me);
    改完了();
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

/** 手动「立即同步」：照样走一次写库（同一来源同时只跑一次），结果原样回给界面 */
export async function 立即同步通讯录(源: 通讯录来源): Promise<{ ok: true; 一次: 通讯录一次结果 } | { ok: false; error: string }> {
  const who = await 能改的人();
  if (!who) return 不能改;
  const 拒 = await 视图外部拒();
  if (拒) return 拒;
  if (!是来源(源)) return { ok: false, error: "参数不对" };
  try {
    const 一次 = await 同步通讯录(源, { 用户: who.me });
    改完了();
    return { ok: true, 一次 };
  } catch (e) {
    return 不在了(e);
  }
}

export async function 设职务对照(源: 通讯录来源, 对照: Record<string, string>): Promise<结果> {
  const who = await 能改的人();
  if (!who) return 不能改;
  if (!是来源(源) || !对照 || typeof 对照 !== "object") return { ok: false, error: "参数不对" };
  try {
    await 存角色对照(源, 对照, who.me);
    改完了();
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

/** 存连接凭据：密钥空着 = 不改 */
export async function 设通讯录凭据(源: 通讯录来源, 填: Record<string, string>): Promise<结果> {
  const who = await 能改的人();
  if (!who) return 不能改;
  if (!是来源(源) || !填 || typeof 填 !== "object") return { ok: false, error: "参数不对" };
  try {
    await 存通讯录凭据(源, 填, who.me);
    改完了();
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

export async function 设通讯录间隔(源: 通讯录来源, 分钟: number): Promise<结果> {
  const who = await 能改的人();
  if (!who) return 不能改;
  if (!是来源(源) || (分钟 !== 60 && 分钟 !== 30)) return { ok: false, error: "参数不对" };
  try {
    await 存通讯录间隔(源, 分钟, who.me);
    改完了();
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

/* ── 飞书连接：测试连接 + 多维表格对表（lib/enterprise/feishu-connect.ts） ── */

/** 测试连接：填 = 页面上还没存的 App ID / Secret（Secret 空着用存着的）；链接不填就不测多维表格 */
export async function 测试飞书连接动作(p: { 填?: { appId?: string; appSecret?: string }; 链接?: string }): Promise<{ ok: true; 结果: 测试结果 } | { ok: false; error: string }> {
  const who = await 能改的人();
  if (!who) return 不能改;
  const 拒 = await 视图外部拒();
  if (拒) return 拒;
  if (p && typeof p !== "object") return { ok: false, error: "参数不对" };
  const 串 = (v: unknown) => (typeof v === "string" ? v : undefined);
  try {
    return { ok: true, 结果: await 测试飞书连接({ 填: { appId: 串(p?.填?.appId), appSecret: 串(p?.填?.appSecret) }, 链接: 串(p?.链接) }) };
  } catch (e) {
    return 不在了(e);
  }
}

export async function 飞书表概况(): Promise<{ ok: true; 概况: 飞书表概况; 主表们: typeof 主表们 } | { ok: false; error: string }> {
  const who = await 能改的人();
  if (!who) return 不能改;
  try {
    return { ok: true, 概况: await 读飞书表配置(), 主表们 };
  } catch (e) {
    return 不在了(e);
  }
}

export async function 设飞书表(链接: string, 选: Record<string, string | null>): Promise<{ ok: true; 概况: 飞书表概况 } | { ok: false; error: string }> {
  const who = await 能改的人();
  if (!who) return 不能改;
  const 拒 = await 视图外部拒();
  if (拒) return 拒;
  if (typeof 链接 !== "string" || !选 || typeof 选 !== "object") return { ok: false, error: "参数不对" };
  try {
    const r = await 存飞书表({ 链接, 选 }, who.me);
    if (r.ok) 改完了();
    return r;
  } catch (e) {
    return 不在了(e);
  }
}
