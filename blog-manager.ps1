[CmdletBinding()]
param(
    [ValidateSet("menu", "publish", "sync", "status", "build", "serve", "new", "site", "cms")]
    [string]$Command = "menu",
    [string]$CommitMessage = "",
    [switch]$NonInteractive,
    [string]$Slug = "",
    [string]$PostTitle = ""
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoRoot

function Write-Title([string]$Text) {
    Write-Host ""
    Write-Host "=== $Text ===" -ForegroundColor Cyan
}

function Write-Ok([string]$Text) {
    Write-Host "[完成] $Text" -ForegroundColor Green
}

function Write-Warn([string]$Text) {
    Write-Host "[警告] $Text" -ForegroundColor Yellow
}

function Invoke-Native([string]$Program, [string[]]$Arguments) {
    try {
        & $Program @Arguments
    } catch {
        throw "$Program 无法启动。请确认已安装且具有执行权限。"
    }
    if ($LASTEXITCODE -ne 0) {
        throw "$Program 执行失败，退出代码：$LASTEXITCODE。"
    }
}

function Assert-Repository {
    if (-not (Test-Path (Join-Path $RepoRoot ".git"))) {
        throw "此工具必须在博客 Git 仓库中运行。"
    }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw "未安装 Git，或 Git 未添加到 PATH 环境变量。"
    }
}

function Assert-NoGitOperation {
    $markers = @("MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD")
    foreach ($marker in $markers) {
        if (Test-Path (Join-Path $RepoRoot ".git\$marker")) {
            throw "已有 Git 合并或变基操作正在进行。请先完成或中止该操作。"
        }
    }
}

function Test-ContentDates {
    $invalid = New-Object System.Collections.Generic.List[string]
    $datePattern = "^\d{4}-\d{2}-\d{2}$|^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$"
    $fieldPattern = '^\s*(date|publishDate|lastmod|expiryDate)\s*=\s*[''\"]?([^''\"\s]+)'

    Get-ChildItem (Join-Path $RepoRoot "content") -Recurse -File -Filter "*.md" | ForEach-Object {
        $file = $_
        $lineNumber = 0
        Get-Content -LiteralPath $file.FullName -Encoding UTF8 | ForEach-Object {
            $lineNumber++
            if ($_ -match $fieldPattern) {
                $value = $Matches[2]
                if ($value -notmatch $datePattern) {
                    $relative = $file.FullName.Substring($RepoRoot.Length + 1)
                    $invalid.Add("$relative`:$lineNumber -> $value")
                }
            }
        }
    }

    if ($invalid.Count -gt 0) {
        Write-Host "发现无效的 Hugo 日期值：" -ForegroundColor Red
        $invalid | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
        throw "日期校验失败。日期时间必须包含秒数。"
    }
    Write-Ok "内容日期格式正确。"
}

function Invoke-HugoBuild([switch]$Required) {
    $hugo = Get-Command hugo -ErrorAction SilentlyContinue
    if (-not $hugo) {
        if ($Required) {
            throw "未安装 Hugo，或 Hugo 未添加到 PATH 环境变量。"
        }
        Write-Warn "未安装 Hugo，已跳过本地构建检查。"
        return
    }

    Write-Host "正在运行 Hugo 构建..."
    Invoke-Native "hugo" @("--minify")
    Write-Ok "Hugo 构建通过。"
}

function Show-Status {
    Write-Title "仓库状态"
    Invoke-Native "git" @("-c", "core.quotepath=false", "status", "--short", "--branch")
    Write-Host ""
    Invoke-Native "git" @("log", "-5", "--oneline", "--decorate")
}

function Sync-Blog {
    Write-Title "从 GitHub / Pages CMS 同步"
    Assert-NoGitOperation

    $changes = @(git status --porcelain)
    if ($LASTEXITCODE -ne 0) { throw "无法读取 Git 状态。" }
    if ($changes.Count -gt 0) {
        throw "检测到本地修改。请使用安全发布功能以保留并发布这些修改。"
    }

    Invoke-Native "git" @("fetch", "origin")
    Invoke-Native "git" @("merge", "--ff-only", "origin/main")
    Write-Ok "本地文件已同步至最新远程版本。"
}

