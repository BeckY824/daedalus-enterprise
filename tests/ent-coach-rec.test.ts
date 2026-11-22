/**
 * 录音点评 PR2（11-22）：录音的纯判定（lib/enterprise/coach-rec.ts）和取文件签名（coach-rec-sign.ts）。不连库。
 *   - 格式只认文件头（扩展名、浏览器报的类型不信）；caf、网页、可执行文件这类不收
 *   - 段号、片号、编号只收像样的
 *   - 片齐不齐：每段从 0 连着、段从 1 连着；传文件另核总字节
 *   - 开始时的参数：来源、大小（1B–200MB）、文件名
 *   - 传片、放弃、看进度只给录的人；听原声给录的人、发出后的负责人；只读管理员不能听
 *   - 销售教练看到的文件名号码打码
 *   - 签名：30 分钟过期、改一个字不认、换编号不认、远在将来的不认
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  认录音格式, 读段片, 片们问题, 开始输入问题, 规整文件名, 是录音编号, 能传片, 能放弃录音, 不能放弃话, 能听原声, 能看录音进度, 给人看的文件名,
  文件上限字节, 每段片数上限, 段数上限, 选文件accept,
} from "@/lib/enterprise/coach-rec";
import { 签取文件地址, 验取文件签名, 取文件有效秒 } from "@/lib/enterprise/coach-rec-sign";
import { 建组织, type 组织 } from "@/lib/enterprise/org-core";

// 业务角色只在企业版里生效（permissions.ts）
beforeAll(() => { process.env.CRM_ENTERPRISE = "1"; });
afterAll(() => { delete process.env.CRM_ENTERPRISE; });

const 头 = (s: string) => new Uint8Array(Buffer.from(s.padEnd(16, "\0"), "binary"));

describe("认录音格式：只看文件头", () => {
  it.each([
    ["\0\0\0\x20ftypM4A ", "m4a"], ["\0\0\0\x18ftypisom", "mp4"], ["\0\0\0\x18ftyp3gp4", "3gp"], ["RIFF\0\0\0\0WAVE", "wav"],
    ["\x1a\x45\xdf\xa3", "webm"], ["OggS", "ogg"], ["#!AMR\n", "amr"], ["ID3\x04", "mp3"], ["fLaC", "flac"], ["\xff\xf1\x50\x80", "aac"], ["\xff\xfb\x90\x64", "mp3"],
  ])("%j → %s", (h, 应) => expect(认录音格式(头(h))).toBe(应));
  it.each([["caff"], ["<html>"], ["MZ\x90\0"], ["%PDF-1.4"], ["PK\x03\x04"], [""]])("%j 不收", (h) => expect(认录音格式(头(h))).toBeNull());
  it("accept 类型和扩展名都写（手机浏览器对 m4a、amr 常不给类型）", () => {
    for (const x of [".m4a", ".amr", ".mp3", ".wav", ".3gp", "audio/mp4", "audio/amr"]) expect(选文件accept.split(",")).toContain(x);
  });
});

describe("编号、段号、片号", () => {
  it("编号只收 cuid 样的", () => {
    expect(是录音编号("cmi3x0abc0000def0ghi1jkl2")).toBe(true);
    for (const x of ["../x", "", "A".repeat(25), "a", "cmi3x0abc/../../etc", null, 1]) expect(是录音编号(x)).toBe(false);
  });
  it("段号 1..20、片号 0..39，只收纯数字", () => {
    expect(读段片("1", "0")).toEqual({ 段: 1, 片: 0 });
    expect(读段片(String(段数上限), String(每段片数上限 - 1))).toEqual({ 段: 段数上限, 片: 每段片数上限 - 1 });
    for (const [a, b] of [["0", "0"], ["21", "0"], ["1", "40"], ["1", "-1"], ["1", "1.5"], ["..", "0"], ["1", " 1"], ["01x", "0"]]) expect(读段片(a, b)).toBeNull();
  });
});

describe("片齐不齐", () => {
  const 片 = (段: number, 片: number, 字节 = 10) => ({ 段, 片, 字节 });
  it("传文件：一段、从 0 连着、总字节对得上才齐", () => {
    expect(片们问题([片(1, 0), 片(1, 1)], "上传", 20)).toBeNull();
    expect(片们问题([], "上传", 20)).toBe("还没传任何内容");
    expect(片们问题([片(1, 0), 片(1, 2)], "上传", 20)).toBe("还有片没传上来");
    expect(片们问题([片(1, 1)], "上传", 10)).toBe("还有片没传上来");
    expect(片们问题([片(1, 0)], "上传", 20)).toBe("还没传完");
    expect(片们问题([片(1, 0), 片(2, 0)], "上传", 20)).toBe("传文件只有一段");
  });
  it("录音：多段从 1 连着、每段从 0 连着；不核总字节", () => {
    expect(片们问题([片(1, 0), 片(1, 1), 片(2, 0)], "网页录", null)).toBeNull();
    expect(片们问题([片(1, 0), 片(3, 0)], "网页录", null)).toBe("录音的段不连续，有一段没传上来");
    expect(片们问题([片(2, 0)], "飞书原生录", null)).toBe("录音的段不连续，有一段没传上来");
  });
});

describe("开始时的参数", () => {
  it("来源只认三种；传文件要 1B–200MB 的整数大小和文件名；录音不要", () => {
    expect(开始输入问题({ sourceKind: "上传", bytes: 1, fileName: "a.m4a" })).toBeNull();
    expect(开始输入问题({ sourceKind: "上传", bytes: 文件上限字节, fileName: "a.m4a" })).toBeNull();
    expect(开始输入问题({ sourceKind: "上传", bytes: 文件上限字节 + 1, fileName: "a.m4a" })).toContain("200MB");
    expect(开始输入问题({ sourceKind: "上传", bytes: 0, fileName: "a" })).toBe("文件大小不对");
    expect(开始输入问题({ sourceKind: "上传", bytes: 1.5, fileName: "a" })).toBe("文件大小不对");
    expect(开始输入问题({ sourceKind: "上传", bytes: 10, fileName: "  " })).toBe("没有文件名");
    expect(开始输入问题({ sourceKind: "网页录" })).toBeNull();
    expect(开始输入问题({ sourceKind: "飞书原生录" })).toBeNull();
    expect(开始输入问题({ sourceKind: "外呼" })).toBe("录音来源不对");
  });
  it("文件名只留最后一段、去控制字符、最长 120 字", () => {
    expect(规整文件名("C:\\Users\\x\\录音.m4a")).toBe("录音.m4a");
    expect(规整文件名("../../etc/passwd")).toBe("passwd");
    expect(规整文件名("a\u0000b\nc.m4a")).toBe("abc.m4a");
    expect(规整文件名("长".repeat(200))!.length).toBe(120);
    expect(规整文件名("")).toBeNull();
    expect(规整文件名(3)).toBeNull();
  });
});

describe("谁能传、能删、能听（纯判定）", () => {
  // 最小的组织：教练 coach（账号 ADMIN）、管理员 admin、组长 sales_mgr（甲的上级）、甲 sales（负责人）
  const org: 组织 = 建组织(
    ["coach", "adm", "mgr", "a"].map((id) => ({ id, role: id === "coach" ? "ADMIN" : "SALES", active: true })),
    [
      { userId: "coach", deptId: null, bizRole: "coach", line: null, managerId: null, dottedManagerId: null },
      { userId: "adm", deptId: null, bizRole: "admin", line: null, managerId: null, dottedManagerId: null },
      { userId: "mgr", deptId: null, bizRole: "sales_mgr", line: null, managerId: null, dottedManagerId: null },
      { userId: "a", deptId: null, bizRole: "sales", line: "外贸", managerId: "mgr", dottedManagerId: null },
    ],
    [],
  );
  const p = { ownerId: "a", creatorId: "a", pooledAt: null, bizLine: "外贸", 已加入: [] as string[] };
  const 录 = (x: Partial<{ authorId: string; status: string; deletedAt: Date | null; audioPurgedAt: Date | null }> = {}) => ({ authorId: "coach", status: "上传中", projectId: "p", deletedAt: null, audioPurgedAt: null, ...x });
  const 我 = (id: string) => ({ id, role: id === "coach" ? "ADMIN" : "SALES" });

  it("传片：录的人、上传中、仍能发；别人、传完的、放弃的都不行", () => {
    expect(能传片(我("coach"), 录(), p, org)).toBe(true);
    expect(能传片(我("mgr"), 录(), p, org)).toBe(false);
    expect(能传片(我("coach"), 录({ status: "待提交" }), p, org)).toBe(false);
    expect(能传片(我("coach"), 录({ deletedAt: new Date() }), p, org)).toBe(false);
    expect(能传片(我("coach"), 录(), { ...p, pooledAt: new Date() }, org)).toBe(false);
  });
  it("看进度、放弃：只有录的人；已发出、转写中不能删", () => {
    expect(能看录音进度(我("coach"), 录())).toBe(true);
    expect(能看录音进度(我("a"), 录())).toBe(false);
    expect(能放弃录音(我("coach"), 录({ status: "待提交" }))).toBe(true);
    expect(能放弃录音(我("mgr"), 录())).toBe(false);
    expect(不能放弃话(我("coach"), 录({ status: "转写中" }))).toBe("正在整理，等整理完再删");
    expect(不能放弃话(我("coach"), 录({ status: "已发出" }))).toBe("已经发出的录音点评不能删");
    expect(不能放弃话(我("coach"), 录({ status: "已放弃" }))).toBeNull();
  });
  it("听原声：录的人；负责人要等发出；只读管理员、上级不能；音频删了谁都不能", () => {
    expect(能听原声(我("coach"), 录({ status: "待提交" }), p, org)).toBe(true);
    expect(能听原声(我("a"), 录({ status: "待提交" }), p, org)).toBe(false);
    expect(能听原声(我("a"), 录({ status: "已发出" }), p, org)).toBe(true);
    expect(能听原声(我("adm"), 录({ status: "已发出" }), p, org)).toBe(false);
    expect(能听原声(我("mgr"), 录({ status: "已发出" }), p, org)).toBe(false);
    expect(能听原声(我("coach"), 录({ status: "已发出", audioPurgedAt: new Date() }), p, org)).toBe(false);
    expect(能听原声(我("coach"), 录({ status: "已放弃" }), p, org)).toBe(false);
  });
  it("文件名：教练看到的号码打码，别人原样", () => {
    const 名 = "通话录音 138 1234 5678_20261122.m4a";
    expect(给人看的文件名(名, 我("coach"), org)).toBe("通话录音 138****5678_20261122.m4a");
    expect(给人看的文件名(名, 我("mgr"), org)).toBe(名);
    expect(给人看的文件名(null, 我("coach"), org)).toBeNull();
  });
});

describe("取文件签名", () => {
  const id = "cmi3x0abc0000def0ghi1jkl2";
  const 拆 = (u: string) => { const q = new URL(`http://x${u}`).searchParams; return { exp: q.get("exp"), sig: q.get("sig") }; };
  it("签出来的地址验得过；路径就是 /api/coach-rec/fetch/<id>", () => {
    const u = 签取文件地址(id);
    expect(u.startsWith(`/api/coach-rec/fetch/${id}?exp=`)).toBe(true);
    const { exp, sig } = 拆(u);
    expect(验取文件签名(id, exp, sig)).toBe(true);
  });
  it("30 分钟后不认；远在将来的 exp 不认；改一个字、换编号不认；参数缺了不认", () => {
    const 现在 = new Date("2026-11-22T12:00:00Z");
    const { exp, sig } = 拆(签取文件地址(id, 现在));
    expect(验取文件签名(id, exp, sig, new Date(现在.getTime() + (取文件有效秒 - 1) * 1000))).toBe(true);
    expect(验取文件签名(id, exp, sig, new Date(现在.getTime() + (取文件有效秒 + 1) * 1000))).toBe(false);
    expect(验取文件签名(id, String(Number(exp) + 1), sig, 现在)).toBe(false);
    expect(验取文件签名(id, String(Number(exp) + 86400), sig, 现在)).toBe(false);
    const 改 = sig!.slice(0, -1) + (sig!.endsWith("A") ? "B" : "A");
    expect(验取文件签名(id, exp, 改, 现在)).toBe(false);
    expect(验取文件签名(id.replace("a", "b"), exp, sig, 现在)).toBe(false);
    expect(验取文件签名(id, null, sig, 现在)).toBe(false);
    expect(验取文件签名(id, exp, null, 现在)).toBe(false);
    expect(验取文件签名("../x", exp, sig, 现在)).toBe(false);
  });
  it("编号不像样的不签", () => {
    expect(() => 签取文件地址("../x")).toThrow();
  });
});
