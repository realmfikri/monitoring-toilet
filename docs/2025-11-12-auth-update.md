## 2025-11-12 Authentication + Deployment Worklog

1. **Synced repository with origin/main**  
   - Pulled the latest remote commits, fast-forwarded `main`, and verified local state before touching production resources.

2. **Database migrations & user seeding**  
   - Ran `npm run prisma:migrate:deploy` (production config) to apply `0002_add_user_model` through `0004_rename_air_column`.  
   - Inserted two accounts directly into Postgres via `/tmp/seed-users.sql` using `psql $DATABASE_URL -f /tmp/seed-users.sql`:  
     - `supervisors@muhamadfikri.com` / password `supervisors` → role `SUPERVISOR`.  
     - `users@muhamadfikri.com` / password `users` → role `OPERATOR`.  
   - Confirmed the rows with `psql "$DATABASE_URL" -c 'TABLE "User";'`.

3. **Backend rebuild & redeploy**  
   - Installed missing runtime dependency (`npm install bcrypt`) so password hashing works on the server.  
   - Rebuilt the backend bundle via `npm run build` (which also runs `prisma generate`).  
   - Added a production JWT secret in `backend/.env.production` (`AUTH_SECRET=841867e6277b41683ff1eae85b8b55d8e7419dc75ea4926e1527175fce0ccd52`).  
   - Reloaded the PM2 API process: `sudo -u deploy pm2 reload toilet-api --update-env`.

4. **Frontend rebuild & redeploy**  
   - Rebuilt the SPA with `npm run build` under `frontend/`, producing the new hashed asset (`index-DH7DOVzq.js`).  
   - Reloaded the serving process: `sudo -u deploy pm2 reload toilet-app --update-env`.

5. **Verification**  
   - Hit `https://toilet-api.muhamadfikri.com/api/login` twice (with the SPA origin header) to confirm both supervisor and operator credentials return HTTP 200 + JWT tokens.  
   - Spot-checked `/api/healthz` and `/api/latest` in the PM2 logs to ensure Cloudflare + Nginx forwarding succeeds.  
   - Removed `/tmp/seed-users.sql` after seeding to avoid leaving credentials on disk.

The production dashboard now requires the seeded accounts, JWT signing works with the new secret, and both backend/frontend PM2 processes serve the fresh builds.
