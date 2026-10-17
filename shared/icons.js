// Shared icon library — used by the plugin (runtime key images), the property
// inspector (icon picker) and the build script (static manifest images).
// All artwork is original, generic glyphs (no brand logos).

const W = "#fff";

/** Colour themes: [gradient start, gradient end, ink (cut-out colour)] */
export const THEMES = {
	gold: ["#FFD200", "#F7971E", "#9A4A00"],
	coral: ["#FF9A56", "#F2552C", "#8E2A0C"],
	fire: ["#FF6A00", "#EE0979", "#86063F"],
	berry: ["#FF416C", "#B3127A", "#6E0C3E"],
	candy: ["#FC5C7D", "#6A82FB", "#3B3592"],
	fuchsia: ["#DA22FF", "#9733EE", "#4E1585"],
	violet: ["#667EEA", "#764BA2", "#35296F"],
	indigo: ["#4776E6", "#8E54E9", "#2B2C80"],
	royal: ["#1E3C72", "#2A5298", "#122849"],
	azure: ["#0A64F0", "#2FC4FF", "#06357F"],
	// restrained accents used by the "pro" look (VS Code keys)
	emerald: ["#10B981", "#6EE7B7", "#064E3B"],
	amber: ["#F59E0B", "#FCD34D", "#78350F"],
	crimson: ["#EF4444", "#FDA4AF", "#7F1D1D"],
	iris: ["#8B5CF6", "#C4B5FD", "#3B1D7A"],
	cyan: ["#06B6D4", "#67E8F9", "#0E4F5C"],
	slate: ["#9FB0C8", "#E6EDF7", "#1B2432"],
	ocean: ["#2B86FF", "#00D2FF", "#0A4BA3"],
	sky: ["#2193B0", "#6DD5ED", "#0D5368"],
	mint: ["#00B09B", "#3EE6A0", "#00594E"],
	aurora: ["#0575E6", "#00F260", "#043E86"],
	lime: ["#56AB2F", "#A8E063", "#285E10"],
	night: ["#0F2027", "#2C5364", "#0F2027"],
	graphite: ["#5A5A5A", "#141414", "#1A1A1A"],
	// Punchier two-colour gradients for Colourful and Vivid desk keys.
	sunset: ["#FFB347", "#FF3C5F", "#8A1833"],
	tropical: ["#00E8C6", "#43D45F", "#005B50"],
	electric: ["#20D9FF", "#D32CFF", "#38167D"],
	cosmic: ["#713CFF", "#F02CBA", "#42126B"],
	peach: ["#FF9270", "#FF497C", "#8C2545"],
	lemonade: ["#D5E900", "#36B65E", "#3C5A05"],
};

/** Brighter glyph colours for themes that are too dark to read on the dark "neon" tile. */
const NEON_OVERRIDE = {
	night: ["#3DDC84", "#00C9FF"],
	royal: ["#4FACFE", "#8E9BFF"],
	graphite: ["#F2F2F2", "#8E9EAB"],
	indigo: ["#6F9BFF", "#B07CFF"],
	violet: ["#8EA2FF", "#B58CFF"],
};

const round = 'stroke-linecap="round" stroke-linejoin="round"';
const soft = (o) => `fill="${W}" fill-opacity="${o}"`;
const stroke = (c, w) => `fill="none" stroke="${c}" stroke-width="${w}" ${round}`;

function star(cx, cy, R, r, n = 5) {
	const pts = [];
	for (let i = 0; i < n * 2; i++) {
		const a = (Math.PI / n) * i - Math.PI / 2;
		const rad = i % 2 ? r : R;
		pts.push(`${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)}`);
	}
	return pts.join(" ");
}

function gearTeeth() {
	let s = "";
	for (let i = 0; i < 8; i++) s += `<rect x="64" y="22" width="16" height="18" rx="4" transform="rotate(${i * 45} 72 62)"/>`;
	return s;
}

const folderShape = `<path d="M24 40a8 8 0 0 1 8-8h22a6 6 0 0 1 4.6 2.2L65 41h47a8 8 0 0 1 8 8v8H24z" fill="${W}" fill-opacity=".7"/><rect x="24" y="50" width="96" height="52" rx="9" fill="${W}"/>`;

