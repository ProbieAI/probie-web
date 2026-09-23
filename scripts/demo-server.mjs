import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.PORT || 4173);
const events = new Map();
const types = { ".html": "text/html", ".js": "text/javascript", ".svg": "image/svg+xml", ".css": "text/css" };
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  res.setHeader("Cache-Control", "no-store");
  if (pathname === "/api/widget/events" && req.method === "POST") {
    let body = "";
    try {
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1_000_000) { res.writeHead(413).end(); return; }
      }
      const data = JSON.parse(body);
      if (!Array.isArray(data.events)) { res.writeHead(400).end(); return; }
      for (const event of data.events) events.set(event.event_id, event);
      while (events.size > 200) events.delete(events.keys().next().value);
      res.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}');
    } catch { res.writeHead(400).end(); }
    return;
  }
  if (pathname === "/demo/events") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify([...events.values()]));
    return;
  }
  if (pathname === "/demo/failure") { res.writeHead(503).end("Example request failure"); return; }
  if (pathname === "/") { res.writeHead(302, { Location: "/examples/browser/" }).end(); return; }
  const path = resolve(root, "." + decodeURIComponent(pathname), pathname.endsWith("/") ? "index.html" : "");
  if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) { res.writeHead(403).end(); return; }
  try {
    const content = await readFile(path);
    res.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream" }).end(content);
  } catch { res.writeHead(404).end("Not found"); }
});
server.listen(port, "127.0.0.1", () => {
  console.log(`Probie SDK example: http://127.0.0.1:${port}/examples/browser/`);
  console.log("Events stay in this local process. Stop with Ctrl+C.");
});
