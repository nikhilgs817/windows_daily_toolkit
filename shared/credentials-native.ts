/** Runs in a dedicated, bounded worker; a slow accessibility provider cannot block deck controls. */
export const LOGIN_NATIVE = String.raw`
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Automation;

public static class DailyOpsLogin {
	[DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
	[DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
	[DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)] static extern int GetApplicationUserModelId(IntPtr process, ref uint length, StringBuilder id);
	public static bool MatchesPath(string expected, string actual) {
		if (string.IsNullOrEmpty(expected) || string.IsNullOrEmpty(actual)) return false;
		try {
			expected = Path.GetFullPath(expected); actual = Path.GetFullPath(actual);
			return string.Equals(expected, actual, StringComparison.OrdinalIgnoreCase);
		} catch { return false; }
	}
	static bool Matches(IntPtr window, string exe, string appId) {
		if (window == IntPtr.Zero) return false;
		uint pid; GetWindowThreadProcessId(window, out pid);
		try {
			using (Process p = Process.GetProcessById((int)pid)) {
				if (!string.IsNullOrEmpty(appId)) {
					uint length = 0; GetApplicationUserModelId(p.Handle, ref length, null);
					if (length > 0 && length < 4096) {
						StringBuilder id = new StringBuilder((int)length);
						if (GetApplicationUserModelId(p.Handle, ref length, id) == 0 && string.Equals(id.ToString(), appId, StringComparison.OrdinalIgnoreCase)) return true;
					}
				}
				return MatchesPath(exe, p.MainModule.FileName);
			}
		} catch { return false; }
	}
	public static int UsernameIndex(string[] names) {
		int found = -1;
		for (int i = 0; i < names.Length; i++) {
			string name = names[i] ?? "";
			if (!Regex.IsMatch(name, @"user|e[ -]?mail|login[ _-]?(id|name)|account[ _-]?(id|name)", RegexOptions.IgnoreCase)) continue;
			if (Regex.IsMatch(name, @"password|search|symbol|verification|one.?time|confirm|otp", RegexOptions.IgnoreCase)) continue;
			if (found >= 0) return -1; // An ambiguous form must never receive a password.
			found = i;
		}
		return found;
	}
	static bool IsNativeField(AutomationElement field, AutomationElement root) {
		// Process identity cannot verify a website's origin. Only fill native desktop controls.
		AutomationElement node = field;
		for (int depth = 0; node != null && depth < 64; depth++) {
			if (node.Current.ControlType == ControlType.Document) return false;
			if (Automation.Compare(node, root)) return true;
			node = TreeWalker.ControlViewWalker.GetParent(node);
		}
		return false;
	}
	public static string Fill(string exe, string appId, string username, string password, int timeoutMs) {
		if (string.IsNullOrEmpty(exe) && string.IsNullOrEmpty(appId)) return "identity";
		bool seen = false;
		Stopwatch timer = Stopwatch.StartNew();
		while (timer.ElapsedMilliseconds < timeoutMs) {
			IntPtr window = GetForegroundWindow();
			if (!Matches(window, exe, appId)) {
				if (seen) return "focus";
				Thread.Sleep(200); continue;
			}
			seen = true;
			try {
				AutomationElement root = AutomationElement.FromHandle(window);
				AutomationElementCollection edits = root.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit));
				if (edits.Count > 100) return "fields";
				AutomationElement pass = null;
				List<AutomationElement> users = new List<AutomationElement>();
				List<string> names = new List<string>();
				foreach (AutomationElement edit in edits) {
					if (!edit.Current.IsEnabled || edit.Current.IsOffscreen) continue;
					if (edit.Current.IsPassword) { if (pass != null) return "fields"; pass = edit; }
					else {
						string name = edit.Current.Name + " " + edit.Current.AutomationId;
						AutomationElement label = edit.Current.LabeledBy;
						if (label != null) name += " " + label.Current.Name;
						users.Add(edit); names.Add(name);
					}
				}
				int index = UsernameIndex(names.ToArray());
				if (pass != null && index >= 0) {
					AutomationElement user = users[index]; object up, pp;
					if (!IsNativeField(user, root) || !IsNativeField(pass, root)) return "unsupported";
					if (!user.TryGetCurrentPattern(ValuePattern.Pattern, out up) || !pass.TryGetCurrentPattern(ValuePattern.Pattern, out pp)) return "unsupported";
					ValuePattern uv = (ValuePattern)up, pv = (ValuePattern)pp;
					if (uv.Current.IsReadOnly || pv.Current.IsReadOnly) return "unsupported";
					if (GetForegroundWindow() != window || !Matches(window, exe, appId)) return "focus";
					uv.SetValue(username);
					if (GetForegroundWindow() != window || !Matches(window, exe, appId) || !pass.Current.IsPassword || !pass.Current.IsEnabled || pass.Current.IsOffscreen) return "focus";
					pv.SetValue(password);
					return "ok"; // Never invoke a button, Enter key, or clipboard operation.
				}
			} catch (ElementNotAvailableException) { }
			catch (InvalidOperationException) { return "unsupported"; }
			catch { return "fields"; }
			Thread.Sleep(200);
		}
		return seen ? "fields" : "identity";
	}
}
`;

export const LOGIN_WORKER = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
	$payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine())) | ConvertFrom-Json
	Add-Type -AssemblyName System.Security
	Add-Type -TypeDefinition @'
${LOGIN_NATIVE}
'@ -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase
	$utf8 = New-Object System.Text.UTF8Encoding $false
	$expectedExe = ''
	$expectedId = [string]$payload.appId
	if ($expectedId) {
		if ([IO.Path]::IsPathRooted($expectedId) -and [IO.Path]::GetExtension($expectedId) -eq '.exe') { $expectedExe = [Environment]::ExpandEnvironmentVariables($expectedId) }
		else {
			try {
				$item = (New-Object -ComObject Shell.Application).NameSpace('shell:AppsFolder').ParseName($expectedId)
				$path = [string]$item.ExtendedProperty('System.Link.TargetParsingPath')
				if ($path -and [IO.Path]::IsPathRooted($path) -and [IO.Path]::GetExtension($path) -eq '.exe') { $expectedExe = $path }
			} catch { }
		}
	} elseif ($payload.target) {
		$path = [Environment]::ExpandEnvironmentVariables(([string]$payload.target).Trim().Trim('"'))
		if ([IO.Path]::IsPathRooted($path) -and [IO.Path]::GetExtension($path) -eq '.exe') { $expectedExe = $path }
	}
	if (-not $expectedExe -and -not $expectedId) { [Console]::Out.WriteLine('identity'); exit }
	$protected = [string]$payload.protectedPassword
	if (-not $protected.StartsWith('dpapi:v1:')) { throw 'format' }
	$bytes = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($protected.Substring(9)), $utf8.GetBytes('com.dailyops.v2.credentials.v1|' + [string]$payload.binding), [Security.Cryptography.DataProtectionScope]::CurrentUser)
	$password = $utf8.GetString($bytes)
	[Array]::Clear($bytes, 0, $bytes.Length)
	[Console]::Out.WriteLine([DailyOpsLogin]::Fill($expectedExe, $expectedId, [string]$payload.username, $password, 12000))
} catch { [Console]::Out.WriteLine('unavailable') }
finally { $password = $null; $payload = $null }
`;
