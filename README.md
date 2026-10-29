# Kurukalan — Kurukalan

A bilingual English/Tamil booking application with email OTP sign-in, a modular Node backend, and SQLite database storage. Satellite imagery includes location names and roads. Active franchise centers use light containers and inactive centers use dark containers, both with transparent backgrounds.

## Quick start on Windows

Extract the ZIP completely first; do not run files from inside the ZIP preview. Double-click `START-KURUKALAN.bat`. It installs production dependencies if missing, creates `.env` from the template if absent, starts Node, and opens the browser after the server is listening. Keep that terminal window open. This Windows launcher has not been executed on Windows in this environment; its underlying server path is tested on Linux.

In VS Code, open the project folder containing `package.json`, not just `frontend`. The alternative terminal workflow follows below. VS Code Live Server and opening HTML directly preview the interface, but do not start the API/database. Always use the localhost URL printed by `npm start` for bookings and authentication. Local development works without Supabase; email sign-in still needs Brevo configuration for actual OTP delivery.

## Start from VS Code terminal

Install Node.js 22.13 or newer. Extract this project, open a terminal in its root folder, and run:

```powershell
Copy-Item .env.example .env
notepad .env
```

Set `ADMIN_PASS` to your own strong password, save the file, then run:

```powershell
npm ci
npm start
```

Open http://localhost:3000. Run `npm ci` once after extracting to install the PostgreSQL driver and lock its dependency versions. Always use the server URL rather than opening the HTML file directly.

Admin ID defaults to `admin`; password is whatever you configure in `.env`. No default password is enabled.

## Email OTP setup

SMS/Twilio sign-in has been replaced by email OTP. The application uses Brevo's transactional email API. To enable real sending:

1. Create your own Brevo account and select its free plan.
2. Complete Brevo's account/sender verification and any transactional-email activation it requires.
3. Create an API key in Brevo's SMTP & API settings (an API key, not an SMTP key).
4. Add these values in your local `.env` or backend host's secret environment settings:

```dotenv
BREVO_API_KEY=your_brevo_api_key
EMAIL_FROM=your_verified_sender_email
OTP_SECRET=your_long_random_private_secret
```

`OTP_SECRET` is recommended; when omitted, the email API key serves as the HMAC key. Generate a random secret locally with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Restart the backend after changing configuration. Never commit `.env` or paste keys/passwords into chat. API credentials stay on the server.

Sign-up/sign-in flow: select New User / Sign Up for a new account or Sign In for an existing account. For sign-up, enter your name, 10-digit Indian mobile number and email. For returning-user sign-in, enter only your registered email. Then click Send OTP, read the email (including spam/junk), enter its six-digit code, and click Verify & sign in. The server normalizes email case, checks the code, and creates an authenticated session only on successful verification. Codes expire in ten minutes and allow five incorrect attempts. Successful codes are consumed, so they cannot be reused. Resends are limited to one per minute per email, with an additional per-IP hourly limit. A failed email request does not create a usable challenge.

Plaintext codes appear only in the requested email message; the database stores HMAC hashes with random nonces. Codes are never returned by the API or logged by the application. No fake-code fallback exists in the running app.

Provider documentation:
- https://developers.brevo.com/docs/send-a-transactional-email
- https://developers.brevo.com/docs/api-key-authentication
- https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans

Free-tier limits and account approval requirements are controlled by Brevo. No account or real delivery has been configured or verified in this workspace.

## Booking and admin permissions

The booking form has no name, mobile-number or nearby/preferred-center field. New bookings automatically store the signed-in account's name, contact mobile number and OTP-verified email, and start without a center choice. The backend ignores client-supplied name, mobile, email and center values. Address, photo, land unit, area, estimated weight, container count, storage date and booking status continue to be stored as before. Support messages retain their separate mobile contact field.

Only an authenticated admin can add/delete franchise centers, activate/deactivate franchises, or update booking status. Visitors and farmer accounts cannot mutate those records, including through direct API requests. Admin pages show users, email contacts, booking records/photos, support messages, center controls and database summaries. Legacy phone contacts are shown for old records when email is absent.

## Database and migration

The database defaults to `data/paddy.db`. Users, hashed session tokens, bookings, booking photos, centers, messages and hashed email OTP challenges are stored on the server. It is not a browser-local database.

Existing SQLite databases migrate automatically to add email fields and allow email-only accounts while preserving legacy user IDs, phone values, bookings and admin records. Phone-only sessions are invalidated so old sessions cannot bypass email verification. Legacy phone accounts are not automatically merged with email accounts because ownership cannot be inferred. Existing history remains available to the administrator; verified account linking would be a separate feature.

