# Changes

## Windows Daily Toolkit 2.6.0.0 — 2026-10-17

- Added coordinated automatic profile switching for separately installed VS Code, ChatGPT, Claude, thinkorswim and Fidelity Trader+ companions. Generic Open App remains the launcher; there are no app-specific launcher presets.
- One foreground watcher reports verified executable identity, including thinkorswim's own Java runtime. A local named-pipe coordinator serializes restore/show operations across plugins, supports per-app Follow focus, and keeps Back from immediately reopening the same app profile.
- Added a shared companion runtime with animated Colourful/Vivid/Pro keys, 29 colour themes, custom artwork and editable shortcuts. Native app controls run in a bounded hidden worker and recheck the foreground identity before each keyboard chord or accessible menu action.
- Companion implementations live in separate repositories. Main plugin defaults and bundled Apps/Websites profiles remain generic.

## Windows Daily Toolkit 2.5.0.0 — 2026-10-16

- Added Website Folder as a plugin action with the approved animated Vivid ocean folder/globe. It opens the bundled editable Websites profile, with Back and an unconfigured Open Website key. Personal URLs and artwork are not shipped as defaults. Settings include Open Websites for editing the collection.
- Added Website Folder to the existing collection navigation and companion-focus hold/release behavior. Moving between Apps and Websites returns through the original main profile so Back does not loop.
- Consolidated the folder launchers into one visible Folders entry. The old action ID remains as a hidden compatibility alias. Both share the same launch, path, icon, gesture and animation implementation; the former differences were automatic labels and default colour.
- Added Use the folder name to the unified settings. Local legacy-key migration preserves automatic labels, empty-path fallback labels, existing themes, manual labels and all other settings. Verified matching rendering across 28 path/look cases, plus matching path commands and monitor gestures.

## Windows Daily Toolkit 2.4.0.0 / editor companion 2.2.0.0 — 2026-10-16

- Extended six-second, 12 fps animation to all 13 Toolkit actions and 27 companion actions, including Colourful, Vivid, Pro, real icons and uploaded pictures.
- Added distinct folder, app grid, volume, Copy/Paste, Back and website motion. Real icons float subtly; uploaded pictures retain their composition with animated edging. Monitor Control preserves red/green state colours, monitor numbers and action labels.
- Added Gentle loop to every key's Look settings, with an animated settings preview. Disabling it restores a still image, including the exact uploaded picture.
- Replaced per-action timers with one shared clock per plugin. Only visible keys draw; slow renders skip frames, with no backlog. Icon retrieval and monitor polling do not run per frame.
- Added tests for all-action motion, 120 rendered looks, seamless loop boundaries, real/custom images, monitor labels, hidden keys and slow-render isolation. Existing native shortcuts can use exported GIF loops while retaining their targets and titles; personal profile artwork is separate from the plugin packages.

## Windows Daily Toolkit 2.3.1.0 — 2026-10-16

- Renamed the main plugin and action category to Windows Daily Toolkit. Kept the internal plugin/action IDs to preserve existing generic keys.
- Added the approved Windows toolkit logo: a blue toolbox with a white four-pane Windows mark, wrench and gear. Includes a matching monochrome category icon. The transparent master is kept in source and exported at 256 px and 512 px for Stream Deck.
- Made Open App credentials and autofill app-agnostic. Select an installed app or its full executable path; there is no app-name allowlist.
- Autofill checks the foreground app's executable path or application identity and recognizable, editable native login fields. Embedded web forms, ambiguous fields and focus changes stop filling. You review and submit the login.
- Removed the remaining app-specific preset and its artwork. The 13 actions and bundled Apps page now use generic launchers and controls; new Open App keys have no preselected app.
- Removed app-specific launch/runtime exceptions and replaced sample data and current documentation with generic examples. Disabled the main plugin's development debugger in release builds.

## Daily Ops 2.3.0.0 — 2026-10-16

- Added optional username/password settings to Open App, with explicit Save/Clear and an accessible show/hide eye. Passwords are encrypted with Windows DPAPI for the current user and bound to the selected app. No plaintext password is written to settings, logs, process arguments or the clipboard.
- Added guarded autofill for an initial set of apps. Only identified, editable username and password controls in the verified app receive credentials; no Sign In/Enter is sent. Unsupported or ambiguous forms and focus changes stop filling. A separate time-limited worker protects the rest of the deck from slow app providers.
- Saved passwords are revealed only on request, hidden after 20 seconds or loss of focus, and cleared from the input when hidden. Changing the selected app clears its credentials.
- Removed six app-specific preset actions and their generated artwork. This release had 14 actions.
- Removed those presets from the bundled Apps page. Open App and Open Website remain available for custom launchers; the optional editor companion can still work with a configured Open App key.

## Daily Ops 2.2.2.0 — 2026-10-16

- Renamed the former Downloads Folder action to Folders, retaining its UUID so existing keys update in place. Uses a plain folder glyph and opens any explicit folder path; blank paths require configuration.
- Replaced the Downloads-only placeholder with an example path and clear File Explorer copy/paste instructions beneath the field.
- Added Sunset, Tropical, Electric, Cosmic, Peach and Lemonade gradients to Colourful and Vivid looks.
- Preserved the Which monitor settings and launcher gesture behavior.

## Daily Ops 2.2.1.0 — 2026-10-16

- Corrected Monitor Control numbering: label physical targets using adapter/connector topology instead of the mutable GDI source name or primary-first enumeration order.
- Verified against Windows Display Settings on the development PC: DELL SE2726HS is display 1 and LG ULTRAGEAR is display 2/main, although their GDI names are DISPLAY2 and DISPLAY1 respectively.
- Keep native reconnect hints separate from user-visible display numbers. Retain each physical monitor's history when Windows reuses a number.
- Added numbering regression cases for primary-first enumeration, swapped GDI names, and detected disconnected displays.

## Daily Ops 2.2.0.0 — 2026-10-16

- Added Show Desktop: show the desktop, then restore windows on the next press.
- Refined Screenshot and Show Desktop with matching animated artwork: capture scanning, window reveal, soft light sweeps, and moving accents. Both support Colourful/Vivid, themes, custom labels, and an animation switch.
- Motion uses six-second loops at 12 fps with backpressure and only runs while keys are visible. Custom uploaded pictures remain still. Screenshot gestures/settings are preserved.
- Monitor Control now allows the main display to be selected and turned off when another screen is active. Remaining screen coordinates are rebased so another screen becomes primary. The last active screen remains on.
- Added compiled C# layout checks and expanded plugin/browser checks for animation and main-display control.

## Daily Ops 2.1.4.0 — 2026-10-16

- Replaced Monitor 2 On/Off and Monitor 3 On/Off with one Monitor Control action.
- Each key selects a physical monitor in settings. Multiple keys can control different screens independently.
- The selected monitor's number appears on the key, including while off. Red TURN OFF indicates a connected screen; green TURN ON indicates a disconnected screen.
- Refresh Windows state before each press and immediately after switching. Other keys assigned to the same screen update together.
- Unconfigured and missing screens never fall back to another display. Main-display protection and optional DDC/CI sleep/wake remain.
- Build/profile generation and simulated test paths now work on Windows. Added browser checks for monitor settings.

Existing keys using the removed action IDs must be replaced by Monitor Control and assigned a screen. The VS Code companion remains version 2.1.3.0 and does not require reinstalling.
