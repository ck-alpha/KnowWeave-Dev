import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFixture, parseOptions } from "../scripts/interview-demo.mjs";

const roots = [];
afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "interview-launcher-test-"));
  roots.push(root);
  const data = {
    kind: "KnowWeave Interview Demo",
    version: 1,
    synthetic: true,
    wikiPath: join(root, "fixture-wiki"),
    configDir: join(root, "fixture-config"),
  };
  await mkdir(data.wikiPath);
  await mkdir(data.configDir);
  await writeFile(join(root, "fixture.json"), JSON.stringify(data));
  return { root, data };
}

describe("interview demo isolation", () => {
  it("defaults to a dedicated port and no inference", () => {
    expect(parseOptions([])).toMatchObject({ port: 3002, model: false, ingest: false });
  });
  it.each(["3000", "3001", "80", "65536", "NaN", "3002junk", "3.5"])(
    "rejects unsuitable port %s before side effects",
    (port) => {
      expect(() => parseOptions(["--port", port])).toThrow();
    },
  );
  it("requires explicit model and ingest opt-ins", () => {
    expect(parseOptions(["--port", "3102", "--model", "--ingest"])).toMatchObject({
      port: 3102,
      model: true,
      ingest: true,
    });
    expect(() => parseOptions(["--dir", "--model"])).toThrow();
    expect(() => parseOptions(["--unknown"])).toThrow();
  });
  it("accepts only the known dedicated fixture layout", async () => {
    const { root, data } = await fixture();
    expect(await loadFixture(root)).toMatchObject(data);
  });
  it("rejects a manifest pointing to another Wiki", async () => {
    const first = await fixture();
    const second = await fixture();
    await writeFile(
      join(first.root, "fixture.json"),
      JSON.stringify({ ...first.data, wikiPath: second.data.wikiPath }),
    );
    await expect(loadFixture(first.root)).rejects.toThrow("必须是本演示目录内");
  });
  it("rejects a symlink escaping the fixture directory", async () => {
    const first = await fixture();
    const second = await fixture();
    await rm(first.data.wikiPath, { recursive: true });
    await symlink(second.data.wikiPath, first.data.wikiPath, "junction");
    await expect(loadFixture(first.root)).rejects.toThrow("必须是本演示目录内");
  });
  it("rejects unlabeled data even if its directories match", async () => {
    const { root, data } = await fixture();
    await writeFile(join(root, "fixture.json"), JSON.stringify({ ...data, synthetic: false }));
    await expect(loadFixture(root)).rejects.toThrow("专用人工面试样例");
  });
});
