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
 * - 系统管理员 = 业务角色总管理、没设业务线（permissions.ts 是系统管理员）。只读管理员（admin）不算。
 * - 部署时建的运维号（prisma/seed.ts 的 admin，账号角色 ADMIN）始终能登：系统运营要进来看实际运行（11-03 用户定）。
 * - 兜底：组织表里一个系统管理员都还没有（刚部署、还没配业务角色）时，账号角色 ADMIN 的能登，免得谁都进不去。
 */
export async function 能用密码登录(user: { id: string; email: string; role: string }): Promise<boolean> {
  if ((await 飞书登录凭据()) === null) return true;
  if (user.email === 运维号 && user.role === "ADMIN") return true;
  const org = await 读组织();
  if (是系统管理员(user, org)) return true;
  // 组织.成员 只含在职的人
  const 有系统管理员 = [...org.成员.keys()].some((id) => 是系统管理员({ id }, org));
  return !有系统管理员 && user.role === "ADMIN";
}

/** 接了飞书登录时，密码登不进的统一说法：不区分没这个号、密码错、不是系统管理员（区分开就成了查号接口） */
export const 密码登录拒绝话 = "账号或密码不对。只有系统管理员能用账号密码登录，其他人请用飞书登录";
