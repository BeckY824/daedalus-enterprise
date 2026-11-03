/**
 * 企业版切换视图（只读预览）拦「不经过库」的动作（lib/enterprise/view-as.ts 的 正在切换视图 那一组）。
 * 写入早就被拒了；这里钉发出去、带走的：调 AI、飞书、导出、上传。
 * 每类都是一对：切换视图被拒（fetch 一次没发、文件没动），同一个人不切换放行。
 * 有权限口子的动作（导出、飞书）用「老板看总管」：被看的人本来就有权限，拒掉只能是因为在预览。
 * 走真的 auth + 假 cookie，和 ent-view-as.test.ts 同一个写法。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const 罐 = vi.hoisted(() => ({ 票: new Map<string, string>(), 没请求: false }));
const 假头 = vi.hoisted(() => () => ({
  cookies: async () => {
    if (罐.没请求) throw new Error("cookies was called outside a request scope");
    return {
      get: (n: string) => (罐.票.has(n) ? { name: n, value: 罐.票.get(n)! } : undefined),
      set: (n: string, v: string) => void 罐.票.set(n, v),
      delete: (n: string) => void 罐.票.delete(n),
    };
  },
  headers: async () => new Headers(),
}));
vi.mock("next/headers", 假头);
vi.mock("next/headers.js", 假头);
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { SignJWT } from "jose";
import { prisma } from "@/lib/prisma";
import { readSecret } from "@/lib/secret";
import { resetDb } from "./reset";
import { setSetting } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 视图票, 签视图票, 正在切换视图, 视图外部拒, 视图拒绝响应 } from "@/lib/enterprise/view-as";
import { 视图外部话 } from "@/lib/enterprise/view-as-words";
import { chatJSON } from "@/lib/llm";
import { draftInvite } from "@/app/(app)/channels/ai";
import { POST as AI流 } from "@/app/api/ai/stream/route";
import { 推通知们, 清飞书推送令牌, 飞书推送开关键 } from "@/lib/enterprise/feishu-push";
import { 换联网 } from "@/lib/enterprise-import/adapter";
import { 请求, type 联网 } from "@/lib/enterprise-import/net";
import { 立即同步通讯录, 测试飞书连接动作 } from "@/app/(app)/settings/org-actions";
import { 导出客户, 开始完整导出 } from "@/app/(app)/customers/export-action";
import { 存附件 } from "@/lib/attachments";
import { POST as 传 } from "@/app/api/attachments/route";
import { GET as 取, DELETE as 删 } from "@/app/api/attachments/[id]/route";
import { POST as 传导入表 } from "@/app/api/enterprise-import/upload/route";
import { 认扫名片的人 } from "@/lib/card-scan/server/auth";
import { 改我的资料, changeMyPassword } from "@/app/(app)/settings/actions";
import { 视图只读错误 } from "@/lib/enterprise/view-as";

const 原数据目录 = process.env.CRM_DATA_DIR;
const 临时目录 = fs.mkdtempSync(path.join(os.tmpdir(), "crm-viewas-effects-"));
process.env.CRM_DATA_DIR = 临时目录;

const 人 = { 老板: "", 总管: "", 甲: "" };
let 甲的客户 = "";
let 甲的联系人 = "";

const 签会话 = (sub: string) =>
  new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(readSecret()));
/** 就是这个人自己，没切换 */
async function 登录成(id: string) {
  罐.票.clear();
  罐.票.set("crm_session", await 签会话(id));
  忘掉企业版范围();
}
/** 由 登录着，切到 谁 的视角 */
async function 切到(由: string, 谁: string) {
  await 登录成(由);
  罐.票.set(视图票, await 签视图票(由, 谁));
  忘掉企业版范围();
}

const 假回 = (j: unknown) => new Response(JSON.stringify(j), { status: 200, headers: { "Content-Type": "application/json" } });
/** 真 fetch 换成假的：拦得住的话它一次都不该被叫 */
function 换fetch(回: () => Response = () => 假回({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }] })) {
  const f = vi.fn(async () => 回());
  vi.stubGlobal("fetch", f);
  return f;
}
/** 飞书走的假网：什么都回「没权限」，够看出请求发没发 */
function 假飞书() {
  const fetch = vi.fn(async () => 假回({ code: 99991663, msg: "x" }));
  const 网: 联网 = { fetch: fetch as unknown as 联网["fetch"], 等: async () => {}, 现在: () => Date.now() };
  换联网(网);
  return { 网, fetch };
}

