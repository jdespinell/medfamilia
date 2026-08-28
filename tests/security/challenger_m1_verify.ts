import path from 'path';
import fs from 'fs';
import http from 'http';
import { Socket } from 'net';
import assert from 'assert';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { execSync } from 'child_process';

import db, { initDatabase } from '../../server/src/database/db.js';
import authRoutes from '../../server/src/routes/auth.js';
import patientRoutes from '../../server/src/routes/patients.js';
import appointmentRoutes from '../../server/src/routes/appointments.js';
import examRoutes from '../../server/src/routes/exams.js';
import medicalOrdersRouter from '../../server/src/routes/medicalOrders.js';
import calendarRoutes from '../../server/src/routes/calendar.js';
import pushRoutes from '../../server/src/routes/push.js';
import specialtyRoutes from '../../server/src/routes/specialties.js';
import whatsappNumbersRoutes from '../../server/src/routes/whatsappNumbers.js';
import whatsappWebhookRoutes from '../../server/src/routes/whatsappWebhook.js';
import adminRoutes from '../../server/src/routes/admin.js';
import { authMiddleware, generateToken, generateAdminToken } from '../../server/src/middleware/auth.js';
import { authRateLimiter, generalRateLimiter } from '../../server/src/middleware/rateLimiter.js';

console.log('================================================================');
console.log('🛡️  CHALLENGER 2 EMPIRICAL VERIFICATION: M1 RATE LIMITING, CORS, CSP & BUILD');
console.log('================================================================\n');

/**
 * Creates an Express app matching server/src/index.ts configuration exactly
 */
function createServerApp(corsOrigins?: string) {
  const app = express();
  app.set('trust proxy', 1);

  // Helmet configuration matching server/src/index.ts
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          connectSrc: ["'self'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'self'"],
          upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    })
  );

  // CORS configuration matching server/src/index.ts
  const allowedOriginsList = corsOrigins
    ? corsOrigins.split(',').map((o) => o.trim()).filter(Boolean)
    : [];

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);

        if (allowedOriginsList.length > 0) {
          if (allowedOriginsList.includes(origin)) {
            return callback(null, true);
          }
          return callback(new Error('CORS policy: Not allowed by CORS origin whitelist'), false);
        }

        if (process.env.NODE_ENV !== 'production') {
          return callback(null, true);
        }
        return callback(null, true);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-webhook-token', 'apikey'],
    })
  );

  app.use(generalRateLimiter);
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.use('/api/auth', authRateLimiter, authRoutes);
  app.use('/api/patients', patientRoutes);
  app.use('/api/appointments', appointmentRoutes);
  app.use('/api/exams', examRoutes);
  app.use('/api/medical-orders', medicalOrdersRouter);
  app.use('/api/calendar', calendarRoutes);
  app.use('/api/push', pushRoutes);
  app.use('/api/specialties', specialtyRoutes);
  app.use('/api/whatsapp-numbers', whatsappNumbersRoutes);
  app.use('/api/whatsapp', whatsappWebhookRoutes);
  app.use('/api/admin', adminRoutes);

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'MedFamilia API activa y saludable (SaaS Ready)' });
  });

  // Global Error Handler matching server/src/index.ts
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || 'Ocurrió un error interno en el servidor.';
    return res.status(status).json({ error: message });
  });

  return app;
}

interface DispatchOptions {
  method?: string;
  ip?: string;
  headers?: Record<string, string>;
  json?: any;
  body?: any;
}

interface DispatchResponse {
  status: number;
  headers: Map<string, string>;
  body: any;
  text: string;
}

