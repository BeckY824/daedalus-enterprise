"use client";

import { requiredText, isFormValidationError } from "@/lib/form-validation";
import CustomerSearchSelect from "@/components/CustomerSearchSelect";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Modal, Form, Input, Switch, Row, Col, AutoComplete, Button, Select, Space, Alert } from "antd";
import SaveButton from "@/components/SaveButton";
import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import DatePicker from "@/components/BusinessDatePicker";
import { dayjs } from "@/lib/utils";
import { 性别们, 爱好上限, 联系人地址上限, 号码上限, 每人最多号码, 联系人姓名问题, 姓名号码至少一项 } from "@/lib/enterprise/customer-v2";
import { saveContact, saveUnassignedContact, 联系人号码先查 } from "./actions";
import { 挂到客户 } from "./contact-link-actions";
import RescueKey from "../RescueKey";
import type { 撞到的联系人 } from "@/lib/enterprise/contact-dedupe";
import type { ContactRow } from "./types";
import { useBusiness } from "@/lib/business-client";
import { 关系候选 } from "@/lib/business-config";
import { 聚焦首项 } from "@/lib/modal-focus";
import { useFormGuard } from "@/lib/form-guard";
import InlineConfirm from "@/components/InlineConfirm";
import { 跑出原因, type 做的结果 } from "@/lib/confirm-result";
import { 动作出错话 } from "@/lib/stale-deploy";

/*
  与客户的关系。取值有限却不封闭（教培里有姑姑、哥哥，公司里有「副总」），
  所以用 AutoComplete 给常用项、同时允许自己填，不用 Select 硬约束。
  候选跟着业务配置走（lib/business-config.ts 的 关系候选，审查 M14）。

  数据库列名仍是 position（原本是 To B 的「职务」），
  改列要动迁移，而迁移纪律是只增不改；列名是内部的，界面上叫什么才是用户看到的。
*/

/**
 * 联系人表单。两处共用：学员记录页（已经知道是谁，不问）和联系人列表页
 * （跨学员的入口，必须先选人）。
 *
 * 不给列表页另写一份：两份表单迟早会长出不同的字段和不同的校验，
 * 而「这个人是谁的联系人」恰恰是唯一的差别——一个 Select 的事。
 */
