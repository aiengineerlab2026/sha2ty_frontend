# Shatably frontend

Next.js app for **shatably**. Vendors sign in at `/vendor`, then add 3D models from a photo (Meshy or GPT Astra) or by uploading a GLB.

## Running locally

1. Put keys in `frontend/.env.local` (see `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_BASE_URL`.
2. Apply `backend/supabase/schema.sql` to the Supabase project (tables, RLS, `cads` bucket).
3. Start FastAPI from `backend/` on port 8000.
4. `npm install && npm run dev` and open [http://localhost:3000/vendor](http://localhost:3000/vendor).

The Meshy and OpenAI keys stay in `backend/.env`. Never put them in `NEXT_PUBLIC_` variables.

## Vendor flow

- Sign up with studio name, location, and logo.
- After login, see your models. Add or remove them.
- New model: rich-text description, dimensions (cm), variant images, then either a photo (Meshy or Astra) or a GLB upload.
- Generated and uploaded files are stored in the Supabase `cads` bucket.
