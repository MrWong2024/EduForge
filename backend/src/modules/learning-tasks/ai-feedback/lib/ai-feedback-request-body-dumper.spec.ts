import fs from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import type {
  AiFeedbackCompactionDiagnostic,
  AiFeedbackResponseDiagnostic,
} from '../interfaces/ai-feedback-provider.interface';
import {
  AiFeedbackRequestBodyDumper,
  aiFeedbackRequestDirectory,
} from './ai-feedback-request-body-dumper';

const project = resolve(__dirname, '../../../../../..');
const temporaryParent = resolve(project, '.local/deliverables');

describe('AI request body files (synthetic local files only)', () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    await fs.mkdir(temporaryParent, { recursive: true });
    temporaryDirectory = await fs.mkdtemp(
      resolve(temporaryParent, '.tmp-ai-request-tests-'),
    );
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (
      dirname(temporaryDirectory) !== temporaryParent ||
      !basename(temporaryDirectory).startsWith('.tmp-ai-request-tests-')
    ) {
      throw new Error('Refusing cleanup outside the owned temporary directory');
    }
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('locates the same fixed directory from src and dist without consulting cwd', () => {
    jest.spyOn(process, 'cwd').mockReturnValue(temporaryDirectory);
    const expected = resolve(
      project,
      '.local/deliverables/ai-feedback-requests',
    );
    expect(aiFeedbackRequestDirectory()).toBe(expected);
    expect(
      aiFeedbackRequestDirectory(
        resolve(
          project,
          'backend/dist/src/modules/learning-tasks/ai-feedback/lib',
        ),
      ),
    ).toBe(expected);
  });

  it('keeps exact UTF-8 bytes and never overwrites concurrent or repeated submissions', async () => {
    const logger = {
      log: jest.fn<void, [string]>(),
      warn: jest.fn<void, [string]>(),
    };
    const directory = resolve(temporaryDirectory, 'requests');
    const dumper = new AiFeedbackRequestBodyDumper(logger, directory);
    const body = JSON.stringify({
      messages: [{ content: '合成材料\n  缩进' }],
    });
    const submissionId = '../unsafe:id\\with\ncharacters';

    await Promise.all([
      dumper.save(submissionId, body),
      dumper.save(submissionId, body),
    ]);
    await dumper.save(submissionId, body);

    const files = await fs.readdir(directory);
    expect(files).toHaveLength(3);
    expect(new Set(files).size).toBe(3);
    for (const name of files) {
      expect(name).toMatch(/^submission-.+-\d{4}-\d{2}-\d{2}T.+\.json$/);
      expect(name).not.toMatch(/[<>:"/\\|?*]/);
      expect([...name].some((character) => character.charCodeAt(0) < 32)).toBe(
        false,
      );
      expect(await fs.readFile(resolve(directory, name))).toEqual(
        Buffer.from(body, 'utf8'),
      );
    }
    expect(logger.log).toHaveBeenCalledTimes(3);
    expect(logger.warn).not.toHaveBeenCalled();
    for (const [message] of logger.log.mock.calls) {
      expect(message).not.toContain(body);
    }
  });

  it('warns safely and returns when writing fails', async () => {
    const logger = {
      log: jest.fn<void, [string]>(),
      warn: jest.fn<void, [string]>(),
    };
    const blocked = resolve(temporaryDirectory, 'not-a-directory');
    await fs.writeFile(blocked, 'owned sentinel');
    const dumper = new AiFeedbackRequestBodyDumper(logger, blocked);

    await expect(
      dumper.save('submission-1', 'private synthetic body'),
    ).resolves.toBeUndefined();

    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'AI feedback request body retention failed: submissionId=submission-1',
    );
    expect(await fs.readFile(blocked, 'utf8')).toBe('owned sentinel');
  });

  it('links three exclusive files without wrapping or replacing the request', async () => {
    const logger = { log: jest.fn(), warn: jest.fn() };
    const directory = resolve(temporaryDirectory, 'requests');
    const dumper = new AiFeedbackRequestBodyDumper(logger, directory);
    const handle = dumper.createHandle('synthetic-submission');
    const body = '{"messages":[{"content":"合成请求\\n  原文"}]}';
    const response: AiFeedbackResponseDiagnostic = {
      httpStatus: 200,
      rawResponseBody: ' {\n  "text": "合成响应\\n\\"原文\\""\n}\n',
      validatedItemsBeforeNormalize: [],
      normalizedItemsBeforeCap: [],
      providerItemsAfterCap: [],
      reachedStage: 'provider_capped',
      failureCode: null,
    };
    const compaction: AiFeedbackCompactionDiagnostic = {
      jobId: 'synthetic-job',
      claimNo: 2,
      compactionReached: true,
      compactorInput: [],
      compactorOutput: [],
      reason: null,
    };
    await dumper.save(handle, body);
    await dumper.saveResponse(handle, response);
    await handle.saveCompaction(compaction);
    await dumper.saveResponse(handle, {
      ...response,
      rawResponseBody: 'must not replace the original',
    });
    await handle.saveCompaction({ ...compaction, claimNo: 99 });

    expect(
      await fs.readFile(resolve(directory, handle.requestFileName)),
    ).toEqual(Buffer.from(body, 'utf8'));
    const responseFile = resolve(
      directory,
      'diagnostics',
      `${handle.traceId}.response.json`,
    );
    const compactionFile = resolve(
      directory,
      'diagnostics',
      `${handle.traceId}.compaction.json`,
    );
    const savedResponse = JSON.parse(
      await fs.readFile(responseFile, 'utf8'),
    ) as Record<string, unknown>;
    const savedCompaction = JSON.parse(
      await fs.readFile(compactionFile, 'utf8'),
    ) as Record<string, unknown>;
    expect(savedResponse).toMatchObject(response);
    expect(savedResponse.rawResponseBody).toBe(response.rawResponseBody);
    expect(savedCompaction).toMatchObject({
      ...compaction,
      resultMeaning: 'pre_persistence_candidates',
    });
    for (const record of [savedResponse, savedCompaction]) {
      expect(record).toMatchObject({
        traceId: handle.traceId,
        submissionId: 'synthetic-submission',
        requestFileName: handle.requestFileName,
        createdAt: handle.createdAt,
        requestSaved: true,
      });
    }
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(logger.log.mock.calls)).not.toContain('合成');
  });

  it('keeps the handle and writes response diagnostics after the request file fails', async () => {
    const logger = { log: jest.fn(), warn: jest.fn() };
    const directory = resolve(temporaryDirectory, 'requests');
    const dumper = new AiFeedbackRequestBodyDumper(logger, directory);
    const handle = dumper.createHandle('synthetic-submission');
    await fs.mkdir(directory);
    const requestFile = resolve(directory, handle.requestFileName);
    await fs.writeFile(requestFile, 'owned existing sentinel', { flag: 'wx' });

    await dumper.save(handle, 'must not overwrite');
    await dumper.saveResponse(handle, {
      httpStatus: null,
      rawResponseBody: null,
      validatedItemsBeforeNormalize: null,
      normalizedItemsBeforeCap: null,
      providerItemsAfterCap: null,
      reachedStage: 'request_ready',
      failureCode: 'TIMEOUT',
    });

    expect(await fs.readFile(requestFile, 'utf8')).toBe(
      'owned existing sentinel',
    );
    const saved = JSON.parse(
      await fs.readFile(
        resolve(directory, 'diagnostics', `${handle.traceId}.response.json`),
        'utf8',
      ),
    ) as Record<string, unknown>;
    expect(saved).toMatchObject({
      traceId: handle.traceId,
      requestFileName: handle.requestFileName,
      requestSaved: false,
      rawResponseBody: null,
      validatedItemsBeforeNormalize: null,
    });
  });

  it('isolates diagnostic serialization and warning failures', async () => {
    const logger = {
      log: jest.fn(),
      warn: jest.fn(() => {
        throw new Error('synthetic warning failure');
      }),
    };
    const directory = resolve(temporaryDirectory, 'requests');
    const dumper = new AiFeedbackRequestBodyDumper(logger, directory);
    const handle = dumper.createHandle('synthetic-submission');
    jest.spyOn(JSON, 'stringify').mockImplementationOnce(() => {
      throw new Error('synthetic serialization failure');
    });
    await expect(
      handle.saveCompaction({
        jobId: 'synthetic-job',
        claimNo: 1,
        compactionReached: false,
        compactorInput: null,
        compactorOutput: null,
        reason: 'PROVIDER_NOT_COMPLETED',
      }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'AI feedback compaction diagnostics retention failed: submissionId=synthetic-submission',
    );
    expect(await fs.readdir(temporaryDirectory)).toEqual([]);
  });
});
