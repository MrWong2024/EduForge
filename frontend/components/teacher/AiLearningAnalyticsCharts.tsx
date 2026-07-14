import type {
  AiLearningAnalyticsTaskPoint,
  AiLearningAnalyticsTaskTrend,
} from "@/lib/api/types-teacher";
import {
  AI_LEARNING_ANALYTICS_DETAILED_OUTCOME_LABELS,
  formatAiLearningAnalyticsDelta,
  formatAiLearningAnalyticsIssueLoad,
  formatAiLearningAnalyticsPercent,
} from "@/lib/ai-learning-analytics";
import { toDisplayDate } from "@/lib/ui/format";

const CHART_WIDTH = 1040;
const TASK_LABEL_X = 8;
const TASK_LABEL_MAX_CHARACTERS = 22;
const PLOT_LEFT = 285;
const PLOT_RIGHT = 750;
const DETAIL_X = 780;
const ROW_START = 42;
const MIN_ROW_HEIGHT = 68;
const AXIS_FOOTER_HEIGHT = 48;

type TaskNamedRow = {
  key: string;
  taskTitle: string;
  publishedAt: string | null;
};

type RowLayout<T extends TaskNamedRow> = {
  row: T;
  top: number;
  height: number;
  centerY: number;
  titleLines: string[];
};

const wrapTaskTitle = (title: string): string[] => {
  const characters = Array.from(title.trim() || "未知任务");
  const lines: string[] = [];
  for (
    let index = 0;
    index < characters.length;
    index += TASK_LABEL_MAX_CHARACTERS
  ) {
    lines.push(
      characters.slice(index, index + TASK_LABEL_MAX_CHARACTERS).join(""),
    );
  }
  return lines.length > 0 ? lines : ["未知任务"];
};

function buildRowLayouts<T extends TaskNamedRow>(
  rows: T[],
): {
  layouts: RowLayout<T>[];
  height: number;
} {
  let currentTop = ROW_START;
  const layouts = rows.map((row) => {
    const titleLines = wrapTaskTitle(row.taskTitle);
    const height = Math.max(
      MIN_ROW_HEIGHT,
      28 + titleLines.length * 16,
    );
    const layout = {
      row,
      top: currentTop,
      height,
      centerY: currentTop + height / 2,
      titleLines,
    };
    currentTop += height;
    return layout;
  });
  return {
    layouts,
    height: currentTop + AXIS_FOOTER_HEIGHT,
  };
}

function SvgTaskTitle({
  lines,
  centerY,
}: {
  lines: string[];
  centerY: number;
}) {
  const firstLineY = centerY - ((lines.length - 1) * 16) / 2 + 4;
  return (
    <text x={TASK_LABEL_X} y={firstLineY} fontSize="11" fill="#27272a">
      {lines.map((line, index) => (
        <tspan
          key={line + "-" + index}
          x={TASK_LABEL_X}
          dy={index === 0 ? 0 : 16}
        >
          {line}
        </tspan>
      ))}
    </text>
  );
}

type BeforeAfterRow = TaskNamedRow & {
  before: number | null;
  after: number | null;
  delta: number | null;
  detailLabel: string;
  accessibleText: string;
};

function BeforeAfterLegend() {
  return (
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-zinc-700">
      <span className="inline-flex items-center gap-2">
        <svg width="20" height="16" aria-hidden="true">
          <circle
            cx="10"
            cy="8"
            r="5"
            fill="#ffffff"
            stroke="#2563eb"
            strokeWidth="2.5"
          />
        </svg>
        AI 反馈前（空心圆）
      </span>
      <span className="inline-flex items-center gap-2">
        <svg width="20" height="16" aria-hidden="true">
          <polygon
            points="10,2 16,8 10,14 4,8"
            fill="#f97316"
            stroke="#9a3412"
            strokeWidth="1.5"
          />
        </svg>
        AI 反馈后（实心菱形）
      </span>
    </div>
  );
}

