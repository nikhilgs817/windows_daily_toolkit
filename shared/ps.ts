import streamDeck from "@elgato/streamdeck";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { HOST_SCRIPT } from "./host-script.js";

export type PsStatus = "ok" | "miss" | "err";
export type PsResult = { status: PsStatus; message: string };

/** Unsolicited messages from the host, e.g. { type: "fg", data: "Code" } when the foreground app changes. */
export type PsEvent = { type: string; data: string };

type Pending = { resolve: (r: PsResult) => void; timer: NodeJS.Timeout; line: string };

const log = streamDeck.logger.createScope("ps");
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s: string) => Buffer.from(s ?? "", "base64").toString("utf8");

/** Dry-run (non-Windows, or forced for tests): commands are recorded instead of executed. */
const DRY = process.platform !== "win32" || process.env.DAILYOPS_DRYRUN === "1";

/**
 * A single long-lived, hidden PowerShell process. Spawning PowerShell per key press costs ~0.5s,
 * so commands are streamed to one warm process instead; it restarts automatically if it dies.
 */
class PowerShellHost {
	#proc?: ChildProcessWithoutNullStreams;
	#buf = "";
	#seq = 0;
	#pending = new Map<string, Pending>();
	#restarts = 0;
	#listeners: ((e: PsEvent) => void)[] = [];

	onEvent(listener: (e: PsEvent) => void): void {
		this.#listeners.push(listener);
		if (DRY && process.env.DAILYOPS_DRYRUN_EVENTS && this.#listeners.length === 1) this.#pollDryEvents(process.env.DAILYOPS_DRYRUN_EVENTS);
	}

	#emit(e: PsEvent): void {
		for (const l of this.#listeners) {
			try {
				l(e);
			} catch (err) {
				log.error(`event listener failed: ${(err as Error).message}`);
			}
		}
	}