Stop the server and back up the entire data directory before migrating an existing installation, including any WAL/SHM files. Keep the same `DB_PATH` when upgrading. Never commit database files or publish them under the frontend directory.

## Structure

```text
server.js                   Entry point
backend/config.js           Configuration and environment loading
backend/database.js         Schema, migrations and initial centers
backend/helpers.js          Sessions, access control, validation and responses
backend/routes.js           API routes
backend/services/otp.js      Email delivery and hashed OTP verification
backend/server.js           HTTP server and request dispatch
backend/static.js           Frontend asset serving
frontend/index.html         Page markup
frontend/css/styles.css     Professional light theme and responsive layout
frontend/js/api.js          Same-origin API client
frontend/js/translations.js English/Tamil text
frontend/js/team.js         CEO/crew names and avatars
frontend/js/scenes.js       Field illustrations
frontend/js/app.js          Forms, navigation, map and dashboards
frontend/assets/            Uploaded logo and transparent container artwork
.env.example                Settings template without credentials
render.yaml                 Optional paid SQLite hosting example, not deployed
 tests/                     Isolated email/API and migration tests
```

CEO: Kabilan B. Crew: Jayaseelan S, Infant Vishal S, Barathi Mohan S and Vineesh S. Crew roles display as Team Member until roles are supplied. Names keep the supplied spelling in both languages.

## Satellite map

Esri World Imagery supplies satellite/aerial imagery. Transparent World Transportation and World Boundaries and Places layers add roads and location names. Both overlays are enabled by default and can be toggled. They show the road network, not calculated driving directions. Imagery differs from Google Maps and dates/resolution vary by location. Original OpenStreetMap tile requests were replaced after 403 errors. Markers remain clickable and admin-only center editing is enforced by the API.

The container background was removed with the built-in image editor, preserving its off-white appearance, perspective, doors and hardware. CSS darkens that same transparent artwork for inactive centers. The supplied logo stays within a 48 × 48 desktop or 40 × 40 small-screen box.

## Free cloud database, hosting and Brevo activation

The backend supports two database modes: local SQLite when `DATABASE_URL` is empty, and cloud PostgreSQL when it is set. PostgreSQL stores users, sessions, booking details/photos, centers, support messages and hashed OTP challenges. All devices using this same deployed backend access the same records. Admin can use Refresh bookings and database to fetch the latest orders, and see the database type/connection and email configuration status.

No cloud project or hosting service has been created, and no live provider credentials are configured. The intended repository is https://github.com/kabilan-2/Kurukalan.git . GitHub access remains necessary before publishing code; never send passwords or access tokens in chat.

1. Create a Supabase Free project named Kurukalan under your own account. Enable the Supabase integration if you want project/schema setup managed here.
2. In the project's Connect panel, choose the Session pooler URI for this persistent Node backend. Place it in the backend host's `DATABASE_URL` secret. Replace its password placeholder privately, with correct URI encoding if the password contains special characters.
3. If the project requires its own root CA, download the provider certificate and paste it into `DATABASE_CA_CERT` (multiline), or use `DATABASE_CA_FILE` locally. TLS certificate verification stays enabled. Do not disable it to work around a certificate error.
4. The application creates tables automatically in its private `kurukalan` schema on first cloud startup. Do not add this schema to Supabase's exposed Data API schemas or grant anonymous/authenticated API roles access. This app uses backend database credentials and its own sessions/OTP flow, not Supabase Auth. The schema SQL is in `backend/sql/postgres.sql`.
5. Create your Brevo Free account and verify/activate your sender. Set `BREVO_API_KEY` and `EMAIL_FROM` privately on the backend. Set a random `OTP_SECRET`. Support forwarding additionally uses `SUPPORT_EMAIL`.
6. Publish the source to your selected repository, then use the supplied `render.yaml` to create a Free Node web service, with Supabase as external storage. No paid disk is declared. Install/build command is `npm ci --omit=dev`, start command is `npm start`. Set `REQUIRE_CLOUD_DATABASE=1` and `COOKIE_SECURE=1`. Set your own `ADMIN_PASS`. Review the selected free plan before creating resources. This file alone does not create or deploy anything.
7. Run `npm run check:services` in the configured backend environment. It checks the database connection and email-key configuration without printing secrets or sending email. If allowed by the key's permissions, it also checks the Brevo account API. This is not proof of inbox delivery.
8. Test an actual new-user email OTP on the deployed URL, create a booking, then use a different device to sign in as admin and refresh bookings. Confirm all fields and the uploaded photo. Real OTP delivery and hosted cross-device visibility remain unverified until this test is performed.

