import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Submission } from './submission.schema';

export type FeedbackDocument = HydratedDocument<Feedback>;

export enum FeedbackSource {
  AI = 'AI',
  Teacher = 'TEACHER',
  System = 'SYSTEM',
}

export enum FeedbackType {
  Syntax = 'SYNTAX',
  Style = 'STYLE',
  Design = 'DESIGN',
  Bug = 'BUG',
  Performance = 'PERFORMANCE',
  Security = 'SECURITY',
  Other = 'OTHER',
}

export enum FeedbackSeverity {
  Info = 'INFO',
  Warn = 'WARN',
  Error = 'ERROR',
}

@Schema({ timestamps: true })
export class Feedback {
  @Prop({ type: Types.ObjectId, ref: Submission.name, required: true })
  submissionId!: Types.ObjectId;

  @Prop({ required: true, enum: FeedbackSource })
  source!: FeedbackSource;

  @Prop({ required: true, enum: FeedbackType })
  type!: FeedbackType;

  @Prop({ required: true, enum: FeedbackSeverity })
  severity!: FeedbackSeverity;

  @Prop({ required: true })
  message!: string;

  @Prop()
  suggestion?: string;

  @Prop({ type: [String] })
  tags?: string[];

  @Prop()
  scoreHint?: number;
}

export const FeedbackSchema = SchemaFactory.createForClass(Feedback);
FeedbackSchema.index(
  { submissionId: 1, source: 1, type: 1, severity: 1, message: 1 },
  { unique: true },
);
// Indexes below optimize list/report queries; add write overhead on feedback writes.
FeedbackSchema.index({ submissionId: 1, createdAt: 1 });
// Supports review-pack facets by submission scope and source filtering.
FeedbackSchema.index({ submissionId: 1, source: 1, createdAt: -1 });
