import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function check(cond, message) {
  if (!cond) failures.push(message);
}

function contentType(file) {
  const ext = path.extname(file);
  return {
    ".html": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".css": "text/css"
  }[ext] || "application/octet-stream";
}

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent((req.url || "/").split("?")[0]);
      const rel = url === "/" ? "index.html" : url.replace(/^\/+/, "");
      const file = path.join(root, rel);
      if (!file.startsWith(root)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end("missing");
          return;
        }
        res.writeHead(200, { "Content-Type": contentType(file), "Cache-Control": "no-store" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function cdpSocket(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", event => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  });
  return (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    const payload = { id: msgId, method, params };
    if (sessionId) payload.sessionId = sessionId;
    ws.send(JSON.stringify(payload));
  });
}

async function waitJson(url) {
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch { /* chrome still booting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Chrome DevTools did not come up");
}

async function evaluate(send, sessionId, expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text + " " + JSON.stringify(result.exceptionDetails.exception || {}));
  }
  return result.result.value;
}

const server = await serve();
const port = server.address().port;
const debugPort = 9333;
const chrome = spawn("google-chrome", [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=/tmp/tank-chrome-${process.pid}`,
  "about:blank"
], { stdio: "ignore" });

try {
  const version = await waitJson(`http://127.0.0.1:${debugPort}/json/version`);
  const browser = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    browser.addEventListener("open", resolve);
    browser.addEventListener("error", reject);
  });
  const send = cdpSocket(browser);

  async function openPage(urlPath) {
    const created = await send("Target.createTarget", { url: `http://127.0.0.1:${port}${urlPath}` });
    const attached = await send("Target.attachToTarget", { targetId: created.targetId, flatten: true });
    const sessionId = attached.sessionId;
    await send("Page.enable", {}, sessionId);
    await send("Runtime.enable", {}, sessionId);
    await send("Page.loadEventFired", {}, sessionId).catch(() => {});
    return { sessionId, targetId: created.targetId };
  }

  const tank = await openPage("/tank-battle.html#debug");
  await evaluate(send, tank.sessionId, `new Promise(resolve => {
    const wait = () => window.__tank ? resolve(true) : setTimeout(wait, 20);
    wait();
  })`);

  const tankReport = await evaluate(send, tank.sessionId, `(() => {
    const errors = [];
    const fail = message => errors.push(message);
    const api = window.__tank;
    const title = document.getElementById("screen-title").innerText;
    if (!title.includes("同屏双人")) fail("menu missing local two-player");
    if (!title.includes("没有网络对战")) fail("menu does not say there is no online play");
    if (!title.includes("主街阵地") || !title.includes("巷战迷宫") || !title.includes("火线要塞")) fail("military map names missing");
    if (title.includes("霓虹") || title.includes("赛博") || title.includes("CYBER")) fail("cyber labels still on the menu");
    if (title.includes("等待客机") || title.includes("联机·")) fail("menu still advertises a network room");
    const modes = [...document.querySelectorAll("#modeGrid .option-card")].map(card => card.dataset.mode);
    if (modes.join(",") !== "solo,local2p") fail("modes should be solo and local2p, got " + modes.join(","));

    const screen = document.getElementById("screen-title").getBoundingClientRect();
    if (screen.height < window.innerHeight * 0.85) fail("title screen is trapped in the canvas: " + Math.round(screen.height));

    const pads = [[1, 1], [10, 1], [18, 1]];
    for (const map of [0, 1, 2, 3]) {
      api.state.mode = "solo";
      api.state.mapIndex = map;
      api.state.difficulty = "hell";
      api.state.level = 4;
      api.state.player = null;
      api.state.player2 = null;
      api.genLevel(4);
      for (const [x, y] of pads) {
        const wall = api.wallAt(x, y);
        if (wall && wall.solid) fail("map " + map + " spawn " + x + "," + y + " is walled");
        const exit = api.wallAt(x, y + 1);
        if (exit && exit.solid) fail("map " + map + " spawn exit " + x + "," + (y + 1) + " is walled");
      }
      const playerWall = api.wallAt(api.state.player.gx, api.state.player.gy);
      if (playerWall && playerWall.solid) fail("map " + map + " player spawned in a wall");
      if (api.wallAt(api.state.baseX, api.state.baseY)) fail("map " + map + " covers the base");
      let spawned = 0;
      for (let n = 0; n < 24 && api.state.spawnQueue > 0; n++) {
        api.state.enemies = [];
        api.state.bullets = [];
        api.state.spawnTimer = 0;
        api.step();
        for (const enemy of api.state.enemies) {
          spawned++;
          const wall = api.wallAt(enemy.gx, enemy.gy);
          if (wall && wall.solid) fail("map " + map + " enemy spawned inside a wall at " + enemy.gx + "," + enemy.gy);
        }
      }
      if (spawned < 3) fail("map " + map + " only spawned " + spawned + " enemies");
    }

    api.state.mode = "local2p";
    api.state.player = null;
    api.state.player2 = null;
    api.state.mapIndex = 2;
    api.genLevel(1);
    if (!api.state.player2) fail("local two-player did not create P2");
    const p2wall = api.wallAt(api.state.player2.gx, api.state.player2.gy);
    if (p2wall && p2wall.solid) fail("P2 spawned inside a wall");
    if (!api.state.player2.canMoveTo(api.state.player2.x, api.state.player2.y - 4)) fail("P2 cannot move out of spawn");

    api.state.mode = "solo";
    api.startGame();
    api.state.player.bulletDmg = 55;
    api.state.player.hp = 41;
    api.genLevel(api.state.level);
    if (api.state.player.bulletDmg !== 55) fail("damage upgrade was not kept");
    if (api.state.player.hp !== 41) fail("hp was not kept, got " + api.state.player.hp);

    api.startGame();
    const x0 = api.state.player.x;
    api.state.keys.right = true;
    for (let i = 0; i < 30; i++) api.step();
    if (api.state.player.x <= x0) fail("tank did not move right");
    const movedWall = api.wallAt(api.state.player.gx, api.state.player.gy);
    if (movedWall && movedWall.solid) fail("tank drove into a wall");

    const level = api.state.level;
    api.state.spawnQueue = 0;
    api.state.enemies = [];
    api.state.bullets = [];
    api.step();
    api.step();
    api.step();
    if (api.state.level !== level + 1) fail("level advanced " + (api.state.level - level) + " times");
    if (!api.state.transitioning) fail("level change did not lock the transition");

    api.state.mapIndex = 2;
    api.startGame();
    const baseX = api.state.baseX * api.TILE + api.TILE / 2;
    const baseY = api.state.baseY * api.TILE + api.TILE / 2;
    api.fireBullet(true, baseX, baseY, 0, 0);
    api.step();
    if (!api.state.running) fail("player bullet destroyed the base");
    api.fireBullet(false, baseX, baseY, 0, 0);
    api.step();
    if (api.state.running) fail("enemy bullet did not destroy the base");

    api.state.mode = "local2p";
    api.startGame();
    api.state.player2.hp = 30;
    api.state.player.hp = 100;
    api.dropPowerup(api.state.player2.x, api.state.player2.y, "hp");
    api.step();
    if (Math.round(api.state.player2.hp) !== 70) fail("P2 did not collect the heal, hp " + api.state.player2.hp);
    if (api.state.player.hp !== 100) fail("P2 pickup changed P1 hp");
    api.state.player.hp = 50;
    api.dropPowerup(api.state.player.x, api.state.player.y, "hp");
    api.step();
    if (Math.round(api.state.player.hp) !== 90) fail("P1 did not collect the heal, hp " + api.state.player.hp);
    api.state.mode = "solo";

    api.startGame();
    api.state.keys.right = true;
    api.step();
    api.setPaused(true);
    const pausedX = api.state.player.x;
    const pausedKeys = api.state.keys.right;
    return new Promise(resolve => {
      setTimeout(() => {
        if (api.state.player.x !== pausedX) errors.push("tank moved while paused");
        if (pausedKeys) errors.push("pause did not release held keys");
        if (document.getElementById("screen-pause").classList.contains("hidden")) errors.push("pause screen hidden");
        api.setPaused(false);
        const before = api.state.player.x;
        api.state.keys.up = true;
        for (let i = 0; i < 12; i++) api.step();
        if (api.state.player.y >= before && api.state.player.x === before) errors.push("tank did not move after resume");

        document.body.classList.add("playing");
        const overlay = document.getElementById("controls-overlay");
        overlay.style.display = "flex";
        const dpad = document.getElementById("dpad");
        const rect = dpad.getBoundingClientRect();
        if (rect.width < 40) errors.push("dpad has no size");
        const point = (id, x, y) => ({
          pointerId: id, pointerType: "touch", bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0
        });
        dpad.dispatchEvent(new PointerEvent("pointerdown", point(7, rect.right - 8, rect.top + rect.height / 2)));
        if (!api.state.keys.right) errors.push("stick did not move right");
        dpad.dispatchEvent(new PointerEvent("pointermove", point(7, rect.left + rect.width / 2, rect.bottom - 8)));
        if (!api.state.keys.down || api.state.keys.right) errors.push("stick did not slide from right to down");
        const fire = document.getElementById("fireBtn");
        fire.dispatchEvent(new PointerEvent("pointerdown", point(8, rect.left, rect.top)));
        if (!api.state.keys.fire || !api.state.keys.down) errors.push("move and fire did not stay down together");
        dpad.dispatchEvent(new PointerEvent("pointerup", point(7, rect.left, rect.top)));
        fire.dispatchEvent(new PointerEvent("pointerup", point(8, rect.left, rect.top)));
        if (api.state.keys.down || api.state.keys.fire) errors.push("fingers up did not release controls");
        resolve({ errors });
      }, 350);
    });
  })()`);
  for (const message of tankReport.errors) check(false, "tank: " + message);

  const site = await openPage("/index.html");
  const siteReport = await evaluate(send, site.sessionId, `new Promise(resolve => {
    const wait = () => {
      if (!document.querySelector(".project-card")) { setTimeout(wait, 30); return; }
      const titles = [...document.querySelectorAll(".project-card h3")].map(node => node.textContent);
      const links = [...document.querySelectorAll(".project-links a")].map(node => node.href);
      const certs = [...document.querySelectorAll(".certificate-image img")].map(node => node.getAttribute("src"));
      const fitness = document.querySelector(".fitness-grid img");
      resolve({
        theme: document.documentElement.dataset.theme,
        themeColor: document.querySelector('meta[name="theme-color"]').content,
        titles,
        links,
        icons: document.querySelectorAll(".skill-icon svg").length,
        honors: document.querySelectorAll(".honor svg").length,
        certs,
        fitnessSrcset: fitness ? fitness.getAttribute("srcset") : "",
        game: document.querySelector(".game-copy p")?.textContent || "",
        pill: document.querySelector(".certificate-card .tag")?.textContent || "",
        firstTitle: document.querySelector(".certificate-card h3")?.textContent || "",
        firstIssuer: document.querySelector(".certificate-card .certificate-body p")?.textContent || "",
        firstNote: document.querySelector(".cert-note")?.textContent || "",
        firstSrc: document.querySelector(".certificate-image img")?.getAttribute("src") || "",
        firstFit: getComputedStyle(document.querySelector(".certificate-image img")).objectFit,
        honorTitles: [...document.querySelectorAll(".honor span")].map(node => node.textContent),
        expPill: document.querySelector(".experience-card .tag")?.textContent || "",
        menuBg: getComputedStyle(document.querySelector(".nav-links")).backgroundColor,
        portrait: document.querySelector(".portrait-meta span")?.textContent || ""
      });
    };
    wait();
  })`);
  check(siteReport.theme === "light", "site theme is " + siteReport.theme);
  check(siteReport.themeColor === "#f5f5f7", "theme-color is " + siteReport.themeColor);
  check(siteReport.titles.includes("元一AI短剧"), "missing 元一AI短剧: " + siteReport.titles.join(" | "));
  check(siteReport.titles.length === 4, "expected 4 projects, got " + siteReport.titles.length);
  check(siteReport.links.some(link => link.includes("github.com/sutranixm-svg/short-drama-studio")), "short drama link missing");
  check(siteReport.links.some(link => link.includes("ielts-words/releases/download/v1.9.4")), "ielts download missing");
  check(siteReport.links.some(link => link.includes("vesper-dragon-player")), "vesper link missing");
  check(siteReport.links.some(link => link.includes("AIGuardianPro-windows-x64.zip")), "guardian download missing");
  check(siteReport.icons === 4, "skill icons " + siteReport.icons);
  check(siteReport.honors === 9, "honor icons " + siteReport.honors);
  check(siteReport.honorTitles.includes("RST北京赛区二等奖"), "honor title missing: " + siteReport.honorTitles.join(" | "));
  check(siteReport.firstTitle.includes("第十九届先进机器人及仿真技术大赛（RST）") && siteReport.firstTitle.includes("北京赛区二等奖"), "award title: " + siteReport.firstTitle);
  check(siteReport.pill === "二等奖", "award pill: " + siteReport.pill);
  check(siteReport.firstIssuer.includes("中国仿真学会") && siteReport.firstIssuer.includes("2026年11月10日"), "issuer: " + siteReport.firstIssuer);
  check(siteReport.firstNote.includes("个人赛·水中机器鱼仿真组·障碍竞速"), "subject missing: " + siteReport.firstNote);
  check(siteReport.firstNote.includes("20261901F050502236"), "certificate number missing");
  check(siteReport.firstNote.includes("王雪豪") && siteReport.firstNote.includes("陈芷锐") && siteReport.firstNote.includes("对外经济贸易大学"), "note facts: " + siteReport.firstNote);
  check(siteReport.firstSrc === "assets/thumbs/cert-rst-19-beijing.jpg", "thumb src " + siteReport.firstSrc);
  check(siteReport.firstFit === "contain", "certificate fit " + siteReport.firstFit);
  check(siteReport.certs.every(src => src.includes("/thumbs/")), "certificate cards are not using thumbs: " + siteReport.certs.join(", "));
  check(!siteReport.certs.some(src => src.endsWith("cert-aliyun-bigdata.jpg") && !src.includes("/thumbs/")), "aliyun full image used in the card");
  check((siteReport.fitnessSrcset || "").includes("fitness-dorm-720.jpg"), "fitness srcset missing");
  check(siteReport.game.includes("没有网络对战") && siteReport.game.includes("同屏双人"), "game copy is " + siteReport.game);
  check(siteReport.pill.length > 0, "certificate pill missing");
  check(siteReport.expPill === "即将开展", "experience pill is " + siteReport.expPill);
  check(siteReport.portrait.includes("北京"), "portrait caption is " + siteReport.portrait);

  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  }, site.sessionId);
  const mobileReport = await evaluate(send, site.sessionId, `(() => {
    const toggle = document.getElementById("mobileToggle");
    toggle.click();
    const links = document.getElementById("navLinks");
    const bg = getComputedStyle(links).backgroundColor;
    const open = links.classList.contains("open");
    const expanded = toggle.getAttribute("aria-expanded");
    const gameLink = [...links.querySelectorAll("a")].some(link => link.getAttribute("href") === "#play");
    return { bg, open, expanded, gameLink, display: getComputedStyle(toggle).display };
  })()`);
  check(mobileReport.display !== "none", "mobile menu button hidden");
  check(mobileReport.open && mobileReport.expanded === "true", "menu did not open");
  check(mobileReport.gameLink, "mobile nav missing game link");
  check(!mobileReport.bg.includes("11, 13, 18"), "mobile menu still dark: " + mobileReport.bg);

  const opened = await evaluate(send, site.sessionId, `(() => {
    const card = document.querySelector(".certificate-card");
    card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const modal = document.getElementById("certificateModal");
    return {
      open: modal.classList.contains("open"),
      src: document.getElementById("certificateImage").getAttribute("src")
    };
  })()`);
  check(opened.open, "certificate keyboard open failed");
  check(opened.src === "assets/cert-rst-19-beijing.jpg", "lightbox src " + opened.src);
  check(!/^https?:/i.test(opened.src), "lightbox should use the repo file");
  const ratios = await evaluate(send, site.sessionId, `Promise.all(["assets/cert-rst-19-beijing.jpg", "assets/thumbs/cert-rst-19-beijing.jpg"].map(src => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ src, w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error(src));
    img.src = src;
  }))).then(async images => {
    const full = images[0].w / images[0].h;
    const thumb = images[1].w / images[1].h;
    const shown = document.querySelector(".certificate-image img");
    shown.loading = "eager";
    shown.scrollIntoView({ block: "center" });
    if (shown.decode) await shown.decode();
    return {
      full, thumb, delta: Math.abs(full - thumb),
      shownW: shown.clientWidth, shownH: shown.clientHeight,
      frameW: shown.parentElement.clientWidth, frameH: shown.parentElement.clientHeight,
      naturalW: shown.naturalWidth, naturalH: shown.naturalHeight
    };
  })`);
  check(ratios.delta < 0.02, "thumbnail aspect differs from the original: " + JSON.stringify(ratios));
  check(ratios.naturalW === 800 && ratios.naturalH > 1000, "preview is not the full-frame thumbnail: " + JSON.stringify(ratios));
  check(ratios.shownH <= ratios.frameH + 1 && ratios.shownW <= ratios.frameW + 1, "certificate image spills out of its frame: " + JSON.stringify(ratios));
  check(ratios.frameH >= 300 && ratios.shownH >= 300, "certificate frame collapsed: " + JSON.stringify(ratios));

  const admin = await openPage("/admin.html");
  await evaluate(send, admin.sessionId, `new Promise((resolve, reject) => {
    const start = Date.now();
    const wait = () => {
      if (typeof renderMarquee === "function" && typeof collectForm === "function") resolve(true);
      else if (Date.now() - start > 4000) reject(new Error("admin helpers missing"));
      else setTimeout(wait, 30);
    };
    wait();
  })`);
  const adminReport = await evaluate(send, admin.sessionId, `(() => {
    CONFIG = {
      marquee: [{ text: "AI Trainer", outline: false }, { text: "达摩院认证", outline: true }],
      projects: [{ title: "元一AI短剧" }],
      certificates: { cards: [{ title: "第十九届先进机器人及仿真技术大赛（RST）北京赛区二等奖", img: "assets/cert-rst-19-beijing.jpg" }], gallery: [] },
      stats: [{ value: "8", suffix: "+", label: "荣誉奖项" }],
      education: [], skills: [], experience: [], honors: [{ icon: "award", title: "RST北京赛区二等奖" }],
      skillTags: ["数据标注"]
    };
    renderMarquee();
    collectForm();
    return {
      texts: CONFIG.marquee.map(item => item.text),
      outlines: CONFIG.marquee.map(item => item.outline),
      project: CONFIG.projects[0] && CONFIG.projects[0].title,
      cert: CONFIG.certificates.cards[0] && CONFIG.certificates.cards[0].title,
      img: CONFIG.certificates.cards[0] && CONFIG.certificates.cards[0].img
    };
  })()`);
  check(adminReport.texts[0] === "AI Trainer" && adminReport.texts[1] === "达摩院认证", "admin wiped marquee: " + JSON.stringify(adminReport.texts));
  check(adminReport.outlines[0] === false && adminReport.outlines[1] === true, "admin outline flags: " + JSON.stringify(adminReport.outlines));
  check(adminReport.project === "元一AI短剧", "admin wiped projects");
  check(adminReport.cert.includes("北京赛区二等奖") && adminReport.img === "assets/cert-rst-19-beijing.jpg", "admin wiped certificate");
  await send("Target.closeTarget", { targetId: admin.targetId });

  await send("Target.closeTarget", { targetId: tank.targetId });
  await send("Target.closeTarget", { targetId: site.targetId });
  browser.close();
} finally {
  chrome.kill("SIGKILL");
  server.close();
}

if (failures.length) {
  console.error(failures.map(message => "FAIL " + message).join("\n"));
  process.exit(1);
}
console.log("tank and site checks passed");
