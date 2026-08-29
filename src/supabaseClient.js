import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Geeft meteen een duidelijke fout als de .env nog niet is ingevuld.
  console.error("Supabase-omgevingsvariabelen ontbreken. Vul .env in (zie .env.example).");
}

export const supabase = createClient(url, anonKey);

// Elke telefoon logt anoniem in en krijgt een eigen, blijvend gebruikers-id.
// Dat id is straks de sleutel waarmee de database bewaakt wie welke geheime
// woorden mag zien.
export async function ensureSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return session.user;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.user;
}
