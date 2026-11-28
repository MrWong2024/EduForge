import {
  BadRequestException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  afterEach(() => jest.restoreAllMocks());

  const cooldownDetails = {
    cooldownMs: 300000,
    cooldownSeconds: 300,
    retryAfterMs: 1501,
    retryAfterSeconds: 2,
  };

  function capture(error: unknown) {
    const adapter = new ExpressAdapter();
    const adapterHost = new HttpAdapterHost();
    adapterHost.httpAdapter = adapter;
    const reply = jest
      .spyOn(adapter, 'reply')
      .mockImplementation(() => undefined);
    const response = {};
    const context = new ExecutionContextHost([
      { originalUrl: '/synthetic', url: '/synthetic' },
      response,
    ]);
    new AllExceptionsFilter(adapterHost).catch(error, context);
    return { reply, response };
  }

  it.each([
    new Error('synthetic internal detail'),
    new InternalServerErrorException('synthetic internal detail'),
    new HttpException(
      {
        message: ['synthetic internal detail'],
        code: 'RESET_TOKEN_INVALID',
        extra: 'private',
      },
      503,
    ),
    new HttpException(
      {
        message: 'synthetic internal detail',
        code: 'SUBMISSION_COOLDOWN_ACTIVE',
        ...cooldownDetails,
      },
      500,
    ),
  ])('redacts every server error', (error) => {
    const { reply, response } = capture(error);
    expect(reply).toHaveBeenCalledWith(
      response,
      {
        statusCode: error instanceof HttpException ? error.getStatus() : 500,
        timestamp: expect.any(String) as unknown,
        path: '/synthetic',
        message: 'Internal server error',
      },
      error instanceof HttpException ? error.getStatus() : 500,
    );
  });

  it.each(['RESET_TOKEN_INVALID', 'PASSWORD_POLICY_VIOLATION'])(
    'preserves the explicitly public 400 code %s without other fields',
    (code) => {
      const { reply, response } = capture(
        new BadRequestException({
          message: 'public message',
          code,
          extra: 'private',
          ...cooldownDetails,
          contentRevision: 1,
        }),
      );
      expect(reply).toHaveBeenCalledWith(
        response,
        {
          statusCode: 400,
          timestamp: expect.any(String) as unknown,
          path: '/synthetic',
          message: 'public message',
          code,
        },
        400,
      );
    },
  );

  it.each([
    [
      403,
      'LATE_SUBMISSION_NOT_ALLOWED',
      'Late submission is not allowed for this classroom task',
    ],
    [409, 'COURSE_NOT_EMPTY', '该课程下已有班级记录，不能删除，只能归档'],
    [
      409,
      'CLASSROOM_NOT_EMPTY',
      '该班级已有成员或任务记录，不能删除，只能归档',
    ],
    [
      409,
      'CLASSROOM_TASK_NOT_EMPTY',
      '课堂任务已有作品或 AI 反馈任务，不能删除。',
    ],
    [
      409,
      'PAGE_ACCOUNT_MISMATCH',
      '当前登录账号与此页面不一致，请重新打开页面后再操作。',
    ],
  ] as const)(
    'projects only the public code for %s %s and preserves its message',
    (status, code, message) => {
      const { reply, response } = capture(
        new HttpException(
          {
            message,
            code,
            ...cooldownDetails,
            statusCode: 200,
            timestamp: 'private',
            path: '/private',
            reason: 'private',
            contentRevision: 1,
          },
          status,
        ),
      );
      expect(reply).toHaveBeenCalledWith(
        response,
        {
          statusCode: status,
          timestamp: expect.any(String) as unknown,
          path: '/synthetic',
          message,
          code,
        },
        status,
      );
    },
  );

  it.each([
    {
      cooldownMs: 300000,
      cooldownSeconds: 300,
      retryAfterMs: 1501,
      retryAfterSeconds: 2,
    },
    {
      cooldownMs: 1001,
      cooldownSeconds: 2,
      retryAfterMs: 1001,
      retryAfterSeconds: 2,
    },
    {
      cooldownMs: 1,
      cooldownSeconds: 1,
      retryAfterMs: 1,
      retryAfterSeconds: 1,
    },
  ])('projects the complete valid cooldown tuple %#', (details) => {
    const message =
      '提交过于频繁。当前设置的提交冷却时间为 300 秒，请约 2 秒后再试。';
    const { reply, response } = capture(
      new HttpException(
        {
          code: 'SUBMISSION_COOLDOWN_ACTIVE',
          message,
          ...details,
          reason: 'private',
          expectedRevision: 1,
          reviewStartedAt: 'private',
          extra: 'private',
        },
        429,
      ),
    );
    expect(reply).toHaveBeenCalledWith(
      response,
      {
        statusCode: 429,
        timestamp: expect.any(String) as unknown,
        path: '/synthetic',
        message,
        code: 'SUBMISSION_COOLDOWN_ACTIVE',
        ...details,
      },
      429,
    );
  });

  it.each([
    ['missing cooldownMs', { cooldownMs: undefined }],
    ['missing cooldownSeconds', { cooldownSeconds: undefined }],
    ['missing retryAfterMs', { retryAfterMs: undefined }],
    ['missing retryAfterSeconds', { retryAfterSeconds: undefined }],
    ['string cooldownMs', { cooldownMs: '300000' }],
    ['string cooldownSeconds', { cooldownSeconds: '300' }],
    ['string retryAfterMs', { retryAfterMs: '1501' }],
    ['string retryAfterSeconds', { retryAfterSeconds: '2' }],
    ['zero cooldownMs', { cooldownMs: 0 }],
    ['zero cooldownSeconds', { cooldownSeconds: 0 }],
    ['zero retryAfterMs', { retryAfterMs: 0 }],
    ['zero retryAfterSeconds', { retryAfterSeconds: 0 }],
    ['negative milliseconds', { retryAfterMs: -1 }],
    ['fractional milliseconds', { cooldownMs: 300000.5 }],
    ['NaN milliseconds', { retryAfterMs: Number.NaN }],
    ['infinite milliseconds', { cooldownMs: Number.POSITIVE_INFINITY }],
    ['non-number milliseconds', { retryAfterMs: true }],
    ['null milliseconds', { cooldownMs: null }],
    [
      'retry beyond the window',
      { retryAfterMs: 300001, retryAfterSeconds: 301 },
    ],
    ['incorrect cooldown rounding', { cooldownSeconds: 299 }],
    ['incorrect retry rounding', { retryAfterSeconds: 1 }],
  ] as [string, Record<string, unknown>][])(
    'omits all cooldown fields for an invalid tuple: %s',
    (_description, invalidFields) => {
      const { reply, response } = capture(
        new HttpException(
          {
            message: 'public message',
            code: 'SUBMISSION_COOLDOWN_ACTIVE',
            ...cooldownDetails,
            ...invalidFields,
            extra: 'private',
          },
          429,
        ),
      );
      expect(reply).toHaveBeenCalledWith(
        response,
        {
          statusCode: 429,
          timestamp: expect.any(String) as unknown,
          path: '/synthetic',
          message: 'public message',
          code: 'SUBMISSION_COOLDOWN_ACTIVE',
        },
        429,
      );
    },
  );

  const publicCodePairs: [number, string][] = [
    [400, 'RESET_TOKEN_INVALID'],
    [400, 'PASSWORD_POLICY_VIOLATION'],
    [403, 'LATE_SUBMISSION_NOT_ALLOWED'],
    [409, 'COURSE_NOT_EMPTY'],
    [409, 'CLASSROOM_NOT_EMPTY'],
    [409, 'CLASSROOM_TASK_NOT_EMPTY'],
    [409, 'PAGE_ACCOUNT_MISMATCH'],
    [429, 'SUBMISSION_COOLDOWN_ACTIVE'],
  ];
  const wrongStatusPairs = publicCodePairs.flatMap(([allowedStatus, code]) =>
    [400, 401, 403, 409, 429]
      .filter((status) => status !== allowedStatus)
      .map((status) => [status, code] as const),
  );

  it.each(wrongStatusPairs)(
    'does not project a public code or cooldown fields for wrong-status %s %s',
    (status, code) => {
      const { reply, response } = capture(
        new HttpException(
          {
            message: 'public message',
            code,
            ...cooldownDetails,
            reason: 'private',
          },
          status,
        ),
      );
      expect(reply).toHaveBeenCalledWith(
        response,
        {
          statusCode: status,
          timestamp: expect.any(String) as unknown,
          path: '/synthetic',
          message: 'public message',
        },
        status,
      );
    },
  );

  it.each([
    'SUBMISSION_REVISION_CONFLICT',
    'SUBMISSION_REVIEW_STARTED',
    'SUBMISSION_INVALID_STATE',
    'FEEDBACK_PAYLOAD_CONFLICT',
  ])('keeps internal conflict code %s and details private', (code) => {
    const { reply, response } = capture(
      new HttpException(
        {
          message: 'conflict message',
          code,
          reason: 'private',
          contentRevision: 2,
          expectedRevision: 1,
          reviewStartedAt: 'private',
        },
        409,
      ),
    );
    expect(reply).toHaveBeenCalledWith(
      response,
      {
        statusCode: 409,
        timestamp: expect.any(String) as unknown,
        path: '/synthetic',
        message: 'conflict message',
      },
      409,
    );
  });

  it('preserves the public duplicate teacher feedback edit message without a code', () => {
    const message =
      '该作品已有相同类型、严重程度和正文的教师反馈，请核对后修改本条反馈。';
    const { reply, response } = capture(new ConflictException(message));

    expect(reply).toHaveBeenCalledWith(
      response,
      {
        statusCode: 409,
        timestamp: expect.any(String) as unknown,
        path: '/synthetic',
        message,
      },
      409,
    );
  });

  it.each([
    new BadRequestException({
      message: 'validation message',
      code: 'INTERNAL_ONLY',
    }),
    new UnauthorizedException({
      message: 'Unauthorized',
      code: 'RESET_TOKEN_INVALID',
    }),
  ])('does not expose unapproved or wrong-status codes', (error) => {
    const { reply } = capture(error);
    expect(reply.mock.calls[0]?.[1]).not.toHaveProperty('code');
  });

  it('preserves existing validation messages', () => {
    const { reply } = capture(
      new BadRequestException({ message: ['first', 'second'] }),
    );
    expect(reply.mock.calls[0]?.[1]).toMatchObject({
      message: 'first; second',
    });
  });

  it('preserves string exception responses without inventing a code', () => {
    const { reply, response } = capture(
      new HttpException('plain message', 418),
    );
    expect(reply).toHaveBeenCalledWith(
      response,
      {
        statusCode: 418,
        timestamp: expect.any(String) as unknown,
        path: '/synthetic',
        message: 'plain message',
      },
      418,
    );
  });
});
