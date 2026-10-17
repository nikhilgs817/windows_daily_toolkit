$ErrorActionPreference = 'Stop'
# Compile the shipped C# helper, then test the layout math without changing any displays.
$raw = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\shared\host-script.ts')).Replace("`r`n", "`n")
$marker = '$nativeSrc = @' + "'" + "`n"
$start = $raw.IndexOf($marker)
if ($start -lt 0) { throw 'Native C# start marker not found.' }
$start += $marker.Length
$end = $raw.IndexOf("`n'@", $start)
if ($end -lt 0) { throw 'Native C# end marker not found.' }
Add-Type -TypeDefinition $raw.Substring($start, $end - $start) -ReferencedAssemblies System.Drawing, System.Windows.Forms
$rebase = [DailyOpsDisplay].GetMethod('RebaseSources', [System.Reflection.BindingFlags]'NonPublic,Static')
function Assert-Layout($condition, $name) {
    if (-not $condition) { throw $name }
    Write-Output "PASS  $name"
}
function New-TestMode($type, $x, $y) {
    $mode = [DailyOpsDisplay+MODE]::new()
    $mode.infoType = $type; $mode.x = $x; $mode.y = $y
    return $mode
}

$modes = [DailyOpsDisplay+MODE[]]::new(3)
$modes[0] = New-TestMode 1 1920 -240
$modes[1] = New-TestMode 1 4480 840
$modes[2] = New-TestMode 2 123 456
$null = $rebase.Invoke($null, [object[]](, $modes))
Assert-Layout ($modes[0].x -eq 0 -and $modes[0].y -eq 0) 'removing the main display gives a remaining screen the desktop origin'
Assert-Layout ($modes[1].x -eq 2560 -and $modes[1].y -eq 1080) 'remaining screen positions keep their relative offsets'
Assert-Layout ($modes[2].x -eq 123 -and $modes[2].y -eq 456) 'target timing records remain untouched'

$modes = [DailyOpsDisplay+MODE[]]::new(2)
$modes[0] = New-TestMode 1 -1920 120
$modes[1] = New-TestMode 1 0 0
$null = $rebase.Invoke($null, [object[]](, $modes))
Assert-Layout ($modes[0].x -eq -1920 -and $modes[0].y -eq 120) 'an existing primary source, including a clone, keeps its layout'

# Regression: Settings numbers are physical-connector order, not primary-first
# source names (the reported LG DISPLAY1 / DELL DISPLAY2 mismatch).
function New-TestTarget($name, $connector, $sourceId, $isOn) {
    $target = [DailyOpsDisplay+Target]::new()
    $target.Adapter = 'adapter-a'
    $deviceName = [DailyOpsDisplay+TGTNAME]::new()
    $deviceName.tech = 10; $deviceName.connector = $connector; $deviceName.friendly = $name
    $target.Name = $deviceName
    $path = [DailyOpsDisplay+PATH]::new()
    $source = [DailyOpsDisplay+PSRC]::new(); $source.id = $sourceId; $path.src = $source
    $physical = [DailyOpsDisplay+PTGT]::new(); $physical.id = 256 + $connector; $path.tgt = $physical
    if ($isOn) { $path.flags = 1 }
    $target.Path = $path
    return $target
}
$number = [DailyOpsDisplay].GetMethod('NumberTargets', [System.Reflection.BindingFlags]'NonPublic,Static')
$targets = [System.Collections.Generic.List[DailyOpsDisplay+Target]]::new()
$targets.Add((New-TestTarget 'LG' 9 0 $true))
$targets.Add((New-TestTarget 'DELL' 8 1 $true))
$null = $number.Invoke($null, [object[]](, $targets))
Assert-Layout ($targets[0].Name.friendly -eq 'DELL' -and $targets[0].Number -eq 1) 'DELL connector 8 is display 1 even when its GDI source is DISPLAY2'
Assert-Layout ($targets[1].Name.friendly -eq 'LG' -and $targets[1].Number -eq 2) 'primary LG connector 9 is display 2 even when its GDI source is DISPLAY1'

$targets = [System.Collections.Generic.List[DailyOpsDisplay+Target]]::new()
$targets.Add((New-TestTarget 'LG' 9 0 $true))
$targets.Add((New-TestTarget 'DELL' 8 0 $false))
$targets.Add((New-TestTarget 'Third' 13 2 $true))
$null = $number.Invoke($null, [object[]](, $targets))
Assert-Layout ($targets[0].Number -eq 1 -and $targets[0].Path.flags -eq 0) 'a detected disconnected display keeps its physical number'
Assert-Layout ($targets[1].Name.friendly -eq 'LG' -and $targets[1].Number -eq 2) 'active screens are not renumbered ahead of a detected off screen'
Assert-Layout ($targets[2].Name.friendly -eq 'Third' -and $targets[2].Number -eq 3) 'connector IDs are ranked as displays instead of being printed as numbers'
