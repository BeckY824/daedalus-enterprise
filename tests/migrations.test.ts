/**
 * 增量迁移机制的护栏。
 *
 * 这套机制的全部安全性都押在一个前提上：migrations/ 里每条语句都是幂等的，
 * 因为容器**每次启动都会把整个目录重跑一遍**，不记录执行进度。
 * 一旦有人往里面塞了 DROP / INSERT / UPDATE，第二次启动就会炸在生产环境，
 * 而那时才发现就太晚了。所以在这里挡住。
 * 唯一放过的是 066 那 7 张外贸订单 / 供应商表的 `DROP TABLE IF EXISTS`（2026-10-29，见 许可删除的表）。
 *
 * ---
 *
 * **`ALTER TABLE ADD COLUMN` 是唯一的例外**（0.39.2、migrations/006 起）。
 * SQLite 没有 `ADD COLUMN IF NOT EXISTS`，所以它天生不幂等：第二遍必抛
 * "duplicate column name"。三件事因此必须一起成立，少一件就是线上起不来：
 *
 *   1. 加列的文件里**只有** ADD COLUMN 和 CREATE INDEX IF NOT EXISTS。
 *      因为 `db.exec` 是整个文件一把执行的：ADD COLUMN 一抛，
 *      同文件后面的语句全被跳过——第一遍要是没跑完，就永远补不上了。
 *   2. **每一个** runner 都把这一句当预期跳过。0.39.1 时并不是：
 *      docker-entrypoint.sh 有四处循环，其中单租户业务库那一处是 shell for +
 *      `2>/dev/null`——只挡住了报错文字，挡不住退出码，而那个脚本开着 set -e。
 *      也就是说这个迁移一进去，**存量自部署的容器第二次启动会直接起不来，
 *      日志里还什么都没有**。那一处是跟着 006 一起补的。
 *   3. 跑两遍：第二遍要么不抛，要么只抛这一种。
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { 许可删除的表, 许可删除的文件, 许可重建的文件 } from "./migration-allowed-drops";

const ROOT = path.resolve(__dirname, "..");
const DIR = path.join(ROOT, "migrations");
const 文件 = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

/** 去掉注释再检查，免得注释里的字眼误伤（006 的说明里就写着 ALTER / ADD COLUMN） */
const 去注释 = (f: string) => readFileSync(path.join(DIR, f), "utf8").replace(/--.*$/gm, "");

/**
 * runner 们把「第二遍」当预期跳过的那一句。改这个正则前先想清楚：
 * 它是 ADD COLUMN 能进这个目录的唯一理由。
 */
const 容错 = /duplicate column name\|already exists/;
const 可跳过 = (e: unknown) => /duplicate column name|already exists/i.test(String((e as Error)?.message ?? e));

/** 唯一许可的删除（066 那 7 张表，见 migration-allowed-drops.ts）：只认一行一整句的 DROP TABLE IF EXISTS */
const 许可的删除 = new RegExp(`^\\s*DROP\\s+TABLE\\s+IF\\s+EXISTS\\s+"(${许可删除的表.join("|")})"\\s*;\\s*$`, "gim");
/** 把白名单里的 DROP TABLE IF EXISTS 整句拿掉，剩下的再过 禁止的语句 */
const 去许可删除 = (sql: string) => sql.replace(许可的删除, "");

/**
 * 不许出现的语句。按「语句」认，不按子串：外键的 ON UPDATE / ON DELETE CASCADE 是建表的一部分，不是改数据（R-064）
 */
