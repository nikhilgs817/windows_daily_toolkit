// Simulated Stream Deck: starts the built plugin, drives every action, and checks what it does.
// The plugin runs in dry-run mode (non-Windows), so Windows commands are recorded instead of executed.
import { spawn } from "node:child_process";
import { readFileSync, rmSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { unzipSync, strFromU8 } from "fflate";

const root = dirname(fileURLToPath(import.meta.url));
const sd = join(root, "com.dailyops.v2.sdPlugin");
const manifest = JSON.parse(readFileSync(join(sd, "manifest.json"), "utf8"));
const runDir = mkdtempSync(join(tmpdir(), "dailyops-test-"));
const LOG = join(runDir, "dryrun.jsonl");
rmSync(LOG, { force: true });
rmSync(join(sd, "cache"), { recursive: true, force: true });

const wss = new WebSocketServer({ port: 0 });
const port = wss.address().port;
const sent = []; // messages from plugin
let sock;
const waiters = [];
wss.on("connection", (s) => {
	sock = s;
	s.on("message", (d) => {
		const m = JSON.parse(d.toString());
		sent.push(m);
		for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
	});
});
const waitFor = (pred, ms = 8000) =>
	new Promise((res, rej) => {
		const hit = sent.find(pred);
		if (hit) return res(hit);
		const w = { pred, res };
		waiters.push(w);
		setTimeout(() => rej(new Error("timeout waiting")), ms);
	});
const send = (m) => sock.send(JSON.stringify(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const info = {
	application: { font: "Segoe UI", language: "en", platform: "windows", platformVersion: "10.0.22631", version: "7.1.0.21000" },
	colors: { buttonPressedBackgroundColor: "#303030FF", buttonPressedBorderColor: "#646464FF", buttonPressedTextColor: "#969696FF", disabledColor: "#F7821B59", highlightColor: "#F7821BFF", mouseDownColor: "#CF6304FF" },
	devicePixelRatio: 2,
	devices: [{ id: "DEV1", name: "Stream Deck", size: { columns: 5, rows: 4 }, type: 0 }],
	plugin: { uuid: "com.dailyops.v2", version: "1.0.0.0" },
};

const proc = spawn(process.execPath, [join(sd, "bin/plugin.js"), "-port", String(port), "-pluginUUID", "com.dailyops.v2", "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)], {
	cwd: sd,
	env: { ...process.env, DAILYOPS_DRYRUN: "1", DAILYOPS_DRYRUN_LOG: LOG },
	stdio: ["ignore", "pipe", "pipe"],
});
let out = "";
proc.stdout.on("data", (d) => (out += d));
proc.stderr.on("data", (d) => (out += d));

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => {
	(ok ? pass++ : fail++);
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
};
const dry = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const decodeSvg = (img) => decodeURIComponent(img.replace(/^data:image\/svg\+xml;charset=utf8,/, ""));

try {
	const reg = await waitFor((m) => m.event === "registerPlugin");
	check("plugin registers with Stream Deck", reg.uuid === "com.dailyops.v2");
	check("public name and category are Windows Daily Toolkit with stable internal identity", manifest.Name === "Windows Daily Toolkit" && manifest.Category === manifest.Name && manifest.UUID === "com.dailyops.v2");

	const cases = {
		downloads: { settings: { folderPath: "C:\\Users\\you\\Documents" }, expect: (c) => c.command === "folder" && c.args[0] === "C:\\Users\\you\\Documents" },
		app: { settings: { appId: "Example.SampleApp", appName: "Sample App", iconGlyph: "chats", iconTheme: "candy", iconStyle: "neon" }, expect: (c) => c.command === "appid" && c.args[0] === "Example.SampleApp" },
		folder: { settings: { folderPath: "C:\\Users\\you\\Projects", iconTheme: "gold" }, expect: (c) => c.command === "folder" && c.args[0] === "C:\\Users\\you\\Projects" },
		website: { settings: { url: "github.com", browser: "chrome" }, expect: (c) => c.command === "cmd" && c.args[0] === "chrome" && c.args[1].endsWith('"https://github.com"') },
		websitefolder: { settings: {}, expect: (c) => c.command === "url" && c.args[0].includes("/hold?device=DEV1") },
		volup: { settings: { step: "10" }, expect: (c) => c.command === "vol" && c.args[0] === "up" && c.args[1] === "5" },
		voldown: { settings: {}, expect: (c) => c.command === "vol" && c.args[0] === "down" && c.args[1] === "3" },
		appsfolder: { settings: {}, expect: (c) => c.command === "url" && c.args[0] === "streamdeck://plugins/message/com.dailyops.vscode.v2/hold?device=DEV1&streamdeck=hidden" },
		back: { settings: {}, expect: (c) => c.command === "url" && c.args[0].includes("/release?device=DEV1") },
		screenshot: { settings: {}, expect: (c) => c.command === "shot" && c.args[0] === "area" && c.args[2] === "1" && c.args[3] === "1" },
		showdesktop: { settings: {}, expect: (c) => c.command === "desktop" },
		monitorcontrol: { settings: { screenKey: "\\\\?\\DISPLAY#GSM2#B", screenNumber: 3 }, expect: (c) => c.command === "moff" && c.args[0].includes("GSM2") && c.args[1] === "1" && c.args[2] === "2" },
		copy: { settings: {}, expect: (c) => c.command === "keys" && c.args[0] === "^c" },
		paste: { settings: {}, expect: (c) => c.command === "keys" && c.args[0] === "^v" },
	};
	check("every manifest action has a test", manifest.Actions.every((a) => cases[a.UUID.split(".").pop()]));
	const retired = new Set(["chrome", "youtube", "claude", "chatgpt", "vscode", "thinkorswim", "fidelity"].map((id) => "com.dailyops.v2." + id));
	check("13 visible actions plus a hidden folder compatibility alias", manifest.Actions.length === 14 && manifest.Actions.filter((a) => a.VisibleInActionsList !== false).length === 13 && manifest.Actions.find((a) => a.UUID === "com.dailyops.v2.folder")?.VisibleInActionsList === false && !manifest.Actions.some((a) => retired.has(a.UUID)));
	const appsArchive = unzipSync(readFileSync(join(sd, "profiles/Apps.streamDeckProfile")));
	const bundledActions = Object.entries(appsArchive).filter(([path]) => path.endsWith("/manifest.json")).flatMap(([, bytes]) => JSON.parse(strFromU8(bytes)).Controllers?.flatMap((c) => Object.values(c.Actions || {})) || []);
	check("bundled Apps page contains only Back and an unconfigured Open App", bundledActions.length === 2 && ["back", "app"].every((id) => bundledActions.some((a) => a.UUID === "com.dailyops.v2." + id)) && bundledActions.filter((a) => a.UUID.endsWith(".app")).every((a) => !a.Settings?.appId && !a.Settings?.target));
	const websiteArchive = unzipSync(readFileSync(join(sd, "profiles/Websites.streamDeckProfile")));
	const websiteActions = Object.entries(websiteArchive).filter(([path]) => path.endsWith("/manifest.json")).flatMap(([, bytes]) => JSON.parse(strFromU8(bytes)).Controllers?.flatMap((c) => Object.values(c.Actions || {})) || []);
	check("plugin bundles an editable Websites page with Back and an unconfigured website", manifest.Profiles.some((p) => p.Name === "profiles/Websites" && p.Readonly === false) && websiteActions.length === 2 && websiteActions.some((a) => a.UUID.endsWith(".back")) && websiteActions.some((a) => a.UUID.endsWith(".website") && !a.Settings?.url));
	check("one Monitor Control action replaces both fixed monitor actions", manifest.Actions.filter((a) => /monitor/.test(a.UUID)).length === 1 && manifest.Actions.some((a) => a.UUID === "com.dailyops.v2.monitorcontrol" && a.Name === "Monitor Control"));

	let col = 0;
	for (const a of manifest.Actions) {
		const id = a.UUID.split(".").pop();
		const ctx = "ctx-" + id;
		const { settings, expect } = cases[id];
		const coordinates = { column: col % 5, row: Math.floor(col / 5) };
		col++;
		send({ event: "willAppear", action: a.UUID, context: ctx, device: "DEV1", payload: { settings, coordinates, controller: "Keypad", isInMultiAction: false, state: 0 } });
		const img = await waitFor((m) => m.event === "setImage" && m.context === ctx);
		const svg = decodeSvg(img.payload.image);
		check(`${id}: draws key image on appear`, svg.startsWith("<svg") && svg.includes("</svg>"));

		const before = dry().length;
		send({ event: "keyDown", action: a.UUID, context: ctx, device: "DEV1", payload: { settings, coordinates, isInMultiAction: false, state: 0 } });
		await sleep(60);
		send({ event: "keyUp", action: a.UUID, context: ctx, device: "DEV1", payload: { settings, coordinates, isInMultiAction: false, state: 0 } });
		await sleep(id === "website" ? 700 : 450); // launch keys wait 300 ms for a possible double-tap
		const cmds = dry().slice(before).filter((c) => !["resolve", "icon", "warm", "snap", "place", "mlist"].includes(c.command));
		check(`${id}: key press runs the right command`, cmds.length > 0 && expect(cmds[0]), JSON.stringify(cmds[0] ?? null));
	}

	// Feedback flashes
	const oks = sent.filter((m) => m.event === "showOk").map((m) => m.context);
	check("launch keys flash ✓", ["ctx-app", "ctx-downloads", "ctx-website"].every((c) => oks.includes(c)));
	// Advanced target: an .exe path goes straight to "path"
	const app2 = { target: "C:\\Tools\\putty.exe", args: "-load prod" };
	send({ event: "willAppear", action: "com.dailyops.v2.app", context: "ctx-app2", device: "DEV1", payload: { settings: app2, coordinates: { column: 4, row: 3 }, controller: "Keypad", isInMultiAction: false, state: 0 } });
	await sleep(300);
	const n0 = dry().length;
	send({ event: "keyDown", action: "com.dailyops.v2.app", context: "ctx-app2", device: "DEV1", payload: { settings: app2, coordinates: { column: 4, row: 3 }, isInMultiAction: false, state: 0 } });
	await sleep(50);
	send({ event: "keyUp", action: "com.dailyops.v2.app", context: "ctx-app2", device: "DEV1", payload: { settings: app2, coordinates: { column: 4, row: 3 }, isInMultiAction: false, state: 0 } });
	await sleep(600);
	const pc = dry().slice(n0).find((c) => c.command === "path");
	check("Open App with a typed .exe path launches it with arguments", pc && pc.args[0] === "C:\\Tools\\putty.exe" && pc.args[1] === "-load prod");

	// Real icons: app keys should end up with an embedded PNG (the icon Windows returns)
	await sleep(500);
	const lastImg = (ctx) => [...sent].reverse().find((m) => m.event === "setImage" && m.context === ctx);
	for (const id of ["app2"]) {
		const svg = decodeSvg(lastImg("ctx-" + id).payload.image);
		check(`${id}: shows the app's real icon`, svg.includes("data:image/png;base64,"));
	}
	const appSvg = decodeSvg(lastImg("ctx-app").payload.image);
	check("Open App: custom icon + app name label", appSvg.includes("SAMPLE APP") && appSvg.includes("#FC5C7D"));
	const folderSvg = decodeSvg(lastImg("ctx-folder").payload.image);
	check("Open Folder: label from folder name + chosen colour", folderSvg.includes("PROJECTS") && folderSvg.includes("#FFD200"));
	check("Website Folder uses the approved Vivid ocean folder/globe artwork", decodeSvg(lastImg("ctx-websitefolder").payload.image).includes("#2B86FF") && decodeSvg(lastImg("ctx-websitefolder").payload.image).includes('cy="76"') && decodeSvg(lastImg("ctx-websitefolder").payload.image).includes("WEBSITE"));
	const foldersSvg = decodeSvg(lastImg("ctx-downloads").payload.image);
	check("existing Downloads UUID now presents Folders", manifest.Actions.find((a) => a.UUID === "com.dailyops.v2.downloads")?.Name === "Folders" && foldersSvg.includes("FOLDERS") && !foldersSvg.includes("DOWNLOADS"));
	const emptyFolder = { gestures: false };
	send({ event: "willAppear", action: "com.dailyops.v2.downloads", context: "ctx-empty-folder", device: "DEV1", payload: { settings: emptyFolder, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false, state: 0 } });
	await waitFor((m) => m.event === "setImage" && m.context === "ctx-empty-folder");
	const beforeEmptyFolder = dry().length;
	send({ event: "keyDown", action: "com.dailyops.v2.downloads", context: "ctx-empty-folder", device: "DEV1", payload: { settings: emptyFolder, coordinates: { column: 0, row: 0 }, isInMultiAction: false, state: 0 } });
	send({ event: "keyUp", action: "com.dailyops.v2.downloads", context: "ctx-empty-folder", device: "DEV1", payload: { settings: emptyFolder, coordinates: { column: 0, row: 0 }, isInMultiAction: false, state: 0 } });
	await waitFor((m) => m.event === "showAlert" && m.context === "ctx-empty-folder");
	check("Folders requires a path instead of silently opening Downloads", !dry().slice(beforeEmptyFolder).some((c) => c.command === "folder"));
	// Compare the original alias against its unified settings for every inherited feature.
	const paths = ["", "   ", "C:\\Users\\you\\Projects", "%USERPROFILE%\\Documents\\", "\\\\server\\share\\Team", "D:\\", "C:\\Work\\A & B"];
	const parity = [];
	for (const [pi, folderPath] of paths.entries()) for (const [si, iconStyle] of ["neon", "vivid", "pro", "real"].entries()) {
		const old = { folderPath, iconStyle, gestures: false, animate: false, ...(pi === 4 ? { hideLabel: true } : {}), ...(pi === 6 ? { iconLabel: "Team Files", iconGlyph: "briefcase", iconTheme: "mint" } : {}) };
		const unified = { ...old, folderNameLabel: true, folderEmptyLabel: "Folder", iconTheme: old.iconTheme || "fuchsia" };
		const pair = { old, unified, legacy: `parity-old-${pi}-${si}`, current: `parity-new-${pi}-${si}` };
		parity.push(pair);
		for (const [id, context, settings] of [["folder", pair.legacy, old], ["downloads", pair.current, unified]]) send({ event: "willAppear", action: "com.dailyops.v2." + id, context, device: "DEV1", payload: { settings, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false, state: 0 } });
	}
	await sleep(350);
	const stableSvg = (ctx) => decodeSvg(lastImg(ctx).payload.image).replace(/k[a-z0-9]+(?=(?:bg|fg|vg|glow|hl|bar|tile|sheen)\b)/g, "key");
	check("unified Folders exactly preserves old labels, colours, glyphs, hide-label and real-icon rendering in 28 comparisons", parity.every((p) => stableSvg(p.legacy) === stableSvg(p.current)));
	let pathParity = true;
	for (const pair of parity.filter((_, i) => i % 4 === 0)) {
		const commands = [];
		for (const [id, context, settings] of [["folder", pair.legacy, pair.old], ["downloads", pair.current, pair.unified]]) {
			const start = dry().length;
			send({ event: "keyDown", action: "com.dailyops.v2." + id, context, device: "DEV1", payload: { settings, coordinates: { column: 0, row: 0 }, isInMultiAction: false, state: 0 } });
			await sleep(40);
			commands.push(dry().slice(start).filter((c) => c.command === "folder"));
		}
		pathParity &&= JSON.stringify(commands[0]) === JSON.stringify(commands[1]);
	}
	check("unified Folders preserves path trimming, environment paths, UNC/root paths and missing-path behavior", pathParity);
	for (const p of parity) for (const [id, context] of [["folder", p.legacy], ["downloads", p.current]]) send({ event: "willDisappear", action: "com.dailyops.v2." + id, context, device: "DEV1", payload: { settings: {}, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false, state: 0 } });
	const volSvg = decodeSvg(lastImg("ctx-volup").payload.image);
	check("Volume Up: neon art", volSvg.includes("VOL UP"));

	// Live artwork must produce changing frames, honor style/settings, and stop when hidden.
	for (const id of manifest.Actions.map((a) => a.UUID.split(".").pop())) {
		const frames = sent.filter((x) => x.event === "setImage" && x.context === "ctx-" + id).slice(-6).map((x) => decodeSvg(x.payload.image));
		const phases = frames.map((svg) => /stroke-dashoffset="([^"]+)"/.exec(svg)?.[1]);
		check(`${id}: visible keys animate with changing artwork`, frames.length >= 3 && new Set(phases).size >= 3 && phases.every(Boolean));
	}
	const desktopSettings = (settings, event = "didReceiveSettings") => send({ event, action: "com.dailyops.v2.showdesktop", context: "ctx-showdesktop", device: "DEV1", payload: { settings, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false, state: 0 } });
	desktopSettings({ iconStyle: "vivid", animate: false }); await sleep(150);
	const stillCount = sent.filter((x) => x.event === "setImage" && x.context === "ctx-showdesktop").length;
	await sleep(250);
	check("Show Desktop: Vivid style and animation off are honored", !decodeSvg(lastImg("ctx-showdesktop").payload.image).includes("#2A2E40") && sent.filter((x) => x.event === "setImage" && x.context === "ctx-showdesktop").length === stillCount);
	desktopSettings({ iconStyle: "neon", iconTheme: "mint", iconLabel: "Desktop" }); await sleep(250);
	const desktopSvg = decodeSvg(lastImg("ctx-showdesktop").payload.image);
	check("Show Desktop: Colourful animation honors custom theme and label", desktopSvg.includes("#00B09B") && desktopSvg.includes("DESKTOP") && desktopSvg.includes("stroke-dashoffset"));
	desktopSettings({}, "willDisappear"); await sleep(100);
	const hiddenCount = sent.filter((x) => x.event === "setImage" && x.context === "ctx-showdesktop").length;
	await sleep(250);
	check("hidden keys stop sending animation frames", sent.filter((x) => x.event === "setImage" && x.context === "ctx-showdesktop").length === hiddenCount);
	desktopSettings({}, "willAppear"); await sleep(150);
	check("Show Desktop label returns when key reappears", decodeSvg(lastImg("ctx-showdesktop").payload.image).includes("SHOW DESKTOP"));

	// Custom picture wins
	const pic = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
	send({ event: "didReceiveSettings", action: "com.dailyops.v2.copy", context: "ctx-copy", device: "DEV1", payload: { settings: { iconImage: pic }, coordinates: { column: 0, row: 3 }, controller: "Keypad", isInMultiAction: false, state: 0 } });
	await sleep(200);
	check("uploaded picture retains its composition inside an animated frame", decodeSvg(lastImg("ctx-copy").payload.image).includes(pic) && decodeSvg(lastImg("ctx-copy").payload.image).includes("stroke-dashoffset"));
	send({ event: "didReceiveSettings", action: "com.dailyops.v2.copy", context: "ctx-copy", device: "DEV1", payload: { settings: { iconImage: pic, animate: false }, coordinates: { column: 0, row: 3 }, controller: "Keypad", isInMultiAction: false, state: 0 } });
	await sleep(150);
	const stillPictureCount = sent.filter((x) => x.event === "setImage" && x.context === "ctx-copy").length;
	await sleep(200);
	check("animation off keeps the exact uploaded picture and stops frames", lastImg("ctx-copy").payload.image === pic && sent.filter((x) => x.event === "setImage" && x.context === "ctx-copy").length === stillPictureCount);

	// Volume hold-to-repeat
	const v0 = dry().filter((c) => c.command === "vol").length;
	send({ event: "keyDown", action: "com.dailyops.v2.voldown", context: "ctx-voldown", device: "DEV1", payload: { settings: {}, coordinates: { column: 2, row: 2 }, isInMultiAction: false, state: 0 } });
	await sleep(1100);
	send({ event: "keyUp", action: "com.dailyops.v2.voldown", context: "ctx-voldown", device: "DEV1", payload: { settings: {}, coordinates: { column: 2, row: 2 }, isInMultiAction: false, state: 0 } });
	const v1 = dry().filter((c) => c.command === "vol").length;
	await sleep(500);
	const v2 = dry().filter((c) => c.command === "vol").length;
	check("holding Volume Down repeats", v1 - v0 >= 4, `${v1 - v0} steps in 1.1s`);
	check("releasing the key stops repeating", v2 === v1);

	// ---- Monitor gestures ----
	const launchFixtures = { "ctx-launch": { target: "Demo App", appName: "Demo App" }, "ctx-vs2": { appId: "Microsoft.VisualStudioCode", appName: "Visual Studio Code" } };
	const press = (uuid, ctx, settings) => send({ event: "keyDown", action: uuid, context: ctx, device: "DEV1", payload: { settings: { ...launchFixtures[ctx], ...settings }, coordinates: { column: 0, row: 0 }, isInMultiAction: false, state: 0 } });
	const release = (uuid, ctx, settings) => send({ event: "keyUp", action: uuid, context: ctx, device: "DEV1", payload: { settings: { ...launchFixtures[ctx], ...settings }, coordinates: { column: 0, row: 0 }, isInMultiAction: false, state: 0 } });
	const since = (n) => dry().slice(n);
	const CL = "com.dailyops.v2.app";
	send({ event: "willAppear", action: CL, context: "ctx-launch", device: "DEV1", payload: { settings: launchFixtures["ctx-launch"], coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false, state: 0 } });
	await sleep(200);

	let m = dry().length;
	press(CL, "ctx-launch", {}); await sleep(50); release(CL, "ctx-launch", {});
	await sleep(150);
	check("single tap waits for a possible double-tap", !since(m).some((c) => c.command === "start"));
	await sleep(400);
	let c = since(m);
	check("single tap → monitor 1, numbered like Windows Display settings by default", c.some((x) => x.command === "start") && c.some((x) => x.command === "place" && x.args[0] === "0" && x.args[1] === "windows"), JSON.stringify(c.map((x) => x.command + ":" + x.args.join(","))));
	check("window snapshot taken before launch", c.findIndex((x) => x.command === "snap") < c.findIndex((x) => x.command === "start"));

	m = dry().length;
	press(CL, "ctx-launch", {}); await sleep(50); release(CL, "ctx-launch", {}); await sleep(120);
	press(CL, "ctx-launch", {}); await sleep(50); release(CL, "ctx-launch", {});
	await sleep(600);
	c = since(m);
	check("double tap → opens once, on monitor 2", c.filter((x) => x.command === "start").length === 1 && c.some((x) => x.command === "place" && x.args[0] === "1"), JSON.stringify(c.map((x) => x.command + ":" + x.args.join(","))));

	m = dry().length;
	press(CL, "ctx-launch", { holdSeconds: "1" });
	await sleep(1300);
	c = since(m);
	check("hold → opens on monitor 3 while still held", c.some((x) => x.command === "place" && x.args[0] === "2"));
	release(CL, "ctx-launch", { holdSeconds: "1" });
	await sleep(500);
	check("releasing after a hold doesn't open it again", since(m).filter((x) => x.command === "start").length === 1);

	m = dry().length;
	press(CL, "ctx-launch", {}); await sleep(900); release(CL, "ctx-launch", {});
	await sleep(500);
	c = since(m);
	check("letting go before 3 s counts as a tap → monitor 1", c.some((x) => x.command === "place" && x.args[0] === "0") && !c.some((x) => x.command === "place" && x.args[0] === "2"));

	m = dry().length;
	press(CL, "ctx-launch", { gestures: false });
	await sleep(150);
	c = since(m);
	check("gestures off → opens immediately, no window moving", c.some((x) => x.command === "start") && !c.some((x) => x.command === "snap" || x.command === "place"));
	release(CL, "ctx-launch", { gestures: false });

	const WS = "com.dailyops.v2.website", wsS = { url: "github.com", browser: "chrome" };
	m = dry().length;
	press(WS, "ctx-website", wsS); await sleep(50); release(WS, "ctx-website", wsS); await sleep(100);
	press(WS, "ctx-website", wsS); await sleep(50); release(WS, "ctx-website", wsS);
	await sleep(700);
	c = since(m);
	check("Chrome website on monitor 2 opens a new window there", c.some((x) => x.command === "cmd" && x.args[1].startsWith("--new-window")) && c.some((x) => x.command === "place" && x.args[0] === "1"));

	const FD = "com.dailyops.v2.folder", fdS = { folderPath: "C:\\Users\\you\\Projects" };
	m = dry().length;
	press(FD, "ctx-folder", fdS); await sleep(50); release(FD, "ctx-folder", fdS); await sleep(100);
	press(FD, "ctx-folder", fdS); await sleep(50); release(FD, "ctx-folder", fdS);
	await sleep(600);
	c = since(m);
	check("folder double tap → monitor 2", c.some((x) => x.command === "folder") && c.some((x) => x.command === "place" && x.args[0] === "1"));
	m = dry().length;
	press("com.dailyops.v2.downloads", "ctx-downloads", fdS); await sleep(50); release("com.dailyops.v2.downloads", "ctx-downloads", fdS); await sleep(100);
	press("com.dailyops.v2.downloads", "ctx-downloads", fdS); await sleep(50); release("com.dailyops.v2.downloads", "ctx-downloads", fdS);
	await sleep(700); c = since(m);
	check("unified Folders preserves the same double-tap monitor 2 gesture", c.some((x) => x.command === "folder") && c.some((x) => x.command === "place" && x.args[0] === "1"));

	// Global monitor order is honoured
	send({ event: "didReceiveGlobalSettings", payload: { settings: { monitorOrder: "left" } } });
	await sleep(100);
	m = dry().length;
	press(CL, "ctx-launch", {}); await sleep(50); release(CL, "ctx-launch", {});
	await sleep(600);
	check("'leftmost first' monitor order is applied", since(m).some((x) => x.command === "place" && x.args[1] === "left"));

	// Volume / copy are not gesture keys (instant)
	m = dry().length;
	press("com.dailyops.v2.copy", "ctx-copy", {});
	await sleep(100);
	check("Copy stays instant (no gesture delay)", since(m).some((x) => x.command === "keys"));
	release("com.dailyops.v2.copy", "ctx-copy", {});

	// ---- Hand-off to the VS Code plugin ----
	const VS = "com.dailyops.v2.app";
	send({ event: "willAppear", action: VS, context: "ctx-vs2", device: "DEV1", payload: { settings: launchFixtures["ctx-vs2"], coordinates: { column: 1, row: 3 }, controller: "Keypad", isInMultiAction: false, state: 0 } });
	await sleep(200);
	m = dry().length;
	press(VS, "ctx-vs2", {}); await sleep(50); release(VS, "ctx-vs2", {});
	await sleep(600);
	c = since(m);
	const ho = c.find((x) => x.command === "url" && x.args[0].startsWith("streamdeck://"));
	check("Open App configured for VS Code opens it and hands off to companion keys", c.some((x) => x.command === "appid" && x.args[0] === "Microsoft.VisualStudioCode") && ho && ho.args[0] === "streamdeck://plugins/message/com.dailyops.vscode.v2/show?device=DEV1&streamdeck=hidden", ho?.args[0]);
	check("hand-off happens after the launch", c.findIndex((x) => x.command === "appid") < c.findIndex((x) => x === ho));
	m = dry().length;
	press(VS, "ctx-vs2", { showKeys: false }); await sleep(50); release(VS, "ctx-vs2", { showKeys: false });
	await sleep(600);
	check("'Switch keys' off → no hand-off", !since(m).some((x) => x.command === "url"));
	m = dry().length;
	press(CL, "ctx-launch", {}); await sleep(50); release(CL, "ctx-launch", {});
	await sleep(600);
	check("apps without a companion plugin don't hand off", !since(m).some((x) => x.command === "url"));


	// ---- Screenshot gestures ----
	const SH = "com.dailyops.v2.screenshot";
	m = dry().length;
	press(SH, "ctx-screenshot", {}); await sleep(50); release(SH, "ctx-screenshot", {}); await sleep(100);
	press(SH, "ctx-screenshot", {}); await sleep(50); release(SH, "ctx-screenshot", {});
	await sleep(300);
	c = since(m).filter((x) => x.command === "shot");
	check("Screenshot double-tap → active window (once)", c.length === 1 && c[0].args[0] === "window", JSON.stringify(c));
	m = dry().length;
	press(SH, "ctx-screenshot", {}); await sleep(1250);
	c = since(m).filter((x) => x.command === "shot");
	check("Screenshot hold 1 s (default) → all screens, while held", c.length === 1 && c[0].args[0] === "all");
	release(SH, "ctx-screenshot", {}); await sleep(450);
	check("releasing after the hold doesn't take another", since(m).filter((x) => x.command === "shot").length === 1);
	const shS = { shotFolder: "D:\\Shots", shotSave: false, shotClipboard: true };
	m = dry().length;
	press(SH, "ctx-screenshot", shS); await sleep(50); release(SH, "ctx-screenshot", shS); await sleep(100);
	press(SH, "ctx-screenshot", shS); await sleep(50); release(SH, "ctx-screenshot", shS);
	await sleep(300);
	c = since(m).find((x) => x.command === "shot");
	check("Screenshot settings: folder, no file, clipboard", c && c.args[1] === "D:\\Shots" && c.args[2] === "0" && c.args[3] === "1", JSON.stringify(c));
	check("window/all screenshots flash ✓", sent.some((x) => x.event === "showOk" && x.context === "ctx-screenshot"));

	// ---- Configurable Monitor Control (Windows numbers intentionally differ from the old fixed keys) ----
	const MC = "com.dailyops.v2.monitorcontrol";
	const lg = { screenKey: "\\\\?\\DISPLAY#GSM2#B", screenNumber: 3 };
	const asus = { screenKey: "\\\\?\\DISPLAY#AUS3#C", screenNumber: 4, sleep: false };
	const monitorImg = (ctx) => decodeSvg(lastImg(ctx).payload.image);
	const screenSettings = (ctx, settings, event = "willAppear") => send({ event, action: MC, context: ctx, device: "DEV1", payload: { settings, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false, state: 0 } });
	const toggles = (entries) => entries.filter((x) => x.command === "mon" || x.command === "moff");
	let monitorSvg = monitorImg("ctx-monitorcontrol");
	check("off screen shows its actual number and green TURN ON", monitorSvg.includes("TURN ON") && monitorSvg.includes("#34D66F") && monitorSvg.includes("MONITOR 3") && />3</.test(monitorSvg));
	m = dry().length;
	press(MC, "ctx-monitorcontrol", lg); await sleep(250); release(MC, "ctx-monitorcontrol", lg);
	c = since(m).find((x) => x.command === "mon");
	check("reconnect uses remembered GDI source 2, independently of displayed monitor 3", c && c.args[0] === lg.screenKey && c.args[1] === "1" && c.args[2] === "2");
	monitorSvg = monitorImg("ctx-monitorcontrol");
	check("on state immediately updates to red TURN OFF", monitorSvg.includes("TURN OFF") && monitorSvg.includes("#FF5A5A") && monitorSvg.includes("MONITOR 3"));

	screenSettings("ctx-other-monitor", asus); await sleep(150);
	check("another instance can select monitor 4", monitorImg("ctx-other-monitor").includes("MONITOR 4") && monitorImg("ctx-other-monitor").includes("TURN OFF"));
	m = dry().length;
	press(MC, "ctx-other-monitor", asus); await sleep(250); release(MC, "ctx-other-monitor", asus);
	c = toggles(since(m))[0];
	check("second key disconnects only its selected monitor and honors sleep off", c && c.command === "moff" && c.args[0] === asus.screenKey && c.args[1] === "0");
	check("second key turns green and retains number while disconnected", monitorImg("ctx-other-monitor").includes("MONITOR 4") && monitorImg("ctx-other-monitor").includes("TURN ON") && monitorImg("ctx-other-monitor").includes("#34D66F"));
	check("first monitor key stays red while another monitor is off", monitorImg("ctx-monitorcontrol").includes("MONITOR 3") && monitorImg("ctx-monitorcontrol").includes("TURN OFF"));

	screenSettings("ctx-duplicate-monitor", asus); await sleep(100);
	press(MC, "ctx-duplicate-monitor", asus); await sleep(250); release(MC, "ctx-duplicate-monitor", asus);
	check("all keys for the same screen update after reconnecting it", ["ctx-other-monitor", "ctx-duplicate-monitor"].every((ctx) => monitorImg(ctx).includes("TURN OFF") && monitorImg(ctx).includes("MONITOR 4")));
	// Changing the selection on an existing key changes both the label and the controlled screen.
	screenSettings("ctx-monitorcontrol", asus, "didReceiveSettings"); await sleep(100);
	m = dry().length;
	press(MC, "ctx-monitorcontrol", asus); await sleep(250); release(MC, "ctx-monitorcontrol", asus);
	check("changing selection targets the newly chosen physical screen", toggles(since(m)).length === 1 && toggles(since(m))[0].args[0] === asus.screenKey && monitorImg("ctx-monitorcontrol").includes("MONITOR 4") && monitorImg("ctx-monitorcontrol").includes("TURN ON"));
	screenSettings("ctx-monitorcontrol", lg, "didReceiveSettings"); await sleep(100);

	// No selection or a missing physical screen must never toggle a fallback screen.
	for (const [name, settings, expected] of [
		["unconfigured", {}, "SELECT"],
		["missing", { screenKey: "unplugged-monitor", screenNumber: 7, screenName: "Unplugged" }, "NOT FOUND"],
	]) {
		const ctx = "ctx-monitor-" + name;
		screenSettings(ctx, settings); await sleep(100);
		check(`${name} monitor renders its correct state`, monitorImg(ctx).includes(expected) && (name !== "missing" || monitorImg(ctx).includes("MONITOR 7")));
		const alerts = sent.filter((x) => x.event === "showAlert" && x.context === ctx).length;
		m = dry().length;
		press(MC, ctx, settings); await sleep(200); release(MC, ctx, settings);
		check(`${name} monitor shows alert without toggling any screen`, toggles(since(m)).length === 0 && sent.filter((x) => x.event === "showAlert" && x.context === ctx).length === alerts + 1);
	}
	const primary = { screenKey: "\\\\?\\DISPLAY#DEL1#A", screenNumber: 2 };
	screenSettings("ctx-primary-monitor", primary); await sleep(100);
	m = dry().length;
	press(MC, "ctx-primary-monitor", primary); await sleep(250); release(MC, "ctx-primary-monitor", primary);
	check("main display can be disconnected when another screen is active", toggles(since(m)).some((x) => x.command === "moff" && x.args[0] === primary.screenKey) && monitorImg("ctx-primary-monitor").includes("TURN ON"));
	// ASUS is already off; LG is now the only active screen and must stay on.
	const lgAlerts = sent.filter((x) => x.event === "showAlert" && x.context === "ctx-monitorcontrol").length;
	press(MC, "ctx-monitorcontrol", lg); await sleep(250); release(MC, "ctx-monitorcontrol", lg);
	check("the last active screen stays on and reports an alert", monitorImg("ctx-monitorcontrol").includes("TURN OFF") && sent.filter((x) => x.event === "showAlert" && x.context === "ctx-monitorcontrol").length === lgAlerts + 1);
	press(MC, "ctx-primary-monitor", primary); await sleep(250); release(MC, "ctx-primary-monitor", primary);
	check("a former main display can be reconnected with the same key", monitorImg("ctx-primary-monitor").includes("TURN OFF") && monitorImg("ctx-primary-monitor").includes("MONITOR 2"));
	send({ event: "propertyInspectorDidAppear", action: MC, context: "ctx-monitorcontrol", device: "DEV1" });
	await sleep(100);
	send({ event: "sendToPlugin", action: MC, context: "ctx-monitorcontrol", payload: { event: "getScreens" } });
	const scr = await waitFor((x) => x.event === "sendToPropertyInspector" && x.payload?.event === "screens");
	check("settings panel gets the screen list (with numbers kept for off screens)", scr.payload.list.length === 3 && scr.payload.list.find((x) => x.key.includes("AUS3")).num === 4);

	// ---- Apps page ----
	const AF = "com.dailyops.v2.appsfolder", BK = "com.dailyops.v2.back";
	let sw0 = sent.filter((x) => x.event === "switchToProfile").length;
	press(AF, "ctx-appsfolder", {}); await sleep(300); release(AF, "ctx-appsfolder", {});
	let sws = sent.filter((x) => x.event === "switchToProfile").slice(sw0);
	check("Apps key → shows the bundled Apps page", sws.length === 1 && sws[0].payload?.profile === "profiles/Apps" && sws[0].device === "DEV1", JSON.stringify(sws));
	check("manifest bundles the Apps page", manifest.Profiles?.[0]?.Name === "profiles/Apps" && existsSync(join(sd, "profiles/Apps.streamDeckProfile")));
	send({ event: "willAppear", action: BK, context: "ctx-apps-back", device: "DEV1", payload: { settings: {}, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false, state: 0 } });
	await sleep(150);
	// An app without its own keys → stays on the Apps page
	sw0 = sent.filter((x) => x.event === "switchToProfile").length;
	press(CL, "ctx-launch", {}); await sleep(50); release(CL, "ctx-launch", {});
	await sleep(600);
	check("Apps page: a generic app opens and keeps the Apps page visible", sent.filter((x) => x.event === "switchToProfile").length === sw0);
	// VS Code chosen on an Open App key → steps back to main keys, then hands off to the VS Code keys
	const vsApp = { appId: "Microsoft.VisualStudioCode", appName: "Visual Studio Code" };
	send({ event: "willAppear", action: "com.dailyops.v2.app", context: "ctx-app-vs", device: "DEV1", payload: { settings: vsApp, coordinates: { column: 3, row: 1 }, controller: "Keypad", isInMultiAction: false, state: 0 } });
	await sleep(200);
	m = dry().length;
	press("com.dailyops.v2.app", "ctx-app-vs", vsApp); await sleep(50); release("com.dailyops.v2.app", "ctx-app-vs", vsApp);
	await sleep(700);
	sws = sent.filter((x) => x.event === "switchToProfile").slice(sw0);
	const shows = since(m).filter((x) => x.command === "url" && x.args[0].includes("/show?device=DEV1"));
	check("Apps page: an app with its own keys (VS Code via Open App) hands off", shows.length === 1);
	check("…after first stepping back to the main keys (so Back never loops)", sws.length === 1 && !sws[0].payload?.profile);
	// Open Apps again, then Back
	press(AF, "ctx-appsfolder", {}); await sleep(300); release(AF, "ctx-appsfolder", {});
	sw0 = sent.filter((x) => x.event === "switchToProfile").length;
	m = dry().length;
	press(BK, "ctx-apps-back", {}); await sleep(300); release(BK, "ctx-apps-back", {});
	sws = sent.filter((x) => x.event === "switchToProfile").slice(sw0);
	check("Back → previous (main) keys, and VS Code follow-focus is released", sws.length === 1 && !sws[0].payload?.profile && since(m).some((x) => x.command === "url" && x.args[0].includes("/release")));
	const WF = "com.dailyops.v2.websitefolder";
	sw0 = sent.filter((x) => x.event === "switchToProfile").length;
	press(WF, "ctx-websitefolder", {}); await sleep(200); release(WF, "ctx-websitefolder", {});
	sws = sent.filter((x) => x.event === "switchToProfile").slice(sw0);
	check("Website Folder opens the plugin-owned Websites page", sws.length === 1 && sws[0].payload?.profile === "profiles/Websites");
	sw0 = sent.filter((x) => x.event === "switchToProfile").length;
	press(AF, "ctx-appsfolder", {}); await sleep(200); release(AF, "ctx-appsfolder", {});
	sws = sent.filter((x) => x.event === "switchToProfile").slice(sw0);
	check("switching collections steps through main keys so Back cannot loop", sws.length === 2 && !sws[0].payload?.profile && sws[1].payload?.profile === "profiles/Apps");
	press(BK, "ctx-apps-back", {}); await sleep(200); release(BK, "ctx-apps-back", {});

	// Settings panel → plugin (Stream Deck announces the panel first)
	send({ event: "propertyInspectorDidAppear", action: "com.dailyops.v2.app", context: "ctx-app", device: "DEV1" });
	await sleep(100);
	send({ event: "sendToPlugin", action: "com.dailyops.v2.app", context: "ctx-app", payload: { event: "getApps" } });
	const apps = await waitFor((m) => m.event === "sendToPropertyInspector" && m.payload?.event === "apps");
	check("settings panel receives installed-app list", apps.payload.ok && apps.payload.apps.length >= 3 && apps.payload.apps[0].n);
	const s = { appId: "Example.SampleApp", appName: "Sample App" };
	send({ event: "sendToPlugin", action: "com.dailyops.v2.app", context: "ctx-app", payload: { event: "getIcon", settings: s } });
	const ic = await waitFor((m) => m.event === "sendToPropertyInspector" && m.payload?.event === "icon");
	send({ event: "sendToPlugin", action: "com.dailyops.v2.app", context: "ctx-app", payload: { event: "getMonitors", order: "primary" } });
	const mons = await waitFor((m) => m.event === "sendToPropertyInspector" && m.payload?.event === "monitors");
	check("settings panel gets the monitor list", mons.payload.ok && mons.payload.list.length === 3);
	check("settings panel preview gets the real icon", ic.payload.real === true && decodeSvg(ic.payload.image).includes("data:image/png") && ic.payload.token === JSON.stringify(s));
	const secretCanary = "test-only-sensitive-never-log-this";
	send({ event: "sendToPlugin", action: "com.dailyops.v2.app", context: "ctx-app", payload: { event: "protectPassword", requestId: "test-protection-failure", password: secretCanary, binding: "appid:fixture" } });
	const protectedReply = await waitFor((x) => x.event === "sendToPropertyInspector" && x.payload?.event === "credentials" && x.payload.requestId === "test-protection-failure");
	check("password protection fails closed when native encryption is unavailable", protectedReply.payload.ok === false && !sent.some((x) => x.event === "setSettings" && JSON.stringify(x).includes(secretCanary)));
	check("password commands never leak sensitive arguments to test logs", !readFileSync(LOG, "utf8").includes(secretCanary) && !out.includes(secretCanary));
	send({ event: "propertyInspectorDidAppear", action: WF, context: "ctx-websitefolder", device: "DEV1" });
	await sleep(50); sw0 = sent.filter((x) => x.event === "switchToProfile").length;
	send({ event: "sendToPlugin", action: WF, context: "ctx-websitefolder", payload: { event: "openWebsites" } });
	await sleep(150); sws = sent.filter((x) => x.event === "switchToProfile").slice(sw0);
	check("Website Folder settings button opens the bundled collection", sws.at(-1)?.payload?.profile === "profiles/Websites");
	send({ event: "propertyInspectorDidAppear", action: BK, context: "ctx-apps-back", device: "DEV1" });
	await sleep(50); sw0 = sent.filter((x) => x.event === "switchToProfile").length;
	send({ event: "sendToPlugin", action: BK, context: "ctx-apps-back", payload: { event: "returnMain" } });
	await sleep(150); sws = sent.filter((x) => x.event === "switchToProfile").slice(sw0);
	check("Back settings button restores main keys", sws.length === 1 && !sws[0].payload?.profile);
} catch (e) {
	check("harness", false, e.message);
} finally {
	proc.kill();
	wss.close();
	console.log(`\n${pass} passed, ${fail} failed`);
	if (fail) console.log("--- plugin output ---\n" + out.slice(-3000));
	process.exit(fail ? 1 : 0);
}
