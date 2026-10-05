Attribute VB_Name = "CrearCarpetaProyecto"
Option Explicit

' Macro para Outlook: crea la carpeta del proyecto del correo abierto.
' Esta versión es autocontenida: solo hay que importar este archivo.
'
' v61: al terminar, si Chusy está abierto con la sesión iniciada, también crea
' la oferta en Chusy (nombre del proyecto, ubicación = la carpeta creada,
' comercial = su carpeta, descripción = el texto del correo). Ver el bloque
' CONEXIÓN CON CHUSY de más abajo y el apartado «Oferta desde Outlook» del
' README de Chusy. Sin CHUSY_CLAVE rellena, la macro funciona como siempre.

Private Const PR_SMTP_ADDRESS As String = "http://schemas.microsoft.com/mapi/proptag/0x39FE001E"
Private Const PR_ATTACH_CONTENT_ID As String = "http://schemas.microsoft.com/mapi/proptag/0x3712001E"
Private Const PR_ATTACH_MIME_TAG As String = "http://schemas.microsoft.com/mapi/proptag/0x370E001E"
Private Const PR_ATTACH_FLAGS As String = "http://schemas.microsoft.com/mapi/proptag/0x37140003"
Private Const RUTA_WINRAR As String = "C:\Program Files\WinRAR\WinRAR.exe"

' ===================== CONEXIÓN CON CHUSY (v61) =====================
' Las tres primeras líneas las muestra Chusy en menú de usuario > «Conexión
' con Outlook» (solo administradores), listas para copiar y pegar aquí. La
' clave es la misma para todo el equipo; si está vacía, la macro no avisa a Chusy.
Private Const CHUSY_PROJECT_ID As String = "asano-martech"
Private Const CHUSY_API_KEY As String = "AIzaSyBSdhAgb2RhZ1z3dFr7nzvtin_HgkAMRDc"
Private Const CHUSY_CLAVE As String = ""
' Opcional: el correo con el que inicias sesión en Chusy, si no es el de tu
' cuenta de Outlook (normalmente se detecta solo).
Private Const CHUSY_CORREO As String = ""
' Cuántos segundos espera la macro a que Chusy responda antes de darlo por cerrado.
Private Const CHUSY_ESPERA_SEGUNDOS As Long = 10
' Tope de caracteres del correo que se copian a la descripción de la oferta.
Private Const CHUSY_MAX_DESCRIPCION As Long = 30000

' Se recuerda si Google exigió la clave de API (casi nunca): evita repetir cada petición dos veces.
Private mUsarClaveApi As Boolean

#If VBA7 Then
    Private Declare PtrSafe Sub Sleep Lib "kernel32" (ByVal dwMilliseconds As Long)
#Else
    Private Declare Sub Sleep Lib "kernel32" (ByVal dwMilliseconds As Long)
#End If

Public Sub CrearCarpetaDelProyecto()
    Dim correo As Outlook.MailItem
    Dim proyecto As String
    Dim comerciales As Collection
    Dim coincidencias As Collection
    Dim posicion As Long
    Dim comercial As Variant
    Dim rutaDestino As String
    Dim anio As String
    Dim avisoChusy As String

    Set correo = CorreoActivo()
    If correo Is Nothing Then
        MsgBox "Abre un correo electrónico (o selecciónalo en Outlook) antes de ejecutar la macro.", vbExclamation, "Crear carpeta de proyecto"
        Exit Sub
    End If

    proyecto = Trim$(InputBox("Nombre del proyecto:", "Crear carpeta de proyecto"))
    If Len(proyecto) = 0 Then Exit Sub

    If Not EsNombreDeCarpetaValido(proyecto) Then
        MsgBox "El nombre del proyecto no puede contener \ / : * ? "" < > | ni terminar en punto o espacio.", vbExclamation, "Nombre no válido"
        Exit Sub
    End If

    Set comerciales = TablaComerciales()
    Set coincidencias = ComercialesDelCorreo(correo, comerciales)

    If coincidencias.Count = 0 Then
        MsgBox "No se ha encontrado ningún comercial de la tabla en el remitente, Para o CC del correo.", vbExclamation, "Comercial no identificado"
        Exit Sub
    End If

    If coincidencias.Count = 1 Then
        posicion = 1
    Else
        posicion = ElegirComercial(coincidencias)
        If posicion = 0 Then Exit Sub
    End If

    comercial = coincidencias(posicion)
    anio = CStr(Year(Date))
    rutaDestino = RutaAntesDePlanos() & "\PLANOS " & anio & "\" & CStr(comercial(2))
    If Len(CStr(comercial(3))) > 0 Then rutaDestino = rutaDestino & "\" & CStr(comercial(3))
    rutaDestino = rutaDestino & "\" & proyecto

    If Not ExisteCarpeta(RutaAntesDePlanos() & "\PLANOS " & anio) Then
        MsgBox "No se encuentra la carpeta base del año:" & vbCrLf & RutaAntesDePlanos() & "\PLANOS " & anio, vbCritical, "Ruta no disponible"
        Exit Sub
    End If

    If ExisteCarpeta(rutaDestino) Then
        MsgBox "La carpeta ya existe:" & vbCrLf & rutaDestino, vbInformation, "Carpeta existente"
        Exit Sub
    End If

    On Error GoTo ErrorAlCrear
    MkDir rutaDestino
    On Error GoTo ErrorPlantillas
    CopiarYExtraerPlantillas rutaDestino
    On Error GoTo ErrorGuardarCorreo
    GuardarCorreoYAdjuntos correo, rutaDestino
    ' v61: solo si todo lo anterior salió bien. AvisarAChusy no lanza errores:
    ' devuelve el texto (o vacío, si la conexión no está configurada) que se
    ' añade al mensaje final.
    avisoChusy = AvisarAChusy(correo, proyecto, rutaDestino, NombreComercialParaChusy(comercial))
    MsgBox "Carpeta creada, plantillas extraídas y correo archivado correctamente:" & vbCrLf & rutaDestino & avisoChusy, vbInformation, "Proyecto creado"
    Exit Sub

