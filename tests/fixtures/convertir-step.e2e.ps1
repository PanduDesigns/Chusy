# Ejecuta el script REAL (Invoke-Main: busqueda, memoria, canal con Chusy, entrega) con un Inventor simulado: solo se sustituye
# Convert-ToStep por algo que escribe el .stp. Lo lanza tests/v92-conversion-automatica.test.mjs, que hace de Chusy (step-bridge.js).
param([Parameter(Mandatory)][string]$Script, [string]$IptPath, [string]$IptName, [long]$Size = 0, [long]$Modified = 0, [int]$Port, [string]$Token, [string]$Mode = 'ok')
$env:CHUSY_CONVERT_STEP_NOMAIN = '1'
$env:CHUSY_CONVERT_STEP_NOSTA = '1'
$forward = @{ Port = $Port; Token = $Token; NoPause = $true }
if ($IptPath) { $forward.FilePath = $IptPath } else { $forward.FileName = $IptName; $forward.Size = $Size; $forward.Modified = $Modified }
. $Script @forward
function Convert-ToStep([string]$SourcePath) {
    Start-Sleep -Milliseconds 900   # da tiempo a que Chusy vea «converting»
    if ($Mode -eq 'fail') { throw 'E_FAIL simulado' }
    $target = [System.IO.Path]::ChangeExtension($SourcePath, '.stp')
    [System.IO.File]::WriteAllBytes($target, [byte[]](1..200 + 1..200))
    return $target
}
function Start-Process { param($FilePath, $ArgumentList) Write-Output "EXPLORER: $ArgumentList" }   # sin Explorador real
Invoke-Main
