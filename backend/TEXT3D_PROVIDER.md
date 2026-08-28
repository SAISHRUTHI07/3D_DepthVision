# Text-to-3D provider contract

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
