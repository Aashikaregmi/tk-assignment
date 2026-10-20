// Any layer folder, in shared code or inside a module.
const LAYER = '^src/(?:shared|modules/[^/]+)';

const rules = [
  {
    name: 'no-circular',
    comment: 'Cycles make code impossible to load, test or reason about in isolation.',
    from: {},
    to: { circular: true },
  },
  {
    name: 'domain-is-pure',
    comment: 'Domain imports only domain: no frameworks, no Node built-ins, no outer layers.',
    from: { path: `${LAYER}/domain/` },
    to: { pathNot: `${LAYER}/domain/` },
  },
  {
    name: 'application-not-outward',
    comment: 'Application depends on ports, never on adapters or the HTTP layer.',
    from: { path: `${LAYER}/application/` },
    to: { path: `${LAYER}/(?:infrastructure|api)/` },
  },
  {
    name: 'application-package-allowlist',
    comment:
      'Application may use Nest DI and CQRS only. Persistence, queues and HTTP belong in infrastructure.',
    from: { path: `${LAYER}/application/` },
    to: { path: '^node_modules/', pathNot: '^node_modules/@nestjs/(?:common|cqrs)/' },
  },
  {
    name: 'infrastructure-not-to-api',
    comment: 'Adapters never depend on controllers or HTTP DTOs.',
    from: { path: `${LAYER}/infrastructure/` },
    to: { path: `${LAYER}/api/` },
  },
  {
    name: 'api-not-to-infrastructure',
    comment: 'Controllers go through the command/query buses, never straight to adapters.',
    from: { path: `${LAYER}/api/` },
    to: { path: `${LAYER}/infrastructure/` },
  },
  {
    name: 'modules-via-index-only',
    comment:
      "Another module is reachable only through its index.ts. $1 is the importing file's module.",
    from: { path: '^src/modules/([^/]+)/' },
    to: { path: '^src/modules/', pathNot: ['^src/modules/$1/', '^src/modules/[^/]+/index\\.ts$'] },
  },
  {
    name: 'shared-not-to-modules',
    comment: 'Modules use shared code, never the other way round.',
    from: { path: '^src/shared/' },
    to: { path: '^src/modules/' },
  },
];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: rules.map((rule) => ({ severity: 'error', ...rule })),
  options: {
    doNotFollow: { path: '^node_modules' },
    // Count `import type` too: a domain file importing a type from infrastructure is still a leak.
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
