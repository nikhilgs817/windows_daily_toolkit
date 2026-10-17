// Helpers shared by every plugin's generator.
import { Resvg } from "@resvg/resvg-js";
import { strToU8, zipSync } from "fflate";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PRESET_ICONS, keySvg, monoSvg } from "../shared/icons.js";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function writer(sd) {
	return (rel, data) => {
		const p = join(sd, rel);
		mkdirSync(dirname(p), { recursive: true });
		writeFileSync(p, data);
	};
}

/** Static key image + action-list icon for each action (look comes from PRESET_ICONS[kind]). */
export function writeActionImages(sd, entries) {
	const write = writer(sd);
	for (const { id, kind } of entries) {
		const look = PRESET_ICONS[kind];
		if (!look) throw new Error(`No icon for ${kind}`);
		write(`imgs/keys/${id}.svg`, keySvg(look));
		write(`imgs/actions/${id}.svg`, monoSvg(look.glyph, 20));
	}
}

/** Plugin icon (PNG 256 + 512 — required format) and category icon. */
export function writePluginIcons(sd, { glyph, theme, categoryGlyph = glyph, style = "vivid" }) {
	const write = writer(sd);
	write("imgs/plugin/category.svg", monoSvg(categoryGlyph, 28));
	const svg = keySvg({ glyph, theme, label: "", style });
	for (const [file, size] of [["icon.png", 256], ["icon@2x.png", 512]]) {
		write(`imgs/plugin/${file}`, new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng());
	}
}

/** Copies the shared settings panel into the plugin. */
export function copyUi(sd) {
	cpSync(join(ROOT, "shared/ui"), join(sd, "ui"), { recursive: true });
}

/**
 * Builds a bundled key layout (.streamDeckProfile) — the same structure Stream Deck 7 exports and Elgato's own plugins ship:
 *   package.json
 *   Profiles/<PROFILE-ID>.sdProfile/manifest.json                    → device, pages, Version "3.0"
 *   Profiles/<PROFILE-ID>.sdProfile/Profiles/<PAGE-ID>/manifest.json → Controllers[Keypad].Actions{"col,row": action}
 * @param {{sd: string, uuid: string, pluginName: string, version: string, profile: string, title: string,
 *          layout: Record<string, string>, actions: string[][]}} o  profile = manifest name, e.g. "profiles/Apps"
 */
export function buildProfile({ sd, uuid, pluginName, version, profile, title, layout, actions }) {
	const files = {};
	const pid = randomUUID().toUpperCase();
	const page = randomUUID();
	const emptyPage = randomUUID();
	// 15-key Stream Deck model string (taken from a real MK.2 install); the manifest's DeviceType 0 targets all 15-key decks.
	const model = process.env.SD_MODEL || "20GBL9901";
	const put = (rel, obj) => {
		files[rel] = strToU8(JSON.stringify(obj, null, 4));
	};
	put("package.json", { AppVersion: "7.1.0.0", DeviceModel: model, DeviceSettings: null, FormatVersion: 1, OSType: "Windows", OSVersion: "10.0.19045", RequiredPlugins: [uuid] });
	const base = `Profiles/${pid}.sdProfile`;
	put(`${base}/manifest.json`, {
		Device: { Model: model, UUID: randomUUID() },
		Name: title,
		Pages: { Current: "00000000-0000-0000-0000-000000000000", Default: emptyPage, Pages: [page] },
		Version: "3.0",
	});
	const keys = {};
	for (const [pos, id] of Object.entries(layout)) {
		const def = actions.find((a) => a[0] === id);
		if (!def) throw new Error(`layout uses unknown action ${id}`);
		keys[pos] = {
			ActionID: randomUUID(),
			LinkedTitle: false,
			Name: def[1],
			Plugin: { Name: pluginName, UUID: uuid, Version: version },
			Resources: null,
			Settings: {},
			State: 0,
			States: [{ FontFamily: "", FontSize: 12, FontStyle: "", FontUnderline: false, OutlineThickness: 2, ShowTitle: false, TitleAlignment: "bottom", TitleColor: "#ffffff" }],
			UUID: `${uuid}.${id}`,
		};
	}
	put(`${base}/Profiles/${page.toUpperCase()}/manifest.json`, { Controllers: [{ Actions: keys, Type: "Keypad" }], Icon: "", Name: "" });
	put(`${base}/Profiles/${emptyPage.toUpperCase()}/manifest.json`, { Controllers: [{ Actions: null, Type: "Keypad" }], Icon: "", Name: "" });
	const out = join(sd, `${profile}.streamDeckProfile`);
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, zipSync(files));
}
