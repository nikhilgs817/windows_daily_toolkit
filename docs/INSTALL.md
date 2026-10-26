# Install Windows Daily Toolkit

## Recommended: double-click installer

1. Download **WindowsDailyToolkit-Installer-2.6.2.0.zip** from [GitHub Releases](https://github.com/nikhilgs817/windows_daily_toolkit/releases/latest).
2. Right-click the ZIP and choose **Extract All**. Open the extracted **WindowsDailyToolkit-Installer** folder.
3. Double-click **Install-WindowsDailyToolkit.cmd**. Keep the other files in that folder.
4. Wait for **Installed Windows Daily Toolkit 2.6.2.0**. Stream Deck closes briefly and opens again automatically.
5. In Stream Deck, find **Windows Daily Toolkit** in the action list. On a compatible 15-key deck, you can also choose **Windows Daily Toolkit** from the profile dropdown for a ready-made starting layout.

No Git, Node.js, npm, developer mode or build commands are needed. Run the installer as your normal Windows user. If Stream Deck is missing or too old, the script can install/update the official **Elgato.StreamDeck** package through Windows Package Manager; Windows may request administrator approval for that prerequisite. If Windows Package Manager is unavailable, install Stream Deck from [Elgato Downloads](https://www.elgato.com/downloads), then run this installer again.

The extracted bundle can install offline when a compatible Stream Deck app is already installed. The launcher in a downloaded source checkout also works: it retrieves the matching prebuilt release rather than building the plugin.

## What happens automatically

- Checks Windows 10/11 64-bit and Stream Deck 7.1 or later. Stream Deck supplies the plugin's Node runtime.
- Verifies the downloaded package checksum, plugin identity, version and files before changing the installation.
- Backs up the current plugin and Stream Deck profiles under `%LOCALAPPDATA%\WindowsDailyToolkit\Backups`.
- Installs only Windows Daily Toolkit for the current user. It keeps existing button assignments, settings, website icon caches and monitor identities.
- Adds missing **Apps**, **Websites** and **Windows Daily Toolkit** profiles for detected decks matching the bundled 15-key layout. Existing profiles are never replaced or duplicated on a repeat install. Other deck sizes can still use the individual actions.
- Restarts Stream Deck, checks the installed files and confirms that the plugin process starts. If installation or startup fails, it restores the previous plugin and removes only the profiles added by that attempt.

Your existing main profile remains available. Personalize new Open App, Open Website, Folders and Monitor Control keys by selecting them in Stream Deck. Companion plugins are separate installations.

## Update or reinstall

Download the newer installer ZIP, extract it, and run its CMD launcher. You do not need to uninstall the old version. Re-running the same installer repairs its files and preserves existing settings. An older installer will not replace a newer installed version.

## If installation does not finish

- **Missing files / checksum failure:** extract a fresh copy of the whole ZIP; do not run from inside the ZIP or move only the CMD file.
- **Stream Deck not found:** install/update it from Elgato Downloads, then run the installer again. A custom installation path can be supplied with the PowerShell option below.
- **Windows policy blocks a script or software installation:** use your organization's approved installation method or the manual plugin package. The installer does not change permanent PowerShell or Windows security settings.
- **No starter profile appears:** connect a compatible deck and run the installer again. Its individual actions work on other supported Stream Deck models; the supplied layouts target a 15-key deck. Stream Deck may also offer to import its bundled layouts when first used.
- **Startup failed:** the previous plugin is restored automatically. Keep the install log shown in the console for diagnosis.

Installer logs: `%LOCALAPPDATA%\WindowsDailyToolkit\Logs`. Plugin logs: `%APPDATA%\Elgato\StreamDeck\Plugins\com.dailyops.v2.sdPlugin\logs`. Backups stay on your PC and may contain your personal profile settings; they are not uploaded.

## Manual alternative

Install Stream Deck 7.1+, open **com.dailyops.v2.streamDeckPlugin** from the release, and accept installation in Stream Deck. Accept the bundled profiles when offered. This route uses Stream Deck's own install prompts instead of the script.

## Advanced options

Run these from the extracted installer folder if needed; double-clicking the CMD file is sufficient for normal use.

```powershell
# Check compatibility and the package without changing the plugin or profiles.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\installer\Install-WindowsDailyToolkit.ps1 -CheckOnly

# Use a custom Stream Deck software location.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\installer\Install-WindowsDailyToolkit.ps1 -StreamDeckPath "D:\Apps\Elgato\StreamDeck.exe"
```

For manual recovery, exit Stream Deck completely, copy the backup's **Plugin** folder to `%APPDATA%\Elgato\StreamDeck\Plugins\com.dailyops.v2.sdPlugin`, then reopen Stream Deck. If the backup has no Plugin folder, it was a first install. Restore backed-up **ProfilesV3** only if you intentionally want to revert all profile changes made since that backup; routine plugin recovery does not require it.
