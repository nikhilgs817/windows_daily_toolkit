import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { keySvg, PRESET_ICONS } from "../shared/icons.js";
import { ROOT } from "./common.mjs";

const out = join(ROOT, "test-output/controls-preview");
mkdirSync(out, { recursive: true });
for (let frame = 0; frame < 72; frame++) {
	const phase = frame / 72;
	let body = `<rect width="664" height="244" rx="18" fill="#11141D"/><text x="24" y="35" fill="#F4F5FA" font-family="Segoe UI" font-size="19" font-weight="600">Screenshot + Show Desktop</text>`;
	for (const [index, style] of ["neon", "vivid"].entries()) {
		const x = index * 336;
		body += `<text x="${x + 24}" y="65" fill="#9DA8BE" font-family="Segoe UI" font-size="11" letter-spacing="2">${style === "neon" ? "COLOURFUL" : "VIVID"}</text>`;
		for (const [col, kind] of ["screenshot", "showdesktop"].entries()) {
			const px = x + 24 + col * 148;
			const id = `tile${index}${col}`;
			body += `<defs><clipPath id="${id}"><rect x="${px}" y="84" width="128" height="128" rx="17"/></clipPath></defs><g clip-path="url(#${id})"><g transform="translate(${px} 84) scale(${128 / 144})">${keySvg({ ...PRESET_ICONS[kind], style, motion: { kind, phase } })}</g></g>`;
		}
	}
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="664" height="244">${body}</svg>`;
	writeFileSync(join(out, `frame-${String(frame).padStart(3, "0")}.png`), new Resvg(svg).render().asPng());
}
console.log(`Rendered 72 preview frames to ${out}`);
