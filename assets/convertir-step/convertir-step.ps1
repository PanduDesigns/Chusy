#requires -Version 5.1
<#
.SYNOPSIS
    Chusy - Convierte UN SOLO archivo .ipt/.iam de Inventor a STEP (.stp), junto al original, y se lo entrega a Chusy (v92).

.DESCRIPTION
    Lo lanza Windows cuando el navegador abre un enlace
        chusy-step://convert?file=<nombre o ruta>&size=<bytes>&modified=<ms>&port=<puerto>&token=<clave>
    (Chusy lo hace SOLO al subir un .ipt/.iam sin su STEP) o se ejecuta a mano:
        .\convertir-step.ps1 -FilePath 'C:\Proyectos\26001\Eje_26001.ipt'
        .\convertir-step.ps1 -FileName 'Eje_26001.ipt' -Size 48213 -Modified 1731480000000

    REGLA: convierte el archivo que se esta subiendo y NUNCA el resto de la carpeta (Exportar-IPT.ps1 es el de
    "todos los de una carpeta"; este es el de "solo este").

    ENTREGA A CHUSY. Con -Port y -Token abre un canal local (solo 127.0.0.1, protegido por la clave) por el que Chusy
    ve el progreso y recoge el .stp en cuanto esta creado, y lo sube a la tarea sin que hagas nada. Si Chusy no lo
    recoge en unos segundos, abre el Explorador con el .stp seleccionado, como antes.

    DE DONDE VIENE EL ARCHIVO. El navegador no puede decir en que carpeta esta el archivo que se sube (solo da el
    nombre, el tamano y la fecha de modificacion), asi que este script lo localiza en tu PC, por este orden, y solo
    da por bueno un archivo con ESE nombre y, si Chusy los envia, el MISMO tamano y la MISMA fecha:
      1. -FilePath, si se indica la ruta completa.
      2. LA MEMORIA: donde se encontraron archivos antes (carpetas y archivos, %LOCALAPPDATA%\Chusy\convertir-step-memoria.json).
      3. La lista de archivos recientes de Windows (los que acabas de elegir en el selector del navegador).
      4. Las carpetas de las ventanas del Explorador que tengas abiertas (por si lo arrastraste desde ahi) y la ultima
         carpeta que el navegador uso en el selector de archivos.
      5. Un documento de Inventor ya abierto con ese nombre.
      6. -SearchRoot, si se indica una carpeta (busca solo ese nombre exacto; sin copias OldVersions).
      7. Si no aparece, te abre una ventana para que elijas el archivo original; y SE RECUERDA para la proxima vez.
    Cada paso corre en un hilo aparte con limite de tiempo: si Inventor esta ocupado (por ejemplo con un cuadro de
    dialogo abierto) o un recurso de red no responde, se salta ese paso en vez de quedarse esperando.

    QUE HACE CON INVENTOR (igual que Exportar-IPT.ps1): Windows PowerShell 5.1 en STA, abre el archivo con
    SkipAllUnresolvedFiles (sin dialogos), SilentOperation y ScreenUpdating apagados (se restauran), traductor STEP
    {90AF7F40-0C01-11D5-8E83-0010B541CD80} con AP214 y SaveCopyAs a <MismoNombre>.stp en la MISMA carpeta. Si el
    archivo ya estaba abierto en Inventor lo deja abierto; si lo abrio el script lo cierra SIN guardar; si Inventor
    no estaba abierto lo abre sin ventana y lo cierra al terminar.

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
    [int]$Port = 0,
    [string]$Token = '',
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
$script:StepServer = $null

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

