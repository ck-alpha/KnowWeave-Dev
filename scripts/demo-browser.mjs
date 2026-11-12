#!/usr/bin/env node
// Real Chromium UI exercise. No DOM replacement, mocked network, or edited screenshots.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

const options = { baseUrl: "http://127.0.0.1:3001", outputDir: resolve(`.local/evidence/round03/browser-${new Date().toISOString().replace(/[:.]/g, "-")}`),
  wikiPath: null, chromium: process.env.CHROMIUM_PATH || "chromium" };
for (let i = 2; i < process.argv.length; i++) {
  const keys = { "--base-url": "baseUrl", "--output-dir": "outputDir", "--wiki-path": "wikiPath", "--chromium": "chromium" };
  const key = keys[process.argv[i]];
  if (!key || !process.argv[i + 1]) throw new Error("Usage: node scripts/demo-browser.mjs --wiki-path <demo-wiki> [--base-url URL] [--chromium executable] [--output-dir directory]");
  options[key] = process.argv[++i];
}
const base = new URL(options.baseUrl);
if (!["http:", "https:"].includes(base.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) || base.username || base.password || !options.wikiPath)
  throw new Error("Provide a loopback URL and the exact --wiki-path of your dedicated demo Wiki.");
const api = async path => {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
};
const settings = await api("/api/settings");
if (resolve(settings.wikiPath) !== resolve(options.wikiPath)) throw new Error("Wiki path mismatch; refusing to import.");
const manifest = JSON.parse(await readFile("data/scifact-demo/manifest.json", "utf8"));
if (manifest.dataset !== "BEIR SciFact" || manifest.documents.length < 3) throw new Error("Run scifact.py download and prepare first.");
const third = manifest.documents[2];
const inputPath = resolve("data/scifact-demo", third.file);
if (!inputPath.startsWith(resolve("data/scifact-demo") + "/")) throw new Error("Unsafe document path");
const input = await readFile(inputPath, "utf8");
if (createHash("sha256").update(input).digest("hex") !== third.sha256) throw new Error("Demo input hash mismatch");
const sources = (await api("/api/sources")).sources;
if (!sources.length || sources.some(s => !s.title?.startsWith("SciFact "))) throw new Error("Use the dedicated Wiki populated by demo_round03.py; unrelated sources found.");
const thirdTitle = `SciFact ${third.corpus_id} — ${third.title}`;
const priorThird = sources.find(s => s.title === thirdTitle && s.ingestedAt);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { started_at: new Date().toISOString(), status: "running", pages: [], queries: [], errors: [],
  scope: "Real Chromium source import (third SciFact document on first run), Wiki, index refresh, three queries, inline citation and complete raw source" };
await mkdir(options.outputDir, { recursive: true });
const reportPath = join(options.outputDir, 'browser.json');
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const profile = await mkdtemp(join(tmpdir(), "knowweave-browser-"));
let chrome, cdp;
let browserStderr = "";

