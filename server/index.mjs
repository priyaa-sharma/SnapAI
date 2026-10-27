import "dotenv/config";
import express from "express";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PutObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const app = express();
const port = Number(process.env.PORT) || 3001;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const allowedStyles = new Set(["Dreamy", "Cinematic", "Analog film", "Watercolor"]);
const allowedRatios = new Set(["1:1", "3:2", "2:3"]);
const acceptedImageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const s3Bucket = process.env.AWS_S3_BUCKET;
const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  ...(process.env.AWS_S3_ENDPOINT ? { endpoint: process.env.AWS_S3_ENDPOINT, forcePathStyle: true } : {}),
  ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? { credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY } }
    : {}),
});

app.use(express.json({ limit: "25kb" }));
if (process.env.CLERK_SECRET_KEY) app.use(clerkMiddleware());

function requireUser(request, response, next) {
  if (!process.env.CLERK_SECRET_KEY) {
    return response.status(503).json({ error: "Authentication is not configured. Set Clerk keys in the server environment." });
  }
  const { userId } = getAuth(request);
  if (!userId) return response.status(401).json({ error: "Sign in to continue." });
  request.userId = userId;
  return next();
}

function requireWorker(request, response, next) {
  const expected = process.env.WORKER_SECRET;
  const actual = request.get("x-worker-secret");
  if (!expected) return response.status(503).json({ error: "Worker access is not configured." });
  if (!actual || actual.length !== expected.length || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
    return response.status(401).json({ error: "Invalid worker credentials." });
  }
  return next();
}

function requireStorage(response) {
  if (!s3Bucket) {
    response.status(503).json({ error: "S3 storage is not configured. Set AWS_S3_BUCKET and AWS credentials." });
    return false;
  }
  return true;
}

async function requireQueueCapacity(userId, response, kind) {
  const activeStatuses = ["PENDING", "PROCESSING"];
  const [activeJobs, activeTrainingJobs] = await Promise.all([
    prisma.generationJob.count({ where: { clerkUserId: userId, status: { in: activeStatuses } } }),
    kind === "TRAINING"
      ? prisma.generationJob.count({ where: { clerkUserId: userId, kind: "TRAINING", status: { in: activeStatuses } } })
      : Promise.resolve(0),
  ]);
  if (activeJobs >= 3 || activeTrainingJobs >= 1) {
    response.status(429).json({ error: activeTrainingJobs ? "You already have a model training job in progress." : "You have too many active jobs. Wait for one to finish before queueing another." });
    return false;
  }
  return true;
}

async function signedDownloadUrl(key) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: s3Bucket, Key: key }), { expiresIn: 900 });
}

async function signedUploadUrl(key, contentType) {
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: s3Bucket, Key: key, ContentType: contentType }),
    { expiresIn: 900 },
  );
}

async function claimNextJob(kind) {
  const staleBefore = new Date(Date.now() - (kind === "TRAINING" ? 4 : 0.5) * 60 * 60 * 1000);
  await prisma.generationJob.updateMany({
    where: { kind, status: "PROCESSING", startedAt: { lt: staleBefore } },
    data: { status: "PENDING", startedAt: null },
  });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = await prisma.generationJob.findFirst({
      where: { kind, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: { model: true },
    });
    if (!candidate) return null;

    const claim = await prisma.generationJob.updateMany({
      where: { id: candidate.id, status: "PENDING" },
      data: { status: "PROCESSING", startedAt: new Date(), error: null },
    });
    if (claim.count === 1) return candidate;
  }
  return null;
}

app.get("/api/health", async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    response.json({
      status: "ok",
      database: "connected",
      authenticationConfigured: Boolean(process.env.CLERK_SECRET_KEY),
      storageConfigured: Boolean(s3Bucket),
      workersConfigured: Boolean(process.env.WORKER_SECRET),
    });
  } catch (error) {
    console.error("Health check failed:", error);
    response.status(503).json({ status: "error", database: "unavailable" });
  }
});

app.post("/api/uploads/presign", requireUser, async (request, response) => {
  if (!requireStorage(response)) return;
  const { contentType, size } = request.body ?? {};
  const extension = acceptedImageTypes.get(contentType);
  if (!extension) return response.status(400).json({ error: "Upload a JPEG, PNG, or WebP image." });
  if (!Number.isInteger(size) || size < 1 || size > 15 * 1024 * 1024) {
    return response.status(400).json({ error: "Each training image must be smaller than 15 MB." });
  }

  try {
    const key = `users/${request.userId}/training/${randomUUID()}.${extension}`;
    const uploadUrl = await signedUploadUrl(key, contentType);
    response.json({ key, uploadUrl, expiresIn: 900 });
  } catch (error) {
    console.error("Could not create training-image upload URL:", error);
    response.status(502).json({ error: "Could not prepare the image upload." });
  }
});

