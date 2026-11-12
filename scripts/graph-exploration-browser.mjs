#!/usr/bin/env node
// Read-only relationship exploration acceptance for the dedicated KnowWeave Graph QA fixture.
// Uses real Chromium mouse/keyboard input; never calls a model or writes Wiki pages.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const options = {
  baseUrl: "http://127.0.0.1:3002",
  wikiPath: null,
  chromium: process.env.CHROMIUM_PATH || "chromium",
  outputDir: resolve(`.local/evidence/graph-exploration/browser-${Date.now()}`),
};
for (let index = 2; index < process.argv.length; index++) {
  const key = {
    "--base-url": "baseUrl",
    "--wiki-path": "wikiPath",
    "--chromium": "chromium",
    "--output-dir": "outputDir",
  }[process.argv[index]];
  if (!key || !process.argv[index + 1])
    throw new Error(
      "Usage: node scripts/graph-exploration-browser.mjs --wiki-path <fixture> [--base-url URL] [--chromium executable] [--output-dir new-directory]",
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
)
  throw new Error("Require a loopback URL and exact --wiki-path.");
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
  settings.settings?.topic !== "KnowWeave Graph QA"
)
  throw new Error("Require matching fixture path and topic 'KnowWeave Graph QA'.");
const pages = (await api("/api/pages")).pages;
if (
  pages.length !== 18 ||
  !pages.some((page) => page.slug === "knowledge-map" && page.title === "知识库与知识连接") ||
  !pages.some((page) => page.slug === "isolated")
)
  throw new Error("Expected the dedicated 18-page Graph QA fixture.");
const workspaceBefore = await api("/api/workspace");
const populatedCollections = workspaceBefore.collections.filter((item) => item.pageCount > 0);
const emptyCollection = workspaceBefore.collections.find((item) => item.pageCount === 0);
const fixturePage = workspaceBefore.pages.find((page) => page.slug === "knowledge-map");
if (
  populatedCollections.length < 2 ||
  !emptyCollection ||
  !fixturePage?.starred ||
  fixturePage.readingStatus !== "reading"
)
  throw new Error(
    "Graph QA fixture requires two nonempty collections, an empty collection, and starred/reading knowledge-map.",
  );
