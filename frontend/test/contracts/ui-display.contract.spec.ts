import { expect, test } from "@playwright/test";
import {
  getAccountStatusLabel,
  getAiFailureReasonLabel,
  getAiStatusLabel,
  getClassroomStatusLabel,
  getClassroomTaskStatusLabel,
  getCourseStatusLabel,
  getEnrollmentStatusLabel,
  getTaskTemplateStatusLabel,
} from "../../lib/ui/status";
import {
  FEEDBACK_SEVERITIES,
  FEEDBACK_TYPES,
  getFeedbackSeverityLabel,
  getFeedbackSourceLabel,
  getFeedbackTypeLabel,
} from "../../lib/ui/feedback-options";
import {
  FEEDBACK_TAG_OPTIONS,
  getFeedbackTagLabel,
} from "../../lib/ui/feedback-tags";
import {
  buildErrorDescription,
  extractRawDetail,
} from "../../lib/api/error-presenter";
import {
  getSubmissionRevisionError,
  getTextSubmissionError,
} from "../../lib/learning-tasks/text-submission";

test("status labels use each domain's meaning and distinguish missing from unknown values", () => {
  const cases = [
    [
      getTaskTemplateStatusLabel,
      [
        ["DRAFT", "草稿"],
        ["PUBLISHED", "已发布"],
        ["ARCHIVED", "已归档"],
      ],
    ],
    [
      getClassroomTaskStatusLabel,
      [
        ["ACTIVE", "开放中"],
        ["CLOSED", "已关闭"],
        ["RECALLED", "已撤回"],
      ],
    ],
    [
      getEnrollmentStatusLabel,
      [
        ["ACTIVE", "在班"],
        ["REMOVED", "已移除"],
      ],
    ],
    [
      getAccountStatusLabel,
      [
        ["active", "正常"],
        ["suspended", "已停用"],
      ],
    ],
    [
      getCourseStatusLabel,
      [
        ["ACTIVE", "进行中"],
        ["ARCHIVED", "已归档"],
      ],
    ],
    [
      getClassroomStatusLabel,
      [
        ["ACTIVE", "进行中"],
        ["ARCHIVED", "已归档"],
      ],
    ],
    [
      getAiStatusLabel,
      [
        ["NOT_REQUESTED", "未申请"],
        ["PENDING", "排队中"],
        ["RUNNING", "处理中"],
        ["SUCCEEDED", "处理完成"],
        ["FAILED", "本次处理失败"],
        ["DEAD", "已终止"],
      ],
    ],
  ] as const;
  for (const [format, pairs] of cases) {
    for (const [value, expected] of pairs) expect(format(value)).toBe(expected);
    for (const missing of [undefined, null, "", " \t\n "]) {
      expect(format(missing)).toBe("—");
    }
    for (const invalid of [0, false, {}, [], "UNRECOGNIZED", "__proto__"]) {
      expect(format(invalid)).toBe("未知状态");
    }
  }
  expect(getAccountStatusLabel("ACTIVE")).toBe("未知状态");
  expect(getAccountStatusLabel("SUSPENDED")).toBe("未知状态");
  expect(getEnrollmentStatusLabel("CLOSED")).toBe("未知状态");
  expect(getClassroomTaskStatusLabel("ARCHIVED")).toBe("未知状态");
  expect(getTaskTemplateStatusLabel("ACTIVE")).toBe("未知状态");
  expect(getAiStatusLabel(" pending ")).toBe("排队中");
});

test("feedback labels preserve the existing values and ordering without inferring a positive INFO result", () => {
  expect(FEEDBACK_TYPES).toEqual([
    "SYNTAX",
    "STYLE",
    "DESIGN",
    "BUG",
    "PERFORMANCE",
    "SECURITY",
    "OTHER",
  ]);
  expect(FEEDBACK_SEVERITIES).toEqual(["INFO", "WARN", "ERROR"]);
  expect(FEEDBACK_TYPES.map(getFeedbackTypeLabel)).toEqual([
    "SYNTAX - 语法",
    "STYLE - 代码规范",
    "DESIGN - 设计",
    "BUG - 缺陷",
    "PERFORMANCE - 性能",
    "SECURITY - 安全",
    "OTHER - 其他",
  ]);
  expect(FEEDBACK_SEVERITIES.map(getFeedbackSeverityLabel)).toEqual([
    "INFO - 提示",
    "WARN - 警告",
    "ERROR - 错误",
  ]);
  for (const missing of [undefined, null, "", " \n "]) {
    expect(getFeedbackTypeLabel(missing)).toBe("—");
    expect(getFeedbackSeverityLabel(missing)).toBe("—");
  }
  for (const invalid of [false, 0, {}, [], "UNRECOGNIZED", "__proto__"]) {
    expect(getFeedbackTypeLabel(invalid)).toBe("未知类型");
    expect(getFeedbackSeverityLabel(invalid)).toBe("未知程度");
  }
  expect(getFeedbackSourceLabel("TEACHER")).toBe("教师反馈");
  expect(getFeedbackSourceLabel("AI")).toBe("AI 辅助反馈");
  for (const unknown of [
    undefined,
    null,
    "",
    "teacher",
    "UNRECOGNIZED",
    {},
    1,
  ]) {
    expect(getFeedbackSourceLabel(unknown)).toBe("其他反馈（来源未识别）");
  }
});

