/**
 * PowerShell "host" kept alive for the plugin's lifetime. It reads one command per line on stdin:
 *   <id> TAB <command> [TAB <base64 utf-8 arg>]...
 * and replies on stdout:
 *   <id> TAB ok|miss|err TAB <base64 utf-8 message>
 * Passed to powershell.exe with -EncodedCommand, so script execution policy does not apply.
 * Only a fixed set of commands is accepted — nothing from settings is ever evaluated as code.
 */
export const HOST_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$utf8 = New-Object System.Text.UTF8Encoding $false
$script:apps = $null
$script:wsh = $null

function D([string]$s) { if ([string]::IsNullOrEmpty($s)) { return '' }; return $utf8.GetString([Convert]::FromBase64String($s)) }
function E([string]$s) { return [Convert]::ToBase64String($utf8.GetBytes([string]$s)) }
function X([string]$p) { return [Environment]::ExpandEnvironmentVariables($p.Trim().Trim('"')) }

# DPAPI uses the current Windows user; data travels over stdin, never process arguments.
function Protect-Password([string]$password, [string]$binding = '') {
	Add-Type -AssemblyName System.Security
	$bytes = $utf8.GetBytes($password)
	try { return 'dpapi:v1:' + [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($bytes, $utf8.GetBytes('com.dailyops.v2.credentials.v1|' + $binding), [Security.Cryptography.DataProtectionScope]::CurrentUser)) }
	finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}
function Unprotect-Password([string]$protected, [string]$binding = '') {
	if (-not $protected.StartsWith('dpapi:v1:')) { throw 'Unsupported password format.' }
	Add-Type -AssemblyName System.Security
	$bytes = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($protected.Substring(9)), $utf8.GetBytes('com.dailyops.v2.credentials.v1|' + $binding), [Security.Cryptography.DataProtectionScope]::CurrentUser)
	try { return $utf8.GetString($bytes) }
	finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}

function Get-Apps([bool]$refresh) {
	if ($refresh -or $null -eq $script:apps) { $script:apps = @(Get-StartApps | Where-Object { $_.AppID -and $_.Name }) }
	return $script:apps
}

function Find-App([string[]]$names) {
	foreach ($pass in 0, 1) {
		$all = Get-Apps ($pass -eq 1)
		foreach ($n in $names) {
			if (-not $n) { continue }
			# Prefer real desktop/Store apps over browser-installed web apps (Chrome/Edge "_crx_" shortcuts).
			$hit = $all | Where-Object { $_.Name -eq $n } | Sort-Object { [int]($_.AppID -match '_crx_') } | Select-Object -First 1
			if (-not $hit) {
				$pat = '*' + [Management.Automation.WildcardPattern]::Escape($n) + '*'
				$hit = $all | Where-Object { $_.Name -like $pat -and $_.Name -notmatch 'uninstall|help|readme|release notes' } |
					Sort-Object { [int]($_.AppID -match '_crx_') }, { $_.Name.Length } | Select-Object -First 1
			}
			if ($hit) { return $hit }
		}
	}
	return $null
}

