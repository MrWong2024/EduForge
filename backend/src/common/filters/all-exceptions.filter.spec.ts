import {
  BadRequestException,
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
});