const documentsBefore = await Promise.all(
  pages.map((page) => api(`/api/pages/${encodeURIComponent(page.slug)}`)),
);
const known = new Set(pages.map((page) => page.slug));
const actualLinks = documentsBefore.flatMap((page) =>
  [
    ...new Set(
      [...page.content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((match) => match[1].trim()),
    ),
  ]
    .filter((target) => known.has(target) && target !== page.slug)
    .map((target) => ({ source: page.slug, target })),
);
const isolatedIds = pages
  .filter(
    (page) => !actualLinks.some((edge) => edge.source === page.slug || edge.target === page.slug),
  )
  .map((page) => page.slug);
const report = {
  startedAt: new Date().toISOString(),
  status: "running",
  checks: [],
  screenshots: [],
  downloads: [],
  errors: [],
  httpErrors: [],
  writes: [],
  fixture: { topic: settings.settings.topic, pages: pages.length },
  scope:
    "Synthetic graph; real Chromium interaction. Software WebGL rendering, not hardware/mobile performance acceptance. No Wiki writes or model calls.",
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
  const screenshot = async (name) => {
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
  const fill = async (text) => {
    await click("document.querySelector('input[aria-label=\"搜索图谱页面\"]')");
    await key("a", "KeyA", 2);
    await send("Input.insertText", { text }, sessionId);
    await sleep(350);
  };
  const map = "document.querySelector('svg[aria-label^=\"二维知识图谱\"]')";
  const count = "document.querySelectorAll('[data-graph-node]').length";
  const selected = "new URL(location.href).searchParams.get('node')";
  const detail = "document.querySelector('[data-graph-details]')";
  const collectionSelect = "document.querySelector('select[aria-label=\"图谱专题\"]')";
  const scopeSelect = "document.querySelector('select[aria-label=\"图谱范围\"]')";
  const filterToggle = aria("图谱筛选");
  const nodeIds =
    "[...document.querySelectorAll('[data-graph-node]')].map(e=>e.dataset.graphNode).sort()";
  const selectValue = async (expression, value) => {
    await wait(expression, `native select ${expression}`);
    const index = await evaluate(
      `Array.from((${expression}).options).findIndex(option=>option.value===${JSON.stringify(value)})`,
    );
    if (index < 0) throw new Error(`Missing native option ${value}`);
    // Move focus using the real pointer, then drive the native control by keys.
    await click(expression);
    await key("Escape");
    await key("Home");
    for (let i = 0; i < index; i++) await key("ArrowDown");
    await key("Enter");
    await wait(`(${expression}).value===${JSON.stringify(value)}`, `select value ${value}`);
  };
  const expectedIds = async (label, ids) => {
    const expected = JSON.stringify([...ids].sort());
    await wait(`JSON.stringify(${nodeIds})===${JSON.stringify(expected)}`, label);
    await check(label, `JSON.stringify(${nodeIds})===${JSON.stringify(expected)}`);
  };
  const noOverflow =
    "document.documentElement.scrollWidth<=innerWidth&&document.querySelector('main').scrollWidth<=innerWidth";
  await viewport(1440);
  await navigate("/graph");
  await wait(`${count}===18`, "graph hydration");
  await check(
    "Graph uses the research atlas heading",
    "document.querySelector('h1').innerText.includes('知识之间，自有脉络')",
  );
  await check(
    "Collection and isolation controls are labelled",
    `!!(${collectionSelect})&&!!(${scopeSelect})`,
  );
  await screenshot("graph-atlas-light.png");

  for (const collection of populatedCollections) {
    await selectValue(collectionSelect, collection.id);
    await expectedIds(
      `Collection contains only its ${collection.pageCount} real members`,
      workspaceBefore.pages
        .filter((page) => page.collectionIds.includes(collection.id))
        .map((page) => page.slug),
    );
  }
  const activeCollection =
    populatedCollections.find((item) => fixturePage.collectionIds.includes(item.id)) ??
    populatedCollections[0];
  await selectValue(collectionSelect, activeCollection.id);
  const activeMembers = workspaceBefore.pages.filter((page) =>
    page.collectionIds.includes(activeCollection.id),
  );
  const conceptCount = activeMembers.filter((page) => page.type === "concept").length;
  if (conceptCount > 0) {
    await click(button("Concept"));
    await expectedIds(
      "Type and collection filters combine",
      activeMembers.filter((page) => page.type === "concept").map((page) => page.slug),
    );
    await click(button("全部"));
  }
  await fill("no-graph-result-zz");
  await check(
    "Collection search offers a recoverable empty state",
    "document.body.innerText.includes('没有找到匹配页面')",
  );
  await click(button("清除筛选"));
  await expectedIds(
    "Clear filters restores the complete graph",
    pages.map((page) => page.slug),
  );
  await selectValue(collectionSelect, emptyCollection.id);
  await check(
    "Empty collection keeps the filter usable",
    `${count}===0&&!!(${collectionSelect})&&!!(${button("清除筛选")})`,
  );
  await screenshot("graph-atlas-empty-collection.png");
  await click(button("清除筛选"));
  await navigate("/graph?collection=deleted-topic-qa");
  await wait("document.body.innerText.includes('该专题已不存在')", "deleted topic bookmark");
  await check(
    "Deleted topic bookmark is explicit and does not expose unrelated pages",
    `${count}===0&&${collectionSelect}.value==='deleted-topic-qa'`,
  );
  await click(button("清除筛选"));
  await selectValue(scopeSelect, "isolated");
  await expectedIds(
    "Isolation means no real incoming or outgoing links in the full Wiki",
    isolatedIds,
  );
  await screenshot("graph-atlas-isolated.png");
  await click(button("清除筛选"));

  await navigate("/graph?node=knowledge-map");
  await wait(`${selected}==='knowledge-map'&&!!(${detail})`, "selected page details");
  await check(
    "Selected page keeps the reading action and first citation heading in view",
    `(() => {const details=${detail},bounds=details.getBoundingClientRect();return [details.querySelector('a[href=\"/wiki/knowledge-map\"]'),details.querySelector('[data-relation=\"outgoing\"] h3')].every(e=>{if(!e)return false;const r=e.getBoundingClientRect();return r.top>=bounds.top&&r.bottom<=bounds.bottom})})()`,
  );
  await check(
    "Graph reads actual personal reading status",
    `${detail}.innerText.includes('阅读中')`,
  );
  await check(
    "Graph reads actual starred state",
    `${detail}.innerText.includes('已收藏')||!!${detail}.querySelector('[aria-label*=\"收藏\"]')`,
  );
  for (const id of fixturePage.collectionIds) {
    const collection = workspaceBefore.collections.find((item) => item.id === id);
    await check(
      `Selected page includes collection ${collection.title}`,
      `${detail}.innerText.includes(${JSON.stringify(collection.title)})`,
    );
  }
  for (const selectedSlug of ["source-tracing", "retrieval", "knowledge-map"]) {
    await navigate(`/graph?node=${selectedSlug}`);
    await wait(
      `${selected}===${JSON.stringify(selectedSlug)}&&!!(${detail})`,
      "directional relationship details",
    );
    const outgoing = new Set(
      actualLinks.filter((edge) => edge.source === selectedSlug).map((edge) => edge.target),
    );
    const incoming = new Set(
      actualLinks.filter((edge) => edge.target === selectedSlug).map((edge) => edge.source),
    );
    const relationExpected = {
      outgoing: [...outgoing].filter((id) => !incoming.has(id)),
      incoming: [...incoming].filter((id) => !outgoing.has(id)),
      bidirectional: [...outgoing].filter((id) => incoming.has(id)),
    };
    for (const [kind, ids] of Object.entries(relationExpected)) {
      const selector = `document.querySelector('[data-relation="${kind}"]')`;
      for (const id of ids) {
        const title = pages.find((page) => page.slug === id).title;
        await check(
          `${selectedSlug} ${kind}: ${id} belongs to the correct direction`,
          `!!(${selector})&&${selector}.innerText.includes(${JSON.stringify(title)})`,
        );
      }
      if (ids.length) {
        await check(
          `${selectedSlug} ${kind}: contains exactly the actual related pages`,
          `${selector}.querySelectorAll('button').length===${ids.length}`,
        );
      }
    }
  }
  await screenshot("graph-atlas-selected.png");

  await selectValue(collectionSelect, activeCollection.id);
  const relatedIds = [
    ...new Set(
      actualLinks.flatMap((edge) =>
        edge.source === "knowledge-map"
          ? [edge.target]
          : edge.target === "knowledge-map"
            ? [edge.source]
            : [],
      ),
    ),
  ];
  const memberIds = new Set(activeMembers.map((page) => page.slug));
  const insideTarget = relatedIds.find((id) => memberIds.has(id));
  const outsideTarget = relatedIds.find((id) => !memberIds.has(id));
  for (const [target, staysInTopic] of [
    [insideTarget, true],
    [outsideTarget, false],
  ]) {
    if (!target) continue;
    await navigate(
      `/graph?node=knowledge-map&collection=${encodeURIComponent(activeCollection.id)}`,
    );
    const title = pages.find((page) => page.slug === target).title;
    const relationshipButton = `[...document.querySelectorAll('[data-relation] button')].find(e=>e.innerText.includes(${JSON.stringify(title)}))`;
    await click(relationshipButton);
    await wait(`${selected}===${JSON.stringify(target)}`, "follow actual relationship");
    await check(
      staysInTopic
        ? "Following an in-topic reference preserves the topic"
        : "Following an external reference visibly opens the full Wiki",
      `${collectionSelect}.value===${JSON.stringify(staysInTopic ? activeCollection.id : "")}`,
    );
  }
  await navigate(`/graph?node=knowledge-map&collection=${encodeURIComponent(activeCollection.id)}`);
  await expectedIds(
    "Topic bookmarks reopen the real scoped graph",
    activeMembers.map((page) => page.slug),
  );
  await click(button("Space"));
  await wait("document.querySelector('[aria-label=\"三维知识图谱\"] canvas')", "3D atlas", 45000);
  await check(
    "2D and 3D share the active collection and selected page",
    `${collectionSelect}.value===${JSON.stringify(activeCollection.id)}&&${selected}==='knowledge-map'`,
  );
  await sleep(700);
  await screenshot("graph-atlas-3d-light.png");
  await click(button("Map"));
  await expectedIds(
    "Returning to 2D preserves actual collection members",
    activeMembers.map((page) => page.slug),
  );
  await click(button("重置探索"));
  await expectedIds(
    "Reset clears all exploration scopes",
    pages.map((page) => page.slug),
  );
  await check("Reset clears selected page", `!${selected}`);

  for (const theme of ["dark", "light"]) {
    await viewport(1440);
    for (
      let cycle = 0;
      cycle < 3 &&
      (await evaluate(`document.documentElement.classList.contains('dark')!==${theme === "dark"}`));
      cycle++
    ) {
      await click(
        "[...document.querySelectorAll('button')].find(e=>/切换到.*主题|切换为跟随系统/.test(e.getAttribute('aria-label')||'')&&e.getBoundingClientRect().width>0)",
      );
    }
    await check(
      `Theme is ${theme}`,
      `document.documentElement.classList.contains('dark')===${theme === "dark"}`,
    );
    for (const width of [1440, 768, 390, 320]) {
      await viewport(width, 1000);
      await check(`${theme} ${width}px has no page overflow`, noOverflow);
      if (width === 1440)
        await check(
          `${theme} desktop atlas retains the available width after exploration`,
          "document.querySelector('h1').closest('header').parentElement.getBoundingClientRect().width>=document.querySelector('main').clientWidth-2",
        );
      await check(
        `${theme} ${width}px filter controls fit their container`,
        `(() => {const controls=[${collectionSelect},${scopeSelect}];return controls.every(e=>{const r=e.getBoundingClientRect();if(innerWidth<640&&${filterToggle}?.getAttribute('aria-expanded')==='false')return r.width===0;return r.width>0&&r.width<=innerWidth&&e.scrollWidth<=e.clientWidth+2})})()`,
      );
      if (width === 1440 || width === 390) await screenshot(`graph-atlas-${theme}-${width}.png`);
    }
  }
  await viewport(390, 900);
  await navigate("/graph");
  await wait(`${count}===18&&!!(${filterToggle})`, "mobile atlas ready");
  await evaluate(
    "window.scrollTo(0,0);document.documentElement.scrollTop=0;document.body.scrollTop=0;document.querySelector('main').scrollTop=0",
  );
  await check(
    "Mobile graph opens with secondary filters collapsed",
    `${filterToggle}.getAttribute('aria-expanded')==='false'&&${collectionSelect}.getBoundingClientRect().width===0&&${scopeSelect}.getBoundingClientRect().width===0`,
  );
  await check(
    "Mobile first screen exposes actual graph nodes",
    `(() => {const footer=document.querySelector('footer').getBoundingClientRect();const mapBounds=${map}.getBoundingClientRect();return [...document.querySelectorAll('[data-graph-node] circle')].some(e=>{const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return x>=mapBounds.left&&x<=mapBounds.right&&y>=Math.max(mapBounds.top,0)&&y<Math.min(footer.top,innerHeight,mapBounds.bottom)})})()`,
  );
  await screenshot("graph-atlas-mobile-first-screen.png");
  await click(filterToggle);
  await check(
    "Mobile filters expand to usable native controls",
    `${filterToggle}.getAttribute('aria-expanded')==='true'&&${collectionSelect}.getBoundingClientRect().width>0&&${scopeSelect}.getBoundingClientRect().width>0`,
  );
  await selectValue(collectionSelect, activeCollection.id);
  await expectedIds(
    "Mobile collection filter selects actual members",
    activeMembers.map((page) => page.slug),
  );
  await check(
    "Mobile filter count reports the active topic",
    `${filterToggle}.innerText.includes('1')`,
  );
  await click(filterToggle);
  await check(
    "Closing mobile filters removes the controls from layout",
    `${filterToggle}.getAttribute('aria-expanded')==='false'&&${collectionSelect}.getBoundingClientRect().width===0&&${scopeSelect}.getBoundingClientRect().width===0`,
  );
  await viewport(640);
  await check(
    "At 640px the expanded layout restores focus to a visible filter control",
    `document.activeElement===${collectionSelect}`,
  );
  await viewport(639, 900);
  await check(
    "At 639px the collapsed layout returns hidden filter focus to its toggle",
    `document.activeElement===${filterToggle}`,
  );
  await viewport(390, 900);
  const hiddenFocusTargets = [];
  for (let step = 0; step < 14; step++) {
    await key("Tab");
    if (
      await evaluate(
        "['graph-scope-filters','graph-type-filters'].some(id=>document.getElementById(id)?.contains(document.activeElement))",
      )
    )
      hiddenFocusTargets.push(step);
  }
  record("Collapsed mobile filters stay out of the Tab path", hiddenFocusTargets.length === 0);
  await navigate(`/graph?collection=${encodeURIComponent(activeCollection.id)}`);
  await wait(
    `${collectionSelect}.value===${JSON.stringify(activeCollection.id)}`,
    "mobile topic bookmark",
  );
  await check(
    "Mobile topic bookmark keeps scope and active count while collapsed",
    `${filterToggle}.getAttribute('aria-expanded')==='false'&&${filterToggle}.innerText.includes('1')`,
  );
  await expectedIds(
    "Mobile bookmark contains only its actual topic members",
    activeMembers.map((page) => page.slug),
  );
  await screenshot("graph-atlas-mobile-topic.png");

  await viewport(1440);
  await navigate("/graph?node=knowledge-map");
  await wait("document.querySelector('a[href=\"/wiki/knowledge-map\"]')", "reading action");
  await click("document.querySelector('a[href=\"/wiki/knowledge-map\"]')");
  await wait("location.pathname==='/wiki/knowledge-map'", "original Wiki page");
  await check(
    "Read action opens the selected Wiki page",
    "document.body.innerText.includes('知识库与知识连接')",
  );
  await navigate("/graph?node=knowledge-map");
  const workspaceLink = `${detail}.querySelector('a[href^="/workspace?"]')`;
  await wait(workspaceLink, "collection reading link");
  const targetHref = await evaluate(`${workspaceLink}.getAttribute('href')`);
  await click(workspaceLink);
  await wait("location.pathname==='/workspace'", "collection workspace");
  await check(
    "Collection link opens its real workspace",
    `location.pathname+location.search===${JSON.stringify(targetHref)}`,
  );

  const graphLink = "[...document.querySelectorAll('a')].find(e=>e.innerText.includes('专题图谱'))";
  await wait(graphLink, "workspace graph entry");
  const graphTarget = await evaluate(`${graphLink}.getAttribute('href')`);
  await click(graphLink);
  await wait("location.pathname==='/graph'", "workspace to scoped graph");
  const linkedCollectionId = new URL(graphTarget, base).searchParams.get("collection");
  await expectedIds(
    "Workspace graph entry opens exactly the chosen topic",
    workspaceBefore.pages
      .filter((page) => page.collectionIds.includes(linkedCollectionId))
      .map((page) => page.slug),
  );
  await check(
    "Topic deep link is reflected in its filter",
    `${collectionSelect}.value===${JSON.stringify(linkedCollectionId)}`,
  );

  await navigate(`/workspace?collection=${encodeURIComponent(activeCollection.id)}`);
  await wait(button("导出阅读清单"), "topic export action");
  await click("document.querySelector('input[aria-label=\"搜索阅读列表\"]')");
  await send("Input.insertText", { text: "no-matching-reading-page-qa" }, sessionId);
  await wait(
    "document.querySelector('input[aria-label=\"搜索阅读列表\"]').value==='no-matching-reading-page-qa'",
    "empty search in topic",
  );
  await check(
    "Topic export remains available when its visible list is empty",
    `!${button("导出阅读清单")}.disabled&&document.querySelector('section[aria-label=\"阅读列表\"]').querySelectorAll('a[href^=\"/wiki/\"]').length===0`,
  );
  let existingDownloads = new Set(await readdir(downloadPath));
  await click(button("导出阅读清单"));
  const readingDownload = await completedDownload(existingDownloads);
  record(
    "Downloaded Markdown includes the complete topic despite active search",
    activeMembers.every((page) =>
      readingDownload.text.includes(`/wiki/${encodeURIComponent(page.slug)}`),
    ),
  );
  record(
    "Downloaded Markdown excludes pages outside the topic",
    workspaceBefore.pages
      .filter((page) => !page.collectionIds.includes(activeCollection.id))
      .every((page) => !readingDownload.text.includes(`/wiki/${encodeURIComponent(page.slug)})`)),
  );
  record(
    "Downloaded Markdown identifies its topic and actual reading status",
    readingDownload.text.includes(activeCollection.title) &&
      readingDownload.text.includes("阅读中"),
  );
  await navigate(`/workspace?collection=${encodeURIComponent(emptyCollection.id)}`);
  await wait(button("导出阅读清单"), "empty topic export action");
  existingDownloads = new Set(await readdir(downloadPath));
  await click(button("导出阅读清单"));
  const emptyDownload = await completedDownload(existingDownloads);
  record(
    "An empty topic still downloads with its title and no unrelated pages",
    emptyDownload.text.includes(emptyCollection.title) && !emptyDownload.text.includes("/wiki/"),
  );
  record(
    "Browser reports both real downloads completed",
    report.downloads.length === 2 && report.downloads.every((item) => item.state === "completed"),
  );

  const workspaceAfter = await api("/api/workspace");
  const documentsAfter = await Promise.all(
    pages.map((page) => api(`/api/pages/${encodeURIComponent(page.slug)}`)),
  );
  const unchanged =
    JSON.stringify(workspaceBefore) === JSON.stringify(workspaceAfter) &&
    JSON.stringify(documentsBefore) === JSON.stringify(documentsAfter);
  report.checks.push({
    label: "Exploration leaves page content and personal workspace unchanged",
    passed: unchanged,
  });
  if (!unchanged) throw new Error("Exploration modified fixture data");
  await send("Target.closeTarget", { targetId });
  if (report.errors.length || report.httpErrors.length || report.writes.length)
    throw new Error("Unexpected browser errors, HTTP errors, or write requests.");
  report.status = "passed";
  console.log(
    JSON.stringify({
      status: report.status,
      checks: report.checks.length,
      screenshots: report.screenshots,
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
