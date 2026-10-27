# DreamSnap AI

DreamSnap is a React studio backed by Clerk authentication, PostgreSQL/Prisma
job queues, private S3 object storage, and operator-run Colab GPU workers.
Training, image generation, and image packs are queued by the API; workers
process jobs only while their notebook sessions are online.

## Local setup

1. Copy `.env.example` to `.env` and set your own PostgreSQL connection,
   Clerk keys, S3 bucket credentials, and a long random `WORKER_SECRET`.
   Keep `.env` private; never paste credentials into chat or commit them.
2. Create a private S3 bucket. Configure bucket CORS to allow `PUT` requests
   from `http://localhost:5173` and your deployed app origin, with the
   `Content-Type` request header.
3. Initialize the database and start the app:

   ```bash
   npm install
   npm run db:push
   npm run dev
   ```

4. Open the app and sign in with Clerk. Create a model by uploading 3–20
   training images, or queue an image/pack from the studio.
5. In Colab, open `flux_worker_colab.ipynb` and
   `flux_train_worker_colab.ipynb`. Enable GPU runtimes and add Colab Secrets
   named `BACKEND_URL`, `WORKER_SECRET`, and `HF_TOKEN`. `BACKEND_URL` is the
   public HTTPS backend URL (for local testing, use a tunnel). Use the same
   worker secret configured in the backend.
6. Accept the FLUX.1-dev model license on Hugging Face before creating the
   token. Start the generation and training notebooks in separate GPU
   sessions and leave them running.

## Environment variables

See `.env.example`. The backend needs `DATABASE_URL`, `CLERK_SECRET_KEY`,
`WORKER_SECRET`, `AWS_REGION`, `AWS_S3_BUCKET`, and S3 credentials (or an
instance role). Vite reads `VITE_CLERK_PUBLISHABLE_KEY` when it starts.
`AWS_S3_ENDPOINT` is optional for S3-compatible services.

For production, set these in the hosting provider's secret environment, run
`npm run db:push` once against the production database, and redeploy. Configure
the frontend's Clerk publishable key as a build-time environment variable.
Never expose `CLERK_SECRET_KEY`, `WORKER_SECRET`, AWS credentials, or
`HF_TOKEN` to the browser. Add `BACKEND_URL`, `WORKER_SECRET`, and `HF_TOKEN`
to each Colab notebook's private Secrets store instead.

## Queue and worker behavior

- The API stores training, generation, and pack jobs in PostgreSQL.
- Worker routes require `x-worker-secret`; app routes require a Clerk session.
- Training images and generated files use presigned S3 URLs. The bucket should
  remain private.
- Keep one generation worker and one training worker running. Generation
  supports image packs of 2–10 images; training runs serially on its worker.
- Free notebook sessions can disconnect, queues can wait while workers are
  offline, and a free T4 may be slow or run out of memory. Training jobs are
  not guaranteed to finish on every free GPU session.
- FLUX.1-dev is gated: accept its Hugging Face license first. The training
  notebook uses ai-toolkit configuration that may need adjustment as
  ai-toolkit evolves.

## Build and run

```bash
npm run build
npm start
```
