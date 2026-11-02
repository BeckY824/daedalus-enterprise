"use server";
/**
 * 企业版「组织架构」设置页的写操作（2026-10-24）：部门增改删、给人定部门 / 角色 / 业务线 / 上级。
 *
 * 只在企业版开着时可用；11-01 起只认业务角色：总管理（director，没勾「不管设置」）能改，管理员（admin）只能看。
 * 账号 ADMIN 不再多出权限。总管理能给、能改总管理 / 管理员这两个角色，但至少要留一位能管设置的总管理。
 * 规则检查都在 lib/enterprise/org.ts 的纯函数里，这里只负责读库、写库、留痕。
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, type SessionUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 不在了 } from "@/lib/not-there";
import { setSetting } from "@/lib/settings";
import { 企业版 } from "@/lib/enterprise/switch";
import { 规则, type 规则名 } from "@/lib/enterprise/rules";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 读组织, 建组织, 拆角色, 合角色, 部门挪动问题, 上级设置问题, 权限组织, type 组织, type 组织部门 } from "@/lib/enterprise/org";
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

type 结果 = { ok: true } | { ok: false; error: string };

/** 组织、规则一改，谁看得到谁的客户就变了：页面和限定层的缓存一起清 */
function 改完了() {
  忘掉企业版范围();
  revalidatePath("/settings");
}

/** 能改组织架构、业务角色、规则的人（11-01 只认业务角色）：总管理 director，勾了「不管设置」的不行；管理员 admin 只读。不能改返回 null */
async function 能改的人() {
  if (!企业版()) return null;
  const me = await requireUser();
  const { 当前是共享区 } = await import("@/lib/shared-ws/current");
  if (await 当前是共享区()) return null;
  return 能改后台设置(me, await 权限组织()) ? { me } : null;
}
const 不能改 = { ok: false as const, error: "只有总管理能改组织架构" };

/** 改完以后还剩不剩一位能管设置的总管理（在职、director、没勾「不管设置」）；一个都不剩就没人能再改角色了 */
function 还有总管(org: 组织, 除了: string): boolean {
  for (const [id, m] of org.成员) if (id !== 除了 && m.角色们.includes("director") && !m.不管设置) return true;
  return false;
}
const 留一位总管 = "至少要留一位能管设置的总管理（业务角色总管理、没勾「不管设置」）";

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

