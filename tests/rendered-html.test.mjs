import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the complete anonymous game entry", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>SOL\/\/SHIFT — Survive the laws of physics<\/title>/i);
  assert.match(html, /PHYSICS SURVIVAL/);
  assert.match(html, /DAILY SHIFT/);
  assert.match(html, /START 60s SHIFT/);
  assert.match(html, /ENDLESS SHIFT/);
  assert.match(html, /Capture mass\. Detonate Novas\. Bank Flux\./);
  assert.match(html, /01 · PULL/);
  assert.match(html, /02 · NOVA/);
  assert.match(html, /03 · BANK/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("removes starter-only surfaces and metadata", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /SolShiftGame/);
  assert.match(layout, /applicationName:\s*"SOL\/\/SHIFT"/);
  assert.match(packageJson, /"name": "sol-shift"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("app/_sites-preview", root)));
});
