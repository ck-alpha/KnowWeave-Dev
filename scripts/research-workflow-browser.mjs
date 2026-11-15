#!/usr/bin/env node
// Mutates only the dedicated artificial research fixture. No model calls here.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const options = {
  baseUrl: "http://127.0.0.1:3002",
  fixture: null,
  chromium: process.env.CHROMIUM_PATH || "chromium",
  outputDir: resolve(`.local/evidence/research-workflow/browser-${Date.now()}`),
};
for (let i = 2; i < process.argv.length; i++) {
  const name = {
    "--base-url": "baseUrl",
    "--fixture": "fixture",
    "--chromium": "chromium",
    "--output-dir": "outputDir",
  }[process.argv[i]];
  if (!name || !process.argv[i + 1])
    throw new Error(
      "Usage: node scripts/research-workflow-browser.mjs --fixture <fixture.json> [--base-url URL] [--chromium executable] [--output-dir new-directory]",
    );
  options[name] = process.argv[++i];
}
const base = new URL(options.baseUrl);
if (
  !["http:", "https:"].includes(base.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) ||
  base.username ||
  base.password ||
  ["3000", "3001"].includes(base.port) ||
  !options.fixture
)
  throw new Error("Require loopback URL and explicit --fixture.");
const fixture = JSON.parse(await readFile(options.fixture, "utf8"));
if (fixture.kind !== "KnowWeave Research QA" || fixture.synthetic !== true)
  throw new Error("Dedicated artificial research fixture required.");
