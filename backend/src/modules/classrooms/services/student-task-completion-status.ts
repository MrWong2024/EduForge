import { Types } from 'mongoose';
import {
  Feedback,
  FeedbackSeverity,
  FeedbackSource,
} from '../../learning-tasks/schemas/feedback.schema';

export type CompletionFeedback = Pick<
  Feedback,
  'submissionId' | 'source' | 'severity'
>;

export type CompletionStatusValue =
  | 'NOT_SUBMITTED'
  | 'NO_FEEDBACK'
  | 'QUALIFIED'
  | 'QUALIFIED_WITH_WARNINGS'
  | 'UNQUALIFIED';

export type TaskCompletionStatus = {
  status: CompletionStatusValue;
  severity: FeedbackSeverity | null;
  source: FeedbackSource.Teacher | FeedbackSource.AI | null;
  latestSubmissionId: string | null;
  teacherFeedbackCount: number;
  aiFeedbackCount: number;
  teacherWorstSeverity: FeedbackSeverity | null;
  aiWorstSeverity: FeedbackSeverity | null;
};

const severityRanks: Record<FeedbackSeverity, number> = {
  [FeedbackSeverity.Info]: 1,
  [FeedbackSeverity.Warn]: 2,
  [FeedbackSeverity.Error]: 3,
};

const severityRank = (severity: FeedbackSeverity): number =>
  severityRanks[severity] ?? 0;

const pickWorstSeverity = (
  severities: FeedbackSeverity[],
): FeedbackSeverity | null => {
  let worst: FeedbackSeverity | null = null;
  for (const severity of severities) {
    if (severityRank(severity) === 0) {
      continue;
    }
    if (!worst || severityRank(severity) > severityRank(worst)) {
      worst = severity;
    }
  }
  return worst;
};

const statusFromSeverity = (
  severity: FeedbackSeverity,
): Exclude<CompletionStatusValue, 'NOT_SUBMITTED' | 'NO_FEEDBACK'> => {
  if (severity === FeedbackSeverity.Error) {
    return 'UNQUALIFIED';
  }
  if (severity === FeedbackSeverity.Warn) {
    return 'QUALIFIED_WITH_WARNINGS';
  }
  return 'QUALIFIED';
};

export const buildNotSubmittedCompletionStatus = (): TaskCompletionStatus => ({
  status: 'NOT_SUBMITTED',
  severity: null,
  source: null,
  latestSubmissionId: null,
  teacherFeedbackCount: 0,
  aiFeedbackCount: 0,
  teacherWorstSeverity: null,
  aiWorstSeverity: null,
});

const buildNoFeedbackCompletionStatus = (
  latestSubmissionId: string,
  teacherFeedbackCount = 0,
  aiFeedbackCount = 0,
  teacherWorstSeverity: FeedbackSeverity | null = null,
  aiWorstSeverity: FeedbackSeverity | null = null,
): TaskCompletionStatus => ({
  status: 'NO_FEEDBACK',
  severity: null,
  source: null,
  latestSubmissionId,
  teacherFeedbackCount,
  aiFeedbackCount,
  teacherWorstSeverity,
  aiWorstSeverity,
});

export const buildCompletionStatus = (
  latestSubmissionId: string,
  feedbacks: CompletionFeedback[],
): TaskCompletionStatus => {
  const teacherFeedbacks = feedbacks.filter(
    (feedback) => feedback.source === FeedbackSource.Teacher,
  );
  const aiFeedbacks = feedbacks.filter(
    (feedback) => feedback.source === FeedbackSource.AI,
  );
  const teacherWorstSeverity = pickWorstSeverity(
    teacherFeedbacks.map((feedback) => feedback.severity),
  );
  const aiWorstSeverity = pickWorstSeverity(
    aiFeedbacks.map((feedback) => feedback.severity),
  );

  if (teacherFeedbacks.length > 0 && teacherWorstSeverity) {
    return {
      status: statusFromSeverity(teacherWorstSeverity),
      severity: teacherWorstSeverity,
      source: FeedbackSource.Teacher,
      latestSubmissionId,
      teacherFeedbackCount: teacherFeedbacks.length,
      aiFeedbackCount: aiFeedbacks.length,
      teacherWorstSeverity,
      aiWorstSeverity,
    };
  }

  if (aiFeedbacks.length > 0 && aiWorstSeverity) {
    return {
      status: statusFromSeverity(aiWorstSeverity),
      severity: aiWorstSeverity,
      source: FeedbackSource.AI,
      latestSubmissionId,
      teacherFeedbackCount: teacherFeedbacks.length,
      aiFeedbackCount: aiFeedbacks.length,
      teacherWorstSeverity,
      aiWorstSeverity,
    };
  }

  return buildNoFeedbackCompletionStatus(
    latestSubmissionId,
    teacherFeedbacks.length,
    aiFeedbacks.length,
    teacherWorstSeverity,
    aiWorstSeverity,
  );
};

export const groupCompletionFeedbacksBySubmissionId = (
  feedbacks: CompletionFeedback[],
) => {
  const feedbacksBySubmissionId = new Map<string, CompletionFeedback[]>();
  for (const feedback of feedbacks) {
    const key = feedback.submissionId.toString();
    const bucket = feedbacksBySubmissionId.get(key) ?? [];
    bucket.push(feedback);
    feedbacksBySubmissionId.set(key, bucket);
  }
  return feedbacksBySubmissionId;
};

export const toLatestSubmissionObjectIds = (
  values: Array<Types.ObjectId | undefined>,
) => values.filter((id): id is Types.ObjectId => Boolean(id));
