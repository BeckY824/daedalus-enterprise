/**
 * 测试用：另起一个真的 node 进程去占跨进程锁（lib/proc-lock.ts），模拟「另一个服务进程」。
 * proc-lock.ts 只用 node 内置模块，node 22.6+ 直接剥类型就能 import。
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const 模块 = path.resolve(__dirname, "../src/lib/proc-lock.ts");

const 脚本 = `
const [, , mod, dir, name, who] = process.argv;
const m = await import(mod);
const r = m.占锁(name, { 目录: dir, 附: { 谁: who, 开始: new Date().toISOString() }, 心跳毫秒: 0 });
process.stdout.write(r.ok ? "OK\\n" : "HELD\\n");
process.stdin.on("data", () => { if (r.ok) r.锁.放(); process.stdout.write("BYE\\n"); process.exit(0); });
process.stdin.resume();
`;

let 脚本文件: string | null = null;
function 脚本路径(): string {
  if (脚本文件 && fs.existsSync(脚本文件)) return 脚本文件;
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "crm-proc-lock-child-"));
  脚本文件 = path.join(d, "child.mjs");
  fs.writeFileSync(脚本文件, 脚本);
  return 脚本文件;
}

export type 子进程 = {
  pid: number;
  结果: "OK" | "HELD";
  /** 正常放锁退出 */
  放: () => Promise<void>;
  /** kill -9：模拟进程崩了，锁文件留在那 */
  杀: () => Promise<void>;
};

function 等一行(c: ChildProcess, 要: RegExp): Promise<string> {
  return new Promise((ok, no) => {
    let 攒 = "";
    let 错 = "";
    const t = setTimeout(() => no(new Error(`子进程没回话：${攒}${错}`)), 15_000);
    c.stderr!.on("data", (b) => (错 += String(b)));
    c.stdout!.on("data", (b) => {
      攒 += String(b);
      const m = 攒.match(要);
      if (m) {
        clearTimeout(t);
        ok(m[0]);
      }
    });
    c.once("exit", (code) => {
      clearTimeout(t);
      if (!要.test(攒)) no(new Error(`子进程退出了（${code}）：${攒}${错}`));
    });
  });
}

export async function 开子进程占锁(目录: string, 名: string, 谁: string): Promise<子进程> {
  const c = spawn(process.execPath, ["--no-warnings", 脚本路径(), 模块, 目录, 名, 谁], { stdio: ["pipe", "pipe", "pipe"] });
  const 结果 = (await 等一行(c, /OK|HELD/)) as "OK" | "HELD";
  const 退了 = new Promise<void>((ok) => (c.exitCode !== null ? ok() : c.once("exit", () => ok())));
  return {
    pid: c.pid!,
    结果,
    放: async () => {
      c.stdin!.write("x\n");
      await 退了;
    },
    杀: async () => {
      c.kill("SIGKILL");
      await 退了;
    },
  };
}
