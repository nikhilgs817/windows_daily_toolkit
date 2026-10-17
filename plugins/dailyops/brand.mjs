import { readFileSync } from "node:fs";

// User-approved Windows toolkit artwork. Preserve the original alpha while resizing at build time.
const master = readFileSync(new URL("./assets/windows-daily-toolkit-master.png", import.meta.url));
export function toolkitLogoSvg(size = 512) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1280 1280"><image width="1280" height="1280" href="data:image/png;base64,${master.toString("base64")}"/></svg>`;
}

// Small monochrome category mark: toolcase, wrench, gear, four-pane window.
export function toolkitCategorySvg(size = 28) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"><g fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3a3 3 0 0 0 0 6v3m3-9a3 3 0 0 1 0 6v3"/><circle cx="17" cy="8" r="3"/><path d="M17 3v2m0 6v2m-5-5h2m6 0h2m-8.5-3.5L15 6m4 4 1.5 1.5m0-7L19 6m-4 4-1.5 1.5"/><rect x="2" y="12" width="20" height="10" rx="2"/></g><g fill="white"><rect x="9" y="14.5" width="2.4" height="2.4"/><rect x="12.6" y="14.5" width="2.4" height="2.4"/><rect x="9" y="18.1" width="2.4" height="2.4"/><rect x="12.6" y="18.1" width="2.4" height="2.4"/></g></svg>`;
}
