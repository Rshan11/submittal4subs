import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import * as pdfLib from "pdf-lib";
import { harness, ITEM, KEY, DOC_KEY, item, file, jsonResponse } from "./harness.mjs";

const origin = "https://documents.pm4subs.com";
const specFile = () => new File(["%PDF-synthetic"], "spec.pdf", { type: "application/pdf" });
const changed = h => h.events.db.filter(call => call.op !== "select");

function xhr({ status = 200, onSend = () => {} } = {}) {
  return class {
    constructor() { this.upload = {}; this.headers = {}; }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(key, value) { this.headers[key] = value; }
    send(body) {
      onSend(this, body);
      this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 });
      this.status = status;
      this.onload();
    }
  };
}

test("standalone two-argument reorder API and caller remain compatible", async t => {
  const h = await harness(); t.after(h.cleanup);
  assert.equal(h.generator.reorderSubmittalFile.length, 2);
  await h.generator.reorderSubmittalFile("file-1", 7);
  assert.equal(changed(h).length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(changed(h)[0])), {
    table: "submittal_package_files", op: "update", filters: [["id", "file-1"]], payload: { sort_order: 7 },
  });
  const caller = await readFile(new URL("../view-analysis.js", import.meta.url), "utf8");
  assert.match(caller, /await reorderSubmittalFile\(fileId1, newOrder1\)/);
  assert.match(caller, /await reorderSubmittalFile\(fileId2, newOrder2\)/);
});

test("standalone native confirmation remains native, without a PM4-only dependency", async t => {
  const h = await harness(); t.after(h.cleanup);
  const source = await readFile(new URL("../submittal-generator.js", import.meta.url), "utf8");
  assert.ok(source.includes('confirm("Remove this file?")'));
  assert.ok(!source.includes("pm4Confirm"));
});

for (const [name, call, path] of [
  ["parse", h => h.api.parseSpec("spec"), "/parse/spec"],
  ["reparse", h => h.api.parseSpec("spec", "intentional-reparse"), "/parse/spec"],
  ["analysis", h => h.api.analyzeSpec("spec", "04", false, "Synthetic", ["07 21 00"]), "/analyze/spec"],
  ["divisions", h => h.api.getSpecDivisions("spec"), "/spec/spec/divisions"],
  ["related sections", h => h.api.getRelatedSections("spec", "04"), "/spec/spec/division/04/related"],
  ["job deletion", h => h.api.deleteJob("job", "user"), "/job/job?user_id=user"],
]) {
  test(`${name} preserves the protected backend contract`, async t => {
    const h = await harness({ fetch: () => jsonResponse({ status: "ready" }) }); t.after(h.cleanup);
    await call(h);
    assert.equal(h.events.fetch.length, 1);
    const request = h.events.fetch[0];
    assert.equal(request.url, origin + path);
    assert.equal(request.init.headers.Authorization, "Bearer synthetic-access-token");
    assert.equal(request.init.redirect, "error");
    if (name === "reparse") assert.equal(request.init.headers["Idempotency-Key"], "intentional-reparse");
    if (name === "analysis") assert.deepEqual(JSON.parse(request.init.body), {
      division: "04", include_contract_terms: false, project_name: "Synthetic", related_sections: ["07 21 00"],
    });
  });
  test(`${name} stops before fetch if signed out`, async t => {
    const h = await harness({ sessionResult: { data: { session: null } } }); t.after(h.cleanup);
    await assert.rejects(call(h), /Not authenticated/);
    assert.equal(h.events.fetch.length, 0);
  });
  test(`${name} propagates access denial instead of reporting success`, async t => {
    const h = await harness({ fetch: () => jsonResponse({ detail: "Denied" }, 403) }); t.after(h.cleanup);
    await assert.rejects(call(h));
    assert.equal(h.events.fetch.length, 1);
  });
}

test("presign/complete payloads match the ticket contract and renew session after upload", async t => {
  const progress = [];
  let h;
  h = await harness({ XMLHttpRequest: xhr({ onSend(request) {
    assert.equal(request.headers.Authorization, undefined);
    h.state.token = "rotated-after-upload";
  } }), fetch: url => url.endsWith("/presign")
    ? jsonResponse({ spec_id: "new-spec", r2_key: "final-key", upload_url: "https://r2.invalid/signed" })
    : jsonResponse({ spec_id: "new-spec", status: "uploaded" }) });
  t.after(h.cleanup);
  const selected = specFile();
  await h.api.uploadSpec(selected, "user", "job", amount => progress.push(amount));
  const [presign, complete] = h.events.fetch;
  assert.deepEqual(JSON.parse(presign.init.body), { filename: selected.name, job_id: "job", size: selected.size });
  assert.deepEqual(JSON.parse(complete.init.body), { spec_id: "new-spec", r2_key: "final-key", filename: selected.name, job_id: "job" });
  assert.equal(complete.init.headers.Authorization, "Bearer rotated-after-upload");
  assert.deepEqual(progress, [0.5]);
});

