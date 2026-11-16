import assert from "node:assert/strict";
import test from "node:test";

import { gateLabel, labelStatus, passedLabel } from "./labels.ts";

test("the label counts down to the barrier, not the train", () => {
  assert.equal(gateLabel(12, 7), "closes in 7 min");
  assert.equal(gateLabel(5.6, 0.6), "closing now");
  assert.equal(gateLabel(95, 90), "closes in 1 hr 30 min");
  assert.equal(gateLabel(119.8, 119.8), "closes in 2 hr");
});

test("once the barrier is down the label says when the train comes", () => {
  assert.equal(gateLabel(4, -1), "closed · train in 4 min");
  assert.equal(gateLabel(0.5, -4.5), "closed · train due within 1 min");
  assert.equal(gateLabel(-1.5, -6.5), "closed · train passing");
});

test("an uncertain approaching estimate cannot claim that the gate is closed", () => {
  assert.equal(gateLabel(1, -4, "approaching"), "train timing uncertain");
  assert.equal(gateLabel(1, -4, "closed"), "closed · train in 1 min");
});

test("an older API without closes_in still reads sensibly", () => {
  assert.equal(gateLabel(8), "closes in 8 min");
  assert.equal(gateLabel(0.4), "closing now");
});

test("a train that went over is named as passed", () => {
  assert.equal(passedLabel(0.4), "passed just now");
  assert.equal(passedLabel(2.6), "passed 3 min ago");
  assert.equal(labelStatus("passed"), "Passed");
  assert.equal(labelStatus("closing_soon"), "Closing");
});
