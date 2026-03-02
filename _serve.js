import { join } from "node:path";
const dir = join(import.meta.dir, "_site");
Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    let p = join(dir, url.pathname);
    if (p.endsWith("/")) p = join(p, "index.html");
    const f = Bun.file(p);
    if (await f.exists()) return new Response(f);
    return new Response("Not found", { status: 404 });
  },
});
console.log("Serving _site on http://localhost:8080");
