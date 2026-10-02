# Chusy - Abrir ubicacion (ayudante de Windows, v60)
#
# Lo lanza Windows cuando el navegador abre un enlace "chusy-open:<ruta>"
# (el boton "Abrir Ubicacion" de Chusy). La ruta llega codificada, por ejemplo
#   chusy-open:C%3A%5CProyectos%5CCliente%20A
#
# Solo abre CARPETAS que existen en este ordenador. Si la ruta es un archivo,
# un programa, o no existe, no ejecuta nada y lo avisa.
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

try {
    if ([string]::IsNullOrWhiteSpace($Url)) { exit 0 }

    # chusy-open:C%3A%5CProyectos  ->  C:\Proyectos   (-replace no distingue mayusculas)
    $encoded = $Url -replace '^chusy-open:/{0,2}', ''
    $path = [System.Uri]::UnescapeDataString($encoded).Trim().Trim('"')

    # Sin barras al final (el Explorador se atraganta con "C:\carpeta\" entre
    # comillas), salvo la raiz de una unidad: "C:" -> "C:\"
    $path = $path.TrimEnd('/', '\')
    if ($path -match '^[A-Za-z]:$') { $path = $path + '\' }

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
