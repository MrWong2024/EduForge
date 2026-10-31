import type { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

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

  async save(submissionId: string, body: string): Promise<void> {
    const safeId = submissionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = resolve(
      this.directory,
      `submission-${safeId}-${timestamp}-${randomUUID()}.json`,
    );
    try {
      await mkdir(this.directory, { recursive: true });
      await writeFile(file, body, { encoding: 'utf8', flag: 'wx' });
      this.logger.log(
        `AI feedback request body saved: submissionId=${safeId}, path=${file}`,
      );
    } catch {
      // Errors and payloads can contain sensitive data. Retention must not
      // change the existing upstream request or its retry behavior.
      this.logger.warn(
        `AI feedback request body retention failed: submissionId=${safeId}`,
      );
    }
  }
}
