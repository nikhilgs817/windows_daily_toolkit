$ErrorActionPreference = 'Stop'
function Assert-Credential($condition, $name) {
    if (-not $condition) { throw $name }
    Write-Output ('PASS  ' + $name)
}
# Exercise the actual shipped functions without starting apps or touching real credentials.
$raw = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\shared\host-script.ts')).Replace("`r`n", "`n")
$marker = 'export const HOST_SCRIPT = String.raw' + [char]96 + "`n"
$start = $raw.IndexOf($marker) + $marker.Length
$end = $raw.IndexOf('function Get-Apps', $start)
if ($start -lt $marker.Length -or $end -lt 0) { throw 'Password helper markers missing' }
. ([scriptblock]::Create($raw.Substring($start, $end - $start)))
$sample = '  test-only credential +^%{}[] é 密碼  '
$protected = Protect-Password $sample
Assert-Credential ($protected.StartsWith('dpapi:v1:') -and -not $protected.Contains($sample)) 'password is stored as DPAPI ciphertext'
Assert-Credential ((Unprotect-Password $protected) -ceq $sample) 'DPAPI preserves whitespace, Unicode and special characters'
Assert-Credential ((Protect-Password $sample) -cne $protected) 'DPAPI uses different ciphertext on repeated encryption'
$bytes = [Convert]::FromBase64String($protected.Substring(9))
$bytes[$bytes.Length - 5] = $bytes[$bytes.Length - 5] -bxor 1
$rejected = $false
try { $null = Unprotect-Password ('dpapi:v1:' + [Convert]::ToBase64String($bytes)) } catch { $rejected = $true }
Assert-Credential $rejected 'tampered ciphertext is rejected'
$rejected = $false
try { $null = Unprotect-Password 'base64:plaintext' } catch { $rejected = $true }
Assert-Credential $rejected 'unprotected password formats are rejected'
$bound = Protect-Password $sample 'appid:first-app'
Assert-Credential ((Unprotect-Password $bound 'appid:first-app') -ceq $sample) 'saved passwords decrypt for their selected app binding'
$rejected = $false
try { $null = Unprotect-Password $bound 'appid:different-app' } catch { $rejected = $true }
Assert-Credential $rejected 'changing the app binding prevents password decryption'

$native = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\shared\credentials-native.ts')).Replace("`r`n", "`n")
$marker = 'export const LOGIN_NATIVE = String.raw' + [char]96 + "`n"
$start = $native.IndexOf($marker) + $marker.Length
$end = $native.IndexOf("`n" + [char]96 + ';', $start)
if ($start -lt $marker.Length -or $end -lt 0) { throw 'Login helper markers missing' }
Add-Type -TypeDefinition $native.Substring($start, $end - $start) -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase
Assert-Credential ([DailyOpsLogin]::UsernameIndex(@('Search', 'Username', 'Symbol')) -eq 1) 'username detection ignores search and symbol fields'
Assert-Credential ([DailyOpsLogin]::UsernameIndex(@('Email', 'Username')) -eq -1) 'ambiguous username forms are rejected'
Assert-Credential ([DailyOpsLogin]::UsernameIndex(@('Search', 'Verification code')) -eq -1) 'non-login forms are rejected'
Assert-Credential ([DailyOpsLogin]::MatchesPath('C:\Apps\Sample.exe', 'c:\apps\SAMPLE.exe')) 'desktop executable identity matches the full path'
Assert-Credential (-not [DailyOpsLogin]::MatchesPath('C:\Apps\Sample.exe', 'C:\Other\Sample.exe')) 'same executable name in another folder is rejected'
Assert-Credential (-not [DailyOpsLogin]::MatchesPath('C:\Apps\Sample\launcher.exe', 'C:\Apps\Sample\jre\bin\javaw.exe')) 'a different runtime in the selected app folder is rejected'
Assert-Credential (-not [DailyOpsLogin]::MatchesPath('', 'C:\Apps\Sample.exe')) 'an empty executable identity is rejected'
$sample = $null; $protected = $null
