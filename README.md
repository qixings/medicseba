# Doctor Token

Online token booking for doctors' chambers and pharmacies in Kailashahar. Patients pay ₹65 (₹55 to the chamber, ₹10 service fee), get a token number and watch the live queue.

| Part | Folder | Stack |
| --- | --- | --- |
| API | `apps/api` | Node 22, Fastify, Drizzle ORM, PostgreSQL, socket.io |
| Patient app | `apps/patient` | Expo (Android, iPhone, web), Expo Router, React Query |
| Chamber counter app | `apps/agent` | Expo (Android, iPad, web at `/agent`), works offline |
| Admin panel | next | |

## Run it locally

```bash
# 1. Database
createdb booking            # user booking / password booking, see apps/api/.env.example

# 2. API on :4000
cd apps/api
cp .env.example .env
npm install
npm run db:migrate
npm run db:seed             # sample chambers, doctors, agent logins (password demo1234)
npm run dev

# 3. Patient app
cd ../patient
cp .env.example .env        # EXPO_PUBLIC_API_URL: use your computer's LAN IP when testing on a phone
npm install
npx expo start              # press w for web, or scan the QR with Expo Go
```

In development the OTP is shown on screen ("Test code") and payments use a test provider, so no SMS or money is involved.

## Tests

```bash
createdb booking_test
cd apps/api && DATABASE_URL=postgresql://booking:booking@localhost:5432/booking_test npm test
```

They cover login, catalogue, booking and payment, live queue, agent actions, racing bookings on a nearly full sitting, expired holds, reschedule, cancel and the doctor-not-coming refund or move.

## How booking works

1. `POST /v1/bookings/hold` locks the sitting row, reserves an online place for 5 minutes and creates a payment order.
2. The app pays. Test mode confirms at once; with Razorpay the app opens `/v1/pay/:orderId` (hosted checkout) in the system browser and returns through the `kailash://pay-return` link.
3. `POST /v1/bookings/confirm` checks the signature and gives the next token number. The Razorpay webhook does the same if the app closes mid-payment.
4. Unpaid holds are released every 30 seconds.
5. The agent's "next" pushes a `queue` event over socket.io to everyone watching that sitting, and sends "turn near" alerts at 5 and 2 ahead.

## Test server on the VPS

```bash
git clone https://github.com/qixings/medicseba /opt/medicseba
cd /opt/medicseba
sudo bash deploy/setup.sh medicseba.hookmantra.com
```

It installs Node 22 through nvm (system Node is untouched), creates its own `medicseba` database and user, builds both apps, starts the `medicseba-api` PM2 process on port 4100 (localhost only) and adds its own Nginx file. `DEMO_MODE=1` shows the login code on screen and uses test payments. Later updates: `bash deploy/update.sh` (shows the changes and asks before restarting).

## Going live (Hostinger VPS)

API, behind Nginx with PM2:

```bash
cd apps/api && npm ci && npm run build
DATABASE_URL=... npm run db:migrate:prod
pm2 start dist/index.js --name doctor-token-api
```

Nginx must pass WebSocket upgrades for `/socket.io/`:

```nginx
location / {
  proxy_pass http://127.0.0.1:4000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Production `.env` for the API: a long random `JWT_SECRET`, `NODE_ENV=production`, `CORS_ORIGIN` set to the web app's domain, `PAYMENT_PROVIDER=razorpay` with `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and `SMS_PROVIDER=msg91` with the MSG91 keys. The Razorpay webhook URL is `https://<api domain>/v1/webhooks/razorpay` (events `payment.captured`, `order.paid`).

Web app: `cd apps/patient && npx expo export --platform web`, then serve `dist/` as a single-page app.

Phone apps: `npx eas-cli@latest build --platform android` (and `ios`). Linking the project to EAS also turns on push notifications.

## Still to do

- Chamber agent app (offline-first) and admin panel
- Brand name, domain, app icons
- PDF receipts, ratings, WhatsApp alerts
- Razorpay, MSG91 and store accounts once the business is registered
