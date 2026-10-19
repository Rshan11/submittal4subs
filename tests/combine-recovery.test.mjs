import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { harness, item, file, pdfResponse } from "./harness.mjs";

const mainSource = await readFile(new URL("../main.js", import.meta.url), "utf8");
const start = mainSource.indexOf("async function showSubmittalGenerator() {");
const end = mainSource.indexOf("\nfunction updateLoadingStatus(", start);
assert.ok(start > 0 && end > start);
// Exercise the actual editor function without booting unrelated upload/auth UI.
const editorSource = mainSource.slice(start, end);
const secondItem = "77777777-7777-4777-8777-777777777777";

async function editor(t, combineOverride) {
  const h = await harness({ fetch: pdfResponse }); t.after(h.cleanup);
  const app = h.document.getElementById("app");
  for (const id of ["uploadSection", "divisionSection", "loadingSection", "resultsSection", "errorSection"]) {
    const section = h.document.createElement("section"); section.id = id; app.appendChild(section);
  }
  h.state.tables.submittal_package_items = [item(), { ...item([]), id: secondItem }];
  const calls = { callbacks: null, resets: 0, alerts: [], uploads: 0 };
  const context = vm.createContext({
    document: h.document,
    currentUser: { id: "synthetic-user" },
    currentSubmittalPackage: { ...h.state.tables.submittal_packages[0], items: h.state.tables.submittal_package_items },
    uploadSection: h.document.getElementById("uploadSection"),
    divisionSection: h.document.getElementById("divisionSection"),
    loadingSection: h.document.getElementById("loadingSection"),
    resultsSection: h.document.getElementById("resultsSection"),
    errorSection: h.document.getElementById("errorSection"),
    supabase: { from() { return { select() { return this; }, eq() { return this; }, async single() { return { data: {} }; } }; } },
    renderSubmittalGenerator(container, pkg, callbacks) {
      calls.callbacks = callbacks;
      h.generator.renderSubmittalGenerator(container, pkg, callbacks);
    },
    combineSubmittalPackage: combineOverride || h.generator.combineSubmittalPackage,
    loadSubmittalPackage: h.generator.loadSubmittalPackage,
    async uploadSubmittalFile(id) {
      calls.uploads++;
      h.state.tables.submittal_package_items.find(item => item.id === id).submittal_package_files = [file()];
    },
    showError() { calls.resets++; },
    showSection() { calls.resets++; },
    alert(message) { calls.alerts.push(message); },
  });
  vm.runInContext(editorSource, context);
  await context.showSubmittalGenerator();
  return { h, calls, context };
}

test("missing attachment keeps both items editable; adding it allows a successful retry", async t => {
  const { h, calls, context } = await editor(t);
  const before = context.currentSubmittalPackage;
  await calls.callbacks.onCombine();
  const section = h.document.getElementById("submittalSection");
  const warning = section.querySelector("#submittalWarnings");
  assert.equal(calls.resets, 0);
  assert.equal(context.currentSubmittalPackage, before);
  assert.equal(section.style.display, "block");
  assert.equal(h.document.getElementById("errorSection").style.display, "none");
  assert.equal(warning.hidden, false);
  assert.match(warning.textContent, /Every submittal item needs an attachment/);
  assert.equal(section.querySelectorAll(".file-input").length, 2);
  assert.equal(section.querySelectorAll(".upload-file-btn:disabled").length, 0);
  assert.equal(h.document.querySelector(".submittal-loading-overlay"), null);
  assert.equal(h.events.saved, 0);
  assert.equal(h.events.downloads.length, 0);
  assert.equal(h.events.db.some(call => call.op !== "select"), false);
  assert.equal(calls.alerts.length, 0);

  let inputClicks = 0;
  section.querySelector(".file-input").addEventListener("click", () => inputClicks++);
  section.querySelector(".upload-file-btn").click();
  assert.equal(inputClicks, 1);
  await calls.callbacks.onUploadFile(secondItem, new File(["%PDF-synthetic"], "missing.pdf"));
  await h.flush();
  assert.equal(calls.uploads, 1);
  await calls.callbacks.onCombine();
  await h.flush();
  assert.equal(calls.resets, 0);
  assert.equal(h.state.tables.submittal_packages[0].status, "complete");
  assert.equal(h.events.saved, 1);
  assert.equal(h.events.downloads.length, 1);
  assert.equal(calls.alerts.length, 1);
  assert.equal(h.document.querySelector(".submittal-loading-overlay"), null);
});

test("combine failure warning is plain text, never injected HTML or generic reset UI", async t => {
  const message = '<img src=x onerror="alert(1)"> conversion failed (403)';
  const { h, calls } = await editor(t, async () => { throw new Error(message); });
  await calls.callbacks.onCombine();
  const warning = h.document.getElementById("submittalWarnings");
  assert.equal(warning.textContent, "Failed to generate package: " + message);
  assert.equal(warning.querySelector("img"), null);
  assert.equal(warning.hidden, false);
  assert.equal(calls.resets, 0);
  assert.equal(h.events.downloads.length, 0);
  assert.equal(h.state.tables.submittal_packages[0].status, "draft");
});

test("missing warning element is recreated without losing existing upload controls", async t => {
  const { h, calls } = await editor(t, async () => { throw null; });
  h.document.getElementById("submittalWarnings").remove();
  const input = h.document.querySelector(".file-input");
  await calls.callbacks.onCombine();
  const warning = h.document.getElementById("submittalWarnings");
  assert.equal(warning.getAttribute("role"), "alert");
  assert.equal(warning.hidden, false);
  assert.match(warning.textContent, /Check the attachments/);
  assert.equal(h.document.querySelector(".file-input"), input);
  assert.equal(calls.resets, 0);
});
