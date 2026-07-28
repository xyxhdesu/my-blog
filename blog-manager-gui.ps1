[CmdletBinding()]
param(
    [string]$ScreenshotPath = "",
    [switch]$SmokeTest,
    [ValidateSet("status", "build")]
    [string]$SmokeAction = "status"
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:EnginePath = Join-Path $script:RepoRoot "blog-manager.ps1"
$script:StringsPath = Join-Path $script:RepoRoot "blog-manager.zh-CN.json"
$script:Strings = Get-Content -LiteralPath $script:StringsPath -Encoding UTF8 -Raw | ConvertFrom-Json
$script:IsBusy = $false
$script:EngineProcess = $null
$script:ProcessTimer = $null
$script:CurrentAction = ""
$script:PreviewProcess = $null
$script:ActionButtons = New-Object System.Collections.Generic.List[System.Windows.Forms.Button]

function S([string]$Name) {
    return $script:Strings.$Name
}

function Format-S([string]$Name, [object[]]$Values) {
    return [string]::Format((S $Name), $Values)
}

function Append-Log([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return }
    $stamp = Get-Date -Format "HH:mm:ss"
    $script:LogBox.AppendText("[$stamp] $Text`r`n")
    $script:LogBox.SelectionStart = $script:LogBox.TextLength
    $script:LogBox.ScrollToCaret()
}

function Set-State([string]$Text, [System.Drawing.Color]$Color) {
    $script:StateValue.Text = $Text
    $script:StateValue.ForeColor = $Color
}

function Set-Busy([bool]$Busy, [string]$ActionName) {
    $script:IsBusy = $Busy
    foreach ($button in $script:ActionButtons) {
        $button.Enabled = -not $Busy
    }
    if ($Busy) {
        $script:Progress.Style = [System.Windows.Forms.ProgressBarStyle]::Marquee
        $script:Progress.MarqueeAnimationSpeed = 24
        Set-State (Format-S "running" @($ActionName)) ([Drawing.Color]::FromArgb(22, 101, 52))
    } else {
        $script:Progress.Style = [System.Windows.Forms.ProgressBarStyle]::Blocks
        $script:Progress.Value = 0
    }
}

function Refresh-RepositoryState {
    try {
        Push-Location $script:RepoRoot
        $summary = @(& git -c core.quotepath=false status --short --branch 2>&1)
        if ($LASTEXITCODE -ne 0) { throw ($summary -join " ") }
        if ($summary.Count -eq 0) {
            $script:RepoState.Text = "main"
        } else {
            $script:RepoState.Text = ($summary -join "`r`n")
        }
    } catch {
        $script:RepoState.Text = $_.Exception.Message
    } finally {
        Pop-Location
    }
}

function Quote-PowerShellLiteral([string]$Value) {
    return "'" + $Value.Replace("'", "''") + "'"
}

function Start-EngineAction([string]$ActionName, [string]$Arguments) {
    if ($script:IsBusy) {
        [Windows.Forms.MessageBox]::Show((S "busy"), (S "appTitle"), "OK", "Information") | Out-Null
        return
    }

    Append-Log (Format-S "starting" @($ActionName))
    Set-Busy $true $ActionName

    $engine = Quote-PowerShellLiteral $script:EnginePath
    $invocation = '$ProgressPreference="SilentlyContinue"; [Console]::OutputEncoding=[Text.Encoding]::UTF8; try { ' +
        "& $engine $Arguments 3>&1 4>&1 5>&1 6>&1" +
        ' | ForEach-Object { [Console]::Out.WriteLine([string]$_) } } catch { [Console]::Out.WriteLine("[ERROR] " + $_.Exception.Message); exit 1 }'
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($invocation))
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = "powershell.exe"
    $startInfo.Arguments = "-NoProfile -ExecutionPolicy Bypass -EncodedCommand " + $encoded
    $startInfo.WorkingDirectory = $script:RepoRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = [Text.Encoding]::UTF8
    $startInfo.StandardErrorEncoding = [Text.Encoding]::UTF8

    try {
        $script:EngineProcess = New-Object System.Diagnostics.Process
        $script:EngineProcess.StartInfo = $startInfo
        [void]$script:EngineProcess.Start()
        $script:CurrentAction = $ActionName
    } catch {
        Set-Busy $false $ActionName
        Set-State (Format-S "failed" @($ActionName)) ([Drawing.Color]::Firebrick)
        Append-Log $_.Exception.Message
        return
    }

    $script:ProcessTimer = New-Object Windows.Forms.Timer
    $script:ProcessTimer.Interval = 250
    $script:ProcessTimer.Add_Tick({
        if (-not $script:EngineProcess -or -not $script:EngineProcess.HasExited) { return }
        $script:ProcessTimer.Stop()
        $output = $script:EngineProcess.StandardOutput.ReadToEnd()
        $errorOutput = $script:EngineProcess.StandardError.ReadToEnd()
        $exitCode = $script:EngineProcess.ExitCode
        $script:EngineProcess.Dispose()
        $script:EngineProcess = $null
        $script:ProcessTimer.Dispose()
        $script:ProcessTimer = $null

        if (-not [string]::IsNullOrWhiteSpace($output)) { Append-Log $output.Trim() }
        if (-not [string]::IsNullOrWhiteSpace($errorOutput)) { Append-Log $errorOutput.Trim() }
        if ($exitCode -eq 0) {
            if ([string]::IsNullOrWhiteSpace($output) -and [string]::IsNullOrWhiteSpace($errorOutput)) {
                Append-Log (S "noOutput")
            }
            Set-State (Format-S "completed" @($script:CurrentAction)) ([Drawing.Color]::FromArgb(22, 101, 52))
        } else {
            Set-State (Format-S "failed" @($script:CurrentAction)) ([Drawing.Color]::Firebrick)
        }
        Set-Busy $false $script:CurrentAction
        Refresh-RepositoryState
        $script:CurrentAction = ""
    })
    $script:ProcessTimer.Start()
}

