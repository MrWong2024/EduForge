export type AiContextRef = {
  archivePath: string;
  entryPaths: string[];
};

export type AiContextFile = {
  referenceNo: number;
  entryPath: string;
  text: string;
};

export const AI_CONTEXT_LIMITS = {
  archives: 8,
  files: 32,
  archiveBytes: 32 * 1024 * 1024,
  scannedEntries: 4096,
  fileBytes: 64 * 1024,
  totalBytes: 256 * 1024,
  pathChars: 1024,
} as const;

export class AiContextError extends Error {
  constructor(
    readonly code: 'AI_CONTEXT_UNAVAILABLE' | 'AI_CONTEXT_LIMIT_EXCEEDED',
    reason: string,
    readonly referenceNo?: number,
    readonly entryNo?: number,
  ) {
    super(
      `${referenceNo === undefined ? '资料配置' : `资料引用 ${referenceNo}`}${entryNo === undefined ? '' : `，条目 ${entryNo}`}：${reason}`,
    );
    this.name = 'AiContextError';
  }
}
