import './envSetup.js';
import { runChallengerM4StressSuite } from './challenger_m4_1_stress.test.js';

export async function runChallengerM4VerificationSuite() {
  return await runChallengerM4StressSuite();
}

if (process.argv[1] && process.argv[1].endsWith('challenger_m4_verify.ts')) {
  runChallengerM4VerificationSuite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal execution error:', err);
      process.exit(1);
    });
}