test("all preset tags retain their original value order and use readable labels", () => {
  const expectedOptions = [
    ["readability", "readability - 可读性"],
    ["naming", "naming - 命名"],
    ["style", "style - 代码风格"],
    ["formatting", "formatting - 代码格式"],
    ["complexity", "complexity - 复杂度"],
    ["duplication", "duplication - 重复代码"],
    ["edge-cases", "edge-cases - 边界情况"],
    ["null-safety", "null-safety - 空值安全"],
    ["exception-safety", "exception-safety - 异常安全"],
    ["performance", "performance - 性能"],
    ["memory", "memory - 内存使用"],
    ["security", "security - 安全"],
    ["correctness", "correctness - 正确性"],
    ["bug-risk", "bug-risk - 缺陷风险"],
    ["maintainability", "maintainability - 可维护性"],
    ["testability", "testability - 可测试性"],
    ["api-design", "api-design - 接口设计"],
    ["abstraction", "abstraction - 抽象设计"],
    ["encapsulation", "encapsulation - 封装"],
    ["coupling", "coupling - 耦合度"],
    ["cohesion", "cohesion - 内聚性"],
    ["concurrency", "concurrency - 并发"],
    ["io", "io - 输入输出"],
    ["algorithm", "algorithm - 算法"],
    ["data-structure", "data-structure - 数据结构"],
    ["documentation", "documentation - 文档"],
    ["logging", "logging - 日志"],
    ["error-handling", "error-handling - 错误处理"],
    ["validation", "validation - 校验"],
    ["input-sanitization", "input-sanitization - 输入清理"],
    ["resource-management", "resource-management - 资源管理"],
    ["time-complexity", "time-complexity - 时间复杂度"],
    ["space-complexity", "space-complexity - 空间复杂度"],
    ["readability-comments", "readability-comments - 注释可读性"],
    ["modularity", "modularity - 模块化"],
    ["dead-code", "dead-code - 无效代码"],
    ["unused", "unused - 未使用内容"],
    ["other", "other - 其他"],
  ] as const;
  expect(
    FEEDBACK_TAG_OPTIONS.map(({ value, label }) => [value, label]),
  ).toEqual(expectedOptions);
  for (const [value, expected] of expectedOptions) {
    expect(getFeedbackTagLabel(value)).toBe(expected);
  }
  expect(getFeedbackTagLabel("style")).toBe("style - 代码风格");
  expect(getFeedbackTypeLabel("STYLE")).toBe("STYLE - 代码规范");
  expect(getFeedbackTagLabel("STYLE")).toBe("STYLE");
  expect(getFeedbackTypeLabel("style")).toBe("未知类型");
  const input = Object.freeze(["readability", "自定义主题", " CuStOm-Tag "]);
  const before = [...input];
  expect(input.map(getFeedbackTagLabel)).toEqual([
    "readability - 可读性",
    "自定义主题",
    " CuStOm-Tag ",
  ]);
  expect(input).toEqual(before);
  for (const missing of [undefined, null, "", " \n ", 0, false, {}, []]) {
    expect(getFeedbackTagLabel(missing)).toBe("—");
  }
});

test("AI error distribution labels explain known reasons while hiding unknown internal codes", () => {
  for (const [value, expected] of [
    ["INPUT_BUDGET_EXCEEDED", "评阅材料超出处理范围"],
    ["OUTPUT_LIMIT_REACHED", "反馈内容超出长度限制"],
    ["UNAUTHORIZED", "AI 服务授权失败"],
    ["RATE_LIMIT_UPSTREAM", "AI 服务请求过于频繁"],
    ["RATE_LIMIT_LOCAL", "本次请求受到频率限制"],
    ["UPSTREAM_4XX", "AI 服务无法处理本次请求"],
    ["UPSTREAM_5XX", "AI 服务暂时不可用"],
    ["TIMEOUT", "AI 处理超时"],
    ["BAD_RESPONSE", "AI 返回内容暂不可用"],
    ["MISSING_API_KEY", "AI 服务尚未配置完成"],
  ]) {
    expect(getAiFailureReasonLabel(value)).toBe(expected);
  }
  for (const missing of [undefined, null, "", " \n "]) {
    expect(getAiFailureReasonLabel(missing)).toBe("—");
  }
  for (const unknown of ["PRIVATE_INTERNAL_CODE", "__proto__", {}, 1]) {
    expect(getAiFailureReasonLabel(unknown)).toBe("其他处理失败原因");
  }
});

