# Soberan

Gestor financiero personal en español: presupuesto, patrimonio, deudas, calendario de pagos y cierre mensual.

- **Backend:** FastAPI (Python 3.11) + SQLAlchemy + Alembic  
- **Frontend:** Vite + React + TypeScript  
- **Sin login en la app:** self-host detrás de tu proxy/SSO si quieres; en Windows/Android todo es local en tu dispositivo.
- **Código y releases:** [github.com/AndreaOsma/soberan](https://github.com/AndreaOsma/soberan)
- **Docker Hub:** [andreaosma/soberan](https://hub.docker.com/r/andreaosma/soberan)

---

## 📥 Descarga rápida

| | Plataforma | |
|:---:|---|---|
| 🪟 | **Windows** | [**Descargar instalador**](https://github.com/AndreaOsma/soberan/releases/latest) — `SoberanSetup-x.y.z.exe` |
| 🤖 | **Android** | [**Descargar APK**](https://github.com/AndreaOsma/soberan/releases/latest) — `Soberan-x.y.z.apk` |
| 🐳 | **Docker / self-host** | `docker run --rm -p 8080:8080 -v soberan_data:/data andreaosma/soberan:latest` |

Detalle de cada camino (datos, actualizaciones, requisitos) más abajo ↓

---

## Elige cómo usarlo

| Camino | Para quién | Datos |
|--------|------------|--------|
| [🪟 Windows (instalador)](#descargar-windows) | Uso diario sin Docker | SQLite en `%LOCALAPPDATA%\Soberan\` |
| [🤖 Android (APK)](#descargar-android) | Uso diario en el móvil | SQLite local en el dispositivo |
| [🐳 Docker / self-host](#self-hosted-docker) | Servidor / self-host | SQLite en volumen Docker |
| [🛠️ Desarrollo](#desarrollo) | Cambiar código | SQLite local |

---

<a id="descargar-windows"></a>
## 🪟 Descargar (Windows)

Instalador: **[Releases → última versión](https://github.com/AndreaOsma/soberan/releases/latest)** (tag `v*`, p. ej. `v0.2.0`)

1. Descarga `SoberanSetup-x.y.z.exe`.
2. Instala y abre **Soberan** → navegador en `http://127.0.0.1:17890`.
3. Datos en `%LOCALAPPDATA%\Soberan\data\` — no hace falta internet para el día a día.

La app comprueba actualizaciones en **GitHub Releases** al iniciar (Ajustes → Windows), contra el último release publicado.

Guía completa (backup, Ollama, rutas): **[docs/desktop-windows.md](docs/desktop-windows.md)**

---

<a id="descargar-android"></a>
## 🤖 Descargar (Android)

APK: **[Releases → última versión](https://github.com/AndreaOsma/soberan/releases/latest)** (tag `v*`, p. ej. `v0.2.0`)

1. Descarga `Soberan-x.y.z.apk` desde el móvil (o pásalo por cable/Drive).
2. Ábrelo — Android pedirá permiso para instalar desde este origen la primera vez (**Ajustes → Instalar apps desconocidas**, actívalo solo para el navegador/gestor de archivos que uses).
3. Instala y abre **Soberan**. Datos guardados localmente en el dispositivo.

No requiere Google Play ni cuenta — es instalación directa (sideload) del mismo APK firmado que genera cada release.

---

<a id="self-hosted-docker"></a>
## 🐳 Self-hosted (Docker)

Imagen en Docker Hub: **[andreaosma/soberan](https://hub.docker.com/r/andreaosma/soberan)** (SPA + API en un solo contenedor, puerto **8080**).

```bash
docker pull andreaosma/soberan:latest
docker run --rm -p 8080:8080 -v soberan_data:/data andreaosma/soberan:latest
```

O con Compose:

```bash
cd deploy
cp .env.example .env
docker compose up -d --build
```

Abre `http://127.0.0.1:8080/`. Datos en el volumen `soberan_data` (`/data/soberan.db`).

Detalle: **[docs/DOCKER.md](docs/DOCKER.md)**. Producción / iCal / Ollama: **[docs/operations.md](docs/operations.md)**.

### Variables de entorno

Variables que Compose lee de `deploy/.env`:

| Variable | Rol |
|----------|-----|
| `SOBERAN_HTTP_PORT` | Puerto en el host (default `8080`) |
| `SOBERAN_API_KEY` | Opcional: token del feed iCal (`?token=`) |
| `CORS_ALLOW_ORIGINS` | Orígenes CORS permitidos |

El resto de [`.env.example`](.env.example) documenta uso avanzado / desarrollo. **Ninguna integración es obligatoria** para presupuesto, cuentas o Inicio.

Ollama (chat): configurable en **Ajustes → Asistente**, o con `OLLAMA_BASE_URL` / `OLLAMA_MODEL` en el entorno. Detalle en [docs/operations.md](docs/operations.md).

---

<a id="desarrollo"></a>
## 🛠️ Desarrollo

### Frontend (hot reload)

```bash
npm install && npm run dev
```

- UI: http://localhost:5173  
- Proxy Vite: `/api` → `http://localhost:8000` (hace falta un backend en ese puerto)

### Backend

**Opción A — stack completo con Docker** (SPA + API + SQLite):

```bash
cd deploy && docker compose up -d --build
```

App en **http://localhost:8080**.

**Opción B — solo API local** (frontend en Vite `:5173`):

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Sin `DATABASE_URL` usa `sqlite:///./test.db`. OpenAPI: http://localhost:8000/docs

### Validar y tests

```bash
# Frontend
npm install && npm run build && npm run lint && npm run test

# Backend
cd backend
python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
.venv/bin/python -m pytest -q
```

### Modo desktop local (sin instalador)

```bash
./deploy/scripts/run-desktop.sh --no-browser
```

Sirve estáticos + API en modo `SOBERAN_DESKTOP=1` (puerto **17890**).

### Build del instalador Windows (opcional)

```powershell
.\deploy\scripts\build-desktop.ps1 -Version 0.1.0
```

El instalador se construye y se publica en [Releases](https://github.com/AndreaOsma/soberan/releases) como parte de `git-publish` (PyInstaller + Inno vía Docker) al publicar una versión — no hay CI aparte para esto.

---

## Primera vez en la app

El onboarding te deja configurar:

1. Método Soberan (guía rápida)  
2. Primera cuenta (saldo)  
3. Pistas para el primer mes (nómina / CSV)  
4. **Perfil** — nacimiento, fondo de emergencia, objetivo de ahorro  
5. **Apariencia** — color de contraste y tamaño de fuente  
6. **Asistente** — activar chat, URL/modelo Ollama y probar conexión  

Tema claro/oscuro y densidad (minimal/detailed) se eligen después en la barra superior. Todo es editable en **Configuración**.

---

## Mapa de la app

| Sección | Qué hay |
|---------|---------|
| **Inicio** | Semáforo, KPIs, proyección patrimonial, alertas |
| **Movimientos** | Transacciones, ingresos, flujo de efectivo, cierre mensual, objetivos |
| **Presupuesto** | Presupuesto (mes/año, 50/30/20), calendario de pagos |
| **Cuentas** | Cuentas, tarjetas, pasivos (deudas), cuentas a cobrar |
| **Inversiones** | Cartera, evolución anual, interés compuesto |
| **Propiedades** | Activos fijos (inmuebles / valoración de vehículos) |
| **Laboral** | Historial laboral, impuestos |
| **Configuración** | Apariencia, perfil, Ollama, datos (CSV/backup), iCal, integraciones |

Chat: opcional vía Ollama; si está offline o desactivado, el resto de la app sigue igual.

---

## Comandos útiles

| Comando | Qué hace |
|---------|----------|
| `cd deploy && docker compose up -d --build` | Levantar stack |
| `cd deploy && docker compose down` | Parar stack |
| `cd deploy && docker compose logs -f` | Seguir logs |
| `npm install && npm run dev` | Vite en `:5173` |
| `./deploy/scripts/run-desktop.sh --no-browser` | Backend desktop + estáticos |
| `cd backend && .venv/bin/python -m pytest -q` | Pytest backend |
| `npm run build && npm run lint && npm run test` | Validar frontend |

---

## Stack (referencia)

| Capa | Tecnología |
|------|------------|
| Backend | Python 3.11, FastAPI, SQLAlchemy, Alembic |
| Frontend | Vite, React 18, TypeScript |
| Docker | Imagen única SPA+API `:8080`, SQLite en volumen |
| Desktop | PyInstaller + SQLite (`SOBERAN_DESKTOP=1`) |

---

## Documentación

- **[docs/DOCKER.md](docs/DOCKER.md)** — self-host Docker (una imagen, SQLite)  
- **[docs/desktop-windows.md](docs/desktop-windows.md)** — instalación Windows, datos, backup, actualizaciones, Ollama  
- **[docs/operations.md](docs/operations.md)** — iCal, backup/restore, Ollama, integraciones, PWA, API agente  

---

## API agente (OpenClaw)

Para automatización (detalle en [docs/operations.md](docs/operations.md)):

- `GET /api/agent/commands` · `POST /api/agent/command`  
- `GET /api/agent/context` · `POST /api/agent/transaction` · `GET /api/agent/audit`  

Con `SOBERAN_API_KEY`, el feed iCal exige `?token=`; el resto de la API no usa esa clave.
