# Pruebas de convertir-step.ps1 con PowerShell (las lanza tests/v91-convertir-step.test.mjs si hay `pwsh`).
# Carga las funciones del script SIN ejecutarlo (CHUSY_CONVERT_STEP_NOMAIN) y sustituye lo que depende de Windows/Inventor.
param([Parameter(Mandatory)][string]$Script, [Parameter(Mandatory)][string]$Work)
$ErrorActionPreference = 'Stop'
$env:CHUSY_CONVERT_STEP_NOMAIN = '1'
$env:LOCALAPPDATA = Join-Path $Work 'appdata'   # la memoria y el registro de las pruebas, aparte de los de verdad
[void](New-Item -ItemType Directory -Path $env:LOCALAPPDATA -Force)
$results = [System.Collections.Generic.List[string]]::new()
function Check([string]$Name, [bool]$Ok) { $results.Add(('{0}|{1}' -f $(if ($Ok) { 'OK' } else { 'FALLA' }), $Name)) }

# Carpeta de trabajo: un proyecto con el archivo en una subcarpeta, una copia en OldVersions y otro del mismo nombre en otro sitio.
$proy = Join-Path $Work 'proy'; $sub = Join-Path $proy 'sub'; $old = Join-Path $proy 'OldVersions'; $otro = Join-Path $Work 'otro'
foreach ($d in @($sub, $old, $otro)) { [void](New-Item -ItemType Directory -Path $d -Force) }
$mine = Join-Path $sub 'Eje_26001.ipt'; $oldCopy = Join-Path $old 'Eje_26001.ipt'; $other = Join-Path $otro 'Eje_26001.ipt'
Set-Content -LiteralPath $mine -Value 'AAAA' -NoNewline; Set-Content -LiteralPath $oldCopy -Value 'AAAA' -NoNewline; Set-Content -LiteralPath $other -Value 'BBBBBB' -NoNewline
$when = [datetime]::new(2026, 11, 10, 10, 0, 0, [System.DateTimeKind]::Utc)
foreach ($f in @($mine, $oldCopy)) { (Get-Item -LiteralPath $f).LastWriteTimeUtc = $when }
(Get-Item -LiteralPath $other).LastWriteTimeUtc = $when.AddDays(30)
$ms = ([System.DateTimeOffset]$when).ToUnixTimeMilliseconds()

# --- Read-ChusyUrl y la identidad del archivo
. $Script -Size 4 -Modified $ms
$q = Read-ChusyUrl 'chusy-step://convert/?file=Eje%5F26001.ipt&size=4&modified=123&searchRoot=C%3A%5CProy%20x'
Check 'Read-ChusyUrl: file, size, modified y searchRoot (con la / que anade el navegador)' ($q['file'] -eq 'Eje_26001.ipt' -and $q['size'] -eq '4' -and $q['modified'] -eq '123' -and $q['searchroot'] -eq 'C:\Proy x')
Check 'Test-SameFile: mismo tamano y fecha' (Test-SameFile $mine 4 $ms 3000)
Check 'Test-SameFile: otro tamano o fecha no vale' (-not (Test-SameFile $other 4 $ms 3000))
Check 'Test-SameFile: sin datos (0) no se comprueba nada mas que el archivo exista' (Test-SameFile $other 0 0 3000)
Check 'Test-SameFile: un archivo inexistente no vale' (-not (Test-SameFile (Join-Path $Work 'nada.ipt') 0 0 3000))

# --- Find-SourceFile: el orden y la comprobacion de identidad (Inventor y Recientes se simulan)
# Los simulacros se definen como funciones AUTONOMAS (con las rutas incrustadas): Invoke-Guarded copia las funciones al hilo de vigilancia.
function Set-Fakes([string[]]$Open, [string[]]$Recent) {
    $o = ($Open | ForEach-Object { "'" + $_ + "'" }) -join ','
    $r = ($Recent | ForEach-Object { "'" + $_ + "'" }) -join ','
    Invoke-Expression ('function script:Get-InventorOpenPaths([string]$Name) { return @(' + $o + ') }')
    Invoke-Expression ('function script:Get-RecentPaths([string]$Name) { return @(' + $r + ') }')
    Invoke-Expression 'function script:Get-LikelyFolders { return @() }'   # sin Explorador ni navegador reales
}
Set-Fakes @() @()

