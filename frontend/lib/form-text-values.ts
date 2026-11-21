export const toSingleLineInputValue = (value: string): string =>
  value.replace(/[\r\n]/g, "");

export const toMultilineInputValue = (value: string): string =>
  value.replace(/\r\n?/g, "\n");
