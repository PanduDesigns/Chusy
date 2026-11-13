#requires -Version 5.1
<#
.SYNOPSIS
    Chusy - Convierte UN SOLO archivo .ipt/.iam de Inventor a STEP (.stp), junto al original (v91).

.DESCRIPTION
    Lo lanza Windows cuando el navegador abre un enlace
        chusy-step://convert?file=<nombre o ruta>&size=<bytes>&modified=<ms>[&searchRoot=<carpeta>]
    (el boton "Convertir a .STEP en mi PC" de Chusy) o se ejecuta a mano:
        .\convertir-step.ps1 -FilePath 'C:\Proyectos\26001\Eje_26001.ipt'
        .\convertir-step.ps1 -FileName 'Eje_26001.ipt' -Size 48213 -Modified 1731480000000

    REGLA: convierte el archivo que se esta subiendo y NUNCA el resto de la carpeta (Exportar-IPT.ps1 es el de
    "todos los de una carpeta"; este es el de "solo este").

    DE DONDE VIENE EL ARCHIVO. El navegador no puede decir en que carpeta esta el archivo que se sube (solo da el
    nombre, el tamano y la fecha de modificacion), asi que este script lo localiza en tu PC, por este orden, y solo
    da por bueno un archivo con ESE nombre y, si Chusy los envia, el MISMO tamano y la MISMA fecha:
      1. -FilePath, si se indica la ruta completa.
      2. Un documento de Inventor ya abierto con ese nombre.
      3. La lista de archivos recientes de Windows (los que acabas de elegir en el selector del navegador).
      4. -SearchRoot, si se indica una carpeta (busca solo ese nombre exacto; sin copias OldVersions).
      5. Si no aparece, te abre una ventana para que elijas el archivo original.

    QUE HACE CON INVENTOR (igual que Exportar-IPT.ps1): Windows PowerShell 5.1 en STA, abre el archivo con
    SkipAllUnresolvedFiles (sin dialogos), SilentOperation y ScreenUpdating apagados (se restauran), traductor STEP
    {90AF7F40-0C01-11D5-8E83-0010B541CD80} con AP214 y SaveCopyAs a <MismoNombre>.stp en la MISMA carpeta. Si el
    archivo ya estaba abierto en Inventor lo deja abierto; si lo abrio el script lo cierra SIN guardar; si Inventor
    no estaba abierto lo abre sin ventana y lo cierra al terminar. Al acabar abre el Explorador con el .stp.

    Si algo falla la ventana se queda abierta con el motivo; todo queda tambien en
    %LOCALAPPDATA%\Chusy\convertir-step.log