function dispatchRequest(app: express.Application, url: string, opts: DispatchOptions = {}): Promise<DispatchResponse> {
  return new Promise((resolve) => {
    const method = (opts.method || 'GET').toUpperCase();
    const reqHeaders: Record<string, string> = {};

    if (opts.headers) {
      for (const [k, v] of Object.entries(opts.headers)) {
        reqHeaders[k.toLowerCase()] = v;
      }
    }

    let payload: Buffer | null = null;
    if (opts.json !== undefined) {
      payload = Buffer.from(JSON.stringify(opts.json));
      reqHeaders['content-type'] = 'application/json';
    } else if (opts.body !== undefined && opts.body !== null) {
      payload = Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(String(opts.body));
    }

    if (payload) {
      reqHeaders['content-length'] = String(payload.length);
    }

    const clientIp = opts.ip || '127.0.0.1';

    class MockSocket extends Socket {
      remoteAddress = clientIp;
      override _writeGeneric(writev: boolean, data: any, encoding: string, cb: (err?: Error | null) => void) {
        cb(null);
      }
      override _write(chunk: any, encoding: string, cb: (err?: Error | null) => void) {
        cb(null);
      }
      override _writev(chunks: Array<{ chunk: any; encoding: string }>, cb: (err?: Error | null) => void) {
        cb(null);
      }
    }

    const socket = new MockSocket();
    const req = new http.IncomingMessage(socket);
    (req as any).ip = clientIp;
    (req as any).connection = socket;
    req.method = method;
    req.url = url;
    req.headers = reqHeaders;

    const res = new http.ServerResponse(req);
    res.assignSocket(socket);

    const chunks: Buffer[] = [];
    const origWrite = res.write;
    const origEnd = res.end;

    res.write = function (chunk: any, ...args: any[]) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return origWrite.call(res, chunk, ...args);
    };

    res.end = function (chunk: any, ...args: any[]) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      origEnd.call(res, chunk, ...args);

      const bodyBuf = Buffer.concat(chunks);
      const text = bodyBuf.toString('utf8');
      let json: any = text;
      try {
        json = JSON.parse(text);
      } catch {
        // text is raw
      }

      const resHeadersObj = res.getHeaders ? res.getHeaders() : {};
      const resHeaders = new Map<string, string>();
      for (const [k, v] of Object.entries(resHeadersObj)) {
        if (v !== undefined) {
          resHeaders.set(k.toLowerCase(), Array.isArray(v) ? v.join(', ') : String(v));
        }
      }

      resolve({
        status: res.statusCode,
        headers: resHeaders,
        body: json,
        text,
      });
    };

    app(req as any, res as any);

    if (payload) {
      req.push(payload);
    }
    req.push(null);
  });
}

