/**
 * 筛选栏的「哪些摆在外面」（11-06）：搜索框、子集标记、页签、排序固定不动，其余下拉由用户自己挑。
 * 默认就是系统原来的样子；存这台机器上，存法和「列」一样（藏起来的默认项记成 `-键`），之后新加的默认项照样补上。
 */
import { 切换后存, 算可见列 } from "./list-select";

export type 筛选项元 = {
  键: string;
  默认外露: boolean;
  /** 正筛着没有：收在「更多筛选」里的也要把数字写在按钮上 */
  有值: boolean;
  /**
   * 筛选行一行放不下时先收进「更多筛选」（11-12 客户列表的阶段 / 进程：定稿摆在外面，全站筛选行一行）。
   * 只是这一刻放不下，不改存下的「摆在外面」，宽了自己回来
   */
  挤?: boolean;
};

export const 筛选偏好键 = (页: string) => `list-filters:${页}`;

/** 外露顺序跟定义顺序走：哪一项排在哪由页面定，勾选的先后不打乱排版。挤掉 = 筛选行放不下，带「挤」的外露项这一刻收进「更多筛选」 */
export function 拆筛选项<T extends 筛选项元>(项: readonly T[], 存的: readonly string[] | null, 挤掉 = false) {
  const 可见 = 算可见列(项.map((x) => ({ 键: x.键, 默认显示: x.默认外露 })), 存的);
  const 看得见 = new Set(可见.filter((k) => !挤掉 || !项.find((x) => x.键 === k)?.挤));
  const 外露 = 项.filter((x) => 看得见.has(x.键));
  const 收着 = 项.filter((x) => !看得见.has(x.键));
  return { 可见, 外露, 收着, 筛了几个: 收着.filter((x) => x.有值).length };
}

export function 切换外露(可见: readonly string[], 存的: readonly string[] | null, 键: string, 外露: boolean): string[] {
  return 切换后存(可见, 存的, 键, 外露);
}
