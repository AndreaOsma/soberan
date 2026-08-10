# Soberan — Windows desktop

Versión local para Windows: un solo `.exe`, datos en tu PC, sin servidor en la nube.

## Requisitos

- Windows 10 u 11 (64 bits)
- ~300 MB de espacio en disco
- Navegador (Edge o Chrome; se abre solo al iniciar)

## Instalación

El instalador se publica en **GitHub Releases** del repo [AndreaOsma/soberan](https://github.com/AndreaOsma/soberan).

1. Descarga **`SoberanSetup-x.y.z.exe`** desde [el último Release](https://github.com/AndreaOsma/soberan/releases/latest).
2. Ejecuta el instalador (Windows puede avisar de “editor desconocido” si no está firmado; es normal sin certificado de código).
3. Acepta instalar en `%LOCALAPPDATA%\Programs\Soberan`.
4. Marca “Crear acceso directo en el escritorio” si quieres.
5. Al terminar, abre **Soberan** — se abrirá el navegador en `http://127.0.0.1:17890`.

## Uso diario

- **Abrir:** doble clic en el acceso directo **Soberan**.
- **Cerrar:** cierra la ventana del navegador; el servidor local sigue en segundo plano hasta que cierres Soberan desde el Administrador de tareas si hace falta, o reinicies el PC.
- **Datos:** todo queda en tu máquina. No hace falta cuenta ni internet para presupuesto, cuentas y transacciones.

## Dónde están tus datos

| Qué | Ruta |
|-----|------|
| Base de datos | `%LOCALAPPDATA%\Soberan\data\soberan.db` |
| Logs | `%LOCALAPPDATA%\Soberan\logs\soberan.log` |
| Programa | `%LOCALAPPDATA%\Programs\Soberan\` |

En el Explorador de archivos: `%LOCALAPPDATA%` = `C:\Users\TU_USUARIO\AppData\Local`.

## Copia de seguridad

1. En la app: **Gestión de datos** → exportar backup o CSV.
2. Opcional: copia manual de `%LOCALAPPDATA%\Soberan\data\soberan.db` a un USB o nube **cifrada**.

**Importante:** si desinstalas Soberan, tus datos en `Soberan\data` **no se borran** por defecto.

## Actualizar

Al abrir la app, **busca actualizaciones de forma opcional** (activado por defecto):

1. Si hay una versión nueva en [el último Release](https://github.com/AndreaOsma/soberan/releases/latest), verás un aviso con enlace de descarga.
2. Puedes desactivarlo en **Ajustes → Windows → «Buscar actualizaciones al iniciar»**, o comprobar manualmente con **Comprobar ahora**.
3. Ignorar un aviso lo oculta hasta que salga otra versión.

Para instalar:

1. Descarga e instala la nueva versión encima (mismo instalador).
2. La base de datos en `%LOCALAPPDATA%\Soberan\data` se conserva.

## Asistente de chat (opcional)

El botón del asistente usa **Ollama** en tu PC. Sin Ollama, el resto de la app funciona igual.

1. Instala [Ollama](https://ollama.com) en Windows.
2. Descarga un modelo: `ollama pull llama3`
3. Define la variable de entorno `OLLAMA_BASE_URL=http://127.0.0.1:11434` y reinicia Soberan (avanzado; en futuras versiones puede venir preconfigurado).

## Integraciones opcionales

- **Kraken / GoCardless:** solo si configuras claves en Ajustes; no son necesarias para empezar.

## Limitaciones

- Un usuario por PC (sin login multiusuario).
- Sin sincronización entre móvil y PC.
- Solo accesible desde tu ordenador (`127.0.0.1`), no desde la red de casa salvo que cambies configuración avanzada.

## Desarrollo / compilar el instalador

El instalador se genera al publicar una versión con `git-publish` (build vía Docker, sin CI aparte). No hace falta compilar en local salvo para depurar.

Build manual (opcional, Windows):

```powershell
cd apps\soberan
.\deploy\scripts\build-desktop.ps1 -Version 0.1.0
```

Salida:

- Carpeta portable: `backend\dist\Soberan\`
- Instalador (si tienes [Inno Setup 6](https://jrsoftware.org/isinfo.php)): `packaging\out\SoberanSetup-0.1.0.exe`

Probar sin empaquetar (desarrollo):

```bash
npm run build
cp -r dist backend/desktop/static/
cd backend
SOBERAN_DESKTOP=1 python desktop_launcher.py --no-browser
```

## Problemas frecuentes

| Problema | Qué hacer |
|----------|-----------|
| “Puerto 17890 ocupado” | Ya hay Soberan abierto; usa el navegador en `http://127.0.0.1:17890` o cierra la otra instancia. |
| Pantalla en blanco | Espera unos segundos y recarga; revisa `Soberan\logs\soberan.log`. |
| Antivirus bloquea el .exe | Añade excepción para la carpeta de instalación (PyInstaller sin firma a veces dispara falsos positivos). |
| No aparece nada en Releases | El instalador solo se genera al publicar una versión con `git-publish`, no en cada push. |

## Revertir / desinstalar

- Panel de control → Desinstalar **Soberan** (programa).
- Para borrar datos: elimina manualmente `%LOCALAPPDATA%\Soberan` **solo si** ya tienes backup.
