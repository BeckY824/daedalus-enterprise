import { 飞书登录凭据 } from "./feishu-login";
import { 读组织 } from "./org";
import { 是系统管理员 } from "./permissions";

/** 部署时建的运维号登录名（prisma/seed.ts USERS） */
const 运维号 = "admin";

/**
 * 企业版接了飞书登录之后（11-03 客户定）：大家一律用飞书登录，账号密码只留给系统管理员兜底
 * （登录页 ?admin=1 才露出表单）。知道入口的普通成员拿密码登也拒。
 *
 * - 没接飞书（本机、E2E、还没配应用的部署）：照旧谁都能用密码登。
 * - 系统管理员 = 业务角色总管理，没设业务线或带系统管理员标记（P-判定-06，permissions.ts 是系统管理员）。只读管理员（admin）不算。
 * - 部署时建的运维号（prisma/seed.ts 的 admin，账号角色 ADMIN）始终能登：系统运营要进来看实际运行（11-03 用户定）。
 * - 权限只认业务角色（11-01 定）：账号角色 ADMIN 本身不放行，没有兜底。刚部署、组织表里还没有系统管理员时，用运维号 admin 进来配。
 * - 没接入飞书的销售教练（11-25）：业务角色只有销售教练（coach）、又没绑飞书身份（feishuOpenId 为空）的也放行——
 *   客户的销售教练不在飞书组织里，由系统管理员在 设置 → 团队成员 新增、设初始密码。绑了飞书的教练照旧只能用飞书登；
 *   兼了别的业务角色的不放（兼总管理的按上面系统管理员的规矩判）。
 */
export async function 能用密码登录(user: { id: string; email: string; role: string; feishuOpenId: string | null }): Promise<boolean> {
  if ((await 飞书登录凭据()) === null) return true;
  if (user.email === 运维号 && user.role === "ADMIN") return true;
  const org = await 读组织();
  if (是系统管理员(user, org)) return true;
  return !user.feishuOpenId && 只是销售教练(org.成员.get(user.id)?.角色们 ?? []);
}

/** 业务角色只有销售教练一个（兼了别的不算） */
const 只是销售教练 = (角色们: readonly string[]): boolean => 角色们.length > 0 && 角色们.every((r) => r === "coach");

/** 接了飞书登录时，密码登不进的统一说法：不区分没这个号、密码错、不能用密码登（区分开就成了查号接口） */
export const 密码登录拒绝话 = "账号或密码不对。只有系统管理员和没接入飞书的销售教练能用账号密码登录，其他人请用飞书登录";
