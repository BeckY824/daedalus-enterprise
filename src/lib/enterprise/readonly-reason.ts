/**
 * 客户详情顶上只读横幅（「全」只读）按这位客户为什么看得到来说（14-B 实点：项目组员、销管看连带可见的客户，横幅写「虚线下属 X 的客户」，其实不是虚线关系）。
 *
 * 原因只用已有的判定：虚线链 = 组织范围of 的 读 减 写（visibility.ts，虚线下属和他们的实线下属）；下属 = 实线下属；
 * 本线 = 条线总管理（line-viewer.ts 条线的线）看本线成员的；组员 = 我以组员身份加入了挂在这位客户上的项目（team-scope.ts 组员的客户）。
 * 判不出（市场成员相关、只看某人等）就说中性的「X 负责的客户」，不另造一套权限判断。
 */
import { 实线下属, type 组织 } from "./org-core";
import { 条线的线 } from "./line-viewer";
import { 组织范围of, 虚线只读话, 组员只读话 } from "./visibility";

export type 只读原因 = "虚线" | "下属" | "本线" | "组员" | null;

/** 按组织判得出的原因；组员要查库，调用方另给（组员 = 我加入的项目挂着这位客户） */
export function 只读原因of(org: 组织, 我: string, ownerId: string | null, 组员: boolean): 只读原因 {
  if (ownerId) {
    const 范围 = 组织范围of(org, null, 我);
    if (范围?.读 && 范围.读.includes(ownerId) && !范围.写.includes(ownerId)) return "虚线";
    if (实线下属(org, 我).has(ownerId)) return "下属";
    const 线 = 条线的线(org, 我);
    if (线 && org.成员.get(ownerId)?.line === 线) return "本线";
  }
  return 组员 ? "组员" : null;
}

/** 中性说法：服务端那句（话）是给整个人的，说的原因和这位客户对不上时用它 */
const 中性话 = "只能看，不能改、不能转";

/**
 * 横幅的标题和说明。话 = 服务端 只读话（按整个人给的那一句，lib/team-scope.ts）：原因对得上才照用，对不上换中性的
 */
export function 只读横幅(原因: 只读原因, 负责人: string, 客户: string, 话: string): { 标题: string; 说明: string } {
  const 说 = (s: string) => `${s}。要改请找${原因 === "虚线" ? "他的直属上级" : "负责人"}或总管理`;
  switch (原因) {
    case "虚线":
      return { 标题: `虚线下属 ${负责人} 的${客户} · 只能看`, 说明: 说(虚线只读话) };
    case "下属":
      return { 标题: `下属 ${负责人} 的${客户} · 只能看`, 说明: 说(中性话) };
    case "本线":
      return { 标题: `本线 ${负责人} 的${客户} · 只能看`, 说明: 说(中性话) };
    case "组员":
      return { 标题: `因参与项目可见：${负责人} 负责的${客户} · 只能看`, 说明: 说(组员只读话) };
    default:
      // 市场成员相关、只看某人的那句照用；说虚线、说组员的那几句和这位对不上，换中性的
      return { 标题: `${负责人} 负责的${客户} · 只能看`, 说明: 说(话.includes("虚线下属") || 话 === 组员只读话 ? 中性话 : 话) };
  }
}