Set-Fakes @($mine) @()
Check 'un documento abierto en Inventor con ese nombre, tamano y fecha: se usa ese' ((Find-SourceFile -Name 'Eje_26001.ipt' -Root '' -NoDialog) -eq $mine)
Set-Fakes @($other) @($mine)
Check 'si el abierto no es el que se sube (otro tamano/fecha), se salta a los archivos recientes' ((Find-SourceFile -Name 'Eje_26001.ipt' -Root '' -NoDialog) -eq $mine)
Set-Fakes @() @($other)
Check 'un reciente que no coincide no se convierte en silencio (sin dialogo: no se encuentra)' ((Find-SourceFile -Name 'Eje_26001.ipt' -Root '' -NoDialog) -eq '')
Set-Fakes @() @()
Check 'por carpeta: encuentra ESE archivo (no la copia OldVersions ni el homonimo de otra carpeta)' ((Find-SourceFile -Name 'Eje_26001.ipt' -Root $Work -NoDialog) -eq $mine)
Check 'por carpeta de un proyecto sin el archivo: no se encuentra' ((Find-SourceFile -Name 'Eje_26001.ipt' -Root $otro -NoDialog) -eq '')
Set-Fakes @($mine) @()
Check 'la ruta completa manda sobre todo lo demas' ((Find-SourceFile -ExplicitPath $other -Name '' -Root '' -NoDialog) -eq $other)
Set-Fakes @() @()
$threw = $false; try { Find-SourceFile -ExplicitPath (Join-Path $Work 'a.pdf') -Name '' -Root '' -NoDialog } catch { $threw = $true }
Check 'una ruta que no es .ipt/.iam se rechaza' $threw
$threw = $false; try { Find-SourceFile -ExplicitPath (Join-Path $Work 'noexiste.ipt') -Name '' -Root '' -NoDialog } catch { $threw = $true }
Check 'una ruta que no existe se rechaza' $threw
$threw = $false; try { Find-SourceFile -Name 'a.dwg' -Root '' -NoDialog } catch { $threw = $true }
Check 'un nombre que no es .ipt/.iam se rechaza' $threw

# --- Sin datos de tamano/fecha (el .ipt ya subido a Drive solo trae el tamano)
$script:Size = 0; $script:Modified = 0   # (no se vuelve a cargar el script: pisaria los simulacros)
Set-Fakes @() @($other)
Check 'sin tamano ni fecha se acepta el primero que haya con ese nombre (reciente)' ((Find-SourceFile -Name 'Eje_26001.ipt' -Root '' -NoDialog) -eq $other)


# --- La conversion con un Inventor simulado: UN solo SaveCopyAs, a <Nombre>.stp junto al original, y cada caso de cierre
Add-Type -TypeDefinition @"
using System; using System.Collections.Generic;
public class FakeMap { public Dictionary<string,object> D = new Dictionary<string,object>();
  [System.Runtime.CompilerServices.IndexerName("Value")] public object this[string k] { get { return D[k]; } set { D[k] = value; } }
  public void Add(string k, object v) { D[k] = v; } }
public class FakeMedium { public string FileName; }
public class FakeContext { public int Type; }
public class FakeDoc { public string FullFileName; public List<string> Log; public void Close(bool skip) { Log.Add("Close:" + skip); } }
public class FakeTranslator { public List<string> Log; public bool Fail;
  public void Activate() { Log.Add("Activate"); }
  public bool HasSaveCopyAsOptions(object doc, object ctx, object opts) { return true; }
  public void SaveCopyAs(object doc, object ctx, object opts, object medium) {
    var m = (FakeMedium)medium; var o = (FakeMap)opts;
    Log.Add("SaveCopyAs:" + m.FileName + ":AP=" + o["ApplicationProtocolType"] + ":Ctx=" + ((FakeContext)ctx).Type);
    if (Fail) throw new Exception("E_FAIL simulado");
    System.IO.File.WriteAllText(m.FileName, "STEP"); } }
