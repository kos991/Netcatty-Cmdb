const { spawn } = require("node:child_process");

const executablePath = "C:\\Users\\Administrator\\AppData\\Local\\Programs\\Netcatty\\resources\\cmdb\\cmdb-server.exe";
const port = 18080;
const databasePath = "C:\\Users\\Administrator\\AppData\\Roaming\\netcatty\\assets.db";
const args = ["-port", String(port), "-db", databasePath, "-api-only"];

console.log("Starting child:", executablePath, args);
const child = spawn(executablePath, args, {
  windowsHide: true,
  stdio: "pipe",
  cwd: "C:\\Users\\Administrator\\AppData\\Local\\Programs\\Netcatty\\resources\\cmdb",
});

child.stdout.on("data", (d) => console.log("STDOUT:", d.toString()));
child.stderr.on("data", (d) => console.log("STDERR:", d.toString()));
child.on("exit", (code, sig) => console.log("Child exited with code", code, sig));

setTimeout(async () => {
  try {
    const res = await fetch("http://127.0.0.1:18080/api/health");
    console.log("Health status:", res.status, await res.text());
  } catch (e) {
    console.error("Health fetch error:", e.message);
  }
  child.kill();
}, 2000);