export default function ContactForm({
  open,
  onClose,
  onSaved,
  customerId,
  学员们,
  record,
  未归属 = false,
  onDelete,
  号码种类,
  职务选项,
  存法,
}: {
  open: boolean;
  onClose: () => void;
  /** 新加到这位客户上的（新建、或撞号后挂过来）带上联系人 id，记录页拿它排最前、闪一下（11-03 C1-8）；改资料不带 */
  onSaved: (新加的?: string) => void;
  /** 记录页上给定；列表页上不给，改由表单里选 */
  customerId?: string;
  /** 只有不给 customerId 时才用得上：可选的学员 */
  学员们?: { id: string; name: string; label?: string }[];
  record: ContactRow | null;
  /**
   * 改的是一位从客户上移出的联系人（联系人页里写「未归属」那种）。
   * 这时「所属」可以不挑——不挑就还留在未归属，挑了就是挂回去
   */
  未归属?: boolean;
  /** 给了就在左下角摆「彻底删除」，点了就地确认一次（ls.ct.orphan）。联系人页上未归属的人只有这儿能删 */
  onDelete?: () => 做的结果 | Promise<做的结果>;
  /**
   * 企业版联系人改版（2026-10-29，定稿 P5 第 24 条）：给了就换成企业版那一套——性别、生日、爱好、地址，
   * 联系方式是几行「类型 + 号码」（类型来自字典 contactKind；active=false 的停用了，下拉里只给这位原来就用着的）。
   * 不给 = 手机 / 邮箱 / 微信三格（个人版、团队版、联系人列表页）
   */
  号码种类?: { 名: string; kind: string; active: boolean }[];
  /**
   * 企业版「职务」下拉的候选（10-31，字典 contactTitle）：企业版这一格叫「职务」，从下拉挑、也能手填字典外的叫法；
   * 存的还是 position 那一列，库里已有的文字原样显示。非企业版不看它，照旧「与客户关系」
   */
  职务选项?: string[];
  /**
   * 换一个存法（默认 saveContact）：受限客户详情（只负责项目的人）走 project-only-contact-actions.ts。
   * 给了就不摆「关键联系人」开关、撞号时不摆「挂到本客户」（那边都不收）
   */
  存法?: (x: Parameters<typeof saveContact>[0]) => Promise<{ ok: true; id: string } | { ok: false; error: string; 撞了?: 撞到的联系人[]; 回收站?: { 类型: string; 值: string } }>;
}) {
  const [form] = Form.useForm();
  const b = useBusiness();
  const 挑的 = Form.useWatch("customerId", form) as string | undefined;
  /** 未归属又还没挑客户：谈不上是谁的关键联系人，那个开关不摆 */
  const 还没归属 = 未归属 && !挑的;
  // 点外面不关、关前问一句、新建的草稿留在本机（2026-10-19 客户反馈，lib/form-guard.tsx）。联系人页上挑客户的，客户不进草稿
  const 守 = useFormGuard({
    open,
    form,
    草稿键: record ? `编辑联系人:${record.id}` : `新建联系人:${customerId ?? "挑人"}`,
    编辑: !!record,
    关: onClose,
    afterOpenChange: 聚焦首项,
    不存: customerId ? [] : ["customerId"],
  });

  const 企业 = !!号码种类;
  /** 第一种还在用的（一般是手机）：新加一行默认它 */
  const 默认种类 = 号码种类?.find((x) => x.active)?.kind;
  useEffect(() => {
    if (!open) return;
    if (record) {
      form.setFieldsValue({
        ...record,
        customerId: undefined,
        ...(企业 ? { birthday: record.birthday ? dayjs(record.birthday) : null, 号码们: record.号码们?.length ? record.号码们 : [{ kind: 默认种类, value: "" }] } : {}),
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ isPrimary: false, ...(企业 ? { 号码们: [{ kind: 默认种类, value: "" }] } : {}) });
    }
  }, [open, record, form, 企业, 默认种类]);
  /** 下拉里能选的类型：启用中的，加上这位原来就有、后来停用或改名的（原样摆着，不然一编辑就丢了） */
  const 类型选项 = (() => {
    if (!号码种类) return [];
    const 原有 = new Set((record?.号码们 ?? []).map((x) => x.kind));
    const 叫法 = (kind: string) => 号码种类.find((x) => x.kind === kind)?.名 ?? (kind.startsWith("custom:") ? kind.slice(7) : kind);
    const 们 = 号码种类.filter((x) => x.active || 原有.has(x.kind)).map((x) => ({ value: x.kind, label: x.active ? x.名 : `${x.名}（已停用）` }));
    for (const k of 原有) if (!们.some((x) => x.value === k)) 们.push({ value: k, label: 叫法(k) });
    return 们;
  })();
  const 叫法 = (kind: string) => 号码种类?.find((x) => x.kind === kind)?.名 ?? (kind.startsWith("custom:") ? kind.slice(7) : kind);
  /** 撞到的那位直接挂到本客户上（不新建），关框 */
  async function 挂过来(contactId: string) {
    if (!customerId || 存着) return;
    set存着(true);
    try {
      set就地错(null);
      const r = await 挂到客户(contactId, customerId).catch((出错) => ({ ok: false as const, error: 动作出错话(出错, "没挂上，请重试") }));
      if (!r.ok) return void set就地错(r.error);
      守.存好了();
      onSaved(contactId);
    } finally {
      set存着(false);
    }
  }

  /*
    保存中：网慢时连点两下会建出两条一样的记录（跟进带的 AI 待办和计划也各建两份，2026-10-02 排查）。
    校验没过（validateFields 抛出）也会走 finally 放开
  */
  const [存着, set存着] = useState(false);
  /** 彻底删除没删成的原因：就地写在删除键旁（不弹顶部提示） */
  const [删错, set删错] = useState<string | null>(null);
  /**
   * 企业版号码查重撞了（P13 第 2 条）：不静默合并，框顶上摆撞到的那几位（看得到的能点进去）。
   * 人核对后可以「仍然保存」（同一个号两个人用），或在客户页上直接把那位挂到这位客户上
   */
  const [撞号, set撞号] = useState<撞到的联系人[] | null>(null);
  /** 号码在回收站里的客户上（审核 11-18 新建入口 P2-6，P-删-08）：拦下，框顶上摆「从回收站捞回」（同建档入口） */
  const [回收站号, set回收站号] = useState<{ 类型: string; 值: string } | null>(null);
  /** 撞号是失焦先查出来的（还没点保存）：黄条标题换一句；点保存撞了的照旧 */
  const [先查的, set先查的] = useState(false);
  const 查序 = useRef(0);
  /** dt.contact：号码那格失焦就查一遍撞没撞（企业版），撞了把黄条摆出来，给「挂到本客户」「仍然新建」 */
  async function 失焦查号() {
    if (!企业) return;
    const 们 = ((form.getFieldValue("号码们") ?? []) as { kind?: string; value?: string }[])
      .filter((x) => x?.kind && x.value?.trim())
      .map((x) => ({ kind: x.kind!, value: x.value!.trim() }));
    const 序 = ++查序.current;
    if (!们.length) return;
    const r = await 联系人号码先查(们, record?.id ?? null, customerId ?? null).catch(() => null);
    if (序 !== 查序.current || !r?.ok) return;
    if (r.撞了.length) { set撞号(r.撞了); set先查的(true); }
  }
  // 重新打开框时收起上次的黄条（渲染时比对，不放进 effect 里 setState）
  const [上次开着, set上次开着] = useState(open);
  if (上次开着 !== open) {
    set上次开着(open);
    if (open) { set撞号(null); set回收站号(null); }
  }
  /** 黄条里「挂到本客户」「仍然保存」没成的原因：就地写在框顶上（不弹顶部提示，原型 g.notice） */
  const [就地错, set就地错] = useState<string | null>(null);
  /** 存上了、等对勾放完再交回去（SaveButton 的 成了）；这时点取消 / Esc 也照样交回去 */
  const 存好交回 = useRef<(() => void) | null>(null);
  function 交回() {
    const f = 存好交回.current;
    存好交回.current = null;
    f?.();
  }
  function 关或收尾() {
    if (存好交回.current) 交回();
    else 守.要关();
  }
  /** 保存键（原型 g.save）：保存中 / 已保存 / 没存上都在键里；回 { ok:false, error } = 没存上，原因浮在键上方 */
  async function 保存(照存 = false): Promise<{ ok: boolean; error?: string }> {
    if (存着) return { ok: false, error: "正在保存，请稍等" };
    set存着(true);
    set就地错(null);
    try {
      return await onOk(照存);
    } catch (error) {
      return { ok: false, error: isFormValidationError(error) ? "有几项没填好，看标红的" : "保存失败，请刷新确认结果后重试" };
    } finally {
      set存着(false);
    }
  }
  /** 黄条里的「仍然保存 / 仍然新建」：不经保存键，成了直接交回，没成原因写在框顶上 */
  async function 照存() {
    const r = await 保存(true);
    if (r.ok) 交回();
    else if (r.error) set就地错(r.error);
  }

  async function onOk(照存 = false): Promise<{ ok: boolean; error?: string }> {
    const v = await form.validateFields();
    // 记录页给的 customerId 说了算；列表页上它在表单里
    const 归属 = customerId ?? (v.customerId as string);
    if (未归属 && record) {
      // 未归属的人：挑了客户就是挂过去，不挑就还留在未归属、只改资料
      const r = await saveUnassignedContact({ id: record.id, 版本: record.updatedAt, ...v, isPrimary: Boolean(v.isPrimary), customerId: 归属 || null });
      if (!r.ok) return { ok: false, error: r.error };
      守.存好了();
      存好交回.current = () => onSaved();
      return { ok: true };
    }
    // 企业版：新几格和号码几行另装一包（actions.ts 的 企业联系人资料），老三格由号码几行算，不再单交
    const { gender, birthday, hobby, address, 号码们, ...其余 } = v as Record<string, unknown> & { birthday?: { format: (f: string) => string } | null; 号码们?: { kind?: string; value?: string }[] };
    const 企业资料 = 企业
      ? {
          gender: (gender as string | undefined) ?? null,
          birthday: birthday ? birthday.format("YYYY-MM-DD") : null,
          hobby: (hobby as string | undefined) ?? null,
          address: (address as string | undefined) ?? null,
          号码们: (号码们 ?? []).filter((x) => x && x.value && x.value.trim()).map((x) => ({ kind: x.kind ?? "", value: x.value ?? "" })),
        }
      : null;
    const r = await (存法 ?? saveContact)({ id: record?.id, 版本: record?.updatedAt, ...(企业 ? { ...其余, name: typeof 其余.name === "string" ? 其余.name : "" } : v), isPrimary: Boolean(v.isPrimary), customerId: 归属, ...(企业资料 ? { 企业: 企业资料 } : {}), ...(照存 ? { 照存: true } : {}) } as Parameters<typeof saveContact>[0]);
    // 原来不看返回值：联系人刚被别人移出、或电话不收时，弹框卡在那儿什么也不说（排查 D8）
    if (!r.ok) {
      if ("撞了" in r && r.撞了?.length) { set先查的(false); set撞号(r.撞了); return { ok: false, error: "号码撞了，看框顶上" }; }
      if ("回收站" in r && r.回收站) { set回收站号(r.回收站); return { ok: false, error: "号码在回收站里，看框顶上" }; }
      return { ok: false, error: r.error };
    }
    守.存好了();
    存好交回.current = () => onSaved(record ? undefined : r.id);
    return { ok: true };
  }

  const 脚 = (() => {
    const 原来的 = (
      <>
        <Button onClick={关或收尾}>取消</Button>
        <SaveButton 做={() => 保存()} 已保存={record ? "已保存" : "已添加"} 没保存="没存上" 成了={交回}>保存</SaveButton>
      </>
    );
    return onDelete ? (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="ls-ct-del">
          <InlineConfirm
            问="彻底删掉这位联系人？"
            是="彻底删除"
            做={async () => {
              const 因 = await 跑出原因(onDelete);
              set删错(因);
              return 因 ? { ok: false, error: 因 } : { ok: true };
            }}
          >
            <Button danger type="text">
              彻底删除
            </Button>
          </InlineConfirm>
          {删错 && <span className="ls-row-err" role="alert" title={删错}>{删错}</span>}
        </span>
        <div style={{ display: "flex", gap: 8 }}>{原来的}</div>
      </div>
    ) : (
      原来的
    );
  })();
  const 身 = (
    <>
      {就地错 && <div className="csq-err" role="alert">{就地错}</div>}
      {回收站号 && (
        <Alert
          type="warning"
          showIcon
          className="cf-trash-hit"
          data-testid="contact-trash-hit"
          message="这个号码在回收站里的客户上，本次没保存"
          description={<RescueKey 类型={回收站号.类型} 值={回收站号.值} 捞回了={() => {}} />}
        />
      )}
      {撞号 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 8 }}
          message={先查的 ? "这个号码已经记在别的联系人或客户身上，先核对一下" : "这些号码已经记在别的联系人或客户身上，本次没保存"}
          description={
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {撞号.map((x, i) => (
                <div key={`${x.kind}-${x.value}-${i}`} style={{ overflowWrap: "anywhere" }}>
                  {叫法(x.kind)} {x.value}：
                  {x.客户本身 ? (
                    x.customerId ? (
                      <Link href={`/customers/${encodeURIComponent(x.customerId)}`} target="_blank">{b.customer}「{x.customerName}」本身的号码</Link>
                    ) : `${x.同事}名下的一位${b.customer}（不在你的范围，可与他核实）`
                  ) : x.contactId && x.customerId ? (
                    <>
                      <Link href={`/customers/${encodeURIComponent(x.customerId)}`} target="_blank">
                        {x.name}（{x.customerName}）
                      </Link>
                      {/* 客户页上新建：多半就是同一个人，直接挂过来比再建一位好 */}
                      {!record && customerId && !存法 && x.customerId !== customerId && (
                        <Button type="link" size="small" style={{ padding: "0 4px", height: "auto" }} disabled={存着} onClick={() => void 挂过来(x.contactId!)}>
                          挂到本{b.customer}
                        </Button>
                      )}
                    </>
                  ) : (
                    `${x.同事}名下的一位联系人（不在你的范围，可与他核实）`
                  )}
                </div>
              ))}
              <div>
                确认是另一个人（比如共用的总机）：
                <Button type="link" size="small" style={{ padding: 0, height: "auto" }} disabled={存着} onClick={() => void 照存()}>
                  {record ? "仍然保存" : "仍然新建"}
                </Button>
              </div>
            </div>
          }
        />
      )}
      {守.提示}
      <Form form={form} layout="vertical" style={{ marginTop: 8 }} onValuesChange={() => { 守.改了(); 查序.current++; if (撞号) set撞号(null); if (回收站号) set回收站号(null); }}>
        <Row gutter={16}>
          {/* 从联系人列表进来时先选人：联系人挂在某一位学员下面，没有归属的联系人没有意义 */}
          {!customerId && (
            <Col span={24}>
              <Form.Item
                name="customerId"
                label={`所属${b.customer}`}
                rules={未归属 ? [] : [{ required: true, message: `请选择所属${b.customer}` }]}
                extra={未归属 && !挑的 ? `现在不在任何${b.customer}下面。挑一位就挂过去，不挑就还留在未归属` : undefined}
              >
                <CustomerSearchSelect
                  allowClear={未归属}
                  onChange={(id) => {
                    if (未归属) form.setFieldValue("isPrimary", id === record?.fromCustomerId && record?.wasPrimary === true);
                  }}
                  placeholder={未归属 ? `未归属（挑一位${b.customer}挂过去）` : `搜索并选择一位${b.customer}`}
                  // 重名的显示成「王强（星辰科技 · 尾号 1111）」，不然两行一样的「王强」挑错了也看不出（2026-10-04 J-016）
                  initialOptions={学员们}
                />
              </Form.Item>
            </Col>
          )}
          <Col span={12}>
            {/* 企业版姓名选填（11-17 员工反馈）：姓名和联系方式至少一项，空着存空串、显示「—」；别的版本照旧必填 */}
            <Form.Item
              name="name"
              label="姓名"
              dependencies={企业 ? ["号码们"] : undefined}
              rules={企业 ? [{ validator: (_: unknown, v: unknown) => (联系人姓名问题(true, v, ((form.getFieldValue("号码们") ?? []) as { value?: string }[]).map((x) => x?.value)) ? Promise.reject(new Error(姓名号码至少一项)) : Promise.resolve()) }] : [requiredText("请填写姓名")]}
            >
              <Input placeholder="张伟" />
            </Form.Item>
          </Col>
          <Col span={12}>
            {企业 ? (
              <Form.Item name="position" label="职务">
                <AutoComplete aria-label="职务" options={(职务选项 ?? []).map((v) => ({ value: v }))} placeholder="下拉挑，或直接填" allowClear />
              </Form.Item>
            ) : (
              <Form.Item name="position" label={`与${b.customer}关系`}>
                <AutoComplete options={关系候选(b).map((v) => ({ value: v }))} placeholder={关系候选(b)[0]} />
              </Form.Item>
            )}
          </Col>
          {企业 ? (
            <>
              <Col span={12}>
                <Form.Item name="gender" label="性别">
                  <Select allowClear placeholder="不填" options={性别们.map((g) => ({ value: g, label: g }))} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="birthday" label="生日">
                  <DatePicker style={{ width: "100%" }} placeholder="选日子" disabledDate={(d) => d.isAfter(dayjs(), "day")} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="hobby" label="爱好">
                  <Input maxLength={爱好上限} placeholder="如 高尔夫、茶" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="address" label="地址">
                  <Input maxLength={联系人地址上限} placeholder="可收件的真实地址" />
                </Form.Item>
              </Col>
              {/* 联系方式几行（类型 + 号码）：一人可以有好几个手机、座机、微信……类型在「设置 → 字典 → 号码类型」里加 */}
              <Col span={24}>
                <div style={{ marginBottom: 8 }}>联系方式</div>
                <Form.List name="号码们">
                  {(行们, { add, remove }) => (
                    <>
                      {行们.map((行) => (
                        <Space.Compact key={行.key} style={{ display: "flex", marginBottom: 8 }}>
                          <Form.Item name={[行.name, "kind"]} noStyle rules={[{ required: true, message: "选类型" }]}>
                            <Select style={{ width: 130 }} options={类型选项} aria-label="号码类型" />
                          </Form.Item>
                          <Form.Item name={[行.name, "value"]} noStyle>
                            <Input maxLength={号码上限} placeholder="号码或账号" aria-label="号码" onBlur={() => void 失焦查号()} />
                          </Form.Item>
                          <Button icon={<MinusCircleOutlined />} onClick={() => remove(行.name)} aria-label="去掉这一行" />
                        </Space.Compact>
                      ))}
                      {行们.length < 每人最多号码 && (
                        <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ kind: 默认种类, value: "" })} style={{ marginBottom: 16 }}>
                          加一个联系方式
                        </Button>
                      )}
                    </>
                  )}
                </Form.List>
              </Col>
            </>
          ) : (
            <>
              <Col span={12}>
                <Form.Item name="phone" label="手机号">
                  <Input placeholder="13800002211" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="email" label="邮箱">
                  <Input placeholder="name@company.com" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="wechat" label="微信">
                  <Input placeholder="微信号" />
                </Form.Item>
              </Col>
            </>
          )}
          {!还没归属 && !存法 && (
            <Col span={12}>
              <Form.Item name="isPrimary" label="关键联系人" valuePropName="checked" extra={未归属 && 挑的 === record?.fromCustomerId && record?.wasPrimary == null ? "移出前是否关键未记录，请核对后选择" : undefined}>
                <Switch checkedChildren="是" unCheckedChildren="否" />
              </Form.Item>
            </Col>
          )}
          <Col span={24}>
            <Form.Item name="remark" label="备注">
              <Input.TextArea rows={2} placeholder="决策角色、沟通偏好、注意事项…" />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </>
  );
  const 题 = record ? `编辑联系人 · ${record.name || "—"}` : "添加联系人";

  return (
    <Modal
      {...守.弹窗}
      open={open}
      title={题}
      onCancel={关或收尾}
      width={560}
      destroyOnHidden
      footer={脚}
    >
      {身}
    </Modal>
  );
}
