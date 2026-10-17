$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $PSScriptRoot '../shared/app-control.ts'
$source = Get-Content -LiteralPath $sourcePath -Raw
$scriptMatch = [regex]::Match($source, 'APP_CONTROL_SCRIPT = String.raw`([\s\S]*?)`;')
if (-not $scriptMatch.Success) { throw 'App control script missing' }
$body = $scriptMatch.Groups[1].Value
$null = [ScriptBlock]::Create($body)
Write-Output 'PASS app-control PowerShell parses without executing any app control'
$nativeMatch = [regex]::Match($body, "(?s)Add-Type @'\r?\n(.*?)\r?\n'@")
if (-not $nativeMatch.Success) { throw 'App window helper missing' }
Add-Type -TypeDefinition $nativeMatch.Groups[1].Value
Write-Output 'PASS app-window helper compiles; no native window methods invoked'
$matchFunction = [regex]::Match($body, '(?s)function Matches-App\(\$p\)\{(.*?)\n\}')
if (-not $matchFunction.Success) { throw 'App identity check missing' }
. ([ScriptBlock]::Create($matchFunction.Value))
$data = @{ selector = @{ names = @('Example App'); path = '[\\/]ExampleApp[\\/]' } }
if (-not (Matches-App ([pscustomobject]@{ProcessName='Example App';Path='C:\Apps\ExampleApp\app.exe'}))) { throw 'Matching identity rejected' }
if (Matches-App ([pscustomobject]@{ProcessName='Example App';Path='C:\Apps\Other\app.exe'})) { throw 'Wrong executable accepted' }
if (Matches-App ([pscustomobject]@{ProcessName='Other';Path='C:\Apps\ExampleApp\app.exe'})) { throw 'Wrong process accepted' }
Write-Output 'PASS app identity requires both the configured process and executable path'
if ($body -notmatch 'foreach\(\$chord in \$chords\)\{Confirm-Target;' -or $body -notmatch 'Confirm-Target;\$element=') { throw 'Per-control foreground guard missing' }
Write-Output 'PASS keyboard chords and menu invokes recheck foreground identity'
if ($source -notmatch 'windowsHide: true' -or $source -notmatch '15000' -or $source -notmatch 'worker.kill\(\)') { throw 'Isolated worker bounds missing' }
Write-Output 'PASS worker runs hidden and stops on timeout'
