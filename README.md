# SatQuery AI

Prototype for **ISRO problem statement 26167**: an interactive vision-language assistant for multimodal remote-sensing image analysis through text queries.

Ask questions about satellite imagery. Upload one image to describe a scene, or two to compare changes or optical and SAR views. Gemini chooses the analysis and returns an answer with image references and a downloadable JSON report.

Built with Next.js, TypeScript, shadcn/ui and the Vercel AI SDK.

## Status

The current app uses Gemini for qualitative answers and task selection. It does **not yet meet the full problem statement**. Remaining work:

- Adapt a visual component using BigEarthNet.txt or other open training data.
- Route and execute specialist workflows for remote-sensing tasks, including joint optical–SAR analysis.
- Add validated confidence estimates and evaluate on VRSBench, RSVQA and CDVQA; prepare for the ISRO/SAC evaluation set.
- Restrict PNG/JPEG inputs to approved benchmark datasets; the prototype currently accepts general uploads.

Grounding and change maps are optional for the captioning-based path; remote-sensing adaptation and specialist orchestration are mandatory.

## Run locally

Requires Node.js 22+ and a Gemini API key.

```bash
npm install
cp .env.example .env.local
```

Set these in `.env.local`:

```dotenv
SATQUERY_AI_MODEL=google:gemini-2.5-flash
GOOGLE_GENERATIVE_AI_API_KEY=your-key
```

```bash
npm run dev
```

Open [localhost:3000](http://localhost:3000). Keep `.env.local` out of Git.

Other providers are supported; see [.env.example](.env.example) and [lib/models.ts](lib/models.ts).

## Using it

- **One image:** describe the scene or ask about visible features.
- **Two dates:** upload the earlier image first, then the later one.
- **Optical + SAR:** upload optical first, SAR second.

Leave the mode on **Let AI choose**, or select it yourself. Built-in examples use synthetic images.

PNG, JPEG, TIFF and GeoTIFF are supported. Uploads must total 3.9 MB or less; each image is limited to 4 million pixels. TIFF previews use the first three bands with contrast stretching, so check band order before interpreting colours.

Answers are qualitative. Pixel masks, exact counts, area measurements and calibrated SAR fusion aren't supported. Images are resized for analysis, so small details may be lost. Your question, image previews and metadata are sent to the model provider.

## Checks

```bash
npm test
npm run lint
npm run build
```

With the app running:

```bash
npm run test:api                         # validation only
SATQUERY_TEST_LIVE=1 npm run test:api     # real model calls; uses quota
```

Browser checks use mocked answers and require Chrome running with remote debugging:

```bash
google-chrome --headless --remote-debugging-port=9227 --user-data-dir=/tmp/satquery-browser about:blank
# In another terminal:
npm run test:browser
```

## Deploy

Use the Next.js preset, set the project root to `.`, and add the same environment variables on your host. For a local production server, run `npm run build` then `npm start`.

Authentication and per-user rate limits aren't built in. Restrict access before sharing a deployment that uses your API key.