export async function 设成员(userId: string, 传来的: 成员改动): Promise<结果> {
  const who = await 能改的人();
  if (!who) return 不能改;
  // 接口能直调：只收这几个字段，别的、值是 undefined 的都丢掉
  const 改: 成员改动 = Object.fromEntries(可改字段.filter((k) => 传来的?.[k] !== undefined).map((k) => [k, 传来的[k]]));
  if (!Object.keys(改).length) return { ok: true };
  try {
    const [users, members, depts] = await Promise.all([
      prisma.user.findMany({ select: { id: true, name: true, role: true, active: true } }),
      prisma.entMember.findMany(),
      prisma.entDept.findMany({ select: { id: true, name: true, parentId: true, sort: true } }),
    ]);
    const 人 = users.find((u) => u.id === userId);
    if (!人 || !人.active) return { ok: false, error: "这个人不在职" };
    let 新角色们: 业务角色[] | null = null;
    if (改.bizRole !== undefined) {
      const 传 = (Array.isArray(改.bizRole) ? 改.bizRole : String(改.bizRole).split(",")).map((r) => String(r).trim()).filter(Boolean);
      if (!传.length) return { ok: false, error: "至少要有一个角色" };
      if (!传.every(是业务角色)) return { ok: false, error: "没有这个角色" };
      新角色们 = 拆角色(传.join(","));
      改.bizRole = 合角色(新角色们);
    }
    if (改.line !== undefined && 改.line !== null && 改.line !== "内贸" && 改.line !== "外贸") return { ok: false, error: "业务线只能是内贸、外贸或两边都做" };
    if (改.deptId && !depts.some((d) => d.id === 改.deptId)) return { ok: false, error: "这个部门已经不在了，刷新看看" };

    const 原 = 建组织(users, members, depts);
    const 原角色们 = 原.成员.get(userId)!.角色们;
    // 总管理把自己（或最后一位总管理）的总管理角色去掉：先看还剩不剩一位能管设置的
    if (新角色们 && 原角色们.includes("director") && !新角色们.includes("director") && !原.成员.get(userId)!.不管设置 && !还有总管(原, userId)) return { ok: false, error: 留一位总管 };

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
    const 新 = 建组织(users, [...members.filter((m) => m.userId !== userId), 新行], depts);
    const 问题 =
      (改.managerId !== undefined ? 上级设置问题(新, userId, 改.managerId, "直属") : null) ??
      (改.dottedManagerId !== undefined ? 上级设置问题(新, userId, 改.dottedManagerId, "虚线") : null);
    if (问题) return { ok: false, error: 问题 };

    const 存 = { ...改, bizRole: 新角色们 ? 合角色(新角色们) : undefined };
    await prisma.entMember.upsert({ where: { userId }, create: 新行, update: 存 });

    const 名 = (id: string | null | undefined) => (id ? users.find((u) => u.id === id)?.name ?? id : "不指定");
    const 说 = [
      改.deptId !== undefined && `部门 → ${改.deptId ? depts.find((d) => d.id === 改.deptId)!.name : "未分部门"}`,
      新角色们 && `角色 → ${新角色们.map((r) => 角色名[r]).join("、")}`,
      改.line !== undefined && `业务线 → ${改.line ?? "两边都做"}`,
      改.managerId !== undefined && `直属上级 → ${名(改.managerId)}`,
      改.dottedManagerId !== undefined && `虚线上级 → ${名(改.dottedManagerId)}`,
    ].filter(Boolean);
    await recordAudit({ user: who.me, action: "update", entity: "EntMember", entityId: userId, summary: `组织架构：${人.name} ${说.join("，")}`, detail: 改 });
    改完了();
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

/**
 * 「不管设置」（C1，迁移 108）：总管理勾上以后进不了设置页，其余总管理权限照旧。只有能改组织架构的总管理能勾；
 * 别的角色勾了也没用（进设置本来就只给总管理、管理员）。勾完不能一个能管设置的总管理都不剩
 */
export async function 设不管设置(userId: string, on: boolean): Promise<结果> {
  const who = await 能改的人();
  if (!who) return 不能改;
  if (typeof on !== "boolean") return { ok: false, error: "只能勾或不勾" };
  try {
    const [users, members, depts] = await Promise.all([
      prisma.user.findMany({ select: { id: true, name: true, role: true, active: true } }),
      prisma.entMember.findMany(),
      prisma.entDept.findMany({ select: { id: true, name: true, parentId: true, sort: true } }),
    ]);
    const 人 = users.find((u) => u.id === userId);
    if (!人 || !人.active) return { ok: false, error: "这个人不在职" };
    const 原 = 建组织(users, members, depts);
    const 他 = 原.成员.get(userId);
    if (on && 他?.角色们.includes("director") && !他.不管设置 && !还有总管(原, userId)) return { ok: false, error: 留一位总管 };
    await prisma.entMember.upsert({
      where: { userId },
      create: { userId, bizRole: 合角色(他?.角色们 ?? []), noSettings: on },
      update: { noSettings: on },
    });
    await recordAudit({ user: who.me, action: "update", entity: "EntMember", entityId: userId, summary: `组织架构：${人.name} ${on ? "勾上" : "取消"}「不管设置」` });
    改完了();
    return { ok: true };
  } catch (e) {
    return 不在了(e);
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

/** 「后台设置谁能改」里管的那几样（字段权限表等）：企业版、不在共享区，再按表查；能改给 me，不能改给那句话 */
async function 能改这项(项: 设置项名): Promise<{ me: SessionUser } | { error: string }> {
  if (!企业版()) return { error: "这是企业版组织架构里的设置" };
  const me = await requireUser();
  const { 当前是共享区 } = await import("@/lib/shared-ws/current");
  if (await 当前是共享区()) return { error: "共享试用区不能改后台设置" };
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