app.post("/api/training", requireUser, async (request, response) => {
  const { name, imageKeys } = request.body ?? {};
  if (typeof name !== "string" || !name.trim() || name.trim().length > 60) {
    return response.status(400).json({ error: "Enter a model name of up to 60 characters." });
  }
  if (!Array.isArray(imageKeys) || imageKeys.length < 3 || imageKeys.length > 20) {
    return response.status(400).json({ error: "Upload between 3 and 20 training images." });
  }
  if (imageKeys.some((key) => typeof key !== "string" || !key.startsWith(`users/${request.userId}/training/`))) {
    return response.status(400).json({ error: "Training images must belong to your account." });
  }
  if (new Set(imageKeys).size !== imageKeys.length) {
    return response.status(400).json({ error: "Remove duplicate training images." });
  }
  try {
    if (!await requireQueueCapacity(request.userId, response, "TRAINING")) return;
  } catch (error) {
    console.error("Could not check the training queue:", error);
    return response.status(500).json({ error: "Could not check the training queue." });
  }

  try {
    const model = await prisma.dreamModel.create({
      data: {
        clerkUserId: request.userId,
        name: name.trim(),
        trainingImageKeys: imageKeys,
        jobs: { create: { clerkUserId: request.userId, kind: "TRAINING" } },
      },
    });
    response.status(202).json({ model: { id: model.id, name: model.name, status: model.status } });
  } catch (error) {
    console.error("Could not queue model training:", error);
    response.status(500).json({ error: "Could not queue model training." });
  }
});

app.post("/api/generate", requireUser, async (request, response) => {
  const { prompt, style, ratio, modelId } = request.body ?? {};
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 500) {
    return response.status(400).json({ error: "Enter a prompt of up to 500 characters." });
  }
  if (!allowedStyles.has(style) || !allowedRatios.has(ratio)) {
    return response.status(400).json({ error: "Choose a valid style and aspect ratio." });
  }
  if (!requireStorage(response)) return;
  try {
    if (!await requireQueueCapacity(request.userId, response, "GENERATION")) return;
  } catch (error) {
    console.error("Could not check the generation queue:", error);
    return response.status(500).json({ error: "Could not check the generation queue." });
  }

  try {
    let selectedModelId = null;
    if (modelId) {
      const model = await prisma.dreamModel.findFirst({
        where: { id: modelId, clerkUserId: request.userId, status: "COMPLETED", loraKey: { not: null } },
      });
      if (!model) return response.status(404).json({ error: "That trained model is unavailable." });
      selectedModelId = model.id;
    }

    const job = await prisma.generationJob.create({
      data: {
        clerkUserId: request.userId,
        kind: "GENERATION",
        modelId: selectedModelId,
        prompt: prompt.trim(),
        style,
        ratio,
      },
    });
    response.status(202).json({ job: { id: job.id, status: job.status, kind: job.kind } });
  } catch (error) {
    console.error("Could not queue image generation:", error);
    response.status(500).json({ error: "Could not queue image generation." });
  }
});

app.post("/api/pack/generate", requireUser, async (request, response) => {
  const { prompt, style, ratio, count, modelId } = request.body ?? {};
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 500) {
    return response.status(400).json({ error: "Enter a prompt of up to 500 characters." });
  }
  if (!allowedStyles.has(style) || !allowedRatios.has(ratio)) {
    return response.status(400).json({ error: "Choose a valid style and aspect ratio." });
  }
  if (!Number.isInteger(count) || count < 2 || count > 10) {
    return response.status(400).json({ error: "Choose a pack size from 2 to 10 images." });
  }
  if (!requireStorage(response)) return;
  try {
    if (!await requireQueueCapacity(request.userId, response, "PACK")) return;
  } catch (error) {
    console.error("Could not check the pack queue:", error);
    return response.status(500).json({ error: "Could not check the pack queue." });
  }

  try {
    let selectedModelId = null;
    if (modelId) {
      const model = await prisma.dreamModel.findFirst({
        where: { id: modelId, clerkUserId: request.userId, status: "COMPLETED", loraKey: { not: null } },
      });
      if (!model) return response.status(404).json({ error: "That trained model is unavailable." });
      selectedModelId = model.id;
    }

    const job = await prisma.generationJob.create({
      data: {
        clerkUserId: request.userId,
        kind: "PACK",
        modelId: selectedModelId,
        prompt: prompt.trim(),
        style,
        ratio,
        imageCount: count,
      },
    });
    response.status(202).json({ job: { id: job.id, status: job.status, kind: job.kind } });
  } catch (error) {
    console.error("Could not queue image pack:", error);
    response.status(500).json({ error: "Could not queue image pack." });
  }
});

