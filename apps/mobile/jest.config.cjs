module.exports = {
  preset: "jest-expo",
  testMatch: ["**/tests/*.test.tsx"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.cjs"],
};
