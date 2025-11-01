# n8n Gmail Automatization

Automatización de procesamiento de correos de Gmail con n8n y autenticación OAuth.

## 📋 Prerrequisitos

- Node.js (v18 o superior)
- Docker y Docker Compose
- Cuenta de Google con Gmail API habilitada
- ngrok u otro túnel público para webhooks (opcional, para producción)

## 🚀 Instalación y Configuración

### 1. Clonar el repositorio

```bash
git clone https://github.com/FrankyTheCatt/cucu.git
cd cucu
```

### 2. Configurar Docker Compose (n8n)

Crea un archivo `.env` en la raíz del proyecto:

```bash
cp .env.example .env
```

Edita `.env` con tus credenciales:

```env
POSTGRES_USER=n8n
POSTGRES_PASSWORD=tu_password_seguro
POSTGRES_DB=n8n
POSTGRES_NON_ROOT_USER=owo
POSTGRES_NON_ROOT_PASSWORD=tu_password_seguro

# Configuración de n8n (si usas túnel público)
WEBHOOK_URL=https://tu-dominio-ngrok.ngrok.app/
N8N_HOST=tu-dominio-ngrok.ngrok.app
N8N_PROTOCOL=https
N8N_EDITOR_BASE_URL=https://tu-dominio-ngrok.ngrok.app/
GENERIC_TIMEZONE=America/Bogota
```

### 3. Levantar n8n con Docker Compose

```bash
docker-compose up -d
```

Verifica que ambos servicios estén corriendo:

```bash
docker-compose ps
```

Accede a n8n en `http://localhost:5678`

### 4. Configurar la aplicación Node.js

Navega a la carpeta `Pag`:

```bash
cd Pag
```

Instala las dependencias:

```bash
npm install
```

Crea el archivo `.env`:

```bash
cp .env.example .env
```

Edita `Pag/.env` con tus credenciales:

```env
PORT=3000

# Credenciales OAuth de Google (Gmail)
GOOGLE_CLIENT_ID=tu_client_id_de_google
GOOGLE_CLIENT_SECRET=tu_client_secret_de_google
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback

# API Key para proteger el endpoint de tokens (cambia esto)
INTERNAL_API_KEY=tu_clave_secreta_larga_y_segura

# URL del webhook de n8n
N8N_WEBHOOK_URL=http://localhost:5678/webhook/finanzas-procesar
```

### 5. Configurar Google OAuth

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Crea un nuevo proyecto o selecciona uno existente
3. Habilita la **Gmail API**
4. Ve a **Credenciales** → **Crear credenciales** → **ID de cliente OAuth**
5. Tipo: **Aplicación web**
6. Agrega las URIs de redirección:
   - `http://localhost:3000/auth/google/callback`
   - (Si usas túnel): `https://tu-dominio.ngrok.app/auth/google/callback`
7. Copia el **Client ID** y **Client Secret** a tu `.env`

### 6. Crear el workflow en n8n

1. Accede a `http://localhost:5678`
2. Crea un nuevo workflow
3. Agrega un nodo **Webhook**:
   - Método: POST
   - Path: `finanzas-procesar`
   - Response: Last Node
4. Agrega un nodo **HTTP Request** para obtener el token:
   - Método: GET
   - URL: `http://host.docker.internal:3000/tokens/{{$json.userId}}`
   - Headers:
     - `x-api-key`: Tu `INTERNAL_API_KEY`
   - Nombre: "Get Access Token"
5. Agrega un nodo **HTTP Request** para listar mensajes de Gmail:
   - Método: GET
   - URL: `https://gmail.googleapis.com/gmail/v1/users/me/messages`
   - Query Parameters:
     - `q`: `label:finanzas newer_than:7d`
     - `maxResults`: `{{$json.filtros.maxResults || 10}}`
   - Headers:
     - `Authorization`: `Bearer {{$node["Get Access Token"].json["accessToken"]}}`
   - Nombre: "List Messages"
6. Conecta los nodos: Webhook → Get Access Token → List Messages
7. Activa el workflow

## ▶️ Ejecutar la aplicación

En una terminal, desde la carpeta `Pag`:

```bash
npm start
```

O con recarga automática (requiere `nodemon`):

```bash
npm run dev
```

Abre tu navegador en `http://localhost:3000`

## 🔄 Flujo de uso

1. **Conectar Gmail**: Haz clic en "Conectar Gmail" y autoriza el acceso
2. **Procesar correos**: Ingresa el userId y la cantidad máxima de mensajes
3. **Ver resultados**: Los correos procesados se mostrarán en la pantalla

## 🔧 Estructura del proyecto

```
cucu/
├── Pag/                    # Aplicación Node.js
│   ├── src/
│   │   └── server.js       # Servidor Express con OAuth
│   ├── public/
│   │   └── index.html      # Interfaz de usuario
│   ├── package.json
│   └── .env               # Variables de entorno (NO subir a Git)
├── docker-compose.yml      # Configuración de n8n y Postgres
├── init-data.sh           # Script de inicialización de DB
└── .env                    # Variables de entorno Docker
```

## 🔐 Seguridad

- **NUNCA** subas archivos `.env` a Git
- Usa contraseñas seguras para Postgres
- Cambia el `INTERNAL_API_KEY` por una clave única
- En producción, usa HTTPS con un dominio válido
- Considera usar variables de entorno del sistema en lugar de archivos `.env`

## 🐛 Troubleshooting

### Error: "ECONNREFUSED" desde n8n

Asegúrate de usar `http://host.docker.internal:3000` en lugar de `localhost` para conectar desde Docker a tu máquina host.

### Error: "Unauthorized" al obtener tokens

Verifica que el header `x-api-key` coincida exactamente con `INTERNAL_API_KEY`.

### Error: "No refresh token"

El usuario debe completar el flujo de OAuth. Asegúrate de no omitir el paso de autorización.

### n8n no se conecta a Postgres

Verifica que las credenciales en `.env` coincidan en ambos servicios de docker-compose.

## 📝 Desarrollo

### Modo desarrollo con nodemon

```bash
cd Pag
npm run dev
```

### Ver logs de Docker

```bash
docker-compose logs -f n8n
docker-compose logs -f postgres
```

### Reiniciar servicios

```bash
docker-compose restart n8n
```

### Detener todo

```bash
docker-compose down
```

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia MIT.

## 👤 Autor

FrankyTheCatt

## 🙏 Agradecimientos

- n8n por la plataforma de automatización
- Google por la Gmail API

