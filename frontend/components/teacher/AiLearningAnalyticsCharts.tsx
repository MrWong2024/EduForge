import type {
  AiLearningAnalyticsTaskPoint,
  AiLearningAnalyticsTaskTrend,
} from "@/lib/api/types-teacher";
import {
  AI_LEARNING_ANALYTICS_OUTCOME_LABELS,
  formatAiLearningAnalyticsDelta,
  formatAiLearningAnalyticsIssueLoad,
  formatAiLearningAnalyticsPercent,
} from "@/lib/ai-learning-analytics";
import { toDisplayDate } from "@/lib/ui/format";

const CHART_HEIGHT = 320;
const PLOT_TOP = 38;
const PLOT_BOTTOM = 235;
const PLOT_LEFT = 64;
const PLOT_RIGHT = 34;
const TASK_STEP = 128;

type DeltaChartPoint = {
  key: string;
  taskTitle: string;
  publishedAt: string | null;
  value: number | null;
  tooltip: string;
  accessibleText: string;
};

type PositionedPoint = {
  x: number;
  y: number;
};

const getChartWidth = (pointCount: number): number =>
  Math.max(720, PLOT_LEFT + PLOT_RIGHT + Math.max(1, pointCount - 1) * TASK_STEP);

const getPointX = (index: number, pointCount: number, width: number): number => {
  if (pointCount <= 1) {
    return (PLOT_LEFT + width - PLOT_RIGHT) / 2;
  }
  return PLOT_LEFT + index * TASK_STEP;
};

const truncateTaskTitle = (title: string): string =>
  title.length > 12 ? `${title.slice(0, 12)}…` : title;