function Start-AppId([string]$id) {
	try { Start-Process -FilePath ('shell:AppsFolder\' + $id) }
	catch { Start-Process -FilePath "$env:WINDIR\explorer.exe" -ArgumentList ('shell:AppsFolder\' + $id) }
}

function Shots-Folder { return (Join-Path ([Environment]::GetFolderPath('MyPictures')) 'Screenshots') }

function Shell { if ($null -eq $script:wsh) { $script:wsh = New-Object -ComObject WScript.Shell }; return $script:wsh }

function Downloads-Path {
	try { $p = (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path; if ($p) { return $p } } catch { }
	return (Join-Path $env:USERPROFILE 'Downloads')
}

$nativeSrc = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class DailyOpsIcon {
	[ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	private interface IShellItemImageFactory { [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr phbm); }
	[StructLayout(LayoutKind.Sequential)] private struct SIZE { public int cx; public int cy; }
	[StructLayout(LayoutKind.Sequential)] private struct BITMAP { public int bmType; public int bmWidth; public int bmHeight; public int bmWidthBytes; public ushort bmPlanes; public ushort bmBitsPixel; public IntPtr bmBits; }
	[StructLayout(LayoutKind.Sequential)] private struct BITMAPINFOHEADER { public uint biSize; public int biWidth; public int biHeight; public ushort biPlanes; public ushort biBitCount; public uint biCompression; public uint biSizeImage; public int biXPelsPerMeter; public int biYPelsPerMeter; public uint biClrUsed; public uint biClrImportant; }
	[StructLayout(LayoutKind.Sequential)] private struct DIBSECTION { public BITMAP dsBm; public BITMAPINFOHEADER dsBmih; public uint b0; public uint b1; public uint b2; public IntPtr dshSection; public uint dsOffset; }
	[DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
	private static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory ppv);
	[DllImport("gdi32.dll")] private static extern int GetObject(IntPtr h, int c, ref DIBSECTION ds);
	[DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr h);

	// Returns the item's icon (the same art Windows shows in Start / the taskbar) as a base64 PNG.
	public static string Png(string parsingName, int size) {
		IShellItemImageFactory f;
		SHCreateItemFromParsingName(parsingName, IntPtr.Zero, typeof(IShellItemImageFactory).GUID, out f);
		IntPtr hbm;
		int hr = f.GetImage(new SIZE { cx = size, cy = size }, 0x1 | 0x4, out hbm); // BIGGERSIZEOK | ICONONLY
		if (hr != 0) Marshal.ThrowExceptionForHR(hr);
		try {
			DIBSECTION ds = new DIBSECTION();
			int n = GetObject(hbm, Marshal.SizeOf(typeof(DIBSECTION)), ref ds);
			Bitmap result;
			if (n > 0 && ds.dsBm.bmBitsPixel == 32 && ds.dsBm.bmBits != IntPtr.Zero) {
				int w = ds.dsBm.bmWidth, h = Math.Abs(ds.dsBm.bmHeight), stride = ds.dsBm.bmWidthBytes;
				bool hasAlpha = false;
				byte[] row = new byte[stride];
				for (int y = 0; y < h && !hasAlpha; y++) {
					Marshal.Copy(new IntPtr(ds.dsBm.bmBits.ToInt64() + (long)stride * y), row, 0, stride);
					for (int x = 3; x < w * 4; x += 4) { if (row[x] != 0) { hasAlpha = true; break; } }
				}
				bool bottomUp = ds.dsBmih.biHeight > 0;
				IntPtr scan0 = bottomUp ? new IntPtr(ds.dsBm.bmBits.ToInt64() + (long)stride * (h - 1)) : ds.dsBm.bmBits;
				using (Bitmap src = new Bitmap(w, h, bottomUp ? -stride : stride, hasAlpha ? PixelFormat.Format32bppPArgb : PixelFormat.Format32bppRgb, scan0)) {
					result = new Bitmap(w, h, PixelFormat.Format32bppArgb);
					using (Graphics g = Graphics.FromImage(result)) { g.DrawImage(src, new Rectangle(0, 0, w, h)); }
				}
			} else {
				result = Image.FromHbitmap(hbm);
			}
			using (result) using (MemoryStream ms = new MemoryStream()) { result.Save(ms, ImageFormat.Png); return Convert.ToBase64String(ms.ToArray()); }
		} finally { DeleteObject(hbm); }
	}
}
public static class DailyOpsWin {
	private delegate bool EnumProc(IntPtr h, IntPtr l);
	private delegate bool MonitorEnumProc(IntPtr hMon, IntPtr hdc, ref RECT r, IntPtr d);
	[StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
	[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct MONITORINFOEX { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice; }
	public class Mon { public IntPtr H; public RECT Area; public RECT Work; public bool Primary; public int Num; }
	[DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc cb, IntPtr l);
	[DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
	[DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr h);
	[DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr h, uint cmd);
	[DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr h, int idx);
	[DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);
	[DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
	[DllImport("user32.dll")] private static extern bool IsZoomed(IntPtr h);
	[DllImport("user32.dll")] private static extern bool IsIconic(IntPtr h);
	[DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr h, int cmd);
	[DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
	[DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr h, out RECT r);
	[DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr h);
	[DllImport("user32.dll")] private static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc cb, IntPtr d);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool GetMonitorInfo(IntPtr hMon, ref MONITORINFOEX mi);
	[DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
	[DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);

	private static void PerMonitorDpi() { try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { } }

	// A normal, user-facing top-level window (not a tool window, popup owner, hidden or cloaked UWP shell).
	private static bool IsAppWindow(IntPtr h) {
		if (h == IntPtr.Zero || !IsWindowVisible(h)) return false;
		if (GetWindow(h, 4) != IntPtr.Zero) return false;
		int ex = GetWindowLong(h, -20);
		if ((ex & 0x80) != 0) return false;
		if (GetWindowTextLength(h) == 0) return false;
		int cloaked;
		if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return false;
		return true;
	}

	public static long[] Snapshot() {
		List<long> list = new List<long>();
		EnumWindows(delegate (IntPtr h, IntPtr l) { if (IsAppWindow(h)) list.Add(h.ToInt64()); return true; }, IntPtr.Zero);
		return list.ToArray();
	}

	public static long Foreground() { return GetForegroundWindow().ToInt64(); }

	// "\\.\DISPLAY3" -> 3 (the number Windows shows in Settings > Display, in most setups).
	private static int DisplayNumber(string dev) {
		if (string.IsNullOrEmpty(dev)) return 999;
		int i = dev.Length;
		while (i > 0 && char.IsDigit(dev[i - 1])) i--;
		int n;
		return int.TryParse(dev.Substring(i), out n) ? n : 999;
	}

	// order "windows": same numbers as Windows Display settings. "primary": main display = 1, then left-to-right.
	// "left": strictly left-to-right.
	public static List<Mon> Monitors(string order) {
		PerMonitorDpi();
		List<Mon> mons = new List<Mon>();
		EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate (IntPtr hm, IntPtr hdc, ref RECT r, IntPtr d) {
			MONITORINFOEX mi = new MONITORINFOEX(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
			if (GetMonitorInfo(hm, ref mi)) mons.Add(new Mon { H = hm, Area = mi.rcMonitor, Work = mi.rcWork, Primary = (mi.dwFlags & 1) != 0, Num = DisplayNumber(mi.szDevice) });
			return true;
		}, IntPtr.Zero);
		mons.Sort(delegate (Mon a, Mon b) {
			if (order == "windows" && a.Num != b.Num) return a.Num.CompareTo(b.Num);
			if (order == "primary" && a.Primary != b.Primary) return a.Primary ? -1 : 1;
			if (a.Area.L != b.Area.L) return a.Area.L.CompareTo(b.Area.L);
			return a.Area.T.CompareTo(b.Area.T);
		});
		return mons;
	}

	public static string Describe(string order) {
		List<Mon> m = Monitors(order);
		List<string> parts = new List<string>();
		for (int i = 0; i < m.Count; i++) parts.Add("{\"n\":" + (i + 1) + ",\"w\":" + (m[i].Area.R - m[i].Area.L) + ",\"h\":" + (m[i].Area.B - m[i].Area.T) + ",\"x\":" + m[i].Area.L + ",\"y\":" + m[i].Area.T + ",\"primary\":" + (m[i].Primary ? "true" : "false") + ",\"win\":" + m[i].Num + "}");
		return "[" + string.Join(",", parts.ToArray()) + "]";
	}

	// Waits (on a background thread) for the window the launch produced, then moves it to monitor #index (0-based).
	public static void PlaceAsync(long[] before, long fgBefore, int index, string order, int timeoutMs) {
		Thread t = new Thread(delegate () { try { Place(before, new IntPtr(fgBefore), index, order, timeoutMs); } catch { } });
		t.IsBackground = true;
		t.Start();
	}

	private static void Place(long[] before, IntPtr fgBefore, int index, string order, int timeoutMs) {
		PerMonitorDpi();
		HashSet<long> seen = new HashSet<long>(before);
		IntPtr target = IntPtr.Zero;
		Stopwatch sw = Stopwatch.StartNew();
		while (sw.ElapsedMilliseconds < timeoutMs && target == IntPtr.Zero) {
			Thread.Sleep(120);
			IntPtr found = IntPtr.Zero;
			EnumWindows(delegate (IntPtr h, IntPtr l) { if (!seen.Contains(h.ToInt64()) && IsAppWindow(h)) { found = h; return false; } return true; }, IntPtr.Zero);
			if (found != IntPtr.Zero) { target = found; break; }
			// Single-instance apps (already open) don't create a window — they come to the front instead.
			if (sw.ElapsedMilliseconds > 1200) {
				IntPtr fg = GetForegroundWindow();
				if (fg != fgBefore && IsAppWindow(fg)) target = fg;
			}
		}
		if (target == IntPtr.Zero) return;
		Thread.Sleep(300); // let the app finish its own start-up positioning
		Move(target, index, order);
		Thread.Sleep(900); // some apps restore a saved position a moment later — correct once more
		Move(target, index, order);
	}

	public static bool Move(IntPtr h, int index, string order) {
		List<Mon> mons = Monitors(order);
		if (mons.Count == 0) return false;
		Mon m = mons[Math.Max(0, Math.Min(index, mons.Count - 1))];
		IntPtr current = MonitorFromWindow(h, 2);
		bool wasMax = IsZoomed(h);
		if (current == m.H && !IsIconic(h)) { SetForegroundWindow(h); return true; }
		if (wasMax || IsIconic(h)) ShowWindow(h, 9);
		RECT r; GetWindowRect(h, out r);
		int w = r.R - r.L, hh = r.B - r.T;
		int ww = m.Work.R - m.Work.L, wh = m.Work.B - m.Work.T;
		w = Math.Min(w, ww); hh = Math.Min(hh, wh);
		int x = m.Work.L + (ww - w) / 2, y = m.Work.T + (wh - hh) / 2;
		SetWindowPos(h, IntPtr.Zero, x, y, w, hh, 0x0004 | 0x0010);
		if (wasMax) ShowWindow(h, 3);
		SetForegroundWindow(h);
		return true;
	}
	[DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
	[DllImport("user32.dll")] private static extern bool AttachThreadInput(uint a, uint b, bool attach);
	[DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
	[DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr h);
	[DllImport("user32.dll")] private static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

	public static string ForegroundProcess() {
		IntPtr h = GetForegroundWindow();
		if (h == IntPtr.Zero) return "";
		uint pid; GetWindowThreadProcessId(h, out pid);
		try { return Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
	}
	public static string ForegroundIdentity() {
		IntPtr h = GetForegroundWindow(); uint pid;
		if (h == IntPtr.Zero) return "\n\n0";
		GetWindowThreadProcessId(h, out pid);
		try { Process p = Process.GetProcessById((int)pid); string path = ""; try { path = p.MainModule.FileName; } catch { }
			return p.ProcessName + "\n" + path + "\n" + pid.ToString();
		} catch { return "\n\n0"; }
	}

	// Brings the most recent window of any of the named processes to the front. Returns false if none is running.
	public static bool Activate(string names) {
		HashSet<uint> pids = new HashSet<uint>();
		foreach (string n in names.Split('|')) { foreach (Process p in Process.GetProcessesByName(n)) pids.Add((uint)p.Id); }
		if (pids.Count == 0) return false;
		IntPtr fg = GetForegroundWindow(); uint fpid; GetWindowThreadProcessId(fg, out fpid);
		if (pids.Contains(fpid)) return true;
		IntPtr best = IntPtr.Zero;
		EnumWindows(delegate (IntPtr h, IntPtr l) { uint wp; GetWindowThreadProcessId(h, out wp); if (pids.Contains(wp) && IsAppWindow(h)) { best = h; return false; } return true; }, IntPtr.Zero);
		if (best == IntPtr.Zero) return false;
		if (IsIconic(best)) ShowWindow(best, 9);
		uint fgThread = GetWindowThreadProcessId(fg, out fpid), me = GetCurrentThreadId();
		bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
		BringWindowToTop(best);
		bool ok = SetForegroundWindow(best);
		if (attached) AttachThreadInput(me, fgThread, false);
		if (!ok) { keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero); SetForegroundWindow(best); }
		return true;
	}

	private static Thread watcher;
	// Emits "0<TAB>fg<TAB><base64 process name>" whenever the foreground app changes.
	public static void WatchForeground(int intervalMs) {
		if (watcher != null) return;
		watcher = new Thread(delegate () {
			string last = null;
			while (true) {
				try {
					string identity = ForegroundIdentity();
					string n = identity.Split('\n')[0];
					if (identity != last) {
						last = identity;
						Console.Out.WriteLine("0\tfg\t" + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(n)));
						Console.Out.WriteLine("0\tfgdetail\t" + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(identity)));
						Console.Out.Flush();
					}
				} catch { }
				Thread.Sleep(intervalMs);
			}
		});
		watcher.IsBackground = true;
		watcher.Start();
	}
}
// Turns individual screens on and off (Windows "Disconnect this display" + DDC/CI sleep) and reports their state.
public static class DailyOpsDisplay {
	[StructLayout(LayoutKind.Sequential)] public struct LUID { public uint Low; public int High; }
	[StructLayout(LayoutKind.Sequential)] public struct PSRC { public LUID adapterId; public uint id; public uint modeInfoIdx; public uint statusFlags; }
	[StructLayout(LayoutKind.Sequential)] public struct RATIONAL { public uint N; public uint D; }
	[StructLayout(LayoutKind.Sequential)] public struct PTGT { public LUID adapterId; public uint id; public uint modeInfoIdx; public uint outputTechnology; public uint rotation; public uint scaling; public RATIONAL refreshRate; public uint scanLineOrdering; public int targetAvailable; public uint statusFlags; }
	[StructLayout(LayoutKind.Sequential)] public struct PATH { public PSRC src; public PTGT tgt; public uint flags; }
	[StructLayout(LayoutKind.Explicit, Size = 64)] public struct MODE {
		[FieldOffset(0)] public uint infoType; [FieldOffset(4)] public uint id; [FieldOffset(8)] public LUID adapterId;
		[FieldOffset(16)] public uint width; [FieldOffset(20)] public uint height; [FieldOffset(28)] public int x; [FieldOffset(32)] public int y;
		[FieldOffset(16)] public ulong u16; [FieldOffset(24)] public ulong u24; [FieldOffset(32)] public ulong u32; [FieldOffset(40)] public ulong u40; [FieldOffset(48)] public ulong u48; [FieldOffset(56)] public ulong u56;
	}
	[StructLayout(LayoutKind.Sequential)] public struct HDR { public uint type; public uint size; public LUID adapterId; public uint id; }
	[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct SRCNAME { public HDR h; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string gdi; }
	[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct TGTNAME { public HDR h; public uint flags; public uint tech; public ushort mfg; public ushort product; public uint connector; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string friendly; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string path; }
	[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct ADAPTERNAME { public HDR h; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string path; }
	public class Target { public PATH Path; public TGTNAME Name; public string Adapter; public int Number; }
	[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct PHYS { public IntPtr h; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string desc; }
	[StructLayout(LayoutKind.Sequential)] private struct RC { public int L; public int T; public int R; public int B; }
	[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct MINFO { public int cbSize; public RC rcMonitor; public RC rcWork; public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice; }
	private delegate bool MonProc(IntPtr hMon, IntPtr hdc, ref RC r, IntPtr d);

	[DllImport("user32.dll")] private static extern int GetDisplayConfigBufferSizes(uint flags, out uint np, out uint nm);
	[DllImport("user32.dll")] private static extern int QueryDisplayConfig(uint flags, ref uint np, [Out] PATH[] paths, ref uint nm, [Out] MODE[] modes, IntPtr topology);
	[DllImport("user32.dll")] private static extern int SetDisplayConfig(uint np, [In] PATH[] paths, uint nm, [In] MODE[] modes, uint flags);
	[DllImport("user32.dll")] private static extern int DisplayConfigGetDeviceInfo(ref SRCNAME r);
	[DllImport("user32.dll")] private static extern int DisplayConfigGetDeviceInfo(ref TGTNAME r);
	[DllImport("user32.dll")] private static extern int DisplayConfigGetDeviceInfo(ref ADAPTERNAME r);
	[DllImport("user32.dll")] private static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonProc cb, IntPtr d);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool GetMonitorInfo(IntPtr hMon, ref MINFO mi);
	[DllImport("dxva2.dll")] private static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr h, out uint n);
	[DllImport("dxva2.dll")] private static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr h, uint n, [Out] PHYS[] arr);
	[DllImport("dxva2.dll")] private static extern bool SetVCPFeature(IntPtr h, byte code, uint value);
	[DllImport("dxva2.dll")] private static extern bool DestroyPhysicalMonitors(uint n, [In] PHYS[] arr);

	private const uint QDC_ALL_PATHS = 1, QDC_ONLY_ACTIVE_PATHS = 2, ACTIVE = 1, INVALID = 0xffffffff;
	private const uint SDC_TOPOLOGY_EXTEND = 0x4, SDC_TOPOLOGY_SUPPLIED = 0x10, SDC_USE_SUPPLIED = 0x20, SDC_APPLY = 0x80, SDC_SAVE = 0x200, SDC_ALLOW_CHANGES = 0x400, SDC_ALLOW_PATH_ORDER = 0x2000;

	private static void Query(uint flags, out PATH[] paths, out MODE[] modes) {
		for (int attempt = 0; ; attempt++) {
			uint np, nm;
			int r = GetDisplayConfigBufferSizes(flags, out np, out nm);
			if (r != 0) throw new Exception("Can't read the display setup (error " + r + ").");
			paths = new PATH[np]; modes = new MODE[nm];
			r = QueryDisplayConfig(flags, ref np, paths, ref nm, modes, IntPtr.Zero);
			if (r == 122 && attempt < 5) continue; // screens changed between the two calls
			if (r != 0) throw new Exception("Can't read the display setup (error " + r + ").");
			Array.Resize(ref paths, (int)np); Array.Resize(ref modes, (int)nm);
			return;
		}
	}

	private static string Gdi(LUID a, uint id) {
		SRCNAME s = new SRCNAME(); s.h.type = 1; s.h.size = (uint)Marshal.SizeOf(typeof(SRCNAME)); s.h.adapterId = a; s.h.id = id;
		return DisplayConfigGetDeviceInfo(ref s) == 0 ? (s.gdi ?? "") : "";
	}
	private static TGTNAME Tgt(LUID a, uint id) {
		TGTNAME t = new TGTNAME(); t.h.type = 2; t.h.size = (uint)Marshal.SizeOf(typeof(TGTNAME)); t.h.adapterId = a; t.h.id = id;
		DisplayConfigGetDeviceInfo(ref t);
		return t;
	}
	private static string AdapterName(LUID a) {
		ADAPTERNAME n = new ADAPTERNAME(); n.h.type = 4; n.h.size = (uint)Marshal.SizeOf(typeof(ADAPTERNAME)); n.h.adapterId = a;
		return DisplayConfigGetDeviceInfo(ref n) == 0 ? (n.path ?? "") : a.High + ":" + a.Low;
	}
	private static int ConnectorPriority(uint tech) {
		// CCD connector ordering follows Settings on the verified hardware. GDI DISPLAYn
		// and QueryDisplayConfig path order instead follow mutable source/primary order.
		// Windows does not expose a documented Settings-number API; do not use GDI as one.
		switch (tech) {
			case 0x80000000: return 0; // internal
			case 11: case 6: return 1; // embedded DisplayPort / LVDS
			case 4: return 2; // DVI
			case 10: return 3; // external DisplayPort
			case 5: return 4; // HDMI
			default: return 5;
		}
	}
	private static void NumberTargets(List<Target> targets) {
		targets.Sort(delegate(Target a, Target b) {
			int c = StringComparer.OrdinalIgnoreCase.Compare(a.Adapter, b.Adapter);
			if (c == 0) c = ConnectorPriority(a.Name.tech).CompareTo(ConnectorPriority(b.Name.tech));
			if (c == 0) c = a.Name.connector.CompareTo(b.Name.connector);
			if (c == 0) c = a.Path.tgt.id.CompareTo(b.Path.tgt.id);
			return c;
		});
		for (int i = 0; i < targets.Count; i++) targets[i].Number = i + 1;
	}
	private static string RawKey(PTGT t) { return t.adapterId.High + ":" + t.adapterId.Low + ":" + t.id; }
	// Stable identity of a screen: its monitor device path (survives reboots), else adapter + target.
	private static string KeyOf(PTGT t) { TGTNAME n = Tgt(t.adapterId, t.id); return string.IsNullOrEmpty(n.path) ? RawKey(t) : n.path; }
	private static bool Same(LUID a, LUID b) { return a.Low == b.Low && a.High == b.High; }
	private static int Num(string dev) {
		if (string.IsNullOrEmpty(dev)) return 0;
		int i = dev.Length; while (i > 0 && char.IsDigit(dev[i - 1])) i--;
		int n; return int.TryParse(dev.Substring(i), out n) ? n : 0;
	}
	private static string J(string s) { return "\"" + (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""; }
	private static bool IsMain(PATH p, MODE[] modes) {
		uint mi = p.src.modeInfoIdx;
		return mi < modes.Length && modes[mi].infoType == 1 && modes[mi].x == 0 && modes[mi].y == 0;
	}

	// The physical display number is separate from the GDI source number used to restore a path.
	public static string List() {
		PATH[] paths; MODE[] modes; Query(QDC_ALL_PATHS, out paths, out modes);
		HashSet<string> seen = new HashSet<string>();
		Dictionary<string, string> adapters = new Dictionary<string, string>();
		List<Target> targets = new List<Target>();
		List<string> outp = new List<string>();
		for (int pass = 0; pass < 2; pass++) {
			foreach (PATH p in paths) {
				bool on = (p.flags & ACTIVE) != 0;
				if (pass == 0 ? !on : (on || p.tgt.targetAvailable == 0)) continue;
				string raw = RawKey(p.tgt);
				if (!seen.Add(raw)) continue;
				TGTNAME n = Tgt(p.tgt.adapterId, p.tgt.id);
				string adapter = p.tgt.adapterId.High + ":" + p.tgt.adapterId.Low;
				if (!adapters.ContainsKey(adapter)) adapters[adapter] = AdapterName(p.tgt.adapterId);
				targets.Add(new Target { Path = p, Name = n, Adapter = adapters[adapter] });
			}
		}
		NumberTargets(targets);
		foreach (Target t in targets) {
			PATH p = t.Path; TGTNAME n = t.Name; bool on = (p.flags & ACTIVE) != 0;
			string key = string.IsNullOrEmpty(n.path) ? RawKey(p.tgt) : n.path;
			int source = on ? Num(Gdi(p.src.adapterId, p.src.id)) : 0;
			outp.Add("{\"key\":" + J(key) + ",\"name\":" + J(n.friendly) + ",\"on\":" + (on ? "true" : "false") + ",\"num\":" + t.Number + ",\"gdiNum\":" + source + ",\"primary\":" + (on && IsMain(p, modes) ? "true" : "false") + "}");
		}
		return "[" + string.Join(",", outp.ToArray()) + "]";
	}

	public static bool IsOn(string key) {
		PATH[] paths; MODE[] modes; Query(QDC_ONLY_ACTIVE_PATHS, out paths, out modes);
		foreach (PATH p in paths) if (KeyOf(p.tgt) == key) return true;
		return false;
	}

	// Keys of connected screens that are currently off.
	public static string[] OffKeys() {
		PATH[] paths; MODE[] modes; Query(QDC_ALL_PATHS, out paths, out modes);
		HashSet<string> on = new HashSet<string>(), off = new HashSet<string>();
		foreach (PATH p in paths) if ((p.flags & ACTIVE) != 0) on.Add(KeyOf(p.tgt));
		foreach (PATH p in paths) if ((p.flags & ACTIVE) == 0 && p.tgt.targetAvailable != 0) { string k = KeyOf(p.tgt); if (!on.Contains(k)) off.Add(k); }
		string[] r = new string[off.Count]; off.CopyTo(r); return r;
	}

	private static PATH[] Compact(List<PATH> keep, MODE[] modes, out MODE[] outModes) {
		List<MODE> km = new List<MODE>();
		Dictionary<uint, uint> map = new Dictionary<uint, uint>();
		PATH[] r = new PATH[keep.Count];
		for (int i = 0; i < keep.Count; i++) {
			PATH p = keep[i];
			p.src.modeInfoIdx = Remap(p.src.modeInfoIdx, modes, km, map);
			p.tgt.modeInfoIdx = Remap(p.tgt.modeInfoIdx, modes, km, map);
			r[i] = p;
		}
		outModes = km.ToArray();
		return r;
	}
	private static uint Remap(uint idx, MODE[] modes, List<MODE> km, Dictionary<uint, uint> map) {
		if (idx == INVALID || idx >= modes.Length) return INVALID;
		uint n;
		if (!map.TryGetValue(idx, out n)) { n = (uint)km.Count; km.Add(modes[idx]); map[idx] = n; }
		return n;
	}

	// Windows considers the source at (0,0) primary. When removing it, give another
	// remaining source the origin while preserving the screens' relative positions.
	private static void RebaseSources(MODE[] modes) {
		int first = -1;
		for (int i = 0; i < modes.Length; i++) {
			if (modes[i].infoType != 1) continue;
			if (modes[i].x == 0 && modes[i].y == 0) return; // e.g. a clone still uses the primary source
			if (first < 0) first = i;
		}
		if (first < 0) return;
		int ox = modes[first].x, oy = modes[first].y;
		for (int i = 0; i < modes.Length; i++) {
			if (modes[i].infoType != 1) continue;
			modes[i].x -= ox; modes[i].y -= oy;
		}
	}

	public static string Off(string key, bool sleep) {
		PATH[] paths; MODE[] modes; Query(QDC_ONLY_ACTIVE_PATHS, out paths, out modes);
		List<PATH> keep = new List<PATH>(); PATH victim = new PATH(); bool found = false;
		foreach (PATH p in paths) { if (KeyOf(p.tgt) == key) { if (!found) victim = p; found = true; } else keep.Add(p); }
		if (!found) return "already off";
		if (keep.Count == 0) throw new Exception("That is the only screen that is on.");
		string gdi = Gdi(victim.src.adapterId, victim.src.id);
		MODE[] km; PATH[] kp = Compact(keep, modes, out km);
		if (IsMain(victim, modes)) RebaseSources(km);
		bool slept = sleep && Power(gdi, false);
		int r = SetDisplayConfig((uint)kp.Length, kp, (uint)km.Length, km, SDC_APPLY | SDC_USE_SUPPLIED | SDC_ALLOW_CHANGES | SDC_SAVE);
		if (r != 0) { if (slept) Power(gdi, true); throw new Exception("Windows refused to turn that screen off (error " + r + ")."); }
		return slept ? "off (monitor asleep)" : "off";
	}

	public static string On(string key, bool wake, int preferNum) {
		PATH[] all; MODE[] modes; Query(QDC_ALL_PATHS, out all, out modes);
		List<PATH> active = new List<PATH>();
		foreach (PATH p in all) if ((p.flags & ACTIVE) != 0) active.Add(p);
		foreach (PATH p in active) if (KeyOf(p.tgt) == key) { if (wake) WakeLater(key); return "already on"; }
		// Pick a free source for it — the one that gives it back its old display number if possible, else the lowest.
		int cand = -1;
		for (int i = 0; i < all.Length; i++) {
			PATH p = all[i];
			if ((p.flags & ACTIVE) != 0 || p.tgt.targetAvailable == 0 || KeyOf(p.tgt) != key) continue;
			bool busy = false;
			foreach (PATH a in active) if (Same(a.src.adapterId, p.src.adapterId) && a.src.id == p.src.id) { busy = true; break; }
			if (busy) continue;
			if (preferNum > 0 && Num(Gdi(p.src.adapterId, p.src.id)) == preferNum) { cand = i; break; }
			if (cand < 0 || p.src.id < all[cand].src.id) cand = i;
		}
		if (cand < 0) throw new Exception("That screen isn't connected. Check its cable and power.");
		PATH c = all[cand]; c.flags |= ACTIVE; c.src.modeInfoIdx = INVALID; c.tgt.modeInfoIdx = INVALID;
		// Inactive paths can carry zeroed fields that aren't valid values; use "identity" / "preferred" / "unspecified".
		if (c.tgt.rotation == 0) c.tgt.rotation = 1;
		if (c.tgt.scaling == 0) c.tgt.scaling = 128;
		c.tgt.refreshRate = new RATIONAL(); c.tgt.scanLineOrdering = 0;

		// 1) Let Windows restore the arrangement it remembers for this set of screens.
		PATH[] t1 = new PATH[active.Count + 1];
		for (int i = 0; i < active.Count; i++) { PATH p = active[i]; p.src.modeInfoIdx = INVALID; p.tgt.modeInfoIdx = INVALID; t1[i] = p; }
		t1[active.Count] = c;
		int r = SetDisplayConfig((uint)t1.Length, t1, 0, null, SDC_APPLY | SDC_TOPOLOGY_SUPPLIED | SDC_ALLOW_PATH_ORDER);
		if (r == 0) SaveCurrent(); // so it stays on after a restart
		else {
			// 2) Keep the other screens exactly as they are; Windows picks a mode for this one.
			MODE[] km; PATH[] kp = Compact(active, modes, out km);
			PATH[] t2 = new PATH[kp.Length + 1]; Array.Copy(kp, t2, kp.Length); t2[kp.Length] = c;
			r = SetDisplayConfig((uint)t2.Length, t2, (uint)km.Length, km, SDC_APPLY | SDC_USE_SUPPLIED | SDC_ALLOW_CHANGES | SDC_SAVE);
		}
		if (r != 0) throw new Exception("Windows refused to turn that screen on (error " + r + ").");
		if (wake) WakeLater(key);
		return "on";
	}

	// Stores the layout that is active now as the one Windows restores.
	private static void SaveCurrent() {
		try {
			PATH[] paths; MODE[] modes; Query(QDC_ONLY_ACTIVE_PATHS, out paths, out modes);
			SetDisplayConfig((uint)paths.Length, paths, (uint)modes.Length, modes, SDC_APPLY | SDC_USE_SUPPLIED | SDC_ALLOW_CHANGES | SDC_SAVE);
		} catch { }
	}

	// Last resort for turning a screen on: Windows "Extend" (every connected screen on). Returns the Windows error code.
	public static int ExtendAll() { return SetDisplayConfig(0, null, 0, null, SDC_APPLY | SDC_TOPOLOGY_EXTEND); }

	// Wakes the monitor (DDC/CI) once Windows has brought it back.
	public static void WakeLater(string key) {
		Thread t = new Thread(delegate () {
			try {
				for (int i = 0; i < 20; i++) {
					Thread.Sleep(250);
					PATH[] paths; MODE[] modes; Query(QDC_ONLY_ACTIVE_PATHS, out paths, out modes);
					foreach (PATH p in paths) if (KeyOf(p.tgt) == key && Power(Gdi(p.src.adapterId, p.src.id), true)) return;
				}
			} catch { }
		});
		t.IsBackground = true;
		t.Start();
	}

	private static IntPtr FindMonitor(string gdi) {
		IntPtr hit = IntPtr.Zero;
		EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate (IntPtr hm, IntPtr hdc, ref RC r, IntPtr d) {
			MINFO mi = new MINFO(); mi.cbSize = Marshal.SizeOf(typeof(MINFO));
			if (GetMonitorInfo(hm, ref mi) && string.Equals(mi.szDevice, gdi, StringComparison.OrdinalIgnoreCase)) { hit = hm; return false; }
			return true;
		}, IntPtr.Zero);
		return hit;
	}

	// DDC/CI power mode (VCP 0xD6): 1 = on, 4 = standby. Returns false when the monitor doesn't support it.
	private static bool Power(string gdi, bool on) {
		try {
			IntPtr hm = FindMonitor(gdi);
			if (hm == IntPtr.Zero) return false;
			uint n;
			if (!GetNumberOfPhysicalMonitorsFromHMONITOR(hm, out n) || n == 0) return false;
			PHYS[] arr = new PHYS[n];
			if (!GetPhysicalMonitorsFromHMONITOR(hm, n, arr)) return false;
			bool ok = false;
			try { foreach (PHYS p in arr) ok |= SetVCPFeature(p.h, 0xD6, on ? 1u : 4u); }
			finally { DestroyPhysicalMonitors(n, arr); }
			return ok;
		} catch { return false; }
	}
}

// Screenshots: active window or all screens (saved as PNG and/or copied), plus saving a copy of area snips.
public static class DailyOpsShot {
	[DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
	[DllImport("user32.dll")] private static extern int GetSystemMetrics(int i);
	[DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
	[DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr h, int attr, out DailyOpsWin.RECT r, int size);
	[DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr h, out DailyOpsWin.RECT r);
	[DllImport("user32.dll")] private static extern uint GetClipboardSequenceNumber();
	[DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);

	private static void Emit(string type, string data) {
		Console.Out.WriteLine("0\t" + type + "\t" + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(data ?? "")));
		Console.Out.Flush();
	}

	// mode "window" or "all". Returns the saved file path ("" when only copied).
	public static string Capture(string mode, string folder, bool save, bool clip) {
		string result = null; Exception err = null;
		Thread t = new Thread(delegate () { try { result = CaptureSta(mode, folder, save, clip); } catch (Exception e) { err = e; } });
		t.SetApartmentState(ApartmentState.STA); // the clipboard needs an STA thread
		t.Start();
		if (!t.Join(20000)) throw new Exception("Screenshot timed out.");
		if (err != null) throw err;
		return result ?? "";
	}

	private static string CaptureSta(string mode, string folder, bool save, bool clip) {
		try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { } // real pixels on scaled screens
		int x, y, w, h; string tag = "";
		if (mode == "window") {
			IntPtr hw = GetForegroundWindow();
			if (hw == IntPtr.Zero) throw new Exception("No active window.");
			DailyOpsWin.RECT r;
			if (DwmGetWindowAttribute(hw, 9, out r, Marshal.SizeOf(typeof(DailyOpsWin.RECT))) != 0) GetWindowRect(hw, out r); // 9 = frame without shadow
			x = r.L; y = r.T; w = r.R - r.L; h = r.B - r.T;
			uint pid; GetWindowThreadProcessId(hw, out pid);
			try { tag = " " + Process.GetProcessById((int)pid).ProcessName; } catch { }
		} else {
			x = GetSystemMetrics(76); y = GetSystemMetrics(77); w = GetSystemMetrics(78); h = GetSystemMetrics(79); // virtual screen
		}
		if (w <= 0 || h <= 0) throw new Exception("Nothing to capture.");
		using (Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb)) {
			using (Graphics g = Graphics.FromImage(bmp)) g.CopyFromScreen(x, y, 0, 0, new Size(w, h), CopyPixelOperation.SourceCopy);
			string path = save ? SaveTo(bmp, folder, tag) : "";
			if (clip) SetClipboard(bmp);
			return path;
		}
	}

	private static string SaveTo(Image img, string folder, string tag) {
		Directory.CreateDirectory(folder);
		string clean = tag ?? "";
		foreach (char c in Path.GetInvalidFileNameChars()) clean = clean.Replace(c.ToString(), "");
		string baseName = "Screenshot " + DateTime.Now.ToString("yyyy-MM-dd HH-mm-ss") + clean;
		string p = Path.Combine(folder, baseName + ".png");
		for (int i = 2; File.Exists(p); i++) p = Path.Combine(folder, baseName + " (" + i + ").png");
		img.Save(p, ImageFormat.Png);
		return p;
	}

	private static void SetClipboard(Image img) {
		for (int i = 0; i < 6; i++) {
			try { System.Windows.Forms.Clipboard.SetImage(img); return; } catch (ExternalException) { Thread.Sleep(80); }
		}
	}

	public static uint ClipSeq() { return GetClipboardSequenceNumber(); }

	private static string NewestSince(string folder, DateTime since) {
		try {
			if (string.IsNullOrEmpty(folder) || !Directory.Exists(folder)) return null;
			string best = null; DateTime bt = since;
			foreach (string f in Directory.GetFiles(folder, "*.png")) { DateTime t = File.GetCreationTime(f); if (t >= bt) { bt = t; best = f; } }
			return best;
		} catch { return null; }
	}

	// Area snips come from Windows' own snipping overlay, which puts the picture on the clipboard.
	// Waits for it and saves a copy — unless the Snipping Tool already saved one in the same folder.
	private static int snipGen;
	public static void SaveNextClipboardImage(uint seqBefore, string folder, string snippingToolFolder, int timeoutMs) {
		int my = Interlocked.Increment(ref snipGen); // a newer snip replaces this watcher
		Thread t = new Thread(delegate () {
			try {
				DateTime started = DateTime.Now.AddSeconds(-1);
				Stopwatch sw = Stopwatch.StartNew();
				while (sw.ElapsedMilliseconds < timeoutMs) {
					Thread.Sleep(200);
					if (snipGen != my) return;
					if (GetClipboardSequenceNumber() == seqBefore) continue;
					Thread.Sleep(400); // let the overlay finish writing every format
					Image img = null;
					for (int i = 0; i < 5 && img == null; i++) {
						try { if (System.Windows.Forms.Clipboard.ContainsImage()) img = System.Windows.Forms.Clipboard.GetImage(); } catch { }
						if (img == null) Thread.Sleep(150);
					}
					if (img == null) return; // something other than a picture was copied: the snip was cancelled
					using (img) {
						Thread.Sleep(1200);
						string already = NewestSince(snippingToolFolder, started);
						bool sameFolder = string.Equals(Path.GetFullPath(folder).TrimEnd('\\'), Path.GetFullPath(snippingToolFolder).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
						Emit("shot", already != null && sameFolder ? already : SaveTo(img, folder, ""));
					}
					return;
				}
				Emit("shot", "");
			} catch (Exception e) { Emit("shoterr", e.Message); }
		});
		t.SetApartmentState(ApartmentState.STA);
		t.IsBackground = true;
		t.Start();
	}
}
'@
$script:nativeReady = $false
$script:snap = @()
$script:fg = 0
function SK-Escape([string]$t) { return (($t.ToCharArray() | ForEach-Object { if ('+^%~(){}[]'.Contains([string]$_)) { '{' + $_ + '}' } else { [string]$_ } }) -join '') }
function Ensure-Native { if (-not $script:nativeReady) { Add-Type -TypeDefinition $nativeSrc -ReferencedAssemblies System.Drawing, System.Windows.Forms; $script:nativeReady = $true } }

$reader = [Console]::In
while ($true) {
	$line = $reader.ReadLine()
	if ($null -eq $line) { break }
	$p = $line.Split([char]9)
	$id = $p[0]
	$a = @($p | Select-Object -Skip 2 | ForEach-Object { D $_ })
	$status = 'ok'; $msg = ''
	try {
		switch ($p[1]) {
			'ping' { $msg = 'pong' }
			'secret-protect' { if ($a[0].Length -gt 4096) { throw 'Password too long.' }; $msg = Protect-Password $a[0] $a[1] }
			'secret-unprotect' { if ($a[0].Length -gt 32768) { throw 'Password data too long.' }; $msg = Unprotect-Password $a[0] $a[1] }
			'warm' { $null = Get-Apps $true; $msg = [string]$script:apps.Count + ' apps'; try { Ensure-Native } catch { $msg += ' (native helpers unavailable: ' + $_.Exception.Message + ')' } }
			'snap' { Ensure-Native; $script:snap = [DailyOpsWin]::Snapshot(); $script:fg = [DailyOpsWin]::Foreground(); $msg = [string]$script:snap.Count }
			'place' {
				Ensure-Native
				[DailyOpsWin]::PlaceAsync([long[]]$script:snap, [long]$script:fg, [int]$a[0], $a[1], [int]$a[2])
				$msg = 'placing on monitor ' + ([int]$a[0] + 1)
			}
			'sendto' {
				# a[0] = process names ("Code|Code - Insiders"), a[1] = JSON steps [{k:"^+p"},{w:200},{t:"Git: Push"}]
				Ensure-Native
				if ($a[0] -and -not [DailyOpsWin]::Activate($a[0])) { $status = 'miss'; $msg = 'not running: ' + $a[0]; break }
				$sh = Shell
				$first = $true
				foreach ($st in @(ConvertFrom-Json $a[1])) {
					if ($first -and $a[0]) { Start-Sleep -Milliseconds 90 }
					$first = $false
					if ($st.w) { Start-Sleep -Milliseconds ([int]$st.w) }
					if ($st.k) { $sh.SendKeys([string]$st.k) }
					if ($st.t) { $sh.SendKeys((SK-Escape ([string]$st.t))) }
				}
				$msg = 'sent'
			}
			'watchfg' { Ensure-Native; [DailyOpsWin]::WatchForeground(250); $msg = 'watching' }
			'monitors' { Ensure-Native; $msg = [DailyOpsWin]::Describe($a[0]) }
			'mlist' { Ensure-Native; $msg = [DailyOpsDisplay]::List() }
			'moff' { Ensure-Native; $msg = [DailyOpsDisplay]::Off($a[0], ($a[1] -eq '1')) }
			'mon' {
				# a[0] = screen key, a[1] = wake 1/0, a[2] = the Windows number it had before (0 = unknown)
				Ensure-Native
				$prefer = 0; if ($a.Count -gt 2 -and $a[2]) { $prefer = [int]$a[2] }
				try { $msg = [DailyOpsDisplay]::On($a[0], ($a[1] -eq '1'), $prefer) }
				catch {
					$e = $_.Exception; if ($e.InnerException) { $e = $e.InnerException }
					if ($e.Message -notmatch 'refused') { throw $e.Message }
					# Windows refused the exact layout. Last resort: "Extend" (every connected screen on), then switch the others back off.
					$offBefore = @([DailyOpsDisplay]::OffKeys())
					$code = [DailyOpsDisplay]::ExtendAll()
					if ($code -ne 0) { throw $e.Message }
					Start-Sleep -Milliseconds 1500
					foreach ($k in $offBefore) { if ($k -ne $a[0]) { try { $null = [DailyOpsDisplay]::Off($k, $false) } catch { } } }
					if (-not [DailyOpsDisplay]::IsOn($a[0])) { throw $e.Message }
					if ($a[1] -eq '1') { [DailyOpsDisplay]::WakeLater($a[0]) }
					$msg = 'on (via extend)'
				}
			}
			'shot' {
				# a[0] = area|window|all, a[1] = folder ('' = Pictures\Screenshots), a[2] = save 1/0, a[3] = clipboard 1/0
				Ensure-Native
				$folder = if ($a[1]) { X $a[1] } else { Shots-Folder }
				$save = $a[2] -ne '0'; $clip = $a[3] -ne '0'
				if ($a[0] -eq 'area') {
					$seq = [DailyOpsShot]::ClipSeq()
					try { Start-Process -FilePath 'ms-screenclip:' }
					catch { Start-Process -FilePath "$env:WINDIR\System32\SnippingTool.exe" -ArgumentList '/clip' }
					if ($save) { [DailyOpsShot]::SaveNextClipboardImage($seq, $folder, (Shots-Folder), 45000) }
					$msg = 'snipping'
				}
				elseif (@('window', 'all') -contains $a[0]) { $msg = [DailyOpsShot]::Capture($a[0], $folder, $save, $clip) }
				else { throw ('bad screenshot mode: ' + $a[0]) }
			}
			'apps' {
				$list = Get-Apps $true | Sort-Object Name -Unique | ForEach-Object { [ordered]@{ n = $_.Name; id = $_.AppID } }
				$msg = ConvertTo-Json -InputObject @($list) -Compress
			}
			'start' {
				$names = $a[0].Split('|')
				$hit = Find-App $names
				if ($null -eq $hit) { $status = 'miss'; $msg = 'Not in Start menu: ' + ($names -join ', ') }
				else { Start-AppId $hit.AppID; $msg = $hit.Name }
			}
			'appid' { Start-AppId $a[0]; $msg = $a[0] }
			'resolve' {
				$hit = Find-App ($a[0].Split('|'))
				if ($null -eq $hit) { $status = 'miss'; $msg = 'not found' } else { $msg = $hit.AppID }
			}
			'icon' {
				Ensure-Native
				$t = $a[0]
				if ($t -notmatch '^shell:') { $t = X $t; if (-not (Test-Path -LiteralPath $t)) { throw ('Not found: ' + $t) } }
				$size = 256; if ($a.Count -gt 1 -and $a[1]) { $size = [int]$a[1] }
				$msg = [DailyOpsIcon]::Png($t, $size)
			}
			'path' {
				$t = X $a[0]
				if (-not (Test-Path -LiteralPath $t)) { $status = 'miss'; $msg = 'Not found: ' + $t }
				else {
					$wd = Split-Path -Parent $t
					if ($a.Count -gt 1 -and $a[1]) { Start-Process -FilePath $t -ArgumentList $a[1] -WorkingDirectory $wd }
					else { Start-Process -FilePath $t -WorkingDirectory $wd }
					$msg = $t
				}
			}
			'cmd' {
				if ($a.Count -gt 1 -and $a[1]) { Start-Process -FilePath $a[0] -ArgumentList $a[1] } else { Start-Process -FilePath $a[0] }
				$msg = $a[0]
			}
			'url' { Start-Process -FilePath $a[0]; $msg = $a[0] }
			'folder' {
				$t = if ($a[0] -eq '::downloads') { Downloads-Path } else { X $a[0] }
				if (Test-Path -LiteralPath $t -PathType Container) { Invoke-Item -LiteralPath $t; $msg = $t }
				else { $status = 'miss'; $msg = 'Folder not found: ' + $t }
			}
			'desktop' {
				(New-Object -ComObject Shell.Application).ToggleDesktop()
				$msg = 'desktop toggled'
			}
			'vol' {
				$ch = switch ($a[0]) { 'up' { [char]175 } 'down' { [char]174 } default { [char]173 } }
				$n = [Math]::Max(1, [Math]::Min(50, [int]$a[1]))
				$w = Shell
				for ($i = 0; $i -lt $n; $i++) { $w.SendKeys([string]$ch) }
				$msg = $a[0]
			}
			'keys' {
				if (@('^c', '^v', '^x', '^z', '^a') -notcontains $a[0]) { throw ('key combo not allowed: ' + $a[0]) }
				(Shell).SendKeys($a[0]); $msg = $a[0]
			}
			'display' {
				if (@('extend', 'clone', 'internal', 'external') -notcontains $a[0]) { throw ('bad display mode: ' + $a[0]) }
				Start-Process -FilePath "$env:WINDIR\System32\DisplaySwitch.exe" -ArgumentList ('/' + $a[0]); $msg = $a[0]
			}
			default { $status = 'err'; $msg = 'unknown command: ' + $p[1] }
		}
	}
	catch {
		$status = 'err'; $ex = $_.Exception
		if ($ex.InnerException -and $ex -is [System.Management.Automation.MethodInvocationException]) { $ex = $ex.InnerException }
		$msg = $ex.Message
		if ($p[1] -like 'secret-*') { $msg = 'The password could not be protected or opened for this Windows account.' }
	}
	[Console]::Out.WriteLine($id + [char]9 + $status + [char]9 + (E $msg))
	[Console]::Out.Flush()
	if ($p[1] -like 'secret-*') { $a = @(); $line = ''; $p = @(); $msg = '' }
}
`;
