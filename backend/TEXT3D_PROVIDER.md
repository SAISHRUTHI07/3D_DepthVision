# Text-to-3D providers

## Tripo Text-to-3D (concrete integration)

DepthWizard includes a server-side integration for Tripo's real asynchronous
Text-to-3D API. Create an API key in the Tripo platform and put it only in
`backend/.env`:

```dotenv
TEXT3D_PROVIDER=tripo
TRIPO_API_KEY=your-tripo-secret
TRIPO_API_BASE_URL=https://openapi.tripo3d.ai/v3
TRIPO_MODEL_VERSION=v3.1-20260211
TRIPO_TIMEOUT_SECONDS=900
TRIPO_POLL_SECONDS=3
```

The adapter submits `POST /generation/text-to-model` with `prompt` and
`model`, polls `GET /tasks/{task_id}`, downloads the completed
`data.output.model_url` immediately, validates that it is a non-empty GLB 2.0
mesh, and stores it in
`backend/generated_models`. It never creates fallback geometry.

For the provider contract and account setup, use the official Tripo docs:
https://developers.tripo3d.ai/en/docs/generation-text-to-model/standard

## Generic provider contract

DepthWizard is provider-agnostic and does not include a provider account, API
key, or fabricated model generator. Configure one compatible real Text-to-3D
engine in `backend/.env`:

```dotenv
TEXT3D_PROVIDER=generic_http
TEXT3D_API_URL=https://your-provider.example/v1/text-to-3d
TEXT3D_API_KEY=your-secret-key
TEXT3D_STATUS_URL_TEMPLATE=https://your-provider.example/v1/jobs/{job_id}
```

`TEXT3D_STATUS_URL_TEMPLATE` is needed only if the provider does not return a
`status_url` for queued jobs. Keep this file private; it is ignored by Git.

## Request contract

DepthWizard sends a JSON `POST` to `TEXT3D_API_URL` with:

```json
{
  "prompt": "enhanced prompt",
  "original_prompt": "user prompt",
  "category": "Vehicle",
  "style": "Realistic",
  "quality": "High",
  "output_format": "glb"
}
```

The provider may respond immediately with `status: "completed"` plus one of
`model_url`, `glb_url`, `download_url`, or `model_urls.glb`. For queued work it
must return `status: "queued"`/`"processing"` and either a `status_url` or a
`job_id` usable with the configured URL template.

The downloaded output must be a GLB 2.0 file containing a mesh with position
vertices. DepthWizard rejects invalid, empty, oversized, and non-GLB results;
it never substitutes a placeholder model. A valid result is stored in
`backend/models` and served to the existing viewer only through
`GET /api/text3d/model/{filename}`.
