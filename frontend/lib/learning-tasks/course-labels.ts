export const TASK_COURSE_LABEL_UNCLASSIFIED = "未分类";

export const TASK_COURSE_LABELS = [
  TASK_COURSE_LABEL_UNCLASSIFIED,
  "通用编程",
  "程序设计基础",
  "面向对象程序设计",
  "C语言程序设计",
  "C++程序设计",
  "Java 程序设计",
  "Python 程序设计",
  "程序设计实训",
  "数据结构",
  "算法设计与分析",
  "离散数学",
  "数字逻辑",
  "计算机组成原理",
  "操作系统",
  "编译原理",
  "计算机网络",
  "数据库原理",
  "软件工程",
  "Java Web",
  "Web 前端开发",
  "后端开发",
  "全栈开发",
  "软件测试",
  "软件体系结构",
  "需求分析与系统设计",
  "DevOps 与持续交付",
  "微服务架构",
  "软件项目开发实训",
  "综合课程设计",
  "毕业设计",
  "Linux 系统与应用",
  "汇编语言程序设计",
  "微机原理与接口技术",
  "单片机原理与应用",
  "嵌入式系统",
  "网络编程",
  "分布式系统",
  "并行计算",
  "高性能计算",
  "数据库应用开发",
  "数据挖掘",
  "大数据技术",
  "云计算",
  "人工智能",
  "机器学习",
  "深度学习",
  "自然语言处理",
  "模式识别",
  "推荐系统",
  "信息检索",
  "数字图像处理",
  "计算机图形学",
  "信息安全",
  "网络安全",
  "区块链技术",
  "物联网技术",
  "移动应用开发",
  "Android 开发",
  "游戏开发",
  "人机交互",
  "计算思维",
  "创新实践项目",
] as const;

export type TaskCourseLabel = (typeof TASK_COURSE_LABELS)[number];

export const TASK_COURSE_LABEL_FORM_OPTIONS = TASK_COURSE_LABELS.filter(
  (label) => label !== TASK_COURSE_LABEL_UNCLASSIFIED
);

export const normalizeTaskCourseLabel = (
  value: unknown
): TaskCourseLabel | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return TASK_COURSE_LABELS.includes(trimmed as TaskCourseLabel)
    ? (trimmed as TaskCourseLabel)
    : undefined;
};

export const isUnclassifiedTaskCourseLabel = (value: unknown): boolean => {
  if (typeof value !== "string") {
    return true;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  return trimmed === TASK_COURSE_LABEL_UNCLASSIFIED;
};

export const toTaskCourseLabelDisplayText = (value: unknown): string => {
  if (typeof value !== "string") {
    return TASK_COURSE_LABEL_UNCLASSIFIED;
  }
  const trimmed = value.trim();
  return trimmed || TASK_COURSE_LABEL_UNCLASSIFIED;
};
