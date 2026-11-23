/**
 * 往企业版服务器的 .secret-env 里加一条加密的密钥（11-22，录音点评 PR4，方案 §4.5）：
 *
 *   <密钥来源> | node ent-secret-put.mjs <变量名> [--dir <实例目录>]
 *   例：security find-generic-password -s <钥匙串条目> -w | ssh root@<服务器> 'cd /opt/crm-enterprise && ./node/bin/node ent-secret-put.mjs ENT_TENCENT_ASR_SECRET_ID_ENC'
 *
 * - 明文只从标准输入读（去掉首尾空白），不收命令行参数里的值、不读文件、不回显、不打印长度
 * - 加密和程序里 src/lib/settings.ts encryptSecret 一样：AES-256-GCM，钥匙 = sha256("setting-secret:" + 会话密钥)，写成 enc:v1:<base64>；
 *   会话密钥读实例目录下的 auth-secret（run.sh 也是从它读 AUTH_SECRET）；没有这个文件才用环境变量 AUTH_SECRET
 * - 写到实例目录下的 .secret-env 末尾一行「变量名=密文」：文件末尾没换行先补一个；同名变量已经有了（注释掉的不算）就拒绝、什么都不改；
 *   新建的文件 600，已有的文件改完也收成 600
 * - 变量名只收 ENT_ 开头、_ENC 结尾的大写名（防手滑写成别的）
 * 退出码：0 写好；2 用法不对 / 标准输入空；3 同名已经有了；4 读不到会话密钥
 * 只用 node 自带模块，服务器上直接跑（和 telemetry-daily.mjs 一样单个文件拷过去）。改了加密写法要和 settings.ts 一起改（tests/ent-asr-tencent.test.ts 钉着两边解得开）
 */
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const 前缀 = "enc:v1:";

/** 和 settings.ts encryptSecret 同一个写法 */
export function 加密(明文, 会话密钥) {
  const 钥 = createHash("sha256").update(`setting-secret:${会话密钥}`).digest();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", 钥, iv);
  const 数据 = Buffer.concat([c.update(明文, "utf8"), c.final()]);
  return 前缀 + Buffer.concat([iv, c.getAuthTag(), 数据]).toString("base64");
}

export const 变量名对 = (x) => typeof x === "string" && /^ENT_[A-Z0-9_]{1,80}_ENC$/.test(x);

/** 读会话密钥：实例目录的 auth-secret（去掉末尾换行，同 run.sh 的 $(cat auth-secret)），没有再看环境 */
export function 读会话密钥(目录, env = process.env) {
  const f = path.join(目录, "auth-secret");
  if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").replace(/\n+$/, "") || null;
  return env.AUTH_SECRET || null;
}

/** 写一条：回 0 / 3 / 4（见文件头）。不打印任何值 */
export function 写一条(目录, 变量名, 明文, env = process.env) {
  const 会话密钥 = 读会话密钥(目录, env);
  if (!会话密钥) return 4;
  const 文件 = path.join(目录, ".secret-env");
  const 原 = fs.existsSync(文件) ? fs.readFileSync(文件, "utf8") : "";
  if (原.split(/\r?\n/).some((行) => new RegExp(`^\\s*(export\\s+)?${变量名}=`).test(行))) return 3;
  const 行 = `${变量名}=${加密(明文, 会话密钥)}\n`;
  fs.appendFileSync(文件, (原 && !原.endsWith("\n") ? "\n" : "") + 行, { mode: 0o600 });
  fs.chmodSync(文件, 0o600);
  return 0;
}

async function 读标准输入() {
  const 块 = [];
  for await (const x of process.stdin) 块.push(x);
  return Buffer.concat(块).toString("utf8").trim();
}

async function 主() {
  const 参 = process.argv.slice(2);
  let 目录 = process.cwd();
  const i = 参.indexOf("--dir");
  if (i >= 0) {
    目录 = 参[i + 1] ?? "";
    参.splice(i, 2);
  }
  const [变量名, ...多的] = 参;
  if (!变量名对(变量名) || 多的.length || !目录) {
    console.error("用法：<密钥来源> | node ent-secret-put.mjs ENT_..._ENC [--dir 实例目录]（值只从标准输入读）");
    process.exit(2);
  }
  if (process.stdin.isTTY) {
    console.error("值要从管道给（标准输入），不在终端里敲");
    process.exit(2);
  }
  const 明文 = await 读标准输入();
  if (!明文) {
    console.error("标准输入是空的，没写");
    process.exit(2);
  }
  const 码 = 写一条(path.resolve(目录), 变量名, 明文);
  if (码 === 3) console.error(`${变量名} 已经有了，没改（要换先手动删掉那一行）`);
  else if (码 === 4) console.error("读不到会话密钥（实例目录下没有 auth-secret，也没有 AUTH_SECRET），没写");
  else console.log(`已写入 ${变量名}（密文，值不打印）；重启服务后生效`);
  process.exit(码);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await 主();
