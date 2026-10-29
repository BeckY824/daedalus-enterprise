/**
 * 「上一次从云端同步下来的名字」这条记账的 key。
 *
 * 按它判断「这个名字是我们写的，还是人自己写的」（app/login 里原来那处桌面端登录分支已随企业版删掉）：
 *   desktop/server-entry.js —— 每次启动时（那边是裸 SQL，key 抄的是这里的值）
 *   lib/desktop/my-name.ts —— TS 侧读写这条记账
 *
 * 单独一个文件是为了让各处引用同一个常量；server-entry 抄不了 TS，
 * 但抄错了会被 tests/desktop-shell.test.ts 当场拦住。
 */
export const 同步名字键 = "desktop.syncedName";

/**
 * 模板库里本机管理员带的名字（prisma/seed.ts 种的「管理员」，邮箱「admin」），以及空名字。
 * 本机名字还是这些 = 人没改过，可以用云端账号名替上；不是这些就是人自己改过的，别人（云端、改身份）都不许盖掉。
 */
const 模板名字 = new Set(["", "管理员", "系统管理员", "admin"]);
export const 是模板名字 = (name: string | null | undefined) => 模板名字.has(String(name ?? "").trim());
