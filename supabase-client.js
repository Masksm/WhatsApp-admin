
const SUPABASE_URL = "https://oxrcxnikktfhbtxkimqa.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_GD7NdGYYz3ZSgUZSFJM2KA_0sS9yJ6N";

if (!window.supabase || !window.supabase.createClient) {
  throw new Error("Supabase library has not loaded.");
}

window.amoraSupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
