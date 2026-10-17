import streamDeck from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";
import { REGISTRY, globals } from "../../../shared/base.js";
import { ps } from "../../../shared/ps.js";
import { credentialBinding } from "../../../shared/credentials.js";
import { ALL_ACTIONS } from "./actions.js";
import { refreshScreens, screenNumber, screens } from "./screens.js";
import { leaveApps, openWebsites } from "./nav.js";

streamDeck.logger.setLevel("info");
const log = streamDeck.logger.createScope("plugin");

for (const A of ALL_ACTIONS) streamDeck.actions.registerAction(new A());

/** Settings panel ➜ plugin messages. */
streamDeck.ui.onSendToPlugin<{ event?: string; settings?: JsonObject; password?: string; requestId?: string; binding?: string }>(async (ev) => {
	const event = ev.payload?.event;
	if (event === "openWebsites" || event === "returnMain") {
		const required = event === "openWebsites" ? "com.dailyops.v2.websitefolder" : "com.dailyops.v2.back";
		if (ev.action.manifestId !== required || streamDeck.ui.action?.id !== ev.action.id) return;
		if (event === "openWebsites") await openWebsites(ev.action.device.id);
		else await leaveApps(ev.action.device.id);
		return;
	}
	if (event === "protectPassword" || event === "revealPassword") {
		if (ev.action.manifestId !== "com.dailyops.v2.app" || streamDeck.ui.action?.id !== ev.action.id) return;
		const requestId = ev.payload.requestId;
		if (typeof requestId !== "string" || requestId.length > 256) return;
		const reply = async (payload: JsonObject) => {
			if (streamDeck.ui.action?.id === ev.action.id) await streamDeck.ui.sendToPropertyInspector({ event: "credentials", requestId, ...payload });
		};
		try {
			if (event === "protectPassword") {
				const password = ev.payload.password;
				if (typeof password !== "string" || !password.length || password.length > 4096) { await reply({ ok: false, error: "Enter a password of up to 4096 characters." }); return; }
				const binding = ev.payload.binding;
				if (typeof binding !== "string" || !binding.length || binding.length > 4096) { await reply({ ok: false, error: "Choose an app before saving credentials." }); return; }
				const result = await ps.run("secret-protect", [password, binding]);
				await reply(result.status === "ok" && result.message.startsWith("dpapi:v1:") ? { ok: true, protectedPassword: result.message } : { ok: false, error: "Could not encrypt the password. Nothing was saved." });
			} else {
				const settings = await ev.action.getSettings();
				const protectedPassword = settings.credentialPassword;
				if (typeof protectedPassword !== "string" || !protectedPassword.startsWith("dpapi:v1:") || protectedPassword.length > 32768) { await reply({ ok: false, error: "No saved password on this key." }); return; }
				const binding = credentialBinding(settings);
				if (!binding || settings.credentialApp !== binding) { await reply({ ok: false, error: "The selected app changed. Save credentials for this app again." }); return; }
				const result = await ps.run("secret-unprotect", [protectedPassword, binding]);
				await reply(result.status === "ok" ? { ok: true, password: result.message } : { ok: false, error: "The saved password could not be opened for this Windows account. Enter it again to replace it." });
			}
		} catch { await reply({ ok: false, error: "Password protection is unavailable. Nothing was changed." }); }
		return;
	}
	if (event === "getApps") {
		const r = await ps.run("apps", [], 30_000);
		let apps: JsonValue = [];
		if (r.status === "ok") {
			try {
				apps = JSON.parse(r.message) as JsonValue;
			} catch (e) {
				log.error(`Could not parse app list: ${(e as Error).message}`);
			}
		} else {
			log.warn(`App list failed: ${r.message}`);
		}
		await streamDeck.ui.sendToPropertyInspector({ event: "apps", ok: r.status === "ok", error: r.status === "ok" ? "" : r.message, apps });
		return;
	}
	if (event === "getMonitors") {
		const o = (ev.payload as { order?: string }).order;
		const order = o === "left" || o === "primary" ? o : "windows";
		const r = await ps.run("monitors", [order]);
		let list: JsonValue = [];
		try {
			if (r.status === "ok") list = JSON.parse(r.message) as JsonValue;
		} catch {
			/* ignore */
		}
		await streamDeck.ui.sendToPropertyInspector({ event: "monitors", ok: r.status === "ok", error: r.status === "ok" ? "" : r.message, list });
		return;
	}
	if (event === "getScreens") {
		await refreshScreens();
		const list = screens().map((x) => ({ key: x.key, name: x.name, on: x.on, num: screenNumber(x), primary: x.primary }));
		await streamDeck.ui.sendToPropertyInspector({ event: "screens", ok: true, list });
		return;
	}
	if (event === "getIcon" || event === "refreshIcon") {
		const inst = REGISTRY.get(ev.action.manifestId);
		if (!inst) return;
		// The panel sends its current settings so the preview never races a just-saved change.
		const settings = ev.payload.settings ?? ((await ev.action.getSettings()) as JsonObject);
		if (event === "refreshIcon") await inst.refreshIcon(settings);
		const rendered = await inst.imageFinal(settings);
		await streamDeck.ui.sendToPropertyInspector({ event: "icon", ...rendered, token: JSON.stringify(settings) });
	}
});

// Warm up PowerShell + the Start-menu app cache so the first key press is instant.
ps.start();
void ps.run("warm", [], 60_000).then((r) => log.info(`warm-up: ${r.status} ${r.message}`));

streamDeck.settings.onDidReceiveGlobalSettings((ev) => Object.assign(globals, ev.settings));

await streamDeck.connect();
try {
	Object.assign(globals, await streamDeck.settings.getGlobalSettings());
} catch (e) {
	log.warn(`global settings: ${(e as Error).message}`);
}
