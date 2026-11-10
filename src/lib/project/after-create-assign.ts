/**
 * 新建项目时的「分配方式」（企业版，10-27 A7；11-01 会议 §1 / §3、清单 A6–A10）：建档向导、客户页新开项目共用。
 * 不是 server action（"use server" 文件只能导出给浏览器调的 action；这两个要带 me，只能服务端自己调）。
 */
import { revalidatePath } from "next/cache";
import type { requireUser } from "@/lib/auth";
import { 我能用的分配方式, 挡分配方式, 是分配方式序号, type 分配方式序号 } from "@/lib/enterprise/dict";
import { 放回公海 } from "@/lib/project/db";
import { 读组织 } from "@/lib/enterprise/org";
import { 没设业务角色 } from "@/lib/enterprise/permissions";
import { 标待分配 } from "@/lib/enterprise/await-assign";
import { 默认分配方式, 是销售角色, type 项目线 } from "@/lib/enterprise/assign-line";
import { 向导自动分配 } from "@/app/(app)/leads/assign-actions";

/** 新线索能手动分配 / 点自动分配的（A7）：和 lead-assign.ts 能分配 同一组业务角色 */
const 能分配的人 = "市场管理、销售管理、总管理员";

/** 选「暂不分配」建好后回的那句（P-转-03） */
export const 暂不分配提示 = "已记在你名下，在潜客培育自己跟进；之后可以再分配";

type 我 = Awaited<ReturnType<typeof requireUser>>;
export type 定好的分配 = { i: 分配方式序号; 名: string };

function 刷新(projectId: string) {
  revalidatePath("/projects");
  revalidatePath("/leads");
  revalidatePath(`/projects/${projectId}`);
}

/**
 * 这次用哪种分配方式：传了就用传的；没传（老草稿、老调用）照负责人推：选了别人 / 没选 = 指定分配（没选照旧拦「请选项目负责人」），
 * 建给自己 = 个人自持，用不了个人自持的 = 暂不分配。推出来的也要过「谁能用」。
 * 界面上的默认值（市场 → 自动，销售 → 个人自持，其他 → 暂不分配）在 assign-line.ts 默认分配方式，由页面先填好
 */
export async function 定分配方式(me: 我, 项目: { 分配方式?: number | null; ownerId?: string | null } | undefined): Promise<定好的分配 | { error: string }> {
  const 能用 = await 我能用的分配方式(me);
  const 传 = 项目?.分配方式;
  if (传 !== undefined && 传 !== null && !是分配方式序号(传)) return { error: "没有这种分配方式，刷新后再选" };
  const 有 = (i: 分配方式序号) => 能用.some((x) => x.i === i);
  const i: 分配方式序号 = 是分配方式序号(传) ? 传 : 项目?.ownerId !== me.id ? 0 : 有(4) ? 4 : 有(3) ? 3 : 0;
  const 中 = 能用.find((x) => x.i === i);
  if (中) return 中;
  return { error: (await 挡分配方式(me, i)) ?? "这种分配方式已停用，换一种" };
}

/**
 * 建好之后：
 * - 自动分配：转给挑中的人。只改项目，客户负责人不动；例外是客户负责人是市场、挑中销售（X-18）：算转客户，客户连名下全部项目给销售（含同事在推的，P-转-07），
 *   原负责人的待办、计划留在他名下（P-转-10）。没分出去（例如这条线的人全暂停）= 留在新线索待分配，提醒市场管理、销售管理、总管理员（A11）。
 *   不看配额、不看持有上限（A10 / A11：不限额）。业务线建之前就拦了必填（A1）；选了「暂不分配」的不自动分，直接待分配、不提醒
 * - 暂不分配：建的人自己负责，项目在线索·潜客培育自己跟进（P-转-03、X-90）；不标待分配、算他持有，之后照常可以再分配
 * - 公海捞取：放进项目公海
 * - 个人自持、指定分配：建好就在负责人名下，不用再动
 * 建档本身算成了，没成的回一句提示。转走 = 项目已不在我名下
 */
export async function 建好再分(me: 我, 分配: 定好的分配, projectId: string, 项目名: string, 业务线?: 项目线 | null): Promise<{ 提示: string; 转走: boolean } | null> {
  if (分配.i === 1 && 业务线 === "暂不分配") {
    await 标待分配(projectId, null);
    刷新(projectId);
    return { 提示: `业务线是「暂不分配」，不自动分：已留在新线索待分配，等${能分配的人}分`, 转走: false };
  }
  if (分配.i === 1) {
    const r = await 向导自动分配(projectId);
    if (r.ok) return { 提示: `已按「${分配.名}」分给 ${r.接手人}`, 转走: true };
    await 标待分配(projectId, { org: await 读组织(), 名: 项目名, 谁建的: me.name, 为什么: r.error });
    刷新(projectId);
    return { 提示: `「${分配.名}」没分出去：${r.error}。已留在新线索待分配，已提醒${能分配的人}`, 转走: false };
  }
  // 暂不分配不标待分配（P-转-03、X-90，11-10 定）：建的人自己负责、算他持有，项目落在线索·潜客培育，之后照常可以再分配。
  // 回个对象（不回 null）：客户页新建靠它判「自己留着」，不给自己发「项目分给你」
  if (分配.i === 3) return { 提示: 暂不分配提示, 转走: false };
  if (分配.i === 2) {
    const r = await 放回公海(me, projectId, null, { 分配放行: true });
    if (!r.ok) return { 提示: `项目先建在你名下，没放进公海：${r.error}`, 转走: false };
    刷新(projectId);
    return { 提示: "已放进线索公海，等人捞取", 转走: true };
  }
  return null;
}

/**
 * 新建线索 / 项目页面上「分配方式」那一格要的：这人能用哪几种、默认选哪种（A6，按业务角色）、是不是销售（选自动分配要再确认，A9）。
 * 业务角色只认 EntMember（组织里的 角色们），账号角色不算
 */
export async function 新建分配方式数据(me: 我): Promise<{ 分配方式们: 定好的分配[]; 默认分配方式: number | null; 是销售: boolean; 没角色: boolean }> {
  const [能用, org] = await Promise.all([我能用的分配方式(me), 读组织()]);
  const 角色们 = org.成员.get(me.id)?.角色们 ?? [];
  const 默认 = 默认分配方式(角色们, 能用.map((x) => x.i));
  // 没角色：向导一进来就提示、不让往下填，免得填完五步才被服务端拦（D3-6）
  return { 分配方式们: 能用, 默认分配方式: 默认 ?? null, 是销售: 是销售角色(角色们), 没角色: 没设业务角色(org, me.id) };
}
