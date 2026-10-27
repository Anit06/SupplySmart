import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const registerSource = readFileSync(
    new URL("../src/pages/Register.jsx", import.meta.url),
    "utf8"
);

test("registration posts only to register and navigates to sign-in on success", () => {
    assert.match(registerSource, /`\$\{API_BASE_URL\}\/auth\/register`/);
    assert.doesNotMatch(registerSource, /\/auth\/login|loginUser/);
    assert.match(
        registerSource,
        /if \(!response\.ok\)[\s\S]*?return;[\s\S]*?Account created\. Please sign in with your credentials\.[\s\S]*?navigate\("\/"\)/
    );
});
