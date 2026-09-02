import { test, expect } from "@playwright/test";

const probeRoute = "/api/proxy/__browser_probe__/cookie";
const probeCookie = "eduforge_browser_probe";

test("roundtrips an HttpOnly cookie through the real BFF in one context", async ({
  context,
  page,
}) => {
  await page.goto(`${probeRoute}/set?value=context-a`);

  expect(await context.cookies()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: probeCookie,
        value: "context-a",
        httpOnly: true,
      }),
    ]),
  );
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    `${probeCookie}=`,
  );

  const echo = await page.goto(`${probeRoute}/echo`);
  expect(await echo?.json()).toEqual({
    cookie: `${probeCookie}=context-a`,
  });
});

test("isolates cookie and storage state between independent contexts", async ({
  browser,
  page: pageA,
  baseURL,
}) => {
  const contextB = await browser.newContext({ baseURL });
  try {
    const pageB = await contextB.newPage();
    await pageA.goto(`${probeRoute}/set?value=context-a`);
    await pageA.evaluate(() => {
      localStorage.setItem("eduforge_browser_probe", "context-a");
      sessionStorage.setItem("eduforge_browser_probe", "context-a");
    });

    const emptyEcho = await pageB.goto(`${probeRoute}/echo`);
    expect(await emptyEcho?.json()).toEqual({ cookie: "" });
    expect(
      await pageB.evaluate(() => ({
        local: localStorage.getItem("eduforge_browser_probe"),
        session: sessionStorage.getItem("eduforge_browser_probe"),
      })),
    ).toEqual({ local: null, session: null });

    await pageB.goto(`${probeRoute}/set?value=context-b`);
    await pageB.evaluate(() => {
      localStorage.setItem("eduforge_browser_probe", "context-b");
      sessionStorage.setItem("eduforge_browser_probe", "context-b");
    });

    const echoA = await pageA.goto(`${probeRoute}/echo`);
    const echoB = await pageB.goto(`${probeRoute}/echo`);
    expect(await echoA?.json()).toEqual({ cookie: `${probeCookie}=context-a` });
    expect(await echoB?.json()).toEqual({ cookie: `${probeCookie}=context-b` });
    expect(
      await pageA.evaluate(() => ({
        local: localStorage.getItem("eduforge_browser_probe"),
        session: sessionStorage.getItem("eduforge_browser_probe"),
      })),
    ).toEqual({ local: "context-a", session: "context-a" });
    expect(
      await pageB.evaluate(() => ({
        local: localStorage.getItem("eduforge_browser_probe"),
        session: sessionStorage.getItem("eduforge_browser_probe"),
      })),
    ).toEqual({ local: "context-b", session: "context-b" });
  } finally {
    await contextB.close();
  }
});
