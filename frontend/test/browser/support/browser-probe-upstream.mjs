import { createServer } from "node:http";

const port = Number(process.env.EDUFORGE_BROWSER_UPSTREAM_PORT ?? "5100");
if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3000 || port === 5000) {
  throw new Error("Probe upstream requires a dedicated port (excluding 3000/5000)");
}

const server = createServer(
  { requestTimeout: 5_000, headersTimeout: 5_000, keepAliveTimeout: 1_000 },
  (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    response.setHeader("content-type", "application/json");
    response.setHeader("cache-control", "no-store");

    if (request.method === "GET" && url.pathname === "/health") {
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/__browser_probe__/cookie/set") {
      const value = url.searchParams.get("value") ?? "";
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(value)) {
        response.statusCode = 400;
        response.end(JSON.stringify({ error: "Invalid probe value" }));
        return;
      }
      response.setHeader(
        "set-cookie",
        `eduforge_browser_probe=${value}; Path=/; HttpOnly; SameSite=Lax`,
      );
      response.end(JSON.stringify({ status: "set" }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/__browser_probe__/cookie/echo") {
      response.end(JSON.stringify({ cookie: request.headers.cookie ?? "" }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "Not found" }));
  },
);

server.setTimeout(5_000);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    server.close();
    server.closeAllConnections();
  });
}
server.listen(port, "127.0.0.1", () => {
  console.log(`Browser probe listening on http://127.0.0.1:${port}; pid=${process.pid}`);
});