# Lo que dice Chusy del archivo (tamano y fecha); lo que no diga (0), no se comprueba. Autonoma: corre tambien en el hilo de vigilancia.
function Test-SameFile([string]$Path, [long]$ExpectedSize, [long]$ExpectedModified, [long]$ToleranceMs) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    $file = Get-Item -LiteralPath $Path
    if ($ExpectedSize -gt 0 -and $file.Length -ne $ExpectedSize) { return $false }
    if ($ExpectedModified -gt 0) {
        $ms = ([System.DateTimeOffset]$file.LastWriteTimeUtc).ToUnixTimeMilliseconds()
        if ([Math]::Abs($ms - $ExpectedModified) -gt $ToleranceMs) { return $false }
    }
    return $true
}

function Read-ChusyUrl([string]$Text) {
    # chusy-step://convert?file=C%3A%5C...%5CEje.ipt&size=123&modified=456&port=47650&token=abc  (el navegador puede anadir una "/" tras "convert")
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

# ---------------------------------------------------------------- memoria: donde se encontraron archivos antes
function Get-MemoryFilePath {
    $base = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { $env:TEMP }
    if (-not $base) { return '' }
    return (Join-Path (Join-Path $base 'Chusy') 'convertir-step-memoria.json')
}

# { folders: [carpetas, la mas reciente primero], files: [{ name, path }] } -> @{ folders = @(); files = @{ 'nombre.ipt' = 'ruta' } }
function Read-Memory {
    $memory = @{ folders = @(); files = @{} }
    try {
        $file = Get-MemoryFilePath
        if ($file -and (Test-Path -LiteralPath $file -PathType Leaf)) {
            $json = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($json.folders) { $memory.folders = @($json.folders | ForEach-Object { [string]$_ }) }
            if ($json.files) {
                foreach ($entry in @($json.files)) {
                    if ($entry.name -and $entry.path) { $memory.files[([string]$entry.name).ToLowerInvariant()] = [string]$entry.path }
                }
            }
        }
    }
    catch { }
    return $memory
}

function Save-Memory([string]$SourcePath) {
    try {
        $file = Get-MemoryFilePath
        if (-not $file) { return }
        $dir = [System.IO.Path]::GetDirectoryName($SourcePath)
        $name = [System.IO.Path]::GetFileName($SourcePath)
        $memory = Read-Memory
        $folders = @($dir) + @($memory.folders | Where-Object { $_ -ine $dir })
        $memory.files[$name.ToLowerInvariant()] = $SourcePath
        $entries = @($memory.files.GetEnumerator() | ForEach-Object { @{ name = [string]$_.Key; path = [string]$_.Value } })
        if ($entries.Count -gt 400) { $entries = @($entries | Select-Object -Last 400) }
        $payload = @{ folders = @($folders | Select-Object -First 30); files = $entries }
        $parent = [System.IO.Path]::GetDirectoryName($file)
        if (-not (Test-Path -LiteralPath $parent)) { [void](New-Item -ItemType Directory -Path $parent -Force) }
        Set-Content -LiteralPath $file -Value ($payload | ConvertTo-Json -Depth 4) -Encoding UTF8
        Write-Log "Recordado: $dir" 'DarkGray'
    }
    catch { Write-Log "No se pudo guardar la memoria: $($_.Exception.Message)" 'Yellow' }
}

# ---------------------------------------------------------------- donde esta el archivo (cada fuente corre vigilada)
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

# Carpetas donde puede estar un archivo que acabas de subir: las ventanas del Explorador abiertas (arrastrar y soltar) y la
# ultima carpeta del selector de archivos de Chrome / Edge / Brave (la guardan en "Preferences").
function Get-LikelyFolders {
    $folders = @()
    try {
        $shell = New-Object -ComObject Shell.Application
        foreach ($window in $shell.Windows()) {
            try {
                $p = [string]$window.Document.Folder.Self.Path
                if ($p -and (Test-Path -LiteralPath $p -PathType Container)) { $folders += $p }
            } catch { }
        }
    }
    catch { }
    try {
        if ($env:LOCALAPPDATA) {
            $prefs = @()
            foreach ($rel in @('Google\Chrome\User Data', 'Microsoft\Edge\User Data', 'BraveSoftware\Brave-Browser\User Data', 'Chromium\User Data')) {
                $base = Join-Path $env:LOCALAPPDATA $rel
                if (Test-Path -LiteralPath $base -PathType Container) {
                    foreach ($profileDir in @(Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue)) {
                        $pref = Join-Path $profileDir.FullName 'Preferences'
                        if (Test-Path -LiteralPath $pref -PathType Leaf) { $prefs += Get-Item -LiteralPath $pref }
                    }
                }
            }
            foreach ($pref in @($prefs | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 4)) {
                try {
                    $json = Get-Content -LiteralPath $pref.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
                    $dir = [string]$json.selectfile.last_directory
                    if ($dir -and (Test-Path -LiteralPath $dir -PathType Container)) { $folders += $dir }
                } catch { }
            }
        }
    }
    catch { }
    return @($folders | Select-Object -Unique)
}

function Get-SearchRootPaths([string]$Name, [string]$Root, [int]$Depth = 20) {
    if ([string]::IsNullOrWhiteSpace($Root) -or -not (Test-Path -LiteralPath $Root -PathType Container)) { return @() }
    # UN nombre exacto, sin comodines y sin las copias OldVersions de Inventor.
    $found = @(Get-ChildItem -LiteralPath $Root -Recurse -Depth $Depth -File -Filter $Name -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ieq $Name -and $_.FullName -notmatch '[\\/]OldVersions[\\/]' })
    return @($found | ForEach-Object { $_.FullName })
}

