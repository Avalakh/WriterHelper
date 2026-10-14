$ErrorActionPreference = 'Stop'
$writerRoot = Split-Path -Parent $PSScriptRoot
$writerRuntime = Join-Path $writerRoot '.desktop'
$writerSdk = Join-Path $writerRuntime 'sdk'
if (-not (Test-Path -LiteralPath (Join-Path $writerSdk 'lib/net462/Microsoft.Web.WebView2.Core.dll'))) {
    New-Item -ItemType Directory -Path $writerRuntime -Force | Out-Null
    $writerSdkVersion = '1.0.4258.31'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$writerSdkVersion/microsoft.web.webview2.$writerSdkVersion.nupkg" -UseBasicParsing -OutFile (Join-Path $writerRuntime 'webview2.zip')
    Expand-Archive -LiteralPath (Join-Path $writerRuntime 'webview2.zip') -DestinationPath $writerSdk -Force
}
Copy-Item -LiteralPath (Join-Path $writerSdk 'lib/net462/Microsoft.Web.WebView2.Core.dll') -Destination $writerRoot
Copy-Item -LiteralPath (Join-Path $writerSdk 'lib/net462/Microsoft.Web.WebView2.WinForms.dll') -Destination $writerRoot
Copy-Item -LiteralPath (Join-Path $writerSdk 'runtimes/win-x64/native/WebView2Loader.dll') -Destination $writerRoot
Copy-Item -LiteralPath (Join-Path $writerSdk 'LICENSE.txt') -Destination (Join-Path $PSScriptRoot 'WebView2-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $writerSdk 'NOTICE.txt') -Destination (Join-Path $PSScriptRoot 'WebView2-NOTICE.txt')
$writerNode = (Get-Command node.exe).Source
Copy-Item -LiteralPath $writerNode -Destination (Join-Path $writerRuntime 'node.exe')
Add-Type -AssemblyName System.Drawing
$writerBitmap = New-Object System.Drawing.Bitmap 64,64
$writerGraphics = [System.Drawing.Graphics]::FromImage($writerBitmap)
$writerGraphics.SmoothingMode = 'AntiAlias'
$writerGraphics.Clear([System.Drawing.Color]::FromArgb(32,41,35))
$writerBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(175,207,179))
$writerGraphics.FillRectangle($writerBrush,10,7,44,50)
$writerFont = New-Object System.Drawing.Font 'Georgia',34,([System.Drawing.FontStyle]::Bold)
$writerInk = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(20,43,27))
$writerGraphics.DrawString('W',$writerFont,$writerInk,4,7)
$writerStream = New-Object System.IO.MemoryStream
$writerBitmap.Save($writerStream,[System.Drawing.Imaging.ImageFormat]::Png)
$writerBytes = $writerStream.ToArray()
$writerIconPath = Join-Path $PSScriptRoot 'WriterHelper.ico'
$writerIconFile = [System.IO.File]::Create($writerIconPath)
$writerBinary = New-Object System.IO.BinaryWriter $writerIconFile
$writerBinary.Write([UInt16]0);$writerBinary.Write([UInt16]1);$writerBinary.Write([UInt16]1)
$writerBinary.Write([Byte]64);$writerBinary.Write([Byte]64);$writerBinary.Write([Byte]0);$writerBinary.Write([Byte]0)
$writerBinary.Write([UInt16]1);$writerBinary.Write([UInt16]32);$writerBinary.Write([UInt32]$writerBytes.Length);$writerBinary.Write([UInt32]22);$writerBinary.Write($writerBytes)
$writerBinary.Dispose();$writerStream.Dispose();$writerGraphics.Dispose();$writerBitmap.Dispose();$writerBrush.Dispose();$writerInk.Dispose();$writerFont.Dispose()
$writerCsc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $writerCsc /nologo /target:winexe /platform:x64 /optimize+ "/win32icon:$writerIconPath" "/out:$(Join-Path $writerRoot 'WriterHelper.exe')" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Net.Http.dll /reference:System.Web.Extensions.dll "/reference:$(Join-Path $writerRoot 'Microsoft.Web.WebView2.Core.dll')" "/reference:$(Join-Path $writerRoot 'Microsoft.Web.WebView2.WinForms.dll')" (Join-Path $PSScriptRoot 'WriterHelper.cs')
if ($LASTEXITCODE -ne 0) { throw 'Desktop compilation failed' }
@'
<?xml version="1.0" encoding="utf-8"?>
<configuration><startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8" /></startup></configuration>
'@ | Set-Content -LiteralPath (Join-Path $writerRoot 'WriterHelper.exe.config') -Encoding UTF8
Write-Output (Join-Path $writerRoot 'WriterHelper.exe')
