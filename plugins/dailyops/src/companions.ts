import streamDeck from "@elgato/streamdeck";
import { CompanionRouter } from "../../../shared/companion-routing.js";
import { COMPANIONS, matchesApp } from "../../../shared/companion-specs.js";
import { ps } from "../../../shared/ps.js";
import { inApps, leaveApps, setCompanionManager } from "./nav.js";

const TRANSIENT = new Set(["", "streamdeck", "shellexperiencehost", "searchhost", "startmenuexperiencehost", "lockapp", "idle", "textinputhost"]);
export function initCompanions(): void {
	// Ordinary harnesses must not connect to the user's installed companions.
	if (process.env.DAILYOPS_DRYRUN === "1" && !process.env.DAILYOPS_COMPANION_PIPE) return;
	const log = streamDeck.logger.createScope("companions");
	const router = new CompanionRouter({
		allowed: COMPANIONS.map((c) => c.uuid),
		devices: () => { const all = Array.from(streamDeck.devices), connected = all.filter((d) => d.isConnected); return (connected.length ? connected : all).map((d) => d.id); },
		beforeShow: async (device) => { if (inApps(device)) await leaveApps(device, false); },
		recover: async (device) => { await streamDeck.profiles.switchToProfile(device); },
		onError: (error) => log.warn(error.message),
	});
	router.start();
	setCompanionManager({ available: (uuid) => router.peers.has(uuid), show: (uuid, device) => router.show(uuid, device), restore: (device) => router.restore(device, undefined, true) });
	let timer: NodeJS.Timeout | undefined;
	ps.onEvent((event) => {
		if (event.type !== "fgdetail") return;
		const [name, path = ""] = event.data.split("\n");
		if (TRANSIENT.has(name.toLowerCase())) return;
		clearTimeout(timer);
		const target = COMPANIONS.find((c) => matchesApp(c.selector, name, path))?.uuid;
		timer = setTimeout(() => void router.follow(target), 450);
	});
	void ps.run("watchfg").then((r) => { if (r.status !== "ok") log.warn("Automatic app switching is unavailable"); });
}
