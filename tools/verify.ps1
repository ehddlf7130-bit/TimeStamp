$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
Push-Location $workspaceRoot
try {
    New-Item -ItemType Directory -Force artifacts | Out-Null
    & dotnet run --project tests/TimeStamp.Checks/TimeStamp.Checks.csproj -c Release --configfile NuGet.Config | Tee-Object artifacts/core-checks.txt
    if ($LASTEXITCODE -ne 0) { throw 'Core checks failed' }
    & dotnet build src/TimeStamp.App/TimeStamp.App.csproj -c Release --configfile NuGet.Config --nologo
    if ($LASTEXITCODE -ne 0) { throw 'App build failed' }
    $appPath = Join-Path $workspaceRoot 'src/TimeStamp.App/bin/Release/net9.0-windows/TimeStamp.exe'
    $resultPath = Join-Path $workspaceRoot 'artifacts/render-checks'
    $checkProcess = Start-Process -FilePath $appPath -ArgumentList '--self-test', ('"' + $resultPath + '"') -WindowStyle Hidden -Wait -PassThru
    if ($checkProcess.ExitCode -ne 0) { throw 'Render/integration checks failed; see render-check-error.txt' }
    Get-Content -LiteralPath (Join-Path $resultPath 'results.txt')
}
finally { Pop-Location }