function Publish-Blog {
    Write-Title "安全发布"
    Assert-NoGitOperation

    Write-Host "正在获取 Pages CMS 的最新提交..."
    Invoke-Native "git" @("fetch", "origin")
    Test-ContentDates
    Invoke-HugoBuild

    $changes = @(git status --porcelain)
    if ($LASTEXITCODE -ne 0) { throw "无法读取 Git 状态。" }
    if ($changes.Count -gt 0) {
        $message = $CommitMessage
        if ([string]::IsNullOrWhiteSpace($message) -and -not $NonInteractive) {
            $message = Read-Host "提交说明（直接回车则自动生成）"
        }
        if ([string]::IsNullOrWhiteSpace($message)) {
            $message = "更新博客 " + (Get-Date -Format "yyyy-MM-dd HH:mm")
        }
        Invoke-Native "git" @("add", "--all")
        Invoke-Native "git" @("commit", "-m", $message)
        Write-Ok "本地修改已提交。"
    } else {
        Write-Host "没有未提交的本地修改。"
    }

    Write-Host "正在将本地提交变基到最新远程版本..."
    & git rebase origin/main
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "检测到冲突，正在恢复变基前的状态。"
        & git rebase --abort
        throw "尚未推送任何内容。请先解决冲突的编辑，再重新发布。"
    }

    Test-ContentDates
    Invoke-HugoBuild
    Invoke-Native "git" @("push", "origin", "main")
    Write-Ok "已发布到 GitHub。Cloudflare 将自动部署此提交。"
    Show-Status
}

function Start-Preview {
    Write-Title "本地预览"
    if (-not (Get-Command hugo -ErrorAction SilentlyContinue)) {
        throw "本地预览需要 Hugo，但当前未安装。"
    }
    Write-Host "请在浏览器中打开 http://localhost:1313/ 。按 Ctrl+C 停止预览。"
    Invoke-Native "hugo" @("server", "--buildDrafts")
}

function New-Post {
    Write-Title "新建草稿文章"
    $newSlug = $Slug
    if ([string]::IsNullOrWhiteSpace($newSlug) -and -not $NonInteractive) {
        $newSlug = Read-Host "文件名（仅限小写字母、数字和连字符）"
    }
    $newSlug = $newSlug.Trim().ToLowerInvariant()
    if ($newSlug -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$') {
        throw "文件名格式无效。例如：my-first-post"
    }

    $name = (Get-Date -Format "yyyy-MM-dd") + "-$newSlug.md"
    $path = Join-Path $RepoRoot "content\posts\$name"
    if (Test-Path $path) {
        throw "文章已存在：$name"
    }

    $title = $PostTitle
    if ([string]::IsNullOrWhiteSpace($title) -and -not $NonInteractive) {
        $title = Read-Host "文章标题"
    }
    if ([string]::IsNullOrWhiteSpace($title)) { $title = $newSlug }
    $safeTitle = $title.Replace("'", "''")
    $date = Get-Date -Format "yyyy-MM-dd'T'HH:mm:ss"
    $content = "+++`ntitle = '$safeTitle'`ndate = '$date'`ndraft = true`ncategories = []`ntags = []`n+++`n`n"
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($path, $content, $utf8)
    Write-Ok "已创建草稿：content/posts/$name"
}

function Open-Site {
    $config = Get-Content (Join-Path $RepoRoot "hugo.toml") -Encoding UTF8
    $baseLine = $config | Where-Object { $_ -match '^baseURL\s*=\s*[\"''](.+)[\"'']' } | Select-Object -First 1
    if (-not $baseLine -or $baseLine -notmatch '^baseURL\s*=\s*[\"''](.+)[\"'']') {
        throw "未在 hugo.toml 中找到 baseURL。"
    }
    Start-Process $Matches[1]
}

function Open-Cms {
    Start-Process "https://app.pagescms.org/"
}

function Show-Menu {
    while ($true) {
        Clear-Host
        Write-Host "博客管理器" -ForegroundColor Cyan
        Write-Host "1. 安全发布（同步、校验、提交、推送）"
        Write-Host "2. 从 Pages CMS / GitHub 同步"
        Write-Host "3. 查看仓库状态"
        Write-Host "4. 校验并构建"
        Write-Host "5. 启动本地预览"
        Write-Host "6. 新建草稿文章"
        Write-Host "7. 打开已发布网站"
        Write-Host "8. 打开 Pages CMS"
        Write-Host "0. 退出"
        Write-Host ""
        $choice = Read-Host "请选择"

        try {
            switch ($choice) {
                "1" { Publish-Blog }
                "2" { Sync-Blog }
                "3" { Show-Status }
                "4" { Write-Title "校验并构建"; Test-ContentDates; Invoke-HugoBuild -Required }
                "5" { Start-Preview }
                "6" { New-Post }
                "7" { Open-Site }
                "8" { Open-Cms }
                "0" { return }
                default { Write-Warn "无效选项。" }
            }
        } catch {
            Write-Host "[错误] $($_.Exception.Message)" -ForegroundColor Red
        }

        if ($choice -ne "5" -and $choice -ne "7" -and $choice -ne "8") {
            Write-Host ""
            Read-Host "按回车键返回菜单" | Out-Null
        }
    }
}

Assert-Repository

switch ($Command) {
    "menu"    { Show-Menu }
    "publish" { Publish-Blog }
    "sync"    { Sync-Blog }
    "status"  { Show-Status }
    "build"   { Test-ContentDates; Invoke-HugoBuild -Required }
    "serve"   { Start-Preview }
    "new"     { New-Post }
    "site"    { Open-Site }
    "cms"     { Open-Cms }
}