ErrorAlCrear:
    MsgBox "No se pudo crear la carpeta." & vbCrLf & vbCrLf & rutaDestino & vbCrLf & vbCrLf & "Detalle: " & Err.Description, vbCritical, "Error al crear"
    Exit Sub

ErrorPlantillas:
    MsgBox "La carpeta del proyecto se ha creado, pero no se han podido preparar las plantillas." & vbCrLf & vbCrLf & rutaDestino & vbCrLf & vbCrLf & "Detalle: " & Err.Description, vbCritical, "Error al extraer plantillas"
    Exit Sub

ErrorGuardarCorreo:
    MsgBox "La carpeta y las plantillas se han creado, pero no se ha podido archivar el correo o todos sus adjuntos." & vbCrLf & vbCrLf & rutaDestino & vbCrLf & vbCrLf & "Detalle: " & Err.Description, vbCritical, "Error al archivar correo"
End Sub

Private Function RutaAntesDePlanos() As String
    ' ChrW$(209) siempre genera la Ñ mayúscula, aunque el archivo se importe
    ' con una codificación distinta en el editor de VBA.
    RutaAntesDePlanos = "\\192.168.80.144\Spanesi\OFICINA TECNICA\DISE" & ChrW$(209) & "O TECNICO"
End Function

Private Function RutaZipPlantillas() As String
    RutaZipPlantillas = RutaAntesDePlanos() & "\PLANTILLAS\CARPETAS PROYECTO.zip"
End Function

Private Sub CopiarYExtraerPlantillas(ByVal destino As String)
    Dim zipOrigen As String
    Dim zipDestino As String
    Dim comando As String
    Dim shellWindows As Object
    Dim proceso As Object

    zipOrigen = RutaZipPlantillas()
    zipDestino = destino & "\CARPETAS PROYECTO.zip"

    If Not ExisteArchivo(zipOrigen) Then
        Err.Raise vbObjectError + 1000, "Plantillas", "No se encontró el ZIP de plantillas: " & zipOrigen
    End If
    If Not ExisteArchivo(RUTA_WINRAR) Then
        Err.Raise vbObjectError + 1001, "Plantillas", "No se encontró WinRAR en: " & RUTA_WINRAR
    End If

    ' Equivale a Copy-Item -Force del script de PowerShell.
    If ExisteArchivo(zipDestino) Then Kill zipDestino
    FileCopy zipOrigen, zipDestino

    ' Equivale a: WinRAR x -ibck -y $zipDestino $destino
    ' No se añade una barra final: evita que la comilla final se interprete
    ' como parte de la ruta cuando Windows procesa la línea de comandos.
    comando = EntreComillas(RUTA_WINRAR) & " x -ibck -y " & EntreComillas(zipDestino) & " " & EntreComillas(destino)
    Set shellWindows = CreateObject("WScript.Shell")
    Set proceso = shellWindows.Exec(comando)

    Do While proceso.Status = 0
        DoEvents
    Loop

    If proceso.ExitCode <> 0 Then
        Err.Raise vbObjectError + 1002, "Plantillas", "WinRAR terminó con el código " & proceso.ExitCode & ". El ZIP se ha conservado en la carpeta del proyecto para revisarlo."
    End If

    Kill zipDestino
End Sub

Private Function EntreComillas(ByVal texto As String) As String
    EntreComillas = Chr$(34) & texto & Chr$(34)
End Function

Private Sub GuardarCorreoYAdjuntos(ByVal correo As Outlook.MailItem, ByVal carpetaProyecto As String)
    Dim carpetaDocumentos As String
    Dim adjunto As Outlook.Attachment
    Dim nombreAdjunto As String
    Dim asunto As String
    Dim i As Long

    carpetaDocumentos = carpetaProyecto & "\00 LAY OUT\VERSION A1\00 DOCUMENTOS PREVIOS"
    If Not ExisteCarpeta(carpetaDocumentos) Then
        Err.Raise vbObjectError + 1003, "Archivo de correo", "No se encontró la carpeta de destino: " & carpetaDocumentos
    End If

    asunto = NombreArchivoSeguro(correo.Subject)
    If Len(asunto) = 0 Then asunto = "Correo sin asunto"
    correo.SaveAs RutaArchivoDisponible(carpetaDocumentos, "Correo - " & asunto & ".msg"), olMSGUnicode

    For i = 1 To correo.Attachments.Count
        Set adjunto = correo.Attachments.Item(i)
        If Not EsImagenIncrustada(adjunto) Then
            nombreAdjunto = NombreArchivoSeguro(adjunto.FileName)
            If Len(nombreAdjunto) = 0 Then nombreAdjunto = "Adjunto " & Format$(i, "00")
            adjunto.SaveAsFile RutaArchivoDisponible(carpetaDocumentos, nombreAdjunto)
        End If
    Next i
