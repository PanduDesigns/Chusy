# Chusy - Convertir a STEP (ayudante de Windows, v90)
#
# Lo lanza Windows cuando el navegador abre un enlace "chusy-step://convert?file=...&searchRoot=..."
# (el boton "Convertir a .STEP en mi PC" de Chusy) o se ejecuta a mano:
#   .\convertir-step.ps1 -FilePath 'C:\Proyectos\26001\Eje_26001.ipt'
#   .\convertir-step.ps1 -FileName 'Eje_26001.ipt' -SearchRoot '\\NASMARTECH\...\26001 - Cliente'
#
# REGLA: convierte UN SOLO archivo .ipt o .iam, el que se indica, y NUNCA el resto de la carpeta.
#   - Con -FilePath (ruta completa) comprueba que existe y que es .ipt o .iam.
#   - Con -FileName + -SearchRoot busca UNICAMENTE ese nombre exacto dentro de la carpeta (y sus
#     subcarpetas, sin mirar las copias de seguridad "OldVersions" de Inventor). Si hay 0 o varios
#     archivos con ese nombre, no convierte nada y lo avisa (en el segundo caso, hay que indicar
#     la ruta completa).
#
# Que hace con Inventor (via COM):
#   1. Se conecta al Inventor que ya esta abierto; si no hay ninguno, abre uno propio sin ventana
#      y lo cierra al terminar.
#   2. Abre solo ese archivo (si el disenador ya lo tenia abierto, lo usa tal cual y lo deja abierto).
#   3. Exporta <MismoNombre>.step con el traductor STEP de Inventor, protocolo AP214, en la MISMA
#      carpeta donde esta el .ipt/.iam.
#   4. Si lo abrio este script, lo cierra SIN guardar cambios.
#   5. Abre el Explorador con el .step recien creado seleccionado, para adjuntarlo en Chusy.
#
# El texto de este archivo es ASCII a proposito: PowerShell 5 lee los .ps1 sin BOM en la pagina de
# codigos de Windows y rompe las tildes.
param([string]$Url, [string]$FilePath, [string]$FileName, [string]$SearchRoot)

$title = 'Chusy - Convertir a STEP'
$stepTranslatorId = '{90AF7F40-0C01-11D5-8E83-0010B541CD80}'
$kFileBrowseIOMechanism = 13059
$apProtocolAP214 = 3

function Show-Message([string]$text, [int]$icon = 48) {
    try {
        $null = (New-Object -ComObject WScript.Shell).Popup($text, 0, $title, $icon)
    } catch { }
}

function Test-InventorFile([string]$p) {
    $e = [System.IO.Path]::GetExtension($p).ToLowerInvariant()
    return ($e -eq '.ipt' -or $e -eq '.iam')
}

# NameValueMap.Value('clave') = valor; si el enlace COM de PowerShell no lo admite, por reflexion.
function Set-MapValue($map, [string]$key, $value) {
    try {
        $map.Value($key) = $value
    } catch {
        [void][System.__ComObject].InvokeMember('Value', [System.Reflection.BindingFlags]::SetProperty, $null, $map, @($key, $value))
    }
}

# Llamada a un metodo COM por reflexion: no depende de que PowerShell vea los miembros del traductor.
function Invoke-ComMethod($obj, [string]$name, [object[]]$arguments) {
    return [System.__ComObject].InvokeMember($name, [System.Reflection.BindingFlags]::InvokeMethod, $null, $obj, $arguments)
}

$inventor = $null
$createdInventor = $false
$document = $null
$openedByUs = $false

