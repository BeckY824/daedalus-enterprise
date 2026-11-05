/**
 * 企业版「按组织架构看客户」（2026-10-24，规则开关 规则.按组织看客户）。
 *
 * 和团队版业务员限定共用一层（lib/team-scope.ts 的 加上限定），这里只回答「这个请求的人看得到、改得到谁负责的客户」：
 *   - 总管理（业务角色 director，11-01 起不看账号 ADMIN）：看全部，不限定；没设业务角色的只看公海；
 *   - 管理员（admin，11-01 晚）：看全部，但带 只读 —— lib/team-scope.ts 加上限定 每条写都拒；
 *   - 管理员设了业务线（11-02）：同样带 只读，但只看这条线（line-viewer.ts），规则开不开都一样；
 *   - 规则「按组织看客户」关着：照旧不限定，但没设业务角色的照样只看公海、管理员照样只读（QA #2：没设业务角色 = 没权限）；
 *   - 其余：**改** = 自己 + 实线下属（直属上级链往下整条）负责的客户 + 公海；
 *     **看** = 改的范围 + 虚线下属和他们的实线下属负责的客户——虚线上级只能看，不能改、不能转，
 *     那些客户下面也不能新建任何东西（跟进也不行，和团队版互看「能加跟进」不同）。
 *
 * 认人：企业版是网页（自部署），按请求认——读 crm_session 这张会话票（同 lib/auth.ts，那边带 next/headers 顶层 import，
 * 测试里用不了，这里自己验）。MCP 这类不走 cookie 的入口用 以谁的身份() 包住。
 *   - 没有请求（定时任务、启动时）= 不限定：后台本来就要看全部；
 *   - 有请求但没登录 / 票不对 / 人停用了 = 只看公海（这种请求页面会跳登录，这里只是别漏）。
 *
 * 缓存 10 秒，按会话票分开；到期先用旧的、后台再认一次——理由同 team-scope 现在的限定：
 * 这一句常落在交互式事务里，SQLite 只开一个连接，现查要等事务放连接。改组织、拨开关后 忘掉企业版范围()。
 */
import { 全进程上下文 } from "@/lib/process-als";
import { jwtVerify } from "jose";
import type { PrismaClient } from "@/generated/prisma";
import { readSecret } from "@/lib/secret";
import { 看得到, 组员的客户, type 限定, type 公海回避 } from "@/lib/team-scope";
import { 回收站副手键, 只看某人键, 填组织设置, 建组织, 实线下属, 虚线下属, 管理员类别们of, type 组织 } from "./org-core";
import { 按线范围of, 按线项目, 按线客户 } from "./line-viewer";
import { 规则 } from "./rules";
import { 市场部门key, 市场成员key, 市场成员们, 市场相关客户, 市场只读话, 规整市场部门 } from "./market";
import { 视图票, 验视图票 } from "./view-as";
import { 能看全部, 只读角色, 只读角色话, 只看的人, 只看某人话, 没设业务角色, 业务线放行 } from "./permissions";

/** lib/auth.ts 的 COOKIE */
const 会话票 = "crm_session";
export const 虚线只读话 = "这是虚线下属的客户：只能看，不能改、不能转";
/** 虚线下属和市场成员相关（10-31）两样都有时：挡下那一句不说死是哪一样 */
/** 只因为进了项目组看得到的客户（V3.5.1） */
export const 组员只读话 = "这是你加入的项目挂着的客户：只能看，不能改、不能记沟通；被指定为负责人才能改";
export const 虚线或市场只读话 = "这是虚线下属或市场成员相关的客户：只能看，不能改、不能转";
/** 没认出人：只看公海（谁的 id 都不会是这个） */
const 只看公海: 限定 = { 我: ["__无"], 互看: false, 别人的: new Set() };

/**
 * 算范围（纯函数，测试直接用）：null = 看全部。
 * 写 = 自己 + 实线下属；读 = 写 + 每个虚线下属和他的实线下属。读比写多才带 读，不然和普通限定一样
 */
