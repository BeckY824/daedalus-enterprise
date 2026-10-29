/**
 * 企业版项目模式的左栏（10-29 客户定稿）：六个根目录，顺序 首页 / 复盘 / 渠道 / 公海 / 客户 / 项目。
 * 客户原话：「联系人划掉了，不再是根目录，新增联系人放到客户里」。
 *
 *   - 复盘 = /overview（原来叫「数据」，10-29 叫过「看板」；定稿 -2 版改叫「复盘」），页头也叫「复盘」
 *   - 公海 = /pool（P7 统一公海：客户公海 + 项目公海一张表）；客户页、项目页带 pool=1 的老链接服务端转过去
 *   - 跟进、新线索、联系人不进左栏：路由都留着，⌘K 搜得到；新线索、跟进的入口在项目页页头，
 *     联系人在客户档案里加（左栏亮「客户」）
 *
 * 只给 企业版() && projectMode 用；别的版本的左栏照旧在 AppShell 里拼。纯函数，不碰界面，好测。
 */

/** P7 统一公海（10-29）；之前指客户页的公海页签 /customers?pool=1 */
export const 公海入口 = "/pool";

export type 根目录图 = "首页" | "复盘" | "渠道" | "公海" | "客户" | "项目";
export type 根目录 = {
  /** 链接去哪、也是亮哪一项的键 */
  key: string;
  label: string;
  图: 根目录图;
  /** 挂「要跟」那个红数：跟进不进左栏了，它的入口在项目页页头，红数跟着挂到「项目」上 */
  挂要跟?: true;
};

/** 左栏六项。客户叫法跟着业务配置（客户 / 学员…） */
export function 企业版根目录(客户叫法: string): 根目录[] {
  return [
    { key: "/dashboard", label: "首页", 图: "首页" },
    { key: "/overview", label: "复盘", 图: "复盘" },
    { key: "/channels", label: "渠道", 图: "渠道" },
    { key: 公海入口, label: "公海", 图: "公海" },
    { key: "/customers", label: 客户叫法, 图: "客户" },
    { key: "/projects", label: "项目", 图: "项目", 挂要跟: true },
  ];
}

const 在 = (pathname: string, k: string) => pathname === k || pathname.startsWith(k + "/");

/**
 * 当前地址亮哪一项。不在左栏的页挂到它的入口那一项上，左栏总有一项亮着，人知道自己在哪条线上：
 *   新线索、跟进 → 项目（入口在项目页页头）；联系人 → 客户（联系人在客户档案里加）
 * /pool 和客户列表带着 pool=1（老链接，服务端转去 /pool）都是公海；客户档案页认不出是不是公海里的，亮「客户」。
 * 认不出的路径返回 null，交给 AppShell 按原来的办法算（设置、反馈之类）。
 */
export function 企业版亮项(pathname: string, pool: string | null): string | null {
  if (pathname === "/customers" && pool === "1") return 公海入口;
  if (在(pathname, "/customers") || 在(pathname, "/contacts")) return "/customers";
  if (在(pathname, "/projects") || 在(pathname, "/leads") || 在(pathname, "/follow-ups")) return "/projects";
  for (const k of ["/dashboard", "/overview", "/channels", 公海入口]) if (在(pathname, k)) return k;
  return null;
}

/**
 * 网页版标签页标题用的页名（「公海 · 产品名」）。不在左栏的几页也写上自己的名字，不跟着亮项叫「项目」。
 * 认不出的返回空串，不碰标题。
 */
export function 企业版页名(pathname: string, pool: string | null, 客户叫法: string): string {
  if (pathname === "/customers" && pool === "1") return "公海";
  if (在(pathname, "/leads")) return "新线索";
  if (在(pathname, "/follow-ups")) return "跟进";
  if (在(pathname, "/contacts")) return "联系人";
  if (在(pathname, "/settings")) return "设置";
  const k = 企业版亮项(pathname, pool);
  return 企业版根目录(客户叫法).find((x) => x.key === k)?.label ?? "";
}
