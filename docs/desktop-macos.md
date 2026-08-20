# Soberan — macOS desktop

Versión local para Mac: una app en `/Applications`, datos en tu Mac, sin servidor en la nube.

## Requisitos

- macOS con Apple Silicon (arm64)
- ~150 MB de espacio en disco
- Navegador (Safari o Chrome; se abre solo al iniciar)

## Instalación

El instalador se publica en **GitHub Releases** del repo [AndreaOsma/soberan](https://github.com/AndreaOsma/soberan).

1. Descarga **`Soberan-x.y.z.dmg`** desde [el último Release](https://github.com/AndreaOsma/soberan/releases/latest).
2. Abre el `.dmg` y arrastra **Soberan** a la carpeta **Aplicaciones**.
3. Abre **Soberan** desde Launchpad o Aplicaciones.
4. La primera vez, macOS avisará de "app de un desarrollador no identificado" (ver más abajo cómo abrirla igualmente) — se abrirá el navegador en `http://127.0.0.1:17890`.

### "Soberan está dañada y no se puede abrir" / "desarrollador no identificado"

Normal en apps sin firma de Apple (sin certificado de $99/año). Dos formas de abrirla:

- **Clic derecho → Abrir** en vez de doble clic, y confirma en el aviso. Solo hace falta la primera vez.
- Si eso no aparece o sigue sin abrir, quita la cuarentena desde Terminal:
  ```bash
  xattr -cr /Applications/Soberan.app
  ```

## Uso diario

- **Abrir:** doble clic en **Soberan** (Launchpad o Aplicaciones).
- **Cerrar:** cierra la pestaña/ventana del navegador; el servidor local sigue en segundo plano hasta que salgas de Soberan desde el Monitor de Actividad si hace falta, o reinicies el Mac.
- **Datos:** todo queda en tu máquina. No hace falta cuenta ni internet para presupuesto, cuentas y transacciones.

## Dónde están tus datos

| Qué | Ruta |
|-----|------|
| Base de datos | `~/Library/Application Support/Soberan/data/soberan.db` |
| Logs | `~/Library/Application Support/Soberan/logs/soberan.log` |
| Programa | `/Applications/Soberan.app` |

## Copia de seguridad

1. En la app: **Gestión de datos** → exportar backup o CSV.
2. Opcional: copia manual de `~/Library/Application Support/Soberan/data/soberan.db` a un USB o nube **cifrada**.

**Importante:** si borras Soberan de Aplicaciones, tus datos en `~/Library/Application Support/Soberan` **no se borran** por defecto.

## Actualizar

Al abrir la app, **busca actualizaciones de forma opcional** (activado por defecto):

1. Si hay una versión nueva en [el último Release](https://github.com/AndreaOsma/soberan/releases/latest), verás un aviso con enlace de descarga.
2. Puedes desactivarlo en **Ajustes → Windows** (mismo ajuste que en la versión Windows) → «Buscar actualizaciones al iniciar», o comprobar manualmente con **Comprobar ahora**.
3. Ignorar un aviso lo oculta hasta que salga otra versión.

Para instalar: descarga el nuevo `.dmg` y arrastra **Soberan** a Aplicaciones otra vez (sobrescribe la anterior). Los datos en `~/Library/Application Support/Soberan` se conservan.

## Asistente de chat (opcional)

El botón del asistente usa **Ollama** en tu Mac. Sin Ollama, el resto de la app funciona igual.

1. Instala [Ollama](https://ollama.com) en macOS.
2. Descarga un modelo: `ollama pull llama3`
3. Define la variable de entorno `OLLAMA_BASE_URL=http://127.0.0.1:11434` y reinicia Soberan (avanzado; en futuras versiones puede venir preconfigurado).

## Integraciones opcionales

- **Kraken / GoCardless:** solo si configuras claves en Ajustes; no son necesarias para empezar.

## Limitaciones

- Un usuario por Mac (sin login multiusuario).
- Sin sincronización entre móvil y Mac.
- Solo accesible desde tu ordenador (`127.0.0.1`), no desde la red de casa salvo que cambies configuración avanzada.
- Solo Apple Silicon (arm64) — sin build para Mac Intel.

## Desarrollo / compilar el instalador

El `.dmg` se genera al publicar una versión con `git-publish`, igual que el `.exe` — pero, a diferencia de este, no puede cruzarse por Docker (PyInstaller no genera un `.app` de macOS salvo que corra en un Mac real), así que solo se construye cuando `git-publish` se ejecuta desde una máquina Mac.

Build manual (opcional, en un Mac):

```bash
cd apps/soberan
../../lib/native-packaging/build-desktop-mac-ci.sh 0.1.0
```

Salida:

- Bundle: `backend/dist/Soberan.app`
- Instalador: `packaging/out/Soberan-0.1.0.dmg`

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
| "Puerto 17890 ocupado" | Ya hay Soberan abierto; usa el navegador en `http://127.0.0.1:17890` o cierra la otra instancia desde el Monitor de Actividad. |
| Pantalla en blanco | Espera unos segundos y recarga; revisa `~/Library/Application Support/Soberan/logs/soberan.log`. |
| Gatekeeper bloquea la app | Ver sección de arriba: clic derecho → Abrir, o `xattr -cr /Applications/Soberan.app`. |
| No aparece nada en Releases | El `.dmg` solo se genera al publicar una versión con `git-publish` desde un Mac, no en cada push. |

## Revertir / desinstalar

- Arrastra **Soberan** de Aplicaciones a la Papelera.
- Para borrar datos: elimina manualmente `~/Library/Application Support/Soberan` **solo si** ya tienes backup.
