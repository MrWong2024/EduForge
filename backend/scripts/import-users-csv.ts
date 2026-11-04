export type CsvHeader =
  'email' | 'name' | 'roles' | 'status' | 'studentNo' | 'employeeNo';

export type CsvRecord = { cells: string[]; line: number };

export class CsvInputError extends Error {
  constructor(
    readonly code: string,
    readonly line?: number,
  ) {
    super(code);
    this.name = 'CsvInputError';
  }
}

type FieldState = 'start' | 'unquoted' | 'quoted' | 'closed';

export function parseCsv(content: string): CsvRecord[] {
  const input = content.replace(/^\uFEFF/, '');
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let state: FieldState = 'start';
  let line = 1;
  let recordLine = 1;

  const finishField = () => {
    cells.push(cell);
    cell = '';
    state = 'start';
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const newlineLength =
      char === '\r' && input[index + 1] === '\n'
        ? 2
        : char === '\r' || char === '\n'
          ? 1
          : 0;

    if (state === 'quoted') {
      if (char === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          state = 'closed';
        }
      } else if (newlineLength > 0) {
        cell += input.slice(index, index + newlineLength);
        index += newlineLength - 1;
        line += 1;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === ',') {
      finishField();
      continue;
    }
    if (newlineLength > 0) {
      finishField();
      records.push({ cells, line: recordLine });
      cells = [];
      line += 1;
      recordLine = line;
      index += newlineLength - 1;
      continue;
    }
    if (state === 'closed') {
      throw new CsvInputError('CSV_CHAR_AFTER_QUOTE', line);
    }
    if (char === '"') {
      if (state !== 'start') {
        throw new CsvInputError('CSV_UNEXPECTED_QUOTE', line);
      }
      state = 'quoted';
      continue;
    }
    cell += char;
    state = 'unquoted';
  }

  if (state === 'quoted') {
    throw new CsvInputError('CSV_UNCLOSED_QUOTE', line);
  }
  if (cells.length > 0 || state !== 'start') {
    finishField();
    records.push({ cells, line: recordLine });
  }
  if (records.length === 0) {
    throw new CsvInputError('CSV_NO_ROWS', 1);
  }
  return records;
}

export function buildHeaderKeys(header: string[]): Array<CsvHeader | null> {
  const aliases: Record<string, CsvHeader> = {
    email: 'email',
    name: 'name',
    roles: 'roles',
    status: 'status',
    studentno: 'studentNo',
    employeeno: 'employeeNo',
  };
  const seen = new Set<CsvHeader>();
  const keys = header.map((rawHeader): CsvHeader | null => {
    const normalized = rawHeader.trim().toLowerCase();
    const key = Object.hasOwn(aliases, normalized) ? aliases[normalized] : null;
    if (key !== null) {
      if (seen.has(key)) {
        throw new CsvInputError('CSV_DUPLICATE_HEADER', 1);
      }
      seen.add(key);
    }
    return key;
  });
  if (!seen.has('email')) {
    throw new CsvInputError('CSV_MISSING_EMAIL_HEADER', 1);
  }
  if (!seen.has('roles')) {
    throw new CsvInputError('CSV_MISSING_ROLES_HEADER', 1);
  }
  return keys;
}
