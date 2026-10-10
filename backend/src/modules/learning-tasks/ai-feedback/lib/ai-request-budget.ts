import { AiFeedbackProviderError } from '../interfaces/ai-feedback-provider.error';
import { AiTokenUsage } from '../interfaces/ai-feedback-provider.interface';
export type AiChatMessage = { role: 'system' | 'user'; content: string };
export function checkInputBudget(messages: AiChatMessage[], limit: number) {
  const bytes = Buffer.byteLength(JSON.stringify(messages), 'utf8');
  if (bytes > limit) {
    throw new AiFeedbackProviderError(
      'INPUT_BUDGET_EXCEEDED',
      false,
      'AI_FEEDBACK: INPUT_BUDGET_EXCEEDED',
    );
  }
  return bytes;
}
export function readReportedUsage(data: unknown): AiTokenUsage | null {
  if (!data || typeof data !== 'object' || !('usage' in data)) return null;
  const usage = data.usage;
  if (!usage || typeof usage !== 'object') return null;
  if (
    !('prompt_tokens' in usage) ||
    !('completion_tokens' in usage) ||
    !('total_tokens' in usage)
  )
    return null;
  const prompt = usage.prompt_tokens,
    completion = usage.completion_tokens,
    total = usage.total_tokens;
  if (
    typeof prompt !== 'number' ||
    typeof completion !== 'number' ||
    typeof total !== 'number' ||
    ![prompt, completion, total].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
    prompt + completion !== total
  )
    return null;
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
  };
}
