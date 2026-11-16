/**
 * 截 Prisma 的 query 日志（$on("query")）来看「真发出去的句子」的用例，读之前先 等日志齐()。
 *
 * 为什么（11-16 perf-85k-round4 在 CI 上报「没截到查客户表的句子」）：Prisma 引擎把查询结果和 query 日志事件
 * 各走各的回调送回 JS，两边谁先到不保证——await 一条查询返回时，它自己（和前几条）的日志可能还在路上。
 * 同进程里还有别的客户端在查、或者机器负载高时就会发生。本机探针（一个客户端查 5000 次，同进程另两个客户端同时在查）：
 * 机器一般忙时 5000 次里 14 次晚到，另起 16 个空转进程占满 CPU 时 2442 次晚到；晚到的日志一条没丢、先后顺序也没乱过。
 * 所以 await 一返回就去 句 里找，会偶尔找不到（undefined），或者把上一段晚到的日志当成这一段的。
 *
 * 怎么等：同一个客户端的日志按发出的先后到。在它上面补一句带记号的查询，等这句的日志到了，
 * 之前所有查询的日志都已经到了。记号那条从 句 里删掉，不影响按条数、按位置取的断言。
 */
type 有裸查询 = { $queryRawUnsafe: (sql: string, ...值: unknown[]) => Promise<unknown> };
type 一句 = string | { query: string };

let 号 = 0;
const 文 = (x: 一句) => (typeof x === "string" ? x : x.query);

export async function 等日志齐(db: 有裸查询, 句: 一句[], 最多毫秒 = 15_000): Promise<void> {
  const 记号 = `__等日志齐_${process.pid}_${++号}`;
  await db.$queryRawUnsafe(`SELECT 1 AS "${记号}"`);
  const 到 = Date.now() + 最多毫秒;
  for (;;) {
    const i = 句.findIndex((x) => 文(x).includes(记号));
    if (i >= 0) {
      句.splice(i, 1);
      return;
    }
    // 记号是在这个客户端上 await 回来的，它的日志迟早会到；真等不到说明日志没挂在这个客户端上，别静默过去
    if (Date.now() > 到) throw new Error(`等日志齐：${最多毫秒} ms 还没等到记号那句的 query 日志——句 是不是挂在别的客户端上？`);
    await new Promise((r) => setTimeout(r, 2));
  }
}

/**
 * 「换掉生成的 PrismaClient、记.开 开着才记」那种写法（客户列表 / 详情 / 看板数查询条数的几份）：
 * 主连接、只读通道各是一个客户端，量的时候每个都要等齐。晚到的日志进来时开关已经关了，会被直接丢掉——
 * 条数少数、该有的句子没截到。用法：先换一个空数组、打开开关、等齐一次再清空（上一段晚到的不混进来，
 * 也别塞进上一段已经交出去的数组），量完、关开关之前再等齐一次
 */
export async function 都等齐(们: Iterable<有裸查询>, 句: 一句[]): Promise<void> {
  for (const c of [...们]) await 等日志齐(c, 句);
}