export function 组织范围of(org: 组织, _账号角色: string | null, 我: string): { 写: string[]; 读?: string[] } | null {
  // 管理员设了业务线：看这条线的成员和下属（看板、复盘的选人框也从这里来），写在 加上限定 那边全拒
  const 按线 = 按线范围of(org, 我);
  if (按线) return { 写: [我], 读: 按线.人们 };
  // 11-01 只认业务角色（lib/enterprise/permissions.ts）：账号 ADMIN 不再看全部，总管理看业务角色；没设业务角色 = 只看公海
  if (能看全部({ id: 我 }, org)) return null;
  if (没设业务角色(org, 我)) return { 写: ["__无"] };
  // 管理类成员按自己的业务线过滤下属（外贸只看外贸、内贸只看内贸；自己没设业务线不限，同 业务线放行）
  const 线上 = (x: string) => 业务线放行(org, 我, { ownerId: x });
  const 写 = new Set([我, ...[...实线下属(org, 我)].filter(线上)]);
  const 读 = new Set(写);
  // 虚线下属（D-39 只读）是专门跨线配的，不按业务线滤
  for (const d of 虚线下属(org, 我)) for (const x of [d, ...实线下属(org, d)]) 读.add(x);
  return 读.size > 写.size ? { 写: [...写], 读: [...读] } : { 写: [...写] };
}

const 身份 = 全进程上下文<string>("以谁的身份");

/** 不走 cookie 的入口（MCP 用令牌认人）：这一段里的查询按这个人算范围 */
export function 以谁的身份<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return 身份.run(userId, async () => await fn());
}

type 缓存项 = { 值: 限定 | null; 到: number };
const g = globalThis as unknown as { __企业范围?: Map<string, 缓存项>; __企业范围刷新?: Map<string, Promise<限定 | null>> };
const 缓存 = () => (g.__企业范围 ??= new Map());
const 刷新中 = () => (g.__企业范围刷新 ??= new Map());

/** 组织、规则开关、人员改了：别等缓存过期 */
export function 忘掉企业版范围() {
  g.__企业范围 = undefined;
  g.__企业范围刷新 = undefined;
}

/**
 * next/headers 只 import 一次：每条查询都动态 import 一回不值；
 * 而且测试里几条查询同时首次 import 时，vitest 的 mock 会有一条拿到真模块（真 cookies() 在请求外抛错 → 当成后台 → 不限定）
 */
let 头: Promise<typeof import("next/headers")> | undefined;

/** 现在这个请求是谁：钥 = 缓存的键；id = null 是有请求但没认出人；"无请求" = 后台 */
async function 是谁(): Promise<{ 钥: string; id: string | null } | "无请求"> {
  const o = 身份.getStore();
  if (o) return { 钥: `u:${o}`, id: o };
  let 票: string | undefined;
  let 视: string | undefined;
  try {
    const { cookies } = await (头 ??= import("next/headers"));
    const c = await cookies();
    票 = c.get(会话票)?.value;
    视 = c.get(视图票)?.value;
  } catch (e) {
    // Next 静态渲染时的「这页要动态」信号带 digest，得原样抛回去
    if (e && typeof e === "object" && "digest" in e) throw e;
    return "无请求";
  }
  if (!票) return { 钥: "无", id: null };
  try {
    const { payload } = await jwtVerify(票, new TextEncoder().encode(readSecret()));
    if (typeof payload.sub !== "string") return { 钥: "无", id: null };
    // 总管理员切换视图（M-权限-08，view-as.ts）：按被看的那个人算范围
    const 看 = 视 ? await 验视图票(视, payload.sub) : null;
    if (看) return { 钥: `v:${票}:${看.谁}`, id: 看.谁 };
    return { 钥: `t:${票}`, id: payload.sub };
  } catch {
    return { 钥: "无", id: null };
  }
}

/**
 * 这个请求的企业版范围：null = 不限定（规则关着、老板 / 总管理员、后台任务）。
 * 调用方（team-scope 现在的限定）已判过 企业版()
 */
export async function 企业版范围(db: PrismaClient): Promise<限定 | null> {
  const 人 = await 是谁();
  if (人 === "无请求") return null;
  const 现 = 缓存().get(人.钥);
  if (现 && 现.到 > Date.now()) return 现.值;
  if (现) {
    void 认一次(db, 人.钥, 人.id).catch(() => {});
    return 现.值;
  }
  return 认一次(db, 人.钥, 人.id);
}

