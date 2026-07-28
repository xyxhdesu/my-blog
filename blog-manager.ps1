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
    Write-Host "[OK] $Text" -ForegroundColor Green
}

function Write-Warn([string]$Text) {
    Write-Host "[WARN] $Text" -ForegroundColor Yellow
}

function Invoke-Native([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Program failed with exit code $LASTEXITCODE."
    }
}

function Assert-Repository {
    if (-not (Test-Path (Join-Path $RepoRoot ".git"))) {
        throw "This tool must run from the blog repository."
    }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw "Git is not installed or is not available in PATH."
    }
}

function Assert-NoGitOperation {
    $markers = @("MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD")
    foreach ($marker in $markers) {
        if (Test-Path (Join-Path $RepoRoot ".git\$marker")) {
            throw "A Git merge or rebase is already in progress. Finish or abort it first."
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
        Write-Host "Invalid Hugo date values:" -ForegroundColor Red
        $invalid | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
        throw "Date validation failed. A date-time must include seconds."
    }
    Write-Ok "Content dates are valid."
}

function Invoke-HugoBuild([switch]$Required) {
    $hugo = Get-Command hugo -ErrorAction SilentlyContinue
    if (-not $hugo) {
        if ($Required) {
            throw "Hugo is not installed or is not available in PATH."
        }
        Write-Warn "Hugo is not installed; local build check was skipped."
        return
    }

    Write-Host "Running Hugo build..."
    Invoke-Native "hugo" @("--minify")
    Write-Ok "Hugo build passed."
}

function Show-Status {
    Write-Title "Repository status"
    Invoke-Native "git" @("-c", "core.quotepath=false", "status", "--short", "--branch")
    Write-Host ""
    Invoke-Native "git" @("log", "-5", "--oneline", "--decorate")
}

function Sync-Blog {
    Write-Title "Sync from GitHub / Pages CMS"
    Assert-NoGitOperation

    $changes = @(git status --porcelain)
    if ($LASTEXITCODE -ne 0) { throw "Could not read Git status." }
    if ($changes.Count -gt 0) {
        throw "Local changes exist. Use Safe publish to preserve and publish them."
    }

    Invoke-Native "git" @("fetch", "origin")
    Invoke-Native "git" @("merge", "--ff-only", "origin/main")
    Write-Ok "Local files now match the latest remote version."
}

function Publish-Blog {
    Write-Title "Safe publish"
    Assert-NoGitOperation

    Write-Host "Fetching the latest Pages CMS commits..."
    Invoke-Native "git" @("fetch", "origin")
    Test-ContentDates
    Invoke-HugoBuild

    $changes = @(git status --porcelain)
    if ($LASTEXITCODE -ne 0) { throw "Could not read Git status." }
    if ($changes.Count -gt 0) {
        $message = $CommitMessage
        if ([string]::IsNullOrWhiteSpace($message) -and -not $NonInteractive) {
            $message = Read-Host "Commit message (Enter for automatic message)"
        }
        if ([string]::IsNullOrWhiteSpace($message)) {
            $message = "Update blog " + (Get-Date -Format "yyyy-MM-dd HH:mm")
        }
        Invoke-Native "git" @("add", "--all")
        Invoke-Native "git" @("commit", "-m", $message)
        Write-Ok "Local changes committed."
    } else {
        Write-Host "No uncommitted local changes."
    }

    Write-Host "Replaying local commits on the latest remote version..."
    & git rebase origin/main
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "A conflict was detected. Restoring the state before rebase."
        & git rebase --abort
        throw "Nothing was pushed. Resolve the conflicting edits before publishing."
    }

    Test-ContentDates
    Invoke-HugoBuild
    Invoke-Native "git" @("push", "origin", "main")
    Write-Ok "Published to GitHub. Cloudflare should deploy this commit automatically."
    Show-Status
}

function Start-Preview {
    Write-Title "Local preview"
    if (-not (Get-Command hugo -ErrorAction SilentlyContinue)) {
        throw "Hugo is required for preview but is not installed."
    }
    Write-Host "Open http://localhost:1313/ in your browser. Press Ctrl+C to stop."
    Invoke-Native "hugo" @("server", "--buildDrafts")
}

function New-Post {
    Write-Title "New draft post"
    $newSlug = $Slug
    if ([string]::IsNullOrWhiteSpace($newSlug) -and -not $NonInteractive) {
        $newSlug = Read-Host "File name, using lowercase letters, numbers and hyphens"
    }
    $newSlug = $newSlug.Trim().ToLowerInvariant()
    if ($newSlug -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$') {
        throw "Invalid file name. Example: my-first-post"
    }

    $name = (Get-Date -Format "yyyy-MM-dd") + "-$newSlug.md"
    $path = Join-Path $RepoRoot "content\posts\$name"
    if (Test-Path $path) {
        throw "The post already exists: $name"
    }

    $title = $PostTitle
    if ([string]::IsNullOrWhiteSpace($title) -and -not $NonInteractive) {
        $title = Read-Host "Post title"
    }
    if ([string]::IsNullOrWhiteSpace($title)) { $title = $newSlug }
    $safeTitle = $title.Replace("'", "''")
    $date = Get-Date -Format "yyyy-MM-dd'T'HH:mm:ss"
    $content = "+++`ntitle = '$safeTitle'`ndate = '$date'`ndraft = true`n+++`n`n"
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($path, $content, $utf8)
    Write-Ok "Created content/posts/$name as a draft."
}

function Open-Site {
    $config = Get-Content (Join-Path $RepoRoot "hugo.toml") -Encoding UTF8
    $baseLine = $config | Where-Object { $_ -match '^baseURL\s*=\s*[\"''](.+)[\"'']' } | Select-Object -First 1
    if (-not $baseLine -or $baseLine -notmatch '^baseURL\s*=\s*[\"''](.+)[\"'']') {
        throw "baseURL was not found in hugo.toml."
    }
    Start-Process $Matches[1]
}

function Open-Cms {
    Start-Process "https://app.pagescms.org/"
}

function Show-Menu {
    while ($true) {
        Clear-Host
        Write-Host "Blog Manager" -ForegroundColor Cyan
        Write-Host "1. Safe publish (sync + validate + commit + push)"
        Write-Host "2. Sync from Pages CMS / GitHub"
        Write-Host "3. Show repository status"
        Write-Host "4. Validate and build"
        Write-Host "5. Start local preview"
        Write-Host "6. Create a draft post"
        Write-Host "7. Open published site"
        Write-Host "8. Open Pages CMS"
        Write-Host "0. Exit"
        Write-Host ""
        $choice = Read-Host "Choose"

        try {
            switch ($choice) {
                "1" { Publish-Blog }
                "2" { Sync-Blog }
                "3" { Show-Status }
                "4" { Write-Title "Validate and build"; Test-ContentDates; Invoke-HugoBuild -Required }
                "5" { Start-Preview }
                "6" { New-Post }
                "7" { Open-Site }
                "8" { Open-Cms }
                "0" { return }
                default { Write-Warn "Unknown choice." }
            }
        } catch {
            Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
        }

        if ($choice -ne "5" -and $choice -ne "7" -and $choice -ne "8") {
            Write-Host ""
            Read-Host "Press Enter to return to the menu" | Out-Null
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
