import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

type SubmissionCooldownDetails = {
  cooldownMs: number;
  cooldownSeconds: number;
  retryAfterMs: number;
  retryAfterSeconds: number;
};

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const { httpAdapter } = this.httpAdapterHost;
    const response = ctx.getResponse<Record<string, unknown>>();
    const request = ctx.getRequest<Record<string, unknown>>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = 'Internal server error';
    let code: string | undefined;
    let cooldownDetails: SubmissionCooldownDetails | undefined;

    if (status < 500 && exception instanceof HttpException) {
      const responseBody = exception.getResponse();
      if (typeof responseBody === 'string') {
        message = responseBody;
      } else if (responseBody && typeof responseBody === 'object') {
        const body = responseBody as Record<string, unknown>;
        const maybeMessage = body.message;
        if (typeof maybeMessage === 'string') {
          message = maybeMessage;
        } else if (Array.isArray(maybeMessage)) {
          message = maybeMessage.filter(Boolean).join('; ');
        }
        const candidate = body.code;
        if (
          (status === 400 &&
            (candidate === 'RESET_TOKEN_INVALID' ||
              candidate === 'PASSWORD_POLICY_VIOLATION')) ||
          (status === 403 && candidate === 'LATE_SUBMISSION_NOT_ALLOWED') ||
          (status === 409 &&
            (candidate === 'COURSE_NOT_EMPTY' ||
              candidate === 'CLASSROOM_NOT_EMPTY' ||
              candidate === 'CLASSROOM_TASK_NOT_EMPTY' ||
              candidate === 'PAGE_ACCOUNT_MISMATCH' ||
              candidate === 'TEACHER_FEEDBACK_TEXT_CONFLICT')) ||
          (status === 429 && candidate === 'SUBMISSION_COOLDOWN_ACTIVE')
        ) {
          code = candidate;
        }
        if (code === 'SUBMISSION_COOLDOWN_ACTIVE') {
          const {
            cooldownMs,
            cooldownSeconds,
            retryAfterMs,
            retryAfterSeconds,
          } = body;
          if (
            isPositiveInteger(cooldownMs) &&
            isPositiveInteger(cooldownSeconds) &&
            isPositiveInteger(retryAfterMs) &&
            isPositiveInteger(retryAfterSeconds) &&
            retryAfterMs <= cooldownMs &&
            cooldownSeconds === Math.ceil(cooldownMs / 1000) &&
            retryAfterSeconds === Math.ceil(retryAfterMs / 1000)
          ) {
            cooldownDetails = {
              cooldownMs,
              cooldownSeconds,
              retryAfterMs,
              retryAfterSeconds,
            };
          }
        }
      }
    }

    const path = String(httpAdapter.getRequestUrl(request));

    httpAdapter.reply(
      response,
      {
        statusCode: status,
        timestamp: new Date().toISOString(),
        path,
        message,
        ...(code === undefined ? {} : { code }),
        ...cooldownDetails,
      },
      status,
    );
  }
}
