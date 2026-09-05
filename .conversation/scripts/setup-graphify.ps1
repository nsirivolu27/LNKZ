<#
  Registers Graphify and LNKZ as MCP servers for the Claude desktop app.

  Claude's config lives in a protected AppData folder, so this has to run on the
  machine itself:

      powershell -ExecutionPolicy Bypass -File scripts\setup-graphify.ps1

  Existing servers in the config are preserved; only the two entries below are
  added or replaced. Restart the Claude desktop app afterwards.
#>

$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$configDir = Join-Path $env:APPDATA "Claude"
$configPath = Join-Path $configDir "claude_desktop_config.json"

$graphifyPython = Join-Path $env:APPDATA "uv\tools\graphifyy\Scripts\python.exe"
if (-not (Test-Path $graphifyPython)) {
  Write-Warning "graphifyy was not found at $graphifyPython. Install it with: uv tool install graphifyy"
  $graphifyPython = "python"
}

$graphPath = Join-Path $repo "graphify-out\graph.json"
if (-not (Test-Path $graphPath)) {
  Write-Warning "No graph yet at $graphPath. Build one with: graphify . --update"
}

New-Item -ItemType Directory -Force -Path $configDir | Out-Null

$config = if (Test-Path $configPath) {
  Get-Content $configPath -Raw | ConvertFrom-Json -AsHashtable
} else {
  @{}
}
if (-not $config.ContainsKey("mcpServers")) { $config["mcpServers"] = @{} }

$config["mcpServers"]["graphify"] = @{
  command = $graphifyPython
  args    = @("-m", "graphify.serve", $graphPath)
}

$config["mcpServers"]["lnkz"] = @{
  command = "node"
  args    = @((Join-Path $repo "mcp-server\dist\stdio.js"))
  env     = @{ LNKZ_DB_FILE = (Join-Path $repo ".data\lnkz.db") }
}

Copy-Item $configPath "$configPath.bak" -ErrorAction SilentlyContinue
$config | ConvertTo-Json -Depth 12 | Set-Content $configPath -Encoding UTF8

Write-Host "Wrote $configPath"
Write-Host "Backed up the previous file to $configPath.bak (if one existed)."
Write-Host "Restart the Claude desktop app, then ask it to call graphify_overview or list_connectors."
