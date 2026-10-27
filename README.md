# DreamSnap AI

A responsive React and TypeScript interface for an AI image-generation studio.

## Run locally

```bash
npm install
npm run dev
```

The prompt form submits an image request to the free, community-run AI Horde
using anonymous access and its Flux.1-Schnell community model. No paid
provider key is required. Images are generated on volunteer-shared hardware,
so queue times vary and workers may not always be available. Prompts are
shared with the community workers that process them; do not submit sensitive
information. Create a production build with `npm run build` and run it with
`npm start`.

## Prototype scope

Authentication, PostgreSQL/Prisma persistence, and S3 storage are not
connected. Generated images are displayed in the browser and are not yet saved
to a user account or S3.
