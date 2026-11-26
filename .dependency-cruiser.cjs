/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'kernel-pure',
      severity: 'error',
      comment: 'The kernel depends on nothing else in the workspace.',
      from: { path: '^packages/kernel/src' },
      to: { path: '^(packages|apps)/', pathNot: '^packages/kernel/' },
    },
    {
      name: 'domain-pure',
      severity: 'error',
      comment: 'The domain layer may not touch infrastructure or upper layers.',
      from: { path: '^packages/domain/src' },
      to: { path: '^(packages/(application|db)|apps)/' },
    },
    {
      name: 'application-no-infra',
      severity: 'error',
      comment: 'Use cases depend on ports, never on the database package.',
      from: { path: '^packages/application/src' },
      to: { path: '^packages/db' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(node_modules|/dist/|/drizzle/)' },
    combinedDependencies: false,
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/[^/]+' },
    },
  },
};
