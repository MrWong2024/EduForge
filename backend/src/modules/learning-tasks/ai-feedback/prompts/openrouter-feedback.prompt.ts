import type { SubmissionDocument } from '../../schemas/submission.schema';
import { AI_FEEDBACK_JSON_PROTOCOL } from '../protocol/ai-feedback-json.protocol';

type BuildUserPromptParams = {
  submission: SubmissionDocument;
  maxCodeChars: number;
};

export const buildSystemPrompt = () => {
  const rootKeys = AI_FEEDBACK_JSON_PROTOCOL.allowedRootKeys.join(', ');
  const itemKeys = AI_FEEDBACK_JSON_PROTOCOL.allowedItemKeys.join(', ');
  const typeValues = AI_FEEDBACK_JSON_PROTOCOL.allowedTypes.join('|');
  const severityValues = AI_FEEDBACK_JSON_PROTOCOL.allowedSeverities.join('|');
  const tags = AI_FEEDBACK_JSON_PROTOCOL.allowedTags.join(', ');
  const schemaExample = JSON.stringify(AI_FEEDBACK_JSON_PROTOCOL.schemaExample);

  return [
    'You are EduForge AI feedback provider.',
    'Return ONLY a single JSON object; first character "{", last character "}".',
    `Root keys allowed: ${rootKeys}. No other root keys.`,
    'meta is optional; if present it must be an object (e.g., language, wasTruncated, model).',
    'items must be an array of objects.',
    `Item keys allowed: ${itemKeys}. No other item keys.`,
    `type must be one of: ${typeValues}.`,
    `severity must be one of: ${severityValues}.`,
    'message must be a non-empty string.',
    `tags must come from this list only: ${tags}.`,
    'No markdown, no code fences, no explanations, no extra fields.',
    'If no issues, return {"items":[]}.',
    `Schema example: ${schemaExample}`,
  ].join('\n');
};

export const buildUserPrompt = (params: BuildUserPromptParams) => {
  const codeText = params.submission.content?.codeText ?? '';
  const originalLen = codeText.length;
  const limit = params.maxCodeChars;
  const usedText = originalLen > limit ? codeText.slice(0, limit) : codeText;
  const wasTruncated = originalLen > limit;
  const usedLen = usedText.length;
  const language = params.submission.content?.language ?? 'unknown';
  const meta = params.submission.meta?.aiUsageDeclaration ?? '';

  return [
    'Task: analyze the student submission and return JSON feedback items only.',
    `SubmissionId: ${params.submission._id.toString()}`,
    `ClassroomTaskId: ${params.submission.classroomTaskId?.toString?.() ?? 'n/a'}`,
    `Language: ${language}`,
    `AttemptNo: ${params.submission.attemptNo ?? 'n/a'}`,
    `AIUsageDeclaration: ${meta || 'n/a'}`,
    `CodeTruncated: ${wasTruncated ? 'true' : 'false'}, OriginalLength: ${originalLen}, UsedLength: ${usedLen}`,
    'Code:',
    usedText,
  ].join('\n');
};
