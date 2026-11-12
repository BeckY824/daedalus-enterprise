"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getSetting, setSetting } from "@/lib/settings";
import { 系统写 } from "@/lib/team-scope";
import { 正在切换视图, 视图只读错误 } from "@/lib/enterprise/view-as";
import { 视图收藏话 } from "@/lib/enterprise/view-as-words";
import { 收藏键 as 键, 项目收藏键 as 项目键, 点得开的项目 } from "@/lib/favorites";

/**
 * 收藏的客户、项目（2026-10-02 客户，11-02 加项目：左栏各一栏，模式一样）。
 * 存在 Setting 里，一人一份（键带用户 id）：团队版同事各收各的，不互相看见。
 * 不在客户表上加列，因为这是个人偏好，不是客户数据（不该同步、不该进导出）。
 * 只存 id；名字每次从库里现查，客户改了名左栏跟着变，删了的自然消失。
 */
const 上限 = 8;

type 结果 = { ok: true; 收藏了: boolean } | { ok: false; error: string };

/**
 * 切换视图时不替被看的人改，回一句话。只读管理员照存：收藏是他自己的偏好，不算改业务数据，
 * 所以写这一步走 系统写（不然 只读拦 抛错，整页崩成错误边界）。
 */
async function 存(key: string, ids: string[]): Promise<void> {
  // 调用方已先回过话；这里再兜一道：系统写 前必须先问过切换视图（ent-view-as-scan.test.ts 静态守卫）
  if (await 正在切换视图()) throw new 视图只读错误(视图收藏话);
  await 系统写(() => setSetting(key, ids));
  // 左栏在 layout 里，layout 客户端导航不重算：让它重新取一次
  revalidatePath("/", "layout");
}

/** 收藏 / 取消。新收藏的排最前；满了挤掉最早的那位 */
export async function 切换收藏(customerId: string): Promise<结果> {
  const user = await requireUser();
  if (await 正在切换视图()) return { ok: false, error: 视图收藏话 };
  const 有 = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!有) return { ok: false, error: "这位客户已经不在了" };
  const 记着的 = ((await getSetting<string[]>(键(user.id))) ?? []).filter((x) => typeof x === "string");
  // 已经删掉的客户先剔掉：不然它们继续占着 8 个名额，左栏只显示 5 位、还挤掉了还在的那位（第六轮 B2）
  const 还在 = new Set((await prisma.customer.findMany({ where: { id: { in: 记着的 } }, select: { id: true } })).map((c) => c.id));
  const 旧 = 记着的.filter((x) => 还在.has(x));
  const 收藏了 = !旧.includes(customerId);
  const 新 = 收藏了 ? [customerId, ...旧].slice(0, 上限) : 旧.filter((x) => x !== customerId);
  await 存(键(user.id), 新);
  return { ok: true, 收藏了 };
}

/** 收藏 / 取消项目，和客户一个模式。点不开的项目（删了、不归他看了、进公海要回避的）不占名额 */
export async function 切换项目收藏(projectId: string): Promise<结果> {
  const user = await requireUser();
  if (await 正在切换视图()) return { ok: false, error: 视图收藏话 };
  const 记着的 = ((await getSetting<string[]>(项目键(user.id))) ?? []).filter((x) => typeof x === "string");
  const 能开 = new Set((await 点得开的项目(user, [...new Set([projectId, ...记着的])])).map((p) => p.id));
  const 旧 = 记着的.filter((x) => 能开.has(x));
  // 已经收藏着的点得开才走到「取消」；点不开的本来就从名单里剔了，再报不在了
  if (!能开.has(projectId)) return { ok: false, error: "这个项目已经不在了" };
  const 收藏了 = !旧.includes(projectId);
  const 新 = 收藏了 ? [projectId, ...旧].slice(0, 上限) : 旧.filter((x) => x !== projectId);
  await 存(项目键(user.id), 新);
  return { ok: true, 收藏了 };
}
