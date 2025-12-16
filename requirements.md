# Server Requirements & Setup (VPS)

## Runtime
- Node.js 20+ (tested with 20.14/22.x)
- npm (comes with Node)

## System packages (Ubuntu/Debian)
```bash
sudo apt-get update
sudo apt-get install -y curl git
```
Install Node (choose one):
```bash
# Option A: NodeSource (recommended)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Option B: NVM (if you prefer)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 20
```

Verify:
```bash
node -v
npm -v
```

## App install
```bash
git clone <repo-url> digital_adi
cd digital_adi
npm install
```

## Build & run
```bash
npm run build
npm start   # uses PORT from .env (default 3000)
```

## Env (.env)
Copy `.env.example` to `.env` and set:
```
PORT=3000
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...
TELEGRAM_OWNER_USERNAME=...
TELEGRAM_ALERT_CHAT_ID=...
GAS_BASE_URL=https://script.google.com/macros/s/AKfycbyIQFUW_pRrSM9zVHUed1TguMqgNrb1AVU5i1w748Ic1PVAfiMra9-YcnnSo8OgrsJtjA/exec
GAS_API_KEY=...  # match GAS hardcode/Script Property
```

## Notes
- Webhook URL must be HTTPS and publicly reachable (use Nginx+domain or tunnel like ngrok/Cloudflare).
- If port 3000 already used, set `PORT` in `.env` or run `PORT=3001 npm start`.
- GAS client calls use `?path=/...&key=...` pattern for stability with Apps Script.