for (const status of [401, 403, 429, 500]) {
  test(`presign ${status} neither PUTs nor falls back to an upload`, async t => {
    const h = await harness({ fetch: () => jsonResponse({ detail: "Denied" }, status) }); t.after(h.cleanup);
    await assert.rejects(h.api.uploadSpec(specFile(), "user", "job"));
    assert.equal(h.events.fetch.length, 1);
    assert.ok(h.events.fetch[0].url.endsWith("/presign"));
  });
  test(`completion ${status} is a failure, not a fresh duplicate upload`, async t => {
    const h = await harness({ XMLHttpRequest: xhr(), fetch: url => url.endsWith("/presign")
      ? jsonResponse({ spec_id: "s", r2_key: "key", upload_url: "https://r2.invalid/signed" })
      : jsonResponse({ detail: "Denied" }, status) }); t.after(h.cleanup);
    await assert.rejects(h.api.uploadSpec(specFile(), "user", "job"));
    assert.equal(h.events.fetch.length, 2);
  });
  test(`submittal upload ${status} never inserts a file row`, async t => {
    const h = await harness({ fetch: () => jsonResponse({ detail: "Denied" }, status) }); t.after(h.cleanup);
    await assert.rejects(h.generator.uploadSubmittalFile(ITEM, specFile()));
    assert.equal(changed(h).length, 0);
  });
}

test("failed R2 upload uses the authenticated multipart fallback for a small PDF", async t => {
  const h = await harness({ XMLHttpRequest: xhr({ status: 503 }), fetch: url => url.endsWith("/presign")
    ? jsonResponse({ spec_id: "s", r2_key: "key", upload_url: "https://r2.invalid/signed" })
    : jsonResponse({ spec_id: "fallback", status: "uploaded" }) }); t.after(h.cleanup);
  const result = await h.api.uploadSpec(specFile(), "user", "job");
  assert.equal(result.spec_id, "fallback");
  assert.equal(h.events.fetch[1].url, origin + "/upload");
  assert.equal(h.events.fetch[1].init.headers["Content-Type"], undefined);
  assert.equal(h.events.fetch[1].init.body.get("user_id"), "user");
  assert.equal(h.events.fetch.some(call => call.url.endsWith("/complete")), false);
});

test("large failed R2 upload is not routed through the smaller multipart limit", async t => {
  const h = await harness({ XMLHttpRequest: xhr({ status: 503 }), fetch: () =>
    jsonResponse({ spec_id: "s", r2_key: "key", upload_url: "https://r2.invalid/signed" }) }); t.after(h.cleanup);
  await assert.rejects(h.api.uploadSpec({ name: "large.pdf", size: 101 * 1024 * 1024 }, "user", "job"), /Storage upload failed/);
  assert.equal(h.events.fetch.length, 1);
});

test("real pdf-lib merges every source page in order with no live network", async t => {
  const source = await pdfLib.PDFDocument.create();
  source.addPage([201, 301]); source.addPage([202, 302]);
  const bytes = await source.save();
  const converted = await pdfLib.PDFDocument.create();
  converted.addPage([203, 303]);
  const convertedBytes = await converted.save();
  const h = await harness({ fetch: url => new Response(
    url.includes("file-as-pdf") ? convertedBytes : bytes,
    { headers: { "Content-Type": "application/pdf" } },
  ) }); t.after(h.cleanup);
  // pdf-lib uses instanceof Array; run both it and the generator in one realm.
  // Inject only the already-tested, network-disabled attachment transport.
  const sourceCode = await readFile(new URL("../submittal-pdf.js", import.meta.url), "utf8");
  globalThis.__standalonePdfTestFetch = h.api.fetchSubmittalFile;
  t.after(() => { delete globalThis.__standalonePdfTestFetch; });
  const require = createRequire(import.meta.url);
  const sourceModule = sourceCode
    .replace('import { fetchSubmittalFile } from "./lib/api.js";', 'const fetchSubmittalFile = globalThis.__standalonePdfTestFetch;')
    .replace('import("pdf-lib")', `import(${JSON.stringify(pathToFileURL(require.resolve("pdf-lib")).href)})`);
  const actualPdf = await import(`data:text/javascript;base64,${Buffer.from(sourceModule).toString("base64")}`);
  const blob = await actualPdf.generateSubmittalPackagePDF({ ...h.options,
    items: [item([file(), file({ file_name: "converted.docx", r2_key: DOC_KEY })])],
  });
  const result = await pdfLib.PDFDocument.load(await blob.arrayBuffer());
  assert.equal(result.getPageCount(), 6);
  assert.deepEqual(result.getPages().slice(3).map(page => page.getWidth()), [201, 202, 203]);
  assert.equal(h.events.fetch[0].url, `${origin}/submittal/file/${KEY}`);
  assert.equal(h.events.fetch[1].url, `${origin}/submittal/file-as-pdf/${DOC_KEY}`);
  assert.ok(h.events.fetch.every(call => call.init.headers.Authorization === "Bearer synthetic-access-token"));
});
