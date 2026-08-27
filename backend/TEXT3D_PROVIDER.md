# Text-to-3D provider configuration

DepthWizard does not include a Text-to-3D model or provider account. To enable
real generation, copy `.env.example` to `.env` in this `backend` folder and set:

```dotenv
TEXT3D_API_URL=https://your-provider.example/v1/generate
TEXT3D_API_KEY=your-secret-key
```

`TEXT3D_API_KEY` is sent only by the FastAPI backend as a Bearer token and is
never returned to React. DepthWizard marks a provider ready only when both the
provider URL and API key are set.

## Required adapter contract

The configured URL receives a JSON POST body containing `prompt`,
`enhanced_prompt`, `category`, `style`, `quality`, and `output_format: "glb"`.

It may return a completed result:

```json
{"status":"completed","model_url":"https://provider.example/model.glb"}
```

Or an asynchronous response:

```json
{"status":"queued","job_id":"abc","status_url":"https://provider.example/v1/jobs/abc"}
```

Status responses must eventually provide `status: "completed"` with
`model_url` (or `glb_url` / `download_url`). DepthWizard downloads the result,
checks the GLB header, stores it in `backend/models`, and serves it at
`/models/<file>.glb`.

## Optional preview → refinement flow

If a provider supports separate preview and material/refinement operations, its
completed preview response may include `refine_url`. DepthWizard posts the
selected quality and `output_format: "glb"` to that URL, polls it using the
same status contract, then validates the final model. Providers that return a
final model in one generation job need no refinement URL.

The generic adapter intentionally does not guess any commercial provider API.
If your provider has a different request or polling contract, implement a small
provider-specific adapter in `app/services/text3d_service.py`; React does not
need to change.