/** Glyphs, drawn in a 144×144 box (glyph area ≈ y 16–106). `ink` is the cut-out colour. */
export const GLYPHS = {
	folder: () => folderShape,
	websitefolder: (ink) => websiteFolderGlyph(ink, 6),
	download: (ink) => folderShape + `<path d="M72 58v28M60 74l12 12 12-12" ${stroke(ink, 8)}/>`,
	globe: () =>
		`<circle cx="72" cy="60" r="38" fill="${W}" fill-opacity=".18" stroke="${W}" stroke-width="6"/>` +
		`<ellipse cx="72" cy="60" rx="15" ry="38" ${stroke(W, 5)}/>` +
		`<path d="M34 60h76M40 41h64M40 79h64" ${stroke(W, 5)}/>`,
	play: () =>
		`<circle cx="72" cy="60" r="47" ${stroke(W, 3)} stroke-opacity=".4"/>` +
		`<circle cx="72" cy="60" r="38" fill="${W}" fill-opacity=".2" stroke="${W}" stroke-width="5"/>` +
		`<path d="M63 42v36l30-18z" fill="${W}" stroke="${W}" stroke-width="6" stroke-linejoin="round"/>`,
	sparkchat: (ink) =>
		`<rect x="22" y="24" width="100" height="66" rx="16" fill="${W}"/><path d="M40 86l-8 20 28-18z" fill="${W}"/>` +
		`<path d="M72 34Q74.6 54.4 95 57Q74.6 59.6 72 80Q69.4 59.6 49 57Q69.4 54.4 72 34Z" fill="${ink}"/>` +
		`<path d="M101 31Q101.8 37.2 108 38Q101.8 38.8 101 45Q100.2 38.8 94 38Q100.2 37.2 101 31Z" fill="${ink}"/>`,
	chats: (ink) =>
		`<rect x="20" y="24" width="72" height="44" rx="12" fill="${W}" fill-opacity=".55"/><path d="M34 64l-6 16 18-14z" fill="${W}" fill-opacity=".55"/>` +
		`<rect x="50" y="46" width="74" height="46" rx="12" fill="${W}"/><path d="M100 88l12 16 2-16z" fill="${W}"/>` +
		`<circle cx="71" cy="69" r="5" fill="${ink}"/><circle cx="87" cy="69" r="5" fill="${ink}"/><circle cx="103" cy="69" r="5" fill="${ink}"/>`,
	candles: () => {
		const up = "#3DDC84", dn = "#FF5470";
		const c = (x, wTop, wBot, bTop, bBot, col) =>
			`<path d="M${x} ${wTop}V${wBot}" ${stroke(col, 4)}/><rect x="${x - 8}" y="${bTop}" width="16" height="${bBot - bTop}" rx="3" fill="${col}"/>`;
		return (
			`<path d="M20 100h104" ${stroke(W, 3)} stroke-opacity=".35"/>` +
			c(34, 58, 96, 66, 88, dn) + c(58, 46, 90, 54, 80, up) + c(82, 40, 76, 46, 66, dn) + c(106, 18, 70, 26, 58, up)
		);
	},
	waves: () =>
		`<path d="M26 56l24-16 18 12 32-26" ${stroke(W, 7)}/><path d="M88 24h14v14" ${stroke(W, 7)}/>` +
		`<path d="M22 78q12.5-12 25 0t25 0t25 0t25 0" ${stroke(W, 6)}/>` +
		`<path d="M22 96q12.5-12 25 0t25 0t25 0t25 0" ${stroke(W, 6)} stroke-opacity=".55"/>`,
	code: () => {
		// faceted chevrons + slash: sharp joins and a light/dark fold read as a polished editor mark
		const ch = (m) => {
			const X = (x) => (m ? 144 - x : x);
			const pt = (...p) => p.map(([x, y]) => `${X(x)},${y}`).join(" ");
			return (
				`<polygon points="${pt([56, 26], [14, 62], [34, 62], [56, 42])}" fill="${W}"/>` +
				`<polygon points="${pt([14, 62], [56, 98], [56, 82], [34, 62])}" fill="${W}" fill-opacity=".62"/>`
			);
		};
		return (
			`<rect x="10" y="14" width="124" height="96" rx="16" fill="${W}" fill-opacity=".10" stroke="${W}" stroke-opacity=".28" stroke-width="3"/>` +
			`<path d="M10 34h124" stroke="${W}" stroke-opacity=".22" stroke-width="3"/><circle cx="24" cy="24" r="3.4" fill="${W}" fill-opacity=".6"/><circle cx="35" cy="24" r="3.4" fill="${W}" fill-opacity=".4"/><circle cx="46" cy="24" r="3.4" fill="${W}" fill-opacity=".25"/>` +
			`<g transform="translate(0 8) scale(1 .86) translate(0 8.6)">` + ch(false) + ch(true) +
			`<polygon points="79,30 93,30 65,94 51,94" fill="#A8F4FF"/></g>`
		);
	},
	rocket: (ink) =>
		`<path d="M64 88q8 30 16 0z" fill="#FFE07A"/>` +
		`<path d="M56 70L38 92l20-4zM88 70l18 22-20-4z" fill="${W}" fill-opacity=".75"/>` +
		`<path d="M72 18c22 16 26 44 16 72H56c-10-28-6-56 16-72z" fill="${W}"/>` +
		`<circle cx="72" cy="52" r="9" fill="${ink}"/>`,
	link: () => `<g transform="rotate(-40 72 62)" ${stroke(W, 9)}><rect x="24" y="48" width="56" height="28" rx="14"/><rect x="64" y="48" width="56" height="28" rx="14"/></g>`,
	volup: () =>
		`<path d="M24 50h16l22-18v60L40 74H24z" fill="${W}" stroke="${W}" stroke-width="4" stroke-linejoin="round"/>` +
		`<path d="M74 48a20 20 0 0 1 0 28M84 38a34 34 0 0 1 0 48" ${stroke(W, 6)}/><path d="M114 50v24M102 62h24" ${stroke(W, 8)}/>`,
	voldown: () =>
		`<path d="M24 50h16l22-18v60L40 74H24z" fill="${W}" stroke="${W}" stroke-width="4" stroke-linejoin="round"/>` +
		`<path d="M74 48a20 20 0 0 1 0 28" ${stroke(W, 6)}/><path d="M98 62h26" ${stroke(W, 8)}/>`,
	monitorOn: (ink) =>
		`<rect x="12" y="38" width="56" height="40" rx="6" fill="${W}" fill-opacity=".3" stroke="${W}" stroke-width="4"/><path d="M40 78v10M30 90h20" ${stroke(W, 4)}/>` +
		`<circle cx="104" cy="54" r="40" fill="${W}" fill-opacity=".18"/>` +
		`<rect x="76" y="30" width="56" height="48" rx="6" fill="${W}"/><path d="M104 78v10M94 90h20" ${stroke(W, 4)}/>` +
		`<text x="104" y="65" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="30" font-weight="700" fill="${ink}">2</text>`,
	monitorOff: () =>
		`<rect x="12" y="38" width="56" height="40" rx="6" fill="${W}" fill-opacity=".3" stroke="${W}" stroke-width="4"/><path d="M40 78v10M30 90h20" ${stroke(W, 4)}/>` +
		`<rect x="76" y="30" width="56" height="48" rx="6" fill="#000" fill-opacity=".3" stroke="${W}" stroke-width="4" stroke-dasharray="7 5"/><path d="M104 78v10M94 90h20" ${stroke(W, 4)}/>` +
		`<path d="M97 46.5a11 11 0 1 0 14 0M104 41v13" ${stroke(W, 4)}/>`,
	copy: (ink) =>
		`<rect x="30" y="22" width="54" height="64" rx="9" fill="${W}" fill-opacity=".55"/><rect x="58" y="40" width="56" height="66" rx="9" fill="${W}"/>` +
		`<path d="M70 60h32M70 73h32M70 86h20" ${stroke(ink, 5)}/>`,
	paste: (ink) =>
		`<rect x="32" y="30" width="80" height="76" rx="11" fill="${W}"/><rect x="54" y="20" width="36" height="20" rx="7" fill="${ink}" stroke="${W}" stroke-width="4"/>` +
		`<path d="M50 62h44M50 76h44M50 90h28" ${stroke(ink, 5)}/>`,
	grid: () => `<g fill="${W}"><rect x="28" y="20" width="38" height="38" rx="10"/><rect x="78" y="20" width="38" height="38" rx="10" fill-opacity=".7"/><rect x="28" y="68" width="38" height="38" rx="10" fill-opacity=".7"/><rect x="78" y="68" width="38" height="38" rx="10"/></g>`,
	star: () => `<polygon points="${star(72, 62, 44, 19)}" fill="${W}" stroke="${W}" stroke-width="6" stroke-linejoin="round"/>`,
	terminal: (ink) => `<rect x="20" y="26" width="104" height="76" rx="11" fill="${W}"/><path d="M40 52l14 12-14 12" ${stroke(ink, 7)}/><path d="M64 78h24" ${stroke(ink, 7)}/>`,
	mail: (ink) => `<rect x="20" y="32" width="104" height="68" rx="11" fill="${W}"/><path d="M26 40l46 32 46-32" ${stroke(ink, 6)}/>`,
	music: () => `<path d="M58 84V38l46-10v46" ${stroke(W, 7)}/><circle cx="47" cy="86" r="13" fill="${W}"/><circle cx="93" cy="76" r="13" fill="${W}"/>`,
	gear: (ink) => `<g fill="${W}">${gearTeeth()}<circle cx="72" cy="62" r="30"/></g><circle cx="72" cy="62" r="12" fill="${ink}"/>`,
	briefcase: (ink) =>
		`<path d="M56 44v-8a6 6 0 0 1 6-6h20a6 6 0 0 1 6 6v8" ${stroke(W, 7)}/><rect x="22" y="44" width="100" height="60" rx="11" fill="${W}"/>` +
		`<path d="M22 68h100" ${stroke(ink, 5)}/><rect x="63" y="61" width="18" height="14" rx="4" fill="${ink}"/>`,
	calendar: (ink) =>
		`<rect x="24" y="32" width="96" height="72" rx="11" fill="${W}"/><path d="M24 43a11 11 0 0 1 11-11h74a11 11 0 0 1 11 11v11H24z" fill="${ink}" fill-opacity=".8"/>` +
		`<path d="M50 24v16M94 24v16" ${stroke(W, 7)}/>` +
		`<g fill="${ink}"><circle cx="48" cy="72" r="6"/><circle cx="72" cy="72" r="6"/><circle cx="96" cy="72" r="6"/><circle cx="48" cy="90" r="6"/><circle cx="72" cy="90" r="6"/></g>`,
	cloud: () => `<path d="M44 94a21 21 0 0 1-2-42 27 27 0 0 1 51-7 19 19 0 0 1 9 49z" fill="${W}"/>`,
	doc: (ink) =>
		`<path d="M40 18h40l26 26v54a8 8 0 0 1-8 8H40a8 8 0 0 1-8-8V26a8 8 0 0 1 8-8z" fill="${W}"/><path d="M80 18v20a6 6 0 0 0 6 6h20z" fill="${ink}" fill-opacity=".35"/>` +
		`<path d="M46 62h44M46 76h44M46 90h28" ${stroke(ink, 5)}/>`,
	bolt: () => `<path d="M82 16L40 70h28l-8 38 44-56H76z" fill="${W}" stroke="${W}" stroke-width="4" stroke-linejoin="round"/>`,
	dollar: (ink) => `<circle cx="72" cy="62" r="42" fill="${W}"/><text x="72" y="81" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="56" font-weight="700" fill="${ink}">$</text>`,
	chart: () =>
		`<g fill="${W}"><rect x="26" y="70" width="18" height="32" rx="4" fill-opacity=".6"/><rect x="52" y="56" width="18" height="46" rx="4" fill-opacity=".75"/><rect x="78" y="62" width="18" height="40" rx="4" fill-opacity=".85"/><rect x="104" y="40" width="18" height="62" rx="4"/></g>` +
		`<path d="M24 52l28-16 26 10 38-26" ${stroke(W, 6)}/>`,
	home: (ink) => `<path d="M72 22L22 62h13v40h26V80h22v22h26V62h13z" fill="${W}" stroke="${W}" stroke-width="4" stroke-linejoin="round"/><rect x="61" y="80" width="22" height="22" fill="${ink}" fill-opacity=".25"/>`,
	gamepad: (ink) =>
		`<path d="M44 42h56a20 20 0 0 1 19.6 16l5 26a12 12 0 0 1-21 9L93 82H51L40.4 93a12 12 0 0 1-21-9l5-26A20 20 0 0 1 44 42z" fill="${W}"/>` +
		`<path d="M46 56v18M37 65h18" ${stroke(ink, 6)}/><circle cx="96" cy="58" r="5.5" fill="${ink}"/><circle cx="106" cy="70" r="5.5" fill="${ink}"/>`,
	camera: (ink) =>
		`<path d="M52 40l8-12h24l8 12z" fill="${W}"/><rect x="20" y="38" width="104" height="64" rx="12" fill="${W}"/>` +
		`<circle cx="72" cy="70" r="21" fill="${ink}"/><circle cx="72" cy="70" r="11" fill="${W}" fill-opacity=".85"/><circle cx="106" cy="52" r="4" fill="${ink}"/>`,
	back: () => `<circle cx="72" cy="60" r="40" fill="${W}" fill-opacity=".16" stroke="${W}" stroke-width="5"/><path d="M80 38L58 60l22 22" ${stroke(W, 10)}/>`,
	palette: (ink) =>
		`<rect x="18" y="26" width="108" height="74" rx="12" fill="${W}"/><rect x="28" y="36" width="88" height="20" rx="6" fill="${ink}" fill-opacity=".9"/>` +
		`<path d="M36 41l6 5-6 5" ${stroke(W, 4)}/><path d="M30 72h60M30 86h42" ${stroke(ink, 5)}/>`,
	quickopen: (ink) =>
		`<path d="M30 18h34l20 20v58a6 6 0 0 1-6 6H30a6 6 0 0 1-6-6V24a6 6 0 0 1 6-6z" fill="${W}"/><path d="M36 50h30M36 62h22" ${stroke(ink, 5)}/>` +
		`<circle cx="88" cy="74" r="17" fill="${ink}" stroke="${W}" stroke-width="7"/><path d="M100 87l14 14" ${stroke(W, 9)}/>`,
	search: () => `<circle cx="62" cy="54" r="27" fill="${W}" fill-opacity=".16" stroke="${W}" stroke-width="10"/><path d="M82 75l24 24" ${stroke(W, 13)}/>`,
	tree: () =>
		`<rect x="20" y="16" width="30" height="18" rx="5" fill="${W}"/><path d="M35 34v52M35 46h24M35 86h24" ${stroke(W, 6)}/>` +
		`<rect x="60" y="34" width="58" height="24" rx="7" fill="${W}"/><rect x="60" y="74" width="58" height="24" rx="7" fill="${W}" fill-opacity=".8"/>`,
	branch: (ink) =>
		`<path d="M44 40v46M98 54c0 26-54 16-54 34" ${stroke(W, 7)}/>` +
		`<circle cx="44" cy="30" r="11" fill="${ink}" stroke="${W}" stroke-width="6"/><circle cx="44" cy="94" r="11" fill="${ink}" stroke="${W}" stroke-width="6"/><circle cx="98" cy="44" r="11" fill="${ink}" stroke="${W}" stroke-width="6"/>`,
	commit: (ink) => `<path d="M14 62h36M94 62h36" ${stroke(W, 8)}/><circle cx="72" cy="62" r="21" fill="${ink}" stroke="${W}" stroke-width="9"/>`,
	push: () => `<path d="M34 22h76" ${stroke(W, 8)}/><path d="M72 102V44M48 66l24-24 24 24" ${stroke(W, 10)}/>`,
	pull: () => `<path d="M34 102h76" ${stroke(W, 8)}/><path d="M72 22v58M48 58l24 24 24-24" ${stroke(W, 10)}/>`,
	newterm: (ink) =>
		`<rect x="14" y="32" width="96" height="68" rx="11" fill="${W}"/><path d="M32 54l13 11-13 11" ${stroke(ink, 6)}/><path d="M54 78h22" ${stroke(ink, 6)}/>` +
		`<circle cx="108" cy="34" r="20" fill="${ink}" stroke="${W}" stroke-width="5"/><path d="M108 24v20M98 34h20" ${stroke(W, 5)}/>`,
	bug: (ink) =>
		`<path d="M46 56H26M46 74H24M48 90l-16 12M98 56h20M98 74h22M96 90l16 12M64 26l-7-9M80 26l7-9" ${stroke(W, 6)}/>` +
		`<circle cx="72" cy="38" r="15" fill="${W}"/><ellipse cx="72" cy="70" rx="27" ry="33" fill="${W}"/><path d="M72 46v54" ${stroke(ink, 4)}/>`,
	stop: () => `<rect x="34" y="24" width="76" height="76" rx="16" fill="${W}"/>`,
	format: () =>
		`<path d="M22 34h72M22 54h98M22 74h58M22 94h84" ${stroke(W, 8)}/>` +
		`<path d="M110 60Q111.6 72.4 124 74Q111.6 75.6 110 88Q108.4 75.6 96 74Q108.4 72.4 110 60Z" fill="${W}"/>`,
	save: (ink) =>
		`<path d="M26 20h70l22 22v56a8 8 0 0 1-8 8H34a8 8 0 0 1-8-8z" fill="${W}"/><rect x="42" y="20" width="46" height="28" rx="3" fill="${ink}" fill-opacity=".85"/>` +
		`<rect x="74" y="26" width="8" height="16" rx="2" fill="${W}"/><rect x="40" y="66" width="64" height="32" rx="5" fill="${ink}" fill-opacity=".25"/>`,
	sidebar: () => `<rect x="18" y="26" width="108" height="76" rx="12" ${stroke(W, 7)}/><rect x="24" y="32" width="32" height="64" rx="6" fill="${W}"/>`,
	split: () => `<rect x="18" y="26" width="108" height="76" rx="12" ${stroke(W, 7)}/><path d="M72 32v64" ${stroke(W, 7)}/><path d="M32 50h26M32 64h20M86 50h26M86 64h20" ${stroke(W, 5)}/>`,
	comment: () => `<path d="M60 26L40 98M98 26L78 98" ${stroke(W, 11)}/>`,
	target: () => `<circle cx="72" cy="62" r="40" ${stroke(W, 7)}/><circle cx="72" cy="62" r="22" ${stroke(W, 7)}/><circle cx="72" cy="62" r="7" fill="${W}"/>`,
	pencil: (ink) => `<path d="M32 98l6-26 54-54 20 20-54 54z" fill="${W}"/><path d="M82 28l20 20" ${stroke(ink, 5)}/><path d="M32 98l8-2-6-6z" fill="${ink}"/>`,
	warning: (ink) => `<path d="M72 22L122 102H22z" fill="${W}" stroke="${W}" stroke-width="8" stroke-linejoin="round"/><path d="M72 50v24" ${stroke(ink, 9)}/><circle cx="72" cy="88" r="5.5" fill="${ink}"/>`,
	moon: () => `<path d="M88 20a44 44 0 1 0 32 70A38 38 0 0 1 88 20z" fill="${W}"/><circle cx="104" cy="34" r="5" fill="${W}"/>`,
	closewin: () => `<rect x="24" y="24" width="96" height="78" rx="14" fill="${W}" fill-opacity=".16" stroke="${W}" stroke-width="6"/><path d="M54 45l36 36M90 45L54 81" ${stroke(W, 10)}/>`,
	keyboard: (ink) => {
		let k = `<rect x="12" y="36" width="120" height="66" rx="11" fill="${W}"/>`;
		for (let r = 0; r < 2; r++) for (let c = 0; c < 7; c++) k += `<rect x="${22 + c * 15}" y="${46 + r * 15}" width="10" height="10" rx="2" fill="${ink}"/>`;
		return k + `<rect x="40" y="78" width="64" height="11" rx="3" fill="${ink}"/>`;
	},
	project: (ink) => folderShape + `<path d="M62 62l-12 13 12 13M82 62l12 13-12 13" ${stroke(ink, 6)}/>`,
	snip: (ink) =>
		`<path d="M24 46V30a6 6 0 0 1 6-6h16M98 24h16a6 6 0 0 1 6 6v16M120 78v16a6 6 0 0 1-6 6H98M46 100H30a6 6 0 0 1-6-6V78" ${stroke(W, 8)}/>` +
		`<path d="M44 44h56v38H44z" fill="${W}" fill-opacity=".22" stroke="${W}" stroke-width="3" stroke-dasharray="7 6"/>` +
		`<circle cx="72" cy="63" r="12" fill="${W}"/><circle cx="72" cy="63" r="5" fill="${ink}"/>`,
	appfolder: (ink) =>
		folderShape +
		`<g fill="${ink}"><rect x="50" y="58" width="18" height="16" rx="4"/><rect x="76" y="58" width="18" height="16" rx="4"/><rect x="50" y="80" width="18" height="16" rx="4"/><rect x="76" y="80" width="18" height="16" rx="4"/></g>`,
	// ── refined duotone line glyphs (VS Code keys): soft fill + 6 px stroke, same optical weight throughout ──
	vback: () => `<circle cx="72" cy="62" r="40" fill="${W}" fill-opacity=".12" stroke="${W}" stroke-width="5"/><path d="M80 40L58 62l22 22" ${stroke(W, 8)}/>`,
	vpalette: () =>
		`<rect x="18" y="26" width="108" height="76" rx="12" ${soft(.14)} stroke="${W}" stroke-width="5"/>` +
		`<path d="M32 46l9 7-9 7" ${stroke(W, 5)}/><path d="M52 53h56" ${stroke(W, 5)}/><path d="M34 74h60M34 88h38" ${stroke(W, 5)} stroke-opacity=".55"/>`,
	vquickopen: (ink) =>
		`<path d="M36 18h36l24 24v54a8 8 0 0 1-8 8H36a8 8 0 0 1-8-8V26a8 8 0 0 1 8-8z" ${soft(.14)} stroke="${W}" stroke-width="5" stroke-linejoin="round"/>` +
		`<path d="M72 18v22a4 4 0 0 0 4 4h20" ${stroke(W, 5)} stroke-opacity=".7"/><path d="M40 60h24M40 74h14" ${stroke(W, 5)} stroke-opacity=".55"/>` +
		`<circle cx="88" cy="80" r="15" fill="${ink}" stroke="${W}" stroke-width="6"/><path d="M99 91l15 15" ${stroke(W, 8)}/>`,
	vsearch: () =>
		`<circle cx="62" cy="54" r="29" ${soft(.14)} stroke="${W}" stroke-width="8"/><path d="M83 76l23 23" ${stroke(W, 11)}/><path d="M46 46a18 18 0 0 1 13-11" ${stroke(W, 4)} stroke-opacity=".6"/>`,
	vterminal: () =>
		`<rect x="18" y="26" width="108" height="76" rx="12" ${soft(.14)} stroke="${W}" stroke-width="5"/><path d="M18 44h108" ${stroke(W, 4)} stroke-opacity=".4"/>` +
		`<path d="M38 62l14 11-14 11" ${stroke(W, 7)}/><path d="M62 88h28" ${stroke(W, 7)}/>`,
	vtree: () =>
		`<rect x="20" y="18" width="28" height="18" rx="5" fill="${W}"/><path d="M34 36v54M34 56h22M34 90h22" ${stroke(W, 5)} stroke-opacity=".8"/>` +
		`<rect x="58" y="44" width="58" height="22" rx="7" ${soft(.14)} stroke="${W}" stroke-width="5"/><rect x="58" y="80" width="58" height="22" rx="7" ${soft(.14)} stroke="${W}" stroke-width="5"/>`,
	vbranch: (ink) =>
		`<path d="M44 40v44M98 56c0 22-54 12-54 28" ${stroke(W, 6)}/>` +
		`<circle cx="44" cy="30" r="11" fill="${ink}" stroke="${W}" stroke-width="6"/><circle cx="44" cy="94" r="11" fill="${ink}" stroke="${W}" stroke-width="6"/><circle cx="98" cy="46" r="11" fill="${ink}" stroke="${W}" stroke-width="6"/>`,
	vcommit: (ink) =>
		`<path d="M14 62h36M94 62h36" ${stroke(W, 6)}/><circle cx="72" cy="62" r="22" fill="${ink}" stroke="${W}" stroke-width="7"/><circle cx="72" cy="62" r="7" fill="${W}"/>`,
	vpush: () => `<path d="M36 22h72" ${stroke(W, 6)}/><path d="M72 100V44M50 64l22-22 22 22" ${stroke(W, 8)}/>`,
	vpull: () => `<path d="M36 102h72" ${stroke(W, 6)}/><path d="M72 22v56M50 58l22 22 22-22" ${stroke(W, 8)}/>`,
	vnewterm: (ink) =>
		`<rect x="14" y="34" width="92" height="66" rx="11" ${soft(.14)} stroke="${W}" stroke-width="5"/>` +
		`<path d="M30 56l12 10-12 10" ${stroke(W, 6)}/><path d="M50 84h22" ${stroke(W, 6)}/>` +
		`<circle cx="108" cy="34" r="19" fill="${ink}" stroke="${W}" stroke-width="5"/><path d="M108 24v20M98 34h20" ${stroke(W, 5)}/>`,
	vplay: () => `<path d="M52 32L108 62 52 92z" ${soft(.18)} stroke="${W}" stroke-width="8" stroke-linejoin="round"/>`,
	vbug: (ink) =>
		`<path d="M48 56H28M48 74H26M50 90l-16 12M96 56h20M96 74h22M94 90l16 12M64 26l-7-9M80 26l7-9" ${stroke(W, 5)}/>` +
		`<ellipse cx="72" cy="72" rx="25" ry="31" ${soft(.16)} stroke="${W}" stroke-width="6"/><circle cx="72" cy="40" r="13" fill="${ink}" stroke="${W}" stroke-width="6"/><path d="M72 52v50" ${stroke(W, 4)} stroke-opacity=".7"/>`,
	vstop: () => `<rect x="36" y="26" width="72" height="72" rx="14" ${soft(.2)} stroke="${W}" stroke-width="7"/>`,
	vformat: () =>
		`<path d="M22 34h62M22 54h98M22 74h54M22 94h80" ${stroke(W, 6)} stroke-opacity=".85"/>` +
		`<path d="M110 58Q111.6 70.4 124 72Q111.6 73.6 110 86Q108.4 73.6 96 72Q108.4 70.4 110 58Z" fill="${W}"/>`,
	vsave: () =>
		`<path d="M28 20h66l22 22v54a8 8 0 0 1-8 8H36a8 8 0 0 1-8-8z" ${soft(.14)} stroke="${W}" stroke-width="5" stroke-linejoin="round"/>` +
		`<path d="M46 20v24h38V20" ${stroke(W, 5)}/><rect x="42" y="66" width="60" height="34" rx="6" ${soft(.2)} stroke="${W}" stroke-width="5"/>`,
	vsidebar: () =>
		`<rect x="18" y="26" width="108" height="76" rx="12" ${soft(.1)} stroke="${W}" stroke-width="5"/>` +
		`<path d="M30 26h26v76H30a12 12 0 0 1-12-12V38a12 12 0 0 1 12-12z" fill="${W}" fill-opacity=".9"/><path d="M74 48h38M74 62h28M74 76h34" ${stroke(W, 5)} stroke-opacity=".55"/>`,
	vsplit: () =>
		`<rect x="18" y="26" width="108" height="76" rx="12" ${soft(.1)} stroke="${W}" stroke-width="5"/><path d="M72 28v72" ${stroke(W, 5)}/>` +
		`<path d="M32 50h28M32 64h20M32 78h24M84 50h28M84 64h20M84 78h24" ${stroke(W, 5)} stroke-opacity=".55"/>`,
	vcomment: () =>
		`<rect x="18" y="24" width="108" height="76" rx="14" ${soft(.1)} stroke="${W}" stroke-width="4" stroke-opacity=".7"/>` +
		`<path d="M58 88l16-52M82 88l16-52" ${stroke(W, 8)}/>`,
	vtarget: () =>
		`<circle cx="72" cy="62" r="34" ${soft(.1)} stroke="${W}" stroke-width="5" stroke-opacity=".7"/><circle cx="72" cy="62" r="20" stroke="${W}" stroke-width="6" fill="none"/><circle cx="72" cy="62" r="6" fill="${W}"/>` +
		`<path d="M72 14v16M72 94v16M20 62h16M108 62h16" ${stroke(W, 5)}/>`,
	vpencil: () =>
		`<path d="M32 98l6-22 46-46 16 16-46 46z" ${soft(.18)} stroke="${W}" stroke-width="6" stroke-linejoin="round"/><path d="M76 38l16 16M38 76l16 16" ${stroke(W, 5)} stroke-opacity=".7"/>`,
	vwarning: () =>
		`<path d="M72 22L122 100H22z" ${soft(.16)} stroke="${W}" stroke-width="7" stroke-linejoin="round"/><path d="M72 50v26" ${stroke(W, 7)}/><circle cx="72" cy="88" r="4.5" fill="${W}"/>`,
	vmoon: () =>
		`<path d="M86 22A42 42 0 1 0 118 84 34 34 0 0 1 86 22z" ${soft(.18)} stroke="${W}" stroke-width="6" stroke-linejoin="round"/><circle cx="104" cy="38" r="4" fill="${W}"/>`,
	vclose: () =>
		`<rect x="18" y="26" width="108" height="76" rx="12" ${soft(.1)} stroke="${W}" stroke-width="5"/><path d="M56 46l32 36M88 46L56 82" ${stroke(W, 7)}/>`,
	vkeyboard: () =>
		`<rect x="14" y="30" width="116" height="68" rx="12" ${soft(.14)} stroke="${W}" stroke-width="5"/>` +
		`<g fill="${W}"><rect x="28" y="44" width="11" height="8" rx="2"/><rect x="45" y="44" width="11" height="8" rx="2"/><rect x="62" y="44" width="11" height="8" rx="2"/><rect x="79" y="44" width="11" height="8" rx="2"/><rect x="96" y="44" width="11" height="8" rx="2"/>` +
		`<rect x="36" y="58" width="11" height="8" rx="2"/><rect x="53" y="58" width="11" height="8" rx="2"/><rect x="70" y="58" width="11" height="8" rx="2"/><rect x="87" y="58" width="11" height="8" rx="2"/><rect x="42" y="75" width="60" height="9" rx="3" fill-opacity=".8"/></g>`,
	vproject: () =>
		`<path d="M20 40a8 8 0 0 1 8-8h24l10 10h50a8 8 0 0 1 8 8v46a8 8 0 0 1-8 8H28a8 8 0 0 1-8-8z" ${soft(.14)} stroke="${W}" stroke-width="5" stroke-linejoin="round"/>` +
		`<path d="M58 62l-12 12 12 12M86 62l12 12-12 12" ${stroke(W, 6)}/>`,
	capture: () =>
		`<path d="M38 24H24v15M106 24h14v15M24 83v15h14M120 83v15h-14" ${stroke(W, 5)}/>` +
		`<rect x="34" y="34" width="76" height="54" rx="8" ${soft(.12)} stroke="${W}" stroke-width="3"/>` +
		`<path d="M42 77l18-17 13 12 13-20 16 25" ${stroke(W, 4)}/><circle cx="53" cy="48" r="5" fill="${W}"/>`,
	desktop: (ink) =>
		`<rect x="22" y="24" width="100" height="70" rx="9" ${soft(.12)} stroke="${W}" stroke-width="5"/>` +
		`<path d="M72 96v9M53 108h38" ${stroke(W, 5)}/>` +
		`<rect x="34" y="36" width="44" height="32" rx="5" ${soft(.3)} stroke="${W}" stroke-width="3"/><path d="M35 45h42" ${stroke(W, 2)}/>` +
		`<rect x="62" y="51" width="46" height="31" rx="5" fill="${ink}" stroke="${W}" stroke-width="3"/><path d="M63 60h44" ${stroke(W, 2)}/><path d="M116 32v52" ${stroke(W, 3)} stroke-opacity=".65"/>`,
	heart: () => `<path d="M72 102S24 74 24 46a24 24 0 0 1 48-6 24 24 0 0 1 48 6c0 28-48 56-48 56z" fill="${W}"/>`,
};

