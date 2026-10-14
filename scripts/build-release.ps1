param(
    [Parameter(Mandatory=$true)][string]$SourceData,
    [switch]$Publish
)
$ErrorActionPreference = 'Stop'
$writerRoot = Split-Path -Parent $PSScriptRoot
$writerSource = (Resolve-Path -LiteralPath $SourceData).Path
$writerVersion = (Get-Content -LiteralPath (Join-Path $writerRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($Publish) {
    while ($true) {
        $writerRemoteTag = git -C $writerRoot ls-remote --tags origin "refs/tags/v$writerVersion"
        if ($LASTEXITCODE -ne 0) { throw 'Не удалось проверить версии в GitHub' }
        if (-not $writerRemoteTag) { break }
        $writerParts = $writerVersion.Split('.')
        if ($writerParts.Count -ne 3) { throw 'Для автоматического выпуска нужна версия X.Y.Z' }
        $writerVersion = "$($writerParts[0]).$($writerParts[1]).$([int]$writerParts[2]+1)"
    }
    node --input-type=module -e "import fs from 'node:fs';import path from 'node:path';for(const name of ['package.json','package-lock.json']){const file=path.join(process.argv[1],name),value=JSON.parse(fs.readFileSync(file));value.version=process.argv[2];if(value.packages)value.packages[''].version=process.argv[2];fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');}" $writerRoot $writerVersion
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось обновить версию' }
}
$writerBook = Join-Path $writerRoot 'books/iron-mind'
$writerOutput = Join-Path $writerRoot "publication/v$writerVersion"
$writerApp = Join-Path $writerOutput 'WriterHelper'
function Require-Success { if ($LASTEXITCODE -ne 0) { throw 'Предыдущая команда завершилась с ошибкой' } }
Push-Location $writerRoot
try {
    # One author database supplies both tracked book sources and the application.
    node scripts/publish-book.js $writerSource $writerBook
    Require-Success
    npm run build:desktop
    Require-Success
    npm test
    Require-Success
    if ((Test-Path -LiteralPath (Join-Path $writerApp 'data/writer.sqlite'))) { throw 'Каталог сборки содержит пользовательскую базу; повторная сборка запрещена' }
    New-Item -ItemType Directory -Path $writerApp -Force | Out-Null
    foreach ($writerPart in @('server','dist','docs','desktop','package.json','README.md','WriterHelper.exe','WriterHelper.exe.config','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll')) {
        Copy-Item -LiteralPath (Join-Path $writerRoot $writerPart) -Destination $writerApp -Recurse -Force
    }
    New-Item -ItemType Directory -Path (Join-Path $writerApp '.desktop'),(Join-Path $writerApp 'books') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $writerRoot '.desktop/node.exe') -Destination (Join-Path $writerApp '.desktop/node.exe') -Force
    Copy-Item -LiteralPath $writerBook -Destination (Join-Path $writerApp 'books') -Recurse -Force
    node --input-type=module -e "import fs from 'node:fs';import {createHash} from 'node:crypto';const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');if(hash(process.argv[1])!==hash(process.argv[2]))throw Error('Packaged book differs from current author publication');console.log('PASS packaged book exactly matches author publication');" (Join-Path $writerBook 'data/writer.sqlite') (Join-Path $writerApp 'books/iron-mind/data/writer.sqlite')
    Require-Success
    node tests/starter-book-ui.js $writerApp
    Require-Success
    $writerZip = Join-Path $writerOutput 'WriterHelper-Windows-x64.zip'
    Compress-Archive -LiteralPath $writerApp -DestinationPath $writerZip -Force
    $writerHasher = [Security.Cryptography.SHA256]::Create()
    $writerStream = [IO.File]::OpenRead($writerZip)
    try { $writerHash = ([BitConverter]::ToString($writerHasher.ComputeHash($writerStream))).Replace('-','').ToLowerInvariant() } finally { $writerStream.Dispose(); $writerHasher.Dispose() }
    $writerChecksums = Join-Path $writerOutput 'SHA256SUMS.txt'
    Set-Content -LiteralPath $writerChecksums -Value "$writerHash  WriterHelper-Windows-x64.zip" -Encoding ascii
    $writerNotes = Join-Path $writerOutput 'release-notes.md'
    @"
WriterHelper $writerVersion поставляется вместе с актуальными рабочими материалами «Железного разума». Программа и книга подготовлены одним выпуском из последнего сохранённого авторского проекта.

Скачайте WriterHelper-Windows-x64.zip, распакуйте весь архив и запустите WriterHelper.exe. При первом запуске книга уже загружена и открывается первая написанная глава. Импорт и отдельный архив книги не нужны.

При обновлении существующая папка data, локальные правки и другие проекты сохраняются: встроенная книга используется только для новой установки. Ключи и подключения ИИ в поставку не входят.
"@ | Set-Content -LiteralPath $writerNotes -Encoding utf8
    if ($Publish) {
        $writerGitPaths = @('src','server','desktop','docs','tests','scripts','books','examples','package.json','package-lock.json','README.md','.gitignore','.gitattributes','LICENSE') | Where-Object { Test-Path -LiteralPath (Join-Path $writerRoot $_) }
        git add -- $writerGitPaths
        Require-Success
        git diff --cached --quiet
        if ($LASTEXITCODE -eq 1) { git commit -m "Release $writerVersion with current Iron Mind author project"; Require-Success }
        elseif ($LASTEXITCODE -ne 0) { throw 'Не удалось проверить изменения Git' }
        git push origin main
        Require-Success
        gh release create "v$writerVersion" $writerZip $writerChecksums --repo Avalakh/WriterHelper --target main --title "WriterHelper $writerVersion — программа и Железный разум" --notes-file $writerNotes
        Require-Success
    }
    Write-Output $writerZip
} finally { Pop-Location }