function 认一次(db: PrismaClient, 钥: string, id: string | null): Promise<限定 | null> {
  const 在跑 = 刷新中().get(钥);
  if (在跑) return 在跑;
  const 表 = 刷新中();
  const p = 算(db, id)
    .then((值) => {
      // 认的过程中被忘掉过：结果可能是旧的，不写
      if (g.__企业范围刷新 === 表) {
        const c = 缓存();
        if (c.size > 500) c.clear();
        c.set(钥, { 值, 到: Date.now() + 10_000 });
      }
      return 值;
    })
    .finally(() => {
      if (表.get(钥) === p) 表.delete(钥);
    });
  表.set(钥, p);
  return p;
}

/** 规则开关的 Setting 值：只有存的是 true 才算开（同 rules.ts 规则开着，这里在钩子里，直接读 db） */
async function 开着(db: PrismaClient, key: string): Promise<boolean> {
  const v = await db.setting.findUnique({ where: { key }, select: { value: true } });
  try {
    return !!v && JSON.parse(v.value) === true;
  } catch {
    return false;
  }
}

async function 算(db: PrismaClient, id: string | null): Promise<限定 | null> {
  if (!id) return 只看公海;
  const 规则开着 = await 开着(db, 规则.按组织看客户.key);

  const [users, members, depts, 设的市场部门, 设的市场人, 副手, 只看] = await Promise.all([
    db.user.findMany({ select: { id: true, role: true, active: true } }),
    db.entMember.findMany(),
    db.entDept.findMany({ select: { id: true, name: true, parentId: true, sort: true } }),
    db.setting.findUnique({ where: { key: 市场部门key }, select: { value: true } }),
    db.setting.findUnique({ where: { key: 市场成员key }, select: { value: true } }),
    db.setting.findUnique({ where: { key: 回收站副手键 }, select: { value: true } }),
    db.setting.findUnique({ where: { key: 只看某人键 }, select: { value: true } }),
  ]);
  const 我 = users.find((u) => u.id === id);
  if (!我 || !我.active) return 只看公海;
  const org = 填组织设置(建组织(users, members, depts), 副手?.value, 只看?.value);
  // 管理员（admin）：看全部、写全拒（规则开不开都一样）
  if (只读角色({ id }, org)) {
    const 线 = 按线范围of(org, id);
    if (!线) return { 我: null, 互看: false, 别人的: new Set(), 只读: 只读角色话 };
    // 设了业务线：按人的那一半走 读 + 市场（看得到客户、raw SQL 回退 Prisma），按标签的那一半走 按线
    return {
      我: [id], 读: 线.人们, 市场: 线.人们, 组员客户: await 组员客户of(db, 线.人们), 按线: { 本人: id, 项目: 按线项目(线), 客户: 按线客户(线) },
      互看: false, 别人的: new Set(), 全拦: true, 话: 只读角色话, 只读: 只读角色话,
    };
  }
  // 只看某人（V3.5.1 市管特例，规则开不开都算）：业务数据只看 那个人（和自己）是负责人、或是创建人且不在公海的，公海照常；
  // 按人的走 读（负责人）+ 市场（11-04：负责的 + 建的且不在公海），都只读。自己没东西能写（permissions.ts 一律拒），写范围只留自己
  const 目标 = 只看的人(org, id);
  if (目标) {
    const 人们 = [id, 目标];
    const 回避 = await 公海回避of(db, id);
    const 那些 = await db.customer.findMany({ where: 市场相关客户(人们), select: { id: true, salesOwnerId: true, channelOwnerId: true, pool: { select: { customerId: true } } } });
    const 别人的 = new Set(那些.filter((c) => !看得到(c, [id])).map((c) => c.id));
    return { 我: [id], 读: 人们, 市场: 人们, 组员客户: await 组员客户of(db, 人们), 互看: false, 别人的, 全拦: true, 话: 只看某人话, ...(回避 ? { 公海回避: 回避 } : {}) };
  }
  // 规则关着：原来一律不限定；11-01 起没设业务角色的照样没权限（只看公海）；
  // 原负责人回避（11-03）规则开不开都算，能看全部的（总管理等）不回避
  if (!规则开着) {
    if (能看全部({ id }, org)) return null;
    const 回避 = await 公海回避of(db, id);
    if (没设业务角色(org, id)) return 回避 ? { ...只看公海, 公海回避: 回避 } : 只看公海;
    return 回避 ? { 我: null, 互看: false, 别人的: new Set(), 公海回避: 回避 } : null;
  }
  const 范围 = 组织范围of(org, 我.role, id);
  if (!范围) return null;
  const 回避 = await 公海回避of(db, id);
  const 带回避 = 回避 ? { 公海回避: 回避 } : {};
  const 类别 = 管理员类别们of(org, id);
  // 市场管理分线索（同 lead-assign 能分配；老板、总管理员上面已经不限定）：线索开着分配时，没分的 + 市场圈（本人 + 实线下属）
  // 负责的都能看能改，不然分出去就看不到、也分不了（F9 10-25；11-05 收窄到市场圈）。客户那条线还是按组织架构
  const 线索 = 类别.has("市场管理") && (await 开着(db, 规则.线索分配.key)) ? { 线索全看: true, 线索圈: 范围.写 } : {};
  const 市场 = 市场的人(org, id, 类别.has("市场管理"), 设的市场部门?.value, 设的市场人?.value);
  // 市场管理（11-05 客户定）：本人 + 直属下级建的项目（线索）不管什么状态都看得到，只读；直属下级不论是不是市场成员
  const 带市场全看 = 类别.has("市场管理") ? { 市场全看: [id, ...实线下属(org, id, 1)] } : {};
  // 项目组员（V3.5.1）：加入的项目挂的客户级联看得到、只能看（不记沟通、不改）。自己（含实线下属）负责的、公海的不降；
  // 自己负责的项目挂着的也不算只读（被指定为负责人才能编辑，在项目下记沟通）
  const 写 = 范围.写;
  const 组员只读 = new Set<string>();
  const 组员的 = await db.customer.findMany({
    where: 组员的客户({ in: [...(范围.读 ?? 写)] }),
    select: { id: true, salesOwnerId: true, channelOwnerId: true, pool: { select: { customerId: true } }, projects: { where: { deletedAt: null }, select: { ownerId: true } } },
  });
  for (const c of 组员的) {
    if (!看得到(c, 写) && !c.projects.some((p) => 写.includes(p.ownerId))) 组员只读.add(c.id);
  }
  const 带组员 = 组员的.length ? { 组员客户: 组员的.length > 组员名单上限 ? null : 组员的.map((c) => c.id) } : {};
  if (!范围.读 && !市场.length && !组员只读.size) return { 我: 写, 互看: false, 别人的: new Set(), ...线索, ...带市场全看, ...带回避, ...带组员 };

  // 只能看的那些客户的编号：新建前、改客户前按这份判（钩子里不能现查）
  const 别人的 = new Set<string>(组员只读);
  const 读 = 范围.读;
  if (读) {
    const 那些 = await db.customer.findMany({
      // 企业版不认渠道负责人（11-04，同 team-scope 可见客户）
      where: { salesOwnerId: { in: 读 } },
      select: { id: true, salesOwnerId: true, channelOwnerId: true, pool: { select: { customerId: true } } },
    });
    for (const c of 那些) if (!看得到(c, 范围.写)) 别人的.add(c.id);
  }
  if (市场.length) {
    // 市场成员相关的客户（11-04 改：负责的 + 建的且不在公海）：看得到、只能看。原来就能动的不降——自己（含实线下属）负责的、公海的，
    // 以及自己负责的项目挂着的客户（在项目下记沟通）都不算只读；只是进了组的照上面组员那条，只读（V3.5.1）
    const 那些 = await db.customer.findMany({
      where: 市场相关客户(市场),
      select: {
        id: true, salesOwnerId: true, channelOwnerId: true, pool: { select: { customerId: true } },
        projects: { where: { deletedAt: null }, select: { ownerId: true } },
      },
    });
    for (const c of 那些) {
      if (看得到(c, 写)) continue;
      if (c.projects.some((p) => 写.includes(p.ownerId))) continue;
      别人的.add(c.id);
    }
  }
  const 话 = 读 && 市场.length ? 虚线或市场只读话 : 读 ? 虚线只读话 : 市场.length ? 市场只读话 : 组员只读话;
  return {
    我: 范围.写, 互看: false, 别人的, 全拦: true, 话, ...线索,
    ...(读 ? { 读 } : {}),
    ...(市场.length ? { 市场 } : {}),
    ...带市场全看,
    ...带回避,
    ...带组员,
  };
}

