const NAMED: Record<string, string> = { enter: "{ENTER}", return: "{ENTER}", escape: "{ESC}", esc: "{ESC}", tab: "{TAB}", space: " ", backspace: "{BACKSPACE}", delete: "{DELETE}", home: "{HOME}", end: "{END}", pageup: "{PGUP}", pagedown: "{PGDN}", up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}", plus: "{+}", "+": "{+}", "^": "{^}", "%": "{%}", "~": "{~}", "(": "{(}", ")": "{)}", "{": "{{}", "}": "{}}", "[": "{[}", "]": "{]}" };
/** Human-readable chords only; no shell commands or raw SendKeys macros. */
export function shortcutToSendKeys(text: string): string | undefined {
	const chords = text.trim().split(/\s+/).filter(Boolean);
	if (!chords.length || chords.length > 8) return undefined;
	let result = "";
	for (const chord of chords) {
		let mods = "", key: string | undefined;
		for (const raw of chord.split(/\+(?=.)/).map((p) => p.trim()).filter(Boolean)) {
			const part = raw.toLowerCase();
			if (part === "ctrl" || part === "control") mods += "^";
			else if (part === "shift") mods += "+";
			else if (part === "alt") mods += "%";
			else if (key !== undefined) return undefined;
			else if (/^f([1-9]|1[0-9]|2[0-4])$/.test(part)) key = `{${part.toUpperCase()}}`;
			else key = NAMED[part] || (part.length === 1 ? part : undefined);
			if (key === undefined && !["ctrl", "control", "shift", "alt"].includes(part)) return undefined;
		}
		if (key === undefined) return undefined;
		result += mods + key;
	}
	return result;
}
