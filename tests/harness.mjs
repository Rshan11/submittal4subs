import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(process.env.TEST_DEPENDENCIES_PACKAGE || import.meta.url);
const { JSDOM } = require("jsdom");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ITEM = "66666666-6666-4666-8666-666666666666";
export const KEY = `submittals/${ITEM}/fixture.pdf`;
export const DOC_KEY = `submittals/${ITEM}/fixture.docx`;
export const file = (extra = {}) => ({ id: "file-1", file_name: "fixture.pdf", r2_key: KEY, file_size: 20, ...extra });
export const item = (files = [file()]) => ({ id: ITEM, package_id: "pkg", spec_section: "04 20 00",
  description: "Synthetic masonry", manufacturer: "Test vendor", submittal_package_files: files });
export const pdfResponse = () => new Response("%PDF-synthetic", { headers: { "Content-Type": "application/pdf" } });
export const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
});

export async function harness(options = {}) {
  const dom = new JSDOM("<!doctype html><body><main id='app'></main></body>");
  const events = { fetch: [], db: [], downloads: [], created: [], revoked: [], timers: [], alerts: [], saved: 0, loaded: 0, auth: 0 };
  const tables = { submittal_packages: [{ id: "pkg", job_id: "job", status: "draft", name: "Synthetic package" }],
    jobs: [{ id: "job", job_name: "Synthetic job" }], submittal_package_items: [item()],
    submittal_package_files: [file()] };
  const state = { ...options, tables };
  class Query {
    constructor(table) { this.table = table; this.op = "select"; this.filters = []; }
    select(columns) { this.columns = columns; return this; }
    eq(key, value) { this.filters.push([key, value]); return this; }
    order() { return this; }
    limit() { return this; }
    single() { this.one = true; return this; }
    maybeSingle() { this.one = true; return this; }
    insert(payload) { this.op = "insert"; this.payload = payload; return this; }
    update(payload) { this.op = "update"; this.payload = payload; return this; }
    delete() { this.op = "delete"; return this; }
    then(ok, fail) {
      const call = { table: this.table, op: this.op, filters: this.filters, payload: this.payload };
      events.db.push(call);
      let result;
      try {
        result = state.dbHook?.(call);
        if (result === undefined) {
          const rows = (tables[this.table] || []).filter(row => this.filters.every(([k, v]) => row[k] === v));
          if (this.op === "update") rows.forEach(row => Object.assign(row, this.payload));
          if (this.op === "delete") tables[this.table] = tables[this.table].filter(row => !rows.includes(row));
          if (this.op === "insert") {
            const row = { id: "inserted", ...this.payload };
            tables[this.table].push(row);
            result = { data: this.one ? row : [row], error: null };
          } else result = { data: this.one ? rows[0] ?? null : rows, error: null };
        }
      } catch (error) { return Promise.reject(error).then(ok, fail); }
      return Promise.resolve(result).then(ok, fail);
    }
  }
  const supabase = {
    auth: { async getSession() {
      events.auth++;
      return state.sessionResult ?? { data: { session: { access_token: state.token ?? "synthetic-access-token" } }, error: null };
    } },
    from(table) { return new Query(table); },
  };
  const page = () => ({ drawText() {}, drawRectangle() {}, drawImage() {} });
  const font = { widthOfTextAtSize: (text, size) => String(text).length * size / 2 };
  const PDFDocument = {
    async create() {
      return { async embedFont() { return font; }, addPage() { return page(); },
        async copyPages(_doc, indices) {
          if (state.copyError) throw new Error("Synthetic copy failure");
          return state.partialCopy ? [] : indices.map(page);
        },
        async save() {
          if (state.saveError) throw new Error("Synthetic save failure");
          events.saved++;
          return new TextEncoder().encode("%PDF-synthetic-combined");
        },
      };
    },
    async load(data) {
      events.loaded++;
      if (state.loadError || !new TextDecoder().decode(data).startsWith("%PDF")) throw new Error("Invalid PDF");
      return { getPageIndices() { return state.zeroPages ? [] : [0, 1]; } };
    },
  };
  class LocalURL extends URL {
    static createObjectURL(blob) {
      const url = `blob:synthetic/${events.created.length + 1}`;
      events.created.push({ url, blob }); return url;
    }
    static revokeObjectURL(url) { events.revoked.push(url); }
  }
  dom.window.HTMLAnchorElement.prototype.click = function () {
    events.downloads.push({ href: this.href, name: this.download });
  };
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} }, document: dom.window.document, window: dom.window,
    alert: message => events.alerts.push(message), pm4Confirm: async () => true,
    Blob, File, FormData, Response, URL: LocalURL,
    XMLHttpRequest: options.XMLHttpRequest ?? class {
      constructor() { throw new Error("No real XHR permitted: supply a synthetic implementation"); }
    },
    setTimeout: (callback, delay) => events.timers.push({ callback, delay }),
    fetch: async (url, init = {}) => {
      events.fetch.push({ url, init });
      if (!state.fetch) throw new Error("No real network permitted: supply a synthetic fetch");
      return state.fetch(url, init, events);
    },
  });
  const authModule = new vm.SyntheticModule(["supabase"], function () { this.setExport("supabase", supabase); }, { context });
  const pdfModule = new vm.SyntheticModule(["PDFDocument", "rgb", "StandardFonts"], function () {
    this.setExport("PDFDocument", PDFDocument); this.setExport("rgb", (...values) => values);
    this.setExport("StandardFonts", { Helvetica: "Helvetica", HelveticaBold: "HelveticaBold" });
  }, { context });
  await pdfModule.link(() => { throw new Error("Unexpected dependency"); });
  await pdfModule.evaluate();
  const modules = new Map();
  async function load(path) {
    if (path.endsWith("/lib/supabase.js")) return authModule;
    if (!modules.has(path)) {
      const code = await readFile(path, "utf8");
      modules.set(path, new vm.SourceTextModule(code, {
        identifier: path, context, initializeImportMeta(meta) { meta.env = state.env ?? {}; },
        importModuleDynamically(specifier) {
          if (specifier !== "pdf-lib") throw new Error("Unexpected dynamic dependency");
          return pdfModule;
        },
      }));
    }
    return modules.get(path);
  }
  const generatorPath = resolve(root, "submittal-generator.js");
  const generator = await load(generatorPath);
  await generator.link((specifier, ref) => load(resolve(dirname(ref.identifier), specifier)));
  await generator.evaluate();
  return { state, events, document: dom.window.document, generator: generator.namespace,
    api: modules.get(resolve(root, "lib/api.js")).namespace,
    pdf: modules.get(resolve(root, "submittal-pdf.js")).namespace,
    options: { projectName: "Synthetic job", companyName: "Synthetic company", items: [item()], generatedDate: "2026-10-19" },
    flush: () => new Promise(resolve => setImmediate(resolve)),
    cleanup: () => dom.window.close(),
  };
}
