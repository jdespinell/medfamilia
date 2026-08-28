# Project: MedFamilia SaaS Platform - Security Remediation, Hardening & Verification

## Architecture

MedFamilia is a multi-tenant family medical management platform consisting of:
- **Backend (`server/`)**: Node.js + Express + TypeScript service using SQLite (`better-sqlite3` in WAL mode) and PostgreSQL compatibility layer. Integrates Google Gemini AI (`@google/genai`), WhatsApp Evolution API, Google Calendar OAuth2 (`googleapis`), and Web Push notifications (`web-push`).
- **Frontend (`client/`)**: React + TypeScript + Vite + Tailwind CSS single page application with PWA/service worker capabilities.
- **Security & Authorization Model**: Multi-tenant isolation by `family_id`. Roles: Family Users and Superadmin (`/admin`).

```
                                  ┌──────────────────────────┐
                                  │      React Frontend      │
                                  │   (Client SPA / PWA)     │
                                  └─────────────┬────────────┘
                                                │ HTTPS / REST (JWT)
                                                ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Express Application Gateway (server/src/index.ts)                                      │
│  - Helmet (Strict CSP, Security Headers)                                               │
│  - Strict CORS Controls (Origin Whitelist, Credentials)                                │
│  - Rate Limiters (General, Auth, AI, Uploads)                                          │
│  - Authentication Middleware (JWT HS256 / Admin JWT)                                   │
├────────────────────────────────┬────────────────────────────────┬──────────────────────┤
│ Core Modules                   │ File & Upload Security         │ External Integrations│
│  - Auth (OTP / Passwords)      │  - Multer Magic Bytes Filter   │  - WhatsApp Webhook  │
│  - Patients CRUD               │  - Staging Upload Token Auth   │  - Evolution API     │
│  - Appointments & Reminders    │  - Tenant-isolated File Server │  - Google OAuth2 Sync│
│  - Medical Orders (Órdenes)    │  - Temp File Auto-Cleanup      │  - Web Push (VAPID)  │
│  - Exam Results & Summaries    │                                │  - Gemini 1.5 OCR/AI │
│  - Admin SaaS Portal           │                                │                      │
└────────────────────────────────┴────────────────────────────────┴──────────────────────┘
                                                │
                                                ▼
                             ┌─────────────────────────────────────┐
                             │  Database: SQLite (WAL) / Postgres  │
                             │  Encrypted Sensitive Fields (AES-GCM│
                             └─────────────────────────────────────┘
```

---

## Feature Inventory

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Family Registration & OTP Verification | WhatsApp OTP generation, validation, and family tenant creation | M1, M4 | Survey / `auth.ts` |
| 2 | Family & Admin Authentication | JWT generation, verification, password hashing, constant-time comparison | M1 | Survey / `auth.ts`, `admin.ts` |
| 3 | Rate Limiting & DoS Protection | IP and route rate limiting across public, auth, admin, and AI endpoints | M1 | Survey / `index.ts` |
| 4 | Security Headers & CORS Policy | Helmet CSP configuration, strict CORS whitelist without credential wildcard | M1, M4 | Survey / `index.ts` |
| 5 | Secure File Serving & IDOR Prevention | Strict multi-tenant file ownership verification without temporal grace windows | M2 | Survey / `index.ts`, `medicalOrders.ts` |
| 6 | File Upload Validation & Temp Cleanup | Magic-byte file validation, upload staging tokens, orphaned file lifecycle cleanup | M2 | Survey / `upload.ts`, `appointments.ts`, `exams.ts`, `medicalOrders.ts` |
| 7 | WhatsApp Evolution API Webhook | Authenticated webhook receiving events, bot command routing, message batching | M3 | Survey / `whatsappWebhook.ts`, `whatsapp.ts` |
| 8 | WhatsApp Media & Privacy Isolation | Multi-tenant scoped media sharing (`send_exam_file`), admin routes moved to Bearer auth | M3 | Survey / `whatsappWebhook.ts` |
| 9 | Google Calendar OAuth Sync | Cryptographically signed HMAC/JWT state tokens for CSRF protection; AES-256 token encryption | M3 | Survey / `googleCalendar.ts`, `calendar.ts` |
| 10 | VAPID Web Push Notifications | Multi-tenant isolated browser subscriptions and push delivery | M3 | Survey / `pushNotifications.ts`, `push.ts` |
| 11 | Gemini OCR & AI Prompt Isolation | Delimiter-separated prompt construction, system instruction boundaries, memory-efficient buffering | M3 | Survey / `gemini.ts` |
| 12 | Patient Management (CRUD) | Family patient profiles, avatar colors, Google sync indicators | M4 | Survey / `patients.ts` |
| 13 | Appointment Lifecycle & Scheduling | Create/update/delete appointments, AI text parsing, calendar event sync, push triggers | M4 | Survey / `appointments.ts` |
| 14 | Medical Orders & AI Batch Extraction | Draft extraction, interactive review modal, status transitions (pendiente/agendada/completada) | M4 | Survey / `medicalOrders.ts` |
| 15 | Exam Results & Medical Summaries | Medical document upload, patient assignment, plain-language AI summary | M4 | Survey / `exams.ts` |
| 16 | Medical Specialties Catalog | Global defaults and family custom specialties management | M4 | Survey / `specialties.ts` |
| 17 | Superadmin SaaS Management Console | Family plan toggling (gratuito/pago), AI daily quota management, metrics dashboard | M1, M4 | Survey / `admin.ts` |
| 18 | Automated Security Test Suite & Hardening | Opaque-box E2E security verification, regression suite, adversarial testing | M5, E2E | ORIGINAL_REQUEST R3 |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Authentication, Secret Hardening & Rate Limiting | Eliminate default secrets in configs/compose; fail on weak/default secrets; hash & time-constant admin login; mount `authRateLimiter` on `/api/admin`; use secure OTP randomness & attempt throttling; remove JWT in query strings; configure strict Helmet CSP & CORS | None | DONE |
| M2 | Multi-Tenant Authorization, File Storage & Upload Security | Eliminate `isRecent` temporal IDOR bypass in `handleSecureFileServe`; implement upload staging validation on `/confirm-batch`; add magic-byte file signature validation; add temporary file cleanup in catch blocks and background pruner | M1 | DONE |
| M3 | Integrations Hardening (WhatsApp, Google OAuth, Push & Gemini AI) | Authenticate WhatsApp webhook with shared secret; secure `send_exam_file` with tenant scoping; migrate WhatsApp admin endpoints to Bearer auth; add signed HMAC CSRF state to Google OAuth; encrypt Google refresh tokens with AES-256-GCM; fix push subscription isolation; isolate Gemini AI prompts | M1, M2 | DONE |
| M4 | Input Validation & Schema Hardening Across All Routes | Implement comprehensive declarative validation (Zod/schemas) for all 26 endpoints covering request bodies, params, and queries (dates, UUIDs, enums, string bounds); ensure UI compatibility; harden CORS origin checks | M1, M2, M3 | IN_PROGRESS |
| M5 | E2E Security Verification & Adversarial Coverage Hardening | Run 100% of E2E Security Test Suite (Tiers 1-4); perform white-box adversarial testing (Tier 5); conduct Forensic Integrity Audit; pass all gates | M1, M2, M3, M4, E2E-TESTS | PLANNED |

