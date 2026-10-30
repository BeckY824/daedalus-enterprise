import LoginForm from "./LoginForm";
import { 能找回密码 } from "@/lib/tenant/password-reset";
import { multiTenant } from "@/lib/tenant/context";
import { 自助注册已关闭 } from "@/lib/tenant/signup-policy";
import { 自定产品名 } from "@/lib/enterprise/brand";
import { 读演示名单 } from "@/lib/enterprise/demo-switch";
import DemoLogin from "./DemoLogin";
import { 飞书登录凭据, type 飞书登录失败 } from "@/lib/enterprise/feishu-login";

/** 飞书登录没成时，回调带回来的原因（/login?reason=feishu-<原因>）怎么跟人说 */
const 飞书原因: Record<飞书登录失败, string> = {
  off: "这个部署没有接飞书登录，请用用户名和密码登录。",
  state: "飞书登录超时或被打断了，请再点一次「用飞书登录」。",
  denied: "你在飞书里取消了授权，没有登录。",
  exchange: "没能从飞书取到你的身份，请稍后再试；一直不行请联系管理员。",
  nomatch: "CRM 里没有和你飞书姓名相同的账号。请管理员把 CRM 账号的姓名改成和飞书一致，或先用用户名和密码登录。",
  dup: "CRM 里有不止一个和你飞书姓名相同的账号，认不出是哪个。请管理员改掉重名账号的姓名。",
  taken: "和你飞书姓名相同的 CRM 账号已经绑定了别的飞书身份。请管理员在「设置 → 成员」里解绑后再试。",
  inactive: "你的 CRM 账号已停用，请联系管理员。",
};

/**
 * 必须动态渲染：要不要画「忘记密码」取决于运行时的 MULTI_TENANT 和 SMTP_*。
 * 默认会被预渲染成静态页，那样构建时是什么样，容器里就永远是什么样。
 */
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string | string[] }> }) {
  /* 演示部署（CRM_DEMO_SWITCH=1）：不要密码，选人就进。开关关着读出来是 null，走下面的正常登录 */
  const 演示名单 = await 读演示名单();
  if (演示名单) return <DemoLogin 名单={演示名单} 产品名={自定产品名() ?? undefined} />;

  /*
    登录框那一格叫什么，取决于这个部署里账号长什么样：
      托管版  —— 注册就是邮箱验证码开的号，只有邮箱（设计稿 20/AUTH：登录统一使用邮箱）
      自部署  —— 管理员在设置里建的成员，登录名是 admin、zhangsan 这样的用户名
    写死一个的话，另一半人会对着一个填不进去的框反复试。
  */
  const reason = (await searchParams).reason;
  const 飞书没成 = typeof reason === "string" && reason.startsWith("feishu-") ? 飞书原因[reason.slice(7) as 飞书登录失败] : undefined;
  return (
    <LoginForm
      /* 企业版配了飞书应用才有「用飞书登录」（lib/enterprise/feishu-login.ts） */
      飞书登录={(await 飞书登录凭据()) !== null}
      初始错误={飞书没成}
      可找回密码={能找回密码()}
      用邮箱={multiTenant()}
      /* 注册入口两端一致（2026-09-20）。托管版才有自助注册这回事：
         自部署的成员是管理员在设置里建的，那儿没有注册这条路。
         关掉自助注册（SIGNUP_REDIRECT）时这个入口跟着消失，和桌面端问 policy 得到的答案同源。 */
      可注册={multiTenant() && !自助注册已关闭()}
      注册地址="/signup"
      产品名={自定产品名() ?? undefined}
    />
  );
}
