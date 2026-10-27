const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const launcherPath = path.resolve(
    __dirname,
    "../../java-inventory-service/scripts/start-local.ps1"
);

test("local Java launcher rejects missing token before starting Maven", {
    skip: process.platform !== "win32"
}, () => {
    const environment = { ...process.env };
    delete environment.JAVA_SERVICE_TOKEN;
    delete environment.INVENTORY_SERVICE_TOKEN;

    const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-File", launcherPath],
        { encoding: "utf8", env: environment, timeout: 10_000 }
    );
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;

    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(output, /Set JAVA_SERVICE_TOKEN/);
    assert.doesNotMatch(output, /mvn spring-boot:run/i);
});

test("local Java launcher maps the shared token and Mongo URI to Maven", {
    skip: process.platform !== "win32"
}, () => {
    const serviceToken = crypto.randomBytes(32).toString("base64url");
    const environment = {
        ...process.env,
        JAVA_SERVICE_TOKEN: serviceToken,
        MONGO_URI: "mongodb://127.0.0.1:27017/launcher-test"
    };
    delete environment.INVENTORY_SERVICE_TOKEN;

    const quotedPath = `'${launcherPath.replace(/'/g, "''")}'`;
    const command = [
        "function mvn {",
        "if ($env:INVENTORY_SERVICE_TOKEN -cne $env:JAVA_SERVICE_TOKEN) { throw 'token mapping failed' }",
        "if ($env:MONGODB_URI -cne $env:MONGO_URI) { throw 'Mongo URI mapping failed' }",
        "$global:LASTEXITCODE = 0",
        "}",
        `& ${quotedPath}`
    ].join("; ");
    const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", command],
        { encoding: "utf8", env: environment, timeout: 10_000 }
    );

    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
});