# Los candidatos de UNA fuente, ya comprobados: devuelve cadenas "1|ruta" (coincide en tamano y fecha) o "0|ruta" (no coincide).
function Get-Candidates([string]$Source, [string]$Name, [string]$Root, [long]$ExpectedSize, [long]$ExpectedModified, [long]$ToleranceMs) {
    $paths = @()
    switch ($Source) {
        'memory' {
            $memory = Read-Memory
            $key = $Name.ToLowerInvariant()
            if ($memory.files.ContainsKey($key)) { $paths += $memory.files[$key] }
            foreach ($folder in @($memory.folders)) { $paths += (Join-Path $folder $Name) }
            # Subcarpetas de las primeras carpetas recordadas (un proyecto suele colgar de una carpeta comun)
            foreach ($folder in @($memory.folders | Select-Object -First 8)) { $paths += Get-SearchRootPaths $Name $folder 3 }
        }
        'recent' { $paths += Get-RecentPaths $Name }
        'folders' { foreach ($folder in @(Get-LikelyFolders)) { $paths += (Join-Path $folder $Name) } }
        'inventor' { $paths += Get-InventorOpenPaths $Name }
        'root' { $paths += Get-SearchRootPaths $Name $Root }
    }
    $seen = @{}
    foreach ($p in $paths) {
        if (-not $p) { continue }
        $k = ([string]$p).ToLowerInvariant()
        if ($seen.ContainsKey($k)) { continue }
        $seen[$k] = $true
        if (Test-Path -LiteralPath $p -PathType Leaf) { '{0}|{1}' -f [int](Test-SameFile $p $ExpectedSize $ExpectedModified $ToleranceMs), $p }
    }
}

<#
    Ejecuta una de las funciones de arriba en un HILO APARTE con limite de tiempo. Hablar con Inventor (ocupado, con un
    cuadro de dialogo abierto...) o con un recurso de red caido puede quedarse esperando para siempre; asi el script sigue
    (salta ese paso) y se ve en la ventana cual ha sido. Devuelve las cadenas que devuelva la funcion, o $null si se agoto.