#>
[CmdletBinding()]
param(
    [string]$Url,
    [string]$FilePath,
    [string]$FileName,
    [string]$SearchRoot,
    [long]$Size = 0,
    [long]$Modified = 0,
    [switch]$KeepInventorOpen,
    [switch]$ResolveOnly,
    [switch]$NoPause
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:StepTranslatorId = '{90AF7F40-0C01-11D5-8E83-0010B541CD80}'
$script:Extension = '.stp'
$script:LogFile = $null
$script:ModifiedToleranceMs = 3000

# ---------------------------------------------------------------- utilidades
function Write-Log([string]$Text, [string]$Color = 'Gray') {
    Write-Host $Text -ForegroundColor $Color
    if ($script:LogFile) {
        try { Add-Content -LiteralPath $script:LogFile -Value ('{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $Text) -Encoding UTF8 } catch { }
    }
}

function Test-InventorFile([string]$Path) {
    $e = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
    return ($e -eq '.ipt' -or $e -eq '.iam')
}

# Lo que dice Chusy del archivo (tamano y fecha); lo que no diga, no se comprueba.
function Test-SameFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    $file = Get-Item -LiteralPath $Path
    if ($Size -gt 0 -and $file.Length -ne $Size) { return $false }
    if ($Modified -gt 0) {
        $ms = ([System.DateTimeOffset]$file.LastWriteTimeUtc).ToUnixTimeMilliseconds()
        if ([Math]::Abs($ms - $Modified) -gt $script:ModifiedToleranceMs) { return $false }
    }
    return $true
}

function Read-ChusyUrl([string]$Text) {
    # chusy-step://convert?file=C%3A%5C...%5CEje.ipt&size=123&modified=456  (el navegador puede anadir una "/" tras "convert")
    $result = @{}
    $rest = $Text -replace '^chusy-step:/{0,2}', ''
    $queryStart = $rest.IndexOf('?')
    if ($queryStart -lt 0) { return $result }
    foreach ($pair in $rest.Substring($queryStart + 1).Split('&')) {
        $eq = $pair.IndexOf('=')
        if ($eq -lt 1) { continue }
        $result[$pair.Substring(0, $eq).ToLowerInvariant()] = [System.Uri]::UnescapeDataString($pair.Substring($eq + 1)).Trim().Trim('"')
    }
    return $result
}

# ---------------------------------------------------------------- donde esta el archivo
function Get-InventorOpenPaths([string]$Name) {
    # Documentos de Inventor YA abiertos con ese nombre (no abre ni crea nada).
    $paths = @()
    try {
        $inv = [System.Runtime.InteropServices.Marshal]::GetActiveObject('Inventor.Application')
        foreach ($doc in $inv.Documents) {
            $full = [string]$doc.FullFileName
            if ([System.IO.Path]::GetFileName($full) -ieq $Name) { $paths += $full }
        }
    }
    catch { }
    return $paths
}

function Resolve-ShortcutTarget([string]$Lnk) {
    try { return [string](New-Object -ComObject WScript.Shell).CreateShortcut($Lnk).TargetPath } catch { return '' }
}

function Get-RecentPaths([string]$Name) {
    # "Archivos recientes" de Windows: el selector de archivos del navegador deja ahi lo que eliges.
    $recent = if ($env:APPDATA) { Join-Path $env:APPDATA 'Microsoft\Windows\Recent' } else { '' }
    if (-not $recent -or -not (Test-Path -LiteralPath $recent -PathType Container)) { return @() }
    $lnk = Join-Path $recent ($Name + '.lnk')
    if (-not (Test-Path -LiteralPath $lnk -PathType Leaf)) { return @() }
    $target = Resolve-ShortcutTarget $lnk
    if ($target) { return @($target) }
    return @()
}

function Get-SearchRootPaths([string]$Name, [string]$Root) {
    if ([string]::IsNullOrWhiteSpace($Root) -or -not (Test-Path -LiteralPath $Root -PathType Container)) { return @() }
    Write-Log "Buscando $Name en $Root ..." 'Cyan'
    # UN nombre exacto, sin comodines y sin las copias OldVersions de Inventor.
    $found = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Filter $Name -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ieq $Name -and $_.FullName -notmatch '[\\/]OldVersions[\\/]' })
    return @($found | ForEach-Object { $_.FullName })
}

function Select-SourceFileDialog([string]$Name, [string]$StartDir) {
    Add-Type -AssemblyName System.Windows.Forms
    $owner = New-Object System.Windows.Forms.Form
    $owner.TopMost = $true
    $owner.ShowInTaskbar = $false
    $owner.StartPosition = 'CenterScreen'
    $owner.Size = New-Object System.Drawing.Size(1, 1)
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = "Chusy - elige el archivo original: $Name"
    $dialog.Filter = "$Name|$Name|Archivos de Inventor (*.ipt;*.iam)|*.ipt;*.iam"
    $dialog.FileName = $Name
    if ($StartDir -and (Test-Path -LiteralPath $StartDir -PathType Container)) { $dialog.InitialDirectory = $StartDir }
    try {
        $owner.Show()
        if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { return $dialog.FileName }
    }
    finally { $owner.Close(); $owner.Dispose() }
    return ''
}

<#
    Devuelve la ruta del archivo a convertir, o '' si no se encuentra (o el usuario cancela). Solo acepta un
    archivo con el nombre pedido y, si se conocen, el mismo tamano y la misma fecha que el que se sube.
#>
function Find-SourceFile {
    param([string]$ExplicitPath, [string]$Name, [string]$Root, [switch]$NoDialog)

    if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
        $path = $ExplicitPath.Trim().Trim('"')
        if (-not (Test-InventorFile $path)) { throw "Solo se pueden convertir archivos .ipt o .iam de Inventor: $path" }
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "No encuentro el archivo: $path" }
        return (Resolve-Path -LiteralPath $path).ProviderPath
    }

    $Name = [System.IO.Path]::GetFileName(([string]$Name).Trim().Trim('"'))
    if (-not (Test-InventorFile $Name)) { throw "Solo se pueden convertir archivos .ipt o .iam de Inventor: $Name" }

    $sources = @(
        @{ Label = 'abierto en Inventor'; Paths = (Get-InventorOpenPaths $Name) },
        @{ Label = 'archivos recientes de Windows'; Paths = (Get-RecentPaths $Name) },
        @{ Label = 'carpeta indicada'; Paths = (Get-SearchRootPaths $Name $Root) }
    )
    $guessDir = ''
    foreach ($source in $sources) {
        foreach ($candidate in @($source.Paths)) {
            if (-not $candidate) { continue }
            if (Test-SameFile $candidate) {
                Write-Log "Encontrado ($($source.Label)): $candidate" 'Green'
                return (Resolve-Path -LiteralPath $candidate).ProviderPath
            }
            if (-not $guessDir -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
                $guessDir = [System.IO.Path]::GetDirectoryName($candidate)
                Write-Log "Descartado ($($source.Label)), no coincide el tamano o la fecha: $candidate" 'Yellow'
            }
        }
    }
    if ($NoDialog) { return '' }
    if (-not $guessDir -and $Root -and (Test-Path -LiteralPath $Root -PathType Container)) { $guessDir = $Root }
    Write-Log "No he localizado $Name solo: elige el archivo original en la ventana." 'Yellow'
    $picked = Select-SourceFileDialog $Name $guessDir
    if (-not $picked) { return '' }
    if (-not (Test-InventorFile $picked)) { throw "Solo se pueden convertir archivos .ipt o .iam de Inventor: $picked" }
    return $picked
}

