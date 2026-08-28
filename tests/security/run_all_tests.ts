import './envSetup.js';
import { runTier1Tests } from './tier1_feature_coverage.test.js';
import { runTier2Tests } from './tier2_boundary_corner.test.js';
import { runTier3Tests } from './tier3_security_combos.test.js';
import { runTier4Tests } from './tier4_real_world_scenarios.test.js';

export async function runAllSecurityTests() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║        MedFamilia SaaS Security & Functional E2E Test Suite              ║');
  console.log('║        Systematic 4-Tier Automated Verification Harness                  ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const startTime = Date.now();

  const r1 = await runTier1Tests();
  const r2 = await runTier2Tests();
  const r3 = await runTier3Tests();
  const r4 = await runTier4Tests();

  const total = r1.total + r2.total + r3.total + r4.total;
  const passed = r1.passed + r2.passed + r3.passed + r4.passed;
  const failed = r1.failed + r2.failed + r3.failed + r4.failed;
  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n==========================================================================');
  console.log('📊 MEDFAMILIA SECURITY & QUALITY ASSURANCE TEST REPORT SUMMARY');
  console.log('==========================================================================');
  console.log(`| Tier                                     | Total | Passed | Failed | Pass Rate |`);
  console.log(`| :--------------------------------------- | :---: | :----: | :----: | :-------: |`);
  console.log(`| Tier 1: Feature Coverage (Happy Path)    |   ${r1.total}  |   ${r1.passed}   |   ${r1.failed}    |  ${((r1.passed / r1.total) * 100).toFixed(1)}%   |`);
  console.log(`| Tier 2: Boundary & Corner Cases          |   ${r2.total}   |   ${r2.passed}    |   ${r2.failed}    |  ${((r2.passed / r2.total) * 100).toFixed(1)}%   |`);
  console.log(`| Tier 3: Cross-Feature & Security Combos  |   ${r3.total}   |   ${r3.passed}    |   ${r3.failed}    |  ${((r3.passed / r3.total) * 100).toFixed(1)}%   |`);
  console.log(`| Tier 4: Real-World Scenarios             |   ${r4.total}   |   ${r4.passed}    |   ${r4.failed}    |  ${((r4.passed / r4.total) * 100).toFixed(1)}%   |`);
  console.log(`| TOTAL OVERALL                            |  ${total}   |   ${passed}   |   ${failed}    |  ${((passed / total) * 100).toFixed(1)}%   |`);
  console.log('==========================================================================');
  console.log(`⏱️  Execution Time: ${elapsedSec} seconds`);

  if (r3.vulnerabilitiesDetected.length > 0) {
    console.log(`\n🚨 ACTIVE VULNERABILITY FINDINGS (${r3.vulnerabilitiesDetected.length}):`);
    r3.vulnerabilitiesDetected.forEach((v, i) => console.log(`  ${i + 1}. ${v}`));
  } else {
    console.log(`\n🛡️  ALL SECURITY INVARIANTS SATISFIED — ZERO VULNERABILITIES DETECTED.`);
  }

  console.log('==========================================================================\n');

  return {
    total,
    passed,
    failed,
    elapsedSec,
    tierResults: { tier1: r1, tier2: r2, tier3: r3, tier4: r4 },
    vulnerabilities: r3.vulnerabilitiesDetected,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAllSecurityTests()
    .then((res) => {
      process.exit(res.failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('Fatal Test Execution Error:', err);
      process.exit(1);
    });
}
