"use client";

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      realtime: { params: { eventsPerSecond: 10 } },
    })
  : null;

export function getDeviceSessionId() {
  if (typeof window === "undefined") return "";
  const key = "saenuri-cafe-device-session";
  const current = window.localStorage.getItem(key);
  if (current) return current;
  const next = crypto.randomUUID();
  window.localStorage.setItem(key, next);
  return next;
}