# ---------------------------------------------------------------- Inventor
function Connect-Inventor {
    # El Inventor abierto, o uno nuevo sin ventana. Devuelve @{ App = ...; Started = $true/$false }.
    try {
        $app = [System.Runtime.InteropServices.Marshal]::GetActiveObject('Inventor.Application')
        Write-Log 'Usando el Inventor que ya esta abierto.' 'Cyan'
        return @{ App = $app; Started = $false }
    }
    catch {
        Write-Log 'Inventor no esta abierto: abriendo uno sin ventana (puede tardar)...' 'Cyan'
        return @{ App = (New-Object -ComObject Inventor.Application); Started = $true }
    }
}

function Convert-ToStep([string]$SourcePath) {
    $target = [System.IO.Path]::ChangeExtension($SourcePath, $script:Extension)
    $inventor = $null
    $startedInventor = $false
    $previousSilent = $null
    $previousScreen = $null
    $document = $null
    $openedByUs = $false
    try {
        $connection = Connect-Inventor
        $inventor = $connection.App
        $startedInventor = $connection.Started
        # Igual que Exportar-IPT.ps1: sin dialogos y sin repintar; se restaura en finally.
        $previousSilent = [bool]$inventor.SilentOperation
        $inventor.SilentOperation = $true
        $previousScreen = [bool]$inventor.ScreenUpdating
        $inventor.ScreenUpdating = $false

        $translator = $inventor.ApplicationAddIns.ItemById($script:StepTranslatorId)
        if ($null -eq $translator) { throw 'Este Inventor no tiene el traductor de STEP. Revisa que este instalado y activado.' }
        $translator.Activate()

        # Si el disenador ya lo tiene abierto, se usa tal cual y se deja abierto.
        try { $document = $inventor.Documents.ItemByName($SourcePath) } catch { $document = $null }
        if ($null -ne $document) {
            Write-Log "El archivo ya estaba abierto en Inventor: se deja abierto." 'Cyan'
        }
        else {
            Write-Log "Abriendo en Inventor: $([System.IO.Path]::GetFileName($SourcePath))" 'Cyan'
            $openOptions = $inventor.TransientObjects.CreateNameValueMap()
            $openOptions.Add('SkipAllUnresolvedFiles', $true)
            $document = $inventor.Documents.OpenWithOptions($SourcePath, $openOptions, $false)
            $openedByUs = $true
        }

        Write-Log '  Exportando a STEP (AP214)...' 'Cyan'
        $context = $inventor.TransientObjects.CreateTranslationContext()
        $context.Type = 13059   # kFileBrowseIOMechanism
        $options = $inventor.TransientObjects.CreateNameValueMap()
        if ($translator.HasSaveCopyAsOptions($document, $context, $options)) {
            $options.Value('ApplicationProtocolType') = 3   # AP214
        }
        $medium = $inventor.TransientObjects.CreateDataMedium()
        $medium.FileName = $target
        $translator.SaveCopyAs($document, $context, $options, $medium)
    }
    finally {
        if ($openedByUs -and $null -ne $document) {
            try { $document.Close($true) } catch { Write-Log "No se pudo cerrar el archivo: $($_.Exception.Message)" 'Yellow' }   # SkipSave
        }
        if ($null -ne $inventor -and $null -ne $previousScreen) { try { $inventor.ScreenUpdating = $previousScreen } catch { } }
        if ($null -ne $inventor -and $null -ne $previousSilent) { try { $inventor.SilentOperation = $previousSilent } catch { } }
        if ($startedInventor -and -not $KeepInventorOpen -and $null -ne $inventor) {
            try { $inventor.Quit() } catch { Write-Log "Inventor quedo abierto: $($_.Exception.Message)" 'Yellow' }
        }
        if ($null -ne $document) { try { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) } catch { } }
        if ($null -ne $inventor) { try { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($inventor) } catch { } }
    }
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw 'Inventor no ha generado el archivo STEP.' }
    return $target
}