/** Glyphs offered in the icon picker (in display order). */
export const PICKABLE = [
	"rocket", "grid", "folder", "download", "globe", "play", "sparkchat", "chats", "code", "terminal",
	"candles", "chart", "waves", "dollar", "briefcase", "mail", "calendar", "doc", "cloud", "music",
	"gamepad", "camera", "gear", "home", "star", "heart", "bolt", "link",
	"search", "branch", "bug", "save", "keyboard", "palette", "target", "pencil", "warning", "moon", "project", "stop", "snip", "appfolder", "capture", "desktop",
];

let uid = 0;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function websiteFolderGlyph(ink, longitude) {
	return folderShape + `<g fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"><circle cx="72" cy="76" r="20"/><ellipse cx="72" cy="76" rx="${longitude.toFixed(2)}" ry="20"/><path d="M52 76h40M55 66h34M55 86h34"/></g>`;
}

/** Shape-specific motion stays inside the artwork area; labels never move. */
function movingGlyph(glyph, art, ink, phase, breathe) {
	const f = (n) => n.toFixed(2);
	if (glyph === "websitefolder") return websiteFolderGlyph(ink, 6 + breathe * 5);
	if (glyph === "folder") {
		return `<path d="M24 40a8 8 0 0 1 8-8h22l11 9h47a8 8 0 0 1 8 8v48H24Z" ${soft(.55)}/>` +
			`<g transform="translate(0 ${f(-breathe * 7)})"><rect x="51" y="35" width="42" height="51" rx="5" ${soft(.9)}/><path d="M60 46h24M60 55h18" ${stroke(ink, 3)}/></g>` +
			`<path d="M24 ${f(54 + breathe * 5)}Q24 50 32 50h80q8 0 8 8l-8 38q-1 6-8 6H38q-7 0-8-6Z" fill="${W}"/>`;
	}
	if (glyph === "appfolder") {
		return folderShape + `<g fill="${ink}">` + [0, 1, 2, 3].map((i) => {
			const rise = (1 - Math.cos((phase + i * .1) * Math.PI * 2)) * 1.4;
			return `<rect x="${53 + (i % 2) * 22}" y="${f(59 + Math.floor(i / 2) * 22 - rise)}" width="16" height="16" rx="3"/>`;
		}).join("") + `</g>`;
	}
	if (glyph === "volup" || glyph === "voldown") {
		const speaker = `<path d="M24 50h16l22-18v60L40 74H24Z" fill="${W}" stroke="${W}" stroke-width="4" stroke-linejoin="round"/>`;
		const waves = ["M74 48a20 20 0 0 1 0 28", "M84 38a34 34 0 0 1 0 48"].map((d, i) => `<path d="${d}" ${stroke(W, 6)} opacity="${f(.28 + .72 * (1 - Math.cos(phase * Math.PI * 2 - i * .8)) / 2)}"/>`).join("");
		return speaker + waves + `<path d="${glyph === 'volup' ? 'M114 50v24M102 62h24' : 'M102 62h24'}" ${stroke(W, 8)}/>`;
	}
	if (glyph === "copy") return `<rect x="30" y="22" width="54" height="64" rx="9" ${soft(.5)}/><g transform="translate(${f(breathe * 4)} ${f(-breathe * 3)})"><rect x="58" y="40" width="56" height="66" rx="9" fill="${W}"/><path d="M70 60h32M70 73h32M70 86h20" ${stroke(ink, 5)}/></g>`;
	if (glyph === "paste") return `<rect x="32" y="30" width="80" height="76" rx="11" fill="${W}"/><rect x="54" y="20" width="36" height="20" rx="7" fill="${ink}" stroke="${W}" stroke-width="4"/><g transform="translate(0 ${f(breathe * 4)})"><path d="M50 59h44M50 73h44M50 87h28" ${stroke(ink, 5)}/></g>`;
	if (glyph === "back" || glyph === "vback") return `<circle cx="72" cy="60" r="40" ${soft(.16)} stroke="${W}" stroke-width="5"/><path d="M80 38L58 60l22 22" ${stroke(W, 9)} transform="translate(${f(-breathe * 5)} 0)"/>`;
	if (glyph === "globe") return `<circle cx="72" cy="60" r="38" ${soft(.18)} stroke="${W}" stroke-width="6"/><ellipse cx="72" cy="60" rx="${f(9 + breathe * 14)}" ry="38" ${stroke(W, 5)}/><path d="M34 60h76M40 41h64M40 79h64" ${stroke(W, 5)}/>`;
	if (glyph === "link") return `<g transform="rotate(${f(Math.sin(phase * Math.PI * 2) * 4)} 72 62)">${art}</g>`;
	if (glyph === "gear") return `<g transform="rotate(${f(phase * 360)} 72 62)">${art}</g>`;
	return `<g transform="translate(0 ${f(-breathe * (glyph === 'rocket' ? 4 : 2))})">${art}</g>` +
		(glyph === "vterminal" || glyph === "terminal" ? `<path d="M96 76v12" ${stroke(W, 3)} opacity="${f(.15 + breathe * .8)}"/>` : "");
}

