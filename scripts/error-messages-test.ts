import { errorMessage, responseErrorMessage } from "../frontend/src/lib/errorMessages.ts";

function equal(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const cases: Array<[string, unknown, string]> = [
  ["wrong password code", { code: "invalid_credentials", message: "Invalid login credentials" }, "Incorrect email or password. Please check your details and try again."],
  ["legacy auth string", "Error: Invalid login credentials", "Incorrect email or password. Please check your details and try again."],
  ["unconfirmed email", { code: "email_not_confirmed" }, "Please confirm your email address before signing in. Check your inbox and spam folder."],
  ["rate limited mail", { code: "over_email_send_rate_limit" }, "Too many email requests. Please wait a few minutes before requesting another email."],
  ["expired link", { code: "otp_expired" }, "This email link has expired or has already been used. Please request a new link."],
  ["reused password", { code: "same_password" }, "Please choose a new password different from your current password."],
  ["offline", new TypeError("Failed to fetch"), "Unable to connect to FreshTrace. Please check your internet connection and try again."],
  ["SQL permission is not camera permission", { message: "permission denied for table users" }, "You do not have permission to perform this action."],
  ["camera permission", { name: "NotAllowedError", message: "Permission denied" }, "Camera access was denied. Allow camera access in your browser settings or choose a QR image from your device."],
  ["business validation", { message: "Only pending orders can be cancelled" }, "Only pending orders can be cancelled"],
  ["nested edge error", { error: { message: "Order is unavailable" } }, "Order is unavailable"],
  ["duplicate", { code: "23505", message: "duplicate key value violates unique constraint users_email_key" }, "A record with these details already exists. Check the information and try again."],
  ["Cloudinary disabled", { error: { message: "cloud_name is disabled" } }, "Image upload is temporarily unavailable. Please try again later or contact support."],
];
for (const [name, input, expected] of cases) {
  Deno.test(name, () => equal(errorMessage(input), expected));
}
Deno.test("unknown objects and technical errors never become raw UI text", () => {
  for (const input of [{ details: "secret SQL data" }, "[object Object]", null, undefined, "Internal server error", "column payment.id does not exist", { message: '<html>502 Bad Gateway</html>' }]) {
    const result = errorMessage(input);
    if (/secret|SQL|\[object|undefined|null|column|<html>/.test(result)) throw new Error(result);
  }
});
Deno.test("cyclic errors are handled", () => {
  const input: { error?: unknown } = {};
  input.error = input;
  equal(errorMessage(input), errorMessage(null));
});
Deno.test("account-status message survives the Edge Function wrapper", () => {
  const message = "This account is inactive. Please contact support@freshtrace.online.";
  equal(responseErrorMessage({ allowed: false, status: "inactive", message }, 403), message);
});
Deno.test("empty gateway error has useful fallback", () => {
  equal(responseErrorMessage(null, 503), "FreshTrace is temporarily unable to complete this request. Please try again later or contact support.");
});
Deno.test("expired authorization", () => {
  equal(responseErrorMessage({ message: "Invalid JWT" }, 401), "Your session has expired. Please sign in again.");
});
