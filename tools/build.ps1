param(
    [string]$OutputDirectory = 'release/TimeStamp-v1.1',
    [string]$ArchivePath = 'release/TimeStamp-Windows-v1.1.zip'
)
$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
Push-Location $workspaceRoot
try {
    & dotnet publish src/TimeStamp.App/TimeStamp.App.csproj -c Release --self-contained false -o $OutputDirectory --configfile NuGet.Config --nologo
    if ($LASTEXITCODE -ne 0) { throw 'App build failed' }
    Copy-Item -LiteralPath README.md -Destination (Join-Path $OutputDirectory 'README.md') -Force
    Compress-Archive -LiteralPath $OutputDirectory -DestinationPath $ArchivePath -Force
    Write-Output ('Ready: ' + (Join-Path $OutputDirectory 'TimeStamp.exe'))
}
finally { Pop-Location }
