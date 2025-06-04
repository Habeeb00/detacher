$ErrorActionPreference = "Stop"

function Run-Build {
    Write-Host "🔨 Building plugin..." -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Build failed!" -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Build successful!" -ForegroundColor Green
}

function Watch-Changes {
    Write-Host "👀 Watching for changes..." -ForegroundColor Cyan
    npm run watch
}

function Help {
    Write-Host "Detachr Plugin Development Helper" -ForegroundColor Yellow
    Write-Host "--------------------------------" -ForegroundColor Yellow
    Write-Host "Usage: .\dev.ps1 [command]" -ForegroundColor White
    Write-Host ""
    Write-Host "Commands:" -ForegroundColor White
    Write-Host "  build     Build the plugin (default if no command is given)" -ForegroundColor White
    Write-Host "  watch     Watch for changes and rebuild automatically" -ForegroundColor White
    Write-Host "  help      Display this help message" -ForegroundColor White
}

$command = $args[0]

switch ($command) {
    "watch" { Watch-Changes }
    "help" { Help }
    default { Run-Build }
}
