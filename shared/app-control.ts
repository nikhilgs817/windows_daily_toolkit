import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import type { AppSelector } from "./companion-specs.js";
import type { PsResult } from "./ps.js";
export type AppControl = { selector: AppSelector; keys?: string; chords?: string[]; menu?: string[][] };
/** Separate worker bounds slow accessibility providers and verifies the foreground app before input. */
export const APP_CONTROL_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$data=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine())) | ConvertFrom-Json
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class ToolkitAppWindow {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a,uint b,bool attach);
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 public delegate bool EnumProc(IntPtr h,IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback,IntPtr l);
 public static IntPtr Window(int pid){IntPtr result=IntPtr.Zero;EnumWindows(delegate(IntPtr h,IntPtr l){uint p;GetWindowThreadProcessId(h,out p);if(p==pid&&IsWindowVisible(h)){result=h;return false;}return true;},IntPtr.Zero);return result;}
 public static int ForegroundPid(){uint p;GetWindowThreadProcessId(GetForegroundWindow(),out p);return (int)p;}
 public static void Focus(IntPtr h){uint pid;uint thread=GetWindowThreadProcessId(GetForegroundWindow(),out pid),me=GetCurrentThreadId();bool attached=thread!=0&&thread!=me&&AttachThreadInput(me,thread,true);try{SetForegroundWindow(h);}finally{if(attached)AttachThreadInput(me,thread,false);}}
}
'@
function Matches-App($p){
 if(-not $p -or $data.selector.names -notcontains $p.ProcessName){return $false}
 if($data.selector.path -and (-not $p.Path -or $p.Path -notmatch $data.selector.path)){return $false}
 return $true
}
try{
 $front=[ToolkitAppWindow]::ForegroundPid()
 $candidates=@(Get-Process | Where-Object {Matches-App $_} | Sort-Object @{Expression={if($_.Id -eq $front){0}else{1}}})
 $chosen=$null;$window=[IntPtr]::Zero
 foreach($candidate in $candidates){$window=[ToolkitAppWindow]::Window($candidate.Id);if($window -ne [IntPtr]::Zero){$chosen=$candidate;break}}
 if(-not $chosen){throw 'Open the app first. No matching app window was found.'}
 if([ToolkitAppWindow]::IsIconic($window)){$null=[ToolkitAppWindow]::ShowWindow($window,9)}
 [ToolkitAppWindow]::Focus($window);Start-Sleep -Milliseconds 120
 function Confirm-Target{if([ToolkitAppWindow]::ForegroundPid() -ne $chosen.Id -or -not (Matches-App (Get-Process -Id $chosen.Id -ErrorAction Stop))){throw 'The app lost focus. No further control was sent.'}}
 Confirm-Target
 if($data.keys){$shell=New-Object -ComObject WScript.Shell;$chords=if($data.chords){@($data.chords)}else{@($data.keys)};foreach($chord in $chords){Confirm-Target;$shell.SendKeys([string]$chord);Start-Sleep -Milliseconds 30}}
 if($data.menu){
  Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
  foreach($names in @($data.menu)){
   Confirm-Target
   $root=[System.Windows.Automation.AutomationElement]::FromHandle([ToolkitAppWindow]::GetForegroundWindow())
   $conditions=@($names | ForEach-Object {[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,[string]$_)})
   $condition=if($conditions.Count -eq 1){$conditions[0]}else{[System.Windows.Automation.OrCondition]::new([System.Windows.Automation.Condition[]]$conditions)}
   $hits=@($root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition) | Where-Object {$_.Current.IsEnabled -and -not $_.Current.IsOffscreen -and $_.Current.ProcessId -eq $chosen.Id})
   $usable=@($hits | Where-Object {$pattern=$null;$_.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern) -or $_.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$pattern) -or $_.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$pattern)})
   if($usable.Count -ne 1){throw 'This control is not uniquely exposed by the app. Set its keyboard shortcut in the key settings.'}
   Confirm-Target;$element=$usable[0];$pattern=$null
   if($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){$pattern.Invoke()}
   elseif($element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$pattern)){$pattern.Expand()}
   elseif($element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$pattern)){$pattern.Select()}
   Start-Sleep -Milliseconds 180
  }
 }
 @{status='ok';message='Control sent'} | ConvertTo-Json -Compress
}catch{@{status='miss';message=$_.Exception.Message} | ConvertTo-Json -Compress}
`;
export function controlApp(data: AppControl): Promise<PsResult> {
	if (process.env.DAILYOPS_DRYRUN === "1" || process.platform !== "win32") {
		if (process.env.DAILYOPS_DRYRUN_LOG) appendFileSync(process.env.DAILYOPS_DRYRUN_LOG, JSON.stringify({ command: "app-control", data }) + "\n");
		return Promise.resolve({ status: "ok", message: "Control simulated" });
	}
	return new Promise((resolve) => {
		const bootstrap = "$s=[Console]::In.ReadLine(); & ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s))))";
		const worker = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(bootstrap, "utf16le").toString("base64")], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
		let output = "", done = false;
		const finish = (result: PsResult) => { if (done) return; done = true; clearTimeout(timer); resolve(result); };
		const timer = setTimeout(() => { worker.kill(); finish({ status: "err", message: "The app did not respond. No further control was sent." }); }, 15000);
		worker.stdin.on("error", () => {});
		worker.stdout.on("data", (part: Buffer) => { if (output.length < 65536) output += part.toString("utf8"); });
		worker.on("error", () => finish({ status: "err", message: "Windows app controls are unavailable" }));
		worker.on("exit", () => { try { const parsed = JSON.parse(output.trim()); finish(parsed.status === "ok" || parsed.status === "miss" ? parsed : { status: "err", message: "The app control failed" }); } catch { finish({ status: "err", message: "The app control failed" }); } });
		worker.stdin.end(Buffer.from(APP_CONTROL_SCRIPT, "utf8").toString("base64") + "\n" + Buffer.from(JSON.stringify(data), "utf8").toString("base64") + "\n");
	});
}
