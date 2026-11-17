import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

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

    if (status < 500 && exception instanceof HttpException) {
      const responseBody = exception.getResponse();
      if (typeof responseBody === 'string') {
        message = responseBody;
      } else if (responseBody && typeof responseBody === 'object') {
        const maybeMessage = (responseBody as { message?: unknown }).message;
        if (typeof maybeMessage === 'string') {
          message = maybeMessage;
        } else if (Array.isArray(maybeMessage)) {
          message = maybeMessage.filter(Boolean).join('; ');
        }
        const candidate = (responseBody as { code?: unknown }).code;
        if (
          status === 400 &&
          (candidate === 'RESET_TOKEN_INVALID' ||
            candidate === 'PASSWORD_POLICY_VIOLATION')
        ) {
          code = candidate;
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
      },
      status,
    );
  }
}
