module.exports = {
  forbidden: [
    {
      name: "core-no-runtime",
      severity: "error",
      comment:
        "Weave kernel (top-level src/, the durable thread/record/coordination core) must not depend on the runtime/agent layer (src/runtime/). Only the runtime-facing entry barrels (runtime-entry, server-entry, opencode-entry, testing-entry) may re-export it. This keeps the kernel provably standalone — the layer a host actually consumes.",
      from: {
        path: "^src/[^/]+\\.ts$",
        pathNot: "^src/(runtime-entry|server-entry|opencode-entry|testing-entry)\\.ts$",
      },
      to: {
        path: "^src/runtime/",
      },
    },
  ],
  options: {
    tsConfig: { fileName: "./tsconfig.json" },
    doNotFollow: { path: "node_modules" },
    exclude: { path: "node_modules" },
  },
};