Supabase Free has quotas, and booking photos consume database space. Free web hosting may sleep, and free database projects may pause after inactivity. No automatic paid upgrade is configured. The current app's request-rate limiter is in memory and intended for a single backend instance; OTPs and sessions are in the shared database. No database credential, Brevo key or OTP secret is exposed to the browser.

### Import an existing SQLite database

Back up the entire local data directory before moving existing data. Automatic PostgreSQL initialization creates an empty application database plus seed centers; it does not silently upload your local records. For a new, empty cloud target, run:

```powershell
npm run db:import -- "C:\path\to\backup\paddy.db"
```

Set `DATABASE_URL` and the CA settings first. The import runs in a transaction and refuses a cloud target that already has users, bookings or messages. It copies users, centers, bookings/photos and support messages, preserving IDs and foreign keys. Active login sessions and OTP challenges are not copied. Sign in again afterward. An interrupted or failed import rolls back. The original SQLite file is opened read-only.

Cloud schema startup is serialized with a transaction/advisory lock. The supplied schema is designed for a new Kurukalan PostgreSQL database; unrelated databases are not automatically migrated. Legacy local SQLite migrations remain supported.

## Tests and verification

```powershell
npm test
```

Tests use a fake email provider exclusively through a test-process preload. A separate test exercises the cloud SQL adapter with an in-memory PostgreSQL emulator; it does not connect to Supabase or validate a live TLS connection. The emulator skips schema access-control statements, so live provider grants still need checking. They cover sending a generated code, incorrect/reused code rejection, resend limits, sessions, admin permissions, email-backed bookings and contact spoofing protection, static/private-file boundaries, and preservation of old phone accounts during schema migration. The actual application's code has no test email or OTP bypass.

Real email delivery still requires a configured provider account. Previous browser checks verified logo, satellite tiles, roads, labels, transparent light/dark containers, simplified booking fields and center popups. Provider quotas and deliverability depend on the configured account.

## Account identity and booking snapshots

`POST /api/signup/user` creates a new account after email OTP verification. `POST /api/login/user` signs in an existing account using only its registered email and OTP, retaining the stored name/mobile unchanged. Only sign-up requires a name and valid 10-digit Indian mobile number. Duplicate email registrations and mobile numbers already belonging to another account are rejected. Mobile contact numbers are collected, not SMS-verified. Booking identity is taken from the authenticated database account, never editable booking fields. Each booking stores a contact snapshot, so later account changes do not rewrite old booking records. Legacy email-only accounts without a saved mobile require a separate profile-completion feature before booking; sign-in does not collect or alter their profile. The admin users/bookings tables show name, mobile and email separately.

## Container types and editable count

There are exactly two container types: 50 sacks (2,500 kg), and 100 sacks (5,000 kg). The booking form provides a type selector and first automatically selects the 50-sack type for harvests up to 2,500 kg, or the 100-sack type above that, and fills the count by rounding estimated harvest divided by capacity upward. Users can override type and count using the dropdowns. Changing land area or land unit restores automatic type and count. Selecting a different type recalculates count for that type. The count dropdown offers quantities 1–100 plus the exact calculated quantity when larger. Use automatic selection restores both type and quantity.

The backend accepts only the two supported capacities, validates the final count and stores both. Old records migrate to the 2,500 kg type. Admin and My Bookings display the booked quantity and sack/kg type. The admin sees name, mobile, email, address, photo, land measurement, estimated paddy weight, container type/count, date and status. Tests verify both type calculations, manual counts, saved admin details and rejection of invalid capacity/count values.

## Customer support contact configuration

Add your support email/mobile later in `backend/support-config.js`, or set `SUPPORT_EMAIL` and `SUPPORT_MOBILE` in `.env`/host environment settings. Use an international mobile format such as +919876543210. Restart the backend after changing them. Empty values display To be provided, with no fake sample contact links. These contact values are intentionally public on the contact page.

The support form always saves valid messages to the database first. With a support email, configured Brevo key and verified sender, the backend forwards the customer name, contact mobile and message to the support email. Sent means the email provider accepted the request, not guaranteed inbox delivery. If forwarding fails or is unconfigured, the message remains saved, the UI states that email forwarding is unavailable, and the admin can inspect its email status. No automatic retry is performed.

The support mobile provides tap-to-call and a WhatsApp link. Users click those links themselves; submissions are not automatically sent by SMS or WhatsApp. Automated SMS/WhatsApp notifications would require a separately configured messaging provider. Tests cover email forwarding and retention of database messages after provider failure.