End Sub

Private Function EsImagenIncrustada(ByVal adjunto As Outlook.Attachment) As Boolean
    Dim identificadorContenido As String
    Dim tipoMime As String
    Dim indicadoresAdjunto As Long

    ' Las imágenes en HTML suelen tener Content-ID y tipo MIME image/*.
    ' El indicador 4 también identifica los archivos referenciados en el cuerpo.
    On Error Resume Next
    identificadorContenido = CStr(adjunto.PropertyAccessor.GetProperty(PR_ATTACH_CONTENT_ID))
    tipoMime = LCase$(CStr(adjunto.PropertyAccessor.GetProperty(PR_ATTACH_MIME_TAG)))
    indicadoresAdjunto = CLng(adjunto.PropertyAccessor.GetProperty(PR_ATTACH_FLAGS))
    On Error GoTo 0

    If Left$(tipoMime, 6) = "image/" Then
        EsImagenIncrustada = (Len(identificadorContenido) > 0 Or (indicadoresAdjunto And 4) <> 0)
    End If
End Function

Private Function NombreArchivoSeguro(ByVal nombre As String) As String
    Dim caracteresNoValidos As Variant
    Dim caracter As Variant

    caracteresNoValidos = Array("\", "/", ":", "*", "?", Chr$(34), "<", ">", "|")
    For Each caracter In caracteresNoValidos
        nombre = Replace$(nombre, CStr(caracter), "_")
    Next caracter

    nombre = Trim$(nombre)
    Do While Len(nombre) > 0 And (Right$(nombre, 1) = "." Or Right$(nombre, 1) = " ")
        nombre = Left$(nombre, Len(nombre) - 1)
    Loop

    NombreArchivoSeguro = nombre
End Function

Private Function RutaArchivoDisponible(ByVal carpeta As String, ByVal nombrePreferido As String) As String
    Dim posicionPunto As Long
    Dim nombreSinExtension As String
    Dim extension As String
    Dim candidato As String
    Dim contador As Long

    posicionPunto = InStrRev(nombrePreferido, ".")
    If posicionPunto > 1 Then
        nombreSinExtension = Left$(nombrePreferido, posicionPunto - 1)
        extension = Mid$(nombrePreferido, posicionPunto)
    Else
        nombreSinExtension = nombrePreferido
        extension = ""
    End If

    candidato = carpeta & "\" & nombrePreferido
    contador = 1
    Do While ExisteArchivo(candidato)
        candidato = carpeta & "\" & nombreSinExtension & " (" & contador & ")" & extension
        contador = contador + 1
    Loop

    RutaArchivoDisponible = candidato
End Function

Private Function CorreoActivo() As Outlook.MailItem
    Dim elemento As Object

    On Error Resume Next
    Set elemento = Application.ActiveInspector.CurrentItem
    On Error GoTo 0

    If elemento Is Nothing Then
        On Error Resume Next
        If Application.ActiveExplorer.Selection.Count > 0 Then
            Set elemento = Application.ActiveExplorer.Selection.Item(1)
        End If
        On Error GoTo 0
    End If

    If Not elemento Is Nothing Then
        If TypeOf elemento Is Outlook.MailItem Then Set CorreoActivo = elemento
    End If
End Function

Private Function TablaComerciales() As Collection
    Dim tabla As New Collection

    ' Cada registro contiene: nombre, correo, carpeta y subcarpeta.
    tabla.Add Array("Armando Moreno", "armando.moreno@martechcorporation.com", "ARMANDO", "")
    tabla.Add Array("César Sierra", "cesar.sierra@martechcorporation.com", "CESAR SIERRA", "")
    tabla.Add Array("Daniel Gallego", "daniel.gallego@martechcorporation.com", "DANI GALLEGO", "")
    tabla.Add Array("Gabriel Villaverde", "gabriel.villaverde@martechcorporation.com", "GABI", "")
    tabla.Add Array("Jacinto Rey", "rey@martechcar.com", "MARTECH CAR NOROESTE", "")
    tabla.Add Array("Jaime Masalleras", "jmasalleras@aco.cl", "INTERNACIONAL", "ACO")
    tabla.Add Array("Javier Moreno", "javiermoreno@spanesimadrid.es", "MARTECH CAR MADRID", "")
    tabla.Add Array("Joaquín Lobato", "joaquin.lobato@martechcorporation.com", "JOAQUIN LOBATO", "")
    tabla.Add Array("Jon Franco", "jon.franco@martechcorporation.com", "JON FRANCO", "")
    tabla.Add Array("José Antonio García Alcaraz", "info@alcarazservicios.com", "ALCARAZ SERVICIOS", "")
    tabla.Add Array("Jose Luis Martín", "joseluis.martin@martechcorporation.com", "JOSE LUIS MARTIN", "")
    tabla.Add Array("Jose Manuel Ortega", "josemanuel@martechcar.com", "INTERNACIONAL", "MEXICO")
    tabla.Add Array("Jose María Sánchez", "josemaria.sb@martechcorporation.com", "JOSE MARIA SANCHEZ", "")
    tabla.Add Array("Jose Ramon Martínez", "jose.martinez@martechcorporation.com", "JOSE RAMON", "")
    tabla.Add Array("Juan Martínez", "juan.martinez@martechcorporation.com", "JUAN MARTINEZ", "")
    tabla.Add Array("Luis Meñaca", "luis.menaca@martechcorporation.com", "INTERNACIONAL", "LUIS MENACA")
    tabla.Add Array("Luis Sepulveda", "luis.sepulveda@martechcorporation.com", "LUIS SEPULVEDA", "")
    tabla.Add Array("Manuel Rus", "manuelrus@spanesi.es", "MANUEL RUS", "")
    tabla.Add Array("Miguel Angel", "miguelangel.fernandez@martechcorporation.com", "MIGUEL ANGEL", "")
    tabla.Add Array("Miguel Villalba", "miguel@spanesilevante.es", "SPANESI LEVANTE", "")
    tabla.Add Array("Nicola Lazzarini", "nicola.lazzarini@martechcorporation.com", "NICOLA", "")
    tabla.Add Array("Pedro Canto", "pedrocanto@spanesi.es", "PEDRO CANTO", "")
    tabla.Add Array("Pedro Torres", "pedro@spanesilevante.es", "SPANESI LEVANTE", "")
    tabla.Add Array("Philippe", "philippe.ferrol@martechcorporation.com", "PHILIPPE", "")
    tabla.Add Array("Rafael Moreno", "rafaelmoreno@spanesimadrid.es", "MARTECH CAR MADRID", "")
    tabla.Add Array("Rubén Escobar", "ruben.escobar@martechcorporation.com", "RUBEN ESCOBAR", "")
    tabla.Add Array("Sapraxell", "", "SAPRAXELL", "")

    Set TablaComerciales = tabla
End Function

Private Function ComercialesDelCorreo(ByVal correo As Outlook.MailItem, ByVal tabla As Collection) As Collection
    Dim direcciones As Object
    Dim encontrados As New Collection
    Dim registro As Variant
    Set direcciones = DireccionesDelCorreo(correo)

    For Each registro In tabla
        If Len(CStr(registro(1))) > 0 Then
            If direcciones.Exists(LCase$(CStr(registro(1)))) Then encontrados.Add registro
        ElseIf NombreComercialApareceEnCorreo(correo, CStr(registro(0))) Then
            ' Sapraxell no tiene correo en la tabla; se compara su nombre visible.
            encontrados.Add registro
        End If
    Next registro

    Set ComercialesDelCorreo = encontrados
End Function

Private Function DireccionesDelCorreo(ByVal correo As Outlook.MailItem) As Object
    Dim resultado As Object
    Dim destinatario As Outlook.Recipient
    Dim direccion As String

    Set resultado = CreateObject("Scripting.Dictionary")
    resultado.CompareMode = 1 ' TextCompare

    direccion = DireccionSMTPDelRemitente(correo)
    AgregarDireccion resultado, direccion

    For Each destinatario In correo.Recipients
        AgregarDireccion resultado, DireccionSMTPDelDestinatario(destinatario)
    Next destinatario

    Set DireccionesDelCorreo = resultado
End Function

Private Function NombreComercialApareceEnCorreo(ByVal correo As Outlook.MailItem, ByVal nombre As String) As Boolean
    Dim destinatario As Outlook.Recipient
    Dim nombreNormalizado As String

    nombreNormalizado = LCase$(Trim$(nombre))
    If InStr(1, LCase$(correo.SenderName), nombreNormalizado, vbTextCompare) > 0 Then
        NombreComercialApareceEnCorreo = True
        Exit Function
    End If

    For Each destinatario In correo.Recipients
        If InStr(1, LCase$(destinatario.Name), nombreNormalizado, vbTextCompare) > 0 Then
            NombreComercialApareceEnCorreo = True
            Exit Function
        End If
    Next destinatario
End Function

Private Sub AgregarDireccion(ByVal direcciones As Object, ByVal direccion As String)
    direccion = LCase$(Trim$(direccion))
    If Len(direccion) > 0 Then
        If Not direcciones.Exists(direccion) Then direcciones.Add direccion, True
    End If
End Sub

Private Function DireccionSMTPDelRemitente(ByVal correo As Outlook.MailItem) As String
    On Error Resume Next
    DireccionSMTPDelRemitente = correo.PropertyAccessor.GetProperty(PR_SMTP_ADDRESS)
    If Len(DireccionSMTPDelRemitente) = 0 Then DireccionSMTPDelRemitente = correo.SenderEmailAddress
    If InStr(1, DireccionSMTPDelRemitente, "@") = 0 And Not correo.Sender Is Nothing Then
        DireccionSMTPDelRemitente = DireccionSMTPDeAddressEntry(correo.Sender)
    End If
    On Error GoTo 0
End Function

Private Function DireccionSMTPDelDestinatario(ByVal destinatario As Outlook.Recipient) As String
    On Error Resume Next
    DireccionSMTPDelDestinatario = destinatario.PropertyAccessor.GetProperty(PR_SMTP_ADDRESS)
    If Len(DireccionSMTPDelDestinatario) = 0 Then DireccionSMTPDelDestinatario = destinatario.Address
    If InStr(1, DireccionSMTPDelDestinatario, "@") = 0 Then
        DireccionSMTPDelDestinatario = DireccionSMTPDeAddressEntry(destinatario.AddressEntry)
    End If
    On Error GoTo 0
End Function

Private Function DireccionSMTPDeAddressEntry(ByVal entrada As Outlook.AddressEntry) As String
    Dim usuarioExchange As Outlook.ExchangeUser
    Dim listaExchange As Outlook.ExchangeDistributionList

    On Error Resume Next
    DireccionSMTPDeAddressEntry = entrada.PropertyAccessor.GetProperty(PR_SMTP_ADDRESS)
    If Len(DireccionSMTPDeAddressEntry) = 0 Then
        Set usuarioExchange = entrada.GetExchangeUser
        If Not usuarioExchange Is Nothing Then DireccionSMTPDeAddressEntry = usuarioExchange.PrimarySmtpAddress
    End If
    If Len(DireccionSMTPDeAddressEntry) = 0 Then
        Set listaExchange = entrada.GetExchangeDistributionList
        If Not listaExchange Is Nothing Then DireccionSMTPDeAddressEntry = listaExchange.PrimarySmtpAddress
    End If
    On Error GoTo 0
End Function

Private Function ElegirComercial(ByVal coincidencias As Collection) As Long
    Dim mensaje As String
    Dim registro As Variant
    Dim respuesta As String
    Dim numero As Long
    Dim i As Long

    mensaje = "Se han encontrado varios comerciales en el correo:" & vbCrLf & vbCrLf
    For i = 1 To coincidencias.Count
        registro = coincidencias(i)
        mensaje = mensaje & i & ". " & CStr(registro(0)) & " (" & CStr(registro(1)) & ")" & vbCrLf
    Next i
    mensaje = mensaje & vbCrLf & "Escribe el número del comercial correcto (o Cancela para salir):"

    Do
        respuesta = Trim$(InputBox(mensaje, "Seleccionar comercial"))
        If Len(respuesta) = 0 Then Exit Function

        If IsNumeric(respuesta) Then
            numero = CLng(respuesta)
            If numero >= 1 And numero <= coincidencias.Count Then
                ElegirComercial = numero
                Exit Function
            End If
        End If

        MsgBox "Escribe un número válido de la lista.", vbExclamation, "Seleccionar comercial"
    Loop
End Function

Private Function EsNombreDeCarpetaValido(ByVal nombre As String) As Boolean
    Const CARACTERES_NO_VALIDOS As String = "\/:*?""<>|"

    If InStr(nombre, "..") > 0 Then Exit Function
    If Right$(nombre, 1) = "." Or Right$(nombre, 1) = " " Then Exit Function
    EsNombreDeCarpetaValido = (nombre Like "*[" & CARACTERES_NO_VALIDOS & "]*") = False
End Function

Private Function ExisteCarpeta(ByVal ruta As String) As Boolean
    On Error Resume Next
    ExisteCarpeta = (Len(Dir$(ruta, vbDirectory)) > 0)
    On Error GoTo 0
End Function

Private Function ExisteArchivo(ByVal ruta As String) As Boolean
    On Error Resume Next
    ExisteArchivo = (Len(Dir$(ruta, vbNormal)) > 0)
    On Error GoTo 0
End Function

' ===================================================================
' CONEXIÓN CON CHUSY (v61)
'
' Cómo funciona (el recorrido completo está en el README de Chusy):
'   1. La macro deja una petición en la colección offerInbox de Firestore por
'      REST, SIN iniciar sesión; las reglas de Firestore solo la aceptan con la
'      clave compartida (CHUSY_CLAVE).
'   2. La pestaña de Chusy abierta de ESA persona (el correo de su cuenta de
'      Outlook) la ve al instante, crea la oferta y anota el resultado.
'   3. La macro lee ese resultado durante unos segundos para contárselo a quien
'      la lanzó, y recoge la petición (lleva el texto del correo).
' Si Chusy no está abierto con la sesión iniciada nadie la atiende: la macro lo
' dice y retira la petición, y la oferta no se crea.
' ===================================================================

' Prueba de la conexión sin tocar ningún proyecto real: crea en Chusy una
' oferta de prueba (bórrala después a mano). Ejecútala desde Outlook con
' Chusy abierto y la sesión iniciada: Alt+F8 > ProbarConexionConChusy.
Public Sub ProbarConexionConChusy()
    Dim resultado As String
    Dim descripcion As String

    If Len(CHUSY_CLAVE) = 0 Then
        MsgBox "Falta rellenar CHUSY_CLAVE al principio de la macro (Chusy: menú de usuario > Conexión con Outlook).", vbExclamation, "Conexión con Chusy"
        Exit Sub
    End If

    descripcion = "Oferta de prueba creada desde Outlook." & vbCrLf & vbCrLf & _
        "Caracteres especiales: " & ChrW$(225) & ChrW$(233) & ChrW$(237) & ChrW$(243) & ChrW$(250) & " " & ChrW$(241) & ChrW$(209) & " " & ChrW$(8364) & " ""comillas"" \ / <b>no es negrita</b>" & vbCrLf & _
        "Segunda línea del mismo párrafo."
    resultado = AvisarAChusy(Nothing, "PRUEBA OUTLOOK " & Format$(Now, "hh:nn:ss"), RutaAntesDePlanos() & "\PLANOS " & CStr(Year(Date)) & "\PRUEBA", "PRUEBA", descripcion)
    MsgBox "Resultado de la prueba:" & resultado, vbInformation, "Conexión con Chusy"
End Sub

' El comercial tal como se escribe en Chusy: el nombre de la carpeta en la que
' se crea el proyecto — la subcarpeta si la hay (INTERNACIONAL > ACO, MEXICO,
' LUIS MENACA) y, si no, la carpeta del comercial (ARMANDO, GABI...).
Private Function NombreComercialParaChusy(ByVal comercial As Variant) As String
    If Len(CStr(comercial(3))) > 0 Then
        NombreComercialParaChusy = CStr(comercial(3))
    Else
        NombreComercialParaChusy = CStr(comercial(2))
    End If
End Function

' Avisa a Chusy de la oferta nueva y devuelve el texto que se añade al mensaje
' final de la macro (vacío si la conexión no está configurada). No lanza
' errores. `descripcionPrueba` solo lo usa ProbarConexionConChusy: en el uso
' normal la descripción es el texto del correo.
Private Function AvisarAChusy(ByVal correo As Outlook.MailItem, ByVal proyecto As String, ByVal rutaDestino As String, ByVal comercial As String, Optional ByVal descripcionPrueba As String = "") As String
    Dim destinatario As String
    Dim descripcion As String
    Dim urlColeccion As String
    Dim urlPeticion As String
    Dim idPeticion As String
    Dim cuerpoJson As String
    Dim estado As Long
    Dim respuesta As String
    Dim situacion As String
    Dim limite As Date
    Dim nombreFinal As String
    Dim nota As String

    If Len(CHUSY_CLAVE) = 0 Or Len(CHUSY_PROJECT_ID) = 0 Then Exit Function

    On Error GoTo Fallo

    destinatario = CorreoDelUsuario()
    If Len(destinatario) = 0 Then
        AvisarAChusy = MensajeChusy("no se ha podido saber el correo de tu cuenta de Outlook, así que no se ha creado la oferta. Escríbelo en CHUSY_CORREO, al principio de la macro.")
        Exit Function
    End If

    If Len(descripcionPrueba) > 0 Then
        descripcion = descripcionPrueba
    ElseIf Not correo Is Nothing Then
        descripcion = TextoDelCorreo(correo)
    End If

    cuerpoJson = "{""fields"":{" & _
        CampoTexto("key", CHUSY_CLAVE) & "," & _
        CampoTexto("targetEmail", destinatario) & "," & _
        CampoTexto("name", RecortarTexto(proyecto, 300)) & "," & _
        CampoTexto("location", rutaDestino) & "," & _
        CampoTexto("commercial", comercial) & "," & _
        CampoTexto("description", descripcion) & "," & _
        CampoTexto("status", "pending") & "}}"

    urlColeccion = "https://firestore.googleapis.com/v1/projects/" & CHUSY_PROJECT_ID & "/databases/(default)/documents/offerInbox"
    If Not PeticionFirestore("POST", urlColeccion, cuerpoJson, estado, respuesta) Then
        AvisarAChusy = MensajeChusy("no se pudo conectar (" & respuesta & "). La oferta no se ha creado en Chusy.")
        Exit Function
    End If
    If estado <> 200 Then
        AvisarAChusy = MensajeChusy(ExplicarErrorHttp(estado, respuesta))
        Exit Function
    End If

    idPeticion = IdDePeticion(respuesta)
    If Len(idPeticion) = 0 Then
        AvisarAChusy = MensajeChusy("respuesta inesperada del servidor. Comprueba en Chusy si se ha creado la oferta.")
        Exit Function
    End If
    urlPeticion = urlColeccion & "/" & idPeticion

    ' Espera a que la pestaña de Chusy la atienda (normalmente, un par de segundos).
    limite = DateAdd("s", CHUSY_ESPERA_SEGUNDOS, Now)
    Do
        Sleep 600
        DoEvents
        If PeticionFirestore("GET", urlPeticion, "", estado, respuesta) Then
            If estado = 200 Then
                situacion = CampoFirestore(respuesta, "status")
                If situacion = "created" Or situacion = "error" Then Exit Do
            End If
        End If
    Loop While Now < limite

    Select Case situacion
        Case "created"
            nombreFinal = CampoFirestore(respuesta, "finalName")
            nota = CampoFirestore(respuesta, "message")
            BorrarPeticion urlPeticion
            AvisarAChusy = MensajeChusy("oferta creada en Chusy: " & ChrW$(171) & nombreFinal & ChrW$(187) & "." & IIf(Len(nota) > 0, vbCrLf & nota, ""))
        Case "error"
            nota = CampoFirestore(respuesta, "message")
            BorrarPeticion urlPeticion
            AvisarAChusy = MensajeChusy("Chusy recibió la petición pero no pudo crear la oferta: " & nota)
        Case "processing"
            ' La está creando ahora mismo: no se retira (la borraría Chusy al terminar).
            AvisarAChusy = MensajeChusy("Chusy está creando la oferta pero tarda más de lo normal. Compruébala en Chusy dentro de un momento.")
        Case Else
            BorrarPeticion urlPeticion
            AvisarAChusy = MensajeChusy("no se ha creado la oferta porque Chusy no está abierto con la sesión iniciada de " & destinatario & ". Ábrelo, inicia sesión y créala a mano (la carpeta es la de arriba).")
    End Select
    Exit Function

Fallo:
    AvisarAChusy = MensajeChusy("no se pudo avisar a Chusy (" & Err.Description & "). La oferta no se ha creado en Chusy.")
End Function

Private Function MensajeChusy(ByVal texto As String) As String
    MensajeChusy = vbCrLf & vbCrLf & "Chusy: " & texto
End Function

Private Function ExplicarErrorHttp(ByVal estado As Long, ByVal respuesta As String) As String
    Dim detalle As String

    detalle = MensajeDeErrorJson(respuesta)
    If estado = 403 Then
        ExplicarErrorHttp = "Chusy rechazó la petición (permisos). Comprueba que las reglas de Firestore estén publicadas y que CHUSY_CLAVE sea la que muestra Chusy en Conexión con Outlook. La oferta no se ha creado."
    Else
        ExplicarErrorHttp = "error " & CStr(estado) & " al hablar con Chusy" & IIf(Len(detalle) > 0, " (" & detalle & ")", "") & ". La oferta no se ha creado."
    End If
End Function

' El correo de quien lanza la macro, en minúsculas: el que usa para entrar en Chusy.
Private Function CorreoDelUsuario() As String
    Dim direccion As String

    direccion = Trim$(CHUSY_CORREO)
    If Len(direccion) = 0 Then
        On Error Resume Next
        direccion = DireccionSMTPDeAddressEntry(Application.Session.CurrentUser.AddressEntry)
        If Len(direccion) = 0 Then direccion = Application.Session.Accounts.Item(1).SmtpAddress
        On Error GoTo 0
    End If
    CorreoDelUsuario = LCase$(Trim$(direccion))
End Function

' El texto del correo, recortado a CHUSY_MAX_DESCRIPCION caracteres.
Private Function TextoDelCorreo(ByVal correo As Outlook.MailItem) As String
    Dim texto As String

    On Error Resume Next
    texto = correo.Body
    On Error GoTo 0
    If Len(texto) > CHUSY_MAX_DESCRIPCION Then
        texto = RecortarTexto(texto, CHUSY_MAX_DESCRIPCION) & vbCrLf & vbCrLf & "[Texto recortado]"
    End If
    TextoDelCorreo = texto
End Function

' Los primeros `maximo` caracteres de un texto, sin dejar a medias un carácter
' de los que ocupan dos (emojis): una mitad suelta no es texto válido para Firestore.
Private Function RecortarTexto(ByVal texto As String, ByVal maximo As Long) As String
    Dim codigo As Long

    If Len(texto) <= maximo Then
        RecortarTexto = texto
        Exit Function
    End If
    texto = Left$(texto, maximo)
    codigo = AscW(Right$(texto, 1))
    If codigo < 0 Then codigo = codigo + 65536
    If codigo >= 55296 And codigo <= 56319 Then texto = Left$(texto, Len(texto) - 1)
    RecortarTexto = texto
End Function

Private Sub BorrarPeticion(ByVal urlPeticion As String)
    Dim estado As Long
    Dim respuesta As String

    PeticionFirestore "DELETE", urlPeticion, "", estado, respuesta
End Sub

' Una petición HTTP a Firestore. Si Google exige la clave de API (cosa rara:
' Firestore no la pide cuando las reglas dejan pasar la petición) la repite con
' ella. Devuelve False si no hubo conexión; entonces `respuesta` trae el motivo.
Private Function PeticionFirestore(ByVal metodo As String, ByVal url As String, ByVal cuerpo As String, ByRef estado As Long, ByRef respuesta As String) As Boolean
    Dim conexion As Boolean

    ' (En VBA, leer el nombre de la función dentro de ella es una llamada
    ' recursiva, no el valor devuelto: por eso se guarda el resultado en `conexion`.)
    If mUsarClaveApi Then
        conexion = PeticionHttp(metodo, ConClaveApi(url), cuerpo, estado, respuesta)
    Else
        conexion = PeticionHttp(metodo, url, cuerpo, estado, respuesta)
        If conexion And estado = 403 And Len(CHUSY_API_KEY) > 0 Then
            If InStr(1, respuesta, "API key", vbTextCompare) > 0 Or InStr(1, respuesta, "unregistered callers", vbTextCompare) > 0 Then
                mUsarClaveApi = True
                conexion = PeticionHttp(metodo, ConClaveApi(url), cuerpo, estado, respuesta)
            End If
        End If
    End If
    PeticionFirestore = conexion
End Function

Private Function ConClaveApi(ByVal url As String) As String
    If InStr(url, "?") > 0 Then
        ConClaveApi = url & "&key=" & CHUSY_API_KEY
    Else
        ConClaveApi = url & "?key=" & CHUSY_API_KEY
    End If
End Function

' Petición HTTP con tiempo máximo (15 s). Usa MSXML2.XMLHTTP (la pila de Windows
' que sigue los ajustes de proxy del equipo, la misma del navegador).
Private Function PeticionHttp(ByVal metodo As String, ByVal url As String, ByVal cuerpo As String, ByRef estado As Long, ByRef respuesta As String) As Boolean
    Dim http As Object
    Dim limite As Date

    On Error GoTo Fallo
    estado = 0
    respuesta = ""
    Set http = CreateObject("MSXML2.XMLHTTP.6.0")
    http.Open metodo, url, True
    ' Sin caché: se consulta varias veces la misma dirección y debe verse siempre lo último.
    http.setRequestHeader "Cache-Control", "no-cache"
    http.setRequestHeader "Pragma", "no-cache"
    http.setRequestHeader "If-Modified-Since", "Sat, 01 Jan 2000 00:00:00 GMT"
    If Len(cuerpo) > 0 Then
        http.setRequestHeader "Content-Type", "application/json"
        http.send cuerpo
    Else
        http.send
    End If

    limite = DateAdd("s", 15, Now)
    Do While http.readyState <> 4
        If Now > limite Then
            http.abort
            Err.Raise vbObjectError + 513, , "tiempo de espera agotado"
        End If
        Sleep 50
        DoEvents
    Loop
    estado = http.Status
    respuesta = http.responseText
    PeticionHttp = True
    Exit Function

Fallo:
    respuesta = Err.Description
    PeticionHttp = False
End Function

' ---- JSON mínimo (sin librerías externas) ----

' Un campo de texto en el formato de la API REST de Firestore.
Private Function CampoTexto(ByVal nombre As String, ByVal valor As String) As String
    CampoTexto = """" & nombre & """:{""stringValue"":""" & JsonEscapar(valor) & """}"
End Function

' Escapa un texto para meterlo entre comillas en JSON. Todo lo que no sea ASCII
' imprimible sale como \uXXXX: el cuerpo de la petición queda en ASCII puro y la
' codificación (tildes, Ñ, euro, emojis) no puede estropearse por el camino.
Private Function JsonEscapar(ByVal texto As String) As String
    Dim n As Long
    Dim i As Long
    Dim posicion As Long
    Dim codigo As Long
    Dim buffer As String
    Dim trozo As String

    n = Len(texto)
    If n = 0 Then Exit Function
    buffer = Space$(n * 6)
    posicion = 1
    For i = 1 To n
        codigo = AscW(Mid$(texto, i, 1))
        If codigo < 0 Then codigo = codigo + 65536
        If codigo >= 32 And codigo <= 126 And codigo <> 34 And codigo <> 92 Then
            Mid$(buffer, posicion, 1) = Mid$(texto, i, 1)
            posicion = posicion + 1
        Else
            Select Case codigo
                Case 34: trozo = "\"""
                Case 92: trozo = "\\"
                Case 10: trozo = "\n"
                Case 13: trozo = "\r"
                Case 9: trozo = "\t"
                Case Else: trozo = "\u" & Right$("0000" & Hex$(codigo), 4)
            End Select
            Mid$(buffer, posicion, Len(trozo)) = trozo
            posicion = posicion + Len(trozo)
        End If
    Next i
    JsonEscapar = Left$(buffer, posicion - 1)
End Function

' El id que Firestore le da al documento recién creado (va al final de "name").
Private Function IdDePeticion(ByVal respuesta As String) As String
    Dim p As Long
    Dim q As Long

    p = InStr(1, respuesta, "/offerInbox/")
    If p = 0 Then Exit Function
    p = p + Len("/offerInbox/")
    q = InStr(p, respuesta, """")
    If q > p Then IdDePeticion = Mid$(respuesta, p, q - p)
End Function

' El valor de un campo de texto de un documento de Firestore ("campo": {"stringValue": "valor"}).
Private Function CampoFirestore(ByVal json As String, ByVal campo As String) As String
    Dim p As Long

    p = InStr(1, json, """" & campo & """")
    If p = 0 Then Exit Function
    p = InStr(p, json, """stringValue""")
    If p = 0 Then Exit Function
    p = InStr(p + Len("""stringValue"""), json, """")
    If p = 0 Then Exit Function
    CampoFirestore = LeerCadenaJson(json, p + 1)
End Function

' El texto de "message" en la respuesta de error de Google.
Private Function MensajeDeErrorJson(ByVal json As String) As String
    Dim p As Long

    p = InStr(1, json, """message""")
    If p = 0 Then Exit Function
    p = InStr(p + Len("""message"""), json, """")
    If p = 0 Then Exit Function
    MensajeDeErrorJson = LeerCadenaJson(json, p + 1)
End Function

' Lee una cadena JSON desde `inicio` (justo después de la comilla que abre) hasta la comilla que cierra, deshaciendo los escapes.
Private Function LeerCadenaJson(ByVal json As String, ByVal inicio As Long) As String
    Dim i As Long
    Dim c As String
    Dim resultado As String

    i = inicio
    Do While i <= Len(json)
        c = Mid$(json, i, 1)
        If c = """" Then Exit Do
        If c = "\" Then
            i = i + 1
            c = Mid$(json, i, 1)
            Select Case c
                Case "n": resultado = resultado & vbLf
                Case "r": resultado = resultado & vbCr
                Case "t": resultado = resultado & vbTab
                Case "u"
                    resultado = resultado & ChrW$(CodigoHexadecimal(Mid$(json, i + 1, 4)))
                    i = i + 4
                Case Else: resultado = resultado & c
            End Select
        Else
            resultado = resultado & c
        End If
        i = i + 1
    Loop
    LeerCadenaJson = resultado
End Function

' El número que escriben cuatro cifras hexadecimales (\uXXXX), listo para ChrW$ (que espera de -32768 a 32767).
Private Function CodigoHexadecimal(ByVal cifras As String) As Long
    Dim i As Long
    Dim digito As Long
    Dim valor As Long

    For i = 1 To Len(cifras)
        digito = InStr(1, "0123456789abcdef", Mid$(cifras, i, 1), vbTextCompare) - 1
        If digito < 0 Then digito = 0
        valor = valor * 16 + digito
    Next i
    If valor > 32767 Then valor = valor - 65536
    CodigoHexadecimal = valor
End Function