class CDP {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result);
      } else for (const listener of this.listeners) listener(message);
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Browser closed while waiting for ${pending.method}`));
      }
      this.pending.clear();
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 45000);
      this.pending.set(id, { resolve, reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

async function uiChain() {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const requests = [];
  const completed = new Set();
  cdp.listeners.add(message => {
    if (message.sessionId !== sessionId) return;
    const { method, params } = message;
    if (method === 'Network.loadingFinished') completed.add(params.requestId);
    if (method === 'Runtime.exceptionThrown') report.errors.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
    if (method === 'Runtime.consoleAPICalled' && params.type === 'error') report.errors.push(params.args.map(a => a.value ?? a.description).join(' '));
    if (method === 'Network.responseReceived' && params.response.status >= 400) report.errors.push(`${params.response.status}: ${params.response.url}`);
    if (method === 'Network.requestWillBeSent' && params.request.method === 'POST')
      requests.push({ id: params.requestId, path: new URL(params.request.url).pathname, body: params.request.postData });
  });
  const evaluate = async expression => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const wait = async (expression, label, timeout = 30000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (report.errors.length) throw new Error(report.errors.join('\n'));
      try { if (await evaluate(`Boolean(${expression})`)) return; }
      catch (error) { if (!/context|Cannot find|Inspected target navigated/i.test(error.message)) throw error; }
      await sleep(300);
    }
    throw new Error(`Timed out: ${label}`);
  };
  const click = async expression => {
    const point = await evaluate(`(() => { const e=(${expression}); if(!e||e.disabled)throw new Error('Missing/disabled target'); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 }, sessionId);
  };
  // Accept current Chinese actions and the original English UI when replaying
  // the same demo against an older build. Model output remains untouched.
  const button = (...labels) => `[...document.querySelectorAll('button')].find(e=>${JSON.stringify(labels)}.includes(e.innerText.trim()))`;
  const fill = async (selector, value) => {
    await click(`document.querySelector(${JSON.stringify(selector)})`);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).select()`);
    await cdp.send('Input.insertText', { text: value }, sessionId);
  };
  const navigate = async path => {
    await cdp.send('Page.navigate', { url: new URL(path, base).href }, sessionId);
    await wait(`location.pathname===${JSON.stringify(path)} && document.readyState==='complete'`, `load ${path}`);
    await sleep(800);
  };
  const responseFor = async path => {
    const req = requests.filter(r => r.path === path).at(-1);
    if (!req) throw new Error(`No browser POST ${path}`);
    const end = Date.now() + 600000;
    while (!completed.has(req.id)) {
      if (Date.now() > end) throw new Error(`Request did not finish: ${path}`);
      await sleep(200);
    }
    const r = await cdp.send('Network.getResponseBody', { requestId: req.id }, sessionId);
    return JSON.parse(r.base64Encoded ? Buffer.from(r.body, 'base64').toString() : r.body);
  };
  const capture = async (filename, step) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: filename === 'round03-wiki.png' ? 1100 : 1400, deviceScaleFactor: 1, mobile: false }, sessionId);
    await evaluate("document.querySelectorAll('main, main *').forEach(e=>{if(e.scrollTop)e.scrollTop=0});window.scrollTo(0,0)");
    await sleep(500);
    const body = await evaluate('document.body.innerText');
    if (/\/home\/|\/root\/|sk-[A-Za-z0-9]{15}/.test(body)) throw new Error('Screenshot contains a machine path or possible secret; inspect the UI.');
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
    await writeFile(join(options.outputDir, filename), Buffer.from(shot.data, 'base64'));
    report.pages.push({ step, filename, body_sha256: createHash('sha256').update(body).digest('hex') });
  };
  await Promise.all(['Page.enable', 'Runtime.enable', 'Network.enable'].map(method => cdp.send(method, {}, sessionId)));
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false }, sessionId);
  await navigate('/sources');
  if (!priorThird) {
    await wait("document.querySelector('#text') && document.querySelector('#title')", 'paste form');
    await fill('#title', thirdTitle);
    await fill('#text', input);
    await click(button('导入并整理', 'Ingest'));
    console.log('Browser submitted third SciFact source; waiting for Qwen…');
    await wait("[...document.querySelectorAll('strong')].some(e=>['整理完成。','Ingested.'].includes(e.innerText.trim()))", 'real ingest', 600000);
    report.ingest = await responseFor('/api/ingest');
    if (!report.ingest.ok || report.ingest.kind !== 'applied') throw new Error('Browser ingest was not applied');
    report.import_action = 'new third source via browser';
  } else {
    report.import_action = 'reused previously ingested third source; no new browser import this run';
    report.ingest = { sourceId: priorThird.id };
  }
  const imported = await api(`/api/sources/${report.ingest.sourceId}`);
  if (imported.truncated || imported.rawError || !imported.rawText.includes(input.trim())) throw new Error('Third raw input not preserved');
  const pages = (await api('/api/pages')).pages;
  const linked = [];
  for (const p of pages) {
    const page = await api(`/api/pages/${p.slug}`);
    if (page.frontmatter.sources?.includes(report.ingest.sourceId)) linked.push(p.slug);
  }
  if (!linked.length) throw new Error('Third source has no persisted Wiki lineage');
  report.imported_pages = linked;
  if (priorThird) await navigate(`/wiki/${linked[0]}`);
  else await click(`document.querySelector('a[href="/wiki/${linked[0]}"]')`);
  await wait(`location.pathname==='/wiki/${linked[0]}' && document.querySelector('article')`, 'browse ingested page');
  await navigate('/query');
  await wait("document.querySelector('#retrieval-mode') && document.querySelector('[role=status]') && !/Checking|正在检查/.test(document.querySelector('[role=status]').innerText)", 'retrieval status');
  report.before_refresh = await api('/api/retrieval');
  await click(button('构建 / 刷新向量索引', 'Build / refresh embedding index'));
  await wait("[...document.querySelectorAll('[role=status]')].some(e=>/索引刷新完成：|Refresh finished:/.test(e.innerText))", 'index refresh', 180000);
  report.build = await responseFor('/api/retrieval');
  if (!report.build.ok || !report.build.ready) throw new Error('Index is not ready');
  const question = 'Does elevated aldehyde dehydrogenase in breast tumours predict a favorable patient outcome?';
  for (const mode of ['bm25', 'embedding', 'hybrid']) {
    await evaluate(`(() => {const e=document.querySelector('#retrieval-mode');e.value=${JSON.stringify(mode)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await fill('#question', question);
    const previousRequests = requests.filter(r => r.path === '/api/query').length;
    await click(button('提问', 'Ask'));
    const sentDeadline = Date.now() + 10000;
    while (requests.filter(r => r.path === '/api/query').length === previousRequests) {
      if (Date.now() > sentDeadline) throw new Error('Browser did not submit the new question');
      await sleep(100);
    }
    console.log(`Browser submitted ${mode} query…`);
    const result = await responseFor('/api/query');
    await wait("document.querySelector('article a[href^=\"/wiki/\"]')", `${mode} answer`, 240000);
    const r = result.response?.retrieval;
    if (!result.ok || r?.mode !== mode || !result.response.pagesUsed.length) throw new Error('Wrong mode or missing citations');
    for (const supplied of r.suppliedPages) {
      const page = await api(`/api/pages/${supplied.slug}`);
      if (createHash('sha256').update(page.content).digest('hex') !== supplied.contentHash || Buffer.byteLength(page.content) !== supplied.contentBytes) throw new Error('Supplied evidence fingerprint mismatch');
    }
    if (!result.response.pagesUsed.every(slug => r.suppliedPages.some(p => p.slug === slug))) throw new Error('Unsupported citation');
    report.queries.push({ mode, question, result });
  }
  const evidenceSummary = "document.querySelector('section details summary')";
  if (await evaluate(`Boolean(${evidenceSummary})`)) await click(evidenceSummary);
  await capture('round03-query.png', 'Hybrid answer and actual retrieved evidence');
  const href = await evaluate("document.querySelector('article a[href^=\"/wiki/\"]').getAttribute('href')");
  await click(`document.querySelector('article a[href=${JSON.stringify(href)}]')`);
  await wait(`location.pathname===${JSON.stringify(href)} && document.querySelector('a[href^="/sources/"]')`, 'inline Wiki citation');
  await capture('round03-wiki.png', 'Cited Wiki page with source lineage');
  const sourceHref = await evaluate("document.querySelector('section a[href^=\"/sources/\"]:not([target])').getAttribute('href')");
  const source = await api(sourceHref.replace('/sources/', '/api/sources/'));
  await click(`document.querySelector('section a[href=${JSON.stringify(sourceHref)}]:not([target])')`);
  await wait(`location.pathname===${JSON.stringify(sourceHref)} && document.querySelector('article') && [...document.querySelectorAll('h2')].some(e=>['原始内容','raw content'].includes(e.innerText.trim().toLowerCase()))`, 'original source');
  const raw = await evaluate("document.querySelector('article').innerText");
  const normalize = s => s.replace(/\s+/g, ' ').trim();
  const corpusId = source.rawText?.match(/corpus_id=(\d+)/)?.[1];
  const originalDoc = manifest.documents.find(d => d.corpus_id === corpusId);
  if (!originalDoc) throw new Error('Cited source is outside the verified demo manifest');
  const originalPath = resolve('data/scifact-demo', originalDoc.file);
  if (!originalPath.startsWith(resolve('data/scifact-demo') + '/')) throw new Error('Unsafe cited document path');
  const original = await readFile(originalPath, 'utf8');
  if (createHash('sha256').update(original).digest('hex') !== originalDoc.sha256) throw new Error('Cited demo input hash mismatch');
  // The raw file has a Markdown heading wrapper; rendered text has no '#'.
  // Compare the complete original corpus text instead of Markdown syntax.
  if (source.truncated || source.rawError || !source.rawText.includes(original.trim()) || !normalize(raw).includes(normalize(original))) {
    report.source_check_failure = { raw_api_has_original: source.rawText.includes(original.trim()), rendered: raw, expected: original };
    throw new Error('Rendered original source is incomplete');
  }
  if (!raw.includes('corpus_id=')) throw new Error('Original corpus ID missing');
  report.source_trace = { wiki: href, source: sourceHref, full_original_visible: true, corpus_ids: [...raw.matchAll(/corpus_id=(\d+)/g)].map(m => m[1]) };
  await capture('round03-source.png', 'Complete SciFact raw source and corpus ID');
  await cdp.send('Target.closeTarget', { targetId });
}

try {
  chrome = spawn(options.chromium, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const debuggerUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chromium did not start within 15 seconds')), 15000);
    chrome.once('error', error => { clearTimeout(timer); reject(error); });
    chrome.once('exit', code => { clearTimeout(timer); reject(new Error(`Chromium exited: ${code}`)); });
    chrome.stderr.on('data', chunk => {
      browserStderr = (browserStderr + chunk).slice(-12000);
      const match = browserStderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const socket = new WebSocket(debuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  cdp = new CDP(socket);
  report.browser = await cdp.send('Browser.getVersion');
  await uiChain();
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.message; process.exitCode = 1;
  console.error(error.stack);
} finally {
  if (cdp) await cdp.send('Browser.close').catch(() => {});
  if (chrome && chrome.exitCode === null) { chrome.kill('SIGTERM'); await sleep(500); }
  if (chrome && chrome.exitCode === null) chrome.kill('SIGKILL');
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  report.finished_at = new Date().toISOString();
  await writeFile(join(options.outputDir, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.status}: ${join(options.outputDir, 'browser.json')}`);
}