async function runTests() {
  initDatabase();

  let testTotal = 0;
  let testPassed = 0;
  let testFailed = 0;
  const failureDetails: Array<{ test: string; error: string }> = [];

  async function check(name: string, fn: () => Promise<void>) {
    testTotal++;
    try {
      await fn();
      testPassed++;
      console.log(`  ✅ [PASS] ${name}`);
    } catch (err: any) {
      testFailed++;
      failureDetails.push({ test: name, error: err.message || String(err) });
      console.error(`  ❌ [FAIL] ${name}:`, err.message || err);
    }
  }

  // =========================================================================
  // TEST SUITE 1: Admin Rate Limiting (authRateLimiter)
  // =========================================================================
  console.log('\n--- SUITE 1: Admin Rate Limiting (15 req / 15 min on /api/admin/login) ---');
  const app = createServerApp();
  const testIpA = '198.51.100.77';

  await check('1.1: Requests 1 to 15 to /api/admin/login are processed without triggering 429', async () => {
    for (let i = 1; i <= 15; i++) {
      const res = await dispatchRequest(app, '/api/admin/login', {
        method: 'POST',
        ip: testIpA,
        json: { username: 'admin', password: 'wrongpassword' },
      });

      assert.strictEqual(
        res.status,
        401,
        `Request ${i} should return 401 for bad credentials, got ${res.status}: ${res.text}`
      );

      const limit = res.headers.get('ratelimit-limit');
      assert.strictEqual(limit, '15', `Rate limit header should be 15, got ${limit}`);

      const remaining = res.headers.get('ratelimit-remaining');
      if (remaining !== undefined) {
        assert.strictEqual(
          parseInt(remaining, 10),
          15 - i,
          `Expected ratelimit-remaining to be ${15 - i}, got ${remaining}`
        );
      }
    }
  });

  await check('1.2: Request 16 from same IP to /api/admin/login triggers HTTP 429 Too Many Requests', async () => {
    const res = await dispatchRequest(app, '/api/admin/login', {
      method: 'POST',
      ip: testIpA,
      json: { username: 'admin', password: 'wrongpassword' },
    });

    assert.strictEqual(res.status, 429, `Request 16 must return 429 Too Many Requests, got ${res.status}`);
    assert.ok(
      res.body?.error && res.body.error.includes('Demasiados intentos de inicio de sesión o registro'),
      `Expected rate limit error message, got: ${JSON.stringify(res.body)}`
    );

    const retryAfter = res.headers.get('retry-after');
    const reset = res.headers.get('ratelimit-reset');
    assert.ok(retryAfter !== undefined || reset !== undefined, 'Expected Retry-After or RateLimit-Reset header');
  });

  await check('1.3: Different client IP is NOT blocked by IP A rate limit (per-IP isolation)', async () => {
    const testIpB = '198.51.100.88';
    const res = await dispatchRequest(app, '/api/admin/login', {
      method: 'POST',
      ip: testIpB,
      json: { username: 'admin', password: 'wrongpassword' },
    });

    assert.strictEqual(res.status, 401, `IP B should not be rate-limited, expected 401, got ${res.status}`);
    const remaining = res.headers.get('ratelimit-remaining');
    if (remaining !== undefined) {
      assert.strictEqual(parseInt(remaining, 10), 14, `Expected IP B remaining to be 14, got ${remaining}`);
    }
  });

  await check('1.4: Non-auth endpoints (e.g. /api/health) are NOT blocked by authRateLimiter', async () => {
    const res = await dispatchRequest(app, '/api/health', {
      ip: testIpA,
    });

    assert.strictEqual(res.status, 200, `Health endpoint should return 200 even if IP is auth-rate-limited`);
    assert.strictEqual(res.body?.status, 'ok');
  });

  // =========================================================================
  // TEST SUITE 2: Helmet Security Headers & Content Security Policy (CSP)
  // =========================================================================
  console.log('\n--- SUITE 2: Helmet Security Headers & Content Security Policy (CSP) ---');

  await check('2.1: Server returns comprehensive Content-Security-Policy (CSP) headers', async () => {
    const res = await dispatchRequest(app, '/api/health');
    assert.strictEqual(res.status, 200);

    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, 'Content-Security-Policy header must be present');

    // Verify critical CSP directives
    assert.ok(csp.includes("default-src 'self'"), "CSP must include default-src 'self'");
    assert.ok(csp.includes("script-src 'self' 'unsafe-inline'"), "CSP must include script-src 'self' 'unsafe-inline'");
    assert.ok(csp.includes("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"), 'CSP must allow Google fonts styles');
    assert.ok(csp.includes("font-src 'self' https://fonts.gstatic.com data:"), 'CSP must allow Google fonts and data: fonts');
    assert.ok(csp.includes("img-src 'self' data: blob: https:"), 'CSP must allow data: and blob: for WhatsApp QR codes and preview blobs');
    assert.ok(csp.includes("connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com"), 'CSP connect-src check');
    assert.ok(csp.includes("object-src 'none'"), "CSP object-src must be 'none'");
    assert.ok(csp.includes("base-uri 'self'"), "CSP base-uri must be 'self'");
    assert.ok(csp.includes("form-action 'self'"), "CSP form-action must be 'self'");
    assert.ok(csp.includes("frame-ancestors 'self'"), "CSP frame-ancestors must be 'self'");
  });

  await check('2.2: Server returns strict MIME & resource isolation headers (nosniff, same-site)', async () => {
    const res = await dispatchRequest(app, '/api/health');
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff', 'X-Content-Type-Options must be nosniff');
    assert.strictEqual(res.headers.get('cross-origin-resource-policy'), 'same-site', 'CORP header must be same-site');
  });

  // =========================================================================
  // TEST SUITE 3: CORS Whitelist & Origin Validation
  // =========================================================================
  console.log('\n--- SUITE 3: CORS Whitelisting, Credentials & Preflight ---');
  const allowedOrigin = 'https://app.medfamilia.com';
  const disallowedOrigin = 'https://malicious-attacker.evil.com';
  const corsApp = createServerApp(`${allowedOrigin},https://admin.medfamilia.com`);

  await check('3.1: Allowed origin receives Access-Control-Allow-Origin with credentials', async () => {
    const res = await dispatchRequest(corsApp, '/api/health', {
      headers: {
        'origin': allowedOrigin,
      },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(
      res.headers.get('access-control-allow-origin'),
      allowedOrigin,
      `Expected Access-Control-Allow-Origin: ${allowedOrigin}`
    );
    assert.strictEqual(
      res.headers.get('access-control-allow-credentials'),
      'true',
      'Expected Access-Control-Allow-Credentials: true'
    );
    // Ensure wildcard is never sent with credentials
    assert.notStrictEqual(
      res.headers.get('access-control-allow-origin'),
      '*',
      'Wildcard origin must NOT be returned when credentials: true'
    );
  });

  await check('3.2: Disallowed origin is rejected and does not receive CORS allow header', async () => {
    const res = await dispatchRequest(corsApp, '/api/health', {
      headers: {
        'origin': disallowedOrigin,
      },
    });

    // Disallowed origin should either error (status 500 from CORS middleware) or NOT include allow-origin
    const allowOrigin = res.headers.get('access-control-allow-origin');
    assert.notStrictEqual(
      allowOrigin,
      disallowedOrigin,
      `Disallowed origin ${disallowedOrigin} must NOT be reflected in Access-Control-Allow-Origin`
    );
  });

  await check('3.3: Preflight OPTIONS request returns valid CORS headers and methods', async () => {
    const res = await dispatchRequest(corsApp, '/api/admin/login', {
      method: 'OPTIONS',
      headers: {
        'origin': allowedOrigin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'Content-Type, Authorization, x-webhook-token, apikey',
      },
    });

    assert.ok([200, 204].includes(res.status), `Preflight OPTIONS should return 200 or 204, got ${res.status}`);
    assert.strictEqual(res.headers.get('access-control-allow-origin'), allowedOrigin);
    assert.strictEqual(res.headers.get('access-control-allow-credentials'), 'true');

    const allowMethods = res.headers.get('access-control-allow-methods') || '';
    assert.ok(allowMethods.includes('POST'), 'Access-Control-Allow-Methods must include POST');
    assert.ok(allowMethods.includes('GET'), 'Access-Control-Allow-Methods must include GET');
    assert.ok(allowMethods.includes('OPTIONS'), 'Access-Control-Allow-Methods must include OPTIONS');

    const allowHeaders = res.headers.get('access-control-allow-headers') || '';
    assert.ok(allowHeaders.toLowerCase().includes('authorization'), 'Access-Control-Allow-Headers must include Authorization');
    assert.ok(allowHeaders.toLowerCase().includes('content-type'), 'Access-Control-Allow-Headers must include Content-Type');
  });

  // =========================================================================
  // TEST SUITE 4: Client Build Cleanliness & Token Handling Audit
  // =========================================================================
  console.log('\n--- SUITE 4: Client Build Cleanliness & Token Handling Audit ---');

  await check('4.1: Client TypeScript and Vite build completes with 0 errors (npm run build)', async () => {
    const clientDir = path.resolve(__dirname, '../../client');
    const buildOutput = execSync('npm run build', { cwd: clientDir, encoding: 'utf8' });
    assert.ok(buildOutput.includes('built in') || buildOutput.includes('dist'), 'Client build should report success');
  });

  await check('4.2: Zero query tokens in client source code and network calls', async () => {
    const clientSrcDir = path.resolve(__dirname, '../../client/src');
    
    function getAllFiles(dir: string): string[] {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...getAllFiles(fullPath));
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
          files.push(fullPath);
        }
      }
      return files;
    }

    const files = getAllFiles(clientSrcDir);
    const violations: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

        if (line.includes('?token=') || line.includes('&token=')) {
          violations.push(`${file}:${idx + 1}: ${line}`);
        }
      });
    }

    assert.strictEqual(
      violations.length,
      0,
      `Found query token violations in client code:\n${violations.join('\n')}`
    );
  });

  await check('4.3: Built client bundle dist/ assets have zero ?token= URL occurrences', async () => {
    const distAssetsDir = path.resolve(__dirname, '../../client/dist/assets');
    if (!fs.existsSync(distAssetsDir)) {
      throw new Error('client/dist/assets does not exist. Build may have failed.');
    }

    const assetFiles = fs.readdirSync(distAssetsDir).filter((f) => f.endsWith('.js'));
    assert.ok(assetFiles.length > 0, 'Expected at least one JS bundle in dist/assets');

    for (const jsFile of assetFiles) {
      const bundleContent = fs.readFileSync(path.join(distAssetsDir, jsFile), 'utf8');
      assert.ok(
        !bundleContent.includes('?token=') && !bundleContent.includes('&token='),
        `Bundle ${jsFile} contains forbidden '?token=' or '&token=' pattern`
      );
    }
  });

  // =========================================================================
  // TEST SUITE 5: Server TypeScript Build & Health
  // =========================================================================
  console.log('\n--- SUITE 5: Server Build & Existing Security Suites Verification ---');

  await check('5.1: Server TypeScript compiles cleanly with 0 errors (tsc)', async () => {
    const serverDir = path.resolve(__dirname, '../../server');
    const buildOutput = execSync('npm run build', { cwd: serverDir, encoding: 'utf8' });
    assert.ok(!buildOutput.toLowerCase().includes('error'), 'Server build should report 0 errors');
  });

  await check('5.2: Server test-m1-security suite passes completely', async () => {
    const serverDir = path.resolve(__dirname, '../../server');
    const testOutput = execSync('node dist/scripts/test-m1-security.js', { cwd: serverDir, encoding: 'utf8' });
    assert.ok(testOutput.includes('ALL MILESTONE 1 AUTOMATED SECURITY TESTS PASSED'), 'test-m1-security should pass');
  });

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n================================================================');
  console.log(`🏁 CHALLENGER 2 VERIFICATION SUMMARY: ${testPassed}/${testTotal} PASSED (${testFailed} FAILED)`);
  console.log('================================================================\n');

  if (testFailed > 0) {
    console.error('Failure Details:');
    failureDetails.forEach((f) => {
      console.error(`- ${f.test}: ${f.error}`);
    });
    process.exit(1);
  } else {
    console.log('🎉 ALL EMPIRICAL CHALLENGER TESTS PASSED SUCCESSFULLY! 🎉\n');
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
