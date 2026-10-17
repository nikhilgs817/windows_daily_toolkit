import streamDeck, {
	action,
	type Action,
	type DidReceiveSettingsEvent,
	type KeyDownEvent,
	type KeyUpEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import { PRESET_ICONS, REAL_ICON_KINDS, keySvg, pictureKeySvg, svgDataUri } from "./icons.js";
import { watchMotion } from "./motion.js";
import { ps, type PsResult } from "./ps.js";
import { fetchIcon, forgetIcon, peekIcon, type IconSource } from "./realicon.js";

export const log = streamDeck.logger.createScope("actions");

/* ------------------------------------------------------------------ settings */

/** Appearance settings shared by every key (edited in the "Look" section of the settings panel). */
export type Appearance = {
	/** "real" = the app's/site's own icon · "neon" = colourful artwork on dark glass · "vivid" = white artwork on colour. */
	iconStyle?: string;
	iconGlyph?: string;
	iconTheme?: string;
	iconLabel?: string;
	hideLabel?: boolean;
	/** Custom picture uploaded by the user (data: URI, already resized to 144×144 by the settings panel). */
	iconImage?: string;
	/** Gentle live artwork on every key and look (default on). */
	animate?: boolean;
};
/** Monitor gestures: tap → monitor 1, double-tap → monitor 2, hold → monitor 3. */
export type GestureSettings = { gestures?: boolean; holdSeconds?: number | string };
export type AppSettings = Appearance & GestureSettings & {
	/** After opening, switch the deck to the app's own plugin keys (when one exists). Default on. */
	showKeys?: boolean;
	credentialUsername?: string;
	/** Windows DPAPI ciphertext only. Plain passwords must never be assigned to settings. */
	credentialPassword?: string;
	credentialAutofill?: boolean;
	credentialApp?: string;
	 appId?: string; appName?: string; target?: string; args?: string };
export type FolderSettings = Appearance & GestureSettings & { folderPath?: string; folderNameLabel?: boolean; folderEmptyLabel?: string };
export type WebsiteSettings = Appearance & GestureSettings & { url?: string; browser?: string };
export type VolumeSettings = Appearance & { step?: number | string; repeat?: boolean };
export type DisplaySettings = Appearance & { mode?: string };
/** Screenshot key: tap = area, double-tap = active window, hold = all screens. */
export type ScreenshotSettings = Appearance & GestureSettings & { shotFolder?: string; shotSave?: boolean; shotClipboard?: boolean };
/** Monitor Control: explicit screen identity, last known display number, and DDC/CI sleep. */
export type MonitorSettings = Appearance & { screenKey?: string; screenName?: string; screenNumber?: number; sleep?: boolean };
/** Apps folder key: return to the main keys after opening an app that has no keys of its own. */
export type FolderNavSettings = Appearance;
export type AnySettings = AppSettings & FolderSettings & WebsiteSettings & VolumeSettings & DisplaySettings & ScreenshotSettings & MonitorSettings;

/* ------------------------------------------------------------------ base */

/** manifest UUID → action instance (used for settings-panel requests). */
export const REGISTRY = new Map<string, DailyAction<AnySettings>>();

type Look = { glyph: string; theme: string; label: string; style: "real" | "neon" | "vivid" | "pro" };

export abstract class DailyAction<T extends AnySettings> extends SingletonAction<T> {
	/** Key into PRESET_ICONS — also the UUID suffix. */
	protected abstract readonly kind: string;
	#lastImage = new Map<string, string>();
	#token = new Map<string, string>();

	constructor() {
		super();
		queueMicrotask(() => {
			if (this.manifestId) REGISTRY.set(this.manifestId, this as unknown as DailyAction<AnySettings>);
		});
	}

	/** Label derived from settings (e.g. the chosen app's name). */
	protected dynamicLabel(_s: T): string | undefined {
		return undefined;
	}

	/** Where this key's real icon comes from (undefined = it has none). */
	realSource(_s: T): IconSource | undefined {
		return undefined;
	}

	override onWillAppear(ev: WillAppearEvent<T>): Promise<void> {
		this.#lastImage.delete(ev.action.id);
		this.#updateMotion(ev.action, ev.payload.settings);
		return this.paint(ev.action, ev.payload.settings);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<T>): Promise<void> {
		this.#updateMotion(ev.action, ev.payload.settings);
		return this.paint(ev.action, ev.payload.settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<T>): void {
		this.#lastImage.delete(ev.action.id);
		this.#token.delete(ev.action.id);
		watchMotion(ev.action.id);
	}

	protected motion(s: T): { kind: string; phase: number } | undefined {
		return s.animate === false ? undefined : { kind: this.kind, phase: (Date.now() % 6000) / 6000 };
	}

	#updateMotion(action: Action<T>, settings: T): void {
		watchMotion(action.id, this.motion(settings) ? () => this.paint(action, settings) : undefined);
	}

	look(s: T): Look {
		const preset = PRESET_ICONS[this.kind] ?? PRESET_ICONS.app;
		const style = (["real", "neon", "vivid", "pro"].includes(s.iconStyle ?? "") ? s.iconStyle : preset.style || (REAL_ICON_KINDS.includes(this.kind) ? "real" : this.kind.startsWith("vsc-") ? "pro" : "neon")) as Look["style"];
		const label = s.hideLabel ? "" : s.iconLabel?.trim() || this.dynamicLabel(s) || preset.label;
		return { glyph: s.iconGlyph || preset.glyph, theme: s.iconTheme || preset.theme, label, style };
	}

	/** Key image right now (real icon from cache, or the colourful fallback while it loads). */
	imageNow(s: T): { image: string; pending?: IconSource } {
		const motion = this.motion(s);
		if (typeof s.iconImage === "string" && s.iconImage.startsWith("data:image/")) return { image: motion ? svgDataUri(pictureKeySvg(s.iconImage, motion)) : s.iconImage };
		const look = this.look(s);
		if (look.style === "real") {
			const src = this.realSource(s);
			if (src) {
				const have = peekIcon(src);
				if (typeof have === "string") return { image: svgDataUri(keySvg({ ...look, image: have, motion })) };
				return { image: svgDataUri(keySvg({ ...look, style: "neon", motion })), pending: have === undefined ? src : undefined };
			}
			look.style = "neon";
		}
		return { image: svgDataUri(keySvg({ ...look, motion })) };
	}

	/** Final key image, waiting for the real icon if needed (used by the settings-panel preview). */
	async imageFinal(s: T): Promise<{ image: string; real: boolean; sourceImage?: string }> {
		const motion = this.motion(s);
		if (typeof s.iconImage === "string" && s.iconImage.startsWith("data:image/")) return { image: motion ? svgDataUri(pictureKeySvg(s.iconImage, motion)) : s.iconImage, real: false };
		const look = this.look(s);
		if (look.style === "real") {
			const src = this.realSource(s);
			const uri = src ? await fetchIcon(src) : null;
			if (uri) return { image: svgDataUri(keySvg({ ...look, image: uri, motion })), real: true, sourceImage: uri };
			return { image: svgDataUri(keySvg({ ...look, style: "neon", motion })), real: false };
		}
		return { image: svgDataUri(keySvg({ ...look, motion })), real: false };
	}

	/** Drop the cached real icon for these settings and redraw every key of this type. */
	async refreshIcon(s: T): Promise<void> {
		const src = this.realSource(s);
		if (src) forgetIcon(src);
		for (const a of this.actions) {
			this.#lastImage.delete(a.id);
			await this.paint(a, await a.getSettings());
		}
	}

	protected async paint(action: Action<T>, s: T): Promise<void> {
		if (!action.isKey()) return;
		const token = JSON.stringify(s);
		this.#token.set(action.id, token);
		const now = this.imageNow(s);
		await this.#set(action, now.image);
		if (now.pending) {
			const uri = await fetchIcon(now.pending);
			if (uri && this.#token.get(action.id) === token) await this.#set(action, this.imageNow(s).image);
		}
	}

	async #set(action: Action<T>, image: string): Promise<void> {
		if (!action.isKey() || this.#lastImage.get(action.id) === image) return;
		this.#lastImage.set(action.id, image);
		await action.setImage(image);
	}

	/** Flash ✓ on success, ⚠ on failure (and log why). */
	protected async feedback(action: Action<T>, r: PsResult, flashOk = true): Promise<void> {
		if (!action.isKey()) return;
		if (r.status === "ok") {
			if (flashOk) await action.showOk();
		} else {
			log.warn(`${this.kind}: ${r.status} — ${r.message}`);
			await action.showAlert();
		}
	}
}

/* ------------------------------------------------------------------ monitor gestures */

/** Plugin-wide settings (shared by every key). */
export const globals: { monitorOrder?: string; [key: string]: unknown } = {};

export const DOUBLE_TAP_MS = 300;

type Gesture = { holdTimer?: NodeJS.Timeout; tapTimer?: NodeJS.Timeout; fired: boolean };

/** Which press: 0 = tap, 1 = double-tap, 2 = hold, null = gestures off (plain press). */
export type Press = 0 | 1 | 2 | null;

/**
 * Keys with three gestures: a tap, a quick double-tap, or holding the key (3 s by default).
 * The hold fires as soon as the time is reached, while the key is still down.
 */
export abstract class GestureAction<T extends AnySettings> extends DailyAction<T> {
	#g = new Map<string, Gesture>();
	/** Default hold time in seconds when the key has no setting. */
	protected readonly defaultHold: number = 3;

	protected abstract onPress(action: Action<T>, s: T, press: Press): Promise<void>;

	#holdMs(s: T): number {
		const v = Number(s.holdSeconds ?? this.defaultHold);
		return Math.round(Math.max(0.5, Math.min(10, Number.isFinite(v) ? v : this.defaultHold)) * 1000);
	}

	override async onKeyDown(ev: KeyDownEvent<T>): Promise<void> {
		const s = ev.payload.settings;
		const id = ev.action.id;
		if (s.gestures === false) {
			await this.onPress(ev.action, s, null);
			return;
		}
		const prev = this.#g.get(id);
		if (prev?.tapTimer) {
			// Second tap inside the double-tap window.
			clearTimeout(prev.tapTimer);
			this.#g.set(id, { fired: true });
			await this.onPress(ev.action, s, 1);
			return;
		}
		const g: Gesture = { fired: false };
		g.holdTimer = setTimeout(() => {
			g.fired = true; // held long enough (fires while still held)
			void this.onPress(ev.action, s, 2);
		}, this.#holdMs(s));
		this.#g.set(id, g);
	}

	override onKeyUp(ev: KeyUpEvent<T>): void {
		const id = ev.action.id;
		const g = this.#g.get(id);
		if (!g) return;
		clearTimeout(g.holdTimer);
		if (g.fired) {
			this.#g.delete(id);
			return;
		}
		// Wait briefly to see whether a second tap follows; if not, it was a single tap.
		g.tapTimer = setTimeout(() => {
			this.#g.delete(id);
			void this.onPress(ev.action, ev.payload.settings, 0);
		}, DOUBLE_TAP_MS);
	}

	override onWillDisappear(ev: WillDisappearEvent<T>): void {
		const g = this.#g.get(ev.action.id);
		if (g) {
			clearTimeout(g.holdTimer);
			clearTimeout(g.tapTimer);
			this.#g.delete(ev.action.id);
		}
		super.onWillDisappear(ev);
	}
}

/**
 * Keys that open something. One tap opens it on monitor 1, a quick double-tap on monitor 2,
 * holding the key (3 s by default) on monitor 3. With gestures off, a press just opens it.
 */
export abstract class LaunchAction<T extends AnySettings> extends GestureAction<T> {
	/** Opens the thing. `monitor` is 0-based, or null for "wherever Windows puts it". */
	protected abstract launch(s: T, monitor: number | null): Promise<PsResult>;

	protected onPress(action: Action<T>, s: T, press: Press): Promise<void> {
		return this.open(action, s, press);
	}

	protected async open(action: Action<T>, s: T, monitor: number | null): Promise<void> {
		const order = globals.monitorOrder === "left" || globals.monitorOrder === "primary" ? globals.monitorOrder : "windows";
		let placing = monitor !== null;
		if (placing) {
			const snap = await ps.run("snap");
			if (snap.status !== "ok") {
				log.warn(`window placement unavailable: ${snap.message}`);
				placing = false;
			}
		}
		const r = await this.launch(s, monitor);
		if (r.status === "ok" && placing) {
			const p = await ps.run("place", [String(monitor), order, "8000"]);
			if (p.status !== "ok") log.warn(`placement failed: ${p.message}`);
		}
		await this.feedback(action, r);
		if (r.status === "ok") await this.afterLaunch(action, s);
	}

	/** Runs after a successful launch (e.g. hand over to the app's own Stream Deck keys). */
	protected async afterLaunch(_action: Action<T>, _s: T): Promise<void> {}
}

/* ------------------------------------------------------------------ apps */

export type AppPreset = { names: string[]; paths?: string[] };

/** How each preset finds its app: Start-menu names first (works for Store apps), then common install paths. */
export const APP_PRESETS: Record<string, AppPreset> = {
	chrome: {
		names: ["Google Chrome", "Chrome"],
		paths: [
			"%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe",
			"%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe",
			"%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe",
		],
	},
};

export const looksLikeUrl = (t: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^(mailto|ms-[a-z-]+):/i.test(t);
export const looksLikePath = (t: string) => /[\\/]/.test(t) || t.startsWith("%") || /\.(exe|lnk|bat|cmd|url|appref-ms|msc)$/i.test(t);

/** Resolves and launches an app from settings, falling back to the preset. */
export async function launchApp(s: AppSettings, preset?: AppPreset): Promise<PsResult> {
	if (s.appId) return ps.run("appid", [s.appId]);

	const t = s.target?.trim().replace(/^"(.*)"$/, "$1");
	if (t) {
		if (looksLikeUrl(t)) return ps.run("url", [t]);
		if (looksLikePath(t)) return ps.run("path", [t, s.args ?? ""]);
		const r = await ps.run("start", [t]);
		return r.status === "miss" ? ps.run("cmd", [t, s.args ?? ""]) : r;
	}

	if (!preset) return { status: "miss", message: "No app chosen yet — open this key's settings and pick an app." };
	let r = await ps.run("start", [preset.names.join("|")]);
	for (const p of preset.paths ?? []) {
		if (r.status !== "miss") break;
		r = await ps.run("path", [p]);
	}
	return r;
}
