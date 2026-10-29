import bcrypt from "bcryptjs";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * 密码哈希统一走这里。
 *
 * 为什么换掉 bcryptjs：它是纯 JS，算一次（10 轮）约 50 ms，全压在 Node 主线程上。
 * 30 人同一刻登录要排队一个个算，S6 压测 p95 1666 ms（线 800）；本机实测 30 个并发比对合计 1605 ms。
 * Node 自带的 scrypt 在 libuv 线程池里算，不占主线程、能并行，同样 30 个合计约 200 ms。
 *
 * 存法：`scrypt$N$r$p$<盐 base64>$<哈希 base64>`，参数随串存，以后要调强度只改下面的常量，老串照样能核。
 * 老的 bcrypt 串（`$2a$` / `$2b$` 开头）照样认；登录对上后由调用方用 要升级() 判断、顺手换成新串。
 * 别的串（同步建号的占位、托管版业务库里的 `!managed`）一律对不上。
 *
 * N=2^14、r=8：每次 16 MB 内存，线程池默认 4 条，同时最多 64 MB。
 */
const N = 16384;
const R = 8;
const P = 1;
const 长度 = 64;
const 前缀 = "scrypt$";

function 算(password: string, salt: Buffer, n: number, r: number, p: number, len: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, len, { N: n, r, p, maxmem: 256 * n * r + 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function 哈希密码(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await 算(password, salt, N, R, P, 长度);
  return `${前缀}${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function 核对密码串(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  if (stored.startsWith(前缀)) {
    const [, n, r, p, salt, hash] = stored.split("$");
    const 期望 = Buffer.from(hash ?? "", "base64");
    if (!期望.length || !salt) return false;
    const key = await 算(password, Buffer.from(salt, "base64"), Number(n), Number(r), Number(p), 期望.length);
    return timingSafeEqual(key, 期望);
  }
  if (stored.startsWith("$2")) return bcrypt.compare(password, stored);
  return false;
}

/** 存的还不是当前参数的 scrypt 串：登录对上后换一下 */
export function 要升级(stored: string): boolean {
  return !stored.startsWith(`${前缀}${N}$${R}$${P}$`);
}
