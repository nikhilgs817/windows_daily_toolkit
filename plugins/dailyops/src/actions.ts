import streamDeck, { action, type Action, type DidReceiveSettingsEvent, type KeyDownEvent, type KeyUpEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import {
	APP_PRESETS,
	DailyAction,
	GestureAction,
	LaunchAction,
	launchApp,
	looksLikePath,
	looksLikeUrl,
	log,
	type AppPreset,
	type AppSettings,
	type Appearance,
	type FolderSettings,
	type MonitorSettings,
	type Press,
	type ScreenshotSettings,
	type VolumeSettings,
	type WebsiteSettings,
} from "../../../shared/base.js";
import { ps, type PsResult } from "../../../shared/ps.js";
import type { IconSource } from "../../../shared/realicon.js";
import { fillAppCredentials } from "../../../shared/credentials.js";
import { monitorKeySvg, svgDataUri } from "../../../shared/icons.js";
import { backKeyAppeared, backKeyGone, companionFor, handOff, leaveApps, openApps, openWebsites } from "./nav.js";
import { refreshScreens, resolveScreen, screenNumber, screenSourceNumber, screensLoaded, watchScreens } from "./screens.js";

abstract class AppAction extends LaunchAction<AppSettings> {
	protected override async afterLaunch(action: Action<AppSettings>, s: AppSettings): Promise<void> {
		if (this.kind === "app" && s.credentialAutofill !== false && s.credentialUsername && s.credentialPassword) {
			const result = await fillAppCredentials(s);
			await this.feedback(action, result, false);
			if (streamDeck.ui.action?.id === action.id) {
				await streamDeck.ui.sendToPropertyInspector({ event: "autofillResult", ok: result.status === "ok", message: result.message });
			}
		}
		// The app has its own keys (e.g. VS Code) → show them. Otherwise the deck stays where it is.
		const target = companionFor(this.kind, s);
		if (!target || s.showKeys === false) return;
		await handOff(target, action.device.id);
	}

	protected preset(): AppPreset | undefined {
		return APP_PRESETS[this.kind];
	}
	override realSource(s: AppSettings): IconSource | undefined {
		if (s.appId) return { type: "shell", candidates: ["shell:AppsFolder\\" + s.appId] };
		const t = s.target?.trim().replace(/^"(.*)"$/, "$1");
		if (t) {
			if (looksLikeUrl(t)) return { type: "site", url: t };
			if (looksLikePath(t)) return { type: "shell", candidates: [t] };
			return { type: "resolve", names: [t], paths: [] };
		}
		const p = this.preset();
		return p ? { type: "resolve", names: p.names, paths: p.paths ?? [] } : undefined;
	}
	/** When the user picks a different app for a key, its name becomes the label. */
	protected override dynamicLabel(s: AppSettings): string | undefined {
		return s.appName || undefined;
	}
	protected launch(s: AppSettings): Promise<PsResult> {
		return launchApp(s, this.preset());
	}
}

/** "Open App": the user picks any installed app (and its icon) in the settings panel. */
@action({ UUID: "com.dailyops.v2.app" })
export class OpenAppAction extends AppAction {
	protected readonly kind = "app";
	protected override preset(): AppPreset | undefined {
		return undefined;
	}
	protected override dynamicLabel(s: AppSettings): string | undefined {
		if (s.appName) return s.appName;
		const t = s.target?.trim();
		if (!t) return undefined;
		const base = t.split(/[\\/]/).pop() ?? t;
		return base.replace(/\.(exe|lnk|bat|cmd)$/i, "");
	}
}

/* ------------------------------------------------------------------ folders */

abstract class FolderActionBase extends LaunchAction<FolderSettings> {
	protected abstract readonly defaultPath: string;
	override realSource(s: FolderSettings): IconSource | undefined {
		const p = s.folderPath?.trim() || this.defaultPath;
		if (!p) return undefined;
		return { type: "shell", candidates: [p === "::downloads" ? "shell:Downloads" : p] };
	}
	protected async launch(s: FolderSettings): Promise<PsResult> {
		const p = s.folderPath?.trim() || this.defaultPath;
		if (!p) return { status: "miss", message: "No folder set — open this key's settings and enter a folder path." };
		return ps.run("folder", [p]);
	}
}

/** Shared by the unified action and its backwards-compatible hidden alias. */
function folderName(s: FolderSettings): string | undefined {
	const p = s.folderPath?.trim().replace(/[\\/]+$/, "");
	return p ? p.split(/[\\/]/).pop()?.replace(/%/g, "") || p : undefined;
}

@action({ UUID: "com.dailyops.v2.downloads" })
export class DownloadsAction extends FolderActionBase {
	// Retain the original UUID so installed keys become Folders without replacement.
	protected readonly kind = "downloads";
	protected readonly defaultPath = "";
	protected override dynamicLabel(s: FolderSettings): string | undefined {
		return s.folderNameLabel === true ? folderName(s) || s.folderEmptyLabel : undefined;
	}
}

/** "Open Folder": any folder path, with its own icon. */
@action({ UUID: "com.dailyops.v2.folder" })
export class OpenFolderAction extends FolderActionBase {
	protected readonly kind = "folder";
	protected readonly defaultPath = "";
	protected override dynamicLabel(s: FolderSettings): string | undefined {
		return s.folderNameLabel !== false ? folderName(s) : undefined;
	}
}

/* ------------------------------------------------------------------ websites */

abstract class WebsiteBase extends LaunchAction<WebsiteSettings> {
	protected abstract readonly defaultUrl: string;
	override realSource(s: WebsiteSettings): IconSource | undefined {
		const u = s.url?.trim() || this.defaultUrl;
		return u ? { type: "site", url: u } : undefined;
	}
	protected async launch(s: WebsiteSettings, monitor: number | null): Promise<PsResult> {
		let url = s.url?.trim() || this.defaultUrl;
		if (!url) return { status: "miss", message: "No URL set." };
		if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = "https://" + url;
		if (s.browser !== "chrome") return ps.run("url", [url]);
		// In Chrome, ask for a new window when it should land on a specific monitor (otherwise it becomes a tab).
		const args = monitor !== null ? `--new-window "${url}"` : `"${url}"`;
		let r = await ps.run("cmd", ["chrome", args]);
		for (const p of APP_PRESETS.chrome.paths ?? []) {
			if (r.status === "ok") break;
			r = await ps.run("path", [p, args]);
		}
		return r.status === "ok" ? r : ps.run("url", [url]); // Chrome missing → default browser
	}
}

@action({ UUID: "com.dailyops.v2.website" })
export class WebsiteAction extends WebsiteBase {
	protected readonly kind = "website";
	protected readonly defaultUrl = "";
	protected override dynamicLabel(s: WebsiteSettings): string | undefined {
		const u = s.url?.trim();
		if (!u) return undefined;
		try {
			return new URL(/^[a-z]+:/i.test(u) ? u : "https://" + u).hostname.replace(/^www\./, "").split(".")[0];
		} catch {
			return undefined;
		}
	}
}

/* ------------------------------------------------------------------ volume */

abstract class VolumeBase extends DailyAction<VolumeSettings> {
	protected abstract readonly direction: "up" | "down";
	#timers = new Map<string, { delay?: NodeJS.Timeout; repeat?: NodeJS.Timeout; busy: boolean }>();

	#presses(s: VolumeSettings): number {
		const pct = Number(s.step ?? 6);
		return Math.max(1, Math.min(25, Math.round((Number.isFinite(pct) ? pct : 6) / 2))); // Windows: 2% per key press
	}

	async #step(id: string, s: VolumeSettings, action: Action<VolumeSettings>): Promise<void> {
		const t = this.#timers.get(id);
		if (t?.busy) return; // don't queue up presses faster than Windows applies them
		if (t) t.busy = true;
		const r = await ps.run("vol", [this.direction, String(this.#presses(s))]);
		if (t) t.busy = false;
		if (r.status !== "ok") {
			this.#stop(id);
			await this.feedback(action, r);
		}
	}

	#stop(id: string): void {
		const t = this.#timers.get(id);
		if (t) {
			clearTimeout(t.delay);
			clearInterval(t.repeat);
			this.#timers.delete(id);
		}
	}

	override async onKeyDown(ev: KeyDownEvent<VolumeSettings>): Promise<void> {
		const id = ev.action.id;
		const s = ev.payload.settings;
		this.#stop(id);
		const t: { delay?: NodeJS.Timeout; repeat?: NodeJS.Timeout; busy: boolean } = { busy: false };
		this.#timers.set(id, t);
		if (s.repeat !== false) {
			// Hold the key to keep changing the volume.
			t.delay = setTimeout(() => {
				t.repeat = setInterval(() => void this.#step(id, s, ev.action), 140);
			}, 420);
		}
		await this.#step(id, s, ev.action);
	}

	override onKeyUp(ev: KeyUpEvent<VolumeSettings>): void {
		this.#stop(ev.action.id);
	}

	override onWillDisappear(ev: WillDisappearEvent<VolumeSettings>): void {
		this.#stop(ev.action.id);
		super.onWillDisappear(ev);
	}
}

@action({ UUID: "com.dailyops.v2.volup" })
export class VolumeUpAction extends VolumeBase {
	protected readonly kind = "volup";
	protected readonly direction = "up";
}
@action({ UUID: "com.dailyops.v2.voldown" })
export class VolumeDownAction extends VolumeBase {
	protected readonly kind = "voldown";
	protected readonly direction = "down";
}

/* ------------------------------------------------------------------ screenshot */

/** Screenshot: tap = select an area, double-tap = the active window, hold = all screens. */
@action({ UUID: "com.dailyops.v2.screenshot" })
export class ScreenshotAction extends GestureAction<ScreenshotSettings> {
	protected readonly kind = "screenshot";
	protected override readonly defaultHold = 1;
	#lastArea?: Action<ScreenshotSettings>;

	constructor() {
		super();
		// Area snips finish later (when the user has drawn the box); the host reports the saved file.
		ps.onEvent((e) => {
			if (e.type === "shot" && e.data && this.#lastArea?.isKey()) void this.#lastArea.showOk();
			if (e.type === "shoterr") log.warn(`snip copy failed: ${e.data}`);
		});
	}

	protected async onPress(action: Action<ScreenshotSettings>, s: ScreenshotSettings, press: Press): Promise<void> {
		const mode = press === 1 ? "window" : press === 2 ? "all" : "area";
		const args = [mode, s.shotFolder?.trim() ?? "", s.shotSave === false ? "0" : "1", s.shotClipboard === false ? "0" : "1"];
		const r = await ps.run("shot", args, 25_000);
		if (mode === "area") {
			this.#lastArea = action;
			if (r.status !== "ok") await this.feedback(action, r);
			return;
		}
		if (r.status === "ok" && r.message) log.info(`screenshot saved: ${r.message}`);
		await this.feedback(action, r);
	}
}

/* ------------------------------------------------------------------ show desktop */

@action({ UUID: "com.dailyops.v2.showdesktop" })
export class ShowDesktopAction extends DailyAction<Appearance> {
	protected readonly kind = "showdesktop";
	override async onKeyDown(ev: KeyDownEvent<Appearance>): Promise<void> {
		await this.feedback(ev.action, await ps.run("desktop"), false);
	}
}

/* ------------------------------------------------------------------ monitor control */

/**
 * One configurable action: each key controls the physical screen selected in its settings.
 * It shows what a press will do — red "TURN OFF" while the screen is on, green "TURN ON" while it is off.
 * Off = put the monitor to sleep (DDC/CI) and disconnect it in Windows; on = reconnect and wake it.
 */
@action({ UUID: "com.dailyops.v2.monitorcontrol" })
export class MonitorControlAction extends DailyAction<MonitorSettings> {
	protected readonly kind = "monitorcontrol";
	#settings = new Map<string, MonitorSettings>();
	#unwatch?: () => void;
	#busy = new Set<string>();

	#state(s: MonitorSettings): { state: "on" | "off" | "unknown" | "missing" | "unconfigured"; num: number | string } {
		if (!s.screenKey) return { state: "unconfigured", num: "?" };
		const scr = resolveScreen(s.screenKey);
		const num = (scr && screenNumber(scr)) || s.screenNumber || "?";
		if (!screensLoaded()) return { state: "unknown", num };
		if (!scr) return { state: "missing", num };
		return { state: scr.on ? "on" : "off", num };
	}

	#svg(s: MonitorSettings): string {
		const st = this.#state(s);
		const caption = s.hideLabel ? " " : s.iconLabel?.trim() || (st.state === "unconfigured" ? "Monitor Control" : `Monitor ${st.num}`);
		return svgDataUri(monitorKeySvg({ n: st.num, state: st.state, caption, motion: this.motion(s) }));
	}

	override imageNow(s: MonitorSettings): { image: string } {
		return { image: this.#svg(s) };
	}
	override async imageFinal(s: MonitorSettings): Promise<{ image: string; real: boolean }> {
		if (!screensLoaded()) await refreshScreens();
		return { image: this.#svg(s), real: false };
	}

	#repaintAll(): void {
		for (const a of this.actions) {
			const s = this.#settings.get(a.id);
			if (s) void this.paint(a, s);
		}
	}

	override async onWillAppear(ev: WillAppearEvent<MonitorSettings>): Promise<void> {
		this.#settings.set(ev.action.id, ev.payload.settings);
		this.#unwatch ??= watchScreens(() => this.#repaintAll());
		await super.onWillAppear(ev);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<MonitorSettings>): Promise<void> {
		this.#settings.set(ev.action.id, ev.payload.settings);
		await super.onDidReceiveSettings(ev);
	}

	override onWillDisappear(ev: WillDisappearEvent<MonitorSettings>): void {
		this.#settings.delete(ev.action.id);
		super.onWillDisappear(ev);
		if (this.#settings.size === 0 && this.#unwatch) {
			this.#unwatch();
			this.#unwatch = undefined;
		}
	}

	override async onKeyDown(ev: KeyDownEvent<MonitorSettings>): Promise<void> {
		const s = ev.payload.settings;
		this.#settings.set(ev.action.id, s);
		const key = s.screenKey;
		if (!key) {
			await this.feedback(ev.action, { status: "miss", message: "Choose a monitor in this key's settings first." });
			return;
		}
		if (this.#busy.has(key)) return; // Also guards duplicate keys controlling the same screen.
		this.#busy.add(key);
		try {
			// Read Windows state before every press, including changes made outside the plugin.
			if (!(await refreshScreens())) {
				await this.feedback(ev.action, { status: "err", message: "Could not read monitor state. Try again." });
				return;
			}
			const scr = resolveScreen(key);
			if (!scr) {
				await this.feedback(ev.action, { status: "miss", message: "The selected monitor isn't connected. Check its cable or choose a monitor in settings." });
				return;
			}
			const wasOn = scr.on;
			const r = await ps.run(scr.on ? "moff" : "mon", [scr.key, s.sleep === false ? "0" : "1", String(screenSourceNumber(scr))], 45_000);
			// Publish the confirmed state immediately; retry once if Windows is still settling.
			await refreshScreens();
			if (r.status === "ok" && resolveScreen(key)?.on === wasOn) {
				await new Promise((res) => setTimeout(res, 500));
				await refreshScreens();
			}
			if (r.status !== "ok") await this.feedback(ev.action, r);
			else log.info(`monitor ${screenNumber(scr) || s.screenNumber || "?"} (${scr.name}): ${r.message}`);
		} finally {
			this.#busy.delete(key);
		}
	}
}

/* ------------------------------------------------------------------ apps folder */

/** Apps: switches the deck to the Apps page (a bundled, editable layout with a Back key). */
@action({ UUID: "com.dailyops.v2.appsfolder" })
export class AppsFolderAction extends DailyAction<Appearance> {
	protected readonly kind = "appsfolder";
	override async onKeyDown(ev: KeyDownEvent<Appearance>): Promise<void> {
		try {
			await openApps(ev.action.device.id);
		} catch (e) {
			await this.feedback(ev.action, { status: "err", message: `Apps page: ${(e as Error).message}` });
		}
	}
}

/** Website Folder: plugin-owned editable collection, using the approved folder/globe artwork. */
@action({ UUID: "com.dailyops.v2.websitefolder" })
export class WebsiteFolderAction extends DailyAction<Appearance> {
	protected readonly kind = "websitefolder";
	override async onKeyDown(ev: KeyDownEvent<Appearance>): Promise<void> {
		try { await openWebsites(ev.action.device.id); }
		catch (e) { await this.feedback(ev.action, { status: "err", message: `Websites page: ${(e as Error).message}` }); }
	}
}

/** Back: returns to the main keys (top-left of the Apps page). */
@action({ UUID: "com.dailyops.v2.back" })
export class BackAction extends DailyAction<Appearance> {
	protected readonly kind = "back";
	override onWillAppear(ev: WillAppearEvent<Appearance>): Promise<void> {
		backKeyAppeared(ev.action.device.id);
		return super.onWillAppear(ev);
	}
	override onWillDisappear(ev: WillDisappearEvent<Appearance>): void {
		backKeyGone(ev.action.device.id);
		super.onWillDisappear(ev);
	}
	override async onKeyDown(ev: KeyDownEvent<Appearance>): Promise<void> {
		await leaveApps(ev.action.device.id);
	}
}

/* ------------------------------------------------------------------ keyboard */

abstract class KeyComboBase extends DailyAction<Appearance> {
	protected abstract readonly combo: string;
	override async onKeyDown(ev: KeyDownEvent<Appearance>): Promise<void> {
		await this.feedback(ev.action, await ps.run("keys", [this.combo]), false);
	}
}

@action({ UUID: "com.dailyops.v2.copy" })
export class CopyAction extends KeyComboBase {
	protected readonly kind = "copy";
	protected readonly combo = "^c";
}
@action({ UUID: "com.dailyops.v2.paste" })
export class PasteAction extends KeyComboBase {
	protected readonly kind = "paste";
	protected readonly combo = "^v";
}

export const ALL_ACTIONS = [
	DownloadsAction,
	OpenFolderAction, OpenAppAction, WebsiteAction, WebsiteFolderAction, AppsFolderAction, BackAction, ScreenshotAction, VolumeUpAction, VolumeDownAction,
	MonitorControlAction, ShowDesktopAction, CopyAction, PasteAction,
];
