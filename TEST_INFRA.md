# TEST_INFRA.md — MedFamilia Test Infrastructure & Methodology Specification

## 1. Overview & Architecture

MedFamilia is a multi-tenant family medical management SaaS platform (Node.js/Express + SQLite/Postgres backend, React frontend). This document defines the automated, opaque-box, security and functional testing methodology across **4 systematic tiers**.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        MedFamilia Automated Test Harness                               │
├────────────────────────────────┬────────────────────────────────┬──────────────────────┤
│ Tier 1: Feature Coverage       │ Tier 2: Boundary & Fuzzing     │ Tier 3: Security &   │
│  - F01: Register & OTP         │  - Malformed/Empty Payloads    │         Combinations │
│  - F02: Auth & Session JWTs    │  - Extreme Payload Bounds      │  - Cross-Tenant IDOR │
│  - F03: Rate Limiting Headers  │  - SQLi / XSS Payloads         │  - Webhook Forgery   │
│  - F04: Security & CORS Headers│  - Expired / Forged JWTs       │  - Admin Brute-Force │
│  - F05: Secure File Serving    │  - Invalid OTP & Throttling    │  - OAuth CSRF State  │
│  - F06: Upload File Lifecycle  │  - MIME & Magic-Byte Filter    │  - URL JWT Rejection │
│  - F07: WhatsApp Webhook       │  - Type & Date Boundary Cases  │  - CORS / CSP Checks │
│  - F08: WhatsApp Media Scoping │                                │  - Batch File Hijack │
│  - F09: Google Calendar OAuth  ├────────────────────────────────┴──────────────────────┤
│  - F10: Web Push Subscriptions │ Tier 4: Real-World Scenarios                          │
│  - F11: Gemini AI Integration  │  - Multi-Tenant Family Isolation Lifecycle            │
│  - F12: Patient Management     │  - Medical Order Draft, Review & Appointment Linking  │
│  - F13: Appointments Flow      │  - Appointment Scheduling & Notification Flow         │
│  - F14: Medical Orders Flow    │  - Superadmin Plan Tier & Quota Enforcement Workflow  │
│  - F15: Exam Results Flow      │                                                       │
│  - F16: Medical Specialties    │                                                       │
│  - F17: Superadmin SaaS Portal │                                                       │
│  - F18: Test Suite Automation  │                                                       │
└────────────────────────────────┴───────────────────────────────────────────────────────┘
```

---

## 2. Systematic 4-Tier Test Matrix

### Tier 1: Feature Coverage (Happy Path Verification for 18 Features)

| Feature ID | Feature Name | Target Endpoints / Components | Expected Behavior / Assertions |
| :--- | :--- | :--- | :--- |
| **F01** | Family Registration & OTP Verification | `POST /api/auth/send-whatsapp-otp`<br>`POST /api/auth/register` | Sends 6-digit OTP code to WhatsApp, validates code against DB, registers family, creates initial default patients ('Papá', 'Mamá'), returns JWT session token (HTTP 200). |
| **F02** | Family & Admin Authentication | `POST /api/auth/login`<br>`GET /api/auth/me`<br>`POST /api/admin/login`<br>`GET /api/admin/me` | Validates family code & bcrypt password hash, returns JWT. Validates admin credentials, returns admin JWT. `/me` endpoints return authenticated session profile (HTTP 200). |
| **F03** | Rate Limiting & DoS Protection | `generalRateLimiter`<br>`authRateLimiter`<br>`aiRateLimiter` | Endpoints return standard RateLimit headers (`ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`). |
| **F04** | Security Headers & CORS Policy | Express Gateway / Helmet | HTTP responses contain security headers (`X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy`). CORS responds with appropriate allowed origin headers. |
| **F05** | Secure File Serving | `GET /api/uploads/:filename`<br>`GET /uploads/:filename` | Authenticated family can successfully download/stream their own uploaded exam results, medical orders, and appointment photos (HTTP 200). |
| **F06** | File Upload Validation & Lifecycle | `POST /api/exams/upload`<br>`POST /api/medical-orders` | Accepts valid image (`image/jpeg`, `image/png`) and PDF documents (`application/pdf`) up to 15MB. Persists metadata and returns file URL (HTTP 200). |
| **F07** | WhatsApp Evolution API Webhook | `POST /api/whatsapp/webhook` | Receives incoming WhatsApp messages for registered numbers, routes commands, updates AI usage stats (HTTP 200). |
| **F08** | WhatsApp Media & Status Routes | `GET /api/whatsapp/status`<br>`GET /api/whatsapp-numbers` | Returns WhatsApp service status with valid key, lists authorized WhatsApp numbers for authenticated family (HTTP 200). |
| **F09** | Google Calendar OAuth Sync | `GET /api/calendar/auth-url/:patientId`<br>`POST /api/calendar/sync-patient/:patientId` | Generates OAuth consent URL for family patient with signed state; syncs appointments to connected calendar (HTTP 200). |
| **F10** | VAPID Web Push Notifications | `GET /api/push/vapid-key`<br>`POST /api/push/subscribe` | Retrieves VAPID public key and stores browser push subscription linked to family ID (HTTP 200). |
| **F11** | Gemini OCR & AI Processing | `POST /api/appointments/ai-text` | Parses unstructured medical appointment text into structured JSON with date, specialty, specialist, instructions (HTTP 200). |
| **F12** | Patient Management (CRUD) | `GET /api/patients`<br>`POST /api/patients`<br>`PUT /api/patients/:id`<br>`DELETE /api/patients/:id` | Lists family patients, creates new patient with custom color/avatar, updates profile details, deletes patient record (HTTP 200). |
| **F13** | Appointment Lifecycle & Scheduling | `GET /api/appointments`<br>`POST /api/appointments`<br>`PUT /api/appointments/:id`<br>`DELETE /api/appointments/:id` | Creates appointment with date/time/specialist, lists upcoming appointments, updates status (pendiente -> completada), deletes appointment (HTTP 200). |
| **F14** | Medical Orders & AI Batch Extraction | `GET /api/medical-orders`<br>`GET /api/medical-orders/pending`<br>`POST /api/medical-orders/confirm-batch`<br>`PUT /api/medical-orders/:id`<br>`DELETE /api/medical-orders/:id` | Lists orders, filters pending orders, confirms draft batches, updates status (pendiente -> agendada -> completada), deletes order (HTTP 200). |
| **F15** | Exam Results & Summaries | `GET /api/exams`<br>`POST /api/exams/upload`<br>`DELETE /api/exams/:id` | Uploads medical lab result, links to patient/appointment, retrieves AI summary, deletes exam and unlinks physical file (HTTP 200). |
| **F16** | Medical Specialties Catalog | `GET /api/specialties`<br>`POST /api/specialties` | Returns 15 default specialties + family custom specialties; adds new custom specialty (HTTP 200). |
| **F17** | Superadmin SaaS Console | `GET /api/admin/families`<br>`PATCH /api/admin/families/:id/plan`<br>`POST /api/admin/families/:id/reset-usage` | Lists all tenants with AI usage metrics, upgrades family plan ('gratuito' -> 'pago'), updates daily AI limits, resets daily usage counter (HTTP 200). |
| **F18** | Automated Security Test Suite | `tests/security/run_all_tests.ts` | Test runner executes all 4 tiers, asserts security invariants, outputs structured report and exit code (0 = success). |

---

### Tier 2: Boundary & Corner Cases

| Case ID | Category | Scenario & Payload | Expected Result |
| :--- | :--- | :--- | :--- |
| **T2.1** | Empty & Missing Fields | POST to `/api/auth/register`, `/api/patients`, `/api/appointments`, `/api/medical-orders`, `/api/specialties` with `{}` or empty strings | Returns HTTP 400 Bad Request with clear validation message |
| **T2.2** | Extreme String Lengths | Patient name with 10,000 characters, specialty name > 100 characters, giant appointment titles | Returns HTTP 400 or truncates safely without DB/buffer crash |
| **T2.3** | SQL Injection Payloads | Payloads containing `' OR 1=1 --`, `'; DROP TABLE families; --`, `UNION SELECT * FROM sqlite_master` in search queries, family codes, and logins | Safely parameterized; SQL injection completely neutralized (HTTP 400/401/404, DB intact) |
| **T2.4** | XSS Payloads | Patient names, appointment notes, or specialties containing `<script>alert('XSS')</script>`, `<img src=x onerror=alert(1)>` | Escaped or safely stored as text without script execution or response header injection |
| **T2.5** | Malformed & Expired JWTs | Expired JWT token, signature signed with wrong secret key, corrupted base64 header/payload, garbage strings | Returns HTTP 401 Unauthorized (`Sesión expirada o inválida`) |
| **T2.6** | OTP Edge Cases | Incorrect OTP code (`000000`), expired OTP (>10 mins), duplicate phone registration attempt, phone number with invalid length (<10 digits) | Returns HTTP 400 Bad Request |
| **T2.7** | File Upload Boundaries | 0-byte empty file upload, file exceeding 15MB limit, non-whitelisted extension/mime (`.exe`, `.sh`, `text/html`) | Returns HTTP 400 Bad Request with upload rejection |
| **T2.8** | Invalid Route Parameters | Non-existent UUIDs, negative IDs, malformed URL parameters in `PUT /api/patients/:id`, `DELETE /api/appointments/:id` | Returns HTTP 404 Not Found without unhandled exceptions |

---

### Tier 3: Cross-Feature & Security Combinations

| Case ID | Security Vulnerability | Attack Vector / Combination | Hardened Requirement |
| :--- | :--- | :--- | :--- |
| **T3.1** | **Cross-Tenant File IDOR (`handleSecureFileServe`)** | Family B requests `GET /api/uploads/<family_a_filename>` for a file uploaded by Family A (both files created <1h ago and older files) | **MUST return HTTP 403 Forbidden**. Zero temporal grace window bypass allowed. |
| **T3.2** | **Cross-Tenant Entity IDOR** | Family B attempts `GET /api/patients`, `PUT /api/appointments/:familyA_appt_id`, `DELETE /api/exams/:familyA_exam_id`, `DELETE /api/medical-orders/:familyA_order_id` | **MUST return HTTP 403 or 404**. No cross-tenant modification or disclosure. |
| **T3.3** | **Unauthenticated WhatsApp Webhook Injection** | Attacker sends `POST /api/whatsapp/webhook` with forged WhatsApp messages without `x-webhook-token` or `apikey` header | **MUST return HTTP 401 Unauthorized**. Webhook must strictly require authentication secret. |
| **T3.4** | **Admin Login Brute-Force & Route Protection** | Attacker sends 20+ rapid `POST /api/admin/login` requests; unauthenticated user requests `GET /api/admin/families` | **MUST trigger HTTP 429 Too Many Requests** via auth rate limiter. Unauthenticated calls return HTTP 401/403. |
| **T3.5** | **Google Calendar OAuth CSRF State Forgery** | Attacker sends `GET /api/calendar/callback?code=fake&state=<patientId>` with raw/unverified state or mismatched HMAC | **MUST return HTTP 400/403**. OAuth state must be cryptographically signed with HMAC/JWT nonce. |
| **T3.6** | **JWT URL Query Parameter Token Rejection** | Attacker calls `/api/uploads/:filename?token=<jwt>` or `/api/patients?token=<jwt>` | **MUST return HTTP 401 Unauthorized** (token in URL query param rejected; Bearer header or single-use download token required). |
| **T3.7** | **CORS & CSP Configuration Hardening** | Requests sent with unauthorized cross-origin origins or checking Helmet response headers | **MUST NOT allow wildcard `*` with credentials**. Strict CSP and security headers must be active. |
| **T3.8** | **File Ownership Hijacking via `/confirm-batch`** | Family B submits `POST /api/medical-orders/confirm-batch` containing `file_url` belonging to Family A | **MUST return HTTP 400/403**. Cannot claim ownership of files uploaded by other tenants. |

---

### Tier 4: Real-World Application Scenarios

| Scenario ID | Name | Multi-Step End-to-End Workflow | Success Invariants |
| :--- | :--- | :--- | :--- |
| **T4.1** | **Multi-Tenant Complete Family & Patient Lifecycle** | 1. Register Family Alpha (phone 3001111111) & Family Beta (phone 3002222222).<br>2. Alpha creates Patient "Carlos" (color #3b82f6) and Patient "Sofia" (#ec4899).<br>3. Beta creates Patient "Mateo" (#10b981).<br>4. Alpha creates Appointment for Carlos.<br>5. Beta lists patients and appointments -> Receives only Mateo, 0 appointments from Alpha.<br>6. Alpha updates Carlos profile and deletes Sofia.<br>7. Verify Beta data completely untouched. | Complete tenant isolation; cascade deletion of patient sub-resources; zero data leakage. |
| **T4.2** | **Medical Order Draft, Review, Batch Confirmation & Appointment Workflow** | 1. Family Alpha uploads lab order document -> creates draft order.<br>2. Alpha confirms batch order via `POST /confirm-batch`.<br>3. Order appears in `/api/medical-orders/pending`.<br>4. Alpha creates scheduled appointment for specialist consultation.<br>5. Alpha links medical order to scheduled appointment (`status = 'agendada'`).<br>6. Alpha uploads completed exam result (`status = 'completada'`). | Full status transition lifecycle (`pendiente` -> `agendada` -> `completada`); order-to-appointment-to-exam relational integrity. |
| **T4.3** | **Appointment Scheduling & Web Push Notification Flow** | 1. Family Alpha registers browser Web Push subscription (`POST /api/push/subscribe`).<br>2. Alpha creates appointment with fasting requirement and prep instructions.<br>3. Alpha updates doctor notes and specialist.<br>4. Verify appointment query returns attached orders, results, and notes. | Real-world scheduling consistency; push notification trigger dispatch without error. |
| **T4.4** | **Superadmin SaaS Plan Quota Enforcement & Management** | 1. Superadmin logs in via `/api/admin/login`.<br>2. Superadmin inspects Family Alpha (plan: 'gratuito', limit: 5 queries/day).<br>3. Superadmin upgrades Alpha to plan 'pago' with 50 daily queries.<br>4. Usage counter simulated for Alpha -> Admin resets daily usage counter.<br>5. Family Alpha verifies upgraded plan and query capacity. | Administrative control across multi-tenant tiers; accurate quota enforcement. |

---

## 3. Test Execution Harness Design

The test suite runs against an isolated, in-memory or dedicated test database (`tests/data/test_medfamilia.db`) with test upload directories (`tests/uploads/`).

### Test Execution Commands:
- **Run Full Suite**: `npx tsx tests/security/run_all_tests.ts`
- **Run Tier 1 (Feature Coverage)**: `npx tsx tests/security/tier1_feature_coverage.test.ts`
- **Run Tier 2 (Boundary & Corner)**: `npx tsx tests/security/tier2_boundary_corner.test.ts`
- **Run Tier 3 (Security & Combinations)**: `npx tsx tests/security/tier3_security_combos.test.ts`
- **Run Tier 4 (Real-World Scenarios)**: `npx tsx tests/security/tier4_real_world_scenarios.test.ts`

---

## 4. Pass / Fail & Quality Gates Criteria

1. **Tier 1 (Feature Coverage)**: 100% pass rate for all core business functionalities.
2. **Tier 2 (Boundary & Fuzzing)**: 100% pass rate for all invalid payloads, string limits, and input sanitization.
3. **Tier 3 (Security Combinations)**: 100% pass rate for all authorization barriers, IDOR prevention, webhook authentication, and secret hardening.
4. **Tier 4 (Real-World Scenarios)**: 100% pass rate across end-to-end multi-tenant user journeys.