function BeforeAfterComparisonChart({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: BeforeAfterRow[];
}) {
  if (rows.length === 0) {
    return (
      <figure className="rounded-lg border border-zinc-200 bg-white p-4">
        <figcaption>
          <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p>
        </figcaption>
        <p className="mt-3 rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-5 text-sm text-zinc-600">
          暂无课堂任务可展示。
        </p>
      </figure>
    );
  }

  const { layouts, height } = buildRowLayouts(rows);
  const comparableValues = rows.flatMap((row) =>
    row.before === null || row.after === null ? [] : [row.before, row.after],
  );
  const maximum = Math.max(1, ...comparableValues);
  const plotWidth = PLOT_RIGHT - PLOT_LEFT;
  const toX = (value: number) => PLOT_LEFT + (value / maximum) * plotWidth;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const plotBottom =
    layouts[layouts.length - 1].top + layouts[layouts.length - 1].height;

  return (
    <figure className="rounded-lg border border-zinc-200 bg-white p-4">
      <figcaption>
        <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p>
      </figcaption>
      <BeforeAfterLegend />
      <div className="mt-2 overflow-x-auto" tabIndex={0}>
        <svg
          role="img"
          aria-label={title + "。" + description}
          viewBox={"0 0 " + CHART_WIDTH + " " + height}
          width={CHART_WIDTH}
          height={height}
          className="block max-w-none"
        >
          <title>{title}</title>

          {ticks.map((tick) => {
            const x = PLOT_LEFT + tick * plotWidth;
            return (
              <g key={tick}>
                <text
                  x={x}
                  y={plotBottom + 18}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#52525b"
                >
                  {formatAiLearningAnalyticsIssueLoad(maximum * tick)}
                </text>
              </g>
            );
          })}

          {layouts.map(({ row, top, height: rowHeight, centerY, titleLines }, index) => {
            const hasComparable =
              row.before !== null && row.after !== null && row.delta !== null;
            const beforeX = hasComparable ? toX(row.before as number) : 0;
            const afterX = hasComparable ? toX(row.after as number) : 0;
            const pointsOverlap =
              hasComparable && Math.abs(beforeX - afterX) < 0.5;
            const beforeY = centerY + (pointsOverlap ? 7 : 0);
            const afterY = centerY - (pointsOverlap ? 7 : 0);
            return (
              <g key={row.key}>
                <title>{row.accessibleText}</title>
                <rect
                  x="0"
                  y={top}
                  width={CHART_WIDTH}
                  height={rowHeight}
                  fill={index % 2 === 0 ? "#fafafa" : "#ffffff"}
                />
                {ticks.map((tick) => {
                  const x = PLOT_LEFT + tick * plotWidth;
                  return (
                    <line
                      key={tick}
                      x1={x}
                      x2={x}
                      y1={top}
                      y2={top + rowHeight}
                      stroke={tick === 0 ? "#a1a1aa" : "#e4e4e7"}
                      strokeWidth={tick === 0 ? "1.5" : "1"}
                    />
                  );
                })}
                <line
                  x1="0"
                  x2={CHART_WIDTH}
                  y1={top}
                  y2={top}
                  stroke="#e4e4e7"
                />
                <SvgTaskTitle lines={titleLines} centerY={centerY} />
                <line
                  x1={PLOT_LEFT}
                  x2={PLOT_RIGHT}
                  y1={centerY}
                  y2={centerY}
                  stroke="#d4d4d8"
                />
                {hasComparable ? (
                  <>
                    <line
                      x1={beforeX}
                      x2={afterX}
                      y1={beforeY}
                      y2={afterY}
                      stroke="#71717a"
                      strokeWidth="3"
                    />
                    <circle
                      cx={beforeX}
                      cy={beforeY}
                      r="6"
                      fill="#ffffff"
                      stroke="#2563eb"
                      strokeWidth="3"
                    />
                    <polygon
                      points={
                        afterX +
                        "," +
                        (afterY - 7) +
                        " " +
                        (afterX + 7) +
                        "," +
                        afterY +
                        " " +
                        afterX +
                        "," +
                        (afterY + 7) +
                        " " +
                        (afterX - 7) +
                        "," +
                        afterY
                      }
                      fill="#f97316"
                      stroke="#9a3412"
                      strokeWidth="1.5"
                    />
                    <text
                      x={DETAIL_X}
                      y={centerY - 7}
                      fontSize="11"
                      fill="#27272a"
                    >
                      前{" "}
                      {formatAiLearningAnalyticsIssueLoad(row.before as number)}
                      {" "}→ 后{" "}
                      {formatAiLearningAnalyticsIssueLoad(row.after as number)}
                    </text>
                    <text
                      x={DETAIL_X}
                      y={centerY + 12}
                      fontSize="10"
                      fill="#52525b"
                    >
                      差值{" "}
                      {formatAiLearningAnalyticsDelta(row.delta as number)}
                      {" · "}
                      {row.detailLabel}
                    </text>
                  </>
                ) : (
                  <>
                    <text
                      x={PLOT_LEFT + 10}
                      y={centerY + 4}
                      fontSize="11"
                      fill="#71717a"
                    >
                      暂无可比样本
                    </text>
                    <text
                      x={DETAIL_X}
                      y={centerY + 4}
                      fontSize="10"
                      fill="#71717a"
                    >
                      {row.detailLabel}
                    </text>
                  </>
                )}
              </g>
            );
          })}

          <line
            x1={PLOT_LEFT}
            x2={PLOT_RIGHT}
            y1={plotBottom}
            y2={plotBottom}
            stroke="#71717a"
            strokeWidth="1.5"
          />
          <text
            x={(PLOT_LEFT + PLOT_RIGHT) / 2}
            y={height - 8}
            textAnchor="middle"
            fontSize="11"
            fill="#52525b"
          >
            平均问题负荷（横轴从 0 开始，数值越低越好）
          </text>
        </svg>
      </div>
      <ul className="sr-only">
        {rows.map((row) => (
          <li key={"accessible-" + row.key}>{row.accessibleText}</li>
        ))}
      </ul>
    </figure>
  );
}

