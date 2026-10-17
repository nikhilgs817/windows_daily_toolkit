// Render a six-second native Stream Deck picture loop; GIF encoding is a separate build step.
// Usage: node tools/render-picture-loop.mjs <input-picture> <output-directory> [back]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { keySvg, pictureKeySvg } from "../shared/icons.js";

const [input, output, glyph] = process.argv.slice(2);
if (!output || (!input && !glyph)) throw Error("Specify a picture, output directory and optional glyph");
const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml" }[extname(input || "").toLowerCase()];
if (!glyph && !mime) throw Error("Expected a PNG, JPG or SVG source picture");
const image = glyph ? "" : `data:${mime};base64,${readFileSync(input).toString("base64")}`;
mkdirSync(output, { recursive: true });
for (let frame = 0; frame < 72; frame++) {
	const motion = { kind: glyph || "picture", phase: frame / 72 };
	const svg = glyph ? keySvg({ glyph, theme: "gold", style: "vivid", label: "", motion }) : pictureKeySvg(image, motion);
	writeFileSync(join(output, `frame-${String(frame).padStart(3, "0")}.png`), new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng());
}
console.log("Rendered 72 frames");
