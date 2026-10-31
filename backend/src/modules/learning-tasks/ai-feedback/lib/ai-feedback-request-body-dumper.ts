import type { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import type {
  AiFeedbackCompactionDiagnostic,
  AiFeedbackDiagnosticHandle,
  AiFeedbackResponseDiagnostic,
} from '../interfaces/ai-feedback-provider.interface';

// Source: backend/src/modules/learning-tasks/ai-feedback/lib; normal build:
// backend/dist/src/modules/learning-tasks/ai-feedback/lib. Never use cwd.
export function aiFeedbackRequestDirectory(
  moduleDirectory = __dirname,
): string {
  const backendOrDist = resolve(moduleDirectory, '../../../../..');
  return resolve(
    backendOrDist,
    basename(backendOrDist) === 'dist' ? '../..' : '..',
    '.local/deliverables/ai-feedback-requests',
  );
}

export class AiFeedbackRequestBodyDumper {
  constructor(
    private readonly logger: Pick<Logger, 'log' | 'warn'>,
    // A narrow test seam, not a runtime path configuration.
    private readonly directory = aiFeedbackRequestDirectory(),
  ) {}

  createHandle(submissionId: string): AiFeedbackDiagnosticHandle {
    const safeId = submissionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
    const createdAt = new Date().toISOString();
    const timestamp = createdAt.replace(/[:.]/g, '-');
    const traceId = `submission-${safeId}-${timestamp}-${randomUUID()}`;
    const handle: AiFeedbackDiagnosticHandle = {
      traceId,
      submissionId: safeId,
      requestFileName: `${traceId}.json`,
      createdAt,
      requestSaved: false,
      saveCompaction: (record) => this.saveCompaction(handle, record),
    };
    return handle;
  }

  async save(
    submission: string | AiFeedbackDiagnosticHandle,
    body: string,
  ): Promise<void> {
    try {
      const handle =
        typeof submission === 'string'
          ? this.createHandle(submission)
          : submission;
      handle.requestSaved = await this.write(
        resolve(this.directory, handle.requestFileName),
        body,
        'request body',
        handle.submissionId,
      );
    } catch {
      this.warn(
        'request body',
        typeof submission === 'string'
          ? submission.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)
          : submission.submissionId,
      );
    }
  }

  async saveResponse(
    handle: AiFeedbackDiagnosticHandle,
    record: AiFeedbackResponseDiagnostic,
  ): Promise<void> {
    await this.saveDiagnostic(handle, 'response', record);
  }

  async saveCompaction(
    handle: AiFeedbackDiagnosticHandle,
    record: AiFeedbackCompactionDiagnostic,
  ): Promise<void> {
    await this.saveDiagnostic(handle, 'compaction', record);
  }

  private async saveDiagnostic(
    handle: AiFeedbackDiagnosticHandle,
    kind: 'response' | 'compaction',
    record: AiFeedbackResponseDiagnostic | AiFeedbackCompactionDiagnostic,
  ): Promise<void> {
    try {
      const body = JSON.stringify({
        ...record,
        ...(kind === 'compaction'
          ? { resultMeaning: 'pre_persistence_candidates' }
          : {}),
        traceId: handle.traceId,
        submissionId: handle.submissionId,
        requestFileName: handle.requestFileName,
        requestSaved: handle.requestSaved,
        createdAt: handle.createdAt,
        recordedAt: new Date().toISOString(),
      });
      await this.write(
        resolve(
          this.directory,
          'diagnostics',
          `${handle.traceId}.${kind}.json`,
        ),
        body,
        `${kind} diagnostics`,
        handle.submissionId,
      );
    } catch {
      this.warn(`${kind} diagnostics`, handle.submissionId);
    }
  }

  private async write(
    file: string,
    body: string,
    kind: string,
    submissionId: string,
  ): Promise<boolean> {
    try {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, body, { encoding: 'utf8', flag: 'wx' });
    } catch {
      this.warn(kind, submissionId);
      return false;
    }
    try {
      this.logger.log(
        `AI feedback ${kind} saved: submissionId=${submissionId}, path=${file}`,
      );
    } catch {
      // Even logging failure must not change the request's saved status.
    }
    return true;
  }

  private warn(kind: string, submissionId: string): void {
    try {
      this.logger.warn(
        `AI feedback ${kind} retention failed: submissionId=${submissionId}`,
      );
    } catch {
      // Never replace the business result with a diagnostic/logging failure.
    }
  }
}
