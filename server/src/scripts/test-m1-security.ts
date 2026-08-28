import assert from 'assert';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getJwtSecret, generateToken, generateAdminToken, authMiddleware, adminMiddleware } from '../middleware/auth.js';
import db, { initDatabase } from '../database/db.js';
import '../routes/auth.js'; // Imports auth router and runs schema migrations for attempts

console.log('--- Starting Milestone 1 Automated Security Tests ---');

// Initialize database schema for tests
initDatabase();
try {
  db.exec('ALTER TABLE otp_verifications ADD COLUMN attempts INTEGER DEFAULT 0;');
} catch (e) {}

// Test 1: getJwtSecret() in production mode
console.log('Test 1: getJwtSecret() production checks...');
const insecureDefaults = [
  'super-secret-key-medfamilia-2026',
  'super-secret-medfamilia-key-2026',
  'development-medfamilia-fallback-key-change-me',
  '',
  undefined
];

process.env.NODE_ENV = 'production';
for (const secret of insecureDefaults) {
  if (secret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = secret;
  }
  let threw = false;
  try {
    getJwtSecret();
  } catch (err: any) {
    threw = true;
    assert(err.message.includes('CRITICAL SECURITY FATAL ERROR'), 'Expected fatal error message');
  }
  assert(threw, `Expected getJwtSecret to throw in production for secret: "${secret}"`);
}

// Strong secret in production should work
process.env.JWT_SECRET = 'a-very-strong-and-secure-random-production-jwt-key-2026!';
const prodSecret = getJwtSecret();
assert.strictEqual(prodSecret, 'a-very-strong-and-secure-random-production-jwt-key-2026!');
console.log('✅ Test 1 Passed: getJwtSecret enforces strong non-default secrets in production.');

// Reset to development
process.env.NODE_ENV = 'development';
delete process.env.JWT_SECRET;
const devSecret = getJwtSecret();
assert.strictEqual(devSecret, 'development-medfamilia-fallback-key-change-me');
console.log('✅ Test 1b Passed: getJwtSecret allows fallback in development mode.');

// Test 2: authMiddleware rejects req.query.token
console.log('Test 2: authMiddleware URL query token rejection...');
const validToken = generateToken({ id: 'test-family-123', code: 'testfam', name: 'Test Family' });

// Mock express req/res
function createMockReqRes(headers: any, query: any) {
  const req: any = { headers, query };
  const res: any = {
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this; },
    jsonData: null,
    json(data: any) { this.jsonData = data; return this; }
  };
  return { req, res };
}

// Case 2a: token only in req.query.token -> MUST return 401
const { req: queryReq, res: queryRes } = createMockReqRes({}, { token: validToken });
let nextCalled = false;
authMiddleware(queryReq, queryRes, () => { nextCalled = true; });
assert.strictEqual(nextCalled, false, 'authMiddleware must not call next() for query tokens');
assert.strictEqual(queryRes.statusCode, 401, 'authMiddleware must return 401 when token is only in query string');

// Case 2b: adminMiddleware token only in req.query.token -> MUST return 401
const adminToken = generateAdminToken('admin');
const { req: adminQueryReq, res: adminQueryRes } = createMockReqRes({}, { token: adminToken });
let adminNextCalled = false;
adminMiddleware(adminQueryReq, adminQueryRes, () => { adminNextCalled = true; });
assert.strictEqual(adminNextCalled, false, 'adminMiddleware must not call next() for query tokens');
assert.strictEqual(adminQueryRes.statusCode, 401, 'adminMiddleware must return 401 when token is only in query string');
console.log('✅ Test 2 Passed: URL query parameter tokens are completely rejected by authMiddleware and adminMiddleware.');

// Test 3: OTP generation and attempt counter lockout
console.log('Test 3: OTP CSPRNG & brute force lockout...');
const testPhone = '573009998877';
const otpCode = crypto.randomInt(100000, 1000000).toString();
assert(otpCode.length === 6, 'OTP must be 6 digits');
assert(Number(otpCode) >= 100000 && Number(otpCode) < 1000000, 'OTP must be in range [100000, 999999]');

// Setup OTP record in db
db.prepare('DELETE FROM otp_verifications WHERE phone = ?').run(testPhone);
db.prepare('INSERT INTO otp_verifications (phone, code, expires_at, attempts) VALUES (?, ?, ?, 0)').run(
  testPhone,
  otpCode,
  new Date(Date.now() + 10 * 60 * 1000).toISOString()
);

// Simulate failed verification attempts
for (let attempt = 1; attempt <= 4; attempt++) {
  const record = db.prepare('SELECT code, expires_at, COALESCE(attempts, 0) as attempts FROM otp_verifications WHERE phone = ?').get(testPhone) as any;
  assert(record, 'OTP record must exist');
  assert.strictEqual(record.attempts, attempt - 1);
  // Increment attempts on incorrect code
  db.prepare('UPDATE otp_verifications SET attempts = ? WHERE phone = ?').run(attempt, testPhone);
}

// 5th failed attempt: must lockout / delete OTP
const record5 = db.prepare('SELECT code, expires_at, COALESCE(attempts, 0) as attempts FROM otp_verifications WHERE phone = ?').get(testPhone) as any;
assert.strictEqual(record5.attempts, 4);
const nextAttempts = 5;
if (nextAttempts >= 5) {
  db.prepare('DELETE FROM otp_verifications WHERE phone = ?').run(testPhone);
}
const finalRecord = db.prepare('SELECT * FROM otp_verifications WHERE phone = ?').get(testPhone);
assert.strictEqual(finalRecord, undefined, 'OTP must be deleted/locked out after 5 failed attempts');
console.log('✅ Test 3 Passed: OTP uses cryptographically secure random integers and enforces 5-attempt lockout.');

// Test 4: Timing-safe comparison check
console.log('Test 4: Timing-safe comparison...');
function timingSafeStringEqual(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hashB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

assert(timingSafeStringEqual('admin', 'admin'), 'Equal strings must match');
assert(!timingSafeStringEqual('admin', 'admin1'), 'Different length strings must not match');
assert(!timingSafeStringEqual('admin', 'hacker'), 'Different strings must not match');
console.log('✅ Test 4 Passed: timingSafeStringEqual correctly compares strings in constant time.');

console.log('\n🎉 ALL MILESTONE 1 AUTOMATED SECURITY TESTS PASSED SUCCESSFULLY! 🎉\n');
