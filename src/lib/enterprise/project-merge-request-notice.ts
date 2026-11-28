/**
 * 跨负责人项目合并 · 通知（阶段 2，E-380；方案 F 项）。站内铃铛 + 飞书同一份（notify）。
 *
 * 五件事，各一条（同一人同一张申请同一件事按 key 去重）：
 *   发起 → 每位确认人（发起人不在里面）
 *   确认（已合并）→ 发起人 + 其余确认人（并后原负责人那条另有 project-merge.ts 合并后通知，这里不重发）
 *   拒绝 → 发起人 + 其余确认人（带原因）
 *   失效（到期 / 四项有变 / 执行时被拦）→ 发起人 + 确认人
 *   撤回 → 确认人
 * 做这件事的人自己不收；系统判的（到期扫、执行时拦下）谁 = null。链接都落到合并申请页的「项目合并」那一节（#xmerge），确认人在那里点确认 / 拒绝。
 * 提交以后调，从不抛：通知不能连累已经做成的确认 / 拒绝。
 */
import type { PrismaClient } from "@/generated/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 企业版 } from "./switch";
import { notify } from "./notify";
import { 到期话, 等待工作日 } from "./merge-request";
import { beijingWallIso } from "@/lib/business-clock";
import type { 合并人 } from "./customer-merge";

export const 跨并通知种类 = "跨负责人合并";
export const 跨并申请页 = "/customers/merge-requests#xmerge";
export type 跨并事件 = "发起" | "确认" | "拒绝" | "失效" | "撤回";

const 北京时刻 = (d: Date) => beijingWallIso(d).slice(0, 16).replace("T", " ");
const 读JSON = <T,>(v: string, 缺: T): T => { try { return JSON.parse(v) as T; } catch { return 缺; } };

export async function 跨并通知(db: PrismaClient, requestId: string, 事: 跨并事件, 谁: 合并人 | null, 原因 = ""): Promise<void> {
  if (!企业版()) return;
  try {
    const r = await 看全部(() => db.entProjectMergeRequest.findUnique({ where: { id: requestId } }));
    if (!r) return;
    const [项目们, 人们] = await 看全部(() => Promise.all([
      db.project.findMany({ where: { id: { in: [r.intoProjectId, r.fromProjectId] } }, select: { id: true, name: true } }),
      db.user.findMany({ where: { id: { in: [r.byUserId, r.fromOwnerId, r.intoOwnerId] } }, select: { id: true, name: true } }),
    ]));
    const 项名 = (id: string) => 项目们.find((p) => p.id === id)?.name || "未命名项目";
    const 叫 = (id: string) => 人们.find((u) => u.id === id)?.name ?? "同事";
    const 两个 = `项目「${项名(r.fromProjectId)}」（${叫(r.fromOwnerId)}）并进「${项名(r.intoProjectId)}」（${叫(r.intoOwnerId)}）`;
    const 确认人们 = readIds(r.confirmerIds);
    const 别的确认人 = 确认人们.filter((u) => u !== 谁?.id);
    const 一句 = 原因.trim();
    const 发 = (收: readonly string[], title: string, body: string, 键: string) =>
      notify(收.filter((u) => u !== 谁?.id), { kind: 跨并通知种类, title, body, link: 跨并申请页, key: `xmerge:${r.id}:${键}` });
    switch (事) {
      case "发起":
        await 发(确认人们, `${叫(r.byUserId)}发来跨负责人合并申请：${两个}，要你确认`,
          `你是被并走项目负责人的${r.confirmerRole || "确认人"}。${北京时刻(r.expiresAt)} 前没处理，申请失效；等确认期间被并走那条的验证计时暂停。`, "发起");
        return;
      case "确认":
        await 发([r.byUserId, ...别的确认人], `${谁?.name ?? "确认人"}确认了跨负责人合并：${两个}`, "已并，被并走的项目结束为重复线索，不退还已占线索名额；30 天内可撤回。", "结束");
        return;
      case "拒绝":
        await 发([r.byUserId, ...别的确认人], `${谁?.name ?? "确认人"}拒绝了跨负责人合并申请：${两个}`, `${一句 ? `原因：${一句}` : "没写原因"}。被并走那条的验证计时重新起算`, "结束");
        return;
      case "失效":
        await 发([r.byUserId, ...别的确认人], `跨负责人合并申请已失效：${两个}`, `${一句 || r.reason || 到期话}。要并请重新发起（${等待工作日} 个工作日内要有人确认）`, "结束");
        return;
      case "撤回":
        await 发(别的确认人, `${叫(r.byUserId)}撤回了跨负责人合并申请：${两个}`, "不用再处理", "结束");
        return;
    }
  } catch (e) {
    console.warn("[通知] 跨负责人合并没发：", e instanceof Error ? e.message : e);
  }
}

function readIds(v: string): string[] {
  return [...new Set(读JSON<{ userId: string }[]>(v, []).map((x) => x.userId))];
}
