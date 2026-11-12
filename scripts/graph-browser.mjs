#!/usr/bin/env node
// Read-only browser acceptance for the dedicated KnowWeave Graph QA fixture.
// Uses real Chromium mouse/keyboard input; never calls a model or writes Wiki pages.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const options = {
  baseUrl: "http://127.0.0.1:3002",
  wikiPath: null,
  chromium: process.env.CHROMIUM_PATH || "chromium",
  outputDir: resolve(`.local/evidence/graph-polish/browser-${Date.now()}`),
  scenario: "full",
};
for (let index = 2; index < process.argv.length; index++) {
  const key = {
    "--base-url": "baseUrl",
    "--wiki-path": "wikiPath",
    "--chromium": "chromium",
    "--output-dir": "outputDir",
    "--scenario": "scenario",
  }[process.argv[index]];
  if (!key || !process.argv[index + 1])
    throw new Error(
      "Usage: node scripts/graph-browser.mjs --wiki-path <fixture> [--base-url URL] [--chromium executable] [--output-dir new-directory] [--scenario full|fallback]",
    );
  options[key] = process.argv[++index];
}
const base = new URL(options.baseUrl);
if (
  !["http:", "https:"].includes(base.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) ||
  base.username ||
  base.password ||
  !options.wikiPath ||
  !["full", "fallback"].includes(options.scenario)
)
  throw new Error("Require a loopback URL, exact --wiki-path, and full|fallback scenario.");
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
const report = {
  startedAt: new Date().toISOString(),
  status: "running",
  scenario: options.scenario,
  checks: [],
  screenshots: [],
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
      options.scenario === "fallback" ? "--disable-webgl" : "--enable-unsafe-swiftshader",
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
    const virtualKey = { Enter: 13, Escape: 27, a: 65, "=": 187 }[name];
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
    await evaluate("document.querySelector('main').scrollTop=0");
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
  const transform = `${map}.querySelector(':scope > g').getAttribute('transform')`;
  const count = "document.querySelectorAll('[data-graph-node]').length";
  const selected = "new URL(location.href).searchParams.get('node')";
  const labels = "document.querySelectorAll('[data-graph-node] text').length";
  const spaceLabels =
    "document.querySelectorAll('[aria-label=\"三维知识图谱\"] button[data-spatial-node]').length";
  await viewport(1440);
  await navigate("/graph");
  await wait(`${count}===18`, "all fixture nodes");
  if (options.scenario === "fallback") {
    await click(button("Space"));
    await wait("document.body.innerText.includes('当前浏览器无法展开 3D')", "WebGL fallback");
    await check(
      "No WebGL renders explicit fallback",
      "!document.querySelector('[aria-label=\"三维知识图谱\"] canvas')",
    );
    await click(button("切换到 Map"));
    await wait(`${count}===18`, "fallback to 2D");
    await check(
      "Fallback restores usable 2D and preference",
      "localStorage.getItem('knowweave.graph.mode')==='2d'",
    );
    await screenshot("graph-webgl-fallback-2d.png");
  } else {
    await check("Both modes are reachable", `!!(${button("Map")})&&!!(${button("Space")})`);
    await check(
      "Desktop layout has no horizontal overflow",
      "document.documentElement.scrollWidth<=innerWidth&&document.querySelector('main').scrollWidth<=innerWidth",
    );
    await screenshot("graph-2d-light.png");
    const beforeZoom = await evaluate(transform);
    await evaluate(`${map}.focus()`);
    await key("=", "Equal");
    await check("Keyboard zoom changes camera", `${transform}!==${JSON.stringify(beforeZoom)}`);
    await click(aria("适应画布"));
    await click("document.querySelector('[data-graph-node=\"knowledge-map\"] circle')");
    await check(
      "Selecting node updates deep link and detail",
      `${selected}==='knowledge-map'&&!!document.querySelector('a[href=\"/wiki/knowledge-map\"]')`,
    );
    await screenshot("graph-2d-selected.png");
    const beforeDrag = await evaluate(transform);
    const p = await evaluate(
      `(() => {const r=${map}.getBoundingClientRect();return{x:r.x+45,y:r.y+110};})()`,
    );
    await send(
      "Input.dispatchMouseEvent",
      { type: "mousePressed", ...p, button: "left", buttons: 1, clickCount: 1 },
      sessionId,
    );
    await send(
      "Input.dispatchMouseEvent",
      { type: "mouseMoved", x: p.x + 65, y: p.y + 35, button: "left", buttons: 1 },
      sessionId,
    );
    await send(
      "Input.dispatchMouseEvent",
      {
        type: "mouseReleased",
        x: p.x + 65,
        y: p.y + 35,
        button: "left",
        buttons: 0,
        clickCount: 1,
      },
      sessionId,
    );
    await wait(`${transform}!==${JSON.stringify(beforeDrag)}`, "drag commit");
    await check(
      "Canvas drag pans while preserving selection",
      `${transform}!==${JSON.stringify(beforeDrag)}&&${selected}==='knowledge-map'`,
    );
    const beforeWheel = await evaluate(transform);
    await send(
      "Input.dispatchMouseEvent",
      { type: "mouseWheel", ...p, deltaX: 0, deltaY: -230 },
      sessionId,
    );
    await sleep(200);
    await check("Wheel changes zoom", `${transform}!==${JSON.stringify(beforeWheel)}`);
    const beforeFocus = await evaluate(transform);
    await click(aria("居中所选节点"));
    await check(
      "2D focus centers the selected node",
      `${transform}!==${JSON.stringify(beforeFocus)}`,
    );
    await click(button("仅看相邻"));
    await check(
      "Neighborhood filters actual nodes",
      `${count}>1&&${count}<18&&!!document.querySelector('[data-graph-node=\"knowledge-map\"]')&&${button("仅看相邻")}.getAttribute('aria-pressed')==='true'`,
    );
    await click(button("仅看相邻"));
    await wait(`${count}===18`, "neighborhood restore");
    await click(button("重置探索"));
    await check("Reset clears selection and neighborhood", `!${selected}&&${count}===18`);
    await click(aria("显示页面标签"));
    // Remove pointer hover from graph nodes; selected/hovered labels may remain intentionally visible.
    await click("document.querySelector('h1')");
    await check(
      "Label switch hides general 2D labels",
      `${labels}===0&&${aria("显示页面标签")}.getAttribute('aria-pressed')==='false'`,
    );
    await click(aria("显示页面标签"));
    await check("Label switch restores 2D labels", `${labels}>0`);
    await fill("BM25");
    await check(
      "Title search filters graph",
      `${count}===1&&!!document.querySelector('[data-graph-node=\"bm25\"]')`,
    );
    await click(aria("清除搜索"));
    await fill("界面验证");
    await check("Tag search matches fixture pages", `${count}===18`);
    await fill("no-graph-result-zz");
    await check(
      "Search empty state is recoverable",
      "document.body.innerText.includes('没有找到匹配页面')",
    );
    await click(button("清除筛选"));
    await wait(`${count}===18`, "clear search");
    await click(button("Concept"));
    await check(
      "Type filter matches actual page count",
      `${count}===${pages.filter((page) => page.type === "concept").length}`,
    );
    await click(button("全部"));
    await navigate("/graph?node=knowledge-map");
    await wait(
      `${selected}==='knowledge-map'&&!!document.querySelector('a[href=\"/wiki/knowledge-map\"]')`,
      "deep link detail",
    );
    await click(button("Space"));
    await wait(
      "document.querySelector('[aria-label=\"三维知识图谱\"] canvas')",
      "3D canvas",
      45000,
    );
    await wait(`${spaceLabels}>3`, "readable 3D labels");
    await check(
      "3D preserves selected node",
      `${selected}==='knowledge-map'&&!!document.querySelector('a[href=\"/wiki/knowledge-map\"]')`,
    );
    await sleep(700);
    await screenshot("graph-3d-light.png");
    const labelPositions =
      "JSON.stringify([...document.querySelectorAll('[data-spatial-node]')].map(e=>({id:e.dataset.spatialNode,left:e.style.left,top:e.style.top})))";
    const beforeOrbit = await evaluate(labelPositions);
    await click(button("缓慢环绕"));
    await sleep(1200);
    await check(
      "Explicit orbit changes projected node positions",
      `${button("暂停环绕")}.getAttribute('aria-pressed')==='true'&&${labelPositions}!==${JSON.stringify(beforeOrbit)}`,
    );
    await click("document.querySelector('[data-spatial-node=\"knowledge-map\"]')");
    await check(
      "Selecting a 3D label pauses orbit",
      `${button("缓慢环绕")}.getAttribute('aria-pressed')==='false'&&${selected}==='knowledge-map'`,
    );
    const beforeSpaceFocus = await evaluate(labelPositions);
    await click(aria("居中所选节点"));
    await sleep(800);
    await check(
      "3D focus changes projected node positions",
      `${labelPositions}!==${JSON.stringify(beforeSpaceFocus)}`,
    );
    await click(aria("适应画布"));
    await click(aria("放大图谱"));
    await click(aria("缩小图谱"));
    await navigate("/graph?node=knowledge-map");
    await wait(
      "document.querySelector('[aria-label=\"三维知识图谱\"] canvas')",
      "remembered 3D",
      45000,
    );
    await check(
      "Mode preference survives reload",
      "localStorage.getItem('knowweave.graph.mode')==='3d'",
    );
    await click(button("重置探索"));
    await wait(`${spaceLabels}>3`, "reset space labels");
    await click(aria("显示页面标签"));
    await click("document.querySelector('h1')");
    await wait(`${spaceLabels}===0`, "hidden 3D labels");
    await check(
      "Label toggle affects 3D",
      `${aria("显示页面标签")}.getAttribute('aria-pressed')==='false'`,
    );
    await click(aria("显示页面标签"));
    await wait(`${spaceLabels}>3`, "restored 3D labels");
    // Theme controls use the actual provider and rerender the running WebGL scene.
    const darkButton = await evaluate(`!!(${aria("切换到深色主题")})`);
    if (!darkButton) await click(aria("切换到浅色主题"));
    await click(aria("切换到深色主题"));
    await check(
      "Theme control switches the active scene to dark",
      "document.documentElement.classList.contains('dark')",
    );
    await sleep(400);
    await screenshot("graph-3d-dark.png");
    await click(button("Map"));
    await wait(`${count}===18`, "dark 2D");
    await screenshot("graph-2d-dark.png");
    // Real native fullscreen is supported in headless Chromium; skip only if browser reports no support.
    if (await evaluate("document.fullscreenEnabled")) {
      await click(aria("全屏查看图谱"));
      await wait("document.fullscreenElement", "fullscreen entry");
      await check("Fullscreen expands graph", "!!document.fullscreenElement");
      await click(aria("退出全屏"));
      await wait("!document.fullscreenElement", "fullscreen exit");
    }
    for (const width of [320, 360]) {
      await viewport(width, 900);
      await check(
        `${width}px layout has no horizontal overflow`,
        "document.documentElement.scrollWidth<=innerWidth&&document.querySelector('main').scrollWidth<=innerWidth",
      );
      await check(
        `${width}px zoom controls do not cover gesture hint`,
        `(() => {const control=${aria("缩小图谱")}.parentElement.getBoundingClientRect();const hint=[...document.querySelectorAll('p')].find(e=>e.innerText.includes('拖动探索'));if(!hint)return true;const r=hint.getBoundingClientRect();return !r.width||!r.height||r.right<=control.left||r.left>=control.right||r.bottom<=control.top||r.top>=control.bottom;})()`,
      );
    }
    await viewport(390, 900);
    await check(
      "390px graph has no horizontal overflow",
      "document.documentElement.scrollWidth<=innerWidth&&document.querySelector('main').scrollWidth<=innerWidth",
    );
    await screenshot("graph-mobile-2d.png");
    await evaluate(`${map}.scrollIntoView({block:'center'})`);
    await sleep(200);
    report.mobileNodeHits = await evaluate(
      `(() => {const bounds=${map}.getBoundingClientRect();return [...document.querySelectorAll('[data-graph-node]')].flatMap(node=>{const r=node.querySelector('circle').getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(x<bounds.left||x>bounds.right||y<Math.max(bounds.top,106)||y>Math.min(bounds.bottom,innerHeight-55))return [];const hit=document.elementFromPoint(x,y)?.closest('[data-graph-node]')?.getAttribute('data-graph-node');return [{expected:node.getAttribute('data-graph-node'),actual:hit??null}];});})()`,
    );
    const hitTestPassed =
      report.mobileNodeHits.length > 0 &&
      report.mobileNodeHits.every((hit) => hit.expected === hit.actual);
    report.checks.push({
      label: "390px visible node centers are not covered by other labels",
      passed: hitTestPassed,
    });
    if (!hitTestPassed) throw new Error("Mobile node center occlusion");
    await click("document.querySelector('[data-graph-node=\"knowledge-map\"] circle')");
    await check(
      "Mobile node selection opens details",
      "!!document.querySelector('a[href=\"/wiki/knowledge-map\"]')",
    );
    await click(button("Space"));
    await wait(
      "document.querySelector('[aria-label=\"三维知识图谱\"] canvas')",
      "mobile space",
      45000,
    );
    await wait(`${spaceLabels}>0`, "mobile 3D labels");
    await screenshot("graph-mobile-3d.png");
    await check(
      "390px 3D has no horizontal overflow",
      "document.documentElement.scrollWidth<=innerWidth&&document.querySelector('main').scrollWidth<=innerWidth",
    );
    await send(
      "Emulation.setEmulatedMedia",
      { features: [{ name: "prefers-reduced-motion", value: "reduce" }] },
      sessionId,
    );
    await wait(`${button("缓慢环绕")}.disabled`, "reduced motion disables orbit");
    await check(
      "Reduced motion disables automatic scene rotation",
      `matchMedia('(prefers-reduced-motion: reduce)').matches&&${button("缓慢环绕")}.disabled&&${button("缓慢环绕")}.getAttribute('aria-pressed')==='false'`,
    );
    await viewport(1440);
    await click(button("Map"));
    await navigate("/graph?node=knowledge-map");
    await wait("document.querySelector('a[href=\"/wiki/knowledge-map\"]')", "reading action");
    await click("document.querySelector('a[href=\"/wiki/knowledge-map\"]')");
    await wait("location.pathname==='/wiki/knowledge-map'", "read selected Wiki page");
    await check(
      "Reading action opens the original Wiki page",
      "document.body.innerText.includes('知识库与知识连接')",
    );
  }
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
