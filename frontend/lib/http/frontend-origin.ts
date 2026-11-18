/** Trusted server-side frontend origin; never derive this from request headers. */
export function getFrontendOrigin(value: string | undefined): string {
  if (value === undefined) {
    return "http://localhost:3000";
  }

  const invalid = () => new Error("FRONTEND_URL must be an HTTP(S) origin");
  if (
    !/^https?:\/\/[^/?#@\\\s]+\/?$/i.test(value) ||
    Array.from(value).some((character) => {
      const code = character.codePointAt(0)!;
      return code < 32 || code === 127;
    })
  ) {
    throw invalid();
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw invalid();
  }
  return url.origin;
}
