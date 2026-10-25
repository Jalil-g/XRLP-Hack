// Security review M1 (mainnet guard) + L2 (secret paths), offline.
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { assertDevnetEndpoint, assertDevnetNetworkId, DEVNET_NETWORK_ID, REPO_ROOT, secretPathProblem } from "../src/config.ts";

test("M1: endpoints that are never devnet are refused before connecting", () => {
  for (const wsUrl of [
    "wss://xrplcluster.com",
    "wss://s1.ripple.com",
    "wss://s2.ripple.com:443",
    "wss://s2-clio.ripple.com",
    "wss://xrpl.ws",
    "wss://xrpl.link",
    "wss://s.altnet.rippletest.net:51233",
    "wss://testnet.xrpl-labs.com",
    "wss://my-mainnet-node.example",
  ]) {
    assert.throws(() => assertDevnetEndpoint({ wsUrl, network: "devnet" }), /devnet only/, wsUrl);
  }
  for (const network of ["mainnet", "Mainnet", "MAIN", "testnet", " Testnet "]) {
    assert.throws(() => assertDevnetEndpoint({ wsUrl: "wss://s.devnet.rippletest.net:51233", network }), /devnet only/, network);
  }
  assertDevnetEndpoint({ wsUrl: "wss://s.devnet.rippletest.net:51233", network: "devnet" });
  assertDevnetEndpoint({ wsUrl: "ws://localhost:6006", network: "devnet" });
});

test("M1: the connected server must report devnet's network_id, whatever the URL says", () => {
  assert.equal(DEVNET_NETWORK_ID, 2);
  assertDevnetNetworkId(2, {});
  for (const reported of [0, 1, undefined, "2", 21338]) {
    assert.throws(() => assertDevnetNetworkId(reported, {}, "wss://looks-like-devnet.example"), /Refusing to use wss:\/\/looks-like-devnet\.example: it reports network_id .* expected 2/, String(reported));
  }
  // A custom network can be named explicitly, but never mainnet (0) or testnet (1).
  assertDevnetNetworkId(21338, { XRPL_NETWORK_ID: "21338" });
  assert.throws(() => assertDevnetNetworkId(2, { XRPL_NETWORK_ID: "21338" }), /expected 21338/);
  for (const bad of ["0", "1", "x"]) assert.throws(() => assertDevnetNetworkId(0, { XRPL_NETWORK_ID: bad }), /XRPL_NETWORK_ID must be an integer >= 2/);
});

test("L2: secret files inside the repo must be git-ignored (.data/ or a file named wallets.json)", () => {
  const root = REPO_ROOT;
  // fine: ignored, or outside the repo
  assert.equal(secretPathProblem(join(root, ".data/wallets.json"), "file"), undefined);
  assert.equal(secretPathProblem(join(root, ".data/wallets.jalil.json"), "file"), undefined);
  assert.equal(secretPathProblem(join(root, "packages/core/.data"), "dir"), undefined);
  assert.equal(secretPathProblem(join(root, "wallets.json"), "file"), undefined);
  assert.equal(secretPathProblem(join(tmpdir(), "xrlp/wallets.bri.json"), "file"), undefined);
  assert.equal(secretPathProblem(join(root, "..", "elsewhere", "w.json"), "file"), undefined);
  // refused: tracked locations of a PUBLIC repo
  assert.match(secretPathProblem(join(root, "wallets.bri.json"), "file") ?? "", /not git-ignored.*PUBLIC/);
  assert.match(secretPathProblem(join(root, "data"), "dir") ?? "", /not git-ignored/);
  assert.match(secretPathProblem(root, "dir") ?? "", /not git-ignored/);
  assert.match(secretPathProblem(join(root, "packages/xrpl/wallets.json.bak"), "file") ?? "", /not git-ignored/);
});
