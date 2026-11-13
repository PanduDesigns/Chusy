# Pruebas de convertir-step.ps1 con PowerShell (las lanza tests/v91-convertir-step.test.mjs si hay `pwsh`).
# Carga las funciones del script SIN ejecutarlo (CHUSY_CONVERT_STEP_NOMAIN) y sustituye lo que depende de Windows/Inventor.
param([Parameter(Mandatory)][string]$Script, [Parameter(Mandatory)][string]$Work)
$ErrorActionPreference = 'Stop'
$env:CHUSY_CONVERT_STEP_NOMAIN = '1'
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
Check 'Test-SameFile: mismo tamano y fecha' (Test-SameFile $mine)
Check 'Test-SameFile: otro tamano o fecha no vale' (-not (Test-SameFile $other))
Check 'Test-SameFile: un archivo inexistente no vale' (-not (Test-SameFile (Join-Path $Work 'nada.ipt')))

# --- Find-SourceFile: el orden y la comprobacion de identidad (Inventor y Recientes se simulan)
function Get-InventorOpenPaths([string]$Name) { return @($script:FakeOpen) }
function Get-RecentPaths([string]$Name) { return @($script:FakeRecent) }
$script:FakeOpen = @(); $script:FakeRecent = @()

$script:FakeOpen = @($mine)
Check 'un documento abierto en Inventor con ese nombre, tamano y fecha: se usa ese' ((Find-SourceFile -Name 'Eje_26001.ipt' -Root '' -NoDialog) -eq $mine)
$script:FakeOpen = @($other); $script:FakeRecent = @($mine)
Check 'si el abierto no es el que se sube (otro tamano/fecha), se salta a los archivos recientes' ((Find-SourceFile -Name 'Eje_26001.ipt' -Root '' -NoDialog) -eq $mine)
$script:FakeOpen = @(); $script:FakeRecent = @($other)
Check 'un reciente que no coincide no se convierte en silencio (sin dialogo: no se encuentra)' ((Find-SourceFile -Name 'Eje_26001.ipt' -Root '' -NoDialog) -eq '')
$script:FakeRecent = @()
Check 'por carpeta: encuentra ESE archivo (no la copia OldVersions ni el homonimo de otra carpeta)' ((Find-SourceFile -Name 'Eje_26001.ipt' -Root $Work -NoDialog) -eq $mine)
Check 'por carpeta de un proyecto sin el archivo: no se encuentra' ((Find-SourceFile -Name 'Eje_26001.ipt' -Root $otro -NoDialog) -eq '')
$script:FakeOpen = @($mine)
Check 'la ruta completa manda sobre todo lo demas' ((Find-SourceFile -ExplicitPath $other -Name '' -Root '' -NoDialog) -eq $other)
$script:FakeOpen = @()
$threw = $false; try { Find-SourceFile -ExplicitPath (Join-Path $Work 'a.pdf') -Name '' -Root '' -NoDialog } catch { $threw = $true }
Check 'una ruta que no es .ipt/.iam se rechaza' $threw
$threw = $false; try { Find-SourceFile -ExplicitPath (Join-Path $Work 'noexiste.ipt') -Name '' -Root '' -NoDialog } catch { $threw = $true }
Check 'una ruta que no existe se rechaza' $threw
$threw = $false; try { Find-SourceFile -Name 'a.dwg' -Root '' -NoDialog } catch { $threw = $true }
Check 'un nombre que no es .ipt/.iam se rechaza' $threw

# --- Sin datos de tamano/fecha (el .ipt ya subido a Drive solo trae el tamano)
$Size = 0; $Modified = 0   # (no se vuelve a cargar el script: pisaria los simulacros)
$script:FakeRecent = @($other)
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
