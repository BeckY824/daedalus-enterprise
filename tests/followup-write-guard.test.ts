/**
 * 守门（11-18 复盘第 5 类「多个入口写同一件事，守门只装了一部分」）：企业版沟通必须挂项目（11-17 客户定）。
 * src 里凡是新建沟通（FollowUp create / createMany / upsert）的地方，都得在下面清单里说清走哪条路：
 *   - 过守门：所在函数里调 定沟通挂哪个项目 / 能往项目记沟通（lib/project/follow-needs-project.ts）；
 *   - 同事务建项目：同一个函数里建项目（或补潜客培育）再把这条沟通挂上去；
 *   - 找不到项目改挂潜客培育：导入、导入撤回后恢复，挂不上就不写（lib/project/nurture.ts 沟通挂潜客培育）；
 *   - 系统豁免：同号再次录入自动留的记录、演示数据，写明理由。
 * 新加一处写沟通、又不在清单里就报错：要么走共用的守门，要么在清单里写明为什么不用。不连库、不 import 业务代码。
 * 也不许用原生 SQL 往 FollowUp 里插。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { 源文件们, 找写处, type 写处 } from "./helpers/source-scan";

const 文件们 = 源文件们();
const 写处们 = 找写处(文件们, /\.followUp\.(create|createMany|upsert)\(/g);

type 类 = "过守门" | "同事务建项目" | "找不到项目改挂潜客培育" | "系统豁免";
/** 文件 + 所在顶层函数 → 走哪条路；须含 = 所在函数里必须看得到的写法（守门真的在用，不是只写了个名字） */
const 清单: { 文件: string; 函数: string; 类: 类; 须含: RegExp[]; 为什么: string }[] = [
  { 文件: "app/(app)/customers/[id]/actions.ts", 函数: "saveFollowUp", 类: "过守门", 须含: [/定沟通挂哪个项目\(/], 为什么: "客户页记沟通、AI 卡、完成跟进计划都走这里" },
  { 文件: "lib/project/db.ts", 函数: "记项目沟通", 类: "过守门", 须含: [/能往项目记沟通\(/, /followUpProject\.create\(/], 为什么: "项目详情记沟通：挂的就是这个项目，核过在推、能记" },
  { 文件: "app/(app)/customers/[id]/project-actions.ts", 函数: "给客户建项目", 类: "同事务建项目", 须含: [/\.project\.create\(/, /followUpProject\.create\(/], 为什么: "客户页新开项目连同首条沟通" },
  { 文件: "lib/project/wizard.ts", 函数: "向导接着建", 类: "同事务建项目", 须含: [/\.project\.create\(/, /followUpProject\.create\(/], 为什么: "建档向导：客户、项目、首条沟通一起建" },
  { 文件: "lib/project/wizard.ts", 函数: "只建客户接着建", 类: "同事务建项目", 须含: [/建潜客培育\(/, /followUpProject\.create\(/], 为什么: "只建客户：企业版首条沟通挂新客户自带的潜客培育项目（21D）" },
  { 文件: "lib/project/from-lead.ts", 函数: "线索建项目", 类: "同事务建项目", 须含: [/\.project\.create\(/, /followUpProject\.create\(/], 为什么: "线索转化：项目和首条跟进一起建" },
  { 文件: "lib/enterprise-import/apply.ts", 函数: "建", 类: "找不到项目改挂潜客培育", 须含: [/写不进\(沟通没对上项目话\)/, /沟通挂潜客培育\(/], 为什么: "导入：没对上项目不导；给了项目却找不到改挂潜客培育" },
  { 文件: "lib/enterprise-import/revert.ts", 函数: "建回", 类: "找不到项目改挂潜客培育", 须含: [/沟通挂潜客培育\(/, /不动\(沟通没对上项目话\)/], 为什么: "撤回后恢复：原来挂的项目不在了改挂潜客培育，挂不上不建回" },
  { 文件: "lib/enterprise/same-number-collab.ts", 函数: "同号再次录入", 类: "系统豁免", 须含: [], 为什么: "同号再次录入系统自动留的记录（规则里写明不受限），有项目就挂" },
  { 文件: "lib/enterprise/same-number-collab.ts", 函数: "同号只记备注", 类: "系统豁免", 须含: [/followUpProject\.create\(/], 为什么: "导入撞同号：只在已有项目上记一笔醒目备注，挑不到项目就不记" },
  { 文件: "lib/shared-ws/dataset.ts", 函数: "灌演示数据", 类: "系统豁免", 须含: [], 为什么: "共享工作区的演示数据（团队版网页演示），不走企业版" },
];

const 在清单 = (w: 写处) => 清单.find((x) => x.文件 === w.文件 && x.函数 === w.函数);

describe("新建沟通都走守门或写明理由（复盘第 5 类）", () => {
  it("扫得到：写处够多（防扫描本身坏了白过）", () => {
    expect(写处们.length).toBeGreaterThanOrEqual(10);
    expect(写处们.filter((w) => !w.函数)).toEqual([]);
  });

  it("每一处写沟通都在清单里（新加的路先走 定沟通挂哪个项目，或在清单里写明理由）", () => {
    const 坏 = 写处们.filter((w) => !在清单(w)).map((w) => `${w.位置}（${w.函数}）`);
    expect(坏).toEqual([]);
  });

  it("清单里每条的守门真的在所在函数里", () => {
    const 坏: string[] = [];
    for (const w of 写处们) {
      const x = 在清单(w);
      for (const re of x?.须含 ?? []) if (!re.test(w.函数体)) 坏.push(`${w.位置}（${w.函数}，${x!.类}）缺 ${re}`);
    }
    expect(坏).toEqual([]);
  });

  it("清单每条都还用得上（代码改了就删掉）", () => {
    for (const x of 清单) expect([x.文件, x.函数, 写处们.some((w) => w.文件 === x.文件 && w.函数 === x.函数)]).toEqual([x.文件, x.函数, true]);
  });

  it("不用原生 SQL 往 FollowUp 里插", () => {
    const 坏 = 文件们.filter((f) => /INSERT\s+INTO\s+["`]?FollowUp["`]?[\s(]/i.test(fs.readFileSync(f, "utf8")));
    expect(坏).toEqual([]);
  });
});
