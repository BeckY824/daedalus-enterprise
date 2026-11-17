/**
 * 静态守门（不连库）：打开渠道页 / 读渠道清单不写库（11-17 复盘第 7 类）。
 * 原来渠道页每次打开都给没挂主渠道的渠道补建同名主渠道（补主渠道），删了子渠道，影子主渠道还留着。
 * 现在主渠道只在「建渠道」那一刻挂好（channel-main.ts 建渠道挂主 / 找或建主渠道），这里守住：
 *   1. 补主渠道 不再回来；
 *   2. 建主渠道的两个函数只在写路径里调（渠道 server action、channel-main.ts 自己）；
 *   3. 页面（page / layout）和读清单的函数里不调它们，也不写渠道、主渠道表。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 根 = path.resolve(__dirname, "..");
const 读 = (相对: string) => fs.readFileSync(path.join(根, 相对), "utf8");

function 全部源文件(目录: string): string[] {
  const 出: string[] = [];
  for (const e of fs.readdirSync(path.join(根, 目录), { withFileTypes: true })) {
    const p = path.join(目录, e.name);
    if (e.isDirectory()) {
      if (e.name === "generated" || e.name === "node_modules") continue;
      出.push(...全部源文件(p));
    } else if (/\.(ts|tsx)$/.test(e.name)) 出.push(p);
  }
  return 出;
}
const 源们 = 全部源文件("src").map((f) => ({ f: f.split(path.sep).join("/"), s: 读(f) }));

/** 建主渠道的函数（会写 EntChannelMain） */
const 建主函数 = /(建渠道挂主|找或建主渠道)\s*\(/;
/** import 了建主渠道的函数 */
const 引建主函数 = /import\s*\{[^}]*(建渠道挂主|找或建主渠道)[^}]*\}\s*from/;
/** 往渠道 / 主渠道表里写 */
const 写渠道表 = /\.(channel|entChannelMain)\.(create|createMany|upsert|update|updateMany|delete|deleteMany)\s*\(/;

describe("读页面不写库：主渠道只在建渠道时挂", () => {
  it("补主渠道（打开页面补挂）不再回来", () => {
    expect(源们.filter((x) => /补主渠道\s*\(/.test(x.s)).map((x) => x.f)).toEqual([]);
  });

  it("建主渠道的函数只在写路径里调：channel-main.ts 自己、渠道 server action", () => {
    const 许 = new Set(["src/lib/enterprise/channel-main.ts", "src/app/(app)/channels/actions.ts"]);
    const 调了的 = 源们.filter((x) => 建主函数.test(x.s)).map((x) => x.f);
    expect(调了的.filter((f) => !许.has(f))).toEqual([]);
    // 渠道 server action 是 "use server" 写入口，不是页面
    expect(读("src/app/(app)/channels/actions.ts").trimStart().startsWith('"use server"')).toBe(true);
  });

  it("页面（page / layout）里不调建主渠道、不写渠道和主渠道表", () => {
    const 页 = 源们.filter((x) => /\/(page|layout)\.tsx?$/.test(x.f));
    expect(页.length).toBeGreaterThan(10);
    expect(页.filter((x) => 建主函数.test(x.s) || 写渠道表.test(x.s) || 引建主函数.test(x.s)).map((x) => x.f)).toEqual([]);
  });

  it("读清单的模块（来源下拉、筛选选项、渠道统计、看板）里不调建主渠道、不写渠道和主渠道表", () => {
    for (const f of ["src/lib/options.ts", "src/lib/enterprise/channel-options.ts", "src/lib/enterprise/channel-stats-db.ts", "src/lib/enterprise/channel-dash-db.ts"]) {
      const s = 读(f);
      expect(建主函数.test(s), f).toBe(false);
      expect(写渠道表.test(s), f).toBe(false);
    }
  });

  it("channel-main.ts 里的读函数（读主渠道们、主渠道入口们、能落的主渠道入口、新数据渠道不行）不写库", () => {
    const s = 读("src/lib/enterprise/channel-main.ts");
    for (const 名 of ["读主渠道们", "主渠道入口们", "能落的主渠道入口", "新数据渠道不行"]) {
      const 起 = s.indexOf(`export async function ${名}(`);
      expect(起, 名).toBeGreaterThan(-1);
      const 下一个 = s.slice(起 + 1).search(/\n(export |\/\*\*|async function )/);
      const 体 = s.slice(起, 下一个 < 0 ? undefined : 起 + 1 + 下一个);
      expect(建主函数.test(体), 名).toBe(false);
      expect(/\.(create|createMany|upsert|update|updateMany|delete|deleteMany)\s*\(/.test(体), 名).toBe(false);
    }
  });
});
