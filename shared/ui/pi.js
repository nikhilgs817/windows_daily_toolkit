/* Daily Ops — settings panel (property inspector). Plain JS, no external dependencies. */
(function () {
	"use strict";

	// Shared by every plugin in the suite. kind = the action's last UUID segment; VS Code keys are "vsc-*".
	const PLUGIN_PREFIXES = { "com.dailyops.vscode.v2.": "vsc-", "com.dailyops.v2.": "" };
	const APP_KINDS = ["app"];

	// Keys that have a "real" icon (app / site / folder icon from Windows or the web).
	const REAL_CAPABLE = APP_KINDS.concat(["website", "downloads", "folder", "vsc-project"]);
	let realIcon = { token: "", image: "", real: false, loading: false };
	let iconTimer = null;

	const LAUNCH_KINDS = APP_KINDS.concat(["downloads", "folder", "website", "vsc-project"]);
	const FOLDER_KINDS = ["folder", "downloads", "vsc-project"];
	/** Daily Ops keys that hand the deck over to a companion plugin's keys (VS Code key, or any app key set to VS Code). */
	const VSCODE_RE = /visual studio code|\bvs ?code\b|vscodium|\bcode( - insiders)?\.exe\b|Microsoft\.VisualStudioCode/i;
	const MONITOR_KINDS = ["monitorcontrol"];
	let motionTimer = null;
	let screenList = null; // [{ key, name, on, num, primary }]

	/** Which companion's keys this key switches to (or "" for none). */
	function handoffName() {
		if (!APP_KINDS.includes(kind)) return "";
		const chosen = [settings.appName, settings.appId, settings.target].filter(Boolean).join(" ");
		if (chosen) {
			if (VSCODE_RE.test(chosen)) return "VS Code";
			for (const [pattern, name] of [[/chatgpt|OpenAI\.(ChatGPT|Codex)/i, "ChatGPT"], [/\bclaude\b/i, "Claude"], [/thinkorswim/i, "thinkorswim"], [/Fidelity Trader\+|68D72461-B3DB-4FE2-AE47-50EF0FD7254F/i, "Fidelity Trader+"]]) if (pattern.test(chosen)) return name;
		}
		return "";
	}
	let globalSettings = {};

	let ws = null;
	let piUuid = "";
	let actionUuid = "";
	let kind = "";
	let settings = {};
	let apps = []; // [{ n: name, id: AppID }]
	let pendingConnect = null;
	let domReady = false;
	let credentialDirty = false;
	let passwordDirty = false;
	let credentialPending = null;
	let credentialTimer = null;
	let passwordTimer = null;

	const $ = (id) => document.getElementById(id);
	const I = () => window.DailyOpsIcons;

	/* ------------------------------------------------------------ Stream Deck connection */

	window.connectElgatoStreamDeckSocket = function (port, uuid, registerEvent, info, actionInfo) {
		pendingConnect = { port, uuid, registerEvent, actionInfo };
		if (domReady) connect();
	};

	document.addEventListener("DOMContentLoaded", () => {
		domReady = true;
		if (pendingConnect) connect();
	});

	function connect() {
		const { port, uuid, registerEvent, actionInfo } = pendingConnect;
		pendingConnect = null;
		piUuid = uuid;
		const ai = typeof actionInfo === "string" ? JSON.parse(actionInfo) : actionInfo;
		actionUuid = ai.action;
		kind = actionUuid;
		for (const [prefix, tag] of Object.entries(PLUGIN_PREFIXES)) {
			if (actionUuid.startsWith(prefix)) { kind = tag + actionUuid.slice(prefix.length); break; }
		}
		settings = (ai.payload && ai.payload.settings) || {};
		if (window.DailyOpsCompanion && actionUuid.startsWith(window.DailyOpsCompanion.uuid + ".")) kind = "comp-" + actionUuid.slice(window.DailyOpsCompanion.uuid.length + 1);

		ws = new WebSocket("ws://127.0.0.1:" + port);
		ws.onopen = () => {
			ws.send(JSON.stringify({ event: registerEvent, uuid: piUuid }));
			if (APP_KINDS.includes(kind)) requestApps();
			if (MONITOR_KINDS.includes(kind)) sendToPlugin({ event: "getScreens" });
			if (LAUNCH_KINDS.includes(kind) || kind === "vsc-back" || window.DailyOpsCompanion) ws.send(JSON.stringify({ event: "getGlobalSettings", context: piUuid }));
		};
		ws.onmessage = (e) => {
			let m;
			try { m = JSON.parse(e.data); } catch { return; }
			if (m.event === "didReceiveSettings" && m.payload) {
				settings = m.payload.settings || {};
				fill();
			} else if (m.event === "didReceiveGlobalSettings" && m.payload) {
				globalSettings = m.payload.settings || {};
				$("monitorOrder").value = globalSettings.monitorOrder === "left" || globalSettings.monitorOrder === "primary" ? globalSettings.monitorOrder : "windows";
				$("autoFollow").checked = globalSettings.autoFollow !== false;
				$("companionFollow").checked = globalSettings.autoFollow !== false;
				$("returnOnClose").checked = globalSettings.returnOnClose !== false;
				if (LAUNCH_KINDS.includes(kind)) requestMonitors();
			} else if (m.event === "sendToPropertyInspector" && m.payload) {
				onPluginMessage(m.payload);
			}
		};
		build();
		fill();
	}

	function save() {
		if (ws && ws.readyState === 1) ws.send(JSON.stringify({ event: "setSettings", context: piUuid, payload: settings }));
		renderLook();
	}

	function sendToPlugin(payload) {
		if (ws && ws.readyState === 1) ws.send(JSON.stringify({ event: "sendToPlugin", action: actionUuid, context: piUuid, payload }));
	}

	function set(key, value) {
		if (value === "" || value === undefined || value === null) delete settings[key];
		else settings[key] = value;
	}

	/* ------------------------------------------------------------ credentials */

	function credentialStatus(message, error = false) {
		$("credentialStatus").textContent = message;
		$("credentialStatus").className = "hint pad" + (error ? " err" : "");
	}
	function credentialBinding() { return settings.appId ? "appid:" + settings.appId : settings.target?.trim() ? "target:" + settings.target.trim() : ""; }
	function forgetCredentials() {
		credentialPending = null; clearTimeout(credentialTimer); credentialBusy(false);
		for (const key of ["credentialUsername", "credentialPassword", "credentialAutofill", "credentialApp"]) delete settings[key];
		credentialDirty = passwordDirty = false; hidePassword();
		credentialStatus("App changed. Enter credentials for this app if needed.");
	}
	function credentialBusy(busy) {
		for (const id of ["credentialUsername", "credentialPassword", "credentialAutofill", "saveCredentials", "clearCredentials", "passwordEye"]) $(id).disabled = busy;
	}
	function hidePassword() {
		clearTimeout(passwordTimer);
		$("credentialPassword").type = "password";
		if (!passwordDirty) $("credentialPassword").value = "";
		$("passwordEye").setAttribute("aria-pressed", "false");
		$("passwordEye").setAttribute("aria-label", "Show password");
		$("passwordEye").title = "Show password";
		$("passwordEyeSlash").setAttribute("hidden", "");
	}
	function showPassword() {
		$("credentialPassword").type = "text";
		$("passwordEye").setAttribute("aria-pressed", "true");
		$("passwordEye").setAttribute("aria-label", "Hide password");
		$("passwordEye").title = "Hide password";
		$("passwordEyeSlash").removeAttribute("hidden");
		clearTimeout(passwordTimer);
		passwordTimer = setTimeout(hidePassword, 20000);
	}
	function requestCredentials(op) {
		if (credentialPending || !ws || ws.readyState !== 1) return;
		if (!credentialBinding()) { credentialStatus("Choose an app before saving credentials.", true); return; }
		credentialPending = { requestId: piUuid + ":" + Date.now() + ":" + Math.random(), op, username: $("credentialUsername").value, autofill: $("credentialAutofill").checked, binding: credentialBinding() };
		credentialBusy(true);
		credentialStatus(op === "reveal" ? "Opening saved password…" : "Encrypting password…");
		sendToPlugin({ event: op === "reveal" ? "revealPassword" : "protectPassword", requestId: credentialPending.requestId, binding: credentialPending.binding, ...(op === "protect" ? { password: $("credentialPassword").value } : {}) });
		credentialTimer = setTimeout(() => { credentialPending = null; credentialBusy(false); credentialStatus("Could not reach password protection. Your saved credentials were not changed.", true); }, 15000);
	}
	function receiveCredentials(p) {
		if (!credentialPending || p.requestId !== credentialPending.requestId) return;
		const pending = credentialPending;
		credentialPending = null;
		clearTimeout(credentialTimer);
		credentialBusy(false);
		if (pending.binding !== credentialBinding()) { hidePassword(); credentialStatus("App changed. Save credentials for this app again.", true); return; }
		if (!p.ok) { hidePassword(); credentialStatus(p.error || "Could not open password protection.", true); return; }
		if (pending.op === "protect") {
			if (typeof p.protectedPassword !== "string" || !/^dpapi:v1:[A-Za-z0-9+/]+=*$/.test(p.protectedPassword)) { credentialStatus("Password protection failed. Nothing was saved.", true); return; }
			set("credentialPassword", p.protectedPassword);
			set("credentialUsername", pending.username);
			set("credentialApp", pending.binding);
			settings.credentialAutofill = pending.autofill;
			credentialDirty = passwordDirty = false;
			hidePassword(); save(); fill();
			credentialStatus("Saved. Password encrypted for your Windows user account.");
		} else if (typeof p.password === "string" && !document.hidden && document.hasFocus()) {
			$("credentialPassword").value = p.password;
			showPassword();
			credentialStatus("Password is visible. It hides after 20 seconds or when you leave this window.");
		}
	}
	function buildCredentials() {
		$("credentialUsername").addEventListener("input", () => { credentialDirty = true; credentialStatus("Unsaved changes. Choose Save credentials."); });
		$("credentialPassword").addEventListener("input", () => { credentialDirty = passwordDirty = true; credentialStatus("Unsaved changes. Choose Save credentials."); });
		$("credentialAutofill").addEventListener("change", () => { settings.credentialAutofill = $("credentialAutofill").checked; save(); });
		$("saveCredentials").addEventListener("click", () => {
			if (!credentialBinding()) { credentialStatus("Choose an app before saving credentials.", true); return; }
			if (passwordDirty && $("credentialPassword").value) { requestCredentials("protect"); return; }
			if (passwordDirty) set("credentialPassword");
			set("credentialUsername", $("credentialUsername").value);
			settings.credentialAutofill = $("credentialAutofill").checked;
			credentialDirty = passwordDirty = false;
			hidePassword(); save(); fill();
			credentialStatus(settings.credentialPassword ? "Saved. Password encrypted for your Windows user account." : "Username saved. No password stored.");
		});
		$("clearCredentials").addEventListener("click", () => {
			for (const key of ["credentialUsername", "credentialPassword", "credentialAutofill", "credentialApp"]) delete settings[key];
			credentialDirty = passwordDirty = false;
			hidePassword(); save(); fill(); credentialStatus("Saved credentials cleared.");
		});
		$("passwordEye").addEventListener("click", () => {
			if ($("credentialPassword").type === "text") { hidePassword(); return; }
			if (passwordDirty && $("credentialPassword").value) showPassword();
			else if (settings.credentialPassword) requestCredentials("reveal");
		});
		window.addEventListener("blur", () => {
			hidePassword();
			if (credentialPending?.op === "reveal") { credentialPending = null; clearTimeout(credentialTimer); credentialBusy(false); }
		});
		window.addEventListener("pagehide", () => { $("credentialPassword").value = ""; hidePassword(); });
	}

	/* ------------------------------------------------------------ apps */

	function requestApps() {
		$("appStatus").className = "hint";
		$("appStatus").textContent = "Loading installed apps…";
		sendToPlugin({ event: "getApps" });
	}

	function requestMonitors() {
		sendToPlugin({ event: "getMonitors", order: $("monitorOrder").value });
	}

	function renderMonitors(p) {
		const box = $("monitorList");
		box.innerHTML = "";
		if (!p.ok || !Array.isArray(p.list) || !p.list.length) {
			box.innerHTML = '<span class="hint">Couldn\'t detect monitors.</span>';
			return;
		}
		const maxW = Math.max.apply(null, p.list.map((m) => m.w));
		for (const m of p.list) {
			const d = document.createElement("div");
			d.className = "mon" + (m.primary ? " primary" : "");
			const w = Math.round(40 + (m.w / maxW) * 44);
			d.style.width = w + "px";
			d.style.height = Math.round(w * (m.h / m.w)) + "px";
			d.title = m.w + "×" + m.h + (m.primary ? " (main display)" : "");
			d.innerHTML = "<b>" + m.n + "</b>" + m.w + "×" + m.h;
			box.appendChild(d);
		}
	}

	function onPluginMessage(p) {
		if (p.event === "credentials") { receiveCredentials(p); return; }
		if (p.event === "autofillResult" && kind === "app") { credentialStatus(p.message || "Autofill finished.", !p.ok); return; }
		if (p.event === "screens") {
			screenList = Array.isArray(p.list) ? p.list : [];
			renderScreens();
			renderLook();
			return;
		}
		if (p.event === "monitors") {
			renderMonitors(p);
			return;
		}
		if (p.event === "icon") {
			if (MONITOR_KINDS.includes(kind)) return;
			if (p.token === JSON.stringify(settings)) {
				realIcon = { token: p.token, image: p.image || "", sourceImage: p.sourceImage || "", real: !!p.real, loading: false };
				renderLook();
			}
			return;
		}
		if (p.event !== "apps") return;
		apps = Array.isArray(p.apps) ? p.apps.filter((a) => a && a.n && a.id) : [];
		const dl = $("appList");
		dl.innerHTML = "";
		const seen = new Set();
		for (const a of apps) {
			if (seen.has(a.n)) continue;
			seen.add(a.n);
			const o = document.createElement("option");
			o.value = a.n;
			dl.appendChild(o);
		}
		const st = $("appStatus");
		if (p.ok) {
			st.className = "hint";
			st.textContent = apps.length + " apps found. Type to search.";
		} else {
			st.className = "hint err";
			st.textContent = "Couldn't read the app list (" + (p.error || "unknown error") + "). Use Advanced to enter a path.";
		}
	}

	function chooseApp(name) {
		const hit = apps.find((a) => a.n === name) || apps.find((a) => a.n.toLowerCase() === name.toLowerCase());
		if (!hit) return false;
		if (settings.appId !== hit.id) forgetCredentials();
		set("appId", hit.id);
		set("appName", hit.n);
		save();
		fill();
		return true;
	}

	/* ------------------------------------------------------------ build UI */

	function build() {
		const show = (id, on) => ($(id).hidden = !on);
		const companion = window.DailyOpsCompanion;
		const definition = companion?.commands?.find((c) => "comp-" + c.id === kind);
		show("sec-companion", !!definition);
		if (definition) {
			$("companionTitle").textContent = companion.name;
			$("companionDescription").textContent = definition.description;
			$("companionShortcutRow").hidden = definition.id === "back" || definition.id === "focus";
			$("companionShortcutHint").hidden = definition.id === "back" || definition.id === "focus";
			$("companionShortcut").placeholder = definition.shortcut || "Use the built-in control";
			$("companionBack").hidden = definition.id !== "back";
			$("companionFollowRow").hidden = definition.id !== "back";
			$("companionFollow").addEventListener("change", () => { globalSettings.autoFollow = $("companionFollow").checked; if (ws && ws.readyState === 1) ws.send(JSON.stringify({event:"setGlobalSettings",context:piUuid,payload:globalSettings})); });
			$("companionShow").addEventListener("click", () => sendToPlugin({event:"companionShow"}));
			$("companionBack").addEventListener("click", () => sendToPlugin({event:"companionBack"}));
			let shortcutTimer;
			$("companionShortcut").addEventListener("input", () => { clearTimeout(shortcutTimer); shortcutTimer = setTimeout(() => { set("shortcut", $("companionShortcut").value.trim()); save(); }, 350); });
		}
		const isApp = APP_KINDS.includes(kind);
		show("sec-app", isApp);
		show("sec-credentials", kind === "app");
		if (kind === "app") buildCredentials();
		show("sec-folder", FOLDER_KINDS.includes(kind));
		show("folderNameRow", kind === "folder" || kind === "downloads");
		$("folderNameLabel").addEventListener("change", () => { settings.folderNameLabel = $("folderNameLabel").checked; save(); fill(); });
		show("sec-handoff", !!handoffName());
		show("sec-shot", kind === "screenshot");
		show("sec-desktop", kind === "showdesktop");
		show("motionRow", true);
		$("animate").addEventListener("change", () => { settings.animate = $("animate").checked; save(); });
		show("sec-screen", MONITOR_KINDS.includes(kind));
		show("sec-apps", kind === "appsfolder");
		show("sec-websites", kind === "websitefolder");
		$("openWebsites").addEventListener("click", () => sendToPlugin({ event: "openWebsites" }));
		$("returnMain").addEventListener("click", () => sendToPlugin({ event: "returnMain" }));
		show("sec-navback", kind === "back");
		const monitorKey = MONITOR_KINDS.includes(kind);
		show("styleRow", !monitorKey);
		show("pictureRow", !monitorKey);
		show("artPickers", !monitorKey);
		if (kind === "screenshot") {
			$("shotHold").addEventListener("change", () => { set("holdSeconds", $("shotHold").value); save(); fill(); });
			let st;
			$("shotFolder").addEventListener("input", () => { clearTimeout(st); st = setTimeout(() => { set("shotFolder", $("shotFolder").value.trim()); save(); }, 350); });
			$("shotSave").addEventListener("change", () => { settings.shotSave = $("shotSave").checked; save(); });
			$("shotClipboard").addEventListener("change", () => { settings.shotClipboard = $("shotClipboard").checked; save(); });
		}
		if (monitorKey) {
			$("screenPick").addEventListener("change", () => {
				const v = $("screenPick").value;
				const hit = (screenList || []).find((x) => x.key === v);
				set("screenKey", v);
				set("screenName", hit ? hit.name : "");
				set("screenNumber", hit && hit.num ? hit.num : undefined);
				save();
				fill();
			});
			$("screenRefresh").addEventListener("click", () => { $("screenStatus").textContent = "Looking for screens…"; sendToPlugin({ event: "getScreens" }); });
			$("sleep").addEventListener("change", () => { settings.sleep = $("sleep").checked; save(); });
		}
		show("sec-shortcut", kind === "vsc-shortcut");
		show("sec-command", kind === "vsc-command");
		show("sec-back", kind === "vsc-back");
		show("sec-vscinfo", kind.startsWith("vsc-") && !["vsc-shortcut", "vsc-command", "vsc-back", "vsc-project"].includes(kind));
		if (handoffName()) $("handoffName").textContent = handoffName();
		if (kind === "vsc-project") { $("folderTitle").textContent = "Project"; $("folderPath").placeholder = "C:\\Users\\you\\source\\my-project"; }
		const saveGlobal = () => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ event: "setGlobalSettings", context: piUuid, payload: globalSettings })); };
		$("autoFollow").addEventListener("change", () => { globalSettings.autoFollow = $("autoFollow").checked; saveGlobal(); });
		$("returnOnClose").addEventListener("change", () => { globalSettings.returnOnClose = $("returnOnClose").checked; saveGlobal(); });
		$("showKeys").addEventListener("change", () => { settings.showKeys = $("showKeys").checked; save(); });
		show("sec-website", kind === "website");
		show("sec-volume", kind === "volup" || kind === "voldown");
		show("sec-display", kind === "displayon" || kind === "displayoff");
		show("sec-keys", kind === "copy" || kind === "paste");
		show("sec-monitor", LAUNCH_KINDS.includes(kind));
		$("gestures").addEventListener("change", () => { settings.gestures = $("gestures").checked; save(); fill(); });
		$("holdSeconds").addEventListener("change", () => { set("holdSeconds", $("holdSeconds").value); save(); fill(); });
		$("monitorOrder").addEventListener("change", () => {
			globalSettings.monitorOrder = $("monitorOrder").value;
			if (ws && ws.readyState === 1) ws.send(JSON.stringify({ event: "setGlobalSettings", context: piUuid, payload: globalSettings }));
			requestMonitors();
		});

		if (kind === "copy") $("keysHint").textContent = "Sends Ctrl+C to whichever window is active.";
		if (kind === "paste") $("keysHint").textContent = "Sends Ctrl+V to whichever window is active.";

		const mode = $("mode");
		const modes =
			kind === "displayon"
				? [["extend", "Extend desktop (default)"], ["clone", "Duplicate screens"]]
				: [["internal", "PC screen only (default)"], ["external", "Second screen only"]];
		mode.innerHTML = modes.map(([v, t]) => '<option value="' + v + '">' + t + "</option>").join("");

		// App picker
		const search = $("appSearch");
		search.addEventListener("change", () => {
			const v = search.value.trim();
			if (!v) return;
			if (!chooseApp(v)) {
				$("appStatus").className = "hint err";
				$("appStatus").textContent = '"' + v + '" isn\'t in the list. Pick a suggestion, or use Advanced.';
			}
		});
		search.addEventListener("input", () => {
			// Selecting a datalist suggestion fires "input" with the exact name.
			const v = search.value;
			if (apps.some((a) => a.n === v)) chooseApp(v);
		});
		$("appRefresh").addEventListener("click", requestApps);
		$("appClear").addEventListener("click", () => {
			if (kind === "app") forgetCredentials();
			set("appId");
			set("appName");
			search.value = "";
			save();
			fill();
		});

		// Plain fields (id === settings key)
		const text = ["target", "args", "folderPath", "url", "iconLabel", "shortcut", "command"];
		for (const id of text) {
			let t;
			$(id).addEventListener("input", () => {
				clearTimeout(t);
				t = setTimeout(() => {
					const oldBinding = credentialBinding();
					set(id, $(id).value.trim());
					if (id === "target" && settings.target) { set("appId"); set("appName"); fill(); }
					if (kind === "app" && oldBinding !== credentialBinding()) { forgetCredentials(); fill(); }
					save();
				}, 350);
			});
		}
		for (const id of ["browser", "step", "mode"]) {
			$(id).addEventListener("change", () => { set(id, $(id).value); save(); });
		}
		$("repeat").addEventListener("change", () => { settings.repeat = $("repeat").checked; save(); });
		$("hideLabel").addEventListener("change", () => { set("hideLabel", $("hideLabel").checked || undefined); save(); });

		// Look
		const realCapable = REAL_CAPABLE.includes(kind);
		$("styleReal").hidden = !realCapable;
		$("stylePro").hidden = kind.indexOf("vsc-") !== 0 && !window.DailyOpsCompanion;
		$("styleReal").textContent = kind === "folder" || kind === "downloads" ? "Folder icon" : kind === "website" ? "Site icon" : "App icon";
		for (const b of document.querySelectorAll("#styleSeg button")) {
			b.addEventListener("click", () => {
				set("iconStyle", b.dataset.style);
				set("iconImage");
				save();
				fill();
			});
		}
		$("refreshIcon").addEventListener("click", () => {
			realIcon = { token: "", image: "", real: false, loading: true };
			renderLook();
			sendToPlugin({ event: "refreshIcon", settings });
		});
		$("resetLook").addEventListener("click", () => {
			for (const k of ["iconStyle", "iconGlyph", "iconTheme", "iconLabel", "hideLabel", "iconImage", "animate"]) delete settings[k];
			save();
			fill();
		});
		$("pickImage").addEventListener("click", () => $("imageFile").click());
		$("removeImage").addEventListener("click", () => { set("iconImage"); save(); fill(); });
		$("imageFile").addEventListener("change", onImageFile);
		buildPickers();
	}

	function buildPickers() {
		const lib = I();
		const preset = lib.PRESET_ICONS[kind] || lib.PRESET_ICONS.app;
		const themes = $("themes");
		themes.innerHTML = "";
		for (const [name, c] of Object.entries(lib.THEMES)) {
			const b = document.createElement("button");
			b.className = "swatch";
			b.title = name;
			b.dataset.theme = name;
			b.style.background = "linear-gradient(135deg," + c[0] + "," + c[1] + ")";
			b.addEventListener("click", () => {
				set("iconTheme", name);
				set("iconImage");
				save();
				fill();
			});
			themes.appendChild(b);
		}
		const glyphs = $("glyphs");
		glyphs.innerHTML = "";
		const list = [preset.glyph].concat(lib.PICKABLE.filter((g) => g !== preset.glyph));
		for (const g of list) {
			const b = document.createElement("button");
			b.className = "glyph";
			b.title = g;
			b.dataset.glyph = g;
			b.addEventListener("click", () => {
				set("iconGlyph", g);
				if (currentStyle() === "real") set("iconStyle", "neon");
				set("iconImage");
				save();
				fill();
			});
			glyphs.appendChild(b);
		}
	}

	/* ------------------------------------------------------------ fill from settings */

	function fill() {
		if (!domReady || !kind) return;
		const s = settings;
		const setVal = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v == null ? "" : v; };
		setVal("target", s.target);
		setVal("args", s.args);
		setVal("folderPath", s.folderPath);
		$("folderNameLabel").checked = kind === "folder" ? s.folderNameLabel !== false : s.folderNameLabel === true;
		setVal("url", s.url);
		setVal("iconLabel", s.iconLabel);
		setVal("shortcut", s.shortcut);
		setVal("companionShortcut", s.shortcut);
		setVal("command", s.command);
		if (kind === "app") {
			if (!credentialDirty) setVal("credentialUsername", s.credentialUsername);
			$("credentialPassword").placeholder = s.credentialPassword ? "••••••••" : "Enter a password";
			$("credentialAutofill").checked = s.credentialAutofill !== false;
			$("clearCredentials").hidden = !s.credentialUsername && !s.credentialPassword;
		}
		$("showKeys").checked = s.showKeys !== false;
		$("browser").value = s.browser || "default";
		$("step").value = String(s.step || 6);
		$("repeat").checked = s.repeat !== false;
		$("mode").value = s.mode || $("mode").options[0].value;
		$("hideLabel").checked = !!s.hideLabel;
		$("gestures").checked = s.gestures !== false;
		$("holdSeconds").value = String(s.holdSeconds || 3);
		$("holdSeconds").disabled = s.gestures === false;
		$("holdLabel").textContent = String(s.holdSeconds || 3) + " s";

		if (APP_KINDS.includes(kind)) {
			const chosen = !!s.appName;
			$("appChosenRow").hidden = !chosen;
			$("appChosen").textContent = s.appName || "";
			$("appClear").textContent = "Clear";
			if (s.target) $("appAdvanced").open = true;
		}
		if (kind === "screenshot") {
			setVal("shotFolder", s.shotFolder);
			$("shotSave").checked = s.shotSave !== false;
			$("shotClipboard").checked = s.shotClipboard !== false;
			$("shotHold").value = String(s.holdSeconds || 1);
			$("shotHoldLabel").textContent = String(s.holdSeconds || 1) + " s";
		}
		if (MONITOR_KINDS.includes(kind)) {
			$("sleep").checked = s.sleep !== false;
			renderScreens();
		}
		$("sec-handoff").hidden = !handoffName();
		if (handoffName()) $("handoffName").textContent = handoffName();
		$("removeImage").hidden = !s.iconImage;
		$("animate").checked = s.animate !== false;
		$("iconLabel").placeholder = defaultLabel();
		renderLook();
	}

	/* ------------------------------------------------------------ monitor on / off */

	function monitorN() {
		const screen = (screenList || []).find((x) => x.key === settings.screenKey);
		return (screen && screen.num) || settings.screenNumber || "?";
	}

	function renderScreens() {
		if (!MONITOR_KINDS.includes(kind)) return;
		const sel = $("screenPick");
		const list = screenList || [];
		const opts = [["", "Choose a monitor…", false]];
		for (const x of list) {
			const label = (x.num ? "Monitor " + x.num + " · " : "") + (x.name || "Screen") + (x.primary ? " (main display)" : "") + " — " + (x.on ? "on" : "off");
			opts.push([x.key, label, false]);
		}
		if (settings.screenKey && !list.some((x) => x.key === settings.screenKey)) opts.push([settings.screenKey, (settings.screenName || "Chosen screen") + " — not connected"]);
		sel.innerHTML = "";
		for (const [v, t, disabled] of opts) {
			const o = document.createElement("option");
			o.value = v;
			o.textContent = t;
			o.disabled = !!disabled;
			sel.appendChild(o);
		}
		sel.value = settings.screenKey || "";
		const st = $("screenStatus");
		st.className = "hint";
		if (screenList === null) { st.textContent = "Looking for screens…"; return; }
		if (!settings.screenKey) { st.textContent = "Choose the monitor this key should turn off and on. Add another Monitor Control key to control a different screen."; return; }
		const target = list.find((x) => x.key === settings.screenKey);
		if (!target) { st.className = "hint err"; st.textContent = "The selected monitor isn't connected. Check its cable, or choose a monitor above."; return; }
		st.textContent = (target.name || "This screen") + " is " + (target.on ? "on — the key shows red TURN OFF." : "off — the key shows green TURN ON.");
		if (target.primary) st.textContent += " When turned off, another active screen becomes the main display.";
	}

	/* ------------------------------------------------------------ look / preview (mirrors the plugin) */

	function dynamicLabel() {
		const s = settings;
		if (APP_KINDS.includes(kind)) {
			if (s.appName) return s.appName;
			if (kind === "app" && s.target) return s.target.trim().split(/[\\/]/).pop().replace(/\.(exe|lnk|bat|cmd)$/i, "");
		}
		if (kind === "vsc-shortcut" && s.shortcut) return s.shortcut.trim();
		if (kind === "vsc-command" && s.command) return s.command.trim().replace(/^.*?:\s*/, "");
		if ((kind === "folder" && s.folderNameLabel !== false || kind === "downloads" && s.folderNameLabel === true || kind === "vsc-project") && s.folderPath) {
			const p = s.folderPath.trim().replace(/[\\/]+$/, "");
			return (p.split(/[\\/]/).pop() || p).replace(/%/g, "");
		}
		if (kind === "downloads" && s.folderNameLabel === true && s.folderEmptyLabel) return s.folderEmptyLabel;
		if (kind === "website" && s.url) {
			try { return new URL(/^[a-z]+:/i.test(s.url) ? s.url : "https://" + s.url).hostname.replace(/^www\./, "").split(".")[0]; } catch { return ""; }
		}
		return "";
	}

	function defaultLabel() {
		const p = I().PRESET_ICONS[kind];
		return dynamicLabel() || (p ? p.label : "");
	}

	function currentStyle() {
		const st = settings.iconStyle;
		if (st === "real" || st === "neon" || st === "vivid" || st === "pro") return st === "real" && !REAL_CAPABLE.includes(kind) ? "neon" : st;
		return I().PRESET_ICONS[kind]?.style || (["app", "website"].includes(kind) ? "real" : kind.indexOf("vsc-") === 0 ? "pro" : "neon");
	}

	function currentLook() {
		const lib = I();
		const p = lib.PRESET_ICONS[kind] || lib.PRESET_ICONS.app;
		const s = settings;
		return {
			glyph: s.iconGlyph || p.glyph,
			theme: s.iconTheme || p.theme,
			label: s.hideLabel ? "" : (s.iconLabel && s.iconLabel.trim()) || defaultLabel(),
			style: currentStyle(),
		};
	}

	function renderLook() {
		const lib = I();
		const look = currentLook();
		const prev = $("preview");
		const usingImage = !!(settings.iconImage && String(settings.iconImage).startsWith("data:image/"));
		const hint = $("styleHint");
		hint.className = "hint";
		hint.textContent = "";
		$("refreshIcon").hidden = usingImage || look.style !== "real";
		if (settings.animate !== false && !motionTimer) motionTimer = setInterval(() => {
			if (!document.hidden) drawPreview();
		}, 1000 / 12);
		if (settings.animate === false && motionTimer) { clearInterval(motionTimer); motionTimer = null; }

		if (MONITOR_KINDS.includes(kind)) {
			drawPreview();
			$("refreshIcon").hidden = true;
			return;
		}
		if (usingImage) {
			drawPreview();
			hint.textContent = "Using your picture. Pick a style to switch back.";
		} else if (look.style === "real") {
			const token = JSON.stringify(settings);
			if (realIcon.token === token && realIcon.image) {
				drawPreview();
				if (!realIcon.real) hint.textContent = "No icon found for this app, so it shows the colourful artwork instead.";
			} else {
				prev.innerHTML = lib.keySvg(Object.assign({}, look, { style: "neon" }));
				hint.textContent = "Fetching the icon…";
				clearTimeout(iconTimer);
				iconTimer = setTimeout(() => sendToPlugin({ event: "getIcon", settings }), 250);
			}
		} else {
			drawPreview();
		}

		for (const b of document.querySelectorAll("#styleSeg button")) b.classList.toggle("on", !usingImage && b.dataset.style === look.style);
		const gridStyle = look.style === "vivid" ? "vivid" : "neon";
		for (const b of document.querySelectorAll(".swatch")) b.classList.toggle("on", !usingImage && b.dataset.theme === look.theme);
		for (const b of document.querySelectorAll(".glyph")) {
			b.classList.toggle("on", !usingImage && look.style !== "real" && b.dataset.glyph === look.glyph);
			const key = look.theme + "/" + gridStyle + "/" + b.dataset.glyph;
			if (b.dataset.rendered !== key) {
				b.innerHTML = lib.keySvg({ glyph: b.dataset.glyph, theme: look.theme, label: "", style: gridStyle });
				b.dataset.rendered = key;
			}
		}
	}

	function animatedLook(look) {
		return settings.animate !== false
			? Object.assign({}, look, { motion: { kind, phase: (Date.now() % 6000) / 6000 } }) : look;
	}

	function drawPreview() {
		const lib = I(), look = currentLook(), motion = animatedLook(look).motion;
		const preview = $("preview");
		if (MONITOR_KINDS.includes(kind)) {
			const selected = screenList && screenList.find((screen) => screen.key === settings.screenKey);
			const state = !settings.screenKey ? "unconfigured" : !screenList ? "unknown" : !selected ? "missing" : selected.on ? "on" : "off";
			preview.innerHTML = lib.monitorKeySvg({ n: monitorN(), state, motion, caption: settings.hideLabel ? " " : (settings.iconLabel || "").trim() || (settings.screenKey ? "Monitor " + monitorN() : "Monitor Control") });
		} else if (settings.iconImage) {
			preview.innerHTML = motion ? lib.pictureKeySvg(settings.iconImage, motion) : '<img src="' + settings.iconImage.replace(/"/g, "&quot;") + '">';
		} else if (look.style === "real") {
			if (realIcon.token === JSON.stringify(settings) && realIcon.real && realIcon.sourceImage) preview.innerHTML = lib.keySvg(Object.assign({}, animatedLook(look), { image: realIcon.sourceImage }));
			else preview.innerHTML = lib.keySvg(animatedLook(Object.assign({}, look, { style: "neon" })));
		} else preview.innerHTML = lib.keySvg(animatedLook(look));
	}

	/* ------------------------------------------------------------ custom picture */

	function onImageFile(e) {
		const file = e.target.files && e.target.files[0];
		e.target.value = "";
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			const img = new Image();
			img.onload = () => {
				// Cover-crop to a 144×144 PNG so settings stay small.
				const c = document.createElement("canvas");
				c.width = c.height = 144;
				const ctx = c.getContext("2d");
				const scale = Math.max(144 / img.width, 144 / img.height);
				const w = img.width * scale, h = img.height * scale;
				ctx.drawImage(img, (144 - w) / 2, (144 - h) / 2, w, h);
				try {
					set("iconImage", c.toDataURL("image/png"));
					save();
					fill();
				} catch (err) {
					alertHint("Couldn't use that picture: " + err.message);
				}
			};
			img.onerror = () => alertHint("That file isn't a picture Stream Deck can show. Try PNG or JPG.");
			img.src = reader.result;
		};
		reader.readAsDataURL(file);
	}

	function alertHint(msg) {
		const h = document.createElement("div");
		h.className = "hint err";
		h.textContent = msg;
		$("sec-look").appendChild(h);
		setTimeout(() => h.remove(), 6000);
	}
})();
