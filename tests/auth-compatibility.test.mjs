import test from "node:test";
import assert from "node:assert/strict";
import { harness, ITEM, KEY, DOC_KEY, file, item, pdfResponse, jsonResponse } from "./harness.mjs";

const mutations = h => h.events.db.filter(x => x.op !== "select");
const completions = h => h.events.db.filter(x => x.table === "submittal_packages" && x.op === "update");
const auth = h => h.events.fetch.forEach(({ init }) => assert.equal(init.headers.Authorization, "Bearer synthetic-access-token"));

test("exported helper reads the current session rather than caching a token", async t => {
  const h = await harness(); t.after(h.cleanup);
  assert.equal((await h.api.getAuthHeaders()).Authorization, "Bearer synthetic-access-token");
  h.state.token = "rotated";
  assert.equal((await h.api.getAuthHeaders()).Authorization, "Bearer rotated");
  assert.equal(h.events.auth, 2);
});

for (const sessionResult of [
  { data: { session: null } }, { data: null, error: "failed" },
  { data: { session: { access_token: " " } } },
  { data: { session: { access_token: "valid-looking" } }, error: "session failed" },
]) test(`invalid session fails closed: ${JSON.stringify(sessionResult)}`, async t => {
  const h = await harness({ sessionResult }); t.after(h.cleanup);
  await assert.rejects(h.generator.uploadSubmittalFile(ITEM, new File(["test"], "a.pdf")), /Not authenticated/);
  await assert.rejects(h.generator.deleteSubmittalFile("file-1", KEY), /Not authenticated/);
  await assert.rejects(h.generator.downloadSubmittalFile(KEY, "a.pdf"), /Not authenticated/);
  assert.equal(h.events.fetch.length, 0); assert.equal(mutations(h).length, 0);
});

test("submittal upload sends bearer without overriding multipart Content-Type", async t => {
  const h = await harness({ fetch: () => jsonResponse({ r2_key: KEY, file_name: "fixture.pdf", file_size: 20 }) }); t.after(h.cleanup);
  const result = await h.generator.uploadSubmittalFile(ITEM, new File(["test"], "fixture.pdf"));
  assert.equal(result.r2_key, KEY); auth(h);
  assert.equal(h.events.fetch[0].init.headers["Content-Type"], undefined);
  assert.equal(h.events.fetch[0].init.body.get("item_id"), ITEM);
  assert.equal(h.events.fetch[0].init.redirect, "error");
  assert.equal(mutations(h)[0].op, "insert");
});

for (const status of [401, 403, 404, 429, 500, 503]) {
  test(`R2 delete ${status} leaves database file record intact`, async t => {
    const h = await harness({ fetch: () => jsonResponse({ detail: "denied" }, status) }); t.after(h.cleanup);
    await assert.rejects(h.generator.deleteSubmittalFile("file-1", KEY), /record was kept/);
    assert.equal(mutations(h).length, 0); assert.equal(h.state.tables.submittal_package_files.length, 1); auth(h);
  });
}

for (const payload of [{}, { status: "deleted", r2_key: "wrong" }, { status: "failed", r2_key: KEY }]) {
  test(`unconfirmed storage deletion is not accepted: ${JSON.stringify(payload)}`, async t => {
    const h = await harness({ fetch: () => jsonResponse(payload) }); t.after(h.cleanup);
    await assert.rejects(h.generator.deleteSubmittalFile("file-1", KEY), /not confirmed/);
    assert.equal(mutations(h).length, 0);
  });
}

test("storage network/invalid JSON failures never cause DB cleanup", async t => {
  const h = await harness({ fetch: () => { throw new Error("network failed"); } }); t.after(h.cleanup);
  await assert.rejects(h.generator.deleteSubmittalFile("file-1", KEY));
  h.state.fetch = () => new Response("not JSON");
  await assert.rejects(h.generator.deleteSubmittalFile("file-1", KEY));
  assert.equal(mutations(h).length, 0);
});