/**
 * Builds a 144×144 key image. No SVG filters are used, so it renders the same in Stream Deck's SVG engine.
 * @param {{glyph: string, theme: string, label?: string, style?: "neon"|"vivid"|"real"|"pro", image?: string, motion?: {kind: string, phase: number}}} spec
 *   style "vivid": white glyph on a colour gradient · "neon": colour-gradient glyph on dark glass ·
 *   "real": the app's/site's own icon (data URI in `image`) on dark glass.
 * @returns {string} SVG markup
 */
export function keySvg({ glyph, theme, label = "", style = "neon", image, motion }) {
	let [c1, c2, ink] = THEMES[theme] ?? THEMES.violet;
	if (style !== "vivid" && NEON_OVERRIDE[theme]) [c1, c2] = NEON_OVERRIDE[theme];
	const u = "k" + (++uid).toString(36); // unique ids so many icons can share one HTML page
	const draw = GLYPHS[glyph] ?? GLYPHS.rocket;
	const text = String(label).trim().toUpperCase().slice(0, 14);
	const hasLabel = text.length > 0;
	const dark = style !== "vivid";
	const pro = style === "pro";
	const useImage = style === "real" && typeof image === "string" && image.startsWith("data:image/");
	const fs = Math.min(18, Math.floor(128 / Math.max(1, text.length * 0.66)));
	const ls = text.length > 9 ? 0.5 : 1.5;
	const phase = motion ? ((motion.phase % 1) + 1) % 1 : 0;
	const breathe = motion ? (1 - Math.cos(phase * Math.PI * 2)) / 2 : 0;

	let defs =
		`<linearGradient id="${u}bg" x1="0" y1="0" x2="1" y2="1">` +
		(pro ? `<stop offset="0" stop-color="#2B3040"/><stop offset="1" stop-color="#0E1016"/>` : dark ? `<stop offset="0" stop-color="#2A2E40"/><stop offset="1" stop-color="#0B0D14"/>` : `<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>`) +
		`</linearGradient>` +
		`<radialGradient id="${u}hl" cx=".25" cy=".1" r=".95"><stop offset="0" stop-color="#fff" stop-opacity="${dark ? 0.16 : 0.42}"/><stop offset=".55" stop-color="#fff" stop-opacity="${dark ? 0.03 : 0.06}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
		`<linearGradient id="${u}vg" x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".32"/></linearGradient>`;
	if (dark) {
		defs +=
			`<radialGradient id="${u}glow" cx=".5" cy=".42" r=".55"><stop offset="0" stop-color="${c1}" stop-opacity="${pro ? 0.3 : 0.55}"/><stop offset=".6" stop-color="${c2}" stop-opacity="${pro ? 0.08 : 0.18}"/><stop offset="1" stop-color="${c2}" stop-opacity="0"/></radialGradient>` +
			`<linearGradient id="${u}fg" gradientUnits="userSpaceOnUse" x1="24" y1="18" x2="120" y2="106"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`;
	}
	if (motion) {
		defs += `<clipPath id="${u}tile"><rect x="3" y="3" width="138" height="138" rx="10"/></clipPath>` +
			`<linearGradient id="${u}sheen"><stop stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity="${dark ? .12 : .18}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
	}

	let body = `<rect width="144" height="144" fill="url(#${u}bg)"/>`;
	if (pro) {
		defs += `<linearGradient id="${u}bar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`;
		body += `<rect width="144" height="144" fill="url(#${u}glow)"/><rect x="1" y="1" width="142" height="142" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="2"/><rect width="144" height="6" fill="url(#${u}bar)"/>`;
	} else if (dark) body += `<rect width="144" height="144" fill="url(#${u}glow)"/><rect x="1.5" y="1.5" width="141" height="141" rx="0" fill="none" stroke="${c1}" stroke-opacity=".35" stroke-width="3"/>`;
	else body += `<circle cx="128" cy="14" r="52" fill="#fff" opacity=".12"/><circle cx="8" cy="140" r="46" fill="#000" opacity=".12"/>`;
	body += `<rect width="144" height="144" fill="url(#${u}hl)"/><rect width="144" height="144" fill="url(#${u}vg)"/>`;
	if (motion) {
		// Gentle, continuous light movement; the label stays still and legible at 72px.
		const sweep = -110 + phase * 380;
		body += `<g clip-path="url(#${u}tile)"><rect x="${sweep.toFixed(2)}" y="-30" width="58" height="220" transform="rotate(24 72 72)" fill="url(#${u}sheen)"/></g>` +
			`<rect x="5" y="5" width="134" height="134" rx="11" fill="none" stroke="${dark ? c2 : W}" stroke-width="1.5" stroke-opacity="${(.15 + breathe * .22).toFixed(3)}" stroke-dasharray="32 504" stroke-dashoffset="${(-phase * 536).toFixed(2)}"/>`;
	}

	if (useImage) {
		const sz = hasLabel ? 92 : 108;
		const x = (144 - sz) / 2, y = hasLabel ? 12 : 18;
		const float = motion ? ` transform="translate(72 ${y + sz / 2}) scale(${(1 + breathe * .015).toFixed(4)}) translate(-72 ${-(y + sz / 2)}) translate(0 ${(-breathe * 1.5).toFixed(2)})"` : "";
		body += `<image x="${x}" y="${y}" width="${sz}" height="${sz}" preserveAspectRatio="xMidYMid meet" href="${image}" xlink:href="${image}"${float}/>`;
	} else {
		const g = hasLabel ? `translate(72 58) scale(.86) translate(-72 -62)` : `translate(72 72) scale(1.02) translate(-72 -62)`;
		let art = draw(dark ? "#151824" : ink);
		if (motion?.kind === "screenshot" && glyph === "capture") {
			const scan = 39 + breathe * 42;
			art += `<path d="M38 ${scan.toFixed(2)}h68" ${stroke(W, 2)} stroke-opacity="${(.25 + breathe * .5).toFixed(3)}"/><circle cx="111" cy="28" r="3" fill="${W}" opacity="${(.45 + breathe * .5).toFixed(3)}"/>`;
		} else if (motion?.kind === "showdesktop" && glyph === "desktop") {
			// Windows drift gently toward the desktop edge, then return in a seamless loop.
			const reveal = Math.pow(breathe, 3);
			const shell = `<rect x="22" y="24" width="100" height="70" rx="9" ${soft(.12)} stroke="${W}" stroke-width="5"/><path d="M72 96v9M53 108h38" ${stroke(W, 5)}/><path d="M116 32v52" ${stroke(W, 3)} stroke-opacity=".65"/>`;
			const windows = `<rect x="34" y="36" width="44" height="32" rx="5" ${soft(.3)} stroke="${W}" stroke-width="3"/><path d="M35 45h42" ${stroke(W, 2)}/><rect x="62" y="51" width="46" height="31" rx="5" fill="${dark ? '#151824' : ink}" stroke="${W}" stroke-width="3"/><path d="M63 60h44" ${stroke(W, 2)}/>`;
			art = shell + `<g opacity="${(.75 * reveal).toFixed(3)}"><path d="M57 45h12v12H57zM74 45h12v12H74zM57 62h12v12H57zM74 62h12v12H74z" fill="${W}"/></g>` +
				`<g transform="translate(${(reveal * 8).toFixed(2)} ${(reveal * 12).toFixed(2)}) translate(72 60) scale(${(1 - reveal * .2).toFixed(3)}) translate(-72 -60)" opacity="${(1 - reveal * .85).toFixed(3)}">${windows}</g>`;
		} else if (motion) art = movingGlyph(glyph, art, dark ? "#151824" : ink, phase, breathe);
		if (dark) art = art.replace(/"#fff"/gi, `"url(#${u}fg)"`);
		const shadow = art.replace(/"(#[0-9a-f]{3,6}|url\(#[^)]*\))"/gi, '"#000"');
		body +=
			`<g transform="translate(0 3)" opacity="${dark ? 0.45 : 0.28}"><g transform="${g}">${shadow}</g></g>` +
			`<g transform="${g}"${motion ? ` data-glyph-motion="${esc(glyph)}"` : ""}>${art}</g>`;
	}
	if (hasLabel) {
		const t = (dy, fill, op) =>
			`<text x="72" y="${131 + dy}" text-anchor="middle" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="${fs}" font-weight="700" letter-spacing="${ls}" fill="${fill}"${op ? ` opacity="${op}"` : ""}>${esc(text)}</text>`;
		body += t(1.5, "#000", 0.45) + t(0, pro ? "#E8EDF6" : "#fff");
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="144" height="144" viewBox="0 0 144 144"><defs>${defs}</defs>${body}</svg>`;
}

/** Colours of the monitor on/off key: red = the press turns it off, green = the press turns it on. */
export const TOGGLE_COLOURS = {
	off: ["#FF5A5A", "#C0122E", "#7A0A1C"], // monitor is ON → key offers TURN OFF (red)
	on: ["#34D66F", "#0B8A43", "#05532A"], // monitor is OFF → key offers TURN ON (green)
	unknown: ["#6B7280", "#2B2F38", "#1C1F26"],
};

/** An uploaded/native shortcut picture keeps its full composition, with an animated edge only. */
export function pictureKeySvg(image, motion) {
	const phase = ((motion.phase % 1) + 1) % 1;
	const glow = (1 - Math.cos(phase * Math.PI * 2)) / 2;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><image width="144" height="144" href="${esc(image)}"/><rect x="3" y="3" width="138" height="138" rx="14" fill="none" stroke="#C5EEFF" stroke-width="2" stroke-opacity="${(.16 + glow * .19).toFixed(3)}"/><rect x="3" y="3" width="138" height="138" rx="14" fill="none" stroke="#E4F7FF" stroke-width="2.5" stroke-opacity=".65" stroke-dasharray="30 522" stroke-dashoffset="${(-phase * 552).toFixed(2)}"/></svg>`;
}

