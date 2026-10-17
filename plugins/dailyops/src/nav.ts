import streamDeck from "@elgato/streamdeck";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { log } from "../../../shared/base.js";
import { ps } from "../../../shared/ps.js";
import { COMPANIONS } from "../../../shared/companion-specs.js";
export { COMPANIONS };

/** Name of the bundled Apps page — must match the manifest's Profiles[].Name exactly. */
export const APPS_PROFILE = "profiles/Apps";
export const WEBSITES_PROFILE = "profiles/Websites";

/** Companion plugins: apps that have their own keys. `match` is tested against the app chosen on a key. */
type Manager = { available: (uuid: string) => boolean; show: (uuid: string, device: string) => Promise<void>; restore: (device: string) => Promise<void> };
let manager: Manager | undefined;
export function setCompanionManager(value: Manager): void { manager = value; }

/** Which companion plugin (if any) owns the keys for the app this key opens. */
export function companionFor(kind: string, s: { appName?: string; appId?: string; target?: string }): string | undefined {
	const chosen = [s.appName, s.appId, s.target].filter(Boolean).join(" ");
	for (const c of COMPANIONS) {
		if (chosen ? c.match.test(chosen) : c.kinds.includes(kind)) return c.uuid;
	}
	return undefined;
}

/** Is that companion plugin installed next to this one? (Deep links to a missing plugin would do nothing.) */
export function companionInstalled(uuid: string): boolean {
	if (process.env.DAILYOPS_DRYRUN === "1") return true;
	const pluginsDir = join(dirname(process.argv[1] ?? ""), "..", "..");
	return existsSync(join(pluginsDir, `${uuid}.sdPlugin`));
}

/** Stream Deck deep link to a companion plugin (passive: no window pops up). */
export function companionUrl(uuid: string, path: string, deviceId: string): string {
	return `streamdeck://plugins/message/${uuid}/${path}?device=${encodeURIComponent(deviceId)}&streamdeck=hidden`;
}

async function tellCompanions(path: string, deviceId: string): Promise<void> {
	for (const c of COMPANIONS) {
		if (!companionInstalled(c.uuid)) continue;
		const r = await ps.run("url", [companionUrl(c.uuid, path, deviceId)]);
		if (r.status !== "ok") log.warn(`${path} → ${c.uuid} failed: ${r.message}`);
	}
}

/** Devices currently showing the Apps page. */
const inAppsPage = new Set<string>();
/** Back keys visible per device (the Apps page always has one). */
const backKeys = new Map<string, number>();

export const inApps = (deviceId: string) => inAppsPage.has(deviceId);

/** Apps key: show the Apps page. While it is up, companion plugins don't take over the deck by focus. */
export async function openApps(deviceId: string): Promise<void> {
	await openCollection(deviceId, APPS_PROFILE);
}

export async function openWebsites(deviceId: string): Promise<void> {
	await openCollection(deviceId, WEBSITES_PROFILE);
}

async function openCollection(deviceId: string, profile: string): Promise<void> {
	await manager?.restore(deviceId);
	// Flatten collection-to-collection navigation, so Back always reaches the original main keys.
	if (inAppsPage.has(deviceId)) await leaveApps(deviceId, false);
	await streamDeck.profiles.switchToProfile(deviceId, profile);
	inAppsPage.add(deviceId);
	log.info(`${profile} on ${deviceId}`);
	await tellCompanions("hold", deviceId);
}

/** Back key: return to the keys that were showing before (the main keys). */
export async function leaveApps(deviceId: string, release = true): Promise<void> {
	await streamDeck.profiles.switchToProfile(deviceId);
	const was = inAppsPage.delete(deviceId);
	log.info(`back to main keys on ${deviceId}`);
	if (release && was) await tellCompanions("release", deviceId);
}

/**
 * Hand the deck to a companion plugin's keys. From the Apps page we first step back to the main keys,
 * so the companion's own Back (or leaving the app) always returns to the main keys — never a loop.
 */
export async function handOff(uuid: string, deviceId: string): Promise<void> {
	if (!companionInstalled(uuid)) return;
	if (inApps(deviceId)) await leaveApps(deviceId, false);
	if (manager?.available(uuid)) { await manager.show(uuid, deviceId); return; }
	const r = await ps.run("url", [companionUrl(uuid, "show", deviceId)]);
	if (r.status !== "ok") log.warn(`hand-off to ${uuid} failed: ${r.message}`);
}

/** Back keys report in/out so we notice when the user leaves the Apps page some other way. */
export function backKeyAppeared(deviceId: string): void {
	backKeys.set(deviceId, (backKeys.get(deviceId) ?? 0) + 1);
}
export function backKeyGone(deviceId: string): void {
	const n = Math.max(0, (backKeys.get(deviceId) ?? 1) - 1);
	backKeys.set(deviceId, n);
	if (n === 0) {
		setTimeout(() => {
			if ((backKeys.get(deviceId) ?? 0) === 0 && inAppsPage.delete(deviceId)) void tellCompanions("release", deviceId);
		}, 400);
	}
}
