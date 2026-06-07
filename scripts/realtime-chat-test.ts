import { createClient } from "npm:@supabase/supabase-js@2.107.0";

const baseUrl = Deno.args[0] ?? "http://127.0.0.1:54321";
const publishableKey = Deno.args[1];
if (!publishableKey) {
  throw new Error("Usage: deno run --allow-net realtime-chat-test.ts <url> <publishable-key>");
}

function client() {
  return createClient(baseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(email: string) {
  const supabase = client();
  const signedIn = await supabase.auth.signInWithPassword({
    email,
    password: "FreshTrace!123",
  });
  if (signedIn.error) throw signedIn.error;
  const profile = await supabase.from("users").select("user_id")
    .eq("auth_user_id", signedIn.data.user.id).single();
  if (profile.error) throw profile.error;
  return { supabase, userId: profile.data.user_id as string };
}

function waitForEvent<T>(label: string, subscribe: (resolve: (value: T) => void) => void) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} realtime event timed out`)), 20000);
    subscribe((value) => {
      clearTimeout(timeout);
      resolve(value);
    });
  });
}

const customer = await signIn("customer@freshtrace.local");
const manager = await signIn("manager@freshtrace.local");
const room = await customer.supabase.rpc("create_chat_room", {
  p_type: "customer_manager",
  p_other_user_id: manager.userId,
  p_order_id: null,
  p_product_id: null,
});
if (room.error) throw room.error;
const roomId = room.data as string;

let resolveMessage: ((value: Record<string, unknown>) => void) | undefined;
let resolveReaction: ((value: Record<string, unknown>) => void) | undefined;
let resolveNotification: ((value: Record<string, unknown>) => void) | undefined;
const messageEvent = waitForEvent<Record<string, unknown>>("message", resolve => {
  resolveMessage = resolve;
});
const reactionEvent = waitForEvent<Record<string, unknown>>("reaction", resolve => {
  resolveReaction = resolve;
});
const notificationEvent = waitForEvent<Record<string, unknown>>("notification", resolve => {
  resolveNotification = resolve;
});

const channel = customer.supabase.channel(`realtime-test:${Date.now()}`)
  .on("postgres_changes", {
    event: "INSERT",
    schema: "public",
    table: "chat_messages",
    filter: `room_id=eq.${roomId}`,
  }, payload => resolveMessage?.(payload.new))
  .on("postgres_changes", {
    event: "INSERT",
    schema: "public",
    table: "chat_message_reactions",
  }, payload => resolveReaction?.(payload.new))
  .on("postgres_changes", {
    event: "INSERT",
    schema: "public",
    table: "notifications",
    filter: `user_id=eq.${customer.userId}`,
  }, payload => resolveNotification?.(payload.new));

await new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Realtime subscription timed out")), 15000);
  channel.subscribe(status => {
    if (status === "SUBSCRIBED") {
      clearTimeout(timeout);
      resolve();
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      clearTimeout(timeout);
      reject(new Error(`Realtime subscription failed: ${status}`));
    }
  });
});
await new Promise(resolve => setTimeout(resolve, 1500));

const marker = `Realtime test ${Date.now()}`;
const insertedMessage = await manager.supabase.from("chat_messages").insert({
  room_id: roomId,
  sender_id: manager.userId,
  message: marker,
}).select("message_id").single();
if (insertedMessage.error) throw insertedMessage.error;

const receivedMessage = await messageEvent;
if (receivedMessage.message !== marker) throw new Error("Unexpected realtime message payload");
const receivedNotification = await notificationEvent;
if (receivedNotification.type !== "chat_message") throw new Error("Unexpected realtime notification payload");

const insertedReaction = await manager.supabase.from("chat_message_reactions").insert({
  message_id: insertedMessage.data.message_id,
  user_id: manager.userId,
  reaction: "love",
});
if (insertedReaction.error) throw insertedReaction.error;

const receivedReaction = await reactionEvent;
if (receivedReaction.reaction !== "love") throw new Error("Unexpected realtime reaction payload");
await customer.supabase.removeChannel(channel);

console.log(JSON.stringify({
  ok: true,
  roomId,
  checks: ["chat message websocket event", "chat reaction websocket event", "notification websocket event"],
}, null, 2));
