const SUPABASE_URL = "https://qumhiffgbmcnlsdstbux.supabase.co";
const SUPABASE_KEY = "sb_publishable_Ssjk_M8lMetBMWbUhha-6g_eM2do4gn";

const supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

window.supabaseClient = supabaseClient;

console.log("Metal-Wars Supabase connected");