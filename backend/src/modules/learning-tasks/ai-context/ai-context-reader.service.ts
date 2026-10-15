import { BadRequestException, Injectable } from '@nestjs/common';
import { realpath, stat } from 'node:fs/promises';
import {
  basename,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import { crc32 } from 'node:zlib';
import * as yauzl from 'yauzl';
import {
  AI_CONTEXT_LIMITS as limits,
  AiContextError,
} from './ai-context.types';
import type { AiContextFile, AiContextRef } from './ai-context.types';

const TEXT_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.diff',
  '.patch',
  '.c',
  '.h',
  '.cc',
  '.hh',
  '.cpp',
  '.hpp',
  '.cxx',
  '.hxx',
  '.java',
  '.py',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
]);

// Source: backend/src/modules/learning-tasks/ai-context; normal build:
// backend/dist/src/modules/learning-tasks/ai-context. Never use process.cwd().
export function aiContextResourceRoot(moduleDirectory = __dirname): string {
  const backendOrDist = resolve(moduleDirectory, '../../../..');
  return resolve(
    backendOrDist,
    basename(backendOrDist) === 'dist' ? '../..' : '..',
    '.local',
  );
}

function canonicalPath(path: string): boolean {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    path.length <= limits.pathChars &&
    !/[\\\0:]/u.test(path) &&
    !isAbsolute(path) &&
    path
      .split('/')
      .every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  );
}

function contained(root: string, target: string): boolean {
  const path = relative(root, target);
  return (
    path !== '' &&
    !isAbsolute(path) &&
    path !== '..' &&
    !path.startsWith('..' + sep)
  );
}

@Injectable()
export class AiContextReaderService {
  // A narrow instance seam for synthetic test directories; no runtime config.
  private readonly resourceRoot = aiContextResourceRoot();

  async validateForSave(references?: AiContextRef[]): Promise<void> {
    try {
      await this.read(references);
    } catch (error) {
      if (error instanceof AiContextError)
        throw new BadRequestException(error.message);
      throw new BadRequestException('资料配置：资料不可读取');
    }
  }

  async read(references?: AiContextRef[]): Promise<AiContextFile[]> {
    if (references === undefined) return [];
    this.validateReferences(references);
    if (references.length === 0) return [];
    const files: AiContextFile[] = [];
    const budget = { bytes: 0 };
    for (const [index, reference] of references.entries()) {
      const referenceNo = index + 1;
      try {
        files.push(...(await this.readArchive(reference, referenceNo, budget)));
      } catch (error) {
        if (error instanceof AiContextError) throw error;
        throw new AiContextError(
          'AI_CONTEXT_UNAVAILABLE',
          '资料缺失、损坏或不可读取',
          referenceNo,
        );
      }
    }
    return files;
  }

  private validateReferences(references: AiContextRef[]): void {
    const unavailable = (
      reason: string,
      ref?: number,
      entry?: number,
    ): never => {
      throw new AiContextError('AI_CONTEXT_UNAVAILABLE', reason, ref, entry);
    };
    const exceeded = (reason: string): never => {
      throw new AiContextError('AI_CONTEXT_LIMIT_EXCEEDED', reason);
    };
    if (!Array.isArray(references)) unavailable('必须为引用数组');
    if (references.length > limits.archives) exceeded('ZIP 数量超限');
    const archives = new Set<string>();
    let count = 0;
    for (const [index, ref] of references.entries()) {
      const number = index + 1;
      if (
        !ref ||
        !canonicalPath(ref.archivePath) ||
        !ref.archivePath.includes('/') ||
        extname(ref.archivePath).toLowerCase() !== '.zip'
      )
        unavailable('ZIP 路径不规范', number);
      if (archives.has(ref.archivePath)) unavailable('重复 ZIP 引用', number);
      archives.add(ref.archivePath);
      if (!Array.isArray(ref.entryPaths) || ref.entryPaths.length === 0)
        unavailable('必须选择文件', number);
      count += ref.entryPaths.length;
      if (count > limits.files) exceeded('选中文件总数超限');
      const entries = new Set<string>();
      for (const [entryIndex, entry] of ref.entryPaths.entries()) {
        if (!canonicalPath(entry))
          unavailable('条目路径不规范', number, entryIndex + 1);
        if (entries.has(entry)) unavailable('重复条目', number, entryIndex + 1);
        entries.add(entry);
        if (!TEXT_EXTENSIONS.has(extname(entry).toLowerCase()))
          unavailable('不支持的文本格式', number, entryIndex + 1);
      }
    }
  }

