import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Your specific Supabase Project URL
const SUPABASE_URL = 'https://erqqxtbdxhpjzvutdnhc.supabase.co';

// Your Publishable (Anon) Key
const SUPABASE_ANON_KEY = 'sb_publishable_Yz-j4SZR_sXdDWx0p3EUew_QDj_pF0I';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);