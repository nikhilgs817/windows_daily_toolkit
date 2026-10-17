// Exercise the real property inspector in a browser, with Stream Deck transport mocked.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { keySvg, monitorKeySvg, svgDataUri } from "../shared/icons.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ui = join(root, "plugins/dailyops/com.dailyops.v2.sdPlugin/ui");
const output = join(root, "test-output");
mkdirSync(output, { recursive: true });
const server = createServer((req, res) => {
	const name = new URL(req.url, "http://localhost").pathname.slice(1) || "pi.html";
	if (!["pi.html", "pi.js", "pi.css", "icons.js"].includes(name)) { res.writeHead(404).end(); return; }
	res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[extname(name)]);
	res.end(readFileSync(join(ui, name)));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
try {
	const page = await browser.newPage({ viewport: { width: 440, height: 760 } });
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const screens = [
		{ key: "main", name: "Main display", num: 1, on: true, primary: true },
		{ key: "monitor-two", name: "DELL screen", num: 2, on: true, primary: false },
		{ key: "monitor-three", name: "DELL screen", num: 3, on: false, primary: false },
	];
	await page.exposeFunction("inspectorImage", (settings) => {
		if (settings.appId) return svgDataUri(keySvg({ glyph: "rocket", theme: "aurora", label: settings.appName || "Open App", style: "neon" }));
		const screen = screens.find((s) => s.key === settings.screenKey);
		const n = screen?.num || settings.screenNumber || "?";
		const state = !settings.screenKey ? "unconfigured" : !screen ? "missing" : screen.on ? "on" : "off";
		return svgDataUri(monitorKeySvg({ n, state, caption: settings.iconLabel || (!settings.screenKey ? "Monitor Control" : `Monitor ${n}`) }));
	});
	await page.addInitScript(({ screens }) => {
		window.savedSettings = [];
		window.testScreens = screens;
		window.mockSecret = "";
		window.navEvents = [];
		window.WebSocket = class {
			readyState = 1;
			constructor() { window.inspectorSocket = this; setTimeout(() => this.onopen?.(), 0); }
			send(raw) {
				const message = JSON.parse(raw);
				if (["openWebsites", "returnMain"].includes(message.payload?.event)) window.navEvents.push(message.payload.event);
				if (message.event === "setSettings") window.savedSettings.push(structuredClone(message.payload));
				if (message.payload?.event === "getApps") this.reply({ event: "apps", ok: true, apps: [{ n: "Test App", id: "fixture" }] });
				if (message.payload?.event === "protectPassword") {
					if (window.failProtection) this.reply({ event: "credentials", requestId: message.payload.requestId, ok: false, error: "Encryption unavailable. Nothing saved." });
					else { window.mockSecret = message.payload.password; this.reply({ event: "credentials", requestId: message.payload.requestId, ok: true, protectedPassword: "dpapi:v1:VEVTVEZJWFRVUkU=" }); }
				}
				if (message.payload?.event === "revealPassword") this.reply({ event: "credentials", requestId: message.payload.requestId, ok: true, password: window.mockSecret });
				if (message.payload?.event === "getScreens") this.reply({ event: "screens", ok: true, list: window.testScreens });
				if (["getIcon", "refreshIcon"].includes(message.payload?.event)) {
					const settings = structuredClone(message.payload.settings);
					window.inspectorImage(settings).then((image) => this.reply({ event: "icon", image, real: !!window.returnRealIcon, sourceImage: window.returnRealIcon ? "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP4z8DwnwEJMDIwMDAwAAAvAQQAJ8TtbQAAAABJRU5ErkJggg==" : "", token: JSON.stringify(settings) }));
				}
			}
			reply(payload) { setTimeout(() => this.onmessage?.({ data: JSON.stringify({ event: "sendToPropertyInspector", payload }) }), 0); }
		};
	}, { screens });
	await page.goto(`http://127.0.0.1:${server.address().port}/pi.html`);
	await page.evaluate(() => window.connectElgatoStreamDeckSocket(12345, "test-inspector", "registerPropertyInspector", "{}", JSON.stringify({ action: "com.dailyops.v2.monitorcontrol", payload: { settings: {} } })));
	await page.waitForFunction(() => document.querySelectorAll("#screenPick option").length === 4);
	assert.equal(await page.locator("#sec-screen").isVisible(), true);
	assert.equal(await page.locator("#screenPick").inputValue(), "");
	assert.equal(await page.locator('#screenPick option[value="main"]').isDisabled(), false);
	assert.equal(await page.locator("#styleRow").isVisible(), false);
	assert.match(await page.locator("#screenStatus").textContent(), /Choose the monitor/);
	console.log("PASS  Monitor Control settings start unselected and allow selecting the main display");
	await page.locator("#screenPick").selectOption("main");
	await page.waitForFunction(() => window.savedSettings.at(-1)?.screenKey === "main");
	assert.match(await page.locator("#screenStatus").textContent(), /another active screen becomes the main display/);
	console.log("PASS  the main display can be selected without a blocking warning");

	await page.locator("#screenPick").selectOption("monitor-two");
	await page.waitForFunction(() => window.savedSettings.at(-1)?.screenNumber === 2);
	assert.deepEqual(await page.evaluate(() => window.savedSettings.at(-1)), { screenKey: "monitor-two", screenName: "DELL screen", screenNumber: 2 });
	await page.waitForFunction(() => document.querySelector("#preview")?.textContent.includes("TURN OFF"));
	assert.match(await page.locator("#screenStatus").textContent(), /red TURN OFF/);
	await page.screenshot({ path: join(output, "monitor-control-settings-on.png") });
	console.log("PASS  selecting Monitor 2 persists its identity/number and previews red TURN OFF");

	await page.locator("#screenPick").selectOption("monitor-three");
	await page.waitForFunction(() => document.querySelector("#preview")?.textContent.includes("TURN ON"));
	assert.equal(await page.evaluate(() => window.savedSettings.at(-1).screenNumber), 3);
	assert.match(await page.locator("#screenStatus").textContent(), /green TURN ON/);
	await page.screenshot({ path: join(output, "monitor-control-settings-off.png") });
	console.log("PASS  selecting a disconnected Monitor 3 preserves its number and previews green TURN ON");

	await page.evaluate(() => { window.testScreens = window.testScreens.filter((s) => s.key !== "monitor-three"); });
	await page.locator("#screenRefresh").click();
	await page.waitForFunction(() => document.querySelector("#screenStatus").textContent.includes("isn't connected"));
	assert.equal(await page.locator("#screenPick").inputValue(), "monitor-three");
	assert.match(await page.locator('#screenPick option:checked').textContent(), /not connected/);
	console.log("PASS  unplugging a chosen monitor keeps that selection without falling back to another screen");
	for (const id of ["screenshot", "showdesktop", "downloads", "appsfolder", "websitefolder", "website", "copy", "paste", "volup", "voldown", "back", "monitorcontrol", "app", "folder"]) {
		await page.goto(`http://127.0.0.1:${server.address().port}/pi.html`);
		await page.evaluate((id) => window.connectElgatoStreamDeckSocket(12345, "test-inspector", "registerPropertyInspector", "{}", JSON.stringify({ action: "com.dailyops.v2." + id, payload: { settings: {} } })), id);
		await page.waitForSelector("#motionRow", { state: "visible" });
		assert.equal(await page.locator("#animate").isChecked(), true);
		const firstPhase = await page.locator('#preview rect[stroke-dashoffset]').getAttribute("stroke-dashoffset");
		await page.waitForFunction((first) => document.querySelector('#preview rect[stroke-dashoffset]')?.getAttribute("stroke-dashoffset") !== first, firstPhase);
		if (id !== "monitorcontrol") await page.locator('#styleSeg button[data-style="vivid"]').click();
		else {
			await page.locator('#animate').uncheck();
			await page.waitForFunction(() => window.savedSettings.at(-1)?.animate === false);
			assert.equal(await page.locator('#preview rect[stroke-dashoffset]').count(), 0);
			console.log("PASS  Monitor Control animates with its state colours and honors animation off");
			continue;
		}
		await page.waitForFunction(() => window.savedSettings.at(-1)?.iconStyle === "vivid");
		assert.equal(await page.locator('#styleSeg button[data-style="vivid"]').getAttribute("class"), "on");
		if (["screenshot", "showdesktop", "downloads"].includes(id)) await page.screenshot({ path: join(output, `${id}-vivid-settings.png`), fullPage: true });
		await page.locator('#styleSeg button[data-style="neon"]').click();
		await page.waitForFunction(() => window.savedSettings.at(-1)?.iconStyle === "neon");
		if (["screenshot", "showdesktop"].includes(id)) await page.screenshot({ path: join(output, `${id}-colourful-settings.png`), fullPage: true });
		await page.locator('#animate').uncheck();
		await page.waitForFunction(() => window.savedSettings.at(-1)?.animate === false);
		assert.equal(await page.locator('#preview rect[stroke-dashoffset]').count(), 0);
		console.log(`PASS  ${id}: live animation, Colourful/Vivid choices, and animation switch work`);
	}
	await page.goto(`http://127.0.0.1:${server.address().port}/pi.html`);
	await page.evaluate(() => window.connectElgatoStreamDeckSocket(12345, "test-inspector", "registerPropertyInspector", "{}", JSON.stringify({ action: "com.dailyops.v2.downloads", payload: { settings: {} } })));
	await page.waitForSelector("#sec-folder", { state: "visible" });
	assert.doesNotMatch(await page.locator("#folderPath").getAttribute("placeholder"), /Leave empty|Downloads folder/);
	assert.match(await page.locator("#folderHint").innerText(), /File Explorer.*Alt\+D.*copy the full path.*paste it above/);
	await page.locator("#folderPath").fill("C:\\Users\\you\\Documents\\Projects");
	await page.waitForFunction(() => window.savedSettings.at(-1)?.folderPath === "C:\\Users\\you\\Documents\\Projects");
	await page.locator("#folderNameLabel").check();
	assert.equal(await page.evaluate(() => window.savedSettings.at(-1).folderNameLabel), true);
	assert.equal(await page.locator('#iconLabel').getAttribute('placeholder'), 'Projects');
	await page.locator("#folderNameLabel").uncheck();
	assert.equal(await page.locator('#iconLabel').getAttribute('placeholder'), 'Folders');
	console.log("PASS unified Folders offers automatic folder-name labels and the original fixed label without changing path/monitor settings");
	assert.equal(await page.locator("#sec-monitor").isVisible(), true);
	assert.equal(await page.locator("#gestures").isChecked(), true);
	assert.equal(await page.locator("#holdSeconds").inputValue(), "3");
	assert.equal(await page.locator("#monitorOrder").inputValue(), "windows");
	assert.deepEqual(await page.locator("#sec-monitor .gest > div > span").allTextContents(), ["Monitor 1", "Monitor 2", "Monitor 3"]);
	console.log("PASS  Folders accepts a full path with clear instructions and preserves the monitor controls");
	for (const style of ["neon", "vivid"]) {
		await page.locator(`#styleSeg button[data-style="${style}"]`).click();
		for (const theme of ["sunset", "tropical", "electric", "cosmic", "peach", "lemonade"]) {
			await page.locator(`#themes button[data-theme="${theme}"]`).click();
			await page.waitForFunction(({ style, theme }) => window.savedSettings.at(-1)?.iconStyle === style && window.savedSettings.at(-1)?.iconTheme === theme, { style, theme });
			assert.equal(await page.locator(`#themes button[data-theme="${theme}"]`).getAttribute("class"), "swatch on");
			assert.deepEqual(await page.locator("#preview text").allTextContents(), ["FOLDERS", "FOLDERS"]);
		}
	}
	await page.screenshot({ path: join(output, "folders-settings.png"), fullPage: true });
	console.log("PASS  all six new gradients can be selected in Colourful and Vivid with the Folders preview");
	await page.goto(`http://127.0.0.1:${server.address().port}/pi.html`);
	await page.evaluate(() => window.connectElgatoStreamDeckSocket(12345, "test-inspector", "registerPropertyInspector", "{}", JSON.stringify({ action: "com.dailyops.v2.app", payload: { settings: { appId: "fixture", appName: "Test App" } } })));
	await page.waitForSelector("#sec-credentials", { state: "visible" });
	assert.match(await page.locator("#sec-credentials").textContent(), /compatible desktop login form/);
	assert.doesNotMatch(await page.locator("#sec-credentials").textContent(), /fidelity|thinkorswim/i);
	assert.equal(await page.locator("#credentialPassword").getAttribute("type"), "password");
	await page.locator("#credentialUsername").fill("test-user");
	await page.locator("#credentialPassword").fill("test-only secret %{} 密碼");
	await page.locator("#passwordEye").click();
	assert.equal(await page.locator("#credentialPassword").getAttribute("type"), "text");
	assert.equal(await page.locator("#passwordEye").getAttribute("aria-label"), "Hide password");
	await page.locator("#passwordEye").click();
	assert.equal(await page.locator("#credentialPassword").getAttribute("type"), "password");
	console.log("PASS  credentials are optional on Open App and the eye toggles typed passwords");
	await page.locator("#saveCredentials").click();
	await page.waitForFunction(() => window.savedSettings.at(-1)?.credentialPassword?.startsWith("dpapi:v1:"));
	const saved = await page.evaluate(() => window.savedSettings.at(-1));
	assert.equal(saved.credentialUsername, "test-user");
	assert.equal(saved.credentialAutofill, true);
	assert.equal(saved.credentialApp, "appid:fixture");
	assert.equal(await page.locator("#credentialPassword").inputValue(), "");
	assert.equal(await page.evaluate(() => JSON.stringify(window.savedSettings).includes("test-only secret")), false);
	console.log("PASS  only protected password data reaches persisted settings and plaintext is cleared after save");
	await page.locator("#passwordEye").click();
	await page.waitForFunction(() => document.querySelector("#credentialPassword").type === "text");
	assert.equal(await page.locator("#credentialPassword").inputValue(), "test-only secret %{} 密碼");
	await page.evaluate(() => window.dispatchEvent(new Event("blur")));
	assert.equal(await page.locator("#credentialPassword").getAttribute("type"), "password");
	assert.equal(await page.locator("#credentialPassword").inputValue(), "");
	console.log("PASS  saved passwords reveal only on request and hide/clear when the window loses focus");
	await page.evaluate(() => { window.failProtection = true; });
	await page.locator("#credentialPassword").fill("replacement-test-secret");
	await page.locator("#saveCredentials").click();
	await page.waitForFunction(() => document.querySelector("#credentialStatus").textContent.includes("Encryption unavailable"));
	assert.equal(await page.evaluate(() => window.savedSettings.at(-1).credentialPassword), saved.credentialPassword);
	assert.equal(await page.evaluate(() => JSON.stringify(window.savedSettings).includes("replacement-test-secret")), false);
	console.log("PASS  encryption failure keeps the existing encrypted password and never saves plaintext");
	await page.locator("#appClear").click();
	assert.equal(await page.evaluate(() => window.savedSettings.at(-1).credentialPassword), undefined);
	assert.equal(await page.locator("#credentialPassword").inputValue(), "");
	console.log("PASS  changing the selected app clears credentials and pending plaintext");
	await page.evaluate((saved) => window.inspectorSocket.onmessage({ data: JSON.stringify({ event: "didReceiveSettings", payload: { settings: saved } }) }), saved);
	await page.locator("#clearCredentials").click();
	assert.equal(await page.evaluate(() => window.savedSettings.at(-1).credentialPassword), undefined);
	assert.equal(await page.evaluate(() => window.savedSettings.at(-1).appId), "fixture");
	await page.waitForFunction(() => !document.querySelector("#styleHint").textContent.includes("Fetching"));
	await page.screenshot({ path: join(output, "open-app-credentials-settings.png"), fullPage: true });
	console.log("PASS  clearing credentials preserves the chosen application");
	await page.goto(`http://127.0.0.1:${server.address().port}/pi.html`);
	await page.evaluate(() => {
		window.returnRealIcon = true;
		window.connectElgatoStreamDeckSocket(12345, "test-inspector", "registerPropertyInspector", "{}", JSON.stringify({ action: "com.dailyops.v2.app", payload: { settings: { appId: "fixture", appName: "Test App" } } }));
	});
	await page.waitForSelector('#preview image[transform]');
	const floating = await page.locator('#preview image').getAttribute('transform');
	await page.waitForFunction((before) => document.querySelector('#preview image')?.getAttribute('transform') !== before, floating);
	assert.match(await page.locator('#preview image').getAttribute('href'), /^data:image\/png/);
	await page.locator('#animate').uncheck();
	assert.equal(await page.locator('#preview image').getAttribute('transform'), null);
	console.log("PASS  real app icons retain their image and animate in the inspector; animation off stops the float");
	const custom = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP4z8DwnwEJMDIwMDAwAAAvAQQAJ8TtbQAAAABJRU5ErkJggg==';
	await page.evaluate((iconImage) => window.inspectorSocket.onmessage({ data: JSON.stringify({ event: 'didReceiveSettings', payload: { settings: { appId: 'fixture', iconImage } } }) }), custom);
	assert.equal(await page.locator('#preview image').getAttribute('href'), custom);
	assert.equal(await page.locator('#preview image').getAttribute('width'), '144');
	assert.equal(await page.locator('#preview rect[stroke-dashoffset]').count(), 1);
	await page.locator('#animate').uncheck();
	assert.equal(await page.locator('#preview img').getAttribute('src'), custom);
	console.log("PASS  custom-picture previews keep the full original picture with a moving frame, or the exact still picture when paused");
	await page.goto(`http://127.0.0.1:${server.address().port}/pi.html`);
	await page.evaluate(() => window.connectElgatoStreamDeckSocket(12345, 'test-inspector', 'registerPropertyInspector', '{}', JSON.stringify({ action: 'com.dailyops.vscode.v2.terminal', payload: { settings: {} } })));
	await page.waitForSelector('#motionRow', { state: 'visible' });
	assert.equal(await page.locator('#styleSeg button[data-style="pro"]').getAttribute('class'), 'on');
	const proPhase = await page.locator('#preview rect[stroke-dashoffset]').getAttribute('stroke-dashoffset');
	await page.waitForFunction((before) => document.querySelector('#preview rect[stroke-dashoffset]')?.getAttribute('stroke-dashoffset') !== before, proPhase);
	console.log("PASS  companion Pro previews animate with the same per-key controls");
	await page.goto(`http://127.0.0.1:${server.address().port}/pi.html`);
	await page.evaluate(() => window.connectElgatoStreamDeckSocket(12345, 'test-inspector', 'registerPropertyInspector', '{}', JSON.stringify({ action: 'com.dailyops.v2.websitefolder', payload: { settings: {} } })));
	await page.waitForSelector('#sec-websites', { state: 'visible' });
	assert.equal(await page.locator('#sec-folder').isVisible(), false);
	assert.equal(await page.locator('#sec-website').isVisible(), false);
	assert.equal(await page.locator('#styleSeg button[data-style="vivid"]').getAttribute('class'), 'on');
	assert.equal(await page.locator('#preview [data-glyph-motion="websitefolder"]').count(), 1);
	await page.locator('#openWebsites').click();
	assert.deepEqual(await page.evaluate(() => window.navEvents), ['openWebsites']);
	await page.screenshot({ path: join(output, 'website-folder-settings.png'), fullPage: true });
	console.log("PASS Website Folder keeps the approved Vivid folder/globe and opens its plugin-owned collection from settings");
	assert.deepEqual(errors, []);
	console.log("PASS  property inspector runs without browser errors");
} finally {
	await browser.close();
	await new Promise((done) => server.close(done));
}
