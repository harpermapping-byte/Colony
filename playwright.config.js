module.exports = {
  testDir: './client/test',
  testMatch: ['**/testflat*.e2e.mjs'],
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'off',
  },
};
