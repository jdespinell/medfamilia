# 🩺 MedFamilia - Organizador de Citas Médicas y Exámenes

**MedFamilia** es una aplicación web enfocada en dispositivos móviles (PWA/Mobile-First) diseñada para organizar, gestionar y sincronizar las citas médicas, exámenes y resultados de los padres y miembros de la familia.

Incluye integración con la **API de Gemini** para lectura OCR de citas impresas/manuscritas y resumen de exámenes médicos en lenguaje comprensible, además de sincronización automática con **Google Calendar** y **Notificaciones Push**.

![MedFamilia App](client/public/logo.svg)

---

## 🌟 Características Principales

- 🔐 **Multi-Familia y Seguridad**: Acceso mediante Código de Familia y Contraseña compartida. Permite gestionar de forma aislada múltiples grupos familiares.
- 👨‍👩‍👧‍👦 **Gestión de Pacientes**: Creación de perfiles (Mamá, Papá, etc.) con códigos de color visuales para diferenciar citas rápidamente.
- 📷 **Extracción por Foto / Texto con Gemini IA**:
  - Lee boletas/órdenes médicas por foto u orden de texto e identifica la fecha, especialidad, médico, lugar y si requiere ayunas.
  - Modal de verificación previa antes de guardar.
- 📄 **Resumen Inteligible de Exámenes (Gemini IA)**: Subida de resultados en PDF o foto; la IA genera una explicación clara y amigable sin jerga médica.
- 📅 **Google Calendar Auto-Sync**: Sincronización automática de citas creadas/editadas con la cuenta de Google Calendar del paciente.
- 📱 **Mobile-First & PWA**: Se puede agregar como aplicación nativa en la pantalla de inicio del celular.
- 💬 **Compartir por WhatsApp**: Generador de resumen semanal formateado para enviar por WhatsApp a los padres o cuidadores.
- 🔔 **Notificaciones Push**: Recordatorios automáticos directo al celular (VAPID / Service Worker).

---

## 🚀 Despliegue con Docker Compose (Ubuntu Server)

1. Clonar este repositorio en tu servidor:
   ```bash
   git clone https://github.com/tu-usuario/medfamilia.git
   cd medfamilia
   ```

2. Crear y editar el archivo de configuración `.env`:
   ```bash
   cp .env.example .env
   nano .env
   ```

   Variables clave:
   - `GEMINI_API_KEY`: Tu API Key de Google AI Studio.
   - `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`: Credenciales OAuth de Google Cloud.
   - `JWT_SECRET`: Clave secreta para la sesión.

3. Iniciar el servicio en segundo plano:
   ```bash
   docker compose up -d --build
   ```

4. Abre en tu navegador o celular: `http://IP_DE_TU_SERVIDOR:3000`

---

## 🛠️ Desarrollo Local

```bash
# Servidor Backend
cd server
npm install
npm run dev

# Cliente Frontend (en otra terminal)
cd client
npm install
npm run dev
```

---

## 📜 Licencia

MIT License © 2026 MedFamilia
