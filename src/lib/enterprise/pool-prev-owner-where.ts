/**
 * 回避名单根因（E-417）：按 poolPrevOwnerId 两列判回避时共用的 where 写法。纯函数、不引别的模块（team-scope、对拍脚本、各处读取都拼它）。
 *
 * 可空列的坑：poolPrevOwnerId 为空的行，SQL 里 NOT (列 = 我) 是 NULL，会被一起挡掉（Prisma 的 { not: 我 }、NOT { 列: 我 } 都一样），
 * 所以「不是我」一律写成「为空或不是我」，team-scope 的回避条件、对拍的互补核对、不回避条件 都用这一句。
 */
export type 不是我写法 = (id: string) => Record<string, unknown>;
export const 为空或不是我: 不是我写法 = (id) => ({ OR: [{ poolPrevOwnerId: null }, { NOT: { poolPrevOwnerId: id } }] });
