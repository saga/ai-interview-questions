import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

if (process.argv[2] === "pages") {
  const build = spawnSync("npm", ["run", "build"], { stdio: "inherit", shell: process.platform === "win32" });
  if (build.error) throw build.error;
  if (build.status !== 0) process.exit(build.status ?? 1);
  run("wrangler", ["pages", "deploy", "dist", "--project-name", "ai-interview-questions"]);
}

run("wrangler", ["deploy"]);