describe("切换视图拦不经过库的动作", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    罐.票.clear();
    罐.没请求 = false;
    const 部 = (await prisma.entDept.create({ data: { name: "销售一部" } })).id;
    const 建 = async (名: string, role: string, bizRole: string) => {
      const u = await prisma.user.create({ data: { email: `${名}@t`, name: 名, title: "", role, password: "x", feishuOpenId: `ou_${名}` } });
      await prisma.entMember.create({ data: { userId: u.id, deptId: bizRole === "director" ? null : 部, bizRole } });
      return u.id;
    };
    人.老板 = await 建("老板", "ADMIN", "director");
    人.总管 = await 建("总管", "SALES", "director");
    人.甲 = await 建("业务员甲", "SALES", "sales");
    甲的客户 = (await prisma.customer.create({ data: { name: "甲的客户", phone: "13900000001", salesOwnerId: 人.甲 } })).id;
    甲的联系人 = (await prisma.contact.create({ data: { customerId: 甲的客户, name: "联系人甲" } })).id;
    await setSetting("enterprise.rule.org_scope", true);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    换联网(null);
    清飞书推送令牌();
    罐.票.clear();
    罐.没请求 = false;
    忘掉企业版范围();
  });
  afterAll(async () => {
    if (原数据目录 === undefined) delete process.env.CRM_DATA_DIR;
    else process.env.CRM_DATA_DIR = 原数据目录;
    fs.rmSync(临时目录, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  describe("判断本身", () => {
    it("没切换、不是企业版、不在请求里（定时同步）：都不算在切换", async () => {
      await 登录成(人.总管);
      expect(await 正在切换视图()).toBe(false);
      expect(await 视图外部拒()).toBeNull();
      expect(await 视图拒绝响应()).toBeNull();

      await 切到(人.老板, 人.总管);
      expect(await 正在切换视图()).toBe(true);
      expect(await 视图外部拒()).toEqual({ ok: false, error: 视图外部话 });
      const 拒 = await 视图拒绝响应();
      expect(拒?.status).toBe(403);
      expect(await 拒?.json()).toEqual({ error: 视图外部话 });

      罐.没请求 = true;
      expect(await 正在切换视图()).toBe(false);
      罐.没请求 = false;

      vi.stubEnv("CRM_ENTERPRISE", "");
      expect(await 正在切换视图()).toBe(false);
    });
  });

  describe("调 AI", () => {
    beforeEach(() => {
      vi.stubEnv("LLM_API_KEY", "k");
      vi.stubEnv("LLM_BASE_URL", "http://llm.test/v1");
      vi.stubEnv("LLM_MODEL", "m");
    });

    it("底层 chatJSON：切换视图一个请求都不发，不切换发", async () => {
      const f = 换fetch();
      await 切到(人.老板, 人.甲);
      await expect(chatJSON("问一下")).rejects.toThrow(视图外部话);
      expect(f).not.toHaveBeenCalled();

      await 登录成(人.甲);
      expect(await chatJSON("问一下")).toEqual({ ok: true });
      expect(f).toHaveBeenCalled();
    });

    it("入口 draftInvite：切换视图回原话，不切换走到模型", async () => {
      const f = 换fetch();
      await 切到(人.老板, 人.甲);
      expect(await draftInvite({ customerId: 甲的客户 })).toEqual({ ok: false, error: 视图外部话 });
      expect(f).not.toHaveBeenCalled();

      await 登录成(人.甲);
      await draftInvite({ customerId: 甲的客户 });
      expect(f).toHaveBeenCalled();
    });

    it("/api/ai/stream：切换视图回一条结果事件，不切换照常验参数", async () => {
      const f = 换fetch();
      const 问 = () => AI流(new Request("http://x/api/ai/stream", { method: "POST", body: "不是 JSON" }));
      await 切到(人.老板, 人.甲);
      const 拒 = await 问();
      expect(拒.status).toBe(200);
      expect(拒.headers.get("Content-Type")).toContain("text/event-stream");
      expect(await 拒.text()).toBe(`data: ${JSON.stringify({ type: "result", ok: false, error: 视图外部话 })}\n\n`);
      expect(f).not.toHaveBeenCalled();

      await 登录成(人.甲);
      expect((await 问()).status).toBe(400);
    });
  });

  describe("飞书", () => {
    beforeEach(() => {
      vi.stubEnv("ENT_FEISHU_APP_ID", "cli_x");
      vi.stubEnv("ENT_FEISHU_APP_SECRET", "s");
    });

    it("发消息 推通知们：切换视图不发、这条还是待推；不切换发出去", async () => {
      await setSetting(飞书推送开关键, true);
      const 条 = await prisma.entNotice.create({ data: { userId: 人.甲, kind: "分配", title: "分给你了", dedupeKey: "k1" } });
      const f = 换fetch(() => 假回({ code: 0, msg: "ok", tenant_access_token: "t", expire: 7200 }));

      await 切到(人.老板, 人.甲);
      await 推通知们([条.id]);
      expect(f).not.toHaveBeenCalled();
      expect((await prisma.entNotice.findUniqueOrThrow({ where: { id: 条.id } })).feishuStatus).toBe("待推");

      await 登录成(人.甲);
      await 推通知们([条.id]);
      expect(f).toHaveBeenCalled();
      expect((await prisma.entNotice.findUniqueOrThrow({ where: { id: 条.id } })).feishuStatus).toBe("已推");
    });

    it("飞书、钉钉接口的总出口 请求：切换视图不发，不切换发", async () => {
      const { 网, fetch } = 假飞书();
      await 切到(人.老板, 人.总管);
      await expect(请求(网, "飞书", "http://feishu.test/x", {})).rejects.toThrow(视图外部话);
      expect(fetch).not.toHaveBeenCalled();

      await 登录成(人.总管);
      expect((await 请求(网, "飞书", "http://feishu.test/x", {})).status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("定时同步（不在请求里）：请求照常发", async () => {
      const { 网, fetch } = 假飞书();
      await 切到(人.老板, 人.总管);
      罐.没请求 = true;
      expect((await 请求(网, "飞书", "http://feishu.test/x", {})).status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("立即同步通讯录、测试飞书连接：切换视图回原话，不切换连飞书", async () => {
      const { fetch } = 假飞书();
      const 填 = { appId: "cli_x", appSecret: "s" };
      await 切到(人.老板, 人.总管);
      expect(await 立即同步通讯录("feishu")).toEqual({ ok: false, error: 视图外部话 });
      expect(await 测试飞书连接动作({ 填 })).toEqual({ ok: false, error: 视图外部话 });
      expect(fetch).not.toHaveBeenCalled();

      await 登录成(人.总管);
      await 测试飞书连接动作({ 填 });
      expect(fetch).toHaveBeenCalled();
      fetch.mockClear();
      await 立即同步通讯录("feishu");
      expect(fetch).toHaveBeenCalled();
    });
  });

  describe("导出文件", () => {
    it("导出客户：切换视图回原话、一行不给；不切换拿到数据", async () => {
      await 切到(人.老板, 人.总管);
      expect(await 导出客户({})).toEqual({ ok: false, error: 视图外部话 });

      await 登录成(人.总管);
      const 出 = await 导出客户({});
      expect(出.ok).toBe(true);
      expect(出.ok && 出.rows.length).toBe(1);
    });

    it("完整导出：切换视图开不了头，不切换开得了", async () => {
      await 切到(人.老板, 人.总管);
      await expect(开始完整导出({})).rejects.toThrow(视图外部话);

      await 登录成(人.总管);
      expect(await 开始完整导出({})).toMatchObject({ 客户数: 1 });
    });
  });

  describe("上传、下载附件", () => {
    const 带编号 = (id: string) => ({ params: Promise.resolve({ id }) });
    const 字节 = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
    const 存一个 = (name: string, mime: string) => 存附件(prisma, { 挂在: { contactId: 甲的联系人 }, name, mime, 字节: 字节("内容") });
    const 取一个 = (id: string, 查询 = "") => 取(new Request(`http://x/api/attachments/${id}${查询}`), 带编号(id));
    const 删一个 = (id: string) => 删(new Request(`http://x/api/attachments/${id}`, { method: "DELETE" }), 带编号(id));

    it("传：切换视图 403 没存，不切换存上", async () => {
      const 传一个 = () => {
        const 体 = 字节("图");
        return 传(new Request(`http://x/api/attachments?contactId=${甲的联系人}&name=a.jpg`, {
          method: "POST",
          body: 体,
          headers: { "Content-Type": "image/jpeg", "Content-Length": String(体.byteLength) },
        }));
      };
      await 切到(人.老板, 人.甲);
      const 拒 = await 传一个();
      expect(拒.status).toBe(403);
      expect(await 拒.json()).toEqual({ error: 视图外部话 });
      expect(await prisma.attachment.count()).toBe(0);

      await 登录成(人.甲);
      expect((await 传一个()).status).toBe(200);
      expect(await prisma.attachment.count()).toBe(1);
    });

    it("删：切换视图 403 还在，不切换删掉", async () => {
      const a = await 存一个("a.jpg", "image/jpeg");
      // 删附件本来只有总管理能，所以看总管：拒掉只能是因为在预览
      await 切到(人.老板, 人.总管);
      const 拒 = await 删一个(a.id);
      expect(拒.status).toBe(403);
      expect(await 拒.json()).toEqual({ error: 视图外部话 });
      expect(await prisma.attachment.count()).toBe(1);

      await 登录成(人.总管);
      expect((await 删一个(a.id)).status).toBe(200);
      expect(await prisma.attachment.count()).toBe(0);
    });

    it("下载：切换视图 403（不是坏文件），不切换拿到附件", async () => {
      const 表 = await 存一个("客户.pdf", "application/pdf");
      await 切到(人.老板, 人.甲);
      const 拒 = await 取一个(表.id);
      expect(拒.status).toBe(403);
      expect(拒.headers.get("Content-Disposition")).toBeNull();
      expect(await 拒.json()).toEqual({ error: 视图外部话 });

      await 登录成(人.甲);
      const 放 = await 取一个(表.id);
      expect(放.status).toBe(200);
      expect(放.headers.get("Content-Disposition")).toContain("attachment");
    });

    it("图片：切换视图页面里照样看（预览要看），?download 存文件才拒", async () => {
      const 图 = await 存一个("a.jpg", "image/jpeg");
      await 切到(人.老板, 人.甲);
      const 看 = await 取一个(图.id);
      expect(看.status).toBe(200);
      expect(看.headers.get("Content-Disposition")).toContain("inline");
      expect((await 取一个(图.id, "?download")).status).toBe(403);

      await 登录成(人.甲);
      const 存 = await 取一个(图.id, "?download");
      expect(存.status).toBe(200);
      expect(存.headers.get("Content-Disposition")).toContain("attachment");
    });

    it("导入用的 Excel 上传：切换视图 403，不切换走到验文件", async () => {
      const 传表 = () => 传导入表(new Request("http://x/api/enterprise-import/upload", { method: "POST" }));
      await 切到(人.老板, 人.总管);
      const 拒 = await 传表();
      expect(拒.status).toBe(403);
      expect(await 拒.json()).toEqual({ error: 视图外部话 });

      await 登录成(人.总管);
      expect((await 传表()).status).toBe(400);
    });

    it("名片送服务器认字：切换视图 403，不切换认得出人", async () => {
      const 认 = () => 认扫名片的人(new Request("http://x/api/mobile/scan", { method: "POST" }));
      await 切到(人.老板, 人.甲);
      const 拒 = await 认();
      expect(拒).toBeInstanceOf(Response);
      expect((拒 as Response).status).toBe(403);

      await 登录成(人.甲);
      expect(await 认()).toEqual({ accountId: 人.甲 });
    });
  });

  describe("改自己的资料和密码", () => {
    it("切换视图直说只读（不是笼统的保存失败），库里没动；不切换照常改", async () => {
      const 只读话 = new 视图只读错误().message;
      await 切到(人.老板, 人.甲);
      expect(await 改我的资料({ name: "改名了", title: "" })).toEqual({ ok: false, error: 只读话 });
      expect(await changeMyPassword("x", "新密码新密码1")).toEqual({ ok: false, error: 只读话 });
      const 甲 = await prisma.user.findUnique({ where: { id: 人.甲 } });
      expect(甲?.name).toBe("业务员甲");
      expect(甲?.password).toBe("x");

      await 登录成(人.甲);
      expect(await 改我的资料({ name: "改名了", title: "" })).toEqual({ ok: true });
      expect((await prisma.user.findUnique({ where: { id: 人.甲 } }))?.name).toBe("改名了");
    });
  });
});
