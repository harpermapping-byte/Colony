# Instalador completo del servidor de Colony en un PC Windows, desde cero.
# Se ejecuta desde instalar.bat (que pide permisos de administrador).
#
# Filosofia (importante si algun dia hay que tocarlo): NUNCA da un paso por
# bueno sin comprobarlo. Cada dependencia se verifica por el BINARIO REAL
# despues de instalarla, no por el codigo de salida del instalador; y si algo
# no se puede dejar hecho solo, se apunta y al final sale una lista de "esto
# lo tienes que hacer tu", en vez de reventar a medias o —peor— seguir y que
# el fallo aparezca 3 pasos despues en un sitio que no tiene nada que ver.
#
# Es idempotente: se puede relanzar las veces que haga falta. Lo ya hecho se
# detecta y se salta, y nunca se pisa una base de datos existente.
#
# Ver docs/GDD_Despliegue_Local.md para la guia completa.

param(
  # Donde vivira el proyecto. Por defecto, una carpeta en el Escritorio.
  [string]$Carpeta = (Join-Path ([Environment]::GetFolderPath("Desktop")) "Colony"),
  [string]$RepoUrl = "https://github.com/harpermapping-byte/Colony.git",
  [string]$Rama = "main",
  # Puerto local del servidor (el mismo que apuntara el tunel de Cloudflare).
  [int]$Puerto = 2567
)

$ErrorActionPreference = "Stop"
$pendientes = New-Object System.Collections.ArrayList

function Titulo($texto) {
  Write-Host ""
  Write-Host "=== $texto ===" -ForegroundColor Cyan
}
function Bien($texto) { Write-Host "  OK  $texto" -ForegroundColor Green }
function Aviso($texto) { Write-Host "  --  $texto" -ForegroundColor Yellow }
function Pendiente($texto) {
  Write-Host "  !!  $texto" -ForegroundColor Red
  [void]$pendientes.Add($texto)
}

# Tras instalar algo, el PATH de ESTA ventana sigue siendo el viejo y el
# programa recien instalado "no existe" hasta reiniciar. Esto lo recarga del
# registro, que es donde lo dejo el instalador.
function RefrescarPath {
  $maquina = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $usuario = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$maquina;$usuario"
}

function ExisteComando($nombre) {
  return [bool](Get-Command $nombre -ErrorAction SilentlyContinue)
}

# winget devuelve codigos "de error" que en realidad significan que el
# paquete ya estaba puesto. Tratarlos como fallo dejaria al streamer
# bloqueado sin motivo; tragarselos todos escondería el fallo real.
$CODIGOS_WINGET_OK = @(
  0,            # instalado correctamente
  -1978335135,  # PACKAGE_ALREADY_INSTALLED
  -1978335189,  # UPDATE_NOT_APPLICABLE (ya esta en la ultima version)
  -1978335153,  # PACKAGE_ALREADY_INSTALLED (variante)
  -1978334967   # INSTALL_REBOOT_REQUIRED_TO_FINISH
)

function InstalarConWinget($nombreBonito, [string[]]$argumentos) {
  Aviso "Instalando $nombreBonito (puede tardar varios minutos)..."
  & winget @argumentos 2>&1 | Out-Null
  $codigo = $LASTEXITCODE
  if ($CODIGOS_WINGET_OK -contains $codigo) {
    if ($codigo -eq -1978334967) { Aviso "$nombreBonito instalado, pero Windows pedira reiniciar al final." }
    return $true
  }
  Aviso "winget devolvio 0x$('{0:X8}' -f $codigo) al instalar $nombreBonito"
  return $false
}

# Instala si el binario que lo delata no existe ya. Devuelve $true solo si al
# terminar el binario esta REALMENTE disponible.
function AsegurarPrograma($nombreBonito, $comando, [string[]]$argumentos, $urlManual) {
  if (ExisteComando $comando) {
    Bien "$nombreBonito ya estaba instalado"
    return $true
  }
  [void](InstalarConWinget $nombreBonito $argumentos)
  RefrescarPath
  if (ExisteComando $comando) {
    Bien "$nombreBonito instalado"
    return $true
  }
  Pendiente "$nombreBonito no quedo disponible. Reinicia el PC y vuelve a ejecutar este instalador; si sigue igual, instalalo a mano desde: $urlManual"
  return $false
}

