import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, createConnection, type Socket, type Server } from "node:net";

export function companionPipe(): string {
	if (process.env.DAILYOPS_COMPANION_PIPE) return process.env.DAILYOPS_COMPANION_PIPE;
	const user = createHash("sha256").update(homedir()).digest("hex").slice(0, 16);
	return process.platform === "win32" ? `\\\\.\\pipe\\windows-daily-toolkit-${user}-v1` : join(tmpdir(), `windows-daily-toolkit-${user}-v1.sock`);
}

type Message = Record<string, unknown>;
function send(socket: Socket, message: Message): void { if (!socket.destroyed) socket.write(JSON.stringify(message) + "\n"); }
function messages(socket: Socket, receive: (message: Message) => void): void {
	let buffer = "";
	socket.setEncoding("utf8");
	socket.on("data", (chunk: string) => {
		buffer += chunk;
		if (buffer.length > 65536) { socket.destroy(); return; }
		let at;
		while ((at = buffer.indexOf("\n")) >= 0) {
			const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
			try { const m = JSON.parse(line); if (m && typeof m === "object" && !Array.isArray(m)) receive(m); } catch { socket.destroy(); }
		}
	});
}
type Peer = { uuid: string; socket: Socket; enabled: boolean };
type Pending = { socket: Socket; resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
export type RoutingOptions = {
	allowed: string[];
	devices: () => string[];
	beforeShow?: (device: string) => Promise<void>;
	recover?: (device: string) => Promise<void>;
	onError?: (error: Error) => void;
	pipe?: string;
};

/** One authority serializes restore → show across plugin processes, avoiding nested return profiles. */
export class CompanionRouter {
	readonly peers = new Map<string, Peer>();
	readonly active = new Map<string, string>();
	readonly suppressed = new Map<string, string>();
	#queues = new Map<string, Promise<void>>();
	#pending = new Map<number, Pending>();
	#sequence = 0;
	#server?: Server;
	#focus?: string;
	#closed = false;
	constructor(readonly options: RoutingOptions) {}

	start(): void {
		const server = this.#server = createServer((socket) => {
			let peer: Peer | undefined;
			messages(socket, (m) => {
				if (m.type === "register" && typeof m.uuid === "string" && this.options.allowed.includes(m.uuid)) {
					this.peers.get(m.uuid)?.socket.destroy();
					peer = { uuid: m.uuid, socket, enabled: m.enabled !== false }; this.peers.set(m.uuid, peer);
					send(socket, { type: "ready" });
					if (this.#focus === m.uuid) void this.follow(this.#focus);
				} else if (peer && m.type === "reply" && typeof m.id === "number") {
					const pending = this.#pending.get(m.id);
					if (!pending || pending.socket !== socket) return;
					clearTimeout(pending.timer); this.#pending.delete(m.id);
					if (m.ok === true) pending.resolve(); else pending.reject(new Error("Companion could not switch profiles"));
				} else if (peer && m.type === "enabled") {
					peer.enabled = m.enabled !== false;
				} else if (peer && m.type === "visible" && typeof m.device === "string" && this.options.devices().includes(m.device)) {
					if (m.visible === true && !this.active.has(m.device)) this.active.set(m.device, peer.uuid);
					else if (m.visible === false && this.active.get(m.device) === peer.uuid) {
						this.active.delete(m.device); this.suppressed.set(m.device, peer.uuid);
					}
				} else if (peer && m.type === "request" && typeof m.id === "number" && (m.command === "show" || m.command === "back")) {
					const devices = typeof m.device === "string" ? [m.device].filter((d) => this.options.devices().includes(d)) : this.options.devices();
					const id = m.id, owner = peer.uuid;
					const task = Promise.all(devices.map((device) => m.command === "show" ? this.show(owner, device) : this.restore(device, owner, true)));
					void task.then(() => send(socket, { type: "response", id, ok: true }), () => send(socket, { type: "response", id, ok: false }));
				}
			});
			socket.on("error", () => {});
			socket.on("close", () => {
				if (peer && this.peers.get(peer.uuid)?.socket === socket) this.peers.delete(peer.uuid);
				for (const [id, pending] of this.#pending) if (pending.socket === socket) { clearTimeout(pending.timer); this.#pending.delete(id); pending.reject(new Error("Companion disconnected")); }
			});
		});
		server.on("error", (error) => this.options.onError?.(error));
		server.listen(this.options.pipe || companionPipe());
	}

	#queue(device: string, action: () => Promise<void>): Promise<void> {
		const task = (this.#queues.get(device) || Promise.resolve()).catch(() => {}).then(action);
		this.#queues.set(device, task);
		void task.finally(() => { if (this.#queues.get(device) === task) this.#queues.delete(device); }).catch(() => {});
		return task;
	}
	#invoke(uuid: string, command: "show" | "back", device: string): Promise<void> {
		const peer = this.peers.get(uuid);
		if (!peer) return Promise.reject(new Error("Companion is not connected"));
		return new Promise((resolve, reject) => {
			const id = ++this.#sequence;
			const timer = setTimeout(() => { this.#pending.delete(id); reject(new Error("Companion profile switch timed out")); }, 5000);
			this.#pending.set(id, { socket: peer.socket, resolve, reject, timer });
			send(peer.socket, { type: "invoke", id, command, device });
		});
	}
	show(uuid: string, device: string): Promise<void> {
		return this.#queue(device, async () => {
			if (this.active.get(device) === uuid) return;
			const previous = this.active.get(device);
			if (previous) {
				if (this.peers.has(previous)) await this.#invoke(previous, "back", device);
				else if (this.options.recover) await this.options.recover(device);
				else throw new Error("Previous companion is unavailable");
				this.active.delete(device);
			}
			await this.options.beforeShow?.(device);
			await this.#invoke(uuid, "show", device);
			this.active.set(device, uuid); this.suppressed.delete(device);
		});
	}
	restore(device: string, owner?: string, manual = false): Promise<void> {
		return this.#queue(device, async () => {
			const previous = this.active.get(device);
			if (!previous || owner && previous !== owner) return;
			if (this.peers.has(previous)) await this.#invoke(previous, "back", device);
			else if (this.options.recover) await this.options.recover(device);
			else throw new Error("Previous companion is unavailable");
			this.active.delete(device);
			if (manual) this.suppressed.set(device, previous);
		});
	}
	async follow(uuid?: string): Promise<void> {
		this.#focus = uuid;
		const peer = uuid ? this.peers.get(uuid) : undefined;
		for (const device of this.options.devices()) {
			if (this.suppressed.get(device) !== uuid) this.suppressed.delete(device);
			try {
				if (peer?.enabled && this.suppressed.get(device) !== uuid) await this.show(uuid!, device);
				else if (!peer || this.active.get(device) !== uuid) await this.restore(device);
			} catch (error) { this.options.onError?.(error as Error); }
		}
	}
	close(): void {
		this.#closed = true;
		for (const peer of this.peers.values()) peer.socket.destroy();
		this.#server?.close();
	}
}

export type CompanionConnection = ReturnType<typeof connectCompanion>;
export function connectCompanion(options: { uuid: string; enabled: () => boolean; invoke: (command: "show" | "back", device: string) => Promise<void>; pipe?: string }) {
	let socket: Socket | undefined, ready = false, closed = false, retry: NodeJS.Timeout | undefined, sequence = 0;
	const pending = new Map<number, { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
	const visible = new Map<string, boolean>();
	function connect() {
		if (closed) return;
		const current = socket = createConnection(options.pipe || companionPipe());
		current.on("connect", () => send(current, { type: "register", uuid: options.uuid, enabled: options.enabled() }));
		messages(current, (m) => {
			if (m.type === "ready") { ready = true; for (const [device, value] of visible) send(current, { type: "visible", device, visible: value }); }
			else if (m.type === "invoke" && typeof m.id === "number" && typeof m.device === "string" && (m.command === "show" || m.command === "back")) {
				void options.invoke(m.command, m.device).then(() => send(current, { type: "reply", id: m.id, ok: true }), () => send(current, { type: "reply", id: m.id, ok: false }));
			} else if (m.type === "response" && typeof m.id === "number") {
				const p = pending.get(m.id); if (!p) return; clearTimeout(p.timer); pending.delete(m.id);
				if (m.ok === true) p.resolve(); else p.reject(new Error("Profile switching is unavailable"));
			}
		});
		current.on("error", () => {});
		current.on("close", () => {
			ready = false;
			for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error("Profile coordinator disconnected")); } pending.clear();
			if (!closed) retry = setTimeout(connect, 1000);
		});
	}
	connect();
	return {
		get connected() { return ready; },
		request(command: "show" | "back", device?: string): Promise<void> {
			if (!ready || !socket) return Promise.reject(new Error("Start Windows Daily Toolkit for automatic profile switching"));
			return new Promise((resolve, reject) => {
				const id = ++sequence;
				const timer = setTimeout(() => { pending.delete(id); reject(new Error("Profile request timed out")); }, 12000);
				pending.set(id, { resolve, reject, timer }); send(socket!, { type: "request", command, device, id });
			});
		},
		setVisible(device: string, value: boolean) { visible.set(device, value); if (ready && socket) send(socket, { type: "visible", device, visible: value }); },
		update() { if (ready && socket) send(socket, { type: "enabled", enabled: options.enabled() }); },
		close() { closed = true; clearTimeout(retry); socket?.destroy(); },
	};
}