/**
 * Monitor on/off key. It shows what a press will do:
 *   monitor on  → red   "TURN OFF"
 *   monitor off → green "TURN ON"
 * @param {{ n: number|string, state: "on"|"off"|"unknown"|"missing"|"unconfigured", caption?: string, motion?: {kind: string, phase: number} }} spec
 */
export function monitorKeySvg({ n, state, caption, motion }) {
	const u = "m" + (++uid).toString(36);
	const pal = state === "on" ? TOGGLE_COLOURS.off : state === "off" ? TOGGLE_COLOURS.on : TOGGLE_COLOURS.unknown;
	const [c1, c2, ink] = pal;
	const action = state === "on" ? "TURN OFF" : state === "off" ? "TURN ON" : state === "missing" ? "NOT FOUND" : state === "unconfigured" ? "SELECT" : "…";
	const top = esc(String(caption || "Monitor " + n).trim().toUpperCase().slice(0, 14));
	const topFs = Math.min(17, Math.floor(150 / Math.max(1, top.length * 0.7)));
	const screenOn = state === "on";
	const num = esc(String(n).slice(0, 2));
	const phase = motion ? ((motion.phase % 1) + 1) % 1 : 0;
	const breathe = (1 - Math.cos(phase * Math.PI * 2)) / 2;
	const edge = motion ? `<rect x="4" y="4" width="136" height="136" rx="12" fill="none" stroke="#fff" stroke-width="1.8" stroke-opacity="${(.2 + breathe * .25).toFixed(3)}" stroke-dasharray="32 512" stroke-dashoffset="${(-phase * 544).toFixed(2)}"/>` : "";
	const txt = (y, size, body, fill, extra = "") =>
		`<text x="72" y="${y}" text-anchor="middle" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="${size}" font-weight="800" fill="${fill}"${extra}>${body}</text>`;
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><defs>` +
		`<linearGradient id="${u}bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>` +
		`<radialGradient id="${u}hl" cx=".25" cy=".1" r=".95"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset=".6" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
		`</defs><rect width="144" height="144" fill="url(#${u}bg)"/><rect width="144" height="144" fill="url(#${u}hl)"/>` +
		`<circle cx="130" cy="12" r="46" fill="#fff" opacity=".10"/>` +
		edge +
		txt(27, topFs, top, "#fff", ` letter-spacing="1" opacity=".95"`) +
		// the monitor: lit (white) while on, dark outline while off
		`<rect x="36" y="38" width="72" height="48" rx="7" fill="${screenOn ? "#fff" : "#000"}" fill-opacity="${screenOn ? 1 : 0.28}" stroke="#fff" stroke-width="4"/>` +
		`<path d="M72 86v9M58 97h28" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>` +
		txt(74, 32, num, screenOn ? ink : "#fff") +
		`<rect x="14" y="106" width="116" height="30" rx="15" fill="#000" fill-opacity=".28"/>` +
		txt(128, action.length > 8 ? 17 : 20, action, "#fff", ` letter-spacing="1"`) +
		`</svg>`
	);
}