$FLAGS = @("--exact", "--source", "winget", "--silent",
           "--accept-package-agreements", "--accept-source-agreements",
           "--disable-interactivity")

Write-Host ""
Write-Host "############################################" -ForegroundColor Magenta
Write-Host "#      INSTALADOR DEL SERVIDOR COLONY      #" -ForegroundColor Magenta
Write-Host "############################################" -ForegroundColor Magenta
Write-Host "Carpeta de instalacion: $Carpeta"

# ------------------------------------------------------------------ 0. winget
Titulo "0/7  Comprobando winget (el instalador de Windows)"
if (-not (ExisteComando "winget")) {
  $build = [Environment]::OSVersion.Version.Build
  if ($build -lt 17763) {
    Write-Host ""
    Write-Host "Tu Windows es demasiado antiguo para winget (hace falta Windows 10 1809 o superior)." -ForegroundColor Red
    Write-Host "Actualiza Windows y vuelve a ejecutar este instalador." -ForegroundColor Red
    exit 1
  }
  Aviso "winget no esta disponible — intentando prepararlo..."
  try {
    $ProgressPreference = "SilentlyContinue"
    Install-PackageProvider -Name NuGet -Force -ErrorAction Stop | Out-Null
    Install-Module -Name Microsoft.WinGet.Client -Force -Scope AllUsers -Repository PSGallery -ErrorAction Stop | Out-Null
    Repair-WinGetPackageManager -AllUsers -ErrorAction Stop
    RefrescarPath
  } catch {
    Aviso "No se pudo preparar winget automaticamente."
  }
}
if (-not (ExisteComando "winget")) {
  Write-Host ""
  Write-Host "No hay winget en este PC y no he podido instalarlo solo." -ForegroundColor Red
  Write-Host "Solucion: abre la Microsoft Store, busca 'Instalador de aplicaciones'" -ForegroundColor Yellow
  Write-Host "(App Installer), pulsa Obtener/Actualizar, y vuelve a ejecutar este archivo." -ForegroundColor Yellow
  exit 1
}
Bien "winget disponible"

# ---------------------------------------------------------------- 1. Programas
Titulo "1/7  Programas necesarios"

$hayGit = AsegurarPrograma "Git" "git" ($FLAGS + @("--id", "Git.Git", "--scope", "machine")) "https://git-scm.com/download/win"
$hayNode = AsegurarPrograma "Node.js" "node" ($FLAGS + @("--id", "OpenJS.NodeJS.LTS")) "https://nodejs.org/en/download"
# El MSI de cloudflared si se añade solo al PATH del sistema; el portable no.
$hayTunel = AsegurarPrograma "cloudflared" "cloudflared" ($FLAGS + @("--id", "Cloudflare.cloudflared", "--installer-type", "wix")) "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"

if ($hayNode) {
  $version = (node -v).TrimStart("v")
  $mayor = [int]($version.Split(".")[0])
  if ($mayor -lt 22) {
    Pendiente "Node instalado es v$version y el juego necesita v22 o superior. Actualizalo desde https://nodejs.org"
  } else {
    Bien "Node v$version (suficiente)"
  }
}

# --------------------------------------------------------------- 2. PostgreSQL
Titulo "2/7  PostgreSQL (donde se guardan las partidas)"

function BuscarBinarioPg($nombre) {
  if (ExisteComando $nombre) { return $nombre }
  $encontrado = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\$nombre.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
  if ($encontrado) { return $encontrado.FullName }
  return $null
}

$passSuper = $null
$psql = BuscarBinarioPg "psql"

if ($psql) {
  Bien "PostgreSQL ya estaba instalado"
} else {
  # Puerto ocupado antes de instalar = ya hay otro Postgres; el instalador
  # elegiria un puerto distinto en silencio y el .env apuntaria mal.
  $ocupado = Test-NetConnection -ComputerName localhost -Port 5432 -InformationLevel Quiet -WarningAction SilentlyContinue
  if ($ocupado) {
    Aviso "Algo ya escucha en el puerto 5432 — puede ser otro PostgreSQL ya instalado."
  }
  # Contrasena de superusuario generada por nosotros: si dejamos que el
  # instalador ponga la suya por defecto, luego no podriamos crear la base de
  # datos del juego. Solo letras y numeros (nada que escapar). NUNCA se
  # imprime ni se guarda en disco.
  $caracteres = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789".ToCharArray()
  $passSuper = -join (1..24 | ForEach-Object { $caracteres | Get-Random })
  [void](InstalarConWinget "PostgreSQL" ($FLAGS + @("--id", "PostgreSQL.PostgreSQL.17", "--custom", "--serverport 5432 --superpassword $passSuper")))
  RefrescarPath
  Start-Sleep -Seconds 5
  $psql = BuscarBinarioPg "psql"
  if ($psql) { Bien "PostgreSQL instalado" }
  else { Pendiente "PostgreSQL no quedo instalado. Instalalo a mano desde https://www.postgresql.org/download/windows/ y vuelve a ejecutar este instalador." }
}

