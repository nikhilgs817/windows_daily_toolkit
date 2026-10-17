import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { keySvg, monitorKeySvg, PRESET_ICONS } from "../shared/icons.js";
import { ROOT } from "./common.mjs";

const output = join(ROOT, "test-output/all-animations-preview");
mkdirSync(output, { recursive: true });
// Include on/off monitor states and both Website Folder styles in the main-plugin preview.
const kinds = ["appsfolder", "downloads", "app", "website", "back", "screenshot", "showdesktop", "copy", "paste", "volup", "voldown", "monitorcontrol", "monitor-off", "websitefolder", "websitefolder"];
const image = "data:image/png;base64," + readFileSync(join(ROOT, "plugins/dailyops/com.dailyops.v2.sdPlugin/imgs/plugin/icon.png")).toString("base64");
for (let frame = 0; frame < 72; frame++) {
	const phase = frame / 72;
	let body = `<rect width="790" height="520" rx="24" fill="#11141D"/><text x="28" y="36" fill="#F4F5FA" font-family="Segoe UI" font-size="21" font-weight="600">Windows Daily Toolkit · Animated keys</text>`;
	for (const [i, kind] of kinds.entries()) {
		const x = 28 + (i % 5) * 150, y = 60 + Math.floor(i / 5) * 150;
		const motion = { kind, phase };
		const svg = kind.startsWith("monitor") ? monitorKeySvg({ n: kind === "monitor-off" ? 2 : 1, state: kind === "monitor-off" ? "off" : "on", motion }) : keySvg({ ...PRESET_ICONS[kind], ...(kind === "app" ? { style: "real", image, label: "Open App" } : { style: kind.startsWith("vsc-") ? "pro" : i % 2 ? "neon" : "vivid" }), motion });
		body += `<defs><clipPath id="clip${i}"><rect x="${x}" y="${y}" width="134" height="134" rx="18"/></clipPath></defs><g clip-path="url(#clip${i})"><g transform="translate(${x} ${y}) scale(${134 / 144})">${svg}</g></g>`;
	}
	writeFileSync(join(output, `frame-${String(frame).padStart(3, "0")}.png`), new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="790" height="520">${body}</svg>`, { font: { loadSystemFonts: false, ...(process.platform === "win32" ? { fontFiles: [process.env.WINDIR + "/Fonts/segoeuib.ttf"] } : {}) } }).render().asPng());
}
console.log("Rendered 72 animation preview frames");
