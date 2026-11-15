#!/usr/bin/env node
// Interview rehearsal: genuine Chromium input and downloads, without model generation or Wiki writes.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const options = {
  baseUrl: "http://127.0.0.1:3002",
  fixture: null,
  chromium: process.env.CHROMIUM_PATH || "chromium",
  outputDir: resolve(`.local/evidence/interview-demo/browser-${Date.now()}`),
  three: false,
  model: false,
};
for (let index = 2; index < process.argv.length; index++) {
  if (process.argv[index] === "--model") {
    options.model = true;
    continue;
  }
  if (process.argv[index] === "--3d") {
    options.three = true;
    continue;
  }
  const name = {
    "--base-url": "baseUrl",
    "--fixture": "fixture",
    "--chromium": "chromium",
    "--output-dir": "outputDir",
  }[process.argv[index]];
  if (!name || !process.argv[index + 1] || process.argv[index + 1].startsWith("--"))
    throw new Error(
      "Usage: node scripts/interview-demo-browser.mjs --fixture <fixture.json> [--base-url http://127.0.0.1:3002] [--chromium executable] [--output-dir new-directory] [--3d] [--model]",
    );
  options[name] = process.argv[++index];
}
const base = new URL(options.baseUrl);
if (
  base.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
  !base.port ||
  ["3000", "3001"].includes(base.port) ||
  base.username ||
  base.password ||
  base.pathname !== "/" ||
  base.search ||
  base.hash ||
  !options.fixture
)
  throw new Error(
    "Require an explicit synthetic fixture and a dedicated loopback server, never 3000/3001.",
  );
const fixture = JSON.parse(await readFile(resolve(options.fixture), "utf8"));
if (
  fixture.kind !== "KnowWeave Interview Demo" ||
  fixture.synthetic !== true ||
  typeof fixture.wikiPath !== "string" ||
  typeof fixture.collectionId !== "string" ||
  typeof fixture.emptyCollectionId !== "string"
)
  throw new Error("Dedicated KnowWeave Interview Demo fixture required.");