export function AiLearningAnalyticsTaskIssueLoadComparisonChart({
  taskTrends,
}: {
  taskTrends: AiLearningAnalyticsTaskTrend[];
}) {
  const rows: BeforeAfterRow[] = taskTrends.map((task, index) => {
    const hasComparable = task.qualityComparableStudentCount > 0;
    const before = hasComparable ? task.averageIssueLoadBefore : null;
    const after = hasComparable ? task.averageIssueLoadAfter : null;
    const delta = hasComparable ? task.averageIssueLoadDelta : null;
    const accessibleText = [
      "任务：" + task.taskTitle,
      "发布时间：" + toDisplayDate(task.publishedAt),
      "AI 反馈前平均问题负荷：" +
        (before === null
          ? "—"
          : formatAiLearningAnalyticsIssueLoad(before)),
      "AI 反馈后平均问题负荷：" +
        (after === null ? "—" : formatAiLearningAnalyticsIssueLoad(after)),
      "平均差值：" +
        (delta === null ? "—" : formatAiLearningAnalyticsDelta(delta)),
      "质量可比样本数：" + task.qualityComparableStudentCount,
    ].join("；");
    return {
      key: task.classroomTaskId || "class-task-" + index,
      taskTitle: task.taskTitle,
      publishedAt: task.publishedAt,
      before,
      after,
      delta,
      detailLabel:
        task.qualityComparableStudentCount > 0
          ? "可比样本 " + task.qualityComparableStudentCount
          : "暂无可比样本",
      accessibleText,
    };
  });

  return (
    <BeforeAfterComparisonChart
      title="各任务 AI 反馈前后问题对比"
      description="每行对比一个课堂任务中质量可比样本的平均问题负荷。数值越低，表示该版本检测到的 ERROR/WARN 问题负荷越低；不同任务难度未校正，不应把任务间差异直接理解为连续成长趋势。"
      rows={rows}
    />
  );
}

