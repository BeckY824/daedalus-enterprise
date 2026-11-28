/**
 * 销售角色（叶子文件，不 import 任何业务模块）：销售、销售管理。
 * 放这里是为了 assign-line.ts 不必从 permissions.ts 导入（permissions.ts 本来就导入 assign-line.ts，会成环）。
 */
export const 销售角色 = ["sales", "sales_mgr"] as const;
/** 同一份集合给自动分配（assign-line.ts）、线索分配（lead-assign.ts）按字符串角色判断用 */
export const 销售角色集: ReadonlySet<string> = new Set<string>(销售角色);