function Test-LocalChanges {
    Push-Location $script:RepoRoot
    try {
        $changes = @(& git status --porcelain 2>$null)
        return $changes.Count -gt 0
    } finally {
        Pop-Location
    }
}

function New-SidebarButton([string]$Text, [string]$Tip, [int]$Top) {
    $button = New-Object System.Windows.Forms.Button
    $button.Text = $Text
    $button.Left = 18
    $button.Top = $Top
    $button.Width = 184
    $button.Height = 42
    $button.FlatStyle = [Windows.Forms.FlatStyle]::Flat
    $button.FlatAppearance.BorderColor = [Drawing.Color]::FromArgb(218, 223, 230)
    $button.BackColor = [Drawing.Color]::White
    $button.ForeColor = [Drawing.Color]::FromArgb(31, 41, 55)
    $button.TextAlign = [Drawing.ContentAlignment]::MiddleLeft
    $button.Padding = New-Object Windows.Forms.Padding(14, 0, 0, 0)
    $button.Cursor = [Windows.Forms.Cursors]::Hand
    $script:ToolTip.SetToolTip($button, $Tip)
    $script:Sidebar.Controls.Add($button)
    $script:ActionButtons.Add($button)
    return $button
}

function Show-NewPostDialog {
    $dialog = New-Object System.Windows.Forms.Form
    $dialog.Text = S "newPostTitle"
    $dialog.Size = New-Object Drawing.Size(520, 330)
    $dialog.StartPosition = "CenterParent"
    $dialog.FormBorderStyle = "FixedDialog"
    $dialog.MaximizeBox = $false
    $dialog.MinimizeBox = $false
    $dialog.BackColor = [Drawing.Color]::White
    $dialog.Font = New-Object Drawing.Font("Microsoft YaHei UI", 10)

    $slugLabel = New-Object Windows.Forms.Label
    $slugLabel.Text = S "slugLabel"
    $slugLabel.SetBounds(28, 24, 430, 24)
    $dialog.Controls.Add($slugLabel)

    $slugBox = New-Object Windows.Forms.TextBox
    $slugBox.SetBounds(28, 53, 448, 30)
    $dialog.Controls.Add($slugBox)

    $hint = New-Object Windows.Forms.Label
    $hint.Text = S "slugHint"
    $hint.ForeColor = [Drawing.Color]::DimGray
    $hint.SetBounds(28, 88, 448, 42)
    $dialog.Controls.Add($hint)

    $titleLabel = New-Object Windows.Forms.Label
    $titleLabel.Text = S "titleLabel"
    $titleLabel.SetBounds(28, 137, 430, 24)
    $dialog.Controls.Add($titleLabel)

    $titleBox = New-Object Windows.Forms.TextBox
    $titleBox.SetBounds(28, 166, 448, 30)
    $dialog.Controls.Add($titleBox)

    $createButton = New-Object Windows.Forms.Button
    $createButton.Text = S "create"
    $createButton.SetBounds(294, 226, 110, 38)
    $createButton.BackColor = [Drawing.Color]::FromArgb(22, 101, 52)
    $createButton.ForeColor = [Drawing.Color]::White
    $createButton.FlatStyle = "Flat"
    $createButton.DialogResult = "OK"
    $dialog.Controls.Add($createButton)

    $cancelButton = New-Object Windows.Forms.Button
    $cancelButton.Text = S "cancel"
    $cancelButton.SetBounds(414, 226, 62, 38)
    $cancelButton.DialogResult = "Cancel"
    $dialog.Controls.Add($cancelButton)
    $dialog.AcceptButton = $createButton
    $dialog.CancelButton = $cancelButton

    while ($dialog.ShowDialog($script:Form) -eq "OK") {
        $slug = $slugBox.Text.Trim().ToLowerInvariant()
        if ($slug -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$') {
            [Windows.Forms.MessageBox]::Show((S "invalidSlug"), (S "newPostTitle"), "OK", "Warning") | Out-Null
            continue
        }
        $title = $titleBox.Text.Trim()
        $args = "-Command new -NonInteractive -Slug " + (Quote-PowerShellLiteral $slug) + " -PostTitle " + (Quote-PowerShellLiteral $title)
        $dialog.Dispose()
        Start-EngineAction (S "newPost") $args
        Append-Log (S "createdHint")
        return
    }
    $dialog.Dispose()
}

