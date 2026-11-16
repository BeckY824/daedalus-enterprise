import fs from "node:fs";
import path from "node:path";

/**
 * 企业版范围的跨进程「纪元」（11-16 用满 4 核）：数据目录里的 `.scope-epoch`，**文件大小就是纪元**。
 *
 * 为什么：范围缓存（visibility.ts）在每个进程里各有一份，忘掉企业版范围() 原来只清本进程。
 * 多个 node 进程共用一个库时，改组织、移出项目组、退公海之后，别的进程至少还按旧范围读写 10 秒，
 * 夜里后台进程里的那次作废更是永远到不了别的进程。
 *
 * 怎么做：作废 = 往文件末尾追加一个字节（O_APPEND，多个进程同时加也不会丢）；读 = stat 看大小（几微秒，只增不减，
 * 不受时间戳精度影响）。不走 Prisma、不走设置缓存：范围本身就是在每条查询的限定钩子里算的，
 * 读纪元再去查库会绕回钩子（递归），在事务里还会等自己那条写连接。
 *
 * 文件放在库文件旁边（DATABASE_URL 的目录，同 home-cache 认 -shm 的办法：只认 file:/绝对路径）。
 * 认不出目录时回 null：只有本进程那一份作废，和原来一样（单进程部署不受影响）
 */
export function 纪元文件(url = process.env.DATABASE_URL ?? ""): string | null {
  if (!url.startsWith("file:")) return null;
  const 库 = url.slice(5).split("?")[0];
  return 库 && path.isAbsolute(库) ? path.join(path.dirname(库), ".scope-epoch") : null;
}

/** 现在的纪元：文件大小；文件还没有 = 0；认不出目录 = -1（永远不变） */
export function 读纪元(文件 = 纪元文件()): number {
  if (!文件) return -1;
  try {
    return fs.statSync(文件).size;
  } catch {
    return 0;
  }
}

let 报过错 = false;

/** 纪元加一：所有进程下一次用范围缓存前都会发现、清掉自己那份。写不进去只记一次日志，不挡调用方 */
export function 加纪元(文件 = 纪元文件()): void {
  if (!文件) return;
  try {
    fs.appendFileSync(文件, ".");
  } catch (e) {
    if (!报过错) {
      报过错 = true;
      console.error(`范围纪元写不进 ${文件}：别的进程的范围缓存要等 10 秒过期才换`, e);
    }
  }
}