  private async readArchive(
    ref: AiContextRef,
    referenceNo: number,
    budget: { bytes: number },
  ): Promise<AiContextFile[]> {
    const root = await realpath(this.resourceRoot);
    const archive = await realpath(resolve(root, ref.archivePath));
    if (!contained(root, archive))
      throw new AiContextError(
        'AI_CONTEXT_UNAVAILABLE',
        'ZIP 路径越界',
        referenceNo,
      );
    const info = await stat(archive);
    if (!info.isFile())
      throw new AiContextError(
        'AI_CONTEXT_UNAVAILABLE',
        'ZIP 必须是普通文件',
        referenceNo,
      );
    if (info.size > limits.archiveBytes)
      throw new AiContextError(
        'AI_CONTEXT_LIMIT_EXCEEDED',
        'ZIP 文件大小超限',
        referenceNo,
      );
    const zip = await yauzl.openPromise(archive, {
      autoClose: false,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    // Keep error listeners until close, including errors from aborted streams.
    let zipError: Error | undefined;
    zip.on('error', (error: Error) => {
      zipError = error;
    });
    const closed = new Promise<void>((resolveClose) =>
      zip.once('close', resolveClose),
    );
    let entryNo: number | undefined;
    try {
      if (
        zip.fileSize > limits.archiveBytes ||
        zip.entryCount > limits.scannedEntries
      )
        throw new AiContextError(
          'AI_CONTEXT_LIMIT_EXCEEDED',
          'ZIP 大小或条目数超限',
          referenceNo,
        );
      const selected = new Set(ref.entryPaths);
      const found = new Map<string, yauzl.Entry>();
      let scanned = 0;
      for await (const entry of zip.eachEntry()) {
        if (++scanned > limits.scannedEntries)
          throw new AiContextError(
            'AI_CONTEXT_LIMIT_EXCEEDED',
            'ZIP 条目数超限',
            referenceNo,
          );
        if (!selected.has(entry.fileName)) continue;
        entryNo = ref.entryPaths.indexOf(entry.fileName) + 1;
        if (found.has(entry.fileName))
          throw new AiContextError(
            'AI_CONTEXT_UNAVAILABLE',
            '选中名称存在多个条目',
            referenceNo,
            entryNo,
          );
        const kind = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (
          entry.fileName.endsWith('/') ||
          (kind !== 0 && kind !== 0x8000) ||
          (entry.externalFileAttributes & 0x10) !== 0 ||
          entry.isEncrypted() ||
          ![0, 8].includes(entry.compressionMethod)
        )
          throw new AiContextError(
            'AI_CONTEXT_UNAVAILABLE',
            '条目不是可读取的普通文本文件',
            referenceNo,
            entryNo,
          );
        if (entry.uncompressedSize > limits.fileBytes)
          throw new AiContextError(
            'AI_CONTEXT_LIMIT_EXCEEDED',
            '声明文件大小超限',
            referenceNo,
            entryNo,
          );
        found.set(entry.fileName, entry);
      }
      const declaredTotal = [...found.values()].reduce(
        (sum, entry) => sum + entry.uncompressedSize,
        0,
      );
      if (budget.bytes + declaredTotal > limits.totalBytes)
        throw new AiContextError(
          'AI_CONTEXT_LIMIT_EXCEEDED',
          '声明资料总大小超限',
          referenceNo,
        );
      const files: AiContextFile[] = [];
      for (const [index, entryPath] of ref.entryPaths.entries()) {
        entryNo = index + 1;
        const entry = found.get(entryPath);
        if (!entry)
          throw new AiContextError(
            'AI_CONTEXT_UNAVAILABLE',
            '指定条目不存在',
            referenceNo,
            entryNo,
          );
        const stream = await zip.openReadStreamPromise(entry);
        const chunks: Buffer[] = [];
        let bytes = 0;
        let checksum = 0;
        try {
          for await (const chunk of stream) {
            const buffer: Buffer = Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk as Uint8Array);
            bytes += buffer.length;
            budget.bytes += buffer.length;
            if (bytes > limits.fileBytes || budget.bytes > limits.totalBytes)
              throw new AiContextError(
                'AI_CONTEXT_LIMIT_EXCEEDED',
                '实际解压内容大小超限',
                referenceNo,
                entryNo,
              );
            checksum = crc32(buffer, checksum);
            chunks.push(buffer);
          }
        } finally {
          stream.destroy();
        }
        if (
          bytes !== entry.uncompressedSize ||
          checksum !== entry.crc32 ||
          zipError
        )
          throw new Error('Invalid ZIP content');
        const text = new TextDecoder('utf-8', { fatal: true }).decode(
          Buffer.concat(chunks),
        );
        if (text.includes('\0')) throw new Error('Invalid text');
        files.push({ referenceNo, entryPath, text });
      }
      return files;
    } catch (error) {
      if (error instanceof AiContextError) throw error;
      throw new AiContextError(
        'AI_CONTEXT_UNAVAILABLE',
        '资料缺失、损坏、不支持或不可读取',
        referenceNo,
        entryNo,
      );
    } finally {
      zip.close();
      await closed;
    }
  }
}
