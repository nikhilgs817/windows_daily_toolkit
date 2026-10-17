import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { log } from "../../../shared/base.js";
import { ps } from "../../../shared/ps.js";

/** Physical display number for labels; gdiNum is a distinct source identifier used only for restoring paths. */
export type Screen = { key: string; name: string; on: boolean; num: number; gdiNum?: number; primary: boolean };

const FILE = join(dirname(process.argv[1] ?? "."), "..", "screens.json");
const POLL_MS = 3000;

let list: Screen[] = [];
let loaded = false;
/** Last Windows number seen for each screen — so "Monitor 2" still finds its screen while it is off. */
let remembered: Record<string, { num: number; name: string; gdiNum?: number }> = {};
try {
	if (existsSync(FILE)) remembered = JSON.parse(readFileSync(FILE, "utf8"));
} catch {
	remembered = {};
}

const listeners = new Set<() => void>();
let timer: NodeJS.Timeout | undefined;
let inflight: Promise<boolean> | undefined;

export const screensLoaded = () => loaded;
export const screens = () => list;

/** Re-reads the screens from Windows and tells every monitor key. */
export function refreshScreens(): Promise<boolean> {
	inflight ??= (async () => {
		try {
			const r = await ps.run("mlist", [], 15_000);
			if (r.status !== "ok") {
				log.warn(`screen list failed: ${r.message}`);
				return false;
			}
			const parsed = JSON.parse(r.message) as Screen[];
			list = Array.isArray(parsed) ? parsed : [];
			loaded = true;
			let changed = false;
			for (const s of list) {
				const source = s.gdiNum || remembered[s.key]?.gdiNum;
				if (s.num > 0 && (remembered[s.key]?.num !== s.num || remembered[s.key]?.name !== s.name || remembered[s.key]?.gdiNum !== source)) {
					// Numbers can be reassigned when the topology changes. Never erase another physical screen's history.
					remembered[s.key] = { num: s.num, name: s.name, ...(source ? { gdiNum: source } : {}) };
					changed = true;
				}
			}
			if (changed) {
				try {
					writeFileSync(FILE, JSON.stringify(remembered, null, 1));
				} catch (e) {
					log.warn(`could not save screens.json: ${(e as Error).message}`);
				}
			}
			return true;
		} catch (e) {
			log.warn(`screen list: ${(e as Error).message}`);
			return false;
		} finally {
			inflight = undefined;
			for (const l of listeners) l();
		}
	})();
	return inflight;
}

/** Only control the explicitly selected physical screen; never fall back to another display. */
export const resolveScreen = (screenKey?: string): Screen | undefined => screenKey ? list.find((s) => s.key === screenKey) : undefined;

/** Windows number to show for a screen (its current one, or the one it had before it was turned off). */
export const screenNumber = (s: Screen) => s.num || remembered[s.key]?.num || 0;

/** Keep the native restore hint independent of the number printed in Windows Settings. */
export const screenSourceNumber = (s: Screen) => s.gdiNum || remembered[s.key]?.gdiNum || 0;

/** Monitor keys subscribe while visible; the list is polled only while at least one is on screen. */
export function watchScreens(listener: () => void): () => void {
	listeners.add(listener);
	if (!timer) {
		void refreshScreens();
		timer = setInterval(() => void refreshScreens(), POLL_MS);
	}
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0 && timer) {
			clearInterval(timer);
			timer = undefined;
		}
	};
}
