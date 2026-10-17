import streamDeck, { action, type KeyDownEvent } from "@elgato/streamdeck";
import { DailyAction, REGISTRY, globals, type Appearance } from "./base.js";
import { PRESET_ICONS } from "./icons.js";
import { connectCompanion, type CompanionConnection } from "./companion-routing.js";
import { controlApp } from "./app-control.js";
import { shortcutToSendKeys } from "./shortcuts.js";
import type { AppSelector } from "./companion-specs.js";
export type CompanionCommand = { id: string; name: string; glyph: string; theme: string; description: string; shortcut?: string; menu?: string[][]; operation?: "back" | "focus" };
export type CompanionConfig = { uuid: string; name: string; profile: string; selector: AppSelector; commands: CompanionCommand[] };
type KeySettings = Appearance & { shortcut?: string };

export async function bootCompanion(config: CompanionConfig): Promise<void> {
	streamDeck.logger.setLevel("info");
	const log = streamDeck.logger.createScope("companion");
	let bridge: CompanionConnection | undefined;
	const visible = new Map<string, number>();
	const localShow = async (device: string) => { await streamDeck.profiles.switchToProfile(device, config.profile); };
	const localBack = async (device: string) => { await streamDeck.profiles.switchToProfile(device); };
	const show = async (device: string) => { if (bridge?.connected) await bridge.request("show", device); else await localShow(device); };
	const back = async (device: string) => { if (bridge?.connected) await bridge.request("back", device); else await localBack(device); };
	for (const definition of config.commands) {
		PRESET_ICONS["comp-" + definition.id] = { glyph: definition.glyph, theme: definition.theme, label: definition.name, style: "vivid" };
		@action({ UUID: config.uuid + "." + definition.id })
		class AppKey extends DailyAction<KeySettings> {
			protected readonly kind = "comp-" + definition.id;
			override async onKeyDown(ev: KeyDownEvent<KeySettings>): Promise<void> {
				try {
					if (definition.operation === "back") { await back(ev.action.device.id); return; }
					const shortcut = ev.payload.settings.shortcut?.trim() || definition.shortcut;
					const keys = shortcut ? shortcutToSendKeys(shortcut) : undefined;
					if (shortcut && !keys) { await this.feedback(ev.action, { status: "miss", message: "Use a shortcut such as Ctrl+Shift+N" }); return; }
					if (!keys && !definition.menu && definition.operation !== "focus") { await this.feedback(ev.action, { status: "miss", message: "Set this key's shortcut in settings" }); return; }
					const result = await controlApp({ selector: config.selector, ...(keys ? { keys, chords: shortcut!.split(/\s+/).map((chord) => shortcutToSendKeys(chord)!) } : definition.menu ? { menu: definition.menu } : {}) });
					await this.feedback(ev.action, result, false);
				} catch { await this.feedback(ev.action, { status: "err", message: "App controls are unavailable" }); }
			}
		}
		streamDeck.actions.registerAction(new AppKey());
	}
	streamDeck.actions.onWillAppear((ev) => { const d = ev.action.device.id; visible.set(d, (visible.get(d) || 0) + 1); bridge?.setVisible(d, true); });
	streamDeck.actions.onWillDisappear((ev) => {
		const d = ev.action.device.id; visible.set(d, Math.max(0, (visible.get(d) || 1) - 1));
		setTimeout(() => { if (!visible.get(d)) bridge?.setVisible(d, false); }, 300);
	});
	streamDeck.settings.onDidReceiveGlobalSettings((ev) => { Object.assign(globals, ev.settings); bridge?.update(); });
	streamDeck.ui.onSendToPlugin<{ event?: string; settings?: KeySettings }>(async (ev) => {
		if (streamDeck.ui.action?.id !== ev.action.id) return;
		if (ev.payload?.event === "companionShow") { await show(ev.action.device.id); return; }
		if (ev.payload?.event === "companionBack") { await back(ev.action.device.id); return; }
		if (ev.payload?.event === "getIcon" || ev.payload?.event === "refreshIcon") {
			const instance = REGISTRY.get(ev.action.manifestId); if (!instance) return;
			const settings = ev.payload.settings || await ev.action.getSettings();
			const rendered = await instance.imageFinal(settings);
			await streamDeck.ui.sendToPropertyInspector({ event: "icon", ...rendered, token: JSON.stringify(settings) });
		}
	});
	await streamDeck.connect();
	try { Object.assign(globals, await streamDeck.settings.getGlobalSettings()); } catch { log.warn("Using default focus settings"); }
	bridge = connectCompanion({ uuid: config.uuid, enabled: () => globals.autoFollow !== false, invoke: (command, device) => command === "show" ? localShow(device) : localBack(device) });
	for (const [device, count] of visible) bridge.setVisible(device, count > 0);
}