# El servicio tiene que estar corriendo para poder crear nada.
$puertoPg = 5432
if ($psql) {
  $servicio = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($servicio) {
    if ($servicio.Status -ne "Running") {
      Aviso "Arrancando el servicio de PostgreSQL..."
      try { Start-Service $servicio.Name; Start-Sleep -Seconds 4 } catch { Pendiente "No se pudo arrancar el servicio de PostgreSQL ($($servicio.Name))" }
    }
    Bien "Servicio '$($servicio.Name)' en marcha"
  }
  # Puerto REAL del cluster: si 5432 estaba pillado, el instalador usa otro.
  $conf = Get-ChildItem "C:\Program Files\PostgreSQL\*\data\postgresql.conf" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
  if ($conf) {
    $lineaPuerto = Get-Content $conf.FullName | Where-Object { $_ -match "^\s*port\s*=\s*(\d+)" } | Select-Object -First 1
    if ($lineaPuerto -and $lineaPuerto -match "(\d+)") { $puertoPg = [int]$Matches[1] }
  }
  Bien "PostgreSQL escucha en el puerto $puertoPg"
}

# ---------------------------------------------------------------- 3. Proyecto
Titulo "3/7  Descargar el proyecto"
if (-not $hayGit) {
  Pendiente "Sin Git no se puede descargar el proyecto"
} elseif (Test-Path (Join-Path $Carpeta ".git")) {
  Bien "El proyecto ya estaba en $Carpeta — actualizando"
  Push-Location $Carpeta
  git fetch origin $Rama
  git pull origin $Rama
  Pop-Location
} else {
  Aviso "Descargando el proyecto en $Carpeta"
  Aviso "Al ser un repositorio privado se abrira una ventana para iniciar sesion en GitHub."
  New-Item -ItemType Directory -Force -Path (Split-Path $Carpeta -Parent) | Out-Null
  git clone --branch $Rama $RepoUrl $Carpeta
  if (Test-Path (Join-Path $Carpeta ".git")) { Bien "Proyecto descargado" }
  else { Pendiente "No se pudo descargar el proyecto desde $RepoUrl" }
}

if (-not (Test-Path (Join-Path $Carpeta "package.json"))) {
  Write-Host ""
  Write-Host "No hay proyecto en $Carpeta — no se puede seguir." -ForegroundColor Red
  if ($pendientes.Count -gt 0) {
    Write-Host ""
    Write-Host "PENDIENTE DE TI:" -ForegroundColor Yellow
    $pendientes | ForEach-Object { Write-Host "  - $_" }
  }
  exit 1
}
Set-Location $Carpeta

# ----------------------------------------------------------- 4. Base de datos
Titulo "4/7  Crear la base de datos del juego"
$rutaEnv = Join-Path (Join-Path $Carpeta "server") ".env"
$yaConfigurada = $false
if (Test-Path $rutaEnv) {
  if (Get-Content $rutaEnv | Where-Object { $_ -match "^\s*DATABASE_URL\s*=\s*\S" }) {
    Bien "Ya estaba configurada en server\.env (no se toca)"
    $yaConfigurada = $true
  }
}

