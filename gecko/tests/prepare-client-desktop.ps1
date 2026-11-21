$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class SonaClientDesktop {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd,StringBuilder text,int count);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd,uint msg,IntPtr w,IntPtr l);
}
'@

# The ephemeral Windows 11 job image can show the first-logon privacy wizard.
# Close that already-open prompt without submitting its opt-in settings.
for ($i=0; $i -lt 4; $i++) {
    $hwnd=[SonaClientDesktop]::GetForegroundWindow()
    [uint32]$owner=0
    [void][SonaClientDesktop]::GetWindowThreadProcessId($hwnd,[ref]$owner)
    $title=[System.Text.StringBuilder]::new(256)
    [void][SonaClientDesktop]::GetWindowText($hwnd,$title,256)
    $process=Get-Process -Id $owner -ErrorAction SilentlyContinue
    if ($process.ProcessName -ne 'WWAHost' -or $title.ToString() -ne 'Microsoft account') { break }
    if ($i -eq 0) {
        [void][SonaClientDesktop]::PostMessage($hwnd,0x10,[IntPtr]::Zero,[IntPtr]::Zero)
    } else {
        Stop-Process -Id $owner -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 700
}
"Native desktop available, foreground process: $($process.ProcessName)"
