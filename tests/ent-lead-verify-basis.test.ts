/**
 * 线索验证面板「判定依据」（员工反馈 #7）：写的就是系统真在拦的那一份——
 *   判有效列的项 = 有效沟通还差（所有项都没填时）= 推进时 缺有效沟通还差 报的项；没配看需求状态（M-线索-01、M-必填-02、M-必填-03）
 *   判无效按 初判即终判 / 无效交给 三种走法（lead-verify.ts，M-线索-02）
 */
import { describe, expect, it } from "vitest";
import { 线索验证依据 } from "@/lib/project/lead-verify-basis";
import { 有效沟通还差, 有效沟通要的, 必填叫法, type 必填数据, type 必填项 } from "@/lib/project/required";
import { 缺有效沟通还差 } from "@/lib/project/stage-gates";

const 空数据 = (线索验证必填: 必填项[]): 必填数据 => ({
  项目: { node: "线索验证", contactId: null, nextStepAt: null, expectedDealAt: null, amount: 0, remark: null, acceptancePassed: false },
  客户: { phone: null, extra: null },
  联系人们: [],
  沟通节点们: [],
  线索验证必填,
});

describe("线索验证判定依据", () => {
  it("配了必填：列的项 = 全没填时推进拦的那几项（去掉有效沟通、线索验证结果），用界面叫法", () => {
    for (const 配 of [
      ["主联系人", "国家", "需求"],
      ["主联系人", "国家", "需求", "有效沟通", "线索验证结果"],
      ["需求描述", "分配方式", "项目级别", "沟通三项", "下一步计划", "下一步时间"],
    ] as 必填项[][]) {
      const 依据 = 线索验证依据({ 线索验证必填: 配, 初判即终判: false, 无效交给: "市场复核" });
      const 差 = 有效沟通还差(空数据(配)).map(必填叫法);
      // 叫法里自己带「、」（沟通三项），所以整段比，不拆
      expect(依据.有效).toContain(`填齐——${差.join("、")}（「线索验证」配的必填项）`);
      expect(差).toEqual(有效沟通要的(配).map(必填叫法));
      // 推进被拦时报的话列的是同一批
      expect(缺有效沟通还差(差)).toContain(差.join("、"));
      expect(依据.有效).not.toContain("有效沟通、");
      expect(依据.有效).toContain("所有角色都一样");
    }
    expect(线索验证依据({ 线索验证必填: ["主联系人", "国家", "需求"], 初判即终判: false }).有效).toContain("所属联系人、国家、需求（需求状态）");
  });

  it("没配（或只配了有效沟通、线索验证结果）：只看需求状态，「—」不算；和 有效沟通还差 退回需求一致", () => {
    for (const 配 of [[], ["有效沟通", "线索验证结果"]] as 必填项[][]) {
      expect(有效沟通还差(空数据(配))).toEqual(["需求"]);
      const 话 = 线索验证依据({ 线索验证必填: 配, 初判即终判: false }).有效;
      expect(话).toContain("「需求状态」要先选上");
      expect(话).toContain("「—」不算");
    }
  });

  it("判无效三种走法：销售建的初判即终判；交市场复核；交总管理终判。界面不露岗位名", () => {
    const 终 = 线索验证依据({ 线索验证必填: [], 初判即终判: true, 无效交给: "市场复核" }).无效;
    expect(终).toContain("负责人判无效就是最终结果");
    expect(终).toContain("线索流失");
    const 复核 = 线索验证依据({ 线索验证必填: [], 初判即终判: false, 无效交给: "市场复核" }).无效;
    expect(复核).toContain("交管理员复核");
    expect(复核).toContain("复核也判无效才算无效线索");
    const 总 = 线索验证依据({ 线索验证必填: [], 初判即终判: false, 无效交给: "总管理终判" }).无效;
    expect(总).toContain("交管理员最终确认");
    for (const 话 of [终, 复核, 总]) {
      expect(话).toContain("无效原因");
      expect(话).not.toMatch(/经理|市场管理|总管理|销售管理/);
    }
  });

  it("复购一行：老客户新建项目从线索阶段起，要过这一步（M-线索-01）", () => {
    const 话 = 线索验证依据({ 线索验证必填: [], 初判即终判: false }).复购;
    expect(话).toContain("「项目操作 ▾」→「新建项目」");
    expect(话).toContain("同样要过这一步");
  });
});
