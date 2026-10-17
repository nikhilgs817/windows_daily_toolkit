// Tests native IPC using synthetic credentials; no application login screens are opened.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
function literal(source, name) {
	const marker = `export const ${name} = String.raw\x60\n`;
	const start = source.indexOf(marker);
	assert.notEqual(start, -1);
	const end = source.indexOf("\n\x60;", start + marker.length);
	assert.notEqual(end, -1);
	return source.slice(start + marker.length, end);
}
const encoded = (script) => Buffer.from(script, "utf16le").toString("base64");
const b64 = (value) => Buffer.from(value, "utf8").toString("base64");
const from64 = (value) => Buffer.from(value, "base64").toString("utf8");
const hostScript = literal(read("../shared/host-script.ts"), "HOST_SCRIPT");
const source = read("../shared/credentials-native.ts");
const worker = literal(source, "LOGIN_WORKER").replace("${LOGIN_NATIVE}", literal(source, "LOGIN_NATIVE"));
assert.ok(encoded(worker).length < 30000);
function start(script) {
	const proc = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded(script)], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
	const lines = [], waiters = [];
	let buffer = "", stderr = "";
	proc.stdout.on("data", (data) => {
		buffer += data.toString();
		let end;
		while ((end = buffer.indexOf("\n")) >= 0) { const line = buffer.slice(0, end).trimEnd(); buffer = buffer.slice(end + 1); waiters.length ? waiters.shift()(line) : lines.push(line); }
	});
	proc.stderr.on("data", (data) => { stderr += data.toString(); });
	const timer = setTimeout(() => proc.kill(), 20000);
	const closed = new Promise((resolve, reject) => { proc.on("error", reject); proc.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error("Native helper did not exit successfully")); }); });
	closed.catch(() => {});
	return { proc, next: () => lines.length ? Promise.resolve(lines.shift()) : Promise.race([new Promise((resolve) => waiters.push(resolve)), closed.then(() => { throw Error("Missing native reply"); })]), closed, errors: () => stderr };
}
const host = start("$b=[Console]::In.ReadLine(); . ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b))))");
try {
	host.proc.stdin.write(b64(hostScript) + "\n");
	const secret = " synthetic-only credential %{} 密碼 ";
	const binding = "appid:synthetic-transport-fixture";
	host.proc.stdin.write(["1", "secret-protect", b64(secret), b64(binding)].join("\t") + "\n");
	const protectedReply = (await host.next()).split("\t");
	assert.equal(protectedReply[1], "ok");
	const cipher = from64(protectedReply[2]);
	assert.match(cipher, /^dpapi:v1:/);
	assert.equal(cipher.includes(secret), false);
	host.proc.stdin.write(["2", "secret-unprotect", b64(cipher), b64(binding)].join("\t") + "\n");
	const clearReply = (await host.next()).split("\t");
	assert.equal(clearReply[1], "ok");
	assert.equal(from64(clearReply[2]), secret);
	host.proc.stdin.write(["3", "secret-unprotect", b64(cipher), b64("appid:wrong-app")].join("\t") + "\n");
	const wrong = (await host.next()).split("\t");
	assert.equal(wrong[1], "err");
	assert.equal(from64(wrong[2]).includes(secret), false);
	host.proc.stdin.end();
	await host.closed;
	assert.equal(host.errors(), "");
	console.log("PASS  actual native host IPC encrypts/decrypts correctly and rejects a changed app binding without leaking a password");
} finally { host.proc.kill(); }
const probe = start(worker);
try {
	probe.proc.stdin.end(b64(JSON.stringify({ appId: "", target: "", username: "", protectedPassword: "", binding: "" })) + "\n");
	assert.equal(await probe.next(), "identity");
	await probe.closed;
	assert.equal(probe.errors(), "");
	console.log("PASS  the isolated autofill worker compiles and refuses an unverified app before accessing login fields");
} finally { probe.proc.kill(); }
