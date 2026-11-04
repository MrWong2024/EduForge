import { buildHeaderKeys, CsvInputError, parseCsv } from './import-users-csv';

function inputError(action: () => unknown): CsvInputError {
  try {
    action();
  } catch (error) {
    if (error instanceof CsvInputError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected CsvInputError');
}

describe('import-users CSV parsing', () => {
  it.each(['\n', '\r\n'])(
    'preserves quoted content and physical record lines with %j',
    (newline) => {
      const csv =
        `\uFEFFemail,roles,name${newline}` +
        `"first@example.test","student,teacher","First ""Quoted""${newline}Second"${newline}` +
        `${newline}second@example.test,user,Plain${newline}`;

      expect(parseCsv(csv)).toEqual([
        { cells: ['email', 'roles', 'name'], line: 1 },
        {
          cells: [
            'first@example.test',
            'student,teacher',
            `First "Quoted"${newline}Second`,
          ],
          line: 2,
        },
        { cells: [''], line: 4 },
        { cells: ['second@example.test', 'user', 'Plain'], line: 5 },
      ]);
    },
  );

  it.each(['\n', '\r\n'])(
    'reports the next record as physical line 4 after a quoted newline %j',
    (newline) => {
      const records = parseCsv(
        `email,roles,name${newline}` +
          `first@example.test,student,"First${newline}Second"${newline}` +
          'second@example.test,invalid-role,Name',
      );

      expect(records.map((record) => record.line)).toEqual([1, 2, 4]);
    },
  );

  it.each([',', ',""'])(
    'retains an empty final field at EOF for suffix %j',
    (suffix) => {
      expect(parseCsv(`first@example.test,student${suffix}`)).toEqual([
        { cells: ['first@example.test', 'student', ''], line: 1 },
      ]);
    },
  );

  it('preserves field whitespace for the caller to normalize', () => {
    expect(parseCsv(' first@example.test , student ," Name "')).toEqual([
      { cells: [' first@example.test ', ' student ', ' Name '], line: 1 },
    ]);
  });

  it('retains blank records without adding a record after the final newline', () => {
    expect(parseCsv('\n\r\n')).toEqual([
      { cells: [''], line: 1 },
      { cells: [''], line: 2 },
    ]);
  });

  it('retains an explicitly quoted empty record', () => {
    expect(parseCsv('""')).toEqual([{ cells: [''], line: 1 }]);
  });

  it('continues to accept standalone CR record endings', () => {
    expect(parseCsv('email,roles\rfirst@example.test,student')).toEqual([
      { cells: ['email', 'roles'], line: 1 },
      { cells: ['first@example.test', 'student'], line: 2 },
    ]);
  });

  it.each([
    {
      name: 'a quote inside an unquoted email',
      content: 'email,roles\nfi"rst"@example.test,student',
      code: 'CSV_UNEXPECTED_QUOTE',
      line: 2,
    },
    {
      name: 'a quote inside an unquoted role',
      content: 'email,roles\nfirst@example.test,stu"dent"',
      code: 'CSV_UNEXPECTED_QUOTE',
      line: 2,
    },
    {
      name: 'a quote after leading field whitespace',
      content: 'email,roles\n "first@example.test",student',
      code: 'CSV_UNEXPECTED_QUOTE',
      line: 2,
    },
    {
      name: 'text after a closed quoted field',
      content: 'email,roles\n"first@example.test"x,student',
      code: 'CSV_CHAR_AFTER_QUOTE',
      line: 2,
    },
    {
      name: 'whitespace after a closed quoted field',
      content: 'email,roles\n"first@example.test" ,student',
      code: 'CSV_CHAR_AFTER_QUOTE',
      line: 2,
    },
    {
      name: 'a closing quote followed by text on a later physical line',
      content: 'email,roles,name\r\nfirst@example.test,student,"One\r\nTwo"x',
      code: 'CSV_CHAR_AFTER_QUOTE',
      line: 3,
    },
    {
      name: 'an unclosed quoted field',
      content: 'email,roles\n"first@example.test,student',
      code: 'CSV_UNCLOSED_QUOTE',
      line: 2,
    },
    {
      name: 'an unclosed multiline quoted field',
      content: 'email,roles,name\r\nfirst@example.test,student,"One\r\nTwo',
      code: 'CSV_UNCLOSED_QUOTE',
      line: 3,
    },
  ])('rejects $name with a safe code and physical line', (testCase) => {
    const error = inputError(() => parseCsv(testCase.content));

    expect(error).toMatchObject({
      code: testCase.code,
      message: testCase.code,
      line: testCase.line,
    });
  });

  it.each(['', '\uFEFF'])('rejects empty input %j', (content) => {
    expect(inputError(() => parseCsv(content))).toMatchObject({
      code: 'CSV_NO_ROWS',
      message: 'CSV_NO_ROWS',
      line: 1,
    });
  });
});

describe('import-users CSV headers', () => {
  it('maps all six supported headers case-insensitively after trimming', () => {
    expect(
      buildHeaderKeys([
        ' EMAIL ',
        'Name',
        'Roles',
        'STATUS',
        'studentNO',
        'EmployeeNo',
      ]),
    ).toEqual(['email', 'name', 'roles', 'status', 'studentNo', 'employeeNo']);
  });

  it('ignores unknown, blank, duplicate unknown, and inherited property names', () => {
    expect(
      buildHeaderKeys([
        'email',
        'roles',
        'extra',
        '',
        'extra',
        '__proto__',
        'constructor',
        'toString',
      ]),
    ).toEqual(['email', 'roles', null, null, null, null, null, null]);
  });

  it.each([
    { headers: ['email', 'roles', ' EMAIL '] },
    { headers: ['email', 'roles', 'studentNo', 'STUDENTNO'] },
  ])('rejects duplicate recognized headers $headers', ({ headers }) => {
    expect(inputError(() => buildHeaderKeys(headers))).toMatchObject({
      code: 'CSV_DUPLICATE_HEADER',
      message: 'CSV_DUPLICATE_HEADER',
      line: 1,
    });
  });

  it.each([
    { headers: ['roles', '__proto__'], code: 'CSV_MISSING_EMAIL_HEADER' },
    { headers: ['email', 'constructor'], code: 'CSV_MISSING_ROLES_HEADER' },
  ])('requires known headers with $code', ({ headers, code }) => {
    expect(inputError(() => buildHeaderKeys(headers))).toMatchObject({
      code,
      message: code,
      line: 1,
    });
  });
});
