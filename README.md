# ShopReply Backend

Standalone backend EXE for the [ShopReply Chrome extension](https://chromewebstore.google.com/search/ShopReply).

## Download

📦 Latest release: **[v1.0.4](https://github.com/nhamingroup/ShopReply-Backend/releases/latest)**

Direct download:
```
https://github.com/nhamingroup/ShopReply-Backend/releases/latest/download/ShopReply-Backend-v1.0.4.zip
```

## What's in the release

- `ShopReply-Backend.exe` — single-file Windows binary
- Bundled dependencies (Python runtime, FAISS, embeddings model loader)
- No external Python install required

## Setup

See [setup guide](https://nhamingroup.github.io/shopReply/setup.html).

Quick start:
1. Download + extract the zip
2. Run `ShopReply-Backend.exe`
3. Check `http://localhost:3939/health` → should return `{"status":"ok"}`
4. Install the [Chrome extension](https://chromewebstore.google.com/search/ShopReply)

## System requirements

- Windows 10/11 (64-bit)
- 8 GB RAM (16 GB recommended)
- 2 GB disk space
- Optional: [Ollama](https://ollama.com) for AI-generated suggestions

## Source code

Source code is not publicly available. This repository hosts release artifacts only.

## Privacy

ShopReply processes all data locally on your machine. No customer messages or Q&A data is sent to external servers. See [privacy policy](https://nhamingroup.github.io/shopReply/privacy.html).

## Support

- 📧 Email: nhamingroup@gmail.com
- 📖 Setup guide: https://nhamingroup.github.io/shopReply/setup.html
- 💰 Pricing: https://nhamingroup.github.io/shopReply/pricing.html
