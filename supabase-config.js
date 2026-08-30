// RoznamaAds — Supabase client config
// The anon/publishable key is SAFE to expose in client code —
// security is enforced by Row Level Security (RLS) policies in Supabase,
// not by hiding this key. Never put the service_role key here.
const SUPABASE_URL = "https://sdmviikgmbwhsgrtxfqg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_BEYsdjr36__gXf9XxrSnlQ_8_df4TWZ";

const rzDb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
