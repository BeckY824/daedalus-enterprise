/**
 * 项目组卡片的两句小逻辑（11-03 B5-2 / B5-4），不碰数据库，客户端引。
 */
type 组员 = { userId: string; roleId: string | null; inviteStatus: string };
type 角色 = { id: string; name: string; active: boolean };

/** B5-2：换完角色说「已改成 X」（X = 新角色的名字）；清掉角色说「已清掉角色」；角色名找不到（刚被删）退回「已换角色」 */
export function 换角色提示(角色们: readonly 角色[], roleId: string | null | undefined): string {
  if (!roleId) return "已清掉角色";
  const 名 = 角色们.find((r) => r.id === roleId)?.name;
  return 名 ? `已改成${名}` : "已换角色";
}

/** B5-4：再邀拒绝过的人，角色默认带上上次邀请时选的；上次没选、或那个角色已停用 / 没了，就不带 */
export function 再邀默认角色(组员们: readonly 组员[], 角色们: readonly 角色[], userId: string | null | undefined): string | undefined {
  if (!userId) return undefined;
  const 上次 = 组员们.find((m) => m.userId === userId && m.inviteStatus === "DECLINED")?.roleId;
  return 上次 && 角色们.some((r) => r.id === 上次 && r.active) ? 上次 : undefined;
}
