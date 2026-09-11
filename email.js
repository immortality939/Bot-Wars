// =============================================================================
// Email sending — account verification + password reset links.
// =============================================================================
// Uses nodemailer with SMTP credentials from environment variables. Set
// these on your host (Render -> your service -> Environment):
//
//   EMAIL_SERVICE   e.g. "gmail"                (default: "gmail")
//   EMAIL_USER      the sending address, e.g. "yourgame@gmail.com"
//   EMAIL_PASS      an app password (NOT your normal Gmail password —
//                   generate one at https://myaccount.google.com/apppasswords)
//   PUBLIC_URL      the public https URL of THIS server, e.g.
//                   "https://bot-wars-1.onrender.com" (no trailing slash).
//                   Used to build the /verify and /reset links in emails.
//   GAME_URL        the URL players play the game at, e.g.
//                   "https://your-game.onrender.com" (no trailing slash).
//                   After verifying/resetting, the confirmation page links
//                   back here with #login so the client can reopen Log In.
//
// If EMAIL_USER / EMAIL_PASS aren't set (e.g. while developing locally),
// nothing crashes — the email is printed to the server console instead,
// with the link right there so you can still test the flow by hand.
// =============================================================================

import nodemailer from "nodemailer";

const EMAIL_USER = process.env.EMAIL_USER || "";
const EMAIL_PASS = process.env.EMAIL_PASS || "";
const EMAIL_SERVICE = process.env.EMAIL_SERVICE || "gmail";

const emailConfigured = Boolean(EMAIL_USER && EMAIL_PASS);

let transporter = null;
if (emailConfigured) {
  transporter = nodemailer.createTransport({
    service: EMAIL_SERVICE,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
  });
}

async function sendMail({ to, subject, html, text }) {
  if (!emailConfigured) {
    console.log("=====================================================");
    console.log("[email.js] EMAIL_USER/EMAIL_PASS not set — printing instead of sending:");
    console.log("To:", to);
    console.log("Subject:", subject);
    console.log(text || html);
    console.log("=====================================================");
    return { sent: false, reason: "not_configured" };
  }

  try {
    await transporter.sendMail({
      from: `"Bot Wars" <${EMAIL_USER}>`,
      to,
      subject,
      html,
      text
    });
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