const 禁止的语句: [string, RegExp][] = [
  ["DROP", /\bDROP\s+(TABLE|INDEX|VIEW|TRIGGER|COLUMN)\b/i],
  ["DELETE", /\bDELETE\s+FROM\b/i],
  ["UPDATE", /(?<!\bON\s+)\bUPDATE\s+["`\w]/i],
  ["INSERT", /\bINSERT\s+(OR\s+\w+\s+)?INTO\b/i],
];

describe("迁移文件", () => {
  it("目录里要有按序号命名的 .sql", () => {
    expect(文件.length).toBeGreaterThan(0);
    for (const f of 文件) expect(f, `${f} 不符合 NNN-说明.sql 的命名`).toMatch(/^\d{3}-[a-z0-9-]+\.sql$/);
  });

  it("只能加东西：不允许 DROP / DELETE / UPDATE / INSERT（只放过 066 那 7 张表的 DROP TABLE IF EXISTS）", () => {
    // 107 的重建（建新表 / 拷 / 删旧 / 改名）一句一句钉在 tests/migration-files-guard.test.ts，这里不重复放行
    for (const f of 文件.filter((f) => f !== 许可重建的文件)) {
      const sql = 去许可删除(去注释(f));
      for (const [禁, re] of 禁止的语句) {
        expect(re.test(sql), `${f} 含有不允许的语句：${禁}`).toBe(false);
      }
    }
  });

  /*
    回归核对 R-064：原来按子串「UPDATE 」拦，外键写 ON UPDATE CASCADE 也被当成 UPDATE 语句误拦，
    只好不写这个子句绕开。现在只认真正的 UPDATE 语句
  */
  it("R-064 外键的 ON UPDATE / ON DELETE 子句不算语句；真的 UPDATE / DELETE 照样拦", () => {
    const 拦 = (sql: string) => 禁止的语句.filter(([, re]) => re.test(sql)).map(([禁]) => 禁);
    expect(拦(`CREATE TABLE IF NOT EXISTS "A" ("b" TEXT, FOREIGN KEY ("b") REFERENCES "B" ("id") ON DELETE CASCADE ON UPDATE CASCADE);`)).toEqual([]);
    expect(拦(`CREATE TABLE IF NOT EXISTS "A" ("b" TEXT REFERENCES "B"("id") on update set null);`)).toEqual([]);
    expect(拦(`UPDATE "Customer" SET "x" = 1;`)).toEqual(["UPDATE"]);
    expect(拦(`CREATE INDEX IF NOT EXISTS i ON A(b);\nupdate Customer set x = 1;`)).toEqual(["UPDATE"]);
    expect(拦(`DELETE FROM "A";`)).toEqual(["DELETE"]);
    expect(拦(`DROP TABLE "A";`)).toEqual(["DROP"]);
    expect(拦(`INSERT INTO "A" VALUES (1);`)).toEqual(["INSERT"]);
  });

  it("2026-10-29 白名单只放过那 7 张表的 DROP TABLE IF EXISTS；别的表、不带 IF EXISTS、删索引照样拦", () => {
    const 拦 = (sql: string) => 禁止的语句.filter(([, re]) => re.test(去许可删除(sql))).map(([禁]) => 禁);
    expect(拦(`DROP TABLE IF EXISTS "TradeOrder";\nDROP TABLE IF EXISTS "Supplier";`)).toEqual([]);
    expect(拦(`DROP TABLE "TradeOrder";`)).toEqual(["DROP"]);
    expect(拦(`DROP TABLE IF EXISTS "Customer";`)).toEqual(["DROP"]);
    expect(拦(`DROP TABLE IF EXISTS "TradeOrderX";`)).toEqual(["DROP"]);
    expect(拦(`DROP INDEX IF EXISTS "TradeOrder_contractId_key";`)).toEqual(["DROP"]);
    expect(拦(`DROP TABLE IF EXISTS "TradeOrder"; DROP TABLE IF EXISTS "Customer";`)).toEqual(["DROP"]);
    // 真有 DROP 的只有 066 和 107（重建 EntBlocker）这两个文件
    const 带删除 = 文件.filter((f) => /\bDROP\b/i.test(去注释(f)));
    expect(带删除).toEqual([许可删除的文件, 许可重建的文件]);
  });

  it("ALTER TABLE 只许 ADD COLUMN——改列、改约束、改名都得走 REBUILD_DB=1（107 的重建改名除外，另钉）", () => {
    for (const f of 文件.filter((f) => f !== 许可重建的文件)) {
      for (const 句 of 去注释(f).match(/ALTER\s+TABLE[\s\S]*?;/gi) ?? []) {
        expect(/ADD\s+COLUMN/i.test(句), `${f} 里这句 ALTER 不是 ADD COLUMN：${句.trim().slice(0, 60)}`).toBe(true);
      }
    }
  });

  it("加列的文件里只许有 ADD COLUMN 和 CREATE INDEX——ADD COLUMN 一抛，同文件后面的全跳过", () => {
    /*
      `db.exec` 是整个文件一把执行的。ADD COLUMN 第二遍必抛，
      所以它后面的任何语句在第二遍都不会执行——第一遍没跑完就永远补不上了。
      把加列的文件限死成「一列 + 它的索引」，这个洞就只有一句话那么深。
    */
    for (const f of 文件) {
      const sql = 去注释(f);
      if (!/ADD\s+COLUMN/i.test(sql)) continue;
      const 语句 = sql.split(";").map((x) => x.trim()).filter(Boolean);
      for (const 句 of 语句) {
        const 行 = 句.replace(/\s+/g, " ").slice(0, 70);
        expect(
          /^ALTER\s+TABLE\b/i.test(句) || /^CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\b/i.test(句),
          `${f} 是加列的迁移，不该混进这句（请单开一个文件）：${行}`,
        ).toBe(true);
      }
    }
  });

  it("每条建表/建索引都要带 IF NOT EXISTS（107 第一句记号索引故意不带，另钉）", () => {
    for (const f of 文件.filter((f) => f !== 许可重建的文件)) {
      const sql = 去注释(f);
      const 建 = sql.match(/CREATE\s+(TABLE|INDEX|UNIQUE INDEX)[\s\S]*?(?=\()/gi) ?? [];
      for (const 句 of 建) {
        expect(/IF NOT EXISTS/i.test(句), `${f} 里这句缺 IF NOT EXISTS：${句.trim().slice(0, 60)}`).toBe(true);
      }
    }
  });

  it("连续跑两遍——第一遍必须全过，第二遍只许抛「列已存在」", () => {
    /*
      这条用例就是 runner 本身：一个文件一次 db.exec，抛出来的只按
      duplicate column name / already exists 放过。和 docker-entrypoint.sh、
      scripts/build-template.mjs 里的 catch 一个口径。
    */
    const 临时库 = path.join(ROOT, "prisma/_migration-check.db");
    rmSync(临时库, { force: true });
    try {
      const db = new DatabaseSync(临时库);
      /*
        迁移只在已有业务表的库上跑（全新安装先 schema.sql、桌面端先拷模板库）。021 给 Customer 的号码建表达式索引（R-067），
        所以先放一张最小的 Customer——真实的库里它从第一版就在。024 给归属列建索引，这一列也是第一版就有。049 给 createdAt 建索引，同样第一版就有
      */
      db.exec('CREATE TABLE "Customer" ("id" TEXT NOT NULL PRIMARY KEY, "phone" TEXT NOT NULL, "attributionCustomerId" TEXT, "createdAt" DATETIME)');
      db.exec('CREATE TABLE "FollowPlan" ("id" TEXT PRIMARY KEY, "done" BOOLEAN, "plannedAt" DATETIME)');
      // 028及030–035也在存量基础表加列。这里保留旧表形状，不能直接用新schema掩盖加列失败。
      db.exec('CREATE TABLE "Opportunity" ("id" TEXT PRIMARY KEY)');
      db.exec('CREATE TABLE "Task" ("id" TEXT PRIMARY KEY)');
      // 050 给 occurredAt、(ownerId, occurredAt) 建索引，这两列第一版就有；137 给 (customerId, deletedAt, type, ownerId) 建索引，customerId、type 也是第一版就有
      db.exec('CREATE TABLE "FollowUp" ("id" TEXT PRIMARY KEY, "customerId" TEXT, "type" TEXT, "ownerId" TEXT, "occurredAt" DATETIME)');
      // 067–071 给渠道加列，Channel 也是第一版就有
      db.exec('CREATE TABLE "Channel" ("id" TEXT PRIMARY KEY, "name" TEXT)');
      // 073 给联系人加列，Contact 也是第一版就有
      db.exec('CREATE TABLE "Contact" ("id" TEXT PRIMARY KEY, "name" TEXT)');
      // 098 给用户加飞书身份列，User 也是第一版就有
      db.exec('CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "name" TEXT)');
      db.prepare('INSERT INTO "FollowPlan" VALUES (?, ?, ?)').run("old-plan", 1, 123456);
      // 第一遍：一个都不许抛。全新库上 ADD COLUMN 也是真的在加列
      for (const f of 文件) {
        expect(() => db.exec(readFileSync(path.join(DIR, f), "utf8")), `第 1 遍执行 ${f} 失败`).not.toThrow();
      }
      // 第二遍：抛也只能是「这一列已经有了」
      for (const f of 文件) {
        try {
          db.exec(readFileSync(path.join(DIR, f), "utf8"));
        } catch (e) {
          expect(可跳过(e), `第 2 遍执行 ${f} 抛了 runner 不会放过的错：${(e as Error)?.message}`).toBe(true);
        }
      }
      // 跑完确实建出了表，加的列也真的在
      const 表 = db.prepare("select name from sqlite_master where type='table'").all() as { name: string }[];
      expect(表.map((t) => t.name)).toContain("AuditLog");
      // 016 / 017 每遍先把订单 / 供应商建回空表，066 再删：跑完一张都不剩
      for (const t of 许可删除的表) expect(表.map((x) => x.name), `${t} 跑完还在`).not.toContain(t);
      expect(db.prepare('SELECT * FROM "FollowPlan" WHERE id = ?').get("old-plan")).toMatchObject({ id: "old-plan", done: 1, plannedAt: 123456, doneAt: null });
      db.close();
    } finally {
      rmSync(临时库, { force: true });
    }
  });

  it("107 老库重建：052 建的老 EntBlocker（followUpId NOT NULL + 级联）→ 跑迁移 → 沟通删了卡点还在、followUpId 置空", () => {
    /*
      客户服务器是老库：EntBlocker 由 052（或当时的 schema.sql）建，followUpId NOT NULL + ON DELETE CASCADE。
      不重建的话，沟通彻底删除（含回收站过期）会连带删掉卡点、认领、原因、流转日志。
      这里按老库的样子先跑到 106，插一条带认领 / 原因 / 日志的卡点，再像启动那样整目录跑两遍。
    */
    const 临时库 = path.join(ROOT, "prisma/_migration-107-check.db");
    rmSync(临时库, { force: true });
    try {
      const db = new DatabaseSync(临时库);
      db.exec('CREATE TABLE "Customer" ("id" TEXT NOT NULL PRIMARY KEY, "phone" TEXT NOT NULL, "attributionCustomerId" TEXT, "createdAt" DATETIME)');
      db.exec('CREATE TABLE "FollowPlan" ("id" TEXT PRIMARY KEY, "done" BOOLEAN, "plannedAt" DATETIME)');
      db.exec('CREATE TABLE "Opportunity" ("id" TEXT PRIMARY KEY)');
      db.exec('CREATE TABLE "Task" ("id" TEXT PRIMARY KEY)');
      db.exec('CREATE TABLE "FollowUp" ("id" TEXT PRIMARY KEY, "customerId" TEXT, "type" TEXT, "ownerId" TEXT, "occurredAt" DATETIME)');
      db.exec('CREATE TABLE "Channel" ("id" TEXT PRIMARY KEY, "name" TEXT)');
      db.exec('CREATE TABLE "Contact" ("id" TEXT PRIMARY KEY, "name" TEXT)');
      db.exec('CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "name" TEXT)');
      // Project 由 042 建
      const 老的 = 文件.filter((f) => f < 许可重建的文件);
      for (const f of 老的) db.exec(readFileSync(path.join(DIR, f), "utf8"));
      const 列 = () => db.prepare('PRAGMA table_info("EntBlocker")').all() as { name: string; notnull: number }[];
      expect(列().find((c) => c.name === "followUpId")?.notnull, "前提：老库 followUpId 是 NOT NULL").toBe(1);
      expect(列().map((c) => c.name)).not.toContain("title");

      db.exec(`INSERT INTO "Customer" ("id","phone") VALUES ('c1','13800000000');
        INSERT INTO "Project" ("id","name","customerId","ownerId","creatorId","updatedAt") VALUES ('p1','测试项目一','c1','u1','u1','2026-10-20'), ('p2','测试项目二','c1','u1','u1','2026-10-20');
        INSERT INTO "FollowUp" ("id") VALUES ('f1'), ('f2');
        INSERT INTO "EntBlocker" ("id","code","projectId","followUpId","customerId","phase","type","impact","obstacle","description","dueDays","dueAt","status","creatorId","updatedAt")
          VALUES ('b1','BLK20261020001','p1','f1','c1','需求','中度卡点','项目暂停','客户','老卡点一',3,'2026-10-23','处理中','u1','2026-10-20'),
                 ('b2','BLK20261020002','p2','f2','c1','需求','轻度卡点','短期不影响','价格','老卡点二',3,'2026-10-23','待接受','u1','2026-10-20');
        INSERT INTO "EntBlockerClaim" ("id","blockerId","userId") VALUES ('k1','b1','u2');
        INSERT INTO "EntBlockerReason" ("id","name") VALUES ('r1','其他');
        INSERT INTO "EntBlockerReasonLink" VALUES ('b1','r1');
        INSERT INTO "EntBlockerLog" ("id","blockerId","userId","action") VALUES ('l1','b1','u1','发布');`);

      // 启动一次：整目录跑（老文件第二遍只许抛可跳过的错，107 第一次必须真跑完）
      for (const f of 文件) {
        try {
          db.exec(readFileSync(path.join(DIR, f), "utf8"));
        } catch (e) {
          expect(f, `${f} 在老库上第一次就抛了：${(e as Error)?.message}`).not.toBe(许可重建的文件);
          expect(可跳过(e), `${f} 抛了 runner 不会放过的错：${(e as Error)?.message}`).toBe(true);
        }
      }
      expect(列().find((c) => c.name === "followUpId")?.notnull, "重建后 followUpId 可空").toBe(0);
      expect(列().find((c) => c.name === "title")).toBeTruthy();
      const 外键 = db.prepare('PRAGMA foreign_key_list("EntBlocker")').all() as { from: string; table: string; on_delete: string }[];
      expect(外键.find((k) => k.from === "followUpId")).toMatchObject({ table: "FollowUp", on_delete: "SET NULL" });
      expect(外键.find((k) => k.from === "projectId")).toMatchObject({ table: "Project", on_delete: "CASCADE" });
      const 索引 = (db.prepare('PRAGMA index_list("EntBlocker")').all() as { name: string }[]).map((i) => i.name);
      for (const i of ["EntBlocker_code_key", "EntBlocker_projectId_status_idx", "EntBlocker_assigneeId_status_idx", "EntBlocker_followUpId_idx"]) expect(索引).toContain(i);
      expect(db.prepare("select name from sqlite_master where name = 'EntBlocker_107'").get()).toBeUndefined();
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare('SELECT "id","code","status","obstacle","title","followUpId" FROM "EntBlocker" ORDER BY "id"').all()).toEqual([
        { id: "b1", code: "BLK20261020001", status: "处理中", obstacle: "客户", title: "", followUpId: "f1" },
        { id: "b2", code: "BLK20261020002", status: "待接受", obstacle: "价格", title: "", followUpId: "f2" },
      ]);

      // 再启动一次：107 第一句记号索引已在 → already exists → 整个文件跳过，数据不动
      for (const f of 文件) {
        try {
          db.exec(readFileSync(path.join(DIR, f), "utf8"));
        } catch (e) {
          expect(可跳过(e), `第 2 次启动 ${f} 抛了 runner 不会放过的错：${(e as Error)?.message}`).toBe(true);
        }
      }
      expect(() => db.exec(readFileSync(path.join(DIR, 许可重建的文件), "utf8"))).toThrow(/already exists/);
      expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
      expect((db.prepare('SELECT count(*) n FROM "EntBlocker"').get() as { n: number }).n).toBe(2);

      // 外键开着删沟通：卡点还在、followUpId 置空，认领 / 原因 / 日志都在
      db.exec(`DELETE FROM "FollowUp" WHERE "id" = 'f1'`);
      expect(db.prepare('SELECT "id","followUpId" FROM "EntBlocker" WHERE "id" = ?').get("b1")).toEqual({ id: "b1", followUpId: null });
      expect((db.prepare('SELECT count(*) n FROM "EntBlockerClaim" WHERE "blockerId" = ?').get("b1") as { n: number }).n).toBe(1);
      expect((db.prepare('SELECT count(*) n FROM "EntBlockerReasonLink" WHERE "blockerId" = ?').get("b1") as { n: number }).n).toBe(1);
      expect((db.prepare('SELECT count(*) n FROM "EntBlockerLog" WHERE "blockerId" = ?').get("b1") as { n: number }).n).toBe(1);
      // 卡点脱离沟通能写 NULL（老结构写不进）
      db.exec(`UPDATE "EntBlocker" SET "followUpId" = NULL WHERE "id" = 'b2'`);
      // 项目删了卡点照旧跟着删，子表跟着卡点删（外键在新表上仍然生效）
      db.exec(`DELETE FROM "Project" WHERE "id" = 'p1'`);
      expect(db.prepare('SELECT "id" FROM "EntBlocker"').all()).toEqual([{ id: "b2" }]);
      expect((db.prepare('SELECT count(*) n FROM "EntBlockerClaim"').get() as { n: number }).n).toBe(0);
      expect((db.prepare('SELECT count(*) n FROM "EntBlockerReasonLink"').get() as { n: number }).n).toBe(0);
      expect((db.prepare('SELECT count(*) n FROM "EntBlockerLog"').get() as { n: number }).n).toBe(0);
      db.close();
    } finally {
      rmSync(临时库, { force: true });
    }
  });

  it("每一处 runner 都把「列已存在」当预期跳过——漏一处就是线上起不来", () => {
    /*
      **0.39.1 时就漏了一处。** docker-entrypoint.sh 有四处循环，
      其中单租户业务库那一处原来是 shell for + `2>/dev/null`：
      重定向只吞掉报错文字，退出码照样是非零，而那个脚本开着 set -e——
      也就是说 006 一进去，存量自部署容器第二次启动直接起不来，日志里还什么都没有。

      所以这里按「循环的个数」对：每一个 readdirSync（一次遍历迁移目录）
      都必须配一处容错。多一个循环少一个 catch，这条就红。
    */
    for (const f of ["docker-entrypoint.sh", "scripts/build-template.mjs"]) {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      const 循环 = src.match(/readdirSync/g)?.length ?? 0;
      const 放过 = src.match(new RegExp(容错.source, "g"))?.length ?? 0;
      expect(循环, `${f} 里没有遍历迁移目录的循环了？这条用例该跟着改`).toBeGreaterThan(0);
      expect(放过, `${f} 有 ${循环} 处迁移循环，只有 ${放过} 处容错——漏掉的那一处第二次启动会炸`).toBe(循环);
    }
  });

  it("单租户业务库那一处不许再退回 shell for + 2>/dev/null", () => {
    // 上一条按个数对，这一条钉住具体那一处：它是自部署用户唯一会走的路径
    const entry = readFileSync(path.join(ROOT, "docker-entrypoint.sh"), "utf8");
    const 段 = entry.slice(entry.indexOf("# 增量迁移"), entry.indexOf("# ---------- 托管版"));
    // 注释里正写着「原来是 shell for + 2>/dev/null」，不去掉的话这条会被自己的说明绊倒
    const 代码 = 段.replace(/^\s*#.*$/gm, "");
    expect(代码, "没找到单租户那段迁移代码").toContain("/app/migrations");
    expect(代码, "少了容错：ADD COLUMN 第二遍必抛，set -e 会让容器起不来").toMatch(容错);
    expect(代码, "2>/dev/null 只吞报错文字、不吞退出码，会把真正的失败也藏起来").not.toContain("2>/dev/null");
  });
});

describe("备份与恢复", () => {
  it("备份文件名要精确到秒，否则同一分钟内的两次备份会互相覆盖", async () => {
    /**
     * 2026-08-29 的恢复演练里撞上过：先备了干净状态，
     * 一分钟内又备了一份带标记的，干净那份直接被盖掉，脚本一声不吭。
     * 备份互相覆盖是最不该发生的事——出问题时那正是唯一的退路。
     */
    const fs = await import("node:fs/promises");
    const sh = await fs.readFile(path.join(ROOT, "scripts/backup.sh"), "utf8");
    expect(sh, "备份文件名缺少秒").toMatch(/%H%M%S/);
    expect(sh, "没有防重名，同名时应当拒绝而不是覆盖").toContain("拒绝覆盖");
  });

  it("恢复脚本必须连 WAL 一起清掉，否则恢复完数据还是错的", async () => {
    /**
     * 库跑在 WAL 模式下，crm.db 旁边还有 crm.db-wal / crm.db-shm。
     * 只换 crm.db 不删这两个，SQLite 起来会把旧 WAL 重放到新文件上，
     * 表现是「恢复完了数据还是错的」，而且完全看不出哪里错。
     */
    const fs = await import("node:fs/promises");
    const sh = await fs.readFile(path.join(ROOT, "scripts/restore.sh"), "utf8");
    expect(sh).toContain("crm.db-wal");
    expect(sh).toContain("crm.db-shm");
    expect(sh, "必须先停容器再换文件").toContain("docker compose stop");
    expect(sh, "破坏性操作要有显式确认").toContain("CONFIRM");
  });
});

describe("两条安装路径要一致", () => {
  it("schema.prisma 里必须有 AuditLog，否则全新安装会缺表", () => {
    const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
    expect(schema).toContain("model AuditLog");
    // 留痕表不与 User 建外键：成员被删不该带走历史
    const 段 = schema.slice(schema.indexOf("model AuditLog"));
    expect(段.slice(0, 段.indexOf("}"))).not.toMatch(/@relation/);
  });

  it("entrypoint 会执行 migrations，Dockerfile 会把它拷进运行镜像", () => {
    const entry = readFileSync(path.join(ROOT, "docker-entrypoint.sh"), "utf8");
    expect(entry).toContain("/app/migrations");
    const dockerfile = readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
    const 运行段 = dockerfile.slice(dockerfile.indexOf("AS runner"));
    expect(运行段, "运行镜像里没有 migrations，存量库永远补不上新表").toContain("migrations");
  });
});
