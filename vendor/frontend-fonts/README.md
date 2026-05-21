# Frontend offline font bundle

Portable copy of fonts used by the Wegent frontend Docker build and local `npm run build`.

## Bundle layout

```text
vendor/frontend-fonts/
├── README.md
├── public/fonts/
│   ├── SourceHanSansSC-VF.ttf      # PDF export (CJK)
│   └── google-sans/*.woff2         # UI typography
└── src/app/google-sans-local.css   # Must match google-sans/*.woff2
```

## 1. On a machine with internet

From the repository root:

```powershell
cd frontend
npm run download-fonts
cd ..
powershell -ExecutionPolicy Bypass -File scripts/frontend-fonts/pack.ps1
```

This refreshes `vendor/frontend-fonts/` from `frontend/public/fonts/` and
`frontend/src/app/google-sans-local.css`.

Optional archive for upload:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/frontend-fonts/archive.ps1
```

Creates `vendor/frontend-fonts-bundle.zip`.

## 2. Upload to intranet

Copy the whole `vendor/frontend-fonts/` directory, or `vendor/frontend-fonts-bundle.zip`.

## 3. On the intranet machine (before Docker build)

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/frontend-fonts/install.ps1
```

Linux/macOS:

```bash
bash scripts/frontend-fonts/install.sh
```

Then build with font download skipped (already configured in `docker-compose.build.yml`):

```powershell
docker compose -f docker-compose.yml -f docker-compose.build.yml --profile rag up -d --build
```

Or standalone frontend image:

```powershell
docker build -f docker/frontend/Dockerfile -t wegent-frontend:local `
  --build-arg SKIP_UI_FONT_DOWNLOAD=1 `
  --build-arg SKIP_PDF_FONT_DOWNLOAD=1 .
```