# ---------------------------------------------------------------- principal
function Invoke-Main {
    try {
        $dir = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Chusy' } else { $env:TEMP }
        if ($dir) {
            if (-not (Test-Path -LiteralPath $dir)) { [void](New-Item -ItemType Directory -Path $dir -Force) }
            $script:LogFile = Join-Path $dir 'convertir-step.log'
        }
    } catch { $script:LogFile = $null }

    # El enlace del navegador (si lo hay) rellena el resto de parametros.
    if (-not [string]::IsNullOrWhiteSpace($Url)) {
        $q = Read-ChusyUrl $Url
        $v = if ($q.ContainsKey('file')) { $q['file'] } else { '' }
        if ($v -and [System.IO.Path]::IsPathRooted($v)) { $script:FilePath = $v } else { $script:FileName = $v }
        if ($q.ContainsKey('searchroot')) { $script:SearchRoot = $q['searchroot'] }
        if ($q.ContainsKey('size')) { $script:Size = [long]$q['size'] }
        if ($q.ContainsKey('modified')) { $script:Modified = [long]$q['modified'] }
    }

    # Inventor exige un hilo STA y Windows PowerShell 5.1 (como Exportar-IPT.ps1).
    if (-not $ResolveOnly) {
        $isDesktop = ($PSVersionTable.PSEdition -eq 'Desktop')
        $isSta = ([System.Threading.Thread]::CurrentThread.ApartmentState -eq 'STA')
        if (-not $isDesktop -or -not $isSta) {
            $winPs = Join-Path -Path $env:WINDIR -ChildPath 'System32\WindowsPowerShell\v1.0\powershell.exe'
            if (-not (Test-Path -LiteralPath $winPs -PathType Leaf)) { throw 'No se encontro Windows PowerShell 5.1, necesario para automatizar Inventor.' }
            $forward = @('-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath)
            if ($script:FilePath) { $forward += @('-FilePath', $script:FilePath) }
            if ($script:FileName) { $forward += @('-FileName', $script:FileName) }
            if ($script:SearchRoot) { $forward += @('-SearchRoot', $script:SearchRoot) }
            if ($script:Size -gt 0) { $forward += @('-Size', [string]$script:Size) }
            if ($script:Modified -gt 0) { $forward += @('-Modified', [string]$script:Modified) }
            if ($KeepInventorOpen) { $forward += '-KeepInventorOpen' }
            if ($NoPause) { $forward += '-NoPause' }
            & $winPs @forward
            exit $LASTEXITCODE
        }
    }

    $exit = 0
    try {
        Write-Log '=== Chusy - Convertir a STEP ===' 'White'
        $what = if ($script:FilePath) { $script:FilePath } else { $script:FileName }
        if ([string]::IsNullOrWhiteSpace($what)) { throw 'Falta indicar el archivo .ipt o .iam que hay que convertir.' }
        Write-Log "Archivo: $what" 'White'

        $source = Find-SourceFile -ExplicitPath $script:FilePath -Name $script:FileName -Root $script:SearchRoot -NoDialog:$ResolveOnly
        if ($ResolveOnly) {
            if ($source) { Write-Output "RESOLVED: $source" } else { Write-Output 'NOTFOUND' }
            return
        }
        if (-not $source) { Write-Log 'Cancelado: no se ha elegido ningun archivo.' 'Yellow'; return }

        $target = Convert-ToStep $source
        Write-Log "Creado: $target" 'Green'
        Start-Process -FilePath 'explorer.exe' -ArgumentList ('/select,"' + $target + '"')
        Start-Sleep -Seconds 2
    }
    catch {
        $exit = 1
        Write-Log "ERROR: $($_.Exception.Message)" 'Red'
        if ($_.Exception.Message -match 'E_FAIL|0x8000|0x8007|COM') { Write-Log 'Con E_FAIL: Inventor y el navegador tienen que estar al mismo nivel de permisos (los dos normales, o los dos como administrador).' 'Yellow' }
        if ($script:LogFile) { Write-Host "Registro: $script:LogFile" -ForegroundColor DarkGray }
        if (-not $NoPause -and -not $ResolveOnly) { try { [void](Read-Host 'Pulsa Intro para cerrar') } catch { } }
    }
    exit $exit
}

# Las pruebas cargan las funciones sin ejecutar nada (CHUSY_CONVERT_STEP_NOMAIN=1 y dot-sourcing).
if (-not $env:CHUSY_CONVERT_STEP_NOMAIN) { Invoke-Main }
