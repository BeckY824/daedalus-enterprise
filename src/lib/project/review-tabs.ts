import type { Prisma } from "@/generated/prisma";
import type { dayjs } from "@/lib/utils";
import type { 看板筛选 } from "./blocker";

/**
 * 企业版复盘页「卡点」「沟通」两个页签（P7 U-复盘-01，10-31）的规矩：地址栏怎么读、查哪些行。
 * 卡点页签 11-01 起是三栏看板，谁看得到按卡点自己的角色开关（lib/project/blocker.ts 卡点看板），不跟这里的 谁 走。
 * 只管拼条件，不碰库（页面、测试都直接用）；取数在 review-tabs-db.ts。
 *
 * 看谁的跟「任务」「数据」两个页签同一个 看板的人 的 谁（board-member.ts）：
 *   - 最下级：谁 = [自己]；上级：谁 = 自己 + 下属（选了某个人 = [他]）；总管理、管理员：谁 = undefined（不限人）。
 * 这一层是服务端兜底：企业版没开「按组织看客户」时 prisma 那层不拦人。
 *
 * 地址栏：tab=block  bm=1（我的认领） bo=1（只看自己） br=原因 id  bt=类型  bi=影响  bp=项目 id（11-01 改成三栏看板，不分页）
 *        tab=talk   t=7|30|90|all（最近几天，默认 all）  m=方式（FollowUp.type 的大类，不给 = 全部）  p=页码
 */

export const 复盘列表每页 = 20;

/** 卡点看板的筛选在地址栏的样子（只认这几个键；值原样带给 卡点看板，类型 / 影响认不得的那边丢掉） */
export type 卡点看板地址 = { bm?: string; bo?: string; br?: string; bt?: string; bi?: string; bp?: string };
export function 读卡点看板筛(sp: 卡点看板地址): 看板筛选 {
  const 取 = (v?: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 64) : undefined);
  return {
    我的认领: sp.bm === "1" || undefined,
    只看自己: sp.bo === "1" || undefined,
    原因: 取(sp.br),
    类型: 取(sp.bt),
    影响: 取(sp.bi),
    项目: 取(sp.bp),
  };
}

/** 沟通页签的时间筛选：最近 7 / 30 / 90 天、全部 */
export const 沟通段们 = ["7", "30", "90", "all"] as const;
export type 沟通段 = (typeof 沟通段们)[number];
export const 沟通段叫法: Record<沟通段, string> = { "7": "近 7 天", "30": "近 30 天", "90": "近 90 天", all: "全部" };
export const 读沟通段 = (v?: string): 沟通段 => ((沟通段们 as readonly string[]).includes(v ?? "") ? (v as 沟通段) : "all");

/**
 * 沟通页签的方式筛选（11-01 版式融合）：按 FollowUp.type 的八个大类筛（企业字典里的 19 种方式记录时已对到大类，lib/follow-method.ts），
 * 名字照 类型对方式；乱传 = 不筛
 */
export const 沟通方式们 = ["PHONE", "MEETING", "VISIT", "EMAIL", "SMS", "WHATSAPP", "WECHAT", "OTHER"] as const;
export type 沟通方式 = (typeof 沟通方式们)[number];
export const 读沟通方式 = (v?: string): 沟通方式 | "" => ((沟通方式们 as readonly string[]).includes(v ?? "") ? (v as 沟通方式) : "");

/** 页码超出最后一页时落到最后一页 */
export function 夹页(页: number, 总数: number, 每页 = 复盘列表每页): number {
  return Math.min(Math.max(1, 页), Math.max(1, Math.ceil(总数 / 每页)));
}

/**
 * 沟通页签查哪些：挂在项目节点上（项目没删）、这一圈负责的项目上的沟通，谁记的都算（11-03 C6-2 定：换负责人后前任记的沟通跟着项目走，
 * 接手人、组员、管理者都看得到；推翻 11-02「同事、前任记的不算」）。
 * 谁 给了就只算这一圈负责的、公海里的项目不算（11-01 同复盘按负责人数）；谁 = undefined（看全部）时算所有有负责人的项目（公海项目负责人是空串，不算）。
 * 段 = 最近几天（从那天零点起），方式 给了按 type 筛。
 * 企业版按这一圈项目认、不再按客户那层限定（review-tabs-db.ts 复盘沟通of）；公海里的项目不算，同事客户的沟通内容照旧不给
 */
export function 沟通条件(
  谁: readonly string[] | undefined,
  段: 沟通段,
  now: ReturnType<typeof dayjs>,
  方式: 沟通方式 | "" = "",
): Prisma.FollowUpWhereInput {
  return {
    // 公海无负责人 是空串（lib/project/pool-owner.ts），这里只用类型的文件不引它
    projectNode: { is: { project: { deletedAt: null, ...(谁 ? { ownerId: { in: [...谁] }, pooledAt: null } : { ownerId: { not: "" } }) } } },
    ...(方式 ? { type: 方式 } : {}),
    ...(段 === "all" ? {} : { occurredAt: { gte: now.startOf("day").subtract(Number(段) - 1, "day").toDate() } }),
  };
}

export type 复盘沟通行 = {
  id: string;
  时间: string;
  projectId: string;
  项目: string;
  /** 记这条时项目在哪个节点 */
  节点: string;
  客户: string;
  方式: string;
  标题: string;
  内容: string;
  负责人: string;
  /** 发起主体（企业字典 followInitiator），没填 = null */
  发起: string | null;
  /** 沟通编号（FUL…），没有 = null */
  编号: string | null;
  /** 挂了几个附件 */
  附件: number;
};
export type 复盘沟通 = { 总数: number; 页: number; 行: 复盘沟通行[] };
