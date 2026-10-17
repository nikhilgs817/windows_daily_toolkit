// Removes run-time leftovers (icon cache, logs, screen memory) so they never ship inside a .streamDeckPlugin.
import { readdirSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { ROOT } from "./common.mjs";

for (const name of readdirSync(join(ROOT, "plugins"))) {
	for (const sd of readdirSync(join(ROOT, "plugins", name)).filter((d) => d.endsWith(".sdPlugin"))) {
		for (const junk of ["cache", "logs", "screens.json"]) {
			const target = resolve(ROOT, "plugins", name, sd, junk);
			if (!target.startsWith(resolve(ROOT, "plugins") + sep)) throw new Error("Cleanup target is outside generated plugins");
			rmSync(target, { recursive: true, force: true });
		}
	}
}
console.log("cleaned run-time files");