export function AiLearningAnalyticsStudentIssueLoadComparisonChart({
  taskPoints,
}: {
  taskPoints: AiLearningAnalyticsTaskPoint[];
}) {
  const rows: BeforeAfterRow[] = taskPoints.map((task, index) => {
    const hasComparable =
      task.qualityComparable &&
      task.issueLoadBefore !== null &&
      task.issueLoadAfter !== null &&
      task.issueLoadDelta !== null;
    const before = hasComparable ? task.issueLoadBefore : null;
    const after = hasComparable ? task.issueLoadAfter : null;
    const delta = hasComparable ? task.issueLoadDelta : null;
    const outcomeLabel =
      AI_LEARNING_ANALYTICS_DETAILED_OUTCOME_LABELS[task.detailedOutcome];
    const accessibleText = [
      "任务：" + task.taskTitle,
      "发布时间：" + toDisplayDate(task.publishedAt),
      "AI 反馈前问题负荷：" +
        (before === null
          ? "—"
          : formatAiLearningAnalyticsIssueLoad(before)),
      "AI 反馈后问题负荷：" +
        (after === null ? "—" : formatAiLearningAnalyticsIssueLoad(after)),
      "差值：" +
        (delta === null ? "—" : formatAiLearningAnalyticsDelta(delta)),
      "结果：" + outcomeLabel,
    ].join("；");
    return {
      key: task.classroomTaskId || "student-task-" + index,
      taskTitle: task.taskTitle,
      publishedAt: task.publishedAt,
      before,
      after,
      delta,
      detailLabel: "结果 " + outcomeLabel,
      accessibleText,
    };
  });

  return (
    <BeforeAfterComparisonChart
      title="个人各任务 AI 反馈前后问题对比"
      description="该图比较同一课堂任务内 AI 反馈前后的问题负荷，不代表不同任务之间的成绩或能力成长曲线。"
      rows={rows}
    />
  );
}

type OutcomeDistributionRow = TaskNamedRow & {
  improved: number;
  remainedClean: number;
  unchangedWithIssues: number;
  regressed: number;
  improvedRate: number;
  remainedCleanRate: number;
  unchangedWithIssuesRate: number;
  regressedRate: number;
  total: number;
  accessibleText: string;
};

type OutcomeSegment = {
  key:
    | "improved"
    | "remainedClean"
    | "unchangedWithIssues"
    | "regressed";
  label: string;
  count: number;
  rate: number;
  fill: string;
  stroke: string;
};

function OutcomeLegend() {
  return (
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-zinc-700">
      <span className="inline-flex items-center gap-2">
        <span className="inline-flex h-4 w-5 items-center justify-center border border-emerald-700 bg-emerald-100 text-[9px] text-emerald-900">
          ↓
        </span>
        改善
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="inline-flex h-4 w-5 items-center justify-center border border-sky-700 bg-sky-50 text-[9px] text-sky-900">
          ○
        </span>
        前后均无 ERROR/WARN
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="inline-flex h-4 w-5 items-center justify-center border border-amber-700 bg-amber-100 text-[9px] text-amber-900">
          ＝
        </span>
        问题负荷未减少
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="inline-flex h-4 w-5 items-center justify-center border border-red-700 bg-red-100 text-[9px] text-red-900">
          ↑
        </span>
        恶化
      </span>
    </div>
  );
}

