import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import ts from "typescript";
import { keySvg, monitorKeySvg, pictureKeySvg, PRESET_ICONS } from "../shared/icons.js";

const raster = (svg) => Buffer.from(new Resvg(svg, { font: { loadSystemFonts: false, ...(process.platform === "win32" ? { fontFiles: [process.env.WINDIR + "/Fonts/segoeuib.ttf"] } : {}) } }).render().pixels);
const image = "data:image/png;base64," + readFileSync(new URL("../plugins/dailyops/assets/windows-daily-toolkit-master.png", import.meta.url)).toString("base64");
let looks = 0;
for (const [kind, preset] of Object.entries(PRESET_ICONS)) {
	for (const style of ["neon", "vivid", "pro"]) {
		const render = (phase) => kind === "monitorcontrol" ? monitorKeySvg({ n: 2, state: "on", motion: { kind, phase } }) : keySvg({ ...preset, style, motion: { kind, phase } });
		const first = raster(render(0)), middle = raster(render(.5));
		assert.equal(first.equals(middle), false, `${kind}/${style} does not visually animate`);
		assert.equal(first.equals(raster(render(1))), true, `${kind}/${style} has a loop seam`);
		looks++;
	}
}
console.log(`PASS ${looks} main/companion looks render changing pixels and seamless six-second loops`);
for (const render of [
	(phase) => keySvg({ glyph: "rocket", theme: "ocean", style: "real", image, label: "Sample App", motion: { kind: "app", phase } }),
	(phase) => pictureKeySvg(image, { kind: "picture", phase }),
]) {
	assert.equal(raster(render(0)).equals(raster(render(.5))), false);
	assert.equal(raster(render(0)).equals(raster(render(1))), true);
}
for (const state of ["on", "off"]) for (const phase of [0, .25, .5, .75]) {
	const svg = monitorKeySvg({ n: 2, state, motion: { kind: "monitorcontrol", phase } });
	assert.ok(svg.includes(state === "on" ? "TURN OFF" : "TURN ON"));
	assert.ok(svg.includes(state === "on" ? "#FF5A5A" : "#34D66F"));
}
console.log("PASS real icons and custom pictures animate without losing their image; monitor state colours and labels remain correct");

const output = new URL("../test-output/", import.meta.url);
mkdirSync(output, { recursive: true });
writeFileSync(new URL("motion-check.mjs", output), ts.transpileModule(readFileSync(new URL("../shared/motion.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
const { watchMotion } = await import(new URL("motion-check.mjs", output));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let active = 0, maxActive = 0, slow = 0, fast = 0;
watchMotion("slow", async () => { slow++; maxActive = Math.max(maxActive, ++active); await sleep(200); active--; });
watchMotion("fast", async () => { fast++; });
await sleep(700);
watchMotion("slow"); watchMotion("fast");
const stopped = fast;
await sleep(250);
assert.equal(maxActive, 1, "slow renders were queued concurrently");
assert.ok(slow >= 2 && slow <= 4 && fast >= 5, "slow renders blocked the other keys");
assert.equal(fast, stopped, "hidden keys kept rendering");
console.log("PASS the shared clock skips busy keys, keeps other keys moving, and stops hidden keys");
