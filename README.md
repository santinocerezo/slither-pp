# Neon Slither

Juego web full stack inspirado en *Slither.io*, con estética neon y bots con IA reactiva. Construido como proyecto de portfolio para mostrar capacidad de resolver un sistema completo: motor de juego en cliente, server multiplayer con persistencia, deploy y todas las piezas de hardening que un sistema público necesita (rate limiting, validación, anti-cheat básico).

> **Demo:** https://slither-pp-production.up.railway.app
> **Repositorio:** https://github.com/santinocerezo/slither-pp

---

## Tabla de contenidos

- [Qué hace](#qué-hace)
- [Stack](#stack)
- [Estructura del repo](#estructura-del-repo)
- [Cómo correrlo localmente](#cómo-correrlo-localmente)
- [Deploy](#deploy)
- [Decisiones de diseño](#decisiones-de-diseño)
- [Controles](#controles)

---

## Qué hace

- **Motor de juego en HTML5 Canvas** escrito en JS vanilla — movimiento suave de la serpiente, partículas, glow neón, trails de boost.
- **9 bots con IA reactiva**: buscan comida, esquivan amenazas, respawnean al morir.
- **Multijugador asíncrono**: los jugadores comparten leaderboard global pero cada partida corre en cliente; el server persiste scores y notifica updates por WebSocket.
- **Identidad sin contraseña**: el jugador elige un nickname, se guarda en `localStorage`, y su historial de partidas (mejor score, kills totales, score promedio) queda asociado a ese nickname en la DB.
- **Leaderboard en tiempo real** vía Socket.io — cuando alguien rompe un récord, todos los clientes conectados lo ven.
- **Minimapa** que muestra la posición de todas las serpientes del mundo.
- **Soporte mobile**: joystick virtual + tap-hold para boost.
- **Optimizaciones de rendering**: viewport culling para no dibujar lo que está fuera de cámara.

---

## Stack

| Capa | Tecnología |
|---|---|
| Lenguaje | JavaScript (server) + JS vanilla (cliente) |
| Runtime / framework | Node.js + Express |
| Tiempo real | Socket.io |
| Base de datos | PostgreSQL (con fallback a memoria si no hay `DATABASE_URL`) |
| Renderizado | HTML5 Canvas (sin frameworks ni motor de juego) |
| Seguridad | Helmet, CORS allowlist, rate limiting (`express-rate-limit`) |
| Config | dotenv |
| Dev tooling | Nodemon (hot-reload del server) |
| Deploy | Railway (`railway.toml`) |

> **Sin frameworks de UI ni motores de juego.** Todo el motor (físicas de la serpiente, IA, colisiones, partículas, render) está escrito a mano en JS sobre Canvas. Es a propósito: el proyecto demuestra capacidad de bajar a primitivas, no de pegar librerías.

---

## Estructura del repo

```
slither-game/
├── server.js           # Express + Socket.io: API de scores, broadcast leaderboard
├── db.js               # Capa Postgres / fallback in-memory (misma interfaz)
├── public/
│   ├── index.html      # Login + leaderboard + historial del jugador
│   ├── game.html       # Página del juego (canvas full-screen)
│   ├── css/
│   │   └── style.css   # Tema neon
│   └── js/
│       ├── ui.js       # Login, leaderboard, modal de historial
│       └── game.js     # Motor de juego completo (serpientes, bots, render)
├── package.json
└── railway.toml        # Deploy en Railway
```

---

## Cómo correrlo localmente

**Requisitos:** Node 18+. Postgres opcional.

```bash
git clone https://github.com/santinocerezo/slither-pp.git
cd slither-pp
npm install
cp .env.example .env       # editar si tenés Postgres local
npm run dev                # nodemon, hot-reload
# abrir http://localhost:3000
```

Sin `DATABASE_URL`, el juego corre en memoria (los scores se resetean al reiniciar el server).

**Variables de entorno relevantes:**

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Connection string de Postgres. Si falta, modo in-memory. |
| `ALLOWED_ORIGINS` | Lista separada por coma de orígenes permitidos para Socket.io / CORS. Vacío = same-origin. |
| `PORT` | Puerto del server (default 3000). |

---

## Deploy

1. Push a GitHub.
2. Crear proyecto en Railway → **Deploy from GitHub repo**.
3. Agregar un servicio **PostgreSQL** al proyecto (Railway inyecta `DATABASE_URL`).
4. Setear `ALLOWED_ORIGINS` con el dominio de Railway.
5. Las tablas se crean automáticamente en el primer arranque (`db.init()`).

URL en producción: https://slither-pp-production.up.railway.app

---

## Decisiones de diseño

- **Capa `db.js` con la misma interfaz para Postgres e in-memory.** El server no sabe si está hablando con una DB real o con un objeto JS. Eso permite correr el juego sin Postgres en dev sin cambiar una línea del server.
- **Rate limiting separado para reads y writes.** `apiLimiter` para todo `/api/*` (60 req/min) y `writeLimiter` (30 req/min) para los endpoints que escriben scores. Limita el spam sin castigar la lectura del leaderboard.
- **Validación de scores en server.** El cliente reporta su score al final de la partida, pero el server valida techos plausibles (`MAX_SCORE = 1.000.000`, `MAX_LENGTH = 100.000`, `MAX_KILLS = 10.000`, duración máxima 2h). Es un anti-cheat básico — no impide cheating con un cliente determinado, pero corta el grueso de los scripts triviales.
- **Validación de nicknames con regex estricta** (`/^[a-zA-Z0-9_\- ]{2,20}$/`). Sin emojis, sin caracteres invisibles, sin nicknames de 1 letra ni de 200.
- **Helmet por default.** Headers seguros (CSP, X-Frame-Options, etc.) sin que tenga que pensar en cada uno.
- **`trust proxy = 1`.** Railway corre detrás de un reverse proxy. Sin esto, `req.ip` siempre sería el del proxy y el rate limiter no funcionaría por usuario real.
- **Viewport culling en el render.** El motor solo dibuja lo que cae dentro del viewport del jugador. Con 10 serpientes (1 humano + 9 bots) en un mapa grande, esto baja el coste de render dramáticamente.
- **Canvas único, sin escenas.** No hay un sistema de escenas (menu / juego / fin). El menú es HTML, el juego es el canvas; cuando el jugador muere, el juego avisa al UI y este muestra el modal. Mantiene la complejidad acotada.

---

## Controles

| Acción | Input |
|---|---|
| Mover serpiente | Mover el mouse hacia la dirección deseada |
| Boost | Click izquierdo sostenido / tocar y mantener |
| Pausa (debug) | `Esc` |

En mobile aparece un joystick virtual; mantener presionado fuera del joystick activa el boost.

---

## Autor

**Santino Cerezo** — [GitHub](https://github.com/santinocerezo) · santinocerezo11@gmail.com