export function AiLearningAnalyticsComparableOutcomeChart({
  taskTrends,
}: {
  taskTrends: AiLearningAnalyticsTaskTrend[];
}) {
  const rows: OutcomeDistributionRow[] = taskTrends.map((task, index) => {
    const total = task.qualityComparableStudentCount;
    const toSegmentText = (label: string, count: number, rate: number) =>
      label +
      "：" +
      count +
      "，占该任务质量可比样本 " +
      (total > 0 ? formatAiLearningAnalyticsPercent(rate) : "无对应分母");
    return {
      key: task.classroomTaskId || "outcome-task-" + index,
      taskTitle: task.taskTitle,
      publishedAt: task.publishedAt,
      improved: task.improvedStudentCount,
      remainedClean: task.remainedCleanStudentCount,
      unchangedWithIssues: task.unchangedWithIssuesStudentCount,
      regressed: task.regressedStudentCount,
      improvedRate: task.improvedRate,
      remainedCleanRate: task.remainedCleanRate,
      unchangedWithIssuesRate: task.unchangedWithIssuesRate,
      regressedRate: task.regressedRate,
      total,
      accessibleText: [
        "任务：" + task.taskTitle,
        "发布时间：" + toDisplayDate(task.publishedAt),
        "质量可比样本总数：" + total,
        toSegmentText("改善", task.improvedStudentCount, task.improvedRate),
        toSegmentText(
          "前后均无 ERROR/WARN",
          task.remainedCleanStudentCount,
          task.remainedCleanRate,
        ),
        toSegmentText(
          "问题负荷未减少",
          task.unchangedWithIssuesStudentCount,
          task.unchangedWithIssuesRate,
        ),
        toSegmentText("恶化", task.regressedStudentCount, task.regressedRate),
      ].join("；"),
    };
  });

  if (rows.length === 0) {
    return (
      <figure className="rounded-lg border border-zinc-200 bg-white p-4">
        <figcaption>
          <h3 className="text-sm font-semibold text-zinc-900">
            各任务可比样本结果分布
          </h3>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            每条横向堆叠条以该任务的质量可比样本数为分母，展示四类 V1.1 精细结果。
          </p>
        </figcaption>
        <p className="mt-3 rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-5 text-sm text-zinc-600">
          暂无课堂任务可展示。
        </p>
      </figure>
    );
  }

  const { layouts, height } = buildRowLayouts(rows);
  const barWidth = PLOT_RIGHT - PLOT_LEFT;
  const plotBottom =
    layouts[layouts.length - 1].top + layouts[layouts.length - 1].height;

  return (
    <figure className="rounded-lg border border-zinc-200 bg-white p-4">
      <figcaption>
        <h3 className="text-sm font-semibold text-zinc-900">
          各任务可比样本结果分布
        </h3>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          每条横向堆叠条以该任务的质量可比样本数为分母，展示四类 V1.1 精细结果。
        </p>
      </figcaption>
      <OutcomeLegend />
      <div className="mt-2 overflow-x-auto" tabIndex={0}>
        <svg
          role="img"
          aria-label="各任务可比样本结果分布。每条横向堆叠条以该任务的质量可比样本数为分母，区分改善、前后均无 ERROR/WARN、问题负荷未减少和恶化。"
          viewBox={"0 0 " + CHART_WIDTH + " " + height}
          width={CHART_WIDTH}
          height={height}
          className="block max-w-none"
        >
          <title>各任务可比样本结果分布</title>
          <defs>
            <pattern
              id="ai-analytics-remained-clean-pattern"
              width="7"
              height="7"
              patternUnits="userSpaceOnUse"
            >
              <rect width="7" height="7" fill="#f0f9ff" />
              <circle cx="3.5" cy="3.5" r="1.2" fill="#0369a1" />
            </pattern>
            <pattern
              id="ai-analytics-unchanged-with-issues-pattern"
              width="7"
              height="7"
              patternUnits="userSpaceOnUse"
            >
              <rect width="7" height="7" fill="#fef3c7" />
              <path d="M-1,7 L7,-1 M3,9 L9,3" stroke="#b45309" strokeWidth="1" />
            </pattern>
            <pattern
              id="ai-analytics-regressed-pattern"
              width="8"
              height="8"
              patternUnits="userSpaceOnUse"
            >
              <rect width="8" height="8" fill="#fee2e2" />
              <path d="M0,0 L8,8 M8,0 L0,8" stroke="#b91c1c" strokeWidth="0.8" />
            </pattern>
          </defs>

          {layouts.map(({ row, top, height: rowHeight, centerY, titleLines }, index) => {
            const segments: OutcomeSegment[] = [
              {
                key: "improved",
                label: "改善",
                count: row.improved,
                rate: row.improvedRate,
                fill: "#dcfce7",
                stroke: "#15803d",
              },
              {
                key: "remainedClean",
                label: "前后均无 ERROR/WARN",
                count: row.remainedClean,
                rate: row.remainedCleanRate,
                fill: "url(#ai-analytics-remained-clean-pattern)",
                stroke: "#0369a1",
              },
              {
                key: "unchangedWithIssues",
                label: "问题负荷未减少",
                count: row.unchangedWithIssues,
                rate: row.unchangedWithIssuesRate,
                fill: "url(#ai-analytics-unchanged-with-issues-pattern)",
                stroke: "#b45309",
              },
              {
                key: "regressed",
                label: "恶化",
                count: row.regressed,
                rate: row.regressedRate,
                fill: "url(#ai-analytics-regressed-pattern)",
                stroke: "#b91c1c",
              },
            ];
            let currentX = PLOT_LEFT;
            return (
              <g key={row.key}>
                <title>{row.accessibleText}</title>
                <rect
                  x="0"
                  y={top}
                  width={CHART_WIDTH}
                  height={rowHeight}
                  fill={index % 2 === 0 ? "#fafafa" : "#ffffff"}
                />
                <line
                  x1="0"
                  x2={CHART_WIDTH}
                  y1={top}
                  y2={top}
                  stroke="#e4e4e7"
                />
                <SvgTaskTitle lines={titleLines} centerY={centerY} />
                {row.total > 0 ? (
                  <>
                    <rect
                      x={PLOT_LEFT}
                      y={centerY - 13}
                      width={barWidth}
                      height="26"
                      fill="#ffffff"
                      stroke="#a1a1aa"
                    />
                    {segments.map((segment) => {
                      const ratio = segment.count / row.total;
                      const width = ratio * barWidth;
                      const x = currentX;
                      currentX += width;
                      if (segment.count === 0) {
                        return null;
                      }
                      const tooltip =
                        row.taskTitle +
                        "；" +
                        segment.label +
                        "：" +
                        segment.count +
                        "；占质量可比样本：" +
                        formatAiLearningAnalyticsPercent(segment.rate);
                      return (
                        <g key={segment.key}>
                          <title>{tooltip}</title>
                          <rect
                            x={x}
                            y={centerY - 13}
                            width={width}
                            height="26"
                            fill={segment.fill}
                            stroke={segment.stroke}
                            strokeWidth="1.5"
                          />
                          {width >= 34 ? (
                            <text
                              x={x + width / 2}
                              y={centerY + 4}
                              textAnchor="middle"
                              fontSize="10"
                              fontWeight="600"
                              fill="#27272a"
                            >
                              {segment.count}
                            </text>
                          ) : null}
                        </g>
                      );
                    })}
                    <text x={DETAIL_X} y={centerY - 15} fontSize="10" fill="#52525b">
                      可比总数 {row.total}
                    </text>
                    <text x={DETAIL_X} y={centerY + 1} fontSize="10" fill="#166534">
                      改善 {row.improved}
                    </text>
                    <text x={DETAIL_X + 70} y={centerY + 1} fontSize="10" fill="#075985">
                      均无 ERROR/WARN {row.remainedClean}
                    </text>
                    <text x={DETAIL_X} y={centerY + 17} fontSize="10" fill="#92400e">
                      问题负荷未减少 {row.unchangedWithIssues}
                    </text>
                    <text x={DETAIL_X + 125} y={centerY + 17} fontSize="10" fill="#991b1b">
                      恶化 {row.regressed}
                    </text>
                  </>
                ) : (
                  <text
                    x={PLOT_LEFT + 10}
                    y={centerY + 4}
                    fontSize="11"
                    fill="#71717a"
                  >
                    暂无可比样本
                  </text>
                )}
              </g>
            );
          })}
          <line
            x1={PLOT_LEFT}
            x2={PLOT_RIGHT}
            y1={plotBottom}
            y2={plotBottom}
            stroke="#71717a"
          />
          <text
            x={(PLOT_LEFT + PLOT_RIGHT) / 2}
            y={height - 8}
            textAnchor="middle"
            fontSize="11"
            fill="#52525b"
          >
            该任务质量可比样本占比（0%–100%）
          </text>
        </svg>
      </div>
      <p className="mt-3 text-xs leading-5 text-zinc-600">
        V1.1 已将旧版“持平”拆分为“前后均无 ERROR/WARN”和“问题负荷未减少”。前者只表示两次 AI 分析均未检测到 ERROR/WARN，不代表代码不存在其他问题。
      </p>
      <ul className="sr-only">
        {rows.map((row) => (
          <li key={"accessible-" + row.key}>{row.accessibleText}</li>
        ))}
      </ul>
    </figure>
  );
}