public class FakeAddIns { public FakeTranslator T; public bool Missing; public object ItemById(string id) { T.Log.Add("ItemById:" + id); return Missing ? null : T; } }
public class FakeTransient { public FakeMap CreateNameValueMap() { return new FakeMap(); } public FakeContext CreateTranslationContext() { return new FakeContext(); } public FakeMedium CreateDataMedium() { return new FakeMedium(); } }
public class FakeDocs { public List<string> Log; public Dictionary<string, FakeDoc> Open = new Dictionary<string, FakeDoc>();
  public FakeDoc ItemByName(string p) { if (Open.ContainsKey(p)) return Open[p]; throw new Exception("no abierto"); }
  public FakeDoc OpenWithOptions(string p, object opts, bool vis) { var m = (FakeMap)opts; Log.Add("Open:" + p + ":Skip=" + m["SkipAllUnresolvedFiles"] + ":Visible=" + vis); return new FakeDoc { FullFileName = p, Log = Log }; } }
public class FakeInventor { public FakeDocs Documents; public FakeAddIns ApplicationAddIns; public FakeTransient TransientObjects = new FakeTransient();
  public bool SilentOperation; public bool ScreenUpdating = true; public List<string> Log; public void Quit() { Log.Add("Quit"); } }
"@
function New-FakeInventor([bool]$Started, [bool]$Fail = $false, [bool]$Missing = $false, [bool]$AlreadyOpen = $false, [string]$Path = '') {
    $log = [System.Collections.Generic.List[string]]::new()
    $t = [FakeTranslator]::new(); $t.Log = $log; $t.Fail = $Fail
    $ai = [FakeAddIns]::new(); $ai.T = $t; $ai.Missing = $Missing
    $docs = [FakeDocs]::new(); $docs.Log = $log
    if ($AlreadyOpen) { $d = [FakeDoc]::new(); $d.FullFileName = $Path; $d.Log = $log; $docs.Open[$Path] = $d }
    $inv = [FakeInventor]::new(); $inv.Documents = $docs; $inv.ApplicationAddIns = $ai; $inv.Log = $log
    $script:Fake = @{ App = $inv; Started = $Started }
    return ,$log
}
function Connect-Inventor { return $script:Fake }
$target = [System.IO.Path]::ChangeExtension($mine, '.stp')
if (Test-Path $target) { Remove-Item $target }

$log = New-FakeInventor $false
$r = Convert-ToStep $mine
Check 'conversion: devuelve <Nombre>.stp en la MISMA carpeta del archivo' ($r -eq $target -and (Test-Path $target) -and [System.IO.Path]::GetDirectoryName($r) -eq $sub)
Check 'conversion: abre ESE archivo con SkipAllUnresolvedFiles y sin ventana' ($log -contains "Open:${mine}:Skip=True:Visible=False")
Check 'conversion: UN solo SaveCopyAs, AP214 (3), contexto 13059, traductor STEP' (@($log | Where-Object { $_ -like 'SaveCopyAs:*' }).Count -eq 1 -and $log -contains "SaveCopyAs:${target}:AP=3:Ctx=13059" -and $log -contains 'ItemById:{90AF7F40-0C01-11D5-8E83-0010B541CD80}')
Check 'conversion: lo que abrio el script se cierra SIN guardar (SkipSave)' ($log -contains 'Close:True')
Check 'conversion: con un Inventor que ya estaba abierto no se cierra Inventor' (-not ($log -contains 'Quit'))
$app = $script:Fake.App
Check 'conversion: SilentOperation y ScreenUpdating vuelven a como estaban' ($app.SilentOperation -eq $false -and $app.ScreenUpdating -eq $true)

Remove-Item $target
$log = New-FakeInventor $false -AlreadyOpen $true -Path $mine
[void](Convert-ToStep $mine)
Check 'conversion: si el disenador ya lo tenia abierto, no se abre otra vez ni se cierra' (-not ($log | Where-Object { $_ -like 'Open:*' }) -and -not ($log -contains 'Close:True') -and $log -contains "SaveCopyAs:${target}:AP=3:Ctx=13059")