try {
    # ---- 1. Que archivo hay que convertir ---------------------------------------------------
    if (-not [string]::IsNullOrWhiteSpace($Url)) {
        # chusy-step://convert?file=C%3A%5C...%5CEje.ipt&searchRoot=...  (el navegador puede anadir una "/" tras "convert")
        $rest = $Url -replace '^chusy-step:/{0,2}', ''
        $queryStart = $rest.IndexOf('?')
        if ($queryStart -ge 0) {
            foreach ($pair in $rest.Substring($queryStart + 1).Split('&')) {
                $eq = $pair.IndexOf('=')
                if ($eq -lt 1) { continue }
                $key = $pair.Substring(0, $eq).ToLowerInvariant()
                $value = [System.Uri]::UnescapeDataString($pair.Substring($eq + 1)).Trim().Trim('"')
                if ($key -eq 'file') {
                    # Una ruta completa (C:\... o \\servidor\...) es -FilePath; un nombre suelto, -FileName.
                    if ($value -match '^[A-Za-z]:[\\/]' -or $value -match '^\\\\') { $FilePath = $value } else { $FileName = $value }
                } elseif ($key -eq 'searchroot') {
                    $SearchRoot = $value
                }
            }
        }
    }

    $source = $null
    if (-not [string]::IsNullOrWhiteSpace($FilePath)) {
        $FilePath = $FilePath.Trim().Trim('"')
        if (-not (Test-InventorFile $FilePath)) {
            Show-Message ('Solo se pueden convertir archivos .ipt o .iam de Inventor.' + "`n`n" + $FilePath)
            exit 1
        }
        if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
            Show-Message ('No encuentro el archivo:' + "`n`n" + $FilePath)
            exit 1
        }
        $source = (Resolve-Path -LiteralPath $FilePath).ProviderPath
    }
    elseif (-not [string]::IsNullOrWhiteSpace($FileName)) {
        # Solo el nombre, sin ninguna ruta delante.
        $name = [System.IO.Path]::GetFileName($FileName.Trim().Trim('"'))
        if (-not (Test-InventorFile $name)) {
            Show-Message ('Solo se pueden convertir archivos .ipt o .iam de Inventor.' + "`n`n" + $name)
            exit 1
        }
        $root = if ($null -ne $SearchRoot) { $SearchRoot.Trim().Trim('"') } else { '' }
        if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path -LiteralPath $root -PathType Container)) {
            Show-Message ('No encuentro la carpeta del proyecto donde buscar ' + $name + '.' + "`n`n" + 'Escribe en Chusy la ruta completa del archivo o la carpeta del proyecto (campo Ubicacion).')
            exit 1
        }
        # Busca UNICAMENTE ese nombre exacto (sin comodines, sin copias OldVersions de Inventor).
        $found = @(Get-ChildItem -LiteralPath $root -Recurse -File -Filter $name -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -ieq $name -and $_.FullName -notmatch '[\\/]OldVersions[\\/]' })
        if ($found.Count -eq 0) {
            Show-Message ('No he encontrado ' + $name + ' dentro de:' + "`n`n" + $root + "`n`n" + 'Indica en Chusy la ruta completa del archivo.')
            exit 1
        }
        if ($found.Count -gt 1) {
            $list = ($found | Select-Object -First 5 | ForEach-Object { $_.FullName }) -join "`n"
            Show-Message ('Hay ' + $found.Count + ' archivos llamados ' + $name + ' en esa carpeta, y no convierto ninguno por si acaso:' + "`n`n" + $list + "`n`n" + 'Indica en Chusy la ruta completa del que quieres.')
            exit 1
        }
        $source = $found[0].FullName
    }
    else {
        Show-Message 'Falta indicar el archivo .ipt o .iam que hay que convertir.'
        exit 1
    }

    $stepPath = Join-Path -Path (Split-Path -Path $source -Parent) -ChildPath ([System.IO.Path]::GetFileNameWithoutExtension($source) + '.step')

    # ---- 2. Inventor: el que esta abierto o uno propio ---------------------------------------
    try {
        $inventor = [System.Runtime.InteropServices.Marshal]::GetActiveObject('Inventor.Application')
    } catch {
        $inventor = $null
    }
    if ($null -eq $inventor) {
        $inventor = New-Object -ComObject 'Inventor.Application'
        $createdInventor = $true
        $inventor.SilentOperation = $true
    }

    # ---- 3. El archivo: el que ya esta abierto, o abrirlo solo para esto ---------------------
    foreach ($openDoc in $inventor.Documents) {
        if ($openDoc.FullFileName -ieq $source) { $document = $openDoc; break }
    }
    if ($null -eq $document) {
        $document = $inventor.Documents.Open($source, $false)
        $openedByUs = $true
    }

    # ---- 4. Exportar ESE archivo a STEP AP214, en su misma carpeta ---------------------------
    $translator = $inventor.ApplicationAddIns.ItemById($stepTranslatorId)
    if ($null -eq $translator) { throw 'Este Inventor no tiene el traductor de STEP.' }
    $translator.Activate()
    $context = $inventor.TransientObjects.CreateTranslationContext()
    $context.Type = $kFileBrowseIOMechanism
    $options = $inventor.TransientObjects.CreateNameValueMap()
    $medium = $inventor.TransientObjects.CreateDataMedium()
    $medium.FileName = $stepPath
    if (Invoke-ComMethod $translator 'HasSaveCopyAsOptions' @($document, $context, $options)) {
        Set-MapValue $options 'ApplicationProtocolType' $apProtocolAP214
    }
    [void](Invoke-ComMethod $translator 'SaveCopyAs' @($document, $context, $options, $medium))

    if (-not (Test-Path -LiteralPath $stepPath -PathType Leaf)) { throw 'Inventor no ha generado el archivo .step.' }

    # ---- 5. Ensenar el resultado ---------------------------------------------------------------
    Start-Process -FilePath 'explorer.exe' -ArgumentList ('/select,"' + $stepPath + '"')
}
catch {
    Show-Message ('No se ha podido convertir a STEP:' + "`n`n" + $_.Exception.Message + "`n`n" + 'Si dice E_FAIL: Inventor y el navegador tienen que estar al mismo nivel de permisos (los dos normales, o los dos como administrador).') 16
    exit 1
}
finally {
    # Lo abrio este script -> se cierra SIN guardar cambios. Si ya estaba abierto por el disenador, se deja intacto.
    if ($openedByUs -and $null -ne $document) {
        try { $document.Close($true) } catch { }
    }
    if ($createdInventor -and $null -ne $inventor) {
        try { $inventor.Quit() } catch { }
    }
    if ($null -ne $inventor) {
        try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($inventor) } catch { }
    }
}
