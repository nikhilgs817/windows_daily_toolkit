import streamDeck from "@elgato/streamdeck";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ps } from "./ps.js";

const log = streamDeck.logger.createScope("icons");

/** Where to get a real icon from. */
export type IconSource =
	| { type: "shell"; candidates: string[] } // shell parsing names / file paths, tried in order
	| { type: "resolve"; names: string[]; paths: string[] } // Start-menu names, then install paths
	| { type: "site"; url: string };

const cacheDir = (() => {
	try {
		return fileURLToPath(new URL("../cache/icons/", import.meta.url));
	} catch {
		return join(process.cwd(), "cache", "icons");
	}
})();

/** In-memory cache: key → data URI, or null when no icon could be found (so we don't retry every paint). */
const memory = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

export function sourceKey(src: IconSource): string {
	return createHash("sha1").update(JSON.stringify(src)).digest("hex").slice(0, 16);
}

function diskPath(key: string): string {
	return join(cacheDir, key + ".png");
}

/** Synchronous lookup: data URI, null (known to be unavailable) or undefined (not fetched yet). */
export function peekIcon(src: IconSource): string | null | undefined {
	const key = sourceKey(src);
	if (memory.has(key)) return memory.get(key);
	try {
		const buf = readFileSync(diskPath(key));
		// Ignore anything that isn't a real icon (e.g. a tiny placeholder): PNG width/height live at bytes 16–23.
		if (buf.length < 100 || buf.readUInt32BE(16) < 16 || buf.readUInt32BE(20) < 16) return undefined;
		const uri = "data:image/png;base64," + buf.toString("base64");
		memory.set(key, uri);
		return uri;
	} catch {
		return undefined;
	}
}

export function forgetIcon(src: IconSource): void {
	const key = sourceKey(src);
	memory.delete(key);
	try {
		unlinkSync(diskPath(key));
	} catch {
		/* not cached */
	}
}

export function fetchIcon(src: IconSource): Promise<string | null> {
	const key = sourceKey(src);
	const known = peekIcon(src);
	if (known !== undefined) return Promise.resolve(known);
	let p = inflight.get(key);
	if (!p) {
		p = load(src)
			.catch((e) => {
				log.warn(`icon fetch failed: ${(e as Error).message}`);
				return null;
			})
			.then((b64) => {
				inflight.delete(key);
				if (!b64) {
					memory.set(key, null);
					return null;
				}
				try {
					mkdirSync(cacheDir, { recursive: true });
					writeFileSync(diskPath(key), Buffer.from(b64, "base64"));
				} catch (e) {
					log.warn(`icon cache write failed: ${(e as Error).message}`);
				}
				const uri = "data:image/png;base64," + b64;
				memory.set(key, uri);
				return uri;
			});
		inflight.set(key, p);
	}
	return p;
}

async function shellIcon(target: string): Promise<string | null> {
	const r = await ps.run("icon", [target, "256"], 30_000);
	if (r.status === "ok" && r.message.length > 100) return r.message;
	if (r.status === "ok" && r.message.length > 0 && process.platform !== "win32") return r.message; // dry-run stand-in
	log.info(`no shell icon for ${target}: ${r.message.slice(0, 120)}`);
	return null;
}

async function load(src: IconSource): Promise<string | null> {
	if (src.type === "shell") {
		for (const c of src.candidates) {
			const b = await shellIcon(c);
			if (b) return b;
		}
		return null;
	}
	if (src.type === "resolve") {
		const r = await ps.run("resolve", [src.names.join("|")]);
		if (r.status === "ok" && r.message) {
			const b = await shellIcon("shell:AppsFolder\\" + r.message);
			if (b) return b;
		}
		for (const p of src.paths) {
			const b = await shellIcon(p);
			if (b) return b;
		}
		return null;
	}
	return siteIcon(src.url);
}

/** Website icon: the site's own high-resolution icon via Google's favicon service, then /apple-touch-icon.png. */
async function siteIcon(url: string): Promise<string | null> {
	let host: string;
	try {
		host = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : "https://" + url).hostname;
	} catch {
		return null;
	}
	const tries = [
		`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=256`,
		`https://${host}/apple-touch-icon.png`,
	];
	for (const u of tries) {
		try {
			const res = await fetch(u, { signal: AbortSignal.timeout(8000), redirect: "follow" });
			const type = res.headers.get("content-type") ?? "";
			if (!res.ok || !type.startsWith("image/png")) continue;
			const buf = Buffer.from(await res.arrayBuffer());
			const width = buf.length > 24 ? buf.readUInt32BE(16) : 0; // PNG IHDR width
			if (width < 48) continue; // too small to look good on a key
			return buf.toString("base64");
		} catch (e) {
			log.info(`site icon ${u}: ${(e as Error).message}`);
		}
	}
	return null;
}