/** 组员客户名单的上限：再多 IN 又长、也怕碰 SQLite 参数上限，退回按关联写的子查询 */
const 组员名单上限 = 300;

/** 这几位以组员身份（点了同意）加入的项目挂着的客户编号（见 限定.组员客户）；一个都没有回 undefined，查询不多任何条件 */
async function 组员客户of(db: PrismaClient, 人们: string[]): Promise<string[] | null | undefined> {
  const 行 = await db.customer.findMany({ where: 组员的客户({ in: 人们 }), select: { id: true }, take: 组员名单上限 + 1 });
  if (!行.length) return undefined;
  return 行.length > 组员名单上限 ? null : 行.map((c) => c.id);
}

/** 回避名单的上限：再多 NOT IN 又长又慢、也怕碰 SQLite 参数上限（否定条件不能拆批），退回按关联写的条件 */
const 回避名单上限 = 100;

/**
 * 这个人要回避哪些公海客户和项目（11-03 用户定：原负责人退到公海，他就看不到客户和项目）。
 * 判「原负责人」用已有字段，不加 schema：
 *   - 项目：最后一次 pool-release 留痕的 fromOwnerId（退项目、超时回收、离职都写；公海项目 ownerId 已清空）
 *   - 客户：负责人（放进公海、超时扫描都留着 salesOwnerId；导入的是占位账号，走不到这条）；
 *     或者他退的项目挂着的公海客户（占位负责人、别人名下的都靠这条）
 * 不看 CustomerPool.userId：那是操作的人，可能是上级，超时的是空。
 * 客户在公海，下面的项目都算回避（客户都看不到，项目点进去也打不开）。别人领走客户、项目后自然从名单出来，
 * 他是不是还能看回到原来的范围（负责人、组员、上级）。什么都没有的人回 undefined，查询不多任何条件。
 * db 是底层 defaultClient（不过软删扩展），自己带 deletedAt
 */
