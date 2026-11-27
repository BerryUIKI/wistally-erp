import { seedDemoCatalog } from '../seed-demo.js';

const connectionString =
  process.env.DATABASE_URL ?? 'mysql://wistally:wistally@localhost:3306/wistally';
const companyCode = process.env.SEED_COMPANY_CODE ?? 'WT';
const itemCount = Number.parseInt(process.env.SEED_DEMO_ITEMS ?? '100', 10);

async function main(): Promise<void> {
  const result = await seedDemoCatalog({ connectionString, companyCode, itemCount });
  console.log('[db] demo catalog seeded');
  console.log(`     company     : ${result.companyId}`);
  console.log(`     categories  : ${result.categories} created`);
  console.log(`     units       : ${result.uoms} created`);
  console.log(`     conversions : ${result.conversions} created`);
  console.log(`     items       : ${result.items} created`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