Remove-Item $target
$log = New-FakeInventor $true
[void](Convert-ToStep $mine)
Check 'conversion: un Inventor abierto por el script se cierra al terminar (Quit)' ($log -contains 'Quit')
Remove-Item $target
$log = New-FakeInventor $true
$KeepInventorOpen = [System.Management.Automation.SwitchParameter]::new($true)
[void](Convert-ToStep $mine)
Check 'conversion: con -KeepInventorOpen no se cierra' (-not ($log -contains 'Quit'))
$KeepInventorOpen = [System.Management.Automation.SwitchParameter]::new($false)

Remove-Item $target
$log = New-FakeInventor $false -Fail $true
$msg = ''; try { [void](Convert-ToStep $mine) } catch { $msg = $_.Exception.Message }
Check 'conversion: si Inventor falla al exportar, el error sube y el archivo se cierra igualmente sin guardar' ($msg -match 'E_FAIL' -and $log -contains 'Close:True' -and -not (Test-Path $target))
$log = New-FakeInventor $false -Missing $true
$msg = ''; try { [void](Convert-ToStep $mine) } catch { $msg = $_.Exception.Message }
Check 'conversion: sin traductor de STEP, error claro y no se abre ningun archivo' ($msg -match 'traductor de STEP' -and -not ($log | Where-Object { $_ -like 'Open:*' }))


# --- La memoria: donde se encontro un archivo se recuerda, y la proxima vez no hay que preguntar
Set-Fakes @() @()
$script:Size = 4; $script:Modified = $ms
Save-Memory $mine
$mem = Read-Memory
Check 'memoria: Save-Memory guarda la carpeta y el archivo, y Read-Memory los devuelve' (@($mem.folders)[0] -eq $sub -and $mem.files['eje_26001.ipt'] -eq $mine)
$memoryFile = Get-MemoryFilePath
Check 'memoria: el archivo esta en %LOCALAPPDATA%\Chusy\convertir-step-memoria.json' ($memoryFile -like '*convertir-step-memoria.json' -and (Test-Path $memoryFile))
$c = @(Get-Candidates 'memory' 'Eje_26001.ipt' '' 4 $ms 3000)
Check 'memoria: el mismo archivo se reconoce sin buscar (1|ruta)' ($c.Count -ge 1 -and $c[0] -eq "1|$mine")
# otro archivo de la MISMA carpeta (nunca visto) y otro en una subcarpeta profunda de ella
$new1 = Join-Path $sub 'Otro_26001.ipt'; Set-Content -LiteralPath $new1 -Value 'CCC' -NoNewline; (Get-Item -LiteralPath $new1).LastWriteTimeUtc = $when
$deepDir = Join-Path $sub 'a\b'; [void](New-Item -ItemType Directory -Path $deepDir -Force)
$new2 = Join-Path $deepDir 'Hondo_26001.ipt'; Set-Content -LiteralPath $new2 -Value 'DDDDD' -NoNewline; (Get-Item -LiteralPath $new2).LastWriteTimeUtc = $when
$script:Size = 3
Check 'memoria: un archivo NUEVO de una carpeta recordada se encuentra sin preguntar' ((Find-SourceFile -Name 'Otro_26001.ipt' -Root '' -NoDialog) -eq $new1)
$script:Size = 5
Check 'memoria: y uno en una subcarpeta (hasta 3 niveles) de una carpeta recordada' ((Find-SourceFile -Name 'Hondo_26001.ipt' -Root '' -NoDialog) -eq $new2)
$script:Size = 4
Check 'memoria: no confunde un homonimo de otro tamano' ((Find-SourceFile -Name 'Eje_26001.ipt' -Root '' -NoDialog) -eq $mine)
function Select-SourceFileDialog([string]$Name, [string]$StartDir) { throw 'no deberia preguntar' }
$threw = $false; $got = ''
try { $got = Find-SourceFile -Name 'Eje_26001.ipt' -Root '' } catch { $threw = $true }
Check 'memoria: con el archivo recordado NO se abre la ventana de eleccion' (-not $threw -and $got -eq $mine)
$asked = @{ dir = '' }
function Select-SourceFileDialog([string]$Name, [string]$StartDir) { $script:Asked = $StartDir; return $other }
$script:Size = 6
$got = Find-SourceFile -Name 'Eje_26001.ipt' -Root ''
Check 'sin ninguna pista se abre la ventana de eleccion, empezando por la carpeta recordada' ($got -eq $other -and $script:Asked -eq $sub)
function Select-SourceFileDialog([string]$Name, [string]$StartDir) { throw 'no deberia preguntar' }
Save-Memory $other
$mem = Read-Memory
Check 'memoria: lo elegido a mano tambien se recuerda (la carpeta pasa a ser la primera)' (@($mem.folders)[0] -eq $otro -and @($mem.folders)[1] -eq $sub -and $mem.files['eje_26001.ipt'] -eq $other)
Save-Memory $mine
Check 'memoria: recordar de nuevo sube la carpeta al principio y no duplica' (@(Read-Memory).Count -ge 0 -and @((Read-Memory).folders | Where-Object { $_ -eq $sub }).Count -eq 1 -and @((Read-Memory).folders)[0] -eq $sub)
$script:Size = 4

