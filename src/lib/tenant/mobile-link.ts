/**
 * 手机扫名片接口（/api/mobile/scan）的资格判断：这个账号在开着的团队里、且有已连上的设备。
 * 手机配对那一套（申请 / 批准 / 挑战）随手机伴侣页面一起删了（2026-11-07）。
 */
import { control } from "./control";
import { type 手机资格 } from "../team-pricing";

/** 在某个团队里（没离队）、那个团队开着、自己在那个团队里有已连上的设备 */
export async function 连手机资格(accountId: string): Promise<手机资格> {
  const 在的 = (await control.syncMember.findMany({ where: { accountId, leftAt: null }, select: { teamId: true } })).map((m) => m.teamId);
  if (!在的.length) return "no-team";
  const 开着的 = (await control.syncTeam.findMany({ where: { id: { in: 在的 }, active: true }, select: { id: true } })).map((t) => t.id);
  if (!开着的.length) return "inactive";
  return (await control.syncDevice.count({ where: { accountId, teamId: { in: 开着的 } } })) ? "ok" : "no-device";
}
