# Chusy - Abrir ubicacion (ayudante de Windows, v60; v81: ofrece crear la carpeta)
#
# Lo lanza Windows cuando el navegador abre un enlace "chusy-open:<ruta>"
# (el boton "Abrir Ubicacion" de Chusy). La ruta llega codificada, por ejemplo
#   chusy-open:C%3A%5CProyectos%5CCliente%20A
#
# Solo abre CARPETAS que existen en este ordenador. Si la ruta es un archivo,
# un programa, o no existe, no ejecuta nada y lo avisa.
#
# v81: UNICA excepcion. Si la carpeta de DESTINO no existe todavia pero su carpeta
# PADRE si, y el nombre es de la forma "YYXXX - Nombre" (el ID de Chusy: AAXXX, 5 cifras o mas,
# guion, nombre), pregunta con un Si/No: "La carpeta ... no existe todavia.
# Deseas crearla ahora y abrirla?". Solo con un "Si" la crea (una sola carpeta, con
# New-Item) y la abre. Cualquier otro caso (padre inexistente, nombre sin ID, "No")
# se comporta exactamente como antes. Las instalaciones antiguas siguen
# funcionando sin cambios: este archivo solo se copia al reinstalar el .bat.
#
# El texto de este archivo es ASCII a proposito: PowerShell 5 lee los .ps1 sin
# BOM en la pagina de codigos de Windows y rompe las tildes.
param([string]$Url)

$title = 'Chusy - Abrir ubicacion'

function Show-Message([string]$text) {
    try {
        $null = (New-Object -ComObject WScript.Shell).Popup($text, 0, $title, 48)
    } catch { }
}

# v81: Si/No (por defecto "No"), encima de las demas ventanas. Devuelve $true solo con "Si".
# Los acentos van como [char] para que este archivo siga siendo ASCII.
function Confirm-Create([string]$folder) {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $owner = New-Object System.Windows.Forms.Form
        $owner.TopMost = $true
        $text = 'La carpeta' + "`n`n" + $folder + "`n`n" + 'no existe todav' + [char]0x00ED + 'a. ' + [char]0x00BF + 'Deseas crearla ahora y abrirla?'
        $answer = [System.Windows.Forms.MessageBox]::Show($owner, $text, $title, [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question, [System.Windows.Forms.MessageBoxDefaultButton]::Button2)
        $owner.Dispose()
        return ($answer -eq [System.Windows.Forms.DialogResult]::Yes)
    } catch {
        return $false
    }
}

try {
    if ([string]::IsNullOrWhiteSpace($Url)) { exit 0 }

    # chusy-open:C%3A%5CProyectos  ->  C:\Proyectos   (-replace no distingue mayusculas)
    $encoded = $Url -replace '^chusy-open:/{0,2}', ''
    $path = [System.Uri]::UnescapeDataString($encoded).Trim().Trim('"')

    # Sin barras al final (el Explorador se atraganta con "C:\carpeta\" entre
    # comillas), salvo la raiz de una unidad: "C:" -> "C:\"
    $path = $path.TrimEnd('/', '\')
    if ($path -match '^[A-Za-z]:$') { $path = $path + '\' }

    # v81: carpeta "YYXXX - Nombre" que aun no existe, con la carpeta padre ya creada -> ofrecer crearla.
    if (-not [string]::IsNullOrWhiteSpace($path) -and -not (Test-Path -LiteralPath $path)) {
        $leaf = Split-Path -Path $path -Leaf
        $parent = Split-Path -Path $path -Parent
        if ($leaf -match '^\d{5,}\s*-\s*\S' -and -not [string]::IsNullOrWhiteSpace($parent) -and (Test-Path -LiteralPath $parent -PathType Container)) {
            if (Confirm-Create $path) {
                $null = New-Item -ItemType Directory -Path $path
            }
        }
    }

    if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path -LiteralPath $path -PathType Container)) {
        Show-Message ("No se encuentra la carpeta (o no es una carpeta):`n`n" + $path + "`n`nComprueba que tienes acceso a ella (red, unidad de red, VPN).")
        exit 1
    }

    Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $path + '"')
}
catch {
    Show-Message ("No se ha podido abrir la carpeta:`n`n" + $_.Exception.Message)
    exit 1
}