function Toggle-Preview {
    if ($script:PreviewProcess -and -not $script:PreviewProcess.HasExited) {
        try { $script:PreviewProcess.Kill() } catch {}
        $script:PreviewProcess.Dispose()
        $script:PreviewProcess = $null
        $script:PreviewButton.Text = S "preview"
        Append-Log (S "previewStopped")
        Set-State (S "ready") ([Drawing.Color]::FromArgb(31, 41, 55))
        return
    }

    $hugo = Get-Command hugo -ErrorAction SilentlyContinue
    if (-not $hugo) {
        [Windows.Forms.MessageBox]::Show((S "hugoUnavailable"), (S "appTitle"), "OK", "Warning") | Out-Null
        return
    }

    try {
        $startInfo = New-Object Diagnostics.ProcessStartInfo
        $startInfo.FileName = $hugo.Source
        $startInfo.Arguments = "server --buildDrafts"
        $startInfo.WorkingDirectory = $script:RepoRoot
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $script:PreviewProcess = [Diagnostics.Process]::Start($startInfo)
        Start-Sleep -Milliseconds 800
        if ($script:PreviewProcess.HasExited) { throw (S "previewFailed") }
        $script:PreviewButton.Text = S "stopPreview"
        Append-Log (S "previewStarted")
        Start-Process "http://localhost:1313/"
    } catch {
        $script:PreviewProcess = $null
        [Windows.Forms.MessageBox]::Show($_.Exception.Message, (S "appTitle"), "OK", "Error") | Out-Null
    }
}

$script:Form = New-Object System.Windows.Forms.Form
$script:Form.Text = S "appTitle"
$script:Form.StartPosition = "CenterScreen"
$script:Form.AutoScaleMode = [Windows.Forms.AutoScaleMode]::None
$workArea = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$windowWidth = [Math]::Min(960, [Math]::Max(720, $workArea.Width - 32))
$windowHeight = [Math]::Min(650, [Math]::Max(480, $workArea.Height - 32))
$script:Form.Size = New-Object Drawing.Size($windowWidth, $windowHeight)
$script:Form.MinimumSize = New-Object Drawing.Size(720, 480)
$script:Form.BackColor = [Drawing.Color]::White
$script:Form.Font = New-Object Drawing.Font("Microsoft YaHei UI", 10)
$script:Form.Icon = [Drawing.SystemIcons]::Application

$header = New-Object Windows.Forms.Panel
$header.Dock = "Top"
$header.Height = 82
$header.BackColor = [Drawing.Color]::FromArgb(247, 249, 251)
$script:Form.Controls.Add($header)

$titleLabel = New-Object Windows.Forms.Label
$titleLabel.Text = S "appTitle"
$titleLabel.Font = New-Object Drawing.Font("Microsoft YaHei UI", 18, [Drawing.FontStyle]::Bold)
$titleLabel.ForeColor = [Drawing.Color]::FromArgb(17, 24, 39)
$titleLabel.AutoSize = $true
$titleLabel.Location = New-Object Drawing.Point(26, 13)
$header.Controls.Add($titleLabel)

$subtitleLabel = New-Object Windows.Forms.Label
$subtitleLabel.Text = S "subtitle"
$subtitleLabel.ForeColor = [Drawing.Color]::FromArgb(90, 99, 112)
$subtitleLabel.AutoSize = $true
$subtitleLabel.Location = New-Object Drawing.Point(28, 50)
$header.Controls.Add($subtitleLabel)