app.get("/api/jobs", requireUser, async (request, response) => {
  try {
    const jobs = await prisma.generationJob.findMany({
      where: { clerkUserId: request.userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const results = await Promise.all(jobs.map(async (job) => ({
      id: job.id,
      kind: job.kind,
      status: job.status,
      prompt: job.prompt,
      error: job.error,
      createdAt: job.createdAt,
      images: job.kind === "TRAINING" ? [] : await Promise.all(job.outputKeys.map(signedDownloadUrl)),
    })));
    response.json({ jobs: results });
  } catch (error) {
    console.error("Could not retrieve user jobs:", error);
    response.status(500).json({ error: "Could not retrieve your jobs." });
  }
});

app.get("/api/models", requireUser, async (request, response) => {
  try {
    const models = await prisma.dreamModel.findMany({
      where: { clerkUserId: request.userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, status: true, error: true, createdAt: true },
    });
    response.json({ models });
  } catch (error) {
    console.error("Could not retrieve user models:", error);
    response.status(500).json({ error: "Could not retrieve your models." });
  }
});

app.get("/worker/jobs", requireWorker, async (_request, response) => {
  if (!requireStorage(response)) return;
  try {
    const job = await claimNextJob("GENERATION").then((generation) => generation ?? claimNextJob("PACK"));
    if (!job) return response.json({ job: null });
    const model = job.model?.loraKey ? await signedDownloadUrl(job.model.loraKey) : null;
    response.json({
      job: {
        id: job.id,
        kind: job.kind,
        prompt: job.prompt,
        style: job.style,
        ratio: job.ratio,
        imageCount: job.imageCount,
        loraUrl: model,
      },
    });
  } catch (error) {
    console.error("Could not claim generation job:", error);
    response.status(500).json({ error: "Could not claim a generation job." });
  }
});

app.get("/worker/training-jobs", requireWorker, async (_request, response) => {
  if (!requireStorage(response)) return;
  try {
    const job = await claimNextJob("TRAINING");
    if (!job) return response.json({ job: null });
    response.json({
      job: {
        id: job.id,
        model: {
          id: job.model.id,
          name: job.model.name,
          trainingImages: await Promise.all(job.model.trainingImageKeys.map(signedDownloadUrl)),
        },
      },
    });
  } catch (error) {
    console.error("Could not claim training job:", error);
    response.status(500).json({ error: "Could not claim a training job." });
  }
});

app.post("/worker/jobs/:id/upload-url", requireWorker, async (request, response) => {
  if (!requireStorage(response)) return;
  const { index, contentType = "image/png" } = request.body ?? {};
  if (!Number.isInteger(index) || index < 0 || !["image/png", "image/jpeg", "image/webp"].includes(contentType)) {
    return response.status(400).json({ error: "Choose a valid image index and content type." });
  }
  try {
    const job = await prisma.generationJob.findFirst({
      where: { id: request.params.id, status: "PROCESSING", kind: { in: ["GENERATION", "PACK"] } },
    });
    if (!job || index >= job.imageCount) return response.status(404).json({ error: "Active generation job not found." });
    const key = `users/${job.clerkUserId}/outputs/${job.id}/${index}.${contentType.split("/")[1]}`;
    response.json({ key, uploadUrl: await signedUploadUrl(key, contentType) });
  } catch (error) {
    console.error("Could not create generation upload URL:", error);
    response.status(500).json({ error: "Could not prepare the generated-image upload." });
  }
});

app.post("/worker/training/:id/upload-url", requireWorker, async (request, response) => {
  if (!requireStorage(response)) return;
  try {
    const job = await prisma.generationJob.findFirst({
      where: { id: request.params.id, status: "PROCESSING", kind: "TRAINING" },
      include: { model: true },
    });
    if (!job?.model) return response.status(404).json({ error: "Active training job not found." });
    const key = `users/${job.clerkUserId}/models/${job.model.id}/adapter.safetensors`;
    response.json({ key, uploadUrl: await signedUploadUrl(key, "application/octet-stream") });
  } catch (error) {
    console.error("Could not create LoRA upload URL:", error);
    response.status(500).json({ error: "Could not prepare the LoRA upload." });
  }
});

app.post("/worker/jobs/:id/complete", requireWorker, async (request, response) => {
  const { outputKeys } = request.body ?? {};
  if (!Array.isArray(outputKeys) || outputKeys.length < 1 || outputKeys.length > 10 || outputKeys.some((key) => typeof key !== "string")) {
    return response.status(400).json({ error: "Provide the generated image object keys." });
  }
  try {
    const job = await prisma.generationJob.findFirst({
      where: { id: request.params.id, status: "PROCESSING", kind: { in: ["GENERATION", "PACK"] } },
    });
    if (!job || outputKeys.length !== job.imageCount || outputKeys.some((key, index) => !key.startsWith(`users/${job.clerkUserId}/outputs/${job.id}/${index}.`))) {
      return response.status(404).json({ error: "The active job or its output keys are invalid." });
    }
    await prisma.generationJob.update({
      where: { id: job.id },
      data: { status: "COMPLETED", outputKeys, completedAt: new Date() },
    });
    response.json({ status: "COMPLETED" });
  } catch (error) {
    console.error("Could not complete generation job:", error);
    response.status(500).json({ error: "Could not save generation results." });
  }
});

app.post("/worker/jobs/:id/fail", requireWorker, async (request, response) => {
  const message = typeof request.body?.error === "string" ? request.body.error.slice(0, 500) : "Worker failed to process the job.";
  try {
    const job = await prisma.generationJob.findFirst({
      where: { id: request.params.id, status: "PROCESSING", kind: { in: ["GENERATION", "PACK"] } },
    });
    if (!job) return response.status(404).json({ error: "Active generation job not found." });
    await prisma.generationJob.update({ where: { id: job.id }, data: { status: "FAILED", error: message, completedAt: new Date() } });
    response.json({ status: "FAILED" });
  } catch (error) {
    console.error("Could not fail generation job:", error);
    response.status(500).json({ error: "Could not update generation job status." });
  }
});

app.post("/worker/training/:id/complete", requireWorker, async (request, response) => {
  const { loraKey } = request.body ?? {};
  try {
    const job = await prisma.generationJob.findFirst({
      where: { id: request.params.id, status: "PROCESSING", kind: "TRAINING" },
      include: { model: true },
    });
    const expectedKey = job?.model ? `users/${job.clerkUserId}/models/${job.model.id}/adapter.safetensors` : "";
    if (!job?.model || loraKey !== expectedKey) return response.status(404).json({ error: "Active training job or LoRA object key is invalid." });
    await prisma.$transaction([
      prisma.dreamModel.update({ where: { id: job.model.id }, data: { status: "COMPLETED", loraKey, error: null } }),
      prisma.generationJob.update({ where: { id: job.id }, data: { status: "COMPLETED", outputKeys: [loraKey], completedAt: new Date() } }),
    ]);
    response.json({ status: "COMPLETED" });
  } catch (error) {
    console.error("Could not complete training job:", error);
    response.status(500).json({ error: "Could not save the trained model." });
  }
});

app.post("/worker/training/:id/fail", requireWorker, async (request, response) => {
  const message = typeof request.body?.error === "string" ? request.body.error.slice(0, 500) : "Worker failed to train the model.";
  try {
    const job = await prisma.generationJob.findFirst({
      where: { id: request.params.id, status: "PROCESSING", kind: "TRAINING" },
      include: { model: true },
    });
    if (!job) return response.status(404).json({ error: "Active training job not found." });
    await prisma.$transaction([
      ...(job.model ? [prisma.dreamModel.update({ where: { id: job.model.id }, data: { status: "FAILED", error: message } })] : []),
      prisma.generationJob.update({ where: { id: job.id }, data: { status: "FAILED", error: message, completedAt: new Date() } }),
    ]);
    response.json({ status: "FAILED" });
  } catch (error) {
    console.error("Could not fail training job:", error);
    response.status(500).json({ error: "Could not update training job status." });
  }
});

const distDirectory = resolve("dist");
if (existsSync(distDirectory)) {
  app.use(express.static(distDirectory));
  app.get(/.*/, (_request, response) => response.sendFile(resolve(distDirectory, "index.html")));
}

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`DreamSnap API listening on http://localhost:${port}`);
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  await pool.end();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
