// Artwork for the user's native Website folder, using the suite's key renderer.
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { keySvg } from "../shared/icons.js";
import { ROOT } from "./common.mjs";

const out = join(ROOT, "test-output/website-folder");
let phase = 0;
for (const style of ["neon", "vivid"]) {
	const dir = join(out, style);
	mkdirSync(dir, { recursive: true });
	for (let frame = 0; frame < 72; frame++) {
		phase = frame / 72;
		const svg = keySvg({ glyph: "websitefolder", theme: "ocean", label: "Website", style, motion: { kind: "websitefolder", phase } });
		writeFileSync(join(dir, `frame-${String(frame).padStart(3, "0")}.png`), new Resvg(svg).render().asPng());
	}
}
console.log(`Rendered Colourful and Vivid Website folder frames to ${out}`);
