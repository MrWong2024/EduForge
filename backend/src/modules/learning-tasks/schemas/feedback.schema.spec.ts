import { Mongoose, Types } from 'mongoose';
import {
  Feedback,
  FeedbackSchema,
  FeedbackSeverity,
  FeedbackType,
} from './feedback.schema';

describe('Feedback source schema validation', () => {
  const FeedbackModel = new Mongoose().model<Feedback>(
    Feedback.name,
    FeedbackSchema,
  );

  const buildFeedback = (source: string) =>
    new FeedbackModel({
      submissionId: new Types.ObjectId(),
      source,
      type: FeedbackType.Other,
      severity: FeedbackSeverity.Info,
      message: 'Local feedback source validation.',
    });

  it.each(['AI', 'TEACHER'])('accepts %s as a feedback source', (source) => {
    expect(buildFeedback(source).validateSync()).toBeUndefined();
  });

  it.each(['SYSTEM', 'INVALID'])(
    'rejects %s as a feedback source',
    (source) => {
      const error = buildFeedback(source).validateSync();
      expect(error?.errors.source).toMatchObject({
        kind: 'enum',
        path: 'source',
        value: source,
      });
    },
  );
});
