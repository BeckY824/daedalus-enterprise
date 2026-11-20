/**
 * 同号再次录入的系统留痕怎么认（same-number-collab.ts 同号再次录入 / 导入撞号 同号只记备注 写的那条沟通记录）。
 * 单拎一个文件：三态、最近跟进、导入这些地方要排除它，不用为了两个常量把 same-number-collab.ts 整套依赖拉进来。
 *
 * 不加字段：标题以 同号标题 开头就是它（「同号再次录入」「同号再次录入（来源不同）」）；挂项目时节点写 同号节点，但没项目时只挂客户、没有节点，
 * 所以排除一律按标题认。它不算沟通（P-沟通-03）：不拨三态钟、不清冷标、不重置继续持有 / 暂缓回收额度、不续客户最近跟进（11-03 设计，用户 11-20 再定）
 */
export const 同号标题 = "同号再次录入";
/** 挂项目时的节点：不是真实节点，详情沟通时间线上正好显示成标签 */
export const 同号节点 = "同号再次录入";

export const 是同号留痕 = (title: string | null | undefined): boolean => !!title?.startsWith(同号标题);

/** Prisma 的 FollowUp where 片段：不是同号留痕（并进 where，原 where 里不能另有 NOT） */
export const 不是同号留痕 = { NOT: { title: { startsWith: 同号标题 } } };

/** 裸 SQL 的条件：不是同号留痕。表 = FollowUp 的别名，不带别名就是裸列名。同号标题是代码里的常量、没有 % _ 通配符 */
export const 不是同号留痕SQL = (表?: string): string => `${表 ? `${表}.` : ""}"title" NOT LIKE '${同号标题}%'`;
