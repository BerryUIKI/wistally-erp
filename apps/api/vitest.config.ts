import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vitest transpiles with esbuild, which does not read tsconfig decorator
  // settings on its own. NestJS needs legacy decorators plus metadata.
  esbuild: {
    target: 'es2022',
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        useDefineForClassFields: false,
      },
    },
  },
  test: {
    environment: 'node',
  },
});