const toPath = (points: PositionedPoint[]): string =>
  points
    .map((point, index) =>
      `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
    )
    .join(" ");

const splitIntoSegments = <T,>(
  values: T[],
  toPosition: (value: T, index: number) => PositionedPoint | null,
): PositionedPoint[][] => {
  const segments: PositionedPoint[][] = [];
  let current: PositionedPoint[] = [];

  values.forEach((value, index) => {
    const position = toPosition(value, index);
    if (!position) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      return;
    }
    current.push(position);
  });

  if (current.length > 0) {
    segments.push(current);
  }
  return segments;
};

function DeltaChart({
  title,
  description,
  points,
}: {
  title: string;
  description: string;
  points: DeltaChartPoint[];
}) {
  if (points.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-5 text-sm text-zinc-600">
        暂无课堂任务点可展示。
      </div>
    );
  }

  const width = getChartWidth(points.length);
  const validValues = points.flatMap((point) =>
    point.value === null ? [] : [Math.abs(point.value)],
  );
  const maxMagnitude = Math.max(1, ...validValues);
  const plotHeight = PLOT_BOTTOM - PLOT_TOP;
  const zeroY = PLOT_TOP + plotHeight / 2;
  const toY = (value: number) =>
    zeroY - (value / maxMagnitude) * (plotHeight / 2);
  const segments = splitIntoSegments(points, (point, index) =>
    point.value === null
      ? null
      : {
          x: getPointX(index, points.length, width),
          y: toY(point.value),
        },
  );

  return (
    <figure className="rounded-lg border border-zinc-200 bg-white p-4">
      <figcaption>
        <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
        <p className="mt-1 text-xs text-zinc-500">{description}</p>
      </figcaption>
      <div className="mt-3 overflow-x-auto" tabIndex={0}>
        <svg
          role="img"
          aria-label={`${title}。${description}`}
          viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
          width={width}
          height={CHART_HEIGHT}
          className="block max-w-none"
        >
          <title>{title}</title>
          <line
            x1={PLOT_LEFT}
            x2={width - PLOT_RIGHT}
            y1={PLOT_TOP}
            y2={PLOT_TOP}
            stroke="#e4e4e7"
          />
          <line
            x1={PLOT_LEFT}
            x2={width - PLOT_RIGHT}
            y1={zeroY}
            y2={zeroY}
            stroke="#71717a"
            strokeWidth="1.5"
          />
          <line
            x1={PLOT_LEFT}
            x2={width - PLOT_RIGHT}
            y1={PLOT_BOTTOM}
            y2={PLOT_BOTTOM}
            stroke="#e4e4e7"
          />
          <text x={8} y={PLOT_TOP + 4} fontSize="11" fill="#3f6212">
            +{formatAiLearningAnalyticsIssueLoad(maxMagnitude)} 改善
          </text>
          <text x={28} y={zeroY + 4} fontSize="11" fill="#52525b">
            0
          </text>
          <text x={8} y={PLOT_BOTTOM + 4} fontSize="11" fill="#991b1b">
            -{formatAiLearningAnalyticsIssueLoad(maxMagnitude)} 恶化
          </text>

          {segments.map((segment, index) =>
            segment.length > 1 ? (
              <path
                key={`segment-${index}`}
                d={toPath(segment)}
                fill="none"
                stroke="#2563eb"
                strokeWidth="2.5"
              />
            ) : null,
          )}

          {points.map((point, index) => {
            const x = getPointX(index, points.length, width);
            return (
              <g key={point.key}>
                <line
                  x1={x}
                  x2={x}
                  y1={PLOT_BOTTOM}
                  y2={PLOT_BOTTOM + 6}
                  stroke="#a1a1aa"
                />
                {point.value === null ? (
                  <g>
                    <title>{point.tooltip}</title>
                    <text
                      x={x}
                      y={PLOT_BOTTOM - 8}
                      textAnchor="middle"
                      fontSize="10"
                      fill="#71717a"
                    >
                      缺口（无可比样本）
                    </text>
                  </g>
                ) : (
                  <g>
                    <title>{point.tooltip}</title>
                    <circle
                      cx={x}
                      cy={toY(point.value)}
                      r="5"
                      fill="#ffffff"
                      stroke="#2563eb"
                      strokeWidth="3"
                    />
                    <text
                      x={x}
                      y={toY(point.value) - 10}
                      textAnchor="middle"
                      fontSize="10"
                      fill="#1d4ed8"
                    >
                      {formatAiLearningAnalyticsDelta(point.value)}
                    </text>
                  </g>
                )}
                <text
                  x={x}
                  y={PLOT_BOTTOM + 22}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#52525b"
                >
                  任务 {index + 1}
                </text>
                <text
                  x={x}
                  y={PLOT_BOTTOM + 38}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#71717a"
                >
                  {truncateTaskTitle(point.taskTitle)}
                </text>
              </g>
            );
          })}
          <text
            x={(PLOT_LEFT + width - PLOT_RIGHT) / 2}
            y={CHART_HEIGHT - 10}
            textAnchor="middle"
            fontSize="11"
            fill="#52525b"
          >
            课堂任务顺序
          </text>
        </svg>
      </div>
      <ul className="sr-only">
        {points.map((point) => (
          <li key={`accessible-${point.key}`}>{point.accessibleText}</li>
        ))}
      </ul>
    </figure>
  );
}

export function AiLearningAnalyticsClassDeltaChart({
  taskTrends,
}: {
  taskTrends: AiLearningAnalyticsTaskTrend[];
}) {
  const points: DeltaChartPoint[] = taskTrends.map((task, index) => {
    const value =
      task.qualityComparableStudentCount > 0
        ? task.averageIssueLoadDelta
        : null;
    const valueText =
      value === null ? "暂无可比样本" : formatAiLearningAnalyticsDelta(value);
    const text = `任务：${task.taskTitle}；发布时间：${toDisplayDate(task.publishedAt)}；平均差值：${valueText}；可比样本数：${task.qualityComparableStudentCount}`;
    return {
      key: task.classroomTaskId || `class-task-${index}`,
      taskTitle: task.taskTitle,
      publishedAt: task.publishedAt,
      value,
      tooltip: text,
      accessibleText: text,
    };
  });

  return (
    <DeltaChart
      title="问题负荷平均变化曲线"
      description="正值表示反馈后问题负荷降低，负值表示升高；无质量可比样本的任务以缺口显示。"
      points={points}
    />
  );
}

export function AiLearningAnalyticsStudentDeltaChart({
  taskPoints,
}: {
  taskPoints: AiLearningAnalyticsTaskPoint[];
}) {
  const points: DeltaChartPoint[] = taskPoints.map((task, index) => {
    const value =
      task.qualityComparable && task.issueLoadDelta !== null
        ? task.issueLoadDelta
        : null;
    const text = [
      `任务：${task.taskTitle}`,
      `发布时间：${toDisplayDate(task.publishedAt)}`,
      `问题负荷 before：${task.issueLoadBefore === null ? "—" : formatAiLearningAnalyticsIssueLoad(task.issueLoadBefore)}`,
      `问题负荷 after：${task.issueLoadAfter === null ? "—" : formatAiLearningAnalyticsIssueLoad(task.issueLoadAfter)}`,
      `差值：${value === null ? "—" : formatAiLearningAnalyticsDelta(value)}`,
      `结果：${AI_LEARNING_ANALYTICS_OUTCOME_LABELS[task.outcome]}`,
    ].join("；");
    return {
      key: task.classroomTaskId || `student-task-${index}`,
      taskTitle: task.taskTitle,
      publishedAt: task.publishedAt,
      value,
      tooltip: text,
      accessibleText: text,
    };
  });

  return (
    <DeltaChart
      title="个人反馈介入变化轨迹"
      description="该轨迹反映代码问题代理变化，不等同于成绩曲线或能力成长曲线；不同任务难度未校正。"
      points={points}
    />
  );
}

type RateSeriesKey = "resubmission" | "comparable" | "improved";
type RateSeriesDefinition = {
  key: RateSeriesKey;
  label: string;
  color: string;
  dashArray?: string;
  marker: "circle" | "square" | "diamond";
};

const RATE_SERIES: RateSeriesDefinition[] = [
  {
    key: "resubmission",
    label: "反馈后重提率",
    color: "#2563eb",
    marker: "circle",
  },
  {
    key: "comparable",
    label: "质量可比率",
    color: "#7c3aed",
    dashArray: "8 5",
    marker: "square",
  },
  {
    key: "improved",
    label: "可比样本改善率",
    color: "#15803d",
    dashArray: "2 5",
    marker: "diamond",
  },
];

type RateDatum = {
  rate: number;
  numerator: number;
  denominator: number;
};

const getRateDatum = (
  task: AiLearningAnalyticsTaskTrend,
  seriesKey: RateSeriesKey,
): RateDatum => {
  if (seriesKey === "resubmission") {
    return {
      rate: task.postFeedbackResubmissionRate,
      numerator: task.postFeedbackResubmittedStudentCount,
      denominator: task.aiDeliveredStudentCount,
    };
  }
  if (seriesKey === "comparable") {
    return {
      rate: task.qualityComparableRate,
      numerator: task.qualityComparableStudentCount,
      denominator: task.aiDeliveredStudentCount,
    };
  }
  return {
    rate: task.improvedRate,
    numerator: task.improvedStudentCount,
    denominator: task.qualityComparableStudentCount,
  };
};

function RateMarker({
  marker,
  x,
  y,
  color,
}: {
  marker: RateSeriesDefinition["marker"];
  x: number;
  y: number;
  color: string;
}) {
  if (marker === "square") {
    return (
      <rect
        x={x - 5}
        y={y - 5}
        width="10"
        height="10"
        fill="#ffffff"
        stroke={color}
        strokeWidth="2.5"
      />
    );
  }
  if (marker === "diamond") {
    return (
      <polygon
        points={`${x},${y - 6} ${x + 6},${y} ${x},${y + 6} ${x - 6},${y}`}
        fill="#ffffff"
        stroke={color}
        strokeWidth="2.5"
      />
    );
  }
  return (
    <circle
      cx={x}
      cy={y}
      r="5"
      fill="#ffffff"
      stroke={color}
      strokeWidth="2.5"
    />
  );
}

export function AiLearningAnalyticsRatesChart({
  taskTrends,
}: {
  taskTrends: AiLearningAnalyticsTaskTrend[];
}) {
  if (taskTrends.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-5 text-sm text-zinc-600">
        暂无课堂任务点可展示。
      </div>
    );
  }

  const width = getChartWidth(taskTrends.length);
  const plotHeight = PLOT_BOTTOM - PLOT_TOP;
  const toY = (rate: number) =>
    PLOT_BOTTOM - Math.min(1, Math.max(0, rate)) * plotHeight;

  return (
    <figure className="rounded-lg border border-zinc-200 bg-white p-4">
      <figcaption>
        <h3 className="text-sm font-semibold text-zinc-900">
          反馈后行为与可比性趋势
        </h3>
        <p className="mt-1 text-xs text-zinc-500">
          纵轴固定为 0%–100%；分母为 0 的指标以缺口表示，并非 0% 表现。
        </p>
      </figcaption>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-zinc-700">
        {RATE_SERIES.map((series) => (
          <span key={series.key} className="inline-flex items-center gap-1.5">
            <svg width="34" height="14" aria-hidden="true">
              <line
                x1="1"
                x2="33"
                y1="7"
                y2="7"
                stroke={series.color}
                strokeWidth="2"
                strokeDasharray={series.dashArray}
              />
              <RateMarker
                marker={series.marker}
                x={17}
                y={7}
                color={series.color}
              />
            </svg>
            {series.label}
          </span>
        ))}
      </div>
      <div className="mt-2 overflow-x-auto" tabIndex={0}>
        <svg
          role="img"
          aria-label="反馈后行为与可比性趋势。反馈后重提率、质量可比率和可比样本改善率按课堂任务顺序展示。"
          viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
          width={width}
          height={CHART_HEIGHT}
          className="block max-w-none"
        >
          <title>反馈后行为与可比性趋势</title>
          {[0, 0.25, 0.5, 0.75, 1].map((rate) => {
            const y = toY(rate);
            return (
              <g key={rate}>
                <line
                  x1={PLOT_LEFT}
                  x2={width - PLOT_RIGHT}
                  y1={y}
                  y2={y}
                  stroke={rate === 0 ? "#71717a" : "#e4e4e7"}
                  strokeWidth={rate === 0 ? "1.5" : "1"}
                />
                <text
                  x={22}
                  y={y + 4}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#52525b"
                >
                  {Math.round(rate * 100)}%
                </text>
              </g>
            );
          })}

          {RATE_SERIES.map((series) => {
            const segments = splitIntoSegments(taskTrends, (task, index) => {
              const datum = getRateDatum(task, series.key);
              return datum.denominator === 0
                ? null
                : {
                    x: getPointX(index, taskTrends.length, width),
                    y: toY(datum.rate),
                  };
            });
            return (
              <g key={`line-${series.key}`}>
                {segments.map((segment, index) =>
                  segment.length > 1 ? (
                    <path
                      key={`${series.key}-segment-${index}`}
                      d={toPath(segment)}
                      fill="none"
                      stroke={series.color}
                      strokeWidth="2.5"
                      strokeDasharray={series.dashArray}
                    />
                  ) : null,
                )}
              </g>
            );
          })}

          {taskTrends.map((task, taskIndex) => {
            const x = getPointX(taskIndex, taskTrends.length, width);
            return (
              <g key={task.classroomTaskId || `rates-task-${taskIndex}`}>
                <line
                  x1={x}
                  x2={x}
                  y1={PLOT_BOTTOM}
                  y2={PLOT_BOTTOM + 6}
                  stroke="#a1a1aa"
                />
                {RATE_SERIES.map((series) => {
                  const datum = getRateDatum(task, series.key);
                  if (datum.denominator === 0) {
                    return null;
                  }
                  const tooltip = `${task.taskTitle}；${series.label}：${formatAiLearningAnalyticsPercent(datum.rate)}（${datum.numerator}/${datum.denominator}）`;
                  return (
                    <g key={`${task.classroomTaskId}-${series.key}`}>
                      <title>{tooltip}</title>
                      <RateMarker
                        marker={series.marker}
                        x={x}
                        y={toY(datum.rate)}
                        color={series.color}
                      />
                    </g>
                  );
                })}
                <text
                  x={x}
                  y={PLOT_BOTTOM + 22}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#52525b"
                >
                  任务 {taskIndex + 1}
                </text>
                <text
                  x={x}
                  y={PLOT_BOTTOM + 38}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#71717a"
                >
                  {truncateTaskTitle(task.taskTitle)}
                </text>
              </g>
            );
          })}
          <text
            x={(PLOT_LEFT + width - PLOT_RIGHT) / 2}
            y={CHART_HEIGHT - 10}
            textAnchor="middle"
            fontSize="11"
            fill="#52525b"
          >
            课堂任务顺序
          </text>
        </svg>
      </div>
      <ul className="sr-only">
        {taskTrends.flatMap((task) =>
          RATE_SERIES.map((series) => {
            const datum = getRateDatum(task, series.key);
            return (
              <li key={`accessible-${task.classroomTaskId}-${series.key}`}>
                {task.taskTitle}，{series.label}：
                {datum.denominator === 0
                  ? "无对应分母样本"
                  : `${formatAiLearningAnalyticsPercent(datum.rate)}，${datum.numerator}/${datum.denominator}`}
              </li>
            );
          }),
        )}
      </ul>
    </figure>
  );
}