const api = async (path, init) => {
  const response = await fetch(new URL(path, base), {
    ...init,
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
};
const settings = await api("/api/settings");
if (
  resolve(settings.wikiPath) !== resolve(fixture.wikiPath) ||
  settings.settings?.topic !== "KnowWeave Research QA"
)
  throw new Error("Active Wiki does not match research fixture.");
const wikiKey = createHash("sha256").update(fixture.wikiPath).digest("hex");
const report = {
  startedAt: new Date().toISOString(),
  status: "running",
  checks: [],
  screenshots: [],
  downloads: [],
  errors: [],
  httpErrors: [],
  writes: [],
  scope: "Artificial fixture, real Chromium interaction. No Qwen/Embedding calls in this script.",
};
await mkdir(options.outputDir, { recursive: true });
const reportPath = join(options.outputDir, "browser.json");
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
const profile = await mkdtemp(join(tmpdir(), "knowweave-graph-"));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let chrome;
let socket;
let captureFailure;

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
  const workspaceUrl = `/workspace?collection=${fixture.collectionId}`;
  await viewport(1440);
  await navigate(workspaceUrl);
  await check(
    "Workspace has scoped Query and template entrances",
    "!!document.querySelector('a[href^=\"/query?collection=\"]')&&document.body.innerText.includes('写研究笔记')",
  );
  await click("document.querySelector('a[href^=\"/query?collection=\"]')");
  await wait(
    "location.pathname==='/query'&&document.getElementById('query-scope')",
    "scoped Query",
  );
  await check(
    "Query shows selected collection",
    `document.getElementById('query-scope').value===${JSON.stringify(fixture.collectionId)}`,
  );
  await fill("document.getElementById('question')", "unmatchable_zxyq_7319");
  await click(button("提问"));
  await wait("document.body.innerText.includes('No matching Wiki evidence')", "no-hit answer");
  await fill("document.getElementById('question')", "edited_after_answer");
  const answerFiles = new Set(await readdir(downloadPath));
  await click(button("导出 Markdown"));
  const answerDownload = await completedDownload(answerFiles);
  record(
    "Answer download retains actual submitted scope and question",
    answerDownload.text.includes(fixture.collectionId) &&
      answerDownload.text.includes("amber-pilot") &&
      answerDownload.text.includes("unmatchable_zxyq_7319") &&
      !answerDownload.text.includes("edited_after_answer") &&
      !answerDownload.text.includes("outside-study"),
  );
  await screenshot("query-scope.png");
  await navigate(`/query?collection=${fixture.emptyCollectionId}`);
  await fill("document.getElementById('question')", "calibration");
  await check(
    "Empty collection blocks submission without full-library fallback",
    `${button("提问")}.disabled&&document.body.innerText.includes('还没有页面')`,
  );
  await selectValue("document.getElementById('query-scope')", "");
  await wait("location.pathname==='/query'&&!location.search", "explicit full-library selection");
  await check(
    "Full-library Query remains available",
    "document.getElementById('query-scope').value===''&&document.body.innerText.includes('全部页面')",
  );

  await navigate(`/sources/${fixture.sourceId}`);
  const raw = "document.querySelector('textarea[aria-label=\"原文定位文本\"]')";
  await wait(raw, "source selection control");
  await click(raw);
  await key("Home", "Home", 2);
  report.selectionSteps = [
    await evaluate(
      `({start:(${raw}).selectionStart,end:(${raw}).selectionEnd,active:document.activeElement?.getAttribute('aria-label')})`,
    ),
  ];
  const prefixSteps = await evaluate(
    `Array.from((${raw}).value.slice(0, (${raw}).value.lastIndexOf(${JSON.stringify(fixture.quote)}))).length`,
  );
  for (let i = 0; i < prefixSteps; i++) await key("ArrowRight");
  report.selectionSteps.push(
    await evaluate(`({start:(${raw}).selectionStart,end:(${raw}).selectionEnd})`),
  );
  for (const _ of fixture.quote) await key("ArrowRight", "ArrowRight", 8);
  report.selectionSteps.push(
    await evaluate(
      `({start:(${raw}).selectionStart,end:(${raw}).selectionEnd,text:(${raw}).value.slice((${raw}).selectionStart,(${raw}).selectionEnd)})`,
    ),
  );
  await check(
    "Native keyboard selection chooses the second repeated Chinese quote",
    `(${raw}).value.slice((${raw}).selectionStart,(${raw}).selectionEnd)===${JSON.stringify(fixture.quote)}&&(${raw}).selectionStart>40`,
  );
  await fill(
    `document.getElementById('new-excerpt-note-${fixture.sourceId}')`,
    "个人判断：需要更多样本，不是原文结论。",
  );
  await click(
    `[...document.querySelectorAll('section[aria-label="原文定位视图"] label')].find(e=>e.textContent.includes('琥珀'))`,
  );
  await click(button("保存摘录"));
  await wait("document.querySelector('[data-excerpt-id]')", "saved excerpt");
  const excerptId = await evaluate("document.querySelector('[data-excerpt-id]').dataset.excerptId");
  const saved = await api(`/api/excerpts/${excerptId}?wikiKey=${wikiKey}`);
  record(
    "Saved excerpt retains original CRLF offset, quote and collection",
    saved.excerpt.start === fixture.secondStart &&
      saved.excerpt.quote === fixture.quote &&
      saved.excerpt.collectionIds.includes(fixture.collectionId) &&
      saved.excerpt.locationStatus === "valid",
  );
  await navigate(workspaceUrl);
  await wait("document.querySelector('[data-excerpt-id]')", "collection excerpt");
  await check(
    "Collection separates original evidence from personal judgment",
    "document.querySelector('[data-excerpt-id]').innerText.includes('原文证据')&&document.querySelector('[data-excerpt-id]').innerText.includes('个人批注与判断')",
  );
  await click("document.querySelector('[data-excerpt-id] a[href*=\"excerpt=\"]')");
  await wait(raw, "return to source");
  await check(
    "Return selects saved second occurrence",
    `(${raw}).value.slice((${raw}).selectionStart,(${raw}).selectionEnd)===${JSON.stringify(fixture.quote)}&&(${raw}).selectionStart>40`,
  );
  const excerptFiles = new Set(await readdir(downloadPath));
  await click(button("导出摘录"));
  const excerptDownload = await completedDownload(excerptFiles);
  record(
    "Excerpt Markdown separates quote and annotation and preserves locator",
    excerptDownload.text.includes(fixture.quote) &&
      excerptDownload.text.includes("个人判断") &&
      excerptDownload.text.includes(excerptId) &&
      excerptDownload.text.includes(saved.excerpt.contentHash),
  );
  await click(`document.querySelector('[data-excerpt-id] a[href*="excerpt="]')`);
  await screenshot("source-excerpt.png", false);

  await navigate(workspaceUrl);
  const pageCountBefore = (await api("/api/pages")).pages.length;
  await click(button("写研究笔记"));
  await wait(
    "document.querySelector('dialog[open]')&&!document.querySelector('dialog').innerText.includes('正在读取')",
    "template dialog",
  );
  await check(
    "Template form clearly describes retrieval and verification",
    "document.querySelector('dialog').innerText.includes('正文可用于问答')&&document.querySelector('dialog').innerText.includes('只填写空白正文')",
  );
  await fill(field("标题"), "人工验收 · 研究阅读笔记");
  for (const [id, heading] of [
    ["literature", "方法与局限"],
    ["comparison", "比较对象与维度"],
    ["decision", "候选方案"],
  ]) {
    if (id !== "literature") await fill(field("正文"), " ");
    await selectValue(field("从研究模板开始"), id);
    await click(button("预填模板"));
    await check(
      `${id} prefills editable unverified research draft`,
      `(${field("正文")}).value.includes(${JSON.stringify(heading)})&&(${field("正文")}).value.includes('个人研究草稿')&&(${button("预填模板")}).disabled`,
    );
  }
  record(
    "Prefill does not create a page",
    (await api("/api/pages")).pages.length === pageCountBefore,
  );
  await fill(
    field("正文"),
    "# 人工研究笔记\n\n## 研究问题\n这份样例的局限是什么？\n\n## 原文证据\n请核对来源中的十二样本片段。\n\n## 个人判断（待核对）\n需要更多证据。\n\n## 下一步\n- [ ] 核对原文\n",
  );
  await check(
    "Edited draft cannot be overwritten by a template",
    `(${button("预填模板")}).disabled`,
  );
  await click(
    "[...document.querySelectorAll('dialog label')].find(e=>e.textContent.includes('中文重复文本定位样例'))",
  );
  await check(
    "Current collection is preselected",
    "[...document.querySelectorAll('dialog label')].find(e=>e.textContent.includes('琥珀')).querySelector('input').checked",
  );
  await evaluate(
    "document.querySelector('dialog').scrollTop=0;document.querySelector('dialog textarea').scrollTop=0",
  );
  await screenshot("research-template.png");
  await click(button("保存到 Wiki"));
  await wait("location.pathname.startsWith('/wiki/note-')", "saved research page");
  const noteSlug = await evaluate("decodeURIComponent(location.pathname.split('/').pop())");
  const note = await api(`/api/pages/${noteSlug}`);
  const noteWorkspace = await api(`/api/workspace/pages/${noteSlug}`);
  record(
    "Saved template preserves source and collection, remains unread",
    note.frontmatter.sources.includes(fixture.sourceId) &&
      note.content.includes("个人判断（待核对）") &&
      noteWorkspace.page.collectionIds.includes(fixture.collectionId) &&
      noteWorkspace.page.readingStatus === "unread",
  );

  for (const width of [390, 320]) {
    await viewport(width, 900);
    for (const path of [
      workspaceUrl,
      `/query?collection=${fixture.collectionId}`,
      `/sources/${fixture.sourceId}?excerpt=${excerptId}`,
    ]) {
      await navigate(path);
      await check(`${width}px ${path.split("?")[0]} has no page overflow`, noOverflow);
      await check(
        `${width}px ordinary UI uses 18px`,
        "parseFloat(getComputedStyle(document.body).fontSize)>=18",
      );
    }
  }
  await screenshot("excerpt-mobile.png", false);
  await viewport(1440, 1000);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await evaluate("document.documentElement.classList.contains('dark')")) break;
    await click(
      "[...document.querySelectorAll('button[aria-label]')].find(e=>/切换到.*主题|切换为跟随系统/.test(e.getAttribute('aria-label'))&&e.getBoundingClientRect().width>0)",
    );
  }
  await check("Dark theme is active", "document.documentElement.classList.contains('dark')");
  for (const width of [1440, 390, 320]) {
    await viewport(width, 900);
    for (const path of [
      workspaceUrl,
      `/query?collection=${fixture.collectionId}`,
      `/sources/${fixture.sourceId}?excerpt=${excerptId}`,
    ]) {
      await navigate(path);
      await check(`${width}px dark ${path.split("?")[0]} has no overflow`, noOverflow);
      if (path.startsWith("/sources/"))
        await check(
          `${width}px original text remains 20px`,
          `parseFloat(getComputedStyle(${raw}).fontSize)>=20`,
        );
    }
  }
  await screenshot("excerpt-mobile-dark.png", false);
  await viewport(390, 900);
  await navigate(workspaceUrl);
  await click(button("写研究笔记"));
  await wait("document.querySelector('dialog[open]')", "mobile template");
  await check(
    "Mobile template dialog fits viewport",
    "(()=>{const r=document.querySelector('dialog').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.height<=innerHeight})()",
  );
  await key("Escape");
  await check(
    "Escape closes template and restores visible focus",
    "!document.querySelector('dialog[open]')&&document.activeElement?.innerText.includes('写研究笔记')",
  );
  await viewport(1440, 1000);
  await navigate("/query");
  await fill("document.getElementById('question')", "old_wiki_unsent_draft");
  const wikiTrigger =
    "[...document.querySelectorAll('button[title]')].find(e=>e.title.startsWith('当前 Wiki'))";
  const wikiButtons = "[...document.querySelectorAll('[role=region] button')]";
  await click(wikiTrigger);
  await click(`${wikiButtons}.find(e=>e.innerText.trim()==='KnowWeave Research QA Other')`);
  await wait(
    `(${wikiTrigger}).title.includes('QA Other')&&document.getElementById('question').value===''`,
    "Wiki remount clears question",
  );
  await check(
    "Actual Wiki switch clears prior query draft and collections",
    "document.getElementById('question').value===''&&!document.getElementById('query-scope').innerText.includes('琥珀')",
  );
  await click(wikiTrigger);
  await click(`${wikiButtons}.find(e=>e.innerText.trim()==='KnowWeave Research QA')`);
  await wait(
    "document.getElementById('query-scope').innerText.includes('琥珀')",
    "restore original fixture Wiki",
  );
  await check(
    "Original fixture is restored after UI Wiki switch",
    `(${wikiTrigger}).title==='当前 Wiki：KnowWeave Research QA'`,
  );
  if (report.errors.length || report.httpErrors.length)
    throw new Error("Unexpected browser or HTTP errors");
  report.saved = { excerptId, noteSlug };

  report.status = "passed";
  console.log(
    JSON.stringify({
      status: report.status,
      checks: report.checks.length,
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
