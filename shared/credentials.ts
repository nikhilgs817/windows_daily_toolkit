import { spawn } from "node:child_process";
import type { AppSettings } from "./base.js";
import type { PsResult } from "./ps.js";
import { LOGIN_WORKER } from "./credentials-native.js";

const failures: Record<string, string> = {
	identity: "Autofill could not verify the selected app. Choose its installed app entry or full executable path.",
	focus: "Autofill stopped because the selected app lost focus.",
	fields: "Could not identify the login fields. Open the app's login form and press the key again.",
	unsupported: "This login form does not support autofill. Enter your credentials in the app.",
	unavailable: "Autofill is unavailable or this password cannot be opened for your Windows account.",
	timeout: "Autofill timed out. No further input will be sent.",
};
let filling = false;

export const credentialBinding = (s: AppSettings): string => s.appId ? "appid:" + s.appId : s.target?.trim() ? "target:" + s.target.trim() : "";

/** No plaintext password enters command-line arguments, settings, logs, or the clipboard. */
export async function fillAppCredentials(s: AppSettings): Promise<PsResult> {
	if (!credentialBinding(s)) return { status: "err", message: failures.identity };
	if (!s.credentialApp || s.credentialApp !== credentialBinding(s)) return { status: "err", message: "The selected app changed. Save its credentials again before using autofill." };
	if (process.platform !== "win32" || process.env.DAILYOPS_DRYRUN === "1") return { status: "err", message: "Autofill requires Windows." };
	if (filling) return { status: "err", message: "Another app is already filling credentials." };
	if (!s.credentialUsername || !s.credentialPassword?.startsWith("dpapi:v1:") || s.credentialUsername.length > 512 || s.credentialPassword.length > 32768) return { status: "err", message: "Save a username and encrypted password first." };
	filling = true;
	try {
		return await new Promise<PsResult>((resolve) => {
			const proc = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(LOGIN_WORKER, "utf16le").toString("base64")], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
			let output = "", done = false, timedOut = false;
			const finish = (code: string) => { if (done) return; done = true; clearTimeout(timer); if (code !== "ok") proc.kill(); resolve(code === "ok" ? { status: "ok", message: "Credentials filled. Submit the login in the app." } : { status: "err", message: failures[code] || failures.unavailable }); };
			const timer = setTimeout(() => { timedOut = true; proc.kill(); }, 20000);
			proc.stdout.on("data", (chunk: Buffer) => { if (output.length < 100) output += chunk.toString(); });
			proc.stderr.on("data", () => { /* Native diagnostics can contain provider data; never log them. */ });
			proc.stdin.on("error", () => finish("unavailable"));
			proc.on("error", () => finish("unavailable"));
			proc.on("close", () => finish(timedOut ? "timeout" : output.trim()));
			proc.stdin.end(Buffer.from(JSON.stringify({ appId: s.appId || "", target: s.target || "", username: s.credentialUsername, protectedPassword: s.credentialPassword, binding: s.credentialApp }), "utf8").toString("base64") + "\n");
		});
	} finally { filling = false; }
}