const api = async (path) => {
  const response = await fetch(new URL(path, base), {
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
};
const settings = await api("/api/settings");
if (
  typeof settings.wikiPath !== "string" ||
  (await realpath(settings.wikiPath)) !== (await realpath(fixture.wikiPath)) ||
  settings.settings?.topic !== (fixture.topic || fixture.kind)
)
  throw new Error("Active Wiki does not match the interview fixture path and topic.");
const wikiKey = createHash("sha256").update(resolve(fixture.wikiPath)).digest("hex");
const snapshot = async () => {
  const [workspace, pages, sources, excerpts] = await Promise.all([
    api("/api/workspace"),
    api("/api/pages"),
    api("/api/sources"),
    api(`/api/excerpts?wikiKey=${wikiKey}`),
  ]);
  return { workspace, pages, sources, excerpts };
};
const before = await snapshot();
const collection = before.workspace.collections.find((item) => item.id === fixture.collectionId);
const empty = before.workspace.collections.find((item) => item.id === fixture.emptyCollectionId);
const members = before.workspace.pages.filter((item) =>
  item.collectionIds.includes(fixture.collectionId),
);
const page = members.find((item) => item.readingStatus === "reading") || members[0];
const excerpt = before.excerpts.excerpts.find(
  (item) => item.collectionIds.includes(fixture.collectionId) && item.locationStatus === "valid",
);
if (!collection || !empty || empty.pageCount !== 0 || !page || !excerpt)
  throw new Error(
    "Fixture needs a populated main collection, an empty collection and a valid original excerpt.",
  );
options.outputDir = resolve(options.outputDir);
await mkdir(dirname(options.outputDir), { recursive: true });
await mkdir(options.outputDir, { recursive: false });
const report = {
  startedAt: new Date().toISOString(),
  status: "running",
  checks: [],
  screenshots: [],
  downloads: [],
  errors: [],
  httpErrors: [],
  writes: [],
  scope:
    "Synthetic interview fixture; real Chromium navigation, mouse/keyboard and Markdown downloads. Default: no generated answers, document vectors or Wiki writes. --model explicitly adds one live BM25/Qwen answer and its usage/log record. Index status may inspect Ollama model metadata. Optional 3D uses software WebGL, not a device performance benchmark.",
  modelRequested: options.model,
};
const reportPath = join(options.outputDir, "browser.json");
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
const profile = await mkdtemp(join(tmpdir(), "knowweave-interview-"));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let chrome;
let socket;
let captureFailure;
let queryRequestId;

try {
  chrome = spawn(
    options.chromium,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--enable-unsafe-swiftshader",
      "--disable-background-networking",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  chrome.on("exit", (code, signal) => {
    report.chromiumExit = { code, signal };
  });
  const debuggerUrl = await new Promise((done, fail) => {
    let stderr = "";
    const timer = setTimeout(() => fail(new Error("Chromium startup timed out")), 15000);
    chrome.once("error", (error) => {
      clearTimeout(timer);
      fail(error);
    });
    chrome.once("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`Chromium exited: ${code}`));
    });
    chrome.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-12000);
      report.chromiumStderr = stderr;
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        done(match[1]);
      }
    });
  });
  socket = new WebSocket(debuggerUrl);
  await new Promise((done, fail) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", fail, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const item = pending.get(message.id);
      if (!item) return;
      clearTimeout(item.timer);
      pending.delete(message.id);
      if (message.error) item.fail(new Error(`${item.method}: ${message.error.message}`));
      else item.done(message.result);
      return;
    }
    const { method, params } = message;
    if (
      method === "Network.responseReceived" &&
      new URL(params.response.url).pathname === "/api/query"
    )
      queryRequestId = params.requestId;
    if (method === "Browser.downloadWillBegin")
      report.downloads.push({ guid: params.guid, suggestedFilename: params.suggestedFilename });
    if (method === "Browser.downloadProgress") {
      const download = report.downloads.find((item) => item.guid === params.guid);
      if (download) download.state = params.state;
    }
    if (method === "Runtime.exceptionThrown")
      report.errors.push(
        params.exceptionDetails.exception?.description ?? params.exceptionDetails.text,
      );
    if (method === "Runtime.consoleAPICalled" && params.type === "error")
      report.errors.push(params.args.map((arg) => arg.value ?? arg.description).join(" "));
    if (method === "Network.responseReceived" && params.response.status >= 400)
      report.httpErrors.push({ status: params.response.status, url: params.response.url });
    if (
      method === "Network.requestWillBeSent" &&
      ["POST", "PATCH", "DELETE", "PUT"].includes(params.request.method)
    )
      report.writes.push({
        method: params.request.method,
        path: new URL(params.request.url).pathname,
      });
  });
  socket.addEventListener("close", () => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.fail(new Error(`Browser closed during ${item.method}`));
    }
    pending.clear();
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((done, fail) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        fail(new Error(`CDP timeout: ${method}`));
      }, 30000);
      pending.set(id, { done, fail, timer, method });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  report.browser = await send("Browser.getVersion");
  const downloadPath = resolve(options.outputDir, "downloads");
  await mkdir(downloadPath, { recursive: true });
  await send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath,
    eventsEnabled: true,
  });
  const completedDownload = async (existing) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const names = await readdir(downloadPath);
      const name = names.find((item) => !existing.has(item) && !item.endsWith(".crdownload"));
      if (name && !names.some((item) => item.endsWith(".crdownload"))) {
        const text = await readFile(join(downloadPath, name), "utf8");
        return { name, text };
      }
      await sleep(150);
    }
    throw new Error("Real browser download did not complete");
  };
  const record = (label, passed) => {
    report.checks.push({ label, passed: Boolean(passed) });
    if (!passed) throw new Error(`Check failed: ${label}`);
  };
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await Promise.all(
    ["Page.enable", "Runtime.enable", "Network.enable"].map((method) =>
      send(method, {}, sessionId),
    ),
  );
  const evaluate = async (expression) => {
    const result = await send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      sessionId,
    );
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
      );
    return result.result.value;
  };
  const wait = async (expression, label, duration = 30000) => {
    const deadline = Date.now() + duration;
    while (Date.now() < deadline) {
      try {
        if (await evaluate(`Boolean(${expression})`)) return;
      } catch (error) {
        if (!/context|navigat|Cannot find/i.test(error.message)) throw error;
      }
      await sleep(150);
    }
    report.lastPage = await evaluate("({url:location.href,text:document.body.innerText})").catch(
      () => null,
    );
    throw new Error(`Timed out: ${label}`);
  };
  const check = async (label, expression) => {
    const passed = Boolean(await evaluate(expression));
    report.checks.push({ label, passed });
    if (!passed) throw new Error(`Check failed: ${label}`);
  };
  const click = async (expression) => {
    await wait(
      `(() => {const e=(${expression});return e&&!e.disabled&&e.getBoundingClientRect().width>0;})()`,
      `click ${expression}`,
    );
    const point = await evaluate(
      `(() => {const e=(${expression});e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
    );
    report.lastClick = await evaluate(
      `(() => {const hit=document.elementFromPoint(${point.x},${point.y});return {x:${point.x},y:${point.y},target:${JSON.stringify(expression)},hit:hit?.outerHTML.slice(0,800),node:hit?.closest('[data-graph-node]')?.dataset.graphNode};})()`,
    );
    for (const type of ["mousePressed", "mouseReleased"])
      await send(
        "Input.dispatchMouseEvent",
        { type, ...point, button: "left", clickCount: 1 },
        sessionId,
      );
    await sleep(170);
  };
  const key = async (name, code = name, modifiers = 0) => {
    const virtualKey = {
      Enter: 13,
      Escape: 27,
      Home: 36,
      ArrowDown: 40,
      ArrowRight: 39,
      ArrowLeft: 37,
      End: 35,
      ArrowUp: 38,
      Tab: 9,
      a: 65,
      "=": 187,
    }[name];
    for (const type of ["keyDown", "keyUp"])
      await send(
        "Input.dispatchKeyEvent",
        {
          type,
          key: name,
          code,
          modifiers,
          ...(virtualKey
            ? { windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey }
            : {}),
          ...(name === "Enter" && type === "keyDown" ? { text: "\r" } : {}),
        },
        sessionId,
      );
  };
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(e=>e.innerText.replace(/\\s/g,'').includes(${JSON.stringify(text.replace(/\s/g, ""))}))`;
  const aria = (text) => `document.querySelector('button[aria-label=${JSON.stringify(text)}]')`;
  const viewport = async (width, height = 1000) => {
    await send(
      "Emulation.setDeviceMetricsOverride",
      { width, height, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    await sleep(250);
  };
  const navigate = async (path) => {
    await send("Page.navigate", { url: new URL(path, base).href }, sessionId);
    await wait(
      `document.readyState==='complete'&&location.pathname===${JSON.stringify(path.split("?")[0])}`,
      `navigate ${path}`,
    );
    await sleep(600);
  };
  const screenshot = async (name, resetScroll = true) => {
    if (resetScroll)
      await evaluate(
        "window.scrollTo(0,0);document.documentElement.scrollTop=0;document.body.scrollTop=0;document.querySelector('main').scrollTop=0",
      );
    await sleep(250);
    const shot = await send(
      "Page.captureScreenshot",
      { format: "png", captureBeyondViewport: false },
      sessionId,
    );
    await writeFile(join(options.outputDir, name), Buffer.from(shot.data, "base64"));
    report.screenshots.push(name);
  };
  captureFailure = () => screenshot("failure.png");

  const field = (label) =>
    `document.getElementById([...document.querySelectorAll('label')].find(e=>e.textContent.trim().startsWith(${JSON.stringify(label)}))?.htmlFor)`;
  const fill = async (selector, text) => {
    await click(selector);
    await key("a", "KeyA", 2);
    await send("Input.insertText", { text }, sessionId);
  };
  const selectValue = async (selector, value) => {
    const index = await evaluate(
      `Array.from((${selector}).options).findIndex(o=>o.value===${JSON.stringify(value)})`,
    );
    if (index < 0) throw new Error(`Missing option ${value}`);
    await click(selector);
    await key("Escape");
    await key("Home");
    for (let i = 0; i < index; i++) await key("ArrowDown");
    await key("Enter");
    await wait(`(${selector}).value===${JSON.stringify(value)}`, `select ${value}`);
  };
  const noOverflow =
    "document.documentElement.scrollWidth<=innerWidth+1&&document.body.scrollWidth<=innerWidth+1";

  const workspaceUrl = `/workspace?collection=${encodeURIComponent(collection.id)}`;
  const queryUrl = `/query?collection=${encodeURIComponent(collection.id)}`;
  const sourceUrl = `/sources/${encodeURIComponent(excerpt.sourceId)}?excerpt=${encodeURIComponent(excerpt.id)}`;
  await viewport(1440, 1000);
  await navigate("/");
  await check(
    "首页呈现研究札记和真实继续阅读",
    "document.getElementById('desk-title')?.innerText.includes('Where knowledge')&&document.body.innerText.includes('接着上次的阅读')",
  );
  await screenshot("01-home.png");
  await click('document.querySelector(\'article[aria-label="阅读札记"] a[href^="/wiki/"]\')');
  await wait(
    "location.pathname.startsWith('/wiki/')&&document.body.innerText.includes('专题与笔记')",
    "home to reading",
  );
  await check("真实阅读页保留原始来源入口", "!!document.querySelector('a[href^=\"/sources/\"]')");
  await screenshot("02-reading.png");

  await navigate(workspaceUrl);
  await check(
    "主专题名称和实际阅读列表可见",
    `document.querySelector('section[aria-label="阅读列表"]').innerText.includes(${JSON.stringify(collection.title)})&&document.querySelectorAll('a[href^="/wiki/"]').length>=${members.length}`,
  );
  await check(
    "专题提供问答、图谱、研究笔记和导出入口",
    "!!document.querySelector('a[href^=\"/query?collection=\"]')&&!!document.querySelector('a[href^=\"/graph?collection=\"]')&&document.body.innerText.includes('写研究笔记')&&document.body.innerText.includes('导出阅读清单')",
  );
  await check(
    "桌面专题标题保留可读宽度，操作按钮不会挤碎标题",
    "(()=>{const h=document.querySelector('section[aria-label=\"阅读列表\"] h2'),r=h.getBoundingClientRect();return r.width>=360&&r.height<=parseFloat(getComputedStyle(h).lineHeight)*2+1})()",
  );
  await screenshot("03-workspace.png");
  await evaluate(
    "document.querySelector('section[aria-label=\"阅读列表\"]').scrollIntoView({block:'start'})",
  );
  await screenshot("03-workspace-reading.png", false);
  const existingDownloads = new Set(await readdir(downloadPath));
  await click(button("导出阅读清单"));
  const readingList = await completedDownload(existingDownloads);
  record(
    "真实下载包含全部成员和个人笔记边界",
    readingList.text.includes(collection.title) &&
      members.every((item) =>
        readingList.text.includes(`/wiki/${encodeURIComponent(item.slug)}`),
      ) &&
      readingList.text.includes("个人笔记") &&
      readingList.text.includes("不作为原文证据"),
  );

  await wait(
    `document.querySelector('[data-excerpt-id="${excerpt.id}"]')`,
    "saved original excerpt",
  );
  await check(
    "预置摘录区分原文和个人判断",
    `document.querySelector('[data-excerpt-id="${excerpt.id}"]').innerText.includes('原文证据')&&document.querySelector('[data-excerpt-id="${excerpt.id}"]').innerText.includes('个人批注与判断')`,
  );
  await click(`document.querySelector('[data-excerpt-id="${excerpt.id}"] a[href*="excerpt="]')`);
  const raw = "document.querySelector('textarea[aria-label=\"原文定位文本\"]')";
  await wait(
    `${raw}&&location.pathname===${JSON.stringify(`/sources/${excerpt.sourceId}`)}`,
    "return to original text",
  );
  await wait(`(${raw}).selectionEnd>(${raw}).selectionStart`, "selected original quote");
  await check(
    "返回原文准确选中预存摘录",
    `(${raw}).value.slice((${raw}).selectionStart,(${raw}).selectionEnd)===${JSON.stringify(excerpt.quote.replace(/\r\n/g, "\n"))}`,
  );
  await screenshot("04-source-excerpt.png", false);
  const excerptDownloads = new Set(await readdir(downloadPath));
  await click(
    `Array.from(document.querySelector('[data-excerpt-id="${excerpt.id}"]').querySelectorAll('button')).find(e=>e.innerText.includes('导出摘录'))`,
  );
  const excerptFile = await completedDownload(excerptDownloads);
  record(
    "摘录真实下载保留片段、指纹与定位",
    excerptFile.text.includes(excerpt.quote) &&
      excerptFile.text.includes(excerpt.contentHash) &&
      excerptFile.text.includes(excerpt.id),
  );

  await navigate(workspaceUrl);
  await click(button("写研究笔记"));
  await wait(
    "document.querySelector('dialog[open]')&&!document.querySelector('dialog').innerText.includes('正在读取')",
    "research draft dialog",
  );
  await check(
    "研究模板说明正文入检索与草稿边界",
    "document.querySelector('dialog').innerText.includes('正文可用于问答')&&document.querySelector('dialog').innerText.includes('只填写空白正文')",
  );
  await selectValue(field("从研究模板开始"), "decision");
  await click(button("预填模板"));
  await check(
    "决策模板仅预填草稿，不覆盖已有正文",
    `(${field("正文")}).value.includes('候选方案')&&(${field("正文")}).value.includes('个人研究草稿')&&(${button("预填模板")}).disabled`,
  );
  await check(
    "当前专题已预选",
    `[...document.querySelectorAll('dialog label')].find(e=>e.textContent.includes(${JSON.stringify(collection.title)}))?.querySelector('input')?.checked===true`,
  );
  await screenshot("05-research-template.png", false);
  await key("Escape");
  await check(
    "取消草稿回焦研究笔记入口",
    "!document.querySelector('dialog[open]')&&document.activeElement?.innerText.includes('写研究笔记')",
  );

  await click("document.querySelector('a[href^=\"/query?collection=\"]')");
  await wait(
    "location.pathname==='/query'&&document.getElementById('query-scope')",
    "scoped query",
  );
  await check(
    "专题问答显示提交范围",
    `document.getElementById('query-scope').value===${JSON.stringify(collection.id)}`,
  );
  await fill(
    "document.getElementById('question')",
    typeof fixture.questions?.main === "string"
      ? fixture.questions.main
      : "BM25、Embedding 和 Hybrid 如何选择？请说明依据和局限。",
  );
  await check(
    "三种检索选项可见，问题仍是未提交草稿",
    "document.body.innerText.includes('BM25')&&document.body.innerText.includes('Embedding')&&document.body.innerText.includes('Hybrid')",
  );
  await screenshot("06-query-scope.png");
  if (options.model) {
    await click(button("提问"));
    await wait(
      "document.querySelector('[data-testid=\"answer-scope\"]')||document.querySelector('[role=\"alert\"]')",
      "live Qwen answer",
      300000,
    );
    await check(
      "真实回答显示提交时的专题",
      `document.querySelector('[data-testid="answer-scope"]')?.innerText.includes(${JSON.stringify(collection.title)})`,
    );
    const wire = await send("Network.getResponseBody", { requestId: queryRequestId }, sessionId);
    const answer = JSON.parse(
      wire.base64Encoded ? Buffer.from(wire.body, "base64").toString("utf8") : wire.body,
    );
    report.answer = answer;
    const allowed = new Set(members.map((item) => item.slug));
    const supplied = new Set(answer.response.retrieval.suppliedPages.map((item) => item.slug));
    record(
      "真实Qwen回答引用来自本专题供给正文",
      answer.ok === true &&
        answer.mode === "bm25" &&
        answer.response.scope.collectionId === collection.id &&
        answer.response.pagesUsed.length > 0 &&
        answer.response.pagesUsed.every((slug) => supplied.has(slug)) &&
        [...supplied].every((slug) => allowed.has(slug)),
    );
    const answerDownloads = new Set(await readdir(downloadPath));
    await click(button("导出 Markdown"));
    const answerFile = await completedDownload(answerDownloads);
    record(
      "真实回答下载包含原问题、专题和引用",
      answerFile.text.includes(fixture.questions.main) &&
        answerFile.text.includes(collection.id) &&
        answer.response.pagesUsed.every((slug) => answerFile.text.includes(slug)),
    );
    await evaluate(
      "document.querySelector('[data-testid=\"answer-scope\"]').scrollIntoView({block:'start'})",
    );
    await screenshot("06-query-answer.png", false);
    const citedSlug = answer.response.pagesUsed[0];
    await click(`document.querySelector('a[href="/wiki/${citedSlug}"]')`);
    await wait(
      `location.pathname===${JSON.stringify(`/wiki/${citedSlug}`)}&&document.querySelector('#page-sources a[href^="/sources/"]')`,
      "answer citation to Wiki",
    );
    const citedPage = await api(`/api/pages/${encodeURIComponent(citedSlug)}`);
    const sourceHref = await evaluate(
      "document.querySelector('#page-sources a[href^=\"/sources/\"]').getAttribute('href')",
    );
    record(
      "实际回答引用页关联真实来源",
      citedPage.frontmatter.sources.includes(decodeURIComponent(sourceHref.split("/").pop())),
    );
    await click("document.querySelector('#page-sources a[href^=\"/sources/\"]')");
    await wait(
      `location.pathname===${JSON.stringify(sourceHref)}&&document.querySelector('textarea[aria-label="原文定位文本"]')`,
      "citation to original source",
    );
    await check(
      "完成实际回答到Wiki再到原始来源的链路",
      "document.querySelector('textarea[aria-label=\"原文定位文本\"]').value.length>0",
    );
    await screenshot("06-answer-source.png");
  }

  await navigate(`/query?collection=${encodeURIComponent(empty.id)}`);
  await fill("document.getElementById('question')", "BM25");
  await check(
    "空专题阻止提问且没有自动回到全库",
    `${button("提问")}.disabled&&document.getElementById('query-scope').value===${JSON.stringify(empty.id)}&&document.body.innerText.includes('还没有页面')`,
  );
  await screenshot("07-empty-scope.png");

  await navigate(workspaceUrl);
  await click("document.querySelector('a[href^=\"/graph?collection=\"]')");
  await wait(
    "location.pathname==='/graph'&&document.querySelector('svg[aria-label^=\"二维知识图谱\"]')",
    "scoped graph",
  );
  const nodeIds =
    "[...document.querySelectorAll('[data-graph-node]')].map(e=>e.dataset.graphNode).sort()";
  const expectedIds = JSON.stringify(members.map((item) => item.slug).sort());
  await wait(
    `JSON.stringify(${nodeIds})===${JSON.stringify(expectedIds)}`,
    "graph main collection nodes",
  );
  await check(
    "专题图谱恰好展示专题成员",
    `JSON.stringify(${nodeIds})===${JSON.stringify(expectedIds)}`,
  );
  await screenshot("08-graph-map.png");
  // The deep link selects a real page and keeps the same collection. It does not alter graph data.
  await navigate(
    `/graph?collection=${encodeURIComponent(collection.id)}&node=${encodeURIComponent(page.slug)}`,
  );
  await wait("document.querySelector('[data-graph-details]')", "relationship details");
  await check(
    "图谱详情保留实际页面和阅读入口",
    `document.querySelector('[data-graph-details]').innerText.includes(${JSON.stringify(page.title)})&&!!document.querySelector('a[href="/wiki/${page.slug}"]')`,
  );
  await check(
    "图谱详情展示引用方向",
    "document.querySelector('[data-graph-details]').innerText.includes('此页引用')&&document.querySelector('[data-graph-details]').innerText.includes('引用此页')&&document.querySelector('[data-graph-details]').innerText.includes('双向引用')",
  );
  await screenshot("09-graph-relations.png");
  if (options.three) {
    await click(button("Space"));
    await wait("document.querySelector('[aria-label=\"三维知识图谱\"] canvas')", "3D graph", 45000);
    await wait("document.querySelector('[data-spatial-node]')", "3D labels", 45000);
    await check(
      "三维视图保留页面选择和专题",
      `new URL(location.href).searchParams.get('node')===${JSON.stringify(page.slug)}&&new URL(location.href).searchParams.get('collection')===${JSON.stringify(collection.id)}`,
    );
    await screenshot("10-graph-space.png");
    await click(button("Map"));
    await wait("document.querySelector('svg[aria-label^=\"二维知识图谱\"]')", "return to 2D");
  }
  await click(`document.querySelector('a[href="/wiki/${page.slug}"]')`);
  await wait(`location.pathname===${JSON.stringify(`/wiki/${page.slug}`)}`, "graph to reading");
  await check(
    "图谱能回到原有 Wiki 正文",
    `document.body.innerText.includes(${JSON.stringify(page.title)})`,
  );

  await viewport(390, 900);
  for (const [name, path] of [
    ["home", "/"],
    ["workspace", workspaceUrl],
    ["query", queryUrl],
    ["source", sourceUrl],
    ["graph", `/graph?collection=${encodeURIComponent(collection.id)}`],
  ]) {
    await navigate(path);
    await check(`390px ${name} 无页面横向溢出`, noOverflow);
    await check(
      `390px ${name} 保留18px普通字号`,
      "parseFloat(getComputedStyle(document.body).fontSize)>=18",
    );
    await screenshot(`mobile-${name}.png`);
  }
  await navigate(workspaceUrl);
  await click(button("写研究笔记"));
  await wait("document.querySelector('dialog[open]')", "mobile template");
  await check(
    "窄屏模板对话框在可视区域内",
    "(()=>{const r=document.querySelector('dialog').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.height<=innerHeight+1})()",
  );
  await key("Escape");
  await check(
    "窄屏取消草稿后恢复入口焦点",
    "!document.querySelector('dialog[open]')&&document.activeElement?.innerText.includes('写研究笔记')",
  );

  const after = await snapshot();
  record(
    "浏览器演练未改变页面、来源、阅读记录或摘录",
    JSON.stringify(after) === JSON.stringify(before),
  );
  record(
    options.model
      ? "只提交一次明确请求的Query，未编辑Wiki"
      : "浏览器未发出业务写请求或模型生成请求",
    options.model
      ? report.writes.length === 1 &&
          report.writes[0].method === "POST" &&
          report.writes[0].path === "/api/query"
      : report.writes.length === 0,
  );
  record("没有浏览器运行错误", report.errors.length === 0);
  record("没有失败HTTP请求", report.httpErrors.length === 0);
  report.status = "passed";
  console.log(
    JSON.stringify({
      status: report.status,
      checks: report.checks.length,
      screenshots: report.screenshots.length,
      downloads: report.downloads.length,
      outputDir: options.outputDir,
    }),
  );
} catch (error) {
  report.status = "failed";
  report.failure = error.stack ?? String(error);
  await captureFailure?.().catch(() => {});
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  socket?.close();
  chrome?.kill("SIGTERM");
  await sleep(250);
  await rm(profile, { recursive: true, force: true });
}
