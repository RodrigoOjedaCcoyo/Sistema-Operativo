import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl && 
  supabaseAnonKey && 
  supabaseUrl !== 'YOUR_SUPABASE_URL' &&
  supabaseUrl.trim().length > 0
);

// Diagnóstico seguro en consola (sin exponer la clave)
if (typeof window !== 'undefined') {
  console.log('⚡ [Latitud VCP] Diagnóstico de Base de Datos:', {
    conectado: isSupabaseConfigured,
    urlPresente: Boolean(supabaseUrl),
    keyPresente: Boolean(supabaseAnonKey),
    modo: isSupabaseConfigured ? 'Base de Datos Real (Supabase)' : 'Modo Demo (Datos Ficticios)'
  });
}

export const supabase = isSupabaseConfigured 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : null;

