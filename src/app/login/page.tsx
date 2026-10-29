import LoginForm from "./LoginForm";
import { 能找回密码 } from "@/lib/tenant/password-reset";
import { multiTenant } from "@/lib/tenant/context";
import { 自助注册已关闭 } from "@/lib/tenant/signup-policy";
import { 自定产品名 } from "@/lib/enterprise/brand";
import { 读演示名单 } from "@/lib/enterprise/demo-switch";
import DemoLogin from "./DemoLogin";

/**
 * 必须动态渲染：要不要画「忘记密码」取决于运行时的 MULTI_TENANT 和 SMTP_*。
 * 默认会被预渲染成静态页，那样构建时是什么样，容器里就永远是什么样。
 */
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  /* 演示部署（CRM_DEMO_SWITCH=1）：不要密码，选人就进。开关关着读出来是 null，走下面的正常登录 */
  const 演示名单 = await 读演示名单();
  if (演示名单) return <DemoLogin 名单={演示名单} 产品名={自定产品名() ?? undefined} />;

  /*
    登录框那一格叫什么，取决于这个部署里账号长什么样：
      托管版  —— 注册就是邮箱验证码开的号，只有邮箱（设计稿 20/AUTH：登录统一使用邮箱）
      自部署  —— 管理员在设置里建的成员，登录名是 admin、zhangsan 这样的用户名
    写死一个的话，另一半人会对着一个填不进去的框反复试。
  */
  return (
    <LoginForm
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
