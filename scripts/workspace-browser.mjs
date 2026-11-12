#!/usr/bin/env node
// Real Chromium acceptance for the synthetic Workspace fixture. Does not call a model.
// All mutations use visible controls. API calls below only verify persisted results.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const options = {
  baseUrl: "http://127.0.0.1:3002",
  wikiPath: null,
  outputDir: resolve(
    `.local/evidence/workspace-upgrade/browser-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  ),
  chromium: process.env.CHROMIUM_PATH || "chromium",
};
for (let index = 2; index < process.argv.length; index++) {
  const key = {
    "--base-url": "baseUrl",
    "--wiki-path": "wikiPath",
    "--output-dir": "outputDir",
    "--chromium": "chromium",
  }[process.argv[index]];
  if (!key || !process.argv[index + 1])
    throw new Error(
      "Usage: node scripts/workspace-browser.mjs --wiki-path <fixture> [--base-url URL] [--output-dir directory] [--chromium executable]",
    );
  options[key] = process.argv[++index];
}
const base = new URL(options.baseUrl);
if (
  !["http:", "https:"].includes(base.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) ||
  base.username ||
  base.password ||
  !options.wikiPath
) {
  throw new Error("A loopback URL and exact --wiki-path of the dedicated fixture are required.");
}
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
  resolve(settings.wikiPath) !== resolve(options.wikiPath) ||
  settings.settings?.topic !== "KnowWeave Workspace QA"
) {
  throw new Error(
    "Fixture identity mismatch. Refusing to change this Wiki; require exact path and topic 'KnowWeave Workspace QA'.",
  );
}
const initialPages = (await api("/api/pages")).pages;
for (const [slug, title] of [
  ["research-methods", "研究方法与证据核对"],
  ["project-brief", "项目简报与决策记录"],
]) {
  if (!initialPages.some((page) => page.slug === slug && page.title === title))
    throw new Error(`Missing expected synthetic fixture page: ${slug}`);
}
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const collectionTitle = `QA 阅读专题 ${runId}`;
const note = `浏览器验收笔记 ${runId}：核对研究方法、证据与局限，再完成项目简报。`;
const report = {
  startedAt: new Date().toISOString(),
  status: "running",
  checks: [],
  screenshots: [],
  errors: [],
  httpErrors: [],
  scope:
    "Synthetic fixture; real UI collection creation/membership, bookmark, reading status, note, reload, library filters, table of contents, command palette, query templates, desktop/mobile light/dark layout. No model generation.",
  fixture: { topic: settings.settings.topic, pageCount: initialPages.length },
};
await mkdir(options.outputDir, { recursive: true });
const reportPath = join(options.outputDir, "browser.json");
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
const profile = await mkdtemp(join(tmpdir(), "knowweave-workspace-browser-"));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let chrome;
let socket;
let send;
let captureFailure;

try {
  chrome = spawn(
    options.chromium,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
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
  const browserRequests = [];
  let acceptExpectedConfirmation = false;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const item = pending.get(message.id);
      if (!item) return;
      clearTimeout(item.timer);
      pending.delete(message.id);
      if (message.error) item.fail(new Error(`${item.method}: ${message.error.message}`));
      else item.done(message.result);
    } else {
      const { method, params } = message;
      if (
        method === "Page.javascriptDialogOpening" &&
        acceptExpectedConfirmation &&
        params.type === "confirm"
      ) {
        void send("Page.handleJavaScriptDialog", { accept: true }, message.sessionId).catch(
          (error) => report.errors.push(error.message),
        );
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
        ["POST", "PATCH", "DELETE"].includes(params.request.method)
      )
        browserRequests.push({
          method: params.request.method,
          path: new URL(params.request.url).pathname,
        });
    }
  });
  socket.addEventListener("close", () => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.fail(new Error(`Browser closed during ${item.method}`));
    }
    pending.clear();
  });
  send = (method, params = {}, sessionId) =>
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
    report.lastPage = await evaluate("({url:location.href, text:document.body.innerText})").catch(
      () => null,
    );
    throw new Error(`Timed out: ${label}`);
  };
  const check = async (label, expression) => {
    const passed = Boolean(await evaluate(expression));
    report.checks.push({ label, passed });
    if (!passed) throw new Error(`Check failed: ${label}`);
  };
  const record = (label, passed) => {
    report.checks.push({ label, passed: Boolean(passed) });
    if (!passed) throw new Error(`Check failed: ${label}`);
  };
  const click = async (expression) => {
    await wait(
      `(() => { const element = (${expression}); return element && !element.disabled && element.getBoundingClientRect().width > 0; })()`,
      `click target: ${expression}`,
    );
    const point = await evaluate(
      `(() => { const element = (${expression}); if (!element || element.disabled) throw new Error('Missing/disabled UI target'); element.scrollIntoView({block:'center',inline:'nearest'}); const rect=element.getBoundingClientRect(); if(!rect.width||!rect.height)throw new Error('Hidden UI target'); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}; })()`,
    );
    for (const type of ["mousePressed", "mouseReleased"])
      await send(
        "Input.dispatchMouseEvent",
        { type, ...point, button: "left", clickCount: 1 },
        sessionId,
      );
    await sleep(100);
  };
  const key = async (name, code = name, modifiers = 0) => {
    const virtualKey = {
      Home: 36,
      End: 35,
      ArrowDown: 40,
      ArrowUp: 38,
      Enter: 13,
      Escape: 27,
      a: 65,
      k: 75,
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
  const button = (label) =>
    `[...document.querySelectorAll('button')].find(element => element.innerText.trim() === ${JSON.stringify(label)})`;
  const fill = async (selector, text) => {
    await click(`document.querySelector(${JSON.stringify(selector)})`);
    await key("a", "KeyA", 2);
    await send("Input.insertText", { text }, sessionId);
    await wait(
      `document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(text)}`,
      `replace input ${selector}`,
    );
  };
  const selectValue = async (selector, value) => {
    const index = await evaluate(
      `Array.from(document.querySelector(${JSON.stringify(selector)}).options).findIndex(option=>option.value===${JSON.stringify(value)})`,
    );
    if (index < 0) throw new Error(`Option missing: ${selector} / ${value}`);
    await click(`document.querySelector(${JSON.stringify(selector)})`);
    await key("Home");
    for (let i = 0; i < index; i++) await key("ArrowDown");
    await key("Enter");
    await wait(
      `document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(value)}`,
      `select ${value}`,
    );
  };
  const navigate = async (path) => {
    const target = new URL(path, base);
    await send("Page.navigate", { url: target.href }, sessionId);
    await wait(
      `document.readyState==='complete' && location.pathname===${JSON.stringify(target.pathname)} && !!document.querySelector('main')`,
      `navigate ${path}`,
    );
    await sleep(450);
  };
  const viewport = async (width) => {
    await send(
      "Emulation.setDeviceMetricsOverride",
      { width, height: width < 600 ? 844 : 1050, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    await sleep(200);
  };
  const screenshot = async (filename) => {
    await evaluate(
      "document.querySelectorAll('main,main *').forEach(element=>{if(element.scrollTop)element.scrollTop=0});window.scrollTo(0,0)",
    );
    await sleep(200);
    const text = await evaluate("document.body.innerText");
    if (/\/home\/|\/root\/|sk-[A-Za-z0-9]{15}/.test(text))
      throw new Error("Refusing a screenshot containing a machine path or possible secret.");
    const result = await send(
      "Page.captureScreenshot",
      { format: "png", captureBeyondViewport: false },
      sessionId,
    );
    await writeFile(join(options.outputDir, filename), Buffer.from(result.data, "base64"));
    report.screenshots.push({
      filename,
      bodySha256: createHash("sha256").update(text).digest("hex"),
    });
  };

  captureFailure = () => screenshot("failure.png");

  await viewport(1440);
  await navigate("/workspace");
  await wait("document.querySelector('h1')?.innerText.includes('把知识用在')", "Workspace visible");
  await click(button("新建专题"));
  await fill("#collection-title", collectionTitle);
  await fill(
    "#collection-description",
    "将研究证据转化为可核对的项目结论。此专题由真实浏览器验收创建。",
  );
  await click(button("保存专题"));
  await wait("!document.querySelector('#collection-title')", "Collection saved");
  const created = (await api("/api/workspace")).collections.find(
    (item) => item.title === collectionTitle,
  );
  record("Collection created and persisted through UI", !!created);
  report.collectionId = created.id;
  await click(
    `[...document.querySelectorAll('aside[aria-label="专题列表"] button')].find(element=>element.innerText.includes(${JSON.stringify(collectionTitle)}))`,
  );
  await wait("document.querySelector('#workspace-add-page')", "Add-page selector");
  await selectValue("#workspace-add-page", "research-methods");
  await click(button("加入专题"));
  await wait(
    "document.querySelector('section[aria-label=" +
      JSON.stringify("阅读列表") +
      "] article a[href=" +
      JSON.stringify("/wiki/research-methods") +
      "]')",
    "Page joined collection",
  );
  const starSelector = 'article button[aria-label="收藏 研究方法与证据核对"]';
  const unstarSelector = 'article button[aria-label="取消收藏 研究方法与证据核对"]';
  if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(unstarSelector)}))`)) {
    await click(`document.querySelector(${JSON.stringify(unstarSelector)})`);
    await wait(`document.querySelector(${JSON.stringify(starSelector)})`, "Bookmark removed");
    record(
      "Bookmark can be removed through UI",
      !(await api("/api/workspace/pages/research-methods")).page.starred,
    );
  }
  await click(`document.querySelector(${JSON.stringify(starSelector)})`);
  await wait(`document.querySelector(${JSON.stringify(unstarSelector)})`, "Bookmark saved");
  const statusSelector = 'article select[aria-label="研究方法与证据核对 的阅读状态"]';
  await selectValue(statusSelector, "reviewed");
  await wait("!document.querySelector('article select').disabled", "Reviewed status saved");
  record(
    "Reading state changes to reviewed through UI",
    (await api("/api/workspace/pages/research-methods")).page.readingStatus === "reviewed",
  );
  await selectValue(statusSelector, "reading");
  await wait("!document.querySelector('article select').disabled", "Reading status saved");
  let stored = (await api("/api/workspace/pages/research-methods")).page;
  record(
    "Membership, bookmark and reading status persist",
    stored.collectionIds.includes(created.id) &&
      stored.starred &&
      stored.readingStatus === "reading",
  );

  await click(
    "document.querySelector('article a[href=" + JSON.stringify("/wiki/research-methods") + "]')",
  );
  await wait(
    "location.pathname==='/wiki/research-methods' && document.querySelector('section[aria-label=" +
      JSON.stringify("个人阅读记录") +
      "] select')",
    "Open Wiki reading view",
  );
  await click(button("专题与笔记"));
  await wait(
    "document.querySelector('section[aria-label=" + JSON.stringify("个人阅读记录") + "] textarea')",
    "Reading note editor",
  );
  await fill('section[aria-label="个人阅读记录"] textarea', note);
  await click(button("保存专题与笔记"));
  await wait(
    "document.querySelector('section[aria-label=" +
      JSON.stringify("个人阅读记录") +
      "] [role=status]')?.innerText.includes('已保存')",
    "Note saved",
  );
  stored = (await api("/api/workspace/pages/research-methods")).page;
  record(
    "Personal note persisted without changing memberships",
    stored.note === note && stored.collectionIds.includes(created.id),
  );
  await navigate("/wiki/research-methods");
  await wait(
    "document.querySelector('section[aria-label=" + JSON.stringify("个人阅读记录") + "] select')",
    "Reading record after reload",
  );
  await click(button("专题与笔记"));
  await check(
    "Note and reading status survive full reload",
    `document.querySelector('section[aria-label="个人阅读记录"] textarea').value===${JSON.stringify(note)} && document.querySelector('section[aria-label="个人阅读记录"] select').value==='reading'`,
  );
  await wait(
    "document.querySelectorAll('nav[aria-label=" + JSON.stringify("文章目录") + "] a').length>=2",
    "Table of contents",
  );
  const anchor = await evaluate(
    "document.querySelectorAll('nav[aria-label=" +
      JSON.stringify("文章目录") +
      "] a')[1].getAttribute('href')",
  );
  await click(
    "document.querySelectorAll('nav[aria-label=" + JSON.stringify("文章目录") + "] a')[1]",
  );
  await wait(`location.hash===${JSON.stringify(anchor)}`, "Article heading navigation");
  await check(
    "Table of contents links to a real heading",
    `!!document.getElementById(${JSON.stringify(anchor.slice(1))})`,
  );

  await navigate(`/workspace?collection=${encodeURIComponent(created.id)}`);
  await wait(
    "[...document.querySelectorAll('button')].some(element=>element.innerText.trim()==='删除专题')",
    "Collection delete action",
  );
  acceptExpectedConfirmation = true;
  await click(button("删除专题"));
  await wait(
    `![...document.querySelectorAll('aside[aria-label="专题列表"] button')].some(element=>element.innerText.includes(${JSON.stringify(collectionTitle)}))`,
    "Collection removed",
  );
  acceptExpectedConfirmation = false;
  const afterDeletion = await api("/api/workspace/pages/research-methods");
  record(
    "Deleting a collection preserves the page and personal note",
    afterDeletion.page.note === note && !afterDeletion.page.collectionIds.includes(created.id),
  );

  await navigate("/wiki");
  await fill("#library-query", "研究方法与证据核对");
  await click(button("查找"));
  await wait(
    "new URL(location.href).searchParams.get('q')==='研究方法与证据核对'",
    "Library search navigation",
  );
  await wait("document.querySelector('main h3')", "Library search results");
  await check(
    "Library title filter finds the fixture",
    "[...document.querySelectorAll('main h3')].some(element=>element.innerText==='研究方法与证据核对') && ![...document.querySelectorAll('main h3')].some(element=>element.innerText==='项目简报与决策记录')",
  );
  await navigate("/wiki");
  await selectValue('form[action="/wiki"] select[name="tag"]', "科研");
  await click(button("查找"));
  await wait("new URL(location.href).searchParams.get('tag')==='科研'", "Library tag navigation");
  await check(
    "Library tag filter retains research page",
    "[...document.querySelectorAll('main h3')].some(element=>element.innerText==='研究方法与证据核对') && ![...document.querySelectorAll('main h3')].some(element=>element.innerText==='项目简报与决策记录')",
  );

  await click(
    "document.querySelector('header button[aria-label=" +
      JSON.stringify("搜索页面、会话或功能") +
      "]')",
  );
  await wait(
    "document.querySelector('[role=dialog][aria-label=" + JSON.stringify("搜索页面与功能") + "]')",
    "Search button opens command palette",
  );
  await fill('[role="dialog"] input', "研究方法与证据核对");
  await wait(
    "[...document.querySelectorAll('[role=dialog] button')].some(element=>element.innerText.includes('研究方法与证据核对'))",
    "Palette page match",
  );
  await key("Escape");
  await check("Escape closes command palette", "!document.querySelector('[role=dialog]')");
  await key("k", "KeyK", 2);
  await wait("document.querySelector('[role=dialog]')", "Ctrl+K opens palette");
  await key("Escape");

  await navigate("/query");
  await wait(
    "document.querySelector('section[aria-label=" + JSON.stringify("问题模板") + "] button')",
    "Query templates",
  );
  const templates = await evaluate(
    "[...document.querySelectorAll('section[aria-label=" +
      JSON.stringify("问题模板") +
      "] button')].map(button=>button.querySelector('span:last-child').innerText)",
  );
  for (let index = 0; index < templates.length; index++) {
    await click(`document.querySelectorAll('section[aria-label="问题模板"] button')[${index}]`);
    await check(
      `Query template ${index + 1} fills editable question`,
      `document.querySelector('#question').value===${JSON.stringify(templates[index])}`,
    );
  }
  record(
    "Template interactions do not submit a model request",
    !browserRequests.some((request) => request.path === "/api/query"),
  );

  for (const theme of ["light", "dark"]) {
    await evaluate(`localStorage.setItem('llm-wiki:theme',${JSON.stringify(theme)})`);
    for (const width of [1440, 390]) {
      await viewport(width);
      for (const [path, name] of [
        ["/", "home"],
        ["/workspace", "workspace"],
        ["/wiki", "library"],
        ["/wiki/research-methods", "reading"],
        ["/query", "query"],
      ]) {
        await navigate(path);
        if (name === "reading")
          await wait(
            "document.querySelector('section[aria-label=" +
              JSON.stringify("个人阅读记录") +
              "] select')",
            "Reading metadata loaded",
          );
        await check(
          `${name} ${theme} ${width}: no horizontal overflow`,
          "document.documentElement.scrollWidth<=innerWidth && document.querySelector('main').scrollWidth<=innerWidth",
        );
        await check(
          `${name} ${theme} ${width}: requested theme applied`,
          `document.documentElement.classList.contains('dark')===${theme === "dark"}`,
        );
        await screenshot(`${name}-${theme}-${width}.png`);
      }
    }
  }
  await click(
    "document.querySelector('header button[aria-label=" + JSON.stringify("打开导航菜单") + "]')",
  );
  await wait("document.querySelector('#tools-navigation')", "Mobile navigation opened");
  await key("Escape");
  await check("Mobile menu closes on Escape", "!document.querySelector('#tools-navigation')");
  record(
    "Browser has no runtime or HTTP errors",
    !report.errors.length && !report.httpErrors.length,
  );
  report.requests = browserRequests;
  report.status = "passed";
  await send("Target.closeTarget", { targetId });
} catch (error) {
  await captureFailure?.().catch(() => {});
  report.status = "failed";
  report.error = error.stack ?? String(error);
  process.exitCode = 1;
  console.error(report.error);
} finally {
  if (send && socket?.readyState === WebSocket.OPEN) await send("Browser.close").catch(() => {});
  socket?.close();
  if (chrome?.exitCode === null) {
    chrome.kill("SIGTERM");
    await sleep(300);
  }
  if (chrome?.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  report.finishedAt = new Date().toISOString();
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(
    `${report.status}: ${report.checks.filter((item) => item.passed).length}/${report.checks.length} checks; ${reportPath}`,
  );
}
