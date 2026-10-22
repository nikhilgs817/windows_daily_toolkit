// Generates manifest.json and every static image from one table, so names, UUIDs and art never drift.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PRESET_ICONS, keySvg, monitorKeySvg, monoSvg } from "../../shared/icons.js";
import { Resvg } from "@resvg/resvg-js";
import { buildProfile, copyUi } from "../../tools/common.mjs";
import { toolkitCategorySvg, toolkitLogoSvg } from "./brand.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sd = join(here, "com.dailyops.v2.sdPlugin");
const VERSION = "2.6.1.0";
const PRODUCT_NAME = "Windows Daily Toolkit";

/** id → [Name in action list, tooltip] — order = order in the Stream Deck action list. */
const ACTIONS = [
	["downloads", "Folders", "Open any folder — paste its full path in the key settings and choose a look."],
	["app", "Open App…", "Pick any installed app and an icon for it."],
	["folder", "Open Folder…", "Open any folder — set the path and icon in the key settings."],
	["website", "Open Website…", "Open any website."],
	["websitefolder", "Website Folder", "Opens your editable Websites collection. Add websites in Stream Deck; Back returns to your main keys."],
	["appsfolder", "Apps", "Opens the Apps page: your app keys plus a Back key. Add any app there in the Stream Deck app."],
	["back", "Back to Main Keys", "Returns to your main keys (used on the Apps page)."],
	["screenshot", "Screenshot", "Tap = select an area · double-tap = active window · hold = all screens. Saved to Pictures\\Screenshots and copied."],
	["showdesktop", "Show Desktop", "Show your desktop; press again to restore your windows. Animated Colourful and Vivid looks."],
	["volup", "Volume Up", "Raises the volume. Hold the key to keep going."],
	["voldown", "Volume Down", "Lowers the volume. Hold the key to keep going."],
	["monitorcontrol", "Monitor Control", "Choose a monitor in settings. Red TURN OFF while on; green TURN ON while off."],
	["copy", "Copy (Ctrl+C)", "Copies the selection in the active window."],
	["paste", "Paste (Ctrl+V)", "Pastes into the active window."],
];

const write = (rel, data) => {
	const p = join(sd, rel);
	mkdirSync(dirname(p), { recursive: true });
	writeFileSync(p, data);
};

// Remove stale generated artwork for retired presets when rebuilding an existing checkout.
for (const id of ["chrome", "youtube", "claude", "chatgpt", "vscode", "thinkorswim", "fidelity"]) {
	for (const group of ["keys", "actions"]) rmSync(join(sd, "imgs", group, `${id}.svg`), { force: true });
}
for (const [id] of ACTIONS) {
	const look = PRESET_ICONS[id];
	if (!look) throw new Error(`No icon for ${id}`);
	write(`imgs/keys/${id}.svg`, id === "monitorcontrol" ? monitorKeySvg({ n: "?", state: "unconfigured", caption: "Monitor Control" }) : keySvg(look));
	write(`imgs/actions/${id}.svg`, monoSvg(look.glyph, 20));
}
// The approved master stays in source; only optimized plugin PNGs ship.
rmSync(join(sd, "imgs/plugin/logo.svg"), { force: true });
write("imgs/plugin/category.svg", toolkitCategorySvg());
for (const [file, size] of [["icon.png", 256], ["icon@2x.png", 512]]) {
	write(`imgs/plugin/${file}`, new Resvg(toolkitLogoSvg(size)).render().asPng());
}

/** Bundled Apps page (15-key decks): Back + the app keys; empty slots are for the user's own apps. */
const APPS_LAYOUT = {
	"0,0": "back", "3,1": "app",
};
const APPS_PROFILE = "profiles/Apps"; // must match nav.ts APPS_PROFILE
buildProfile({ sd, uuid: "com.dailyops.v2", pluginName: PRODUCT_NAME, version: VERSION, profile: APPS_PROFILE, title: "Apps", layout: APPS_LAYOUT, actions: ACTIONS });
buildProfile({ sd, uuid: "com.dailyops.v2", pluginName: PRODUCT_NAME, version: VERSION, profile: "profiles/Websites", title: "Websites", layout: { "0,0": "back", "1,0": "website" }, actions: ACTIONS });
buildProfile({ sd, uuid: "com.dailyops.v2", pluginName: PRODUCT_NAME, version: VERSION, profile: "profiles/WindowsDailyToolkit", title: "Windows Daily Toolkit", layout: {
	"0,0": "appsfolder", "1,0": "websitefolder", "2,0": "screenshot", "3,0": "showdesktop", "4,0": "volup",
	"0,1": "monitorcontrol", "1,1": "copy", "2,1": "paste", "3,1": "downloads", "4,1": "voldown",
	"0,2": "app", "1,2": "website",
}, actions: ACTIONS });

const manifest = {
	$schema: "https://schemas.elgato.com/streamdeck/plugins/manifest.json",
	Name: PRODUCT_NAME,
	Version: VERSION,
	Author: "Daily Ops",
	Description: "Animated everyday Windows controls: app launchers, folders, websites, screenshots, desktop, volume, customizable monitor control, copy and paste.",
	UUID: "com.dailyops.v2",
	Icon: "imgs/plugin/icon",
	Category: PRODUCT_NAME,
	CategoryIcon: "imgs/plugin/category",
	CodePath: "bin/plugin.js",
	PropertyInspectorPath: "ui/pi.html",
	SDKVersion: 2,
	Software: { MinimumVersion: "7.1" },
	OS: [{ Platform: "windows", MinimumVersion: "10" }],
	Nodejs: { Version: "20" },
	Profiles: [APPS_PROFILE, "profiles/Websites", "profiles/WindowsDailyToolkit"].map((Name) => ({ Name, DeviceType: 0, Readonly: false, DontAutoSwitchWhenInstalled: true, AutoInstall: true })),
	Actions: ACTIONS.map(([id, name, tip]) => ({
		Name: name,
		UUID: `com.dailyops.v2.${id}`,
		Icon: `imgs/actions/${id}`,
		Tooltip: tip,
		...(id === "folder" ? { VisibleInActionsList: false } : {}), // Retain old keys without a duplicate palette entry.
		Controllers: ["Keypad"],
		States: [{ Image: `imgs/keys/${id}`, ShowTitle: false, TitleAlignment: "bottom" }],
	})),
};
copyUi(sd);
write("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");
console.log(`Generated manifest + ${ACTIONS.length} actions`);
