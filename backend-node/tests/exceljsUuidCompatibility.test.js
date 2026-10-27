const test = require("node:test");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");

test("ExcelJS conditional-formatting UUID generation works with the patched uuid release", () => {
    const exceljsRequire = createRequire(require.resolve("exceljs"));
    const uuid = exceljsRequire("uuid");
    const CfRuleExtXform = require(
        "exceljs/lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform"
    );
    const rule = { type: "iconSet", iconSet: "3Stars", custom: true };

    new CfRuleExtXform().prepare(rule);

    assert.equal(typeof uuid.v4, "function");
    assert.match(rule.x14Id, /^\{[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}\}$/);
});
