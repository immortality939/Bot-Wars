// =============================================================================
// Email sending — account verification + password reset links.
// =============================================================================
// Uses Resend's HTTPS API (NOT SMTP). Render's free web services block
// outbound SMTP ports (25/465/587), so plain nodemailer+Gmail no longer works
// on a free instance. Resend sends over regular HTTPS instead, so it works
// fine on the free tier.
//
// Setup:
//   1. Sign up at https://resend.com (free tier is generous for this use case)
//   2. Create an API key: https://resend.com/api-keys
//   3. Set these on your host (Render -> your service -> Environment):
//
//        RESEND_API_KEY   the API key from step 2
//        EMAIL_FROM       the "from" address, e.g. "Bot Wars <onboarding@resend.dev>"
//                          (Resend gives you a free "onboarding@resend.dev"
//                          sender for testing without verifying your own
//                          domain — see resend.com/docs for verifying a
//                          custom domain later)
//        PUBLIC_URL       the public https URL of THIS server, e.g.
//                          "https://bot-wars-1.onrender.com" (no trailing
//                          slash). Used to build the /verify and /reset
//                          links in emails.
//        GAME_URL         the URL players play the game at, e.g.
//                          "https://your-game.onrender.com" (no trailing
//                          slash). After verifying/resetting, the
//                          confirmation page links back here with #login so
//                          the client can reopen Log In.
//
// If RESEND_API_KEY isn't set (e.g. while developing locally), nothing
// crashes — the email is printed to the server console instead, with the
// link right there so you can still test the flow by hand.
// =============================================================================

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const EMAIL_FROM = process.env.EMAIL_FROM || "Bot Wars <onboarding@resend.dev>";

const emailConfigured = Boolean(RESEND_API_KEY);

async function sendMail({ to, subject, html, text }) {
  if (!emailConfigured) {
    console.log("=====================================================");
    console.log("[email.js] RESEND_API_KEY not set — printing instead of sending:");
    console.log("To:", to);
    console.log("Subject:", subject);
    console.log(text || html);
    console.log("=====================================================");
    return { sent: false, reason: "not_configured" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [to],
        subject,
        html,
        text
      })
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error("[email.js] Resend API error:", res.status, errBody);
      return { sent: false, reason: "send_failed" };
    }

    return { sent: true };
  } catch (err) {
    console.error("[email.js] Failed to send email:", err.message);
    return { sent: false, reason: "send_failed" };
  }
}

export function sendVerificationEmail(toEmail, username, verifyToken) {
  const base = process.env.PUBLIC_URL || "";
  const link = `${base}/verify?token=${verifyToken}`;

  return sendMail({
    to: toEmail,
    subject: "Confirm your Bot Wars account",
    text: `Hi ${username},\n\nConfirm your account by opening this link:\n${link}\n\nThis link expires in 24 hours.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;">
        <h2>Welcome to Bot Wars, ${escapeHtml(username)}!</h2>
        <p>Confirm your email to activate your account:</p>
        <p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#0af0c8;color:#012;
           text-decoration:none;font-weight:bold;border-radius:6px;">Confirm my account</a></p>
        <p>Or copy this link into your browser:<br>${link}</p>
        <p style="color:#888;font-size:12px;">This link expires in 24 hours. If you didn't create this account, you can ignore this email.</p>
      </div>`
  });
}

export function sendPasswordResetEmail(toEmail, username, resetToken) {
  const base = process.env.PUBLIC_URL || "";
  const link = `${base}/reset?token=${resetToken}`;

  return sendMail({
    to: toEmail,
    subject: "Reset your Bot Wars password",
    text: `Hi ${username},\n\nReset your password by opening this link:\n${link}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;">
        <h2>Reset your password</h2>
        <p>Hi ${escapeHtml(username)}, click below to set a new password:</p>
        <p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#0af0c8;color:#012;
           text-decoration:none;font-weight:bold;border-radius:6px;">Reset my password</a></p>
        <p>Or copy this link into your browser:<br>${link}</p>
        <p style="color:#888;font-size:12px;">This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>
      </div>`
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