if (-not $yaConfigurada -and $psql) {
  # Si acabamos de instalar Postgres sabemos su contrasena; si ya estaba
  # instalado de antes, no hay forma de adivinarla: hay que preguntarla.
  if (-not $passSuper) {
    Write-Host ""
    Write-Host "  PostgreSQL ya estaba instalado en este PC, asi que necesito la" -ForegroundColor Yellow
    Write-Host "  contrasena del usuario 'postgres' (la que se puso al instalarlo)." -ForegroundColor Yellow
    Write-Host "  Solo se usa ahora, para crear la base de datos del juego." -ForegroundColor Yellow
    $segura = Read-Host "  Contrasena de 'postgres'" -AsSecureString
    $passSuper = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
      [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura))
  }

  $caracteres = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789".ToCharArray()
  $passJuego = -join (1..24 | ForEach-Object { $caracteres | Get-Random })

  $env:PGPASSWORD = $passSuper
  $prueba = & $psql -h localhost -p $puertoPg -U postgres -tAc "SELECT 1;" 2>$null
  if ($LASTEXITCODE -ne 0) {
    Pendiente "No se pudo conectar a PostgreSQL como 'postgres' (contrasena incorrecta o servicio parado). Vuelve a ejecutar el instalador."
  } else {
    $existeRol = & $psql -h localhost -p $puertoPg -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='colony';" 2>$null
    if ($existeRol -eq "1") {
      Aviso "El usuario 'colony' ya existia — se le pone una contrasena nueva"
      & $psql -h localhost -p $puertoPg -U postgres -c "ALTER ROLE colony WITH LOGIN PASSWORD '$passJuego';" | Out-Null
    } else {
      & $psql -h localhost -p $puertoPg -U postgres -c "CREATE ROLE colony WITH LOGIN PASSWORD '$passJuego';" | Out-Null
      Bien "Usuario 'colony' creado"
    }
    $existeBd = & $psql -h localhost -p $puertoPg -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='colony';" 2>$null
    if ($existeBd -eq "1") {
      Bien "La base de datos 'colony' ya existia — se conserva con todo lo que tenga dentro"
    } else {
      & $psql -h localhost -p $puertoPg -U postgres -c "CREATE DATABASE colony OWNER colony;" | Out-Null
      Bien "Base de datos 'colony' creada"
    }

    # server/.env: se conserva lo que ya hubiera, solo se fija DATABASE_URL.
    if (Test-Path $rutaEnv) {
      $contenido = @(Get-Content $rutaEnv | Where-Object { $_ -notmatch "^\s*DATABASE_URL\s*=" })
    } elseif (Test-Path (Join-Path (Join-Path $Carpeta "server") ".env.example")) {
      $contenido = @(Get-Content (Join-Path (Join-Path $Carpeta "server") ".env.example") | Where-Object { $_ -notmatch "^\s*DATABASE_URL\s*=" })
    } else {
      $contenido = @()
    }
    $contenido += "DATABASE_URL=postgres://colony:$passJuego@localhost:$puertoPg/colony"
    Set-Content -Path $rutaEnv -Value $contenido -Encoding UTF8
    Bien "server\.env escrito (ahi dentro queda la contrasena de la base de datos)"
  }
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  $passSuper = $null
}

# ------------------------------------------------------------- 5. Compilacion
Titulo "5/7  Instalar dependencias y compilar (el paso mas largo)"
if ($hayNode) {
  Aviso "npm install..."
  npm install 2>&1 | Select-Object -Last 2
  Aviso "Compilando el servidor..."
  npm run build -w server 2>&1 | Select-Object -Last 2
  Aviso "Compilando el cliente (la web del juego)..."
  npm run build -w client 2>&1 | Select-Object -Last 2
  if (Test-Path (Join-Path (Join-Path $Carpeta "client") "dist\index.html")) { Bien "Todo compilado" }
  else { Pendiente "El cliente no se compilo (falta client\dist\index.html). Mira los errores mas arriba." }
} else {
  Pendiente "Sin Node no se puede compilar"
}

# ---------------------------------------------------------- 6. PM2 y arranque
Titulo "6/7  Arrancar el servidor (PM2)"
if ($hayNode) {
  if (-not (ExisteComando "pm2")) {
    Aviso "Instalando PM2..."
    npm install -g pm2 2>&1 | Out-Null
    RefrescarPath
  }
  if (ExisteComando "pm2") {
    Bien "PM2 disponible"
    $ecosystem = Join-Path (Join-Path (Join-Path $Carpeta "server") "deploy") "ecosystem.config.js"
    if ((pm2 jlist 2>$null) -match "colony-server") {
      pm2 restart colony-server | Out-Null
      Bien "Servidor reiniciado con la version nueva"
    } else {
      pm2 start $ecosystem | Out-Null
      Bien "Servidor arrancado"
    }
    pm2 save | Out-Null

    Start-Sleep -Seconds 8
    try {
      $estado = Invoke-RestMethod -Uri "http://localhost:$Puerto/estado" -TimeoutSec 5
      Bien "El servidor responde en http://localhost:$Puerto (jugadores conectados: $($estado.jugadoresConectados))"
    } catch {
      Pendiente "El servidor aun no responde en http://localhost:$Puerto — revisa los errores con: pm2 logs colony-server"
    }
  } else {
    Pendiente "No se pudo instalar PM2 (npm install -g pm2)"
  }
}