# --- El canal con Chusy: el servidor local (127.0.0.1 + clave) que ve el progreso y entrega el .stp
$port = Get-Random -Minimum 47700 -Maximum 47990
$tok = 'tok' + [guid]::NewGuid().ToString('N')
$srv = Start-StepServer $port $tok
Check 'canal: el servidor abre el puerto en 127.0.0.1' ($srv.State.ServerUp -eq $true)
$base = "http://127.0.0.1:$port/$tok"
function Get-Http([string]$u, [string]$method = 'GET') {
    try { $r = Invoke-WebRequest -Uri $u -Method $method -UseBasicParsing -TimeoutSec 5; return @{ Code = [int]$r.StatusCode; Body = $r.Content; Headers = $r.Headers; Raw = $r } }
    catch {
        $resp = $null
        if ($_.Exception.PSObject.Properties['Response']) { $resp = $_.Exception.Response }
        if ($resp) { return @{ Code = [int]$resp.StatusCode; Body = ''; Headers = $resp.Headers } }
        return @{ Code = 0; Body = ''; Headers = @{} }
    }
}
$r = Get-Http "$base/status"
$j = $r.Body | ConvertFrom-Json
Check 'canal: /status al principio dice «searching»' ($r.Code -eq 200 -and $j.status -eq 'searching')
Check 'canal: la respuesta lleva CORS (cualquier origen) y el permiso de red privada' (([string]$r.Headers['Access-Control-Allow-Origin']) -eq '*' -and ([string]$r.Headers['Access-Control-Allow-Private-Network']) -eq 'true')
Set-StepState 'converting' 'Convirtiendo con Inventor...'
$j = (Get-Http "$base/status").Body | ConvertFrom-Json
Check 'canal: Set-StepState cambia lo que ve Chusy' ($j.status -eq 'converting' -and $j.message -eq 'Convirtiendo con Inventor...')
Set-StepState 'dialog' 'Elige "el" archivo \ ahora'
$j = (Get-Http "$base/status").Body | ConvertFrom-Json
Check 'canal: el JSON escapa comillas y barras invertidas' ($j.status -eq 'dialog' -and $j.message -eq 'Elige "el" archivo \ ahora')
Check 'canal: /file antes de terminar da 409 (no hay nada que entregar)' ((Get-Http "$base/file").Code -eq 409)
Check 'canal: una clave equivocada da 404' ((Get-Http "http://127.0.0.1:$port/otraclave12345/status").Code -eq 404 -and (Get-Http "http://127.0.0.1:$port/status").Code -eq 404)
Check 'canal: la peticion OPTIONS (comprobacion previa del navegador) se contesta 204 con los permisos' ((Get-Http "$base/status" 'Options').Code -eq 204 -and ([string](Get-Http "$base/status" 'Options').Headers['Access-Control-Allow-Private-Network']) -eq 'true')
$stp = Join-Path $sub 'Eje_26001.stp'
$bytes = [byte[]](0..255 + 0..255)
[System.IO.File]::WriteAllBytes($stp, $bytes)
Set-StepState 'done' 'Listo.' $stp
$j = (Get-Http "$base/status").Body | ConvertFrom-Json
Check 'canal: al terminar, /status trae el nombre y el tamano del .stp' ($j.status -eq 'done' -and $j.name -eq 'Eje_26001.stp' -and $j.size -eq 512)
Check 'canal: aun sin recoger, Wait-StepServed no lo da por entregado' (-not (Wait-StepServed 1))
$wc = New-Object System.Net.WebClient
$got = $wc.DownloadData("$base/file")
Check 'canal: /file entrega EXACTAMENTE los bytes del .stp' ($got.Length -eq 512 -and -not (Compare-Object $got $bytes))
Check 'canal: al recogerlo queda marcado como entregado' (Wait-StepServed 3)
Stop-StepServer
Start-Sleep -Milliseconds 300
Check 'canal: al cerrar, el puerto deja de contestar' ((Get-Http "$base/status").Code -eq 0)
Check 'canal: sin servidor, Set-StepState y Wait-StepServed no hacen nada ni fallan' ((Set-StepState 'done' 'x') -eq $null -and -not (Wait-StepServed 1))
$busy = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port); $busy.Start()
$srv2 = Start-StepServer $port $tok
Check 'canal: con el puerto ocupado avisa del error (y no se cuelga)' (-not $srv2.State.ServerUp -and $srv2.State.ServerError)
$busy.Stop(); Stop-StepServer

