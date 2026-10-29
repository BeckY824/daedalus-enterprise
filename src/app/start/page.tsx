import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";

/**
 * 登录 / 注册成功后先落到这里（login/after-login.ts、app/page.tsx 都跳 /start）。
 * 原来桌面端新库在这儿先选模版；那条只在桌面端本地模式下成立，企业版跑不到，
 * 选模版的页面和动作在死代码第三批删了，这一页只剩把人送去首页。
 */
export const dynamic = "force-dynamic";

export default async function StartPage() {
  await requireUser();
  redirect("/dashboard");
}