async function 公海回避of(db: PrismaClient, id: string): Promise<公海回避 | undefined> {
  const { 原负责人回避, 公海里历史负责人是, 一批id数 } = await import("@/lib/project/pool-owner");
  if (!原负责人回避()) return undefined;
  const 放回的 = await 公海里历史负责人是(db, [id]);
  const 他公海客户 = { salesOwnerId: id, pool: { isNot: null }, deletedAt: null };
  const [有客户, 挂着的] = await Promise.all([
    db.customer.findFirst({ where: 他公海客户, select: { id: true } }),
    db.project.findMany({ where: { deletedAt: null, customer: 他公海客户 }, select: { id: true }, take: 回避名单上限 + 1 }),
  ]);
  // 他退的项目挂着的公海客户里，负责人不是他的（负责人是他的 回避客户条件 一句带上了）
  const 客户们 = new Set<string>();
  for (let i = 0; i < 放回的.length; i += 一批id数) {
    const 行 = await db.project.findMany({
      where: { id: { in: 放回的.slice(i, i + 一批id数) }, customer: { salesOwnerId: { not: id }, pool: { isNot: null }, deletedAt: null } },
      select: { customerId: true },
    });
    for (const r of 行) 客户们.add(r.customerId);
  }
  const 项目们 = new Set([...放回的, ...挂着的.map((p) => p.id)]);
  if (!有客户 && !客户们.size && !项目们.size) return undefined;
  return {
    本人: id,
    客户: 客户们.size > 回避名单上限 ? null : [...客户们],
    项目: 项目们.size > 回避名单上限 ? null : [...项目们],
  };
}

/**
 * 按「市场成员相关」放开读的是哪几位（10-31）：市场管理 = 本人 + 直属下级里的市场成员（11-05 客户定：只认直属下级；自己也是就带上）；
 * 市场成员、渠运 = 自己；别人 = 空（不放开）。
 * 存的部门设置读不出当没设（按名字带「市场」）；逐人设的（11-01）读不出当没有
 */
function 市场的人(org: 组织, id: string, 是市场管理: boolean, 存的: string | undefined, 存的人?: string): string[] {
  const 读 = (v: string | undefined) => {
    try {
      return v === undefined ? null : 规整市场部门(JSON.parse(v));
    } catch {
      return null;
    }
  };
  const 成员 = 市场成员们(org, 读(存的), 读(存的人));
  // 渠运（V3.5.1）：自己创建的客户一直看得到，同市场成员看自己的
  if (org.成员.get(id)?.角色们.includes("channel_ops")) 成员.add(id);
  if (是市场管理) {
    const 下 = 实线下属(org, id, 1);
    return [...成员].filter((x) => x === id || 下.has(x));
  }
  return 成员.has(id) ? [id] : [];
}
