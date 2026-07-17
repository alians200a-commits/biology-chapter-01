import { runAudit } from './audit-biology-chapter-01.mjs';

async function main() {
  try {
    const result = await runAudit();
    console.log(JSON.stringify({ status: 'PASS', mode: 'ci', result }, null, 2));
    process.exit(0);
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAIL', mode: 'ci', error: String(error) }, null, 2));
    process.exit(2);
  }
}

main();


