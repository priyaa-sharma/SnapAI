import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const app = express();
const port = Number(process.env.PORT) || 3001;
const hordeApiUrl = "https://stablehorde.net/api/v2";
const anonymousHordeKey = "0000000000";
const hordeModel = "Flux.1-Schnell fp8 (Compact)";
const allowedStyles = new Set(["Dreamy", "Cinematic", "Analog film", "Watercolor"]);
const allowedRatios = new Set(["1:1", "3:2", "2:3"]);
const imageDimensions = {
  "1:1": { width: 512, height: 512 },
  "3:2": { width: 768, height: 512 },
  "2:3": { width: 512, height: 768 },
};
const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

async function requestHorde(path, options = {}) {
  const response = await fetch(`${hordeApiUrl}${path}`, {
    ...options,
    headers: {
      apikey: anonymousHordeKey,
      "Client-Agent": "DreamSnapAI:1.0.0:github",
      ...options.headers,
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const body = await response.text();
    console.error(`AI Horde returned HTTP ${response.status}: ${body.slice(0, 500)}`);
    const error = new Error("The free community image service could not accept this request.");
    error.status = response.status;
    throw error;
  }
  return response.json();
}

app.use(express.json({ limit: "10kb" }));

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", provider: "AI Horde", authentication: "anonymous" });
});

app.post("/api/generate", async (request, response) => {
  const { prompt, style, ratio } = request.body ?? {};

  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 500) {
    return response.status(400).json({ error: "Enter a prompt of up to 500 characters." });
  }
  if (!allowedStyles.has(style) || !allowedRatios.has(ratio)) {
    return response.status(400).json({ error: "Choose a valid style and aspect ratio." });
  }

  try {
    const submission = await requestHorde("/generate/async", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: `${prompt.trim()}. ${style} style.`,
        models: [hordeModel],
        params: {
          ...imageDimensions[ratio],
          steps: 4,
          cfg_scale: 1,
          n: 1,
        },
        nsfw: false,
        censor_nsfw: true,
        r2: false,
      }),
    });

    if (typeof submission.id !== "string") {
      console.error("AI Horde did not return a generation request ID.");
      return response.status(502).json({ error: "The free community image service did not accept the request. Please try again." });
    }

    const deadline = Date.now() + 9 * 60 * 1000;
    while (Date.now() < deadline) {
      const progress = await requestHorde(`/generate/check/${encodeURIComponent(submission.id)}`);
      if (progress.faulted) {
        return response.status(502).json({ error: "A community worker could not finish this image. Please try again." });
      }
      if (progress.is_possible === false) {
        return response.status(503).json({ error: "No available community workers can run this model right now. Please try again later." });
      }
      if (progress.done) {
        const result = await requestHorde(`/generate/status/${encodeURIComponent(submission.id)}`);
        const image = result.generations?.[0]?.img;
        if (typeof image !== "string" || image.length === 0) {
          console.error("AI Horde completed a request without returning an image.");
          return response.status(502).json({ error: "The community service finished without returning an image. Please try again." });
        }

        if (/^https?:\/\//i.test(image)) {
          return response.json({ imageUrl: image });
        }

        const encodedImage = image.replace(/^data:image\/[^;]+;base64,/i, "");
        const imageBytes = Buffer.from(encodedImage, "base64");
        if (imageBytes.length === 0) {
          return response.status(502).json({ error: "The community service returned an invalid image. Please try again." });
        }

        let contentType = "image/png";
        if (imageBytes.subarray(0, 3).toString("hex") === "ffd8ff") contentType = "image/jpeg";
        else if (imageBytes.subarray(0, 4).toString("ascii") === "RIFF") contentType = "image/webp";
        return response.json({ imageUrl: `data:${contentType};base64,${encodedImage}` });
      }

      await sleep(5000);
    }

    return response.status(504).json({
      error: "Free community generation is taking longer than expected. Try again later.",
    });
  } catch (error) {
    console.error("AI Horde image generation failed:", error);
    return response.status(error.status === 429 ? 429 : 502).json({
      error: error.status === 429
        ? "The free community service is busy. Please wait a moment and try again."
        : error.name === "TimeoutError"
          ? "The free community service did not respond in time. Please try again later."
          : error.message || "The free community service could not generate that image. Please try again.",
    });
  }
});

const distDirectory = resolve("dist");
if (existsSync(distDirectory)) {
  app.use(express.static(distDirectory));
  app.get(/.*/, (_request, response) => response.sendFile(resolve(distDirectory, "index.html")));
}

app.listen(port, "0.0.0.0", () => {
  console.log(`DreamSnap API listening on http://localhost:${port}`);
});
