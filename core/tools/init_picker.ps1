# Synapsis init：弹出系统「选择文件夹」窗口（资源管理器同款，记住上次位置）→ 给选中的项目挂上 Synapsis
# 由根目录 Synapsis_init.vbs 调用；也可直接：powershell -File core/tools/init_picker.ps1 [-Dir <项目>] [-SelfTest]
param([string]$Dir = '', [switch]$SelfTest)
$ErrorActionPreference = 'Stop'
$Home2 = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$Memo = Join-Path $Home2 '.synapsis\last_init_dir.txt'
Add-Type -AssemblyName System.Windows.Forms

# Vista 风格的文件夹选择（IFileOpenDialog + FOS_PICKFOLDERS）；.NET Framework 自带的 FolderBrowserDialog 是老式树形窗口
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class SynPicker {
  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialog {}
  [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(); void SetFileTypeIndex(); void GetFileTypeIndex(); void Advise(); void Unadvise();
    void SetOptions(uint fos); void GetOptions(out uint fos);
    void SetDefaultFolder(IShellItem si); void SetFolder(IShellItem si);
    void GetFolder(out IShellItem si); void GetCurrentSelection(out IShellItem si);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name); void GetFileName();
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text); void SetFileNameLabel();
    void GetResult(out IShellItem si);
  }
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem { void BindToHandler(); void GetParent(); void GetDisplayName(uint sigdn, [MarshalAs(UnmanagedType.LPWStr)] out string name); }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IShellItem item);
  public static string Pick(string title, string start) {
    var d = (IFileDialog)new FileOpenDialog();
    d.SetOptions(0x20 | 0x40 | 0x800); // PICKFOLDERS | FORCEFILESYSTEM | PATHMUSTEXIST
    d.SetTitle(title);
    d.SetOkButtonLabel("挂上 Synapsis");
    if (!string.IsNullOrEmpty(start) && System.IO.Directory.Exists(start)) {
      IShellItem si; SHCreateItemFromParsingName(start, IntPtr.Zero, typeof(IShellItem).GUID, out si); d.SetFolder(si);
    }
    if (d.Show(IntPtr.Zero) != 0) return null;
    IShellItem r; d.GetResult(out r); string p; r.GetDisplayName(0x80058000, out p); return p; // SIGDN_FILESYSPATH
  }
}
'@
if ($SelfTest) { 'compiled ok'; exit 0 }

if (-not $Dir) {
  $start = if (Test-Path $Memo) { (Get-Content $Memo -Encoding UTF8 -Raw).Trim() } else { [Environment]::GetFolderPath('Desktop') }
  $Dir = [SynPicker]::Pick('选择要用 Synapsis 规划的项目文件夹', $start)
  if (-not $Dir) { exit 0 }   # 取消
}
New-Item -ItemType Directory -Force (Split-Path $Memo) | Out-Null
# 记住「上一级」：下次打开时停在同一层，方便挑兄弟项目
[IO.File]::WriteAllText($Memo, (Split-Path $Dir -Parent), (New-Object Text.UTF8Encoding $false))

[Console]::OutputEncoding = [Text.Encoding]::UTF8   # node 输出 UTF-8，否则中文乱码
$out = & node (Join-Path $Home2 'core\cli.js') init $Dir 2>&1 | Out-String
$ok = $LASTEXITCODE -eq 0
[IO.File]::WriteAllText((Join-Path $Home2 '.synapsis' | Join-Path -ChildPath 'last_init.log'), "$Dir`r`n$out", (New-Object Text.UTF8Encoding $false))
if ($env:SYN_QUIET) { exit [int](-not $ok) }   # 测试用：不弹框
[System.Windows.Forms.MessageBox]::Show($out.Trim(), $(if ($ok) { 'Synapsis：已挂上' } else { 'Synapsis：出错了' }), 'OK', $(if ($ok) { 'Information' } else { 'Error' })) | Out-Null