	/** Tests only: lines "type<TAB>data" appended to a file are delivered as host events. */
	#pollDryEvents(file: string): void {
		let seen = 0;
		setInterval(() => {
			if (!existsSync(file)) return;
			const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
			for (; seen < lines.length; seen++) {
				const [type, raw = ""] = lines[seen].split("\t");
				let data = raw;
				if (raw.startsWith("json:")) { try { const value = JSON.parse(raw.slice(5)); if (typeof value === "string") data = value; } catch { /* keep malformed fixture data inert */ } }
				this.#emit({ type, data });
			}
		}, 50).unref();
	}

	start(): void {
		if (DRY || this.#proc) return;
		// The full host script is too long for a command line (Windows caps it at 32K chars), so a tiny bootstrap
		// is passed with -EncodedCommand and the real script is sent as the first stdin line (base64 UTF-8).
		const compact = HOST_SCRIPT.split("\n")
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith("#") && !l.startsWith("//"))
			.join("\n");
		const bootstrap =
			"$b=[Console]::In.ReadLine(); . ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b))))";
		const encoded = Buffer.from(bootstrap, "utf16le").toString("base64");
		const proc = spawn(
			"powershell.exe",
			["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
			{ windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
		);
		proc.stdin.on("error", (e) => log.warn(`stdin: ${e.message}`));
		proc.stdin.write(Buffer.from(compact, "utf8").toString("base64") + "\n");
		proc.stdout.setEncoding("utf8");
		proc.stderr.setEncoding("utf8");
		proc.stdout.on("data", (d: string) => this.#onData(d));
		proc.stderr.on("data", (d: string) => log.warn(`stderr: ${d.trim()}`));
		proc.on("error", (err) => {
			log.error(`PowerShell failed to start: ${err.message}`);
			this.#fail(`PowerShell unavailable: ${err.message}`);
			this.#proc = undefined;
		});
		proc.on("exit", (code) => {
			log.warn(`PowerShell host exited (code ${code})`);
			if (this.#proc === proc) this.#proc = undefined;
			this.#fail("PowerShell host exited");
		});
		this.#proc = proc;
		log.info("PowerShell host started");
	}

	/** Runs a host command. Arguments are base64-encoded so any characters survive the pipe. */
	run(command: string, args: string[] = [], timeoutMs = 20_000): Promise<PsResult> {
		const id = String(++this.#seq);
		const line = [id, command, ...args.map((a) => b64(String(a ?? "")))].join("\t");

		if (DRY) return Promise.resolve(dryRun(command, args));

		if (!this.#proc) {
			if (this.#restarts++ > 20) return Promise.resolve({ status: "err", message: "PowerShell host keeps failing" });
			this.start();
		}
		return new Promise<PsResult>((resolve) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				resolve({ status: "err", message: `Timed out: ${command}` });
			}, timeoutMs);
			this.#pending.set(id, { resolve, timer, line });
			try {
				this.#proc!.stdin.write(line + "\n");
			} catch (e) {
				clearTimeout(timer);
				this.#pending.delete(id);
				resolve({ status: "err", message: `Write failed: ${(e as Error).message}` });
			}
		});
	}

	#onData(chunk: string): void {
		this.#buf += chunk;
		let nl: number;
		while ((nl = this.#buf.indexOf("\n")) >= 0) {
			const raw = this.#buf.slice(0, nl).replace(/\r$/, "");
			this.#buf = this.#buf.slice(nl + 1);
			const [id, status, msg] = raw.split("\t");
			if (id === "0") {
				this.#emit({ type: status, data: unb64(msg) });
				continue;
			}
			const p = this.#pending.get(id);
			if (!p) continue;
			clearTimeout(p.timer);
			this.#pending.delete(id);
			p.resolve({ status: (status as PsStatus) ?? "err", message: unb64(msg) });
		}
	}

	#fail(message: string): void {
		for (const [id, p] of this.#pending) {
			clearTimeout(p.timer);
			p.resolve({ status: "err", message });
			this.#pending.delete(id);
		}
	}
}

/** Simulated screens for dry-run tests (monitor on/off keys). Like many real PCs, the main display is not Windows #1 here. */
const DRY_SCREENS = [
	{ key: "\\\\?\\DISPLAY#DEL1#A", name: "DELL U2720Q", on: true, num: 2, gdiNum: 1, primary: true },
	{ key: "\\\\?\\DISPLAY#GSM2#B", name: "LG 27GL850", on: true, num: 3, gdiNum: 2, primary: false },
	{ key: "\\\\?\\DISPLAY#AUS3#C", name: "ASUS VG249", on: true, num: 4, gdiNum: 3, primary: false },
];
const DRY_NUMS = new Map(DRY_SCREENS.map((m) => [m.key, m.num]));
const DRY_SOURCES = new Map(DRY_SCREENS.map((m) => [m.key, m.gdiNum]));

/** Dry-run behaviour: log the command (and append it to DAILYOPS_DRYRUN_LOG if set). */
function dryRun(command: string, args: string[]): PsResult {
	// Never log credentials, even in tests. Fail closed when native DPAPI is unavailable.
	if (command.startsWith("secret-")) return { status: "err", message: "Password protection requires Windows DPAPI." };
	const entry = JSON.stringify({ command, args });
	log.info(`[dry-run] ${entry}`);
	if (process.env.DAILYOPS_DRYRUN_LOG) appendFileSync(process.env.DAILYOPS_DRYRUN_LOG, entry + "\n");
	switch (command) {
		case "apps":
			return {
				status: "ok",
				message: JSON.stringify([
					{ n: "Sample App", id: "Example.SampleApp" },
					{ n: "Sample Editor", id: "Example.Editor" },
					{ n: "Example Browser", id: "Example.Browser" },
					{ n: "Example Tool", id: "Example.Tool" },
				]),
			};
		case "start":
			return /missing-app/i.test(args[0] ?? "") ? { status: "miss", message: "Not in Start menu" } : { status: "ok", message: args[0] };
		case "path":
			return { status: "miss", message: `Not found: ${args[0]}` };
		case "resolve":
			return /missing-app/i.test(args[0] ?? "") ? { status: "miss", message: "not found" } : { status: "ok", message: "Dry.App!" + (args[0] ?? "").split("|")[0] };
		case "icon":
			// 2×2 opaque PNG stand-in for the real Windows icon.
			return { status: "ok", message: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP4z8DwnwEJMDIwMDAwAAAvAQQAJ8TtbQAAAABJRU5ErkJggg==" };
		case "monitors":
			return { status: "ok", message: JSON.stringify([{ n: 1, w: 2560, h: 1440, x: 0, y: 0, primary: true, win: 1 }, { n: 2, w: 1920, h: 1080, x: 2560, y: 0, primary: false, win: 2 }, { n: 3, w: 1920, h: 1080, x: -1920, y: 0, primary: false, win: 3 }]) };
		case "mlist":
			return { status: "ok", message: JSON.stringify(DRY_SCREENS) };
		case "moff":
		case "mon": {
			const m = DRY_SCREENS.find((x) => x.key === args[0]);
			if (!m) return { status: "err", message: "That screen isn't connected." };
			if (command === "moff" && m.on && DRY_SCREENS.filter((x) => x.on).length === 1) return { status: "err", message: "That is the only screen that is on." };
			const wasPrimary = m.primary;
			m.on = command === "mon";
			m.num = m.on ? DRY_NUMS.get(m.key) ?? 0 : 0;
			m.gdiNum = m.on ? DRY_SOURCES.get(m.key) ?? 0 : 0;
			if (!m.on && wasPrimary) {
				m.primary = false;
				const next = DRY_SCREENS.find((x) => x.on);
				if (next) next.primary = true;
			}
			return { status: "ok", message: m.on ? "on" : "off" };
		}
		case "shot":
			return { status: "ok", message: args[0] === "area" ? "snipping" : "C:\\Users\\you\\Pictures\\Screenshots\\Screenshot.png" };
		default:
			return { status: "ok", message: command };
	}
}

export const ps = new PowerShellHost();
