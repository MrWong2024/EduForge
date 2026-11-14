import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { Submission } from '../../schemas/submission.schema';
import { AiFeedbackJob } from '../schemas/ai-feedback-job.schema';
import { AiFeedbackJobService } from './ai-feedback-job.service';

type StatusRow = { submissionId: Types.ObjectId; status?: unknown };
type ExistingJob = { _id: Types.ObjectId; status?: unknown };

const query = <T>(value: T) => {
  const chain = {
    select: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(value),
  };
  chain.select.mockReturnValue(chain);
  chain.lean.mockReturnValue(chain);
  return chain;
};

describe('AiFeedbackJobService public status projection', () => {
  let module: TestingModule | undefined;

  const harness = async (
    rows: readonly StatusRow[] = [],
    existing: ExistingJob | null = null,
  ) => {
    const statusQuery = query(rows);
    const existingQuery = query(existing);
    const model = {
      find: jest.fn().mockReturnValue(statusQuery),
      findOne: jest.fn().mockReturnValue(existingQuery),
      create: jest.fn(),
      updateOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    module = await Test.createTestingModule({
      providers: [
        AiFeedbackJobService,
        { provide: getModelToken(AiFeedbackJob.name), useValue: model },
      ],
    }).compile();
    return { service: module.get(AiFeedbackJobService), model, statusQuery };
  };

  afterEach(async () => {
    await module?.close();
    module = undefined;
  });

  it.each([
    ['PENDING', 'PENDING'],
    ['RUNNING', 'RUNNING'],
    ['SUCCEEDED', 'SUCCEEDED'],
    ['FAILED', 'FAILED'],
    ['DEAD', 'DEAD'],
  ])('preserves the exact formal state %s', async (status, expected) => {
    const submissionId = new Types.ObjectId();
    const row = Object.freeze({ submissionId, status });
    const rows = Object.freeze([row]);
    const { service, model, statusQuery } = await harness(rows);

    const result = await service.getStatusMapBySubmissionIds([submissionId]);

    expect([...result]).toEqual([[submissionId.toHexString(), expected]]);
    expect(model.find).toHaveBeenCalledWith({
      submissionId: { $in: [submissionId] },
    });
    expect(statusQuery.select).toHaveBeenCalledWith('submissionId status');
    expect(rows[0]).toBe(row);
    expect(row.status).toBe(status);
  });

  it('does not create a map entry when no Job exists', async () => {
    const submissionId = new Types.ObjectId();
    const { service, model } = await harness();

    const result = await service.getStatusMapBySubmissionIds([submissionId]);

    expect(result.size).toBe(0);
    expect(result.has(submissionId.toHexString())).toBe(false);
    expect(model.find).toHaveBeenCalledTimes(1);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('projects an existing Job with a missing status as UNKNOWN', async () => {
    const submissionId = new Types.ObjectId();
    const row = Object.freeze({ submissionId });
    const { service } = await harness(Object.freeze([row]));

    const result = await service.getStatusMapBySubmissionIds([submissionId]);

    expect([...result]).toEqual([[submissionId.toHexString(), 'UNKNOWN']]);
    expect(Object.hasOwn(row, 'status')).toBe(false);
  });

  const invalidStates: [string, unknown][] = [
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['whitespace', ' \t\n '],
    ['lowercase', 'pending'],
    ['mixed case', 'Pending'],
    ['surrounding whitespace', ' PENDING '],
    ['unrecognized string', 'QUEUED'],
    ['stored NOT_REQUESTED', 'NOT_REQUESTED'],
    ['stored UNKNOWN', 'UNKNOWN'],
    ['zero', 0],
    ['number', 1],
    ['true', true],
    ['false', false],
    ['empty array', Object.freeze([])],
    ['single formal-state array', Object.freeze(['PENDING'])],
    ['object', Object.freeze({ status: 'PENDING' })],
    [
      'object with unsafe string conversion',
      Object.freeze({
        toString: () => {
          throw new Error('Raw status must not be converted');
        },
      }),
    ],
    ['constructor', 'constructor'],
    ['__proto__', '__proto__'],
    ['toString', 'toString'],
    ['hasOwnProperty', 'hasOwnProperty'],
  ];

  it.each(invalidStates)(
    'projects an existing Job with %s as UNKNOWN without changing input',
    async (_label, status) => {
      const submissionId = new Types.ObjectId();
      const row = Object.freeze({ submissionId, status });
      const rows = Object.freeze([row]);
      const ids = [submissionId];
      const { service, model } = await harness(rows);

      const result = await service.getStatusMapBySubmissionIds(ids);

      expect([...result]).toEqual([[submissionId.toHexString(), 'UNKNOWN']]);
      expect(ids).toEqual([submissionId]);
      expect(rows[0]).toBe(row);
      expect(row.status).toBe(status);
      expect(model.create).not.toHaveBeenCalled();
      expect(model.updateOne).not.toHaveBeenCalled();
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it('returns an empty map for empty IDs without querying', async () => {
    const { service, model } = await harness();
    const ids: Types.ObjectId[] = [];

    const result = await service.getStatusMapBySubmissionIds(ids);

    expect([...result]).toEqual([]);
    expect(ids).toEqual([]);
    expect(model.find).not.toHaveBeenCalled();
    expect(model.findOne).not.toHaveBeenCalled();
    expect(model.create).not.toHaveBeenCalled();
  });

  it('keeps an existing unknown Job ID without creating or resetting it', async () => {
    const submission = Object.freeze(
      Object.assign(new Submission(), { _id: new Types.ObjectId() }),
    );
    const jobId = new Types.ObjectId();
    const status = Object.freeze(['PENDING']);
    const existing = Object.freeze({ _id: jobId, status });
    const { service, model } = await harness([], existing);

    const result = await service.ensureJobForSubmission(submission);

    expect(result).toEqual({ jobId: jobId.toHexString(), status: ['PENDING'] });
    expect(result.status).toBe(status);
    expect(existing.status).toBe(status);
    expect(model.findOne).toHaveBeenCalledTimes(1);
    expect(model.findOne).toHaveBeenCalledWith({
      submissionId: submission._id,
    });
    expect(model.create).not.toHaveBeenCalled();
    expect(model.updateOne).not.toHaveBeenCalled();
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