#>
function Invoke-Guarded {
    param([string]$Label, [string]$Function, [object[]]$Arguments = @(), [int]$Seconds = 15)
    Write-Log $Label 'Cyan'
    $names = @('Test-SameFile', 'Get-MemoryFilePath', 'Read-Memory', 'Resolve-ShortcutTarget', 'Get-InventorOpenPaths', 'Get-RecentPaths', 'Get-LikelyFolders', 'Get-SearchRootPaths', 'Get-Candidates')
    $prelude = ($names | ForEach-Object { 'function ' + $_ + " {`n" + (Get-Command $_ -CommandType Function).Definition + "`n}`n" }) -join ''
    $runspace = $null; $ps = $null
    try {
        $runspace = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace()
        try { $runspace.ApartmentState = [System.Threading.ApartmentState]::STA } catch { }
        $runspace.Open()
        $ps = [System.Management.Automation.PowerShell]::Create()
        $ps.Runspace = $runspace
        [void]$ps.AddScript($prelude + $Function + ' @args')
        foreach ($a in $Arguments) { [void]$ps.AddArgument($a) }
        $async = $ps.BeginInvoke()
        if ($async.AsyncWaitHandle.WaitOne($Seconds * 1000)) {
            $out = @($ps.EndInvoke($async) | ForEach-Object { [string]$_ })
            foreach ($e in $ps.Streams.Error) { Write-Log "  Aviso: $($e.Exception.Message)" 'Yellow' }
            $ps.Dispose(); $runspace.Dispose()
            return , $out
        }
        # Se agoto: el hilo bloqueado se abandona (termina con el proceso); no se puede esperar a que acabe.
        Write-Log "  Sin respuesta tras $Seconds s: se salta este paso." 'Yellow'
        return $null
    }
    catch {
        Write-Log "  No se pudo comprobar este paso: $($_.Exception.Message)" 'Yellow'
        return $null
    }
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
        @{ Key = 'memory'; Label = 'Buscando donde se encontraron archivos antes...'; Where = 'memoria'; Seconds = 30 },
        @{ Key = 'recent'; Label = 'Buscando en los archivos recientes de Windows...'; Where = 'archivos recientes de Windows'; Seconds = 15 },
        @{ Key = 'folders'; Label = 'Buscando en las carpetas abiertas del Explorador y del navegador...'; Where = 'carpeta abierta'; Seconds = 15 },
        @{ Key = 'inventor'; Label = 'Buscando entre los documentos abiertos en Inventor...'; Where = 'abierto en Inventor'; Seconds = 15 }
    )
    if (-not [string]::IsNullOrWhiteSpace($Root)) {
        $sources += @{ Key = 'root'; Label = "Buscando $Name en $Root (puede tardar)..."; Where = 'carpeta indicada'; Seconds = 90 }
    }
    $guessDir = ''
    foreach ($source in $sources) {
        $found = Invoke-Guarded -Label $source.Label -Function 'Get-Candidates' -Seconds $source.Seconds `
            -Arguments @($source.Key, $Name, $Root, $script:Size, $script:Modified, $script:ModifiedToleranceMs)
        if ($null -eq $found) { continue }
        foreach ($item in @($found)) {
            $isSame = $item.StartsWith('1|')
            $candidate = $item.Substring(2)
            if ($isSame) {
                Write-Log "Encontrado ($($source.Where)): $candidate" 'Green'
                return $candidate
            }
            if (-not $guessDir) { $guessDir = [System.IO.Path]::GetDirectoryName($candidate) }
            Write-Log "Descartado ($($source.Where)), no coincide el tamano o la fecha: $candidate" 'Yellow'
        }
    }
    if ($NoDialog) { return '' }
    if (-not $guessDir) {
        $memory = Read-Memory
        if (@($memory.folders).Count -gt 0) { $guessDir = [string]@($memory.folders)[0] }
    }
    if (-not $guessDir -and $Root -and (Test-Path -LiteralPath $Root -PathType Container)) { $guessDir = $Root }
    Write-Log "No he localizado $Name solo: elige el archivo original en la ventana (se recordara la carpeta)." 'Yellow'
    Set-StepState 'dialog' "Elige el archivo $Name en la ventana de Windows."
    $picked = Select-SourceFileDialog $Name $guessDir
    if (-not $picked) { return '' }
    if (-not (Test-InventorFile $picked)) { throw "Solo se pueden convertir archivos .ipt o .iam de Inventor: $picked" }
    return $picked
}

# ---------------------------------------------------------------- canal local con Chusy (solo 127.0.0.1, protegido por una clave)
# Chusy (la pagina) pregunta por /<clave>/status y recoge el archivo en /<clave>/file. Es un servidor HTTP minimo sobre un
# TcpListener en 127.0.0.1 (no pide permisos de administrador) que corre en un hilo aparte mientras el principal habla con Inventor.
$script:ServerCode = @'
param($State, [int]$Port, [string]$Token, [int]$MaxSeconds)
function ConvertTo-JsonText([string]$s) {
    $r = $s.Replace('\', '\\').Replace('"', '\"').Replace("`r", ' ').Replace("`n", ' ').Replace("`t", ' ')
    return $r
}
function Send-Response($stream, [int]$code, [string]$reason, [string]$type, [byte[]]$body) {
    $head = "HTTP/1.1 $code $reason`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nAccess-Control-Allow-Origin: *`r`nAccess-Control-Allow-Private-Network: true`r`nAccess-Control-Allow-Methods: GET, OPTIONS`r`nAccess-Control-Allow-Headers: *`r`nAccess-Control-Expose-Headers: *`r`nAccess-Control-Max-Age: 600`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
    $bytes = [System.Text.Encoding]::ASCII.GetBytes($head)
    $stream.Write($bytes, 0, $bytes.Length)
    if ($body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
    $stream.Flush()
}
$listener = $null
try {
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
    $listener.Start()
    $State.ServerUp = $true
}
catch {
    $State.ServerError = $_.Exception.Message
    return
}
$deadline = [DateTime]::UtcNow.AddSeconds($MaxSeconds)
try {
    while (-not $State.Stop -and [DateTime]::UtcNow -lt $deadline) {
        if (-not $listener.Pending()) { Start-Sleep -Milliseconds 40; continue }
        $client = $listener.AcceptTcpClient()
        try {
            $client.ReceiveTimeout = 3000
            $client.SendTimeout = 15000
            $stream = $client.GetStream()
            $buffer = New-Object byte[] 8192
            $length = 0
            $text = ''
            while ($length -lt 8192) {
                $n = $stream.Read($buffer, $length, 8192 - $length)
                if ($n -le 0) { break }
                $length += $n
                $text = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $length)
                if ($text.Contains("`r`n`r`n")) { break }
            }
            $parts = ($text -split "`r`n")[0].Split(' ')
            if ($parts.Length -lt 2) { continue }
            $method = $parts[0].ToUpperInvariant()
            $target = $parts[1]
            $q = $target.IndexOf('?'); if ($q -ge 0) { $target = $target.Substring(0, $q) }
            if ($method -eq 'OPTIONS') { Send-Response $stream 204 'No Content' 'text/plain' ([byte[]]@()); continue }
            if ($method -ne 'GET') { Send-Response $stream 405 'Method Not Allowed' 'text/plain' ([byte[]]@()); continue }
            $segments = @($target.Trim('/').Split('/'))
            if ($segments.Length -ne 2 -or $segments[0] -cne $Token) {
                Send-Response $stream 404 'Not Found' 'text/plain' ([System.Text.Encoding]::ASCII.GetBytes('no'))
                continue
            }
            if ($segments[1] -eq 'status') {
                $json = '{"status":"' + (ConvertTo-JsonText ([string]$State.Status)) + '","message":"' + (ConvertTo-JsonText ([string]$State.Message)) + '","name":"' + (ConvertTo-JsonText ([string]$State.Name)) + '","size":' + ([long]$State.Size) + '}'
                Send-Response $stream 200 'OK' 'application/json; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes($json))
            }
            elseif ($segments[1] -eq 'file') {
                if ($State.Status -ne 'done' -or -not $State.Path -or -not [System.IO.File]::Exists([string]$State.Path)) {
                    Send-Response $stream 409 'Conflict' 'text/plain' ([System.Text.Encoding]::ASCII.GetBytes('not ready'))
                }
                else {
                    Send-Response $stream 200 'OK' 'application/octet-stream' ([System.IO.File]::ReadAllBytes([string]$State.Path))
                    $State.Served = $true
                }
            }
            else { Send-Response $stream 404 'Not Found' 'text/plain' ([System.Text.Encoding]::ASCII.GetBytes('no')) }
        }
        catch { }
        finally { try { $client.Close() } catch { } }
    }
}
finally { try { $listener.Stop() } catch { } }
'@

