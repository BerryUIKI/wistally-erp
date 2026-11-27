import { isChartTemplateId } from '@wistally/domain';

import { seedDatabase } from '../seed.js';

try {
  process.loadEnvFile('.env');
} catch {
  // .env is optional; environment variables win.
}

const chartTemplate = process.env.SEED_CHART_TEMPLATE ?? 'small_business';
if (!isChartTemplateId(chartTemplate)) {
  console.error(`[db] unknown chart template "${chartTemplate}"; use small_business or enterprise`);
  process.exit(1);
}

const result = await seedDatabase({
  connectionString: process.env.DATABASE_URL ?? 'mysql://wistally:wistally@localhost:3306/wistally',
  companyCode: process.env.SEED_COMPANY_CODE ?? 'WT',
  companyName: process.env.SEED_COMPANY_NAME ?? 'WisTally Demo Company',
  adminEmail: process.env.SEED_ADMIN_EMAIL ?? 'admin@wistally.local',
  adminPassword: process.env.SEED_ADMIN_PASSWORD ?? 'Admin@123456',
  chartTemplate,
});

if (result.created) {
  console.log('[db] seeded');
  console.log(`     company : ${result.companyCode} (${result.companyId})`);
  console.log(`     admin   : ${result.adminEmail}`);
  console.log(`     accounts: ${result.accountsCreated} created (${chartTemplate})`);
} else {
  console.log('[db] company already present, nothing to do');
}
