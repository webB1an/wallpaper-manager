import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { mkdtemp, mkdir, readdir, writeFile, utimes, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { PublicController } from "../modules/public/public.controller";
import { PublicService } from "../modules/public/public.service";
import { AdminService } from "../modules/admin/admin.service";
import { MiniUploadGuard } from "../modules/public/mini-upload.guard";
import { removeUploadedTempFiles } from "./upload";
import { activeTempFiles, cleanExpiredTempFiles, TEMP_TTL_MS } from "./temp-cleanup.service";

@Module({})
class UploadTestModule {}

test("HTTP upload authorization precedes disk writes; downstream failures clean files", async () => {
  // tsx does not emit TypeScript design metadata; supply the same metadata as the production build.
  Reflect.defineMetadata("design:paramtypes", [PublicService, AdminService], PublicController);
  Reflect.defineMetadata("design:paramtypes", [PublicService], MiniUploadGuard);
  let calls = 0;
  let fail = false;
  const dir = join(process.cwd(), "storage", "tmp-uploads");
  await mkdir(dir, { recursive: true });
  const initial = (await readdir(dir)).sort();
  const app = await NestFactory.create({
    module: UploadTestModule, controllers: [PublicController], providers: [
      { provide: PublicService, useValue: { isMiniAdmin: async (openid: string) => openid === "fixture-admin" } },
      { provide: AdminService, useValue: { createUpload: async (files: Express.Multer.File[]) => {
        calls++;
        assert.equal(files.length, 1);
        if (fail) throw new Error("fixture downstream failure");
        removeUploadedTempFiles(files);
        return { ok: true };
      } } },
      MiniUploadGuard,
    ],
  }, { logger: false });
  try {
    await app.listen(0, "127.0.0.1");
    const send = async (openid?: string) => {
      const body = new FormData();
      body.append("file", new Blob(["fixture"], { type: "image/png" }), "fixture.png");
      return fetch(`${await app.getUrl()}/wallpapers/upload`, { method: "POST", body, headers: openid ? { "x-openid": openid } : {} });
    };
    assert.equal((await send()).status, 403);
    assert.equal((await send("not-admin")).status, 403);
    assert.equal(calls, 0);
    assert.deepEqual((await readdir(dir)).sort(), initial);
    assert.equal((await send("fixture-admin")).status, 201);
    fail = true;
    assert.equal((await send("fixture-admin")).status, 500);
    assert.equal(calls, 2);
    assert.deepEqual((await readdir(dir)).sort(), initial);
    assert.equal((await fetch(`${await app.getUrl()}/wallpapers/upload/batch/complete`, { method: "POST" })).status, 403);
  } finally { await app.close(); }
});

test("periodic cleanup removes only expired inactive files and can run repeatedly", async () => {
  const root = await mkdtemp(join(tmpdir(), "wallpaper-cleanup-test-"));
  const expired = join(root, "expired");
  const active = join(root, "active");
  const recent = join(root, "recent");
  try {
    for (const path of [expired, active, recent]) await writeFile(path, "fixture");
    await mkdir(join(root, "keep-directory"));
    const old = new Date(Date.now() - TEMP_TTL_MS - 60_000);
    for (const path of [expired, active]) await utimes(path, old, old);
    activeTempFiles.add(active);
    await cleanExpiredTempFiles(root);
    assert.deepEqual((await readdir(root)).sort(), ["active", "keep-directory", "recent"]);
    activeTempFiles.delete(active);
    await cleanExpiredTempFiles(root);
    assert.deepEqual((await readdir(root)).sort(), ["keep-directory", "recent"]);
  } finally {
    activeTempFiles.delete(active);
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, { recursive: true });
  }
});
