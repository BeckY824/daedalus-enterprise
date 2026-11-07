/** 导入写入和项目落库共用的值类型与规整；单独成文件，让 apply 和 project-target 不互相依赖 */
export type 标量 = string | number | boolean | null;
export type 值表 = Record<string, 标量>;

/** 这一条写不进去（给人看的原因） */
export class 写不进 extends Error {}

/** 比对前规整："" / undefined → null，日期 → ISO */
export function 规(v: unknown): 标量 {
  if (v === undefined || v === null || v === "") return null;
  if (v instanceof Date) return v.toISOString();
  return v as 标量;
}