function Start-StepServer([int]$ServerPort, [string]$ServerToken) {
    $state = [hashtable]::Synchronized(@{ Status = 'searching'; Message = ''; Name = ''; Size = 0; Path = ''; Served = $false; Stop = $false; ServerUp = $false; ServerError = '' })
    $runspace = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace()
    $runspace.Open()
    $ps = [System.Management.Automation.PowerShell]::Create()
    $ps.Runspace = $runspace
    [void]$ps.AddScript($script:ServerCode).AddArgument($state).AddArgument($ServerPort).AddArgument($ServerToken).AddArgument(1800)
    $async = $ps.BeginInvoke()
    # Espera a que el puerto este abierto (o a que falle) antes de seguir.
    $until = [DateTime]::UtcNow.AddSeconds(5)
    while (-not $state.ServerUp -and -not $state.ServerError -and [DateTime]::UtcNow -lt $until) { Start-Sleep -Milliseconds 25 }
    $script:StepServer = @{ State = $state; PowerShell = $ps; Runspace = $runspace; Async = $async }
    return $script:StepServer
}

function Set-StepState([string]$Status, [string]$Message = '', [string]$Path = '') {
    if (-not $script:StepServer) { return }
    $state = $script:StepServer.State
    $state.Status = $Status
    $state.Message = $Message
    if ($Path) {
        $state.Path = $Path
        $state.Name = [System.IO.Path]::GetFileName($Path)
        $state.Size = (Get-Item -LiteralPath $Path).Length
    }
}