$script:Sidebar = New-Object Windows.Forms.Panel
$script:Sidebar.Dock = "Left"
$script:Sidebar.Width = 220
$script:Sidebar.BackColor = [Drawing.Color]::FromArgb(247, 249, 251)
$script:Sidebar.AutoScroll = $true
$script:Form.Controls.Add($script:Sidebar)

$script:ToolTip = New-Object Windows.Forms.ToolTip
$script:ToolTip.AutoPopDelay = 6000

$publishButton = New-SidebarButton (S "publish") (S "publishTip") 18
$syncButton = New-SidebarButton (S "sync") (S "syncTip") 68
$statusButton = New-SidebarButton (S "status") (S "statusTip") 118
$buildButton = New-SidebarButton (S "build") (S "buildTip") 168
$script:PreviewButton = New-SidebarButton (S "preview") (S "previewTip") 218
$newPostButton = New-SidebarButton (S "newPost") (S "newPostTip") 268
$siteButton = New-SidebarButton (S "openSite") (S "openSite") 318
$cmsButton = New-SidebarButton (S "openCms") (S "openCms") 368

$publishButton.BackColor = [Drawing.Color]::FromArgb(22, 101, 52)
$publishButton.ForeColor = [Drawing.Color]::White
$publishButton.FlatAppearance.BorderColor = [Drawing.Color]::FromArgb(22, 101, 52)

$contentPanel = New-Object Windows.Forms.Panel
$contentPanel.Dock = "Fill"
$contentPanel.Padding = New-Object Windows.Forms.Padding(26, 20, 26, 22)
$script:Form.Controls.Add($contentPanel)
$contentPanel.BringToFront()
$header.BringToFront()

$stateCaption = New-Object Windows.Forms.Label
$stateCaption.Text = S "currentState"
$stateCaption.AutoSize = $true
$stateCaption.ForeColor = [Drawing.Color]::DimGray
$stateCaption.Location = New-Object Drawing.Point(27, 20)
$contentPanel.Controls.Add($stateCaption)

$script:StateValue = New-Object Windows.Forms.Label
$script:StateValue.Text = S "ready"
$script:StateValue.AutoSize = $true
$script:StateValue.Font = New-Object Drawing.Font("Microsoft YaHei UI", 12, [Drawing.FontStyle]::Bold)
$script:StateValue.ForeColor = [Drawing.Color]::FromArgb(31, 41, 55)
$script:StateValue.Location = New-Object Drawing.Point(26, 45)
$contentPanel.Controls.Add($script:StateValue)

$script:RepoState = New-Object Windows.Forms.Label
$script:RepoState.Text = S "branchState"
$script:RepoState.AutoEllipsis = $true
$script:RepoState.Anchor = "Top,Left,Right"
$script:RepoState.ForeColor = [Drawing.Color]::FromArgb(75, 85, 99)
$script:RepoState.Font = New-Object Drawing.Font("Consolas", 9)
$script:RepoState.SetBounds(28, 78, 640, 50)
$contentPanel.Controls.Add($script:RepoState)

$script:Progress = New-Object Windows.Forms.ProgressBar
$script:Progress.Anchor = "Top,Left,Right"
$script:Progress.SetBounds(28, 131, 658, 4)
$contentPanel.Controls.Add($script:Progress)

$logCaption = New-Object Windows.Forms.Label
$logCaption.Text = S "activityLog"
$logCaption.AutoSize = $true
$logCaption.Location = New-Object Drawing.Point(27, 153)
$contentPanel.Controls.Add($logCaption)

$script:LogBox = New-Object Windows.Forms.RichTextBox
$script:LogBox.ReadOnly = $true
$script:LogBox.BackColor = [Drawing.Color]::FromArgb(250, 251, 252)
$script:LogBox.ForeColor = [Drawing.Color]::FromArgb(31, 41, 55)
$script:LogBox.BorderStyle = "FixedSingle"
$script:LogBox.Font = New-Object Drawing.Font("Consolas", 9.5)
$script:LogBox.Anchor = "Top,Bottom,Left,Right"
$script:LogBox.SetBounds(28, 181, 658, 330)
$contentPanel.Controls.Add($script:LogBox)

$script:Form.Controls.Clear()
$rootLayout = New-Object Windows.Forms.TableLayoutPanel
$rootLayout.Dock = "Fill"
$rootLayout.RowCount = 2
$rootLayout.ColumnCount = 1
[void]$rootLayout.RowStyles.Add((New-Object Windows.Forms.RowStyle("Absolute", 82)))
[void]$rootLayout.RowStyles.Add((New-Object Windows.Forms.RowStyle("Percent", 100)))
[void]$rootLayout.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle("Percent", 100)))