test("internal error details remain extractable but cannot be appended to the business summary", () => {
  const summary = "保存失败，草稿已保留，请核对当前状态。";
  for (const source of [
    "private synthetic stack",
    { message: "private synthetic stack", code: "PRIVATE_INTERNAL_CODE" },
    {
      data: {
        message: "private synthetic stack",
        code: "PRIVATE_INTERNAL_CODE",
      },
    },
    { data: { code: "PRIVATE_INTERNAL_CODE" } },
  ]) {
    const detail = extractRawDetail(source);
    expect(detail).toBeTruthy();
    expect(buildErrorDescription(summary, detail)).toBe(summary);
  }
  for (const reason of [
    "Invalid tag(s), please select from predefined tags",
    "Archived classrooms cannot be updated",
    "Published task templates used by classrooms cannot be changed back to draft",
  ]) {
    const detail = extractRawDetail({
      data: { message: reason, code: "INTERNAL_CODE" },
    });
    expect(detail).toBe(`${reason} (code: INTERNAL_CODE)`);
    expect(detail?.includes(reason)).toBe(true);
    expect(buildErrorDescription(summary, detail)).toBe(summary);
  }
  for (const generated of [
    "标签无效，请重新选择。",
    "班级已归档，不允许编辑班级基础信息。",
    "该模板已发布到班级，不能改回草稿。",
    "课程中仍有班级，暂不能删除。",
    "无权限执行该操作。",
    "保存结果待核对，草稿已保留。",
  ]) {
    expect(buildErrorDescription(generated, "PRIVATE_INTERNAL_CODE")).toBe(
      generated,
    );
  }
  expect(buildErrorDescription(summary)).toBe(summary);
});

test("public revision, submission and cooldown messages survive the final presentation layer", () => {
  for (const [message, expected] of [
    [
      "作品内容已变化，请查看最新提交并核对草稿后明确继续。",
      "作品内容已变化，当前操作依据的是旧版作品。草稿已保留，请刷新查看并明确确认后继续。",
    ],
    [
      "本次提交已进入评阅，不能再修改作品；草稿仍保留，请核对提交详情。",
      "本次提交已进入评阅，不能再修改作品。草稿已保留，请核对当前作品与反馈。",
    ],
    [
      "提交的版本或评阅状态无效，当前操作已停止，请联系教师核对。",
      "提交状态暂不可用。草稿已保留，请核对详情或联系教师。",
    ],
  ]) {
    const body = { statusCode: 409, message };
    expect(
      buildErrorDescription(
        getSubmissionRevisionError(body),
        extractRawDetail(body),
      ),
    ).toBe(expected);
  }
  for (const [status, message, expected] of [
    [
      409,
      "班级已归档，不能继续提交该任务。",
      "班级已归档，不能继续提交该任务。",
    ],
    [409, "课堂任务已关闭，不能继续提交。", "课堂任务已关闭，不能继续提交。"],
    [
      409,
      "该课堂任务未保存发布内容，请教师重新布置后继续。",
      "该课堂任务未保存发布内容，请教师重新布置后继续。",
    ],
    [
      403,
      "Late submission is not allowed for this classroom task",
      "已截止，禁止迟交，请联系老师。",
    ],
    [
      429,
      "提交过于频繁。当前设置的提交冷却时间为 17 秒，请约 3 秒后再试。",
      "提交过于频繁。当前设置的提交冷却时间为 17 秒，请约 3 秒后再试。",
    ],
  ] as const) {
    const body = { statusCode: status, message };
    expect(
      buildErrorDescription(
        getTextSubmissionError(status, body),
        extractRawDetail(body),
      ),
    ).toBe(expected);
  }
  const unknown = { statusCode: 409, message: "private stack" };
  expect(
    buildErrorDescription(
      getSubmissionRevisionError(unknown),
      extractRawDetail(unknown),
    ),
  ).toBe("提交状态已变化。草稿已保留，请先核对最新详情。");
});