# --- Vigilancia: un paso que se cuelga (Inventor ocupado, recurso de red caido) NO bloquea el script
function Get-Colgado([string]$Name) { Start-Sleep -Seconds 30; return @('1|nunca') }
function Get-InventorOpenPaths([string]$Name) { Start-Sleep -Seconds 30; return @('1|nunca') }
$t0 = Get-Date
$res = Invoke-Guarded -Label 'prueba de paso colgado' -Function 'Get-InventorOpenPaths' -Arguments @('x.ipt') -Seconds 2
$secs = ((Get-Date) - $t0).TotalSeconds
Check 'vigilancia: un paso que no responde se abandona a los 2 s y devuelve $null (no se queda esperando)' ($null -eq $res -and $secs -lt 10)
Set-Fakes @() @($mine)
$script:Size = 4; $script:Modified = $ms
$t0 = Get-Date
Set-Fakes @() @()
function Get-InventorOpenPaths([string]$Name) { Start-Sleep -Seconds 30; return @() }
Invoke-Expression ('function Get-RecentPaths([string]$Name) { return @(' + "'" + $mine + "'" + ') }')
$found = Find-SourceFile -Name 'Eje_26001.ipt' -Root '' -NoDialog
$secs = ((Get-Date) - $t0).TotalSeconds
Check 'vigilancia: con Inventor colgado, los recientes se miran ANTES y el archivo se encuentra sin esperar a Inventor' ($found -eq $mine -and $secs -lt 20)
Set-Fakes @() @()

# --- El script entero en modo -ResolveOnly (proceso aparte, como lo lanza Windows)
$env:CHUSY_CONVERT_STEP_NOMAIN = ''
$pwsh = (Get-Process -Id $PID).Path
$out = & $pwsh -NoProfile -File $Script -ResolveOnly -FileName 'Eje_26001.ipt' -Size 4 -Modified $ms -SearchRoot $Work 2>&1 | Out-String
Check '-ResolveOnly por parametros: RESOLVED con la ruta' ($out -match [regex]::Escape("RESOLVED: $mine"))
$enc = [System.Uri]::EscapeDataString($Work)
$out = & $pwsh -NoProfile -File $Script -ResolveOnly -Url "chusy-step://convert/?file=Eje_26001.ipt&size=4&modified=$ms&searchRoot=$enc" 2>&1 | Out-String
Check '-ResolveOnly por la URL del protocolo: RESOLVED con la ruta' ($out -match [regex]::Escape("RESOLVED: $mine"))
$out = & $pwsh -NoProfile -File $Script -ResolveOnly -FileName 'Eje_26001.ipt' -Size 5 -SearchRoot $Work 2>&1 | Out-String
Check '-ResolveOnly con otro tamano: NOTFOUND' ($out -match 'NOTFOUND')
$out = & $pwsh -NoProfile -File $Script -ResolveOnly -FileName 'x.pdf' -NoPause 2>&1 | Out-String
Check '-ResolveOnly con un .pdf: error y no se convierte' ($out -match 'Solo se pueden convertir archivos \.ipt o \.iam')

$results | ForEach-Object { Write-Output $_ }