# Espera a que Chusy recoja el archivo; devuelve $true si lo recogio.
function Wait-StepServed([int]$Seconds) {
    if (-not $script:StepServer) { return $false }
    $until = [DateTime]::UtcNow.AddSeconds($Seconds)
    while (-not $script:StepServer.State.Served -and [DateTime]::UtcNow -lt $until) { Start-Sleep -Milliseconds 100 }
    return [bool]$script:StepServer.State.Served
}

function Stop-StepServer {
    if (-not $script:StepServer) { return }
    try { $script:StepServer.State.Stop = $true; Start-Sleep -Milliseconds 150; $script:StepServer.PowerShell.Dispose(); $script:StepServer.Runspace.Dispose() } catch { }
    $script:StepServer = $null
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
        Write-Log 'Conectando con Inventor...' 'Cyan'
        $connection = Connect-Inventor
        $inventor = $connection.App
        $startedInventor = $connection.Started
        # Igual que Exportar-IPT.ps1: sin dialogos y sin repintar; se restaura en finally.
        $previousSilent = [bool]$inventor.SilentOperation
        $inventor.SilentOperation = $true
        $previousScreen = [bool]$inventor.ScreenUpdating
        $inventor.ScreenUpdating = $false

        Write-Log '  Activando el traductor de STEP...' 'Cyan'
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
        if ($q.ContainsKey('port')) { $script:Port = [int]$q['port'] }
        if ($q.ContainsKey('token')) { $script:Token = [string]$q['token'] }
    }

    # Inventor exige un hilo STA y Windows PowerShell 5.1 (como Exportar-IPT.ps1).
    if (-not $ResolveOnly -and -not $env:CHUSY_CONVERT_STEP_NOSTA) {   # (CHUSY_CONVERT_STEP_NOSTA: solo para las pruebas)
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
            if ($script:Port -gt 0) { $forward += @('-Port', [string]$script:Port) }
            if ($script:Token) { $forward += @('-Token', $script:Token) }
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
        $isAdmin = $false
        try { $isAdmin = ([System.Security.Principal.WindowsPrincipal][System.Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator) } catch { }
        Write-Log ("Permisos: {0} | PowerShell {1}" -f $(if ($isAdmin) { 'administrador' } else { 'normal' }), $PSVersionTable.PSVersion) 'DarkGray'
        if ($script:Size -gt 0) { Write-Log "Tamano: $($script:Size) bytes" 'DarkGray' }

        # Canal con Chusy: abierto ya, para que la pagina vea el progreso desde el primer segundo.
        if ($script:Port -ge 1024 -and $script:Port -le 65535 -and $script:Token -match '^[A-Za-z0-9_-]{8,64}$' -and -not $ResolveOnly) {
            $server = Start-StepServer $script:Port $script:Token
            if ($server.State.ServerUp) { Write-Log "Canal con Chusy abierto (solo este PC, puerto $($script:Port))." 'DarkGray' }
            else { Write-Log "No se pudo abrir el canal con Chusy ($($server.State.ServerError)): el .stp se dejara junto al original." 'Yellow'; Stop-StepServer }
        }
        Set-StepState 'searching' 'Buscando el archivo en tu PC...'

        $source = Find-SourceFile -ExplicitPath $script:FilePath -Name $script:FileName -Root $script:SearchRoot -NoDialog:$ResolveOnly
        if ($ResolveOnly) {
            if ($source) { Write-Output "RESOLVED: $source" } else { Write-Output 'NOTFOUND' }
            return
        }
        if (-not $source) {
            Set-StepState 'error' 'No se ha elegido ningun archivo.'
            Write-Log 'Cancelado: no se ha elegido ningun archivo.' 'Yellow'
            Start-Sleep -Seconds 4
            return
        }
        Save-Memory $source

        Set-StepState 'converting' 'Convirtiendo con Inventor...'
        $target = Convert-ToStep $source
        Write-Log "Creado: $target" 'Green'
        Set-StepState 'done' 'Listo.' $target
        if ($script:StepServer -and (Wait-StepServed 25)) {
            Write-Log 'Entregado a Chusy: se sube a la tarea.' 'Green'
        }
        else {
            Start-Process -FilePath 'explorer.exe' -ArgumentList ('/select,"' + $target + '"')
        }
        Start-Sleep -Seconds 2
    }
    catch {
        $exit = 1
        Set-StepState 'error' $_.Exception.Message
        Write-Log "ERROR: $($_.Exception.Message)" 'Red'
        if ($_.Exception.Message -match 'E_FAIL|0x8000|0x8007|COM') { Write-Log 'Con E_FAIL: Inventor y el navegador tienen que estar al mismo nivel de permisos (los dos normales, o los dos como administrador).' 'Yellow' }
        if ($script:LogFile) { Write-Host "Registro: $script:LogFile" -ForegroundColor DarkGray }
        if ($script:StepServer) { Start-Sleep -Seconds 6 }   # deja que Chusy lea el motivo
        if (-not $NoPause -and -not $ResolveOnly) { try { [void](Read-Host 'Pulsa Intro para cerrar') } catch { } }
    }
    finally { Stop-StepServer }
    exit $exit
}

# Las pruebas cargan las funciones sin ejecutar nada (CHUSY_CONVERT_STEP_NOMAIN=1 y dot-sourcing).
if (-not $env:CHUSY_CONVERT_STEP_NOMAIN) { Invoke-Main }
