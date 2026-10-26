#Requires -Version 5.1
<# Installs a prebuilt plugin for the current Windows user; no build tools required. #>
[CmdletBinding()]
param(
    [string]$PackagePath,
    [string]$StreamDeckPath,
    [switch]$CheckOnly
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$script:PluginId = 'com.dailyops.v2'
$script:ReleaseVersion = '2.6.2.0'
$script:ReleaseBase = 'https://github.com/nikhilgs817/windows_daily_toolkit/releases/download/v2.6.2'
$script:LogFile = $null

function Write-Step([string]$Message) {
    Write-Host $Message
    if ($script:LogFile) { Add-Content -LiteralPath $script:LogFile -Value ((Get-Date -Format s) + ' ' + $Message) -Encoding UTF8 }
}
function Read-Json([string]$Path) { Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json }
function Write-Json([string]$Path, $Value) { [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 100), [Text.UTF8Encoding]::new($false)) }
function Get-InstallFileHash([string]$Path) {
    $hash = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try { return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $hash.Dispose() }
}
function Get-Field($Value, [string]$Name) {
    if ($null -ne $Value -and $Value.PSObject.Properties[$Name]) { return $Value.$Name }
    return $null
}
function Set-Field($Value, [string]$Name, $Data) { $Value | Add-Member -MemberType NoteProperty -Name $Name -Value $Data -Force }
function Assert-ChildPath([string]$Path, [string]$Root) {
    $full = [IO.Path]::GetFullPath($Path)
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'A file operation would leave its installation folder.' }
    return $full
}
function Assert-NoLinks([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'A linked installation folder was found. Use a normal per-user Stream Deck installation.' }
    if ($item.PSIsContainer) {
        foreach ($child in Get-ChildItem -LiteralPath $Path -Force) { Assert-NoLinks $child.FullName }
    }
}
function Remove-InstallFolder([string]$Path, [string]$Root) {
    $safe = Assert-ChildPath $Path $Root
    if (Test-Path -LiteralPath $safe) { Assert-NoLinks $safe; Remove-Item -LiteralPath $safe -Recurse -Force }
}
function Get-SafeZipEntries($Archive) {
    if ($Archive.Entries.Count -gt 10000) { throw 'The package contains too many files.' }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    [long]$total = 0
    foreach ($entry in $Archive.Entries) {
        $name = $entry.FullName.Replace('\', '/')
        if (-not $name -or $name.StartsWith('/') -or $name.Contains(':')) { throw 'The package contains an invalid file path.' }
        $parts = $name.TrimEnd('/').Split('/')
        foreach ($part in $parts) {
            if (-not $part -or $part -in @('.', '..') -or $part -match '[\x00-\x1f<>"|?*]' -or $part -match '[. ]$' -or $part -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)') { throw 'The package contains an unsafe file path.' }
        }
        if (-not $seen.Add($name.TrimEnd('/'))) { throw 'The package contains duplicate file paths.' }
        if ((($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'Linked files are not allowed in an installation package.' }
        $total += $entry.Length
        if ($entry.Length -gt 100MB -or $total -gt 250MB) { throw 'The package is larger than expected.' }
        [pscustomobject]@{ Entry = $entry; Name = $name; IsDirectory = $name.EndsWith('/') }
    }
}
function Expand-SafeArchive([string]$ZipPath, [string]$Destination, [string]$RequiredPrefix = '') {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $entries = @(Get-SafeZipEntries $archive)
        foreach ($entry in $entries) {
            if ($RequiredPrefix -and -not ($entry.Name -eq $RequiredPrefix.TrimEnd('/') -or $entry.Name.StartsWith($RequiredPrefix, [StringComparison]::Ordinal))) { throw 'The archive contains files for a different plugin.' }
        }
        $null = New-Item -ItemType Directory -Path $Destination -Force
        foreach ($item in $entries) {
            $target = Assert-ChildPath (Join-Path $Destination $item.Name.Replace('/', '\')) $Destination
            if ($item.IsDirectory) { $null = New-Item -ItemType Directory -Path $target -Force; continue }
            $null = New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force
            [IO.Compression.ZipFileExtensions]::ExtractToFile($item.Entry, $target, $false)
        }
    } finally { $archive.Dispose() }
}
function Test-PluginPayload([string]$Root) {
    $manifest = Read-Json (Join-Path $Root 'manifest.json')
    if ($manifest.UUID -ne $script:PluginId -or $manifest.Version -ne $script:ReleaseVersion -or $manifest.CodePath -ne 'bin/plugin.js') { throw 'The downloaded plugin does not match this installer.' }
    foreach ($file in @('bin/plugin.js', 'bin/package.json', 'ui/pi.html', 'ui/pi.js', 'ui/icons.js')) {
        if (-not (Test-Path -LiteralPath (Join-Path $Root $file) -PathType Leaf)) { throw 'The plugin package is incomplete.' }
    }
    foreach ($entry in Get-ChildItem -LiteralPath $Root -Force) {
        if ($entry.Name -in @('cache', 'logs', 'screens.json')) { throw 'The package includes personal runtime files.' }
    }
    return $manifest
}
function Test-InstalledFiles([string]$PayloadRoot, [string]$InstalledRoot) {
    foreach ($file in Get-ChildItem -LiteralPath $PayloadRoot -Recurse -File -Force) {
        $relative = $file.FullName.Substring($PayloadRoot.TrimEnd('\').Length + 1)
        $target = Assert-ChildPath (Join-Path $InstalledRoot $relative) $InstalledRoot
        if (-not (Test-Path -LiteralPath $target -PathType Leaf) -or (Get-InstallFileHash $file.FullName) -ne (Get-InstallFileHash $target)) { throw 'Installed files did not pass verification.' }
    }
}
function Find-StreamDeck([string]$ExplicitPath = '') {
    $paths = @()
    if ($ExplicitPath) { $paths += $ExplicitPath }
    foreach ($process in @(Get-Process -Name StreamDeck -ErrorAction SilentlyContinue)) { if ($process.Path) { $paths += $process.Path } }
    foreach ($base in @($env:ProgramW6432, $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
        if ($base) { $paths += Join-Path $base 'Elgato\StreamDeck\StreamDeck.exe' }
    }
    foreach ($registry in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
        foreach ($item in @(Get-ItemProperty -Path $registry -ErrorAction SilentlyContinue)) {
            if ((Get-Field $item 'DisplayName') -match '^(Elgato )?Stream Deck$' -and (Get-Field $item 'InstallLocation')) { $paths += Join-Path $item.InstallLocation 'StreamDeck.exe' }
        }
    }
    foreach ($path in $paths) {
        if ((Test-Path -LiteralPath $path -PathType Leaf) -and [IO.Path]::GetFileName($path) -ieq 'StreamDeck.exe') { return [IO.Path]::GetFullPath($path) }
    }
    return $null
}
function Ensure-StreamDeck([string]$ExplicitPath, [version]$Minimum, [switch]$ReadOnly) {
    $path = Find-StreamDeck $ExplicitPath
    if ($path -and [version](Get-Item -LiteralPath $path).VersionInfo.FileVersion -ge $Minimum) { return $path }
    if ($ReadOnly) { throw ('Stream Deck ' + $Minimum + ' or later is required. Install it from https://www.elgato.com/downloads and run this installer again.') }
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $winget) { throw 'Install or update Stream Deck from https://www.elgato.com/downloads, then double-click this installer again. Windows Package Manager is not available on this PC.' }
    Write-Step 'Installing or updating the official Elgato Stream Deck software. Windows may request administrator approval.'
    & $winget.Source install --id Elgato.StreamDeck --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) { throw 'Stream Deck setup did not finish. Install it from https://www.elgato.com/downloads, then run this installer again.' }
    $path = Find-StreamDeck $ExplicitPath
    if (-not $path -or [version](Get-Item -LiteralPath $path).VersionInfo.FileVersion -lt $Minimum) { throw 'A compatible Stream Deck installation could not be found after setup.' }
    return $path
}
function Stop-DeckForInstall([string]$PluginsRoot) {
    foreach ($process in @(Get-Process -Name StreamDeck -ErrorAction SilentlyContinue)) { $null = $process.CloseMainWindow() }
    Start-Sleep -Milliseconds 1200
    Get-Process -Name StreamDeck -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction Stop
    foreach ($process in @(Get-CimInstance Win32_Process)) {
        if ($process.CommandLine -and $process.CommandLine.IndexOf($PluginsRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $process.CommandLine.Contains('-pluginUUID')) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
    }
}
function Start-DeckAfterInstall([string]$ExePath) { $null = Start-Process -FilePath $ExePath -WindowStyle Hidden -PassThru }
function Test-ReadyRecord($Record, [int]$ProcessId, [DateTimeOffset]$StartedAfter) {
    try { return ((Get-Field $Record 'pid') -eq $ProcessId -and [DateTimeOffset]::Parse((Get-Field $Record 'readyAt')) -ge $StartedAfter) } catch { return $false }
}
function Wait-ToolkitRuntime([string]$InstalledRoot, [int]$Seconds = 25, [DateTimeOffset]$StartedAfter = [DateTimeOffset]::UtcNow.AddMinutes(-1)) {
    $until = [DateTime]::UtcNow.AddSeconds($Seconds)
    do {
        $running = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($InstalledRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.CommandLine.Contains('-pluginUUID') })
        $receipt = Join-Path $InstalledRoot 'logs\installer-ready.json'
        if ($running.Count -and (Test-Path -LiteralPath $receipt)) {
            try { if (Test-ReadyRecord (Read-Json $receipt) $running[0].ProcessId $StartedAfter) { return } } catch { }
        }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $until)
    throw 'Stream Deck did not start the plugin. Check Stream Deck is 7.1 or newer and that Windows has allowed its bundled Node runtime.'
}
function Add-MissingProfiles([string]$PluginRoot, [string]$ProfilesRoot, $Manifest, [string]$Scratch, $CreatedProfiles) {
    $null = New-Item -ItemType Directory -Path $ProfilesRoot -Force
    Assert-NoLinks $ProfilesRoot
    $headers = @()
    foreach ($folder in Get-ChildItem -LiteralPath $ProfilesRoot -Directory) {
        $headerFile = Join-Path $folder.FullName 'manifest.json'
        if (Test-Path -LiteralPath $headerFile) { try { $headers += Read-Json $headerFile } catch { throw 'An existing Stream Deck profile could not be read. It has not been replaced.' } }
    }
    foreach ($definition in $Manifest.Profiles) {
        $profileZip = Join-Path $PluginRoot ($definition.Name + '.streamDeckProfile')
        $unpack = Assert-ChildPath (Join-Path $Scratch ([guid]::NewGuid().ToString())) $Scratch
        Expand-SafeArchive $profileZip $unpack
        $package = Read-Json (Join-Path $unpack 'package.json')
        $templates = @(Get-ChildItem -LiteralPath (Join-Path $unpack 'Profiles') -Directory -Filter '*.sdProfile')
        if ($templates.Count -ne 1) { throw 'A bundled layout is invalid.' }
        $devices = @($headers | ForEach-Object { Get-Field $_ 'Device' } | Where-Object { $_ -and $_.Model -eq $package.DeviceModel } | Group-Object UUID | ForEach-Object { $_.Group[0] })
        foreach ($device in $devices) {
            $existing = @($headers | Where-Object { (Get-Field $_ 'InstalledByPluginUUID') -eq $Manifest.UUID -and (Get-Field $_ 'PreconfiguredName') -eq $definition.Name -and (Get-Field $_ 'Device').UUID -eq $device.UUID })
            if ($existing.Count) { continue }
            $destination = Assert-ChildPath (Join-Path $ProfilesRoot (([guid]::NewGuid().ToString().ToUpperInvariant()) + '.sdProfile')) $ProfilesRoot
            $CreatedProfiles.Add($destination)
            Copy-Item -LiteralPath $templates[0].FullName -Destination $destination -Recurse
            $headerPath = Join-Path $destination 'manifest.json'
            $header = Read-Json $headerPath
            Set-Field $header 'Device' $device
            Set-Field $header 'InstalledByPluginUUID' $Manifest.UUID
            Set-Field $header 'PreconfiguredName' $definition.Name
            Set-Field $header 'ReadOnly' $false
            $pagesRoot = Join-Path $destination 'Profiles'
            $pageMap = @{}
            foreach ($pageFolder in Get-ChildItem -LiteralPath $pagesRoot -Directory) {
                $pageId = [guid]::NewGuid().ToString().ToUpperInvariant()
                $pageMap[$pageFolder.Name] = $pageId
                $safeSource = Assert-ChildPath $pageFolder.FullName $pagesRoot
                $safeTarget = Assert-ChildPath (Join-Path $pagesRoot $pageId) $pagesRoot
                Move-Item -LiteralPath $safeSource -Destination $safeTarget
            }
            $header.Pages.Pages = @($header.Pages.Pages | ForEach-Object { $pageMap[$_] })
            $header.Pages.Default = $pageMap[$header.Pages.Default]
            $header.Pages.Current = $header.Pages.Pages[0]
            Write-Json $headerPath $header
            # Each installed copy gets its own action identity, including on a second device.
            foreach ($page in Get-ChildItem -LiteralPath (Join-Path $destination 'Profiles') -Filter manifest.json -File -Recurse) {
                $data = Read-Json $page.FullName
                foreach ($controller in $data.Controllers) {
                    if (-not $controller.Actions) { continue }
                    foreach ($action in $controller.Actions.PSObject.Properties) { $action.Value.ActionID = [guid]::NewGuid().ToString().ToUpperInvariant() }
                }
                Write-Json $page.FullName $data
            }
            $headers += $header
        }
    }
}
function Install-ToolkitPayload([string]$PayloadRoot, [string]$DataRoot, [string]$BackupRoot, [string]$Scratch, [scriptblock]$Restart, [scriptblock]$VerifyRuntime) {
    $manifest = Test-PluginPayload $PayloadRoot
    $pluginsRoot = Join-Path $DataRoot 'Plugins'
    $profilesRoot = Join-Path $DataRoot 'ProfilesV3'
    $installed = Assert-ChildPath (Join-Path $pluginsRoot ($script:PluginId + '.sdPlugin')) $pluginsRoot
    Assert-NoLinks $DataRoot
    $null = New-Item -ItemType Directory -Path $pluginsRoot -Force
    if (Test-Path -LiteralPath (Join-Path $installed 'manifest.json')) {
        if ([version](Read-Json (Join-Path $installed 'manifest.json')).Version -gt [version]$manifest.Version) { throw 'A newer version is already installed. Download its matching installer instead of downgrading.' }
    }
    $backup = Assert-ChildPath (Join-Path $BackupRoot ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))) $BackupRoot
    $null = New-Item -ItemType Directory -Path $backup -Force
    if (Test-Path -LiteralPath $profilesRoot) { Copy-Item -LiteralPath $profilesRoot -Destination (Join-Path $backup 'ProfilesV3') -Recurse }
    $candidate = Assert-ChildPath (Join-Path $pluginsRoot ('.toolkit-new-' + [guid]::NewGuid().ToString('N'))) $pluginsRoot
    $previous = Assert-ChildPath (Join-Path $pluginsRoot ('.toolkit-old-' + [guid]::NewGuid().ToString('N'))) $pluginsRoot
    $created = [Collections.Generic.List[string]]::new()
    $hadPlugin = Test-Path -LiteralPath $installed
    $swapped = $false
    try {
        Copy-Item -LiteralPath $PayloadRoot -Destination $candidate -Recurse
        if ($hadPlugin) {
            Copy-Item -LiteralPath $installed -Destination (Join-Path $backup 'Plugin') -Recurse
            foreach ($name in @('cache', 'logs', 'screens.json')) {
                $saved = Join-Path $installed $name
                if (Test-Path -LiteralPath $saved) { Copy-Item -LiteralPath $saved -Destination (Join-Path $candidate $name) -Recurse }
            }
        }
        Test-InstalledFiles $PayloadRoot $candidate
        if ($hadPlugin) { Move-Item -LiteralPath $installed -Destination $previous }
        try { Move-Item -LiteralPath $candidate -Destination $installed; $swapped = $true }
        catch { if (Test-Path -LiteralPath $previous) { Move-Item -LiteralPath $previous -Destination $installed }; throw }
        Add-MissingProfiles $installed $profilesRoot $manifest $Scratch $created
        & $Restart
        & $VerifyRuntime $installed
        Test-InstalledFiles $PayloadRoot $installed
        Write-Json (Join-Path $backup 'installation.json') ([ordered]@{ Version = $manifest.Version; InstalledAt = (Get-Date -Format o); AddedProfiles = @($created); HadPreviousPlugin = $hadPlugin; Status = 'Installed' })
        # Cleanup failure must not turn a verified install into a rollback of a partly deleted old copy.
        try { Remove-InstallFolder $previous $pluginsRoot } catch { Write-Host 'The previous temporary copy was retained; your verified backup is also available.' }
        return [pscustomobject]@{ Backup = $backup; Version = $manifest.Version; AddedProfiles = $created.Count }
    } catch {
        $failure = $_
        # Stop only the app/runtime before restoring the files it had before this attempt.
        Stop-DeckForInstall $pluginsRoot
        if ($swapped) { Remove-InstallFolder $installed $pluginsRoot }
        if (Test-Path -LiteralPath $previous) { Move-Item -LiteralPath $previous -Destination $installed }
        foreach ($profile in $created) { Remove-InstallFolder $profile $profilesRoot }
        Write-Json (Join-Path $backup 'installation.json') ([ordered]@{ Version = $manifest.Version; Status = 'RolledBack'; HadPreviousPlugin = $hadPlugin })
        & $Restart
        throw ('Installation was rolled back. Your previous plugin and layouts were kept. ' + $failure.Exception.Message)
    } finally { try { Remove-InstallFolder $candidate $pluginsRoot } catch { Write-Host 'Temporary setup files were retained for cleanup later.' } }
}

# Dot-sourcing loads the same production functions for isolated installer tests.
if ($MyInvocation.InvocationName -eq '.') { return }
$scratch = $null
$deckExe = $null
$deckWasStopped = $false
try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or [Environment]::OSVersion.Version.Major -lt 10 -or -not [Environment]::Is64BitOperatingSystem) { throw 'Windows 10/11 64-bit is required.' }
    $stateRoot = Join-Path $env:LOCALAPPDATA 'WindowsDailyToolkit'
    $null = New-Item -ItemType Directory -Path (Join-Path $stateRoot 'Logs') -Force
    $script:LogFile = Join-Path $stateRoot ('Logs\install-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
    $scratch = Join-Path ([IO.Path]::GetTempPath()) ('WindowsDailyToolkit-Install-' + [guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $scratch
    Write-Step ('Windows Daily Toolkit ' + $script:ReleaseVersion + ' installer')
    Write-Step '1/5 Checking the ready-made plugin package...'
    $bundleRoot = Split-Path -Parent $PSScriptRoot
    $metadataPath = Join-Path $bundleRoot 'installer-manifest.json'
    if (-not (Test-Path -LiteralPath $metadataPath) -and (Test-Path -LiteralPath (Join-Path $bundleRoot 'dist\installer-manifest.json'))) { $metadataPath = Join-Path $bundleRoot 'dist\installer-manifest.json' }
    if (-not (Test-Path -LiteralPath $metadataPath)) {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $metadataPath = Join-Path $scratch 'installer-manifest.json'
        Invoke-WebRequest -Uri ($script:ReleaseBase + '/installer-manifest.json') -OutFile $metadataPath -UseBasicParsing
    }
    $metadata = Read-Json $metadataPath
    if ($metadata.PluginId -ne $script:PluginId -or $metadata.Version -ne $script:ReleaseVersion -or $metadata.File -ne ($script:PluginId + '.streamDeckPlugin') -or $metadata.Sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'The installation manifest is invalid or belongs to another version.' }
    if (-not $PackagePath) {
        foreach ($candidate in @((Join-Path $bundleRoot $metadata.File), (Join-Path $bundleRoot ('dist\' + $metadata.File)))) { if (Test-Path -LiteralPath $candidate -PathType Leaf) { $PackagePath = $candidate; break } }
    }
    if (-not $PackagePath) {
        $PackagePath = Join-Path $scratch $metadata.File
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri ($script:ReleaseBase + '/' + $metadata.File) -OutFile $PackagePath -UseBasicParsing
    }
    $PackagePath = (Resolve-Path -LiteralPath $PackagePath).ProviderPath
    if ((Get-InstallFileHash $PackagePath) -ne $metadata.Sha256) { throw 'Package verification failed. Download and extract a fresh installer ZIP; keep all its files together.' }
    $unpack = Join-Path $scratch 'payload'
    Expand-SafeArchive $PackagePath $unpack ($script:PluginId + '.sdPlugin/')
    $payload = Join-Path $unpack ($script:PluginId + '.sdPlugin')
    $manifest = Test-PluginPayload $payload
    Write-Step '2/5 Checking Stream Deck software (no separate Node.js installation is needed)...'
    $deckExe = Ensure-StreamDeck $StreamDeckPath ([version]$manifest.Software.MinimumVersion) -ReadOnly:$CheckOnly
    if ($CheckOnly) { Write-Step 'Checks passed. The plugin and Stream Deck are compatible. No plugin files or profiles were changed.'; exit 0 }
    $dataRoot = Join-Path $env:APPDATA 'Elgato\StreamDeck'
    Assert-NoLinks $dataRoot
    Write-Step '3/5 Closing Stream Deck briefly and backing up your current setup...'
    Stop-DeckForInstall (Join-Path $dataRoot 'Plugins')
    $deckWasStopped = $true
    Write-Step '4/5 Installing the plugin and adding only missing compatible layouts...'
    $result = Install-ToolkitPayload $payload $dataRoot (Join-Path $stateRoot 'Backups') $scratch { $script:RuntimeStartUtc = [DateTimeOffset]::UtcNow; Start-DeckAfterInstall $deckExe } { param($root) Wait-ToolkitRuntime $root -StartedAfter $script:RuntimeStartUtc }
    $deckWasStopped = $false
    Write-Step '5/5 Stream Deck restarted and the plugin passed verification.'
    Write-Step ('Installed Windows Daily Toolkit ' + $result.Version + '.')
    Write-Step ('Backup: ' + $result.Backup)
    Write-Step 'Your existing button layouts and saved settings were kept.'
    Write-Step 'Find Windows Daily Toolkit in the action list, or choose its starter profile from the profile list.'
    Write-Step 'If no compatible deck was detected, Stream Deck can offer its bundled layouts when first used.'
    exit 0
} catch {
    if ($deckWasStopped -and $deckExe) { try { Start-DeckAfterInstall $deckExe } catch {} }
    Write-Host ('Installation could not finish: ' + $_.Exception.Message) -ForegroundColor Red
    if ($script:LogFile) { Write-Host ('Details: ' + $script:LogFile); Add-Content -LiteralPath $script:LogFile -Value ('FAILED: ' + $_.Exception.Message) -Encoding UTF8 }
    exit 1
} finally {
    if ($scratch -and (Test-Path -LiteralPath $scratch)) { try { Remove-InstallFolder $scratch ([IO.Path]::GetTempPath()) } catch { Write-Host 'Temporary setup files were retained for cleanup later.' } }
}
