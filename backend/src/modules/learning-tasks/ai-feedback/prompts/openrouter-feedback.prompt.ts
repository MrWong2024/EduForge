import { AiSubmissionAnalysisContext } from '../interfaces/ai-submission-analysis-context.interface';
import { AI_FEEDBACK_JSON_PROTOCOL } from '../protocol/ai-feedback-json.protocol';

type BuildUserPromptParams = {
  context: AiSubmissionAnalysisContext;
  maxCodeChars: number;
};

const toRubricText = (rubric?: Record<string, unknown>) => {
  if (!rubric) {
    return 'n/a';
  }
  const keys = Object.keys(rubric);
  if (keys.length === 0) {
    return 'n/a';
  }
  try {
    return JSON.stringify(rubric);
  } catch {
    return 'n/a';
  }
};

export const buildSystemPrompt = () => {
  const rootKeys = AI_FEEDBACK_JSON_PROTOCOL.allowedRootKeys.join(', ');
  const itemKeys = AI_FEEDBACK_JSON_PROTOCOL.allowedItemKeys.join(', ');
  const typeValues = AI_FEEDBACK_JSON_PROTOCOL.allowedTypes.join('|');
  const severityValues = AI_FEEDBACK_JSON_PROTOCOL.allowedSeverities.join('|');
  const tags = AI_FEEDBACK_JSON_PROTOCOL.allowedTags.join(', ');
  const schemaExample = JSON.stringify(AI_FEEDBACK_JSON_PROTOCOL.schemaExample);

  return [
    '你是 EduForge 的教学反馈助手。',
    'Return ONLY a single JSON object; first character "{", last character "}".',
    `Root keys allowed: ${rootKeys}. No other root keys.`,
    'meta is optional; if present it must be an object (e.g., language, wasTruncated, model).',
    'items must be an array of objects.',
    `Item keys allowed: ${itemKeys}. No other item keys.`,
    `type must be one of: ${typeValues}.`,
    `severity must be one of: ${severityValues}.`,
    'message must be a non-empty string.',
    `tags must come from this list only: ${tags}.`,
    'message 与 suggestion 默认使用简体中文，表达清晰、直接、可执行，适合中国高校学生阅读。',
    '代码标识符、变量名、函数名、类名、语言关键字保持原文，不翻译代码元素。',
    'No markdown, no code fences, no explanations, no extra fields.',
    'If no issues, return {"items":[]}.',
    `Schema example: ${schemaExample}`,
  ].join('\n');
};

export const buildUserPrompt = (params: BuildUserPromptParams) => {
  const codeText = params.context.codeText ?? '';
  const originalLen = codeText.length;
  const limit = params.maxCodeChars;
  const usedText = originalLen > limit ? codeText.slice(0, limit) : codeText;
  const wasTruncated = originalLen > limit;
  const usedLen = usedText.length;
  const rubricText = toRubricText(params.context.taskRubric);

  return [
    'Task: analyze the student submission and return JSON feedback items only.',
    'You must evaluate against the task requirements and rubric, not generic style advice only.',
    'If code deviates from the task goal, misses key requirements, or fails rubric points, point it out directly.',
    `SubmissionId: ${params.context.submissionId}`,
    `ClassroomTaskId: ${params.context.classroomTaskId ?? 'n/a'}`,
    `TaskId: ${params.context.taskId}`,
    `TaskTitle: ${params.context.taskTitle}`,
    `TaskDescription: ${params.context.taskDescription}`,
    `TaskRubric: ${rubricText}`,
    `Language: ${params.context.language || 'unknown'}`,
    `AttemptNo: ${params.context.attemptNo}`,
    `AIUsageDeclaration: ${params.context.aiUsageDeclaration || 'n/a'}`,
    `CodeTruncated: ${wasTruncated ? 'true' : 'false'}, OriginalLength: ${originalLen}, UsedLength: ${usedLen}`,
    'Code:',
    usedText,
  ].join('\n');
};