---

## Interface Contracts

### Backend ↔ Frontend Auth Contract
- Headers: `Authorization: Bearer <token>` required for all `/api/*` private routes (except public `/api/auth/*` login/register/otp and `/api/admin/login`).
- File Downloads: Handled via authenticated API fetch / blob streaming (`openProtectedFile` / `fetchFileBlob`) without query parameter token leaks.
- Patients API: Returns `is_google_connected: boolean` instead of raw `google_refresh_token`.

### Backend ↔ Evolution API (WhatsApp)
- Webhook Header: Incoming requests to `POST /api/whatsapp/webhook` must include `x-webhook-token: <WEBHOOK_SECRET>` or `apikey: <EVOLUTION_API_KEY>`.
- Media Exfiltration Prevention: `send_exam_file` verifies `SELECT id FROM exam_results/medical_orders WHERE family_id = ? AND file_url LIKE ?`.

### Backend ↔ Google Calendar OAuth2
- State Generation: `jwt.sign({ patientId, familyId, nonce, exp }, OAUTH_STATE_SECRET)` passed in Google consent URL.
- State Verification: `GET /api/calendar/callback` verifies JWT state and ensures `patient.family_id === state.familyId`.
- Token Storage: `google_refresh_token` encrypted at rest via AES-256-GCM (`iv:authTag:ciphertext`).

---

## Code Layout

- Backend Root: `/Users/julian/Documents/programacitas/server`
  - Entrypoint: `server/src/index.ts`
  - Database & Schemas: `server/src/database/` (`db.ts`, `schema.sql`)
  - Middleware: `server/src/middleware/` (`auth.ts`, `upload.ts`, `rateLimiter.ts`, `validation.ts`)
  - Routes: `server/src/routes/` (`auth.ts`, `admin.ts`, `patients.ts`, `appointments.ts`, `exams.ts`, `medicalOrders.ts`, `specialties.ts`, `whatsappNumbers.ts`, `calendar.ts`, `push.ts`, `whatsappWebhook.ts`)
  - Services: `server/src/services/` (`gemini.ts`, `whatsapp.ts`, `googleCalendar.ts`, `pushNotifications.ts`, `encryption.ts`)
  - Scripts / Migrations: `server/src/scripts/`
- Frontend Root: `/Users/julian/Documents/programacitas/client`
  - API Client: `client/src/api.ts`
  - Pages: `client/src/pages/` (`Login.tsx`, `Dashboard.tsx`, `AdminPage.tsx`)
  - Components: `client/src/components/` (`AppointmentModal.tsx`, `AppointmentDetailModal.tsx`, `ExamModal.tsx`, `OrderConfirmationModal.tsx`, `PatientsModal.tsx`, `WhatsAppNumbersModal.tsx`)
- Security Tests: `/Users/julian/Documents/programacitas/tests/security/`
