import { AiFeedbackStatus } from '../interfaces/ai-feedback-status.enum';

export function toAiFeedbackStatus(value: unknown): AiFeedbackStatus {
  switch (value) {
    case 'PENDING':
      return AiFeedbackStatus.Pending;
    case 'RUNNING':
      return AiFeedbackStatus.Running;
    case 'SUCCEEDED':
      return AiFeedbackStatus.Succeeded;
    case 'FAILED':
      return AiFeedbackStatus.Failed;
    case 'DEAD':
      return AiFeedbackStatus.Dead;
    default:
      return AiFeedbackStatus.Unknown;
  }
}
