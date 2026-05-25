export const config = {
  hostname: "127.0.0.1",
  port: 4444,
  specs: ["./specs/*.spec.ts"],
  capabilities: [{
    maxInstances: 1,
    "tauri:options": {
      application: "../../target/release/bundle/macos/Jetstream.app/Contents/MacOS/Jetstream",
    },
  }],
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 60_000 },
};