test("confirmed R2 deletion deletes only matching record id and key", async t => {
  const h = await harness({ fetch: () => jsonResponse({ status: "deleted", r2_key: KEY }) }); t.after(h.cleanup);
  await h.generator.deleteSubmittalFile("file-1", KEY);
  auth(h);
  assert.equal(h.events.fetch[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(JSON.stringify(mutations(h)[0].filters)), [["id", "file-1"], ["r2_key", KEY]]);
  assert.equal(h.state.tables.submittal_package_files.length, 0);
});

for (const key of ["https://attacker.invalid/test", "logos/company.png", `submittals/${ITEM}/../test.pdf`,
                   `${KEY}?token=x`, `${KEY}#fragment`, `${KEY}\r\n`, `submittals/${ITEM}/a%2fb.pdf`]) {
  test(`invalid/unlinked download key gets no bearer: ${JSON.stringify(key)}`, async t => {
    const h = await harness(); t.after(h.cleanup);
    await assert.rejects(h.api.fetchSubmittalFile(key), /Invalid linked/);
    assert.equal(h.events.auth, 0); assert.equal(h.events.fetch.length, 0);
  });
}

test("async file URL is a local blob; actual download cleans it up after Safari grace period", async t => {
  const h = await harness({ fetch: pdfResponse }); t.after(h.cleanup);
  const result = h.generator.getSubmittalFileUrl(KEY);
  assert.equal(typeof result.then, "function");
  const url = await result;
  assert.match(url, /^blob:/); assert.ok(!url.includes("token"));
  await h.generator.downloadSubmittalFile(KEY, "../fixture.pdf");
  auth(h);
  assert.ok(h.events.fetch.every(x => x.url.includes("/submittal/download/") && x.init.redirect === "error"));
  assert.equal(h.events.downloads[0].name, ".._fixture.pdf");
  assert.equal(h.events.revoked.length, 0);
  assert.equal(h.events.timers[0].delay, 60_000);
  h.events.timers[0].callback();
  assert.deepEqual(h.events.revoked, [h.events.downloads[0].href]);
});

test("empty or failed download creates no blob link", async t => {
  const h = await harness({ fetch: () => new Response("") }); t.after(h.cleanup);
  await assert.rejects(h.generator.downloadSubmittalFile(KEY), /empty/);
  h.state.fetch = () => jsonResponse({}, 403);
  await assert.rejects(h.generator.downloadSubmittalFile(KEY));
  assert.equal(h.events.created.length, 0); assert.equal(h.events.downloads.length, 0);
});

test("rendered file button downloads with auth and reports failure in accessible UI", async t => {
  const h = await harness({ fetch: pdfResponse }); t.after(h.cleanup);
  const container = h.document.getElementById("app");
  h.generator.renderSubmittalGenerator(container, { ...h.state.tables.submittal_packages[0], items: [item()] });
  const button = container.querySelector(".download-file-btn");
  button.click(); await h.flush();
  assert.equal(h.events.downloads.length, 1); auth(h);
  h.state.fetch = () => jsonResponse({}, 401);
  button.click(); await h.flush();
  const warning = h.document.getElementById("submittalWarnings");
  assert.equal(warning.hidden, false); assert.match(warning.textContent, /401/);
  assert.equal(button.disabled, false); assert.equal(h.events.downloads.length, 1);
});

test("download file attributes escape untrusted filenames rather than inserting HTML", async t => {
  const h = await harness(); t.after(h.cleanup);
  const name = '\"><img src=x onerror=alert(1)>';
  h.generator.renderSubmittalGenerator(h.document.getElementById("app"), {
    ...h.state.tables.submittal_packages[0], items: [item([file({ file_name: name })])],
  });
  assert.equal(h.document.querySelector(".download-file-btn").dataset.fileName, name);
  assert.equal(h.document.querySelectorAll("img").length, 0);
});

test("PDF and conversion fetches carry bearer; completion occurs after full successful merge", async t => {
  const h = await harness({ fetch: pdfResponse }); t.after(h.cleanup);
  h.state.tables.submittal_package_items = [item([file(), file({ id: "file-2", file_name: "fixture.docx", r2_key: DOC_KEY })])];
  h.state.dbHook = call => {
    if (call.op === "update") assert.equal(h.events.saved, 1);
  };
  assert.equal(await h.generator.combineSubmittalPackage({ id: "pkg" }, {}), true);
  auth(h);
  assert.ok(h.events.fetch[0].url.includes("/submittal/file/"));
  assert.ok(h.events.fetch[1].url.includes("/submittal/file-as-pdf/"));
  assert.equal(completions(h).length, 1); assert.equal(h.events.downloads.length, 1);
});

for (const conversion of [false, true]) for (const status of [401, 403, 429, 500]) {
  test(`${conversion ? "conversion" : "PDF fetch"} ${status} never marks package complete`, async t => {
    const h = await harness({ fetch: () => jsonResponse({}, status) }); t.after(h.cleanup);
    if (conversion) h.state.tables.submittal_package_items = [item([file({ file_name: "fixture.docx", r2_key: DOC_KEY })])];
    await assert.rejects(h.generator.combineSubmittalPackage({ id: "pkg" }, {}), /not completed/);
    assert.equal(completions(h).length, 0); assert.equal(h.events.saved, 0);
    assert.equal(h.events.downloads.length, 0); assert.equal(h.state.tables.submittal_packages[0].status, "draft");
  });
}

for (const option of ["loadError", "zeroPages", "partialCopy", "copyError", "saveError"]) {
  test(`${option} aborts package completion`, async t => {
    const h = await harness({ fetch: pdfResponse, [option]: true }); t.after(h.cleanup);
    await assert.rejects(h.generator.combineSubmittalPackage({ id: "pkg" }, {}));
    assert.equal(completions(h).length, 0); assert.equal(h.events.downloads.length, 0);
  });
}

test("a later attachment failure does not publish an already-partially-merged PDF", async t => {
  const h = await harness({ fetch: (_url, _init, events) => events.fetch.length === 1 ? pdfResponse() : new Response("corrupt") }); t.after(h.cleanup);
  h.state.tables.submittal_package_items = [item([file(), file()])];
  await assert.rejects(h.generator.combineSubmittalPackage({ id: "pkg" }, {}), /not completed/);
  assert.equal(h.events.saved, 0); assert.equal(completions(h).length, 0);
});

for (const items of [[], [item([])], [item([file({ file_name: "file.zip" })])]]) {
  test(`missing/unsupported attachments do not yield a complete placeholder package: ${JSON.stringify(items)}`, async t => {
    const h = await harness(); t.after(h.cleanup);
    h.state.tables.submittal_package_items = items;
    await assert.rejects(h.generator.combineSubmittalPackage({ id: "pkg" }, {}));
    assert.equal(completions(h).length, 0); assert.equal(h.events.fetch.length, 0);
  });
}

test("company logo is omitted with visible warning; no logo request carries credentials", async t => {
  const h = await harness({ fetch: pdfResponse }); t.after(h.cleanup);
  h.generator.renderSubmittalGenerator(h.document.getElementById("app"), {
    ...h.state.tables.submittal_packages[0], items: [item()],
  });
  await h.generator.combineSubmittalPackage({ id: "pkg" }, { company_logo_r2_key: "logos/private.png" });
  assert.equal(h.events.fetch.length, 1);
  const warning = h.document.getElementById("submittalWarnings");
  assert.equal(warning.hidden, false); assert.match(warning.textContent, /logo omitted/);
  assert.equal(h.events.alerts.length, 1);
  assert.match(h.events.alerts[0], /logo omitted/);
  const warnings = [];
  await h.pdf.generateSubmittalPackagePDF({ ...h.options, companyLogoUrl: "https://attacker.invalid/logo", onWarning: x => warnings.push(x) });
  assert.equal(warnings.length, 1); assert.ok(h.events.fetch.every(x => !x.url.includes("attacker")));
});

test("completion DB errors or missing update confirmation are surfaced", async t => {
  for (const response of [{ data: null, error: new Error("DB denied") }, { data: null, error: null }]) {
    const h = await harness({ fetch: pdfResponse }); t.after(h.cleanup);
    h.state.dbHook = call => call.op === "update" ? response : undefined;
    await assert.rejects(h.generator.combineSubmittalPackage({ id: "pkg" }, {}));
    assert.equal(h.events.downloads.length, 0);
  }
});

test("parse operation key is stable across retries and different only on deliberate new operation", async t => {
  const h = await harness({ fetch: () => jsonResponse({ detail: "retry" }, 503) }); t.after(h.cleanup);
  await assert.rejects(h.api.parseSpec("spec", "intentional-reparse-1"));
  h.state.fetch = () => jsonResponse({ status: "ready" });
  await h.api.parseSpec("spec", "intentional-reparse-1");
  await h.api.parseSpec("spec", "intentional-reparse-2");
  await h.api.parseSpec("spec");
  assert.deepEqual(h.events.fetch.map(x => x.init.headers["Idempotency-Key"]), ["intentional-reparse-1", "intentional-reparse-1", "intentional-reparse-2", undefined]);
  auth(h);
  assert.equal(h.api.API_BASE_URL, "https://documents.pm4subs.com");
});

for (const key of ["", null, 3, "bad\r\nheader", "a".repeat(81)]) {
  test(`bad operation key rejected before request: ${JSON.stringify(key)}`, async t => {
    const h = await harness(); t.after(h.cleanup);
    await assert.rejects(h.api.parseSpec("spec", key), /operation key/);
    assert.equal(h.events.fetch.length, 0);
  });
}

test("submittal extraction sends auth and errors are not disguised as no items", async t => {
  const h = await harness({ fetch: () => jsonResponse({ items: [] }) }); t.after(h.cleanup);
  assert.equal((await h.generator.extractSubmittalsFromAnalysis({ summary: "synthetic" })).length, 0);
  auth(h);
  h.state.fetch = () => jsonResponse({}, 401);
  await assert.rejects(h.generator.extractSubmittalsFromAnalysis({ summary: "synthetic" }), /401/);
  h.state.fetch = () => jsonResponse({ error: "AI unavailable" });
  await assert.rejects(h.generator.extractSubmittalsFromAnalysis({ summary: "synthetic" }), /failed/);
});

test("presigned R2 PUT carries no bearer; API presign and complete remain authenticated", async t => {
  const puts = [];
  class SyntheticXHR {
    constructor() { this.upload = {}; this.headers = {}; }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(key, value) { this.headers[key] = value; }
    send(body) { puts.push({ method: this.method, url: this.url, headers: this.headers, body }); this.status = 200; this.onload(); }
  }
  const h = await harness({ XMLHttpRequest: SyntheticXHR, fetch: url => url.endsWith("/presign")
    ? jsonResponse({ spec_id: "spec", r2_key: "spec-key", upload_url: "https://synthetic-r2.invalid/signed-put" })
    : jsonResponse({ spec_id: "spec", status: "uploaded" }) });
  t.after(h.cleanup);
  const result = await h.api.uploadSpec(new File(["%PDF-fixture"], "spec.pdf"), "user", "job");
  assert.equal(result.status, "uploaded");
  auth(h);
  assert.equal(h.events.fetch.length, 2);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].method, "PUT");
  assert.equal(puts[0].url, "https://synthetic-r2.invalid/signed-put");
  assert.deepEqual(puts[0].headers, { "Content-Type": "application/pdf" });
});

test("legacy spec multipart fallback keeps bearer without an explicit multipart Content-Type", async t => {
  const h = await harness({ fetch: url => url.endsWith("/presign")
    ? jsonResponse({}, 404) : jsonResponse({ spec_id: "spec", status: "uploaded" }) });
  t.after(h.cleanup);
  await h.api.uploadSpec(new File(["%PDF-fixture"], "spec.pdf"), "user", "job");
  auth(h);
  assert.equal(h.events.fetch.length, 2);
  const fallback = h.events.fetch[1];
  assert.ok(fallback.url.endsWith("/upload"));
  assert.equal(fallback.init.headers["Content-Type"], undefined);
  assert.equal(fallback.init.body.get("job_id"), "job");
});
