import { seedDatabase } from '../seed.js';

try {
  process.loadEnvFile('.env');
} catch {
  // .env is optional; environment variables win.
}

const result = await seedDatabase({
  connectionString: process.env.DATABASE_URL ?? 'mysql://wistally:wistally@localhost:3306/wistally',
  companyCode: process.env.SEED_COMPANY_CODE ?? 'WT',
  companyName: process.env.SEED_COMPANY_NAME ?? 'WisTally Demo Company',
  adminEmail: process.env.SEED_ADMIN_EMAIL ?? 'admin@wistally.local',
  adminPassword: process.env.SEED_ADMIN_PASSWORD ?? 'Admin@123456',
});

if (result.created) {
  console.log('[db] seeded');
  console.log(`     company : ${result.companyCode} (${result.companyId})`);
  console.log(`     admin   : ${result.adminEmail}`);
} else {
  console.log('[db] company already present, nothing to do');
}
