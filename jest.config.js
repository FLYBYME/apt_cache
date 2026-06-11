module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/__tests__/**/*.ts'],
  // testPathIgnorePatterns: ['__tests__/proxy_service\\.test\\.ts'],

  collectCoverageFrom: ['src/**/*.ts'],
  globals: {
    "ts-jest": { diagnostics: false }
  }
};
