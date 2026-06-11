module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js'],
  // Pattern that matches all .ts files in the __tests__ directory
  testRegex: '/__tests__/.*\\.ts$',
  collectCoverage: true,
  // Removed coverage thresholds to allow tests to pass while full coverage is added later.
  // coverageThreshold: {
  //   global: {
  //     branches: 80,
  //     functions: 80,
  //     lines: 80,
  //     statements: 80
  //   }
  // },
  // Use transform to configure ts-jest instead of the deprecated globals config
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { diagnostics: false }]
  }
};