/**
 * Monochrome white glyph on transparent background (action list / category icons).
 * @param {string} glyph
 * @param {number} size output px
 */
export function monoSvg(glyph, size) {
	const draw = GLYPHS[glyph] ?? GLYPHS.rocket;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="14 8 116 108">${draw("#2D2D2D").replace(/#A8F4FF|#FFE07A|#3DDC84|#FF5470/g, "#fff")}</svg>`;
}

/** Data URI suitable for Stream Deck setImage(). */
export function svgDataUri(svg) {
	return "data:image/svg+xml;charset=utf8," + encodeURIComponent(svg);
}

/** Built-in look of every action (glyph, theme, default label). */
/** Keys whose default look is the app's / site's real icon (falls back to the neon artwork). */
/** @type {string[]} */
export const REAL_ICON_KINDS = ["app", "website"];

/** @type {Record<string, {glyph: string, theme: string, label: string, style?: "neon"|"vivid"|"real"|"pro"}>} */
export const PRESET_ICONS = {
	downloads: { glyph: "folder", theme: "gold", label: "Folders" },
	folder: { glyph: "folder", theme: "fuchsia", label: "Folder" },
	app: { glyph: "rocket", theme: "aurora", label: "Open App" },
	website: { glyph: "link", theme: "candy", label: "Website" },
	websitefolder: { glyph: "websitefolder", theme: "ocean", label: "Website", style: "vivid" },
	volup: { glyph: "volup", theme: "lime", label: "Vol Up" },
	voldown: { glyph: "voldown", theme: "sky", label: "Vol Down" },
	screenshot: { glyph: "capture", theme: "candy", label: "Screenshot" },
	showdesktop: { glyph: "desktop", theme: "ocean", label: "Show Desktop" },
	appsfolder: { glyph: "appfolder", theme: "violet", label: "Apps" },
	back: { glyph: "back", theme: "gold", label: "Back" },
	monitorcontrol: { glyph: "monitorOn", theme: "graphite", label: "Monitor Control" },
	// VS Code plugin
	"vsc-back": { glyph: "vback", theme: "slate", label: "Back" },
	"vsc-palette": { glyph: "vpalette", theme: "azure", label: "Commands" },
	"vsc-quickopen": { glyph: "vquickopen", theme: "azure", label: "Go to File" },
	"vsc-search": { glyph: "vsearch", theme: "azure", label: "Search" },
	"vsc-terminal": { glyph: "vterminal", theme: "cyan", label: "Terminal" },
	"vsc-explorer": { glyph: "vtree", theme: "azure", label: "Explorer" },
	"vsc-scm": { glyph: "vbranch", theme: "amber", label: "Git" },
	"vsc-commit": { glyph: "vcommit", theme: "amber", label: "Commit" },
	"vsc-push": { glyph: "vpush", theme: "amber", label: "Push" },
	"vsc-pull": { glyph: "vpull", theme: "amber", label: "Pull" },
	"vsc-newterm": { glyph: "vnewterm", theme: "cyan", label: "New Term" },
	"vsc-run": { glyph: "vplay", theme: "emerald", label: "Run" },
	"vsc-debug": { glyph: "vbug", theme: "crimson", label: "Debug" },
	"vsc-stop": { glyph: "vstop", theme: "crimson", label: "Stop" },
	"vsc-format": { glyph: "vformat", theme: "iris", label: "Format" },
	"vsc-saveall": { glyph: "vsave", theme: "azure", label: "Save All" },
	"vsc-sidebar": { glyph: "vsidebar", theme: "slate", label: "Sidebar" },
	"vsc-split": { glyph: "vsplit", theme: "slate", label: "Split" },
	"vsc-comment": { glyph: "vcomment", theme: "iris", label: "Comment" },
	"vsc-definition": { glyph: "vtarget", theme: "cyan", label: "Definition" },
	"vsc-rename": { glyph: "vpencil", theme: "amber", label: "Rename" },
	"vsc-problems": { glyph: "vwarning", theme: "amber", label: "Problems" },
	"vsc-zen": { glyph: "vmoon", theme: "iris", label: "Zen" },
	"vsc-close": { glyph: "vclose", theme: "slate", label: "Close" },
	"vsc-shortcut": { glyph: "vkeyboard", theme: "cyan", label: "Shortcut" },
	"vsc-command": { glyph: "vpalette", theme: "cyan", label: "Command" },
	"vsc-project": { glyph: "vproject", theme: "azure", label: "Project" },
	copy: { glyph: "copy", theme: "indigo", label: "Copy" },
	paste: { glyph: "paste", theme: "fire", label: "Paste" },
};
