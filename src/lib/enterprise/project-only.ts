import { getBusiness } from "@/lib/business";
import { 企业版 } from "./switch";

/**
 * 企业版只用项目一条线（10-26 用户：「去除掉商机，不要演用个人版的老模型。线索改名为新线索」）。
 *
 * 企业版开关 + 项目模式两样都开着才算：项目模式团队版也有，团队版那边商机照旧在。
 * 开着时：左栏、⌘K 没有商机，/opportunities 转到 /projects，客户页的商机一节换成项目，
 * 线索叫「新线索」，首页是对话框。只在服务端调；客户端组件由服务端读了当 prop 传下去。
 */
export async function 企业版只用项目(): Promise<boolean> {
  return 企业版() && (await getBusiness()).projectMode === true;
}