# ------------------------------------------------------- 7. Tareas de Windows
Titulo "7/7  Automatizar mantenimiento y arranque"
$deploy = Join-Path (Join-Path $Carpeta "server") "deploy"
$batMantenimiento = Join-Path $deploy "tareaProgramada.bat"
$batArranque = Join-Path $deploy "iniciarServidor.bat"

# Cada 5 min: baja cambios de GitHub, reinicia cada 8h si no hay nadie, y hace
# la copia diaria de la base de datos. Los tres se aplazan solos si hay gente.
schtasks /Create /TN "Colony-Mantenimiento" /TR "cmd /c `"$batMantenimiento`"" /SC MINUTE /MO 5 /RL HIGHEST /F 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Bien "Tarea 'Colony-Mantenimiento' creada (cada 5 minutos)" }
else { Pendiente "No se pudo crear la tarea de mantenimiento — creala a mano (ver docs/GDD_Despliegue_Local.md)" }

# Al iniciar sesion: levanta PM2 con lo que hubiera guardado.
schtasks /Create /TN "Colony-Arranque" /TR "cmd /c `"$batArranque`"" /SC ONLOGON /RL HIGHEST /F 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Bien "Tarea 'Colony-Arranque' creada (al encender el PC)" }
else { Pendiente "No se pudo crear la tarea de arranque — creala a mano (ver docs/GDD_Despliegue_Local.md)" }

# -------------------------------------------------------------------- Resumen
Write-Host ""
Write-Host "############################################" -ForegroundColor Magenta
Write-Host "#                 RESUMEN                  #" -ForegroundColor Magenta
Write-Host "############################################" -ForegroundColor Magenta

if ($pendientes.Count -eq 0) {
  Write-Host ""
  Write-Host "Servidor instalado y corriendo." -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "Casi listo. Estas cosas necesitan que las hagas tu:" -ForegroundColor Yellow
  $pendientes | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
}

Write-Host ""
Write-Host "QUEDA UN PASO QUE NO SE PUEDE AUTOMATIZAR: el tunel de Cloudflare," -ForegroundColor Cyan
Write-Host "porque hay que iniciar sesion en tu cuenta desde el navegador." -ForegroundColor Cyan
Write-Host ""
Write-Host "  Abre PowerShell y ejecuta, uno por uno:"
Write-Host ""
Write-Host "    cloudflared tunnel login" -ForegroundColor White
Write-Host "        (se abre el navegador: elige tu dominio y autoriza)"
Write-Host "    cloudflared tunnel create colony" -ForegroundColor White
Write-Host "    cloudflared tunnel route dns colony TU-DOMINIO.com" -ForegroundColor White
Write-Host ""
Write-Host "  Crea el archivo  $env:USERPROFILE\.cloudflared\config.yml  con esto"
Write-Host "  (el ID del tunel lo dice el comando 'create'):"
Write-Host ""
Write-Host "    tunnel: colony" -ForegroundColor White
Write-Host "    credentials-file: $env:USERPROFILE\.cloudflared\ID-DEL-TUNEL.json" -ForegroundColor White
Write-Host "    ingress:" -ForegroundColor White
Write-Host "      - hostname: TU-DOMINIO.com" -ForegroundColor White
Write-Host "        service: http://localhost:$Puerto" -ForegroundColor White
Write-Host "      - service: http_status:404" -ForegroundColor White
Write-Host ""
Write-Host "  Y para que el tunel arranque solo con el PC:"
Write-Host "    cloudflared service install" -ForegroundColor White
Write-Host ""
Write-Host "Despues entra en https://TU-DOMINIO.com y deberias ver el juego."
Write-Host ""
