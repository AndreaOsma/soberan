# Soberan — Guía operativa

Referencia para uso diario, backup, integraciones opcionales y self-host.

## Acceso y autenticación

- No hay login con clave en el frontend. En self-host, protege la app con tu reverse proxy / SSO si hace falta.
- **iCal (calendario externo, opcional):** si defines `SOBERAN_API_KEY`, el feed exige `?token=`:
  ```
  https://tu-host/api/calendar/payments.ics?token=TU_SOBERAN_API_KEY
  ```
  Sin clave, el feed queda abierto (solo accesible si el host/ruta lo permiten). Configura host/puerto en Ajustes → iCal.

## Puesta en marcha local

```bash
cd deploy
cp .env.example .env
docker compose up -d --build
```

Una sola imagen (SPA + API + SQLite). Detalle: [DOCKER.md](DOCKER.md).

- App: http://localhost:8080
- OpenAPI: http://localhost:8080/docs (rutas API bajo `/api/…` también)

Desarrollo frontend: `npm run dev` en la raíz (proxy `/api` → backend en `:8000`).

## Validación antes de desplegar

```bash
# Frontend
npm install && npm run build && npm run lint && npm run test

# Backend
cd backend && python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt && .venv/bin/python -m pytest -q
```

## Base de datos (SQLite)

Por defecto Compose / Docker Hub usan SQLite en el volumen `soberan_data` (`/data/soberan.db`).

### Backup manual

```bash
docker compose -f deploy/docker-compose.yml cp soberan:/data/soberan.db ./soberan-backup-$(date +%F).db
```

### Restore

Para el stack Compose: detén el servicio, sustituye el fichero en el volumen (o `docker compose cp` hacia `/data/soberan.db`) y vuelve a arrancar.

Las variables `BACKUP_*` en `.env.example` documentan intención; automatiza backup en tu stack si lo necesitas.

Postgres sigue soportado vía `DATABASE_URL=postgresql://…` si despliegas el target `api` detrás de tu propio proxy.

## Chat / Ollama (opcional)

- El asistente en la UI llama a `POST /api/chat`.
- En **Ajustes → Asistente (Ollama)** puedes:
  - Activar/desactivar el chatbot (si lo apagas, el icono del asistente no se muestra).
  - Definir `URL de Ollama` y modelo.
  - Pulsar **Probar conexión**.
- Prioridad de URL: ajuste en BD → `OLLAMA_BASE_URL` (env) → `http://127.0.0.1:11434`.
- Modelo: ajuste → `OLLAMA_MODEL` → `llama3:8b`.
- Si Ollama está offline, el chat informa sin bloquear el resto de la app.

## Integraciones opcionales

| Integración | Requisito | Notas |
|-------------|-----------|--------|
| **Kraken** | API key/secret en Ajustes | Solo lectura; sincroniza balances |
| **GoCardless** | `GOCARDLESS_SECRET_ID/KEY` | Open Banking; backend preparado |
| **MiniMax** | `MINIMAX_API_KEY` | Legacy IA; chat usa Ollama |
| **iCal** | Host/puerto en settings | Feed de pagos recurrentes |
| **Valoración vehículos** | Ninguna clave | Autoscout24 + Wallapop + coches.net; auto cada ~30 días al abrir la app |

Ninguna es obligatoria para presupuesto, transacciones o Inicio.

### Valoración de vehículos (Activos fijos)

Solo **APIs públicas** (sin claves). El botón **Valorar** (y el refresh automático mensual) estima un valor **realizable** (venta en ~30–60 días), no el precio medio de anuncio:

1. Recoge anuncios en **Autoscout24.es** (principal), **Wallapop** y **coches.net** cuando respondan (match estricto de marca/modelo).
2. Calcula banda asking (P10/P25/P50) y un percentil bajo (≈P12–P18).
3. Aplica haircut asking→venta (`VEHICLE_ASK_HAIRCUT`, default **12%**, rango 0.08–0.18).
4. Al abrir la app, `POST /properties/vehicle-valuation/refresh-due` revalora vehículos sin fecha o con más de **30 días**.

Campos mínimos: **marca**, **modelo**; recomendados **año**, **km**.

El desglose se guarda en `properties.valoracion_json` y sobrevive al reload.

## Actualizaciones desktop

La app Windows consulta el [último release en GitHub](https://github.com/AndreaOsma/soberan/releases/latest) (tags `v*`). Override: `SOBERAN_RELEASES_URL`.

## API OpenClaw / agente

Endpoints para automatización:

- `GET /api/agent/commands`
- `POST /api/agent/command`
- `GET /api/agent/context`
- `POST /api/agent/transaction`
- `GET /api/agent/audit`

Con `SOBERAN_API_KEY` definido, el feed iCal exige `?token=`; el resto de la API no usa esa clave.

## PWA (móvil)

- Instala desde el navegador (Safari → Compartir → Añadir a pantalla de inicio; Chrome → Instalar app).
- Iconos en `public/icon-*.png`; service worker cachea el shell offline.
- Atajo directo al calendario: `/?menu=Calendario%20de%20Pagos` (también en manifest shortcuts).

## Revertir cambios de configuración

- iCal con token: vacía `SOBERAN_API_KEY` y reinicia backend (el feed deja de exigir `?token=`).
- Tema/densidad: Ajustes en la UI (persistido en `user_settings`).
