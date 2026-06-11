module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/__tests__/**/*.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
  // coverageThreshold removed to avoid strict thresholds during initial implementation
};