$bodyLayout = New-Object Windows.Forms.TableLayoutPanel
$bodyLayout.Dock = "Fill"
$bodyLayout.RowCount = 1
$bodyLayout.ColumnCount = 2
[void]$bodyLayout.RowStyles.Add((New-Object Windows.Forms.RowStyle("Percent", 100)))
[void]$bodyLayout.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle("Absolute", 220)))
[void]$bodyLayout.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle("Percent", 100)))

$header.Dock = "Fill"
$script:Sidebar.Dock = "Fill"
$contentPanel.Dock = "Fill"
$bodyLayout.Controls.Add($script:Sidebar, 0, 0)
$bodyLayout.Controls.Add($contentPanel, 1, 0)
$rootLayout.Controls.Add($header, 0, 0)
$rootLayout.Controls.Add($bodyLayout, 0, 1)
$script:Form.Controls.Add($rootLayout)

$publishButton.Add_Click({
    $answer = [Windows.Forms.MessageBox]::Show((S "confirmPublish"), (S "confirmPublishTitle"), "YesNo", "Question")
    if ($answer -eq "Yes") {
        Start-EngineAction (S "publish") "-Command publish -NonInteractive"
    }
})
$syncButton.Add_Click({
    if (Test-LocalChanges) {
        [Windows.Forms.MessageBox]::Show((S "localChangesForSync"), (S "localChangesTitle"), "OK", "Information") | Out-Null
        return
    }
    Start-EngineAction (S "sync") "-Command sync -NonInteractive"
})
$statusButton.Add_Click({ Start-EngineAction (S "status") "-Command status -NonInteractive" })
$buildButton.Add_Click({ Start-EngineAction (S "build") "-Command build -NonInteractive" })
$script:PreviewButton.Add_Click({ Toggle-Preview })
$newPostButton.Add_Click({ Show-NewPostDialog })
$siteButton.Add_Click({ Start-EngineAction (S "openSite") "-Command site -NonInteractive" })
$cmsButton.Add_Click({ Start-EngineAction (S "openCms") "-Command cms -NonInteractive" })

$script:Form.Add_FormClosing({
    param($sender, $eventArgs)
    if ($script:IsBusy) {
        [Windows.Forms.MessageBox]::Show((S "closeWhileBusy"), (S "appTitle"), "OK", "Information") | Out-Null
        $eventArgs.Cancel = $true
        return
    }
    if ($script:PreviewProcess -and -not $script:PreviewProcess.HasExited) {
        try { $script:PreviewProcess.Kill() } catch {}
    }
})

if (-not (Test-Path (Join-Path $script:RepoRoot ".git"))) {
    [Windows.Forms.MessageBox]::Show((S "notRepository"), (S "appTitle"), "OK", "Error") | Out-Null
    exit 1
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    [Windows.Forms.MessageBox]::Show((S "gitUnavailable"), (S "appTitle"), "OK", "Error") | Out-Null
    exit 1
}

Refresh-RepositoryState
Append-Log (S "ready")
[Windows.Forms.Application]::EnableVisualStyles()

if (-not [string]::IsNullOrWhiteSpace($ScreenshotPath)) {
    $script:Form.Add_Shown({
        if ($SmokeTest) {
            if ($SmokeAction -eq "build") {
                Start-EngineAction (S "build") "-Command build -NonInteractive"
            } else {
                Start-EngineAction (S "status") "-Command status -NonInteractive"
            }
        }
        $script:ScreenshotTimer = New-Object Windows.Forms.Timer
        $script:ScreenshotTimer.Interval = 250
        $script:ScreenshotTimer.Add_Tick({
            if ($SmokeTest -and $script:IsBusy) { return }
            $script:ScreenshotTimer.Stop()
            $bitmap = New-Object Drawing.Bitmap($script:Form.ClientSize.Width, $script:Form.ClientSize.Height)
            $script:Form.DrawToBitmap($bitmap, $script:Form.ClientRectangle)
            $bitmap.Save($ScreenshotPath, [Drawing.Imaging.ImageFormat]::Png)
            $bitmap.Dispose()
            if ($SmokeTest) {
                [Console]::Out.WriteLine($script:LogBox.Text)
            }
            $script:ScreenshotTimer.Dispose()
            $script:Form.Close()
        })
        $script:ScreenshotTimer.Start()
    })
}
[void]$script:Form.ShowDialog()
