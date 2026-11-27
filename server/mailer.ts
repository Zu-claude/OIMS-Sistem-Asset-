import nodemailer from 'nodemailer';

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isEmailConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST?.trim() &&
      process.env.SMTP_USER?.trim() &&
      process.env.SMTP_PASS
  );
}

function createTransporter() {
  const host = process.env.SMTP_HOST?.trim() || '';
  const portRaw = Number(process.env.SMTP_PORT || 587);
  const port = Number.isInteger(portRaw) && portRaw >= 1 && portRaw <= 65535 ? portRaw : 587;
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
  const user = process.env.SMTP_USER?.trim() || '';
  const pass = process.env.SMTP_PASS || '';

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

function getFromAddress(): string {
  const configured = process.env.SMTP_FROM?.trim();
  if (configured) return configured;
  const user = process.env.SMTP_USER?.trim() || 'no-reply@kideco.co.id';
  return `KIDECO OIMS <${user}>`;
}

export async function sendPasswordResetEmail(params: {
  toEmail: string;
  fullName: string;
  code: string;
  resetUrl: string;
  expiresMinutes: number;
}) {
  const transporter = createTransporter();
  const safeName = escapeHtml(params.fullName || 'User');
  const safeCode = escapeHtml(params.code);
  const safeUrl = escapeHtml(params.resetUrl);

  const subject = 'KIDECO OIMS — Kode Konfirmasi Reset Password';
  const text = [
    `Halo ${params.fullName || 'User'},`,
    '',
    'Kami menerima permintaan reset password untuk akun KIDECO OIMS Anda.',
    `Kode Verifikasi Email Anda: ${params.code}`,
    '',
    `Atau buka tautan berikut untuk langsung mengatur password baru:`,
    params.resetUrl,
    '',
    `Kode dan tautan ini berlaku selama ${params.expiresMinutes} menit dan hanya dapat digunakan satu kali.`,
    'Jika Anda tidak meminta reset password, abaikan email ini dan password Anda tetap aman.',
    '',
    'PT Kideco Jaya Agung · Office Inventory Management System',
  ].join('\n');

  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; background:#F4F5F7; padding:24px; color:#141619;">
      <div style="max-width:520px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden;">
        <div style="background:#141619; color:#ffffff; padding:20px 24px; border-bottom:3px solid #C8102E;">
          <div style="font-size:11px; letter-spacing:1.2px; text-transform:uppercase; color:#C8102E; font-weight:700;">KIDECO OIMS</div>
          <div style="font-size:18px; font-weight:700; margin-top:4px;">Konfirmasi Reset Password</div>
        </div>
        <div style="padding:24px; font-size:14px; line-height:1.6;">
          <p style="margin:0 0 12px;">Halo <strong>${safeName}</strong>,</p>
          <p style="margin:0 0 16px;">Kami menerima permintaan untuk mereset password akun KIDECO OIMS Anda. Masukkan kode konfirmasi berikut pada halaman Reset Password:</p>
          <div style="background:#F4F5F7; border:1px solid #d1d5db; border-radius:6px; padding:16px; text-align:center; margin:0 0 20px;">
            <div style="font-size:11px; text-transform:uppercase; color:#6b7280; letter-spacing:1px; margin-bottom:6px;">Kode Verifikasi Email</div>
            <div style="font-family:monospace; font-size:28px; font-weight:700; letter-spacing:6px; color:#C8102E;">${safeCode}</div>
          </div>
          <p style="margin:0 0 16px;">Atau klik tombol di bawah ini untuk langsung mengatur password baru:</p>
          <div style="text-align:center; margin:0 0 20px;">
            <a href="${safeUrl}" style="display:inline-block; background:#C8102E; color:#ffffff; text-decoration:none; font-weight:600; font-size:13px; padding:11px 22px; border-radius:6px;">Reset Password Sekarang</a>
          </div>
          <p style="margin:0 0 8px; font-size:12px; color:#6b7280;">Kode dan tautan ini berlaku selama <strong>${params.expiresMinutes} menit</strong> dan hanya dapat digunakan satu kali.</p>
          <p style="margin:0; font-size:12px; color:#6b7280;">Jika Anda tidak mengajukan permintaan ini, abaikan email ini.</p>
        </div>
        <div style="background:#f9fafb; border-top:1px solid #e5e7eb; padding:14px 24px; font-size:11px; color:#6b7280;">
          PT Kideco Jaya Agung · Member of Indika Energy Group
        </div>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: getFromAddress(),
    to: params.toEmail,
    subject,
    text,
    html,
  });
}

export async function sendPasswordResetConfirmationEmail(params: {
  toEmail: string;
  fullName: string;
}) {
  if (!isEmailConfigured()) return;
  const transporter = createTransporter();
  const safeName = escapeHtml(params.fullName || 'User');

  await transporter.sendMail({
    from: getFromAddress(),
    to: params.toEmail,
    subject: 'KIDECO OIMS — Password Berhasil Diubah',
    text: `Halo ${params.fullName || 'User'},\n\nPassword akun KIDECO OIMS Anda baru saja berhasil diubah. Jika ini bukan Anda, segera hubungi Super Administrator.\n\nPT Kideco Jaya Agung`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; background:#F4F5F7; padding:24px; color:#141619;">
        <div style="max-width:520px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden;">
          <div style="background:#141619; color:#ffffff; padding:18px 24px; border-bottom:3px solid #C8102E;">
            <div style="font-size:11px; letter-spacing:1.2px; text-transform:uppercase; color:#C8102E; font-weight:700;">KIDECO OIMS</div>
            <div style="font-size:17px; font-weight:700; margin-top:4px;">Notifikasi Perubahan Password</div>
          </div>
          <div style="padding:24px; font-size:14px; line-height:1.6;">
            <p style="margin:0 0 12px;">Halo <strong>${safeName}</strong>,</p>
            <p style="margin:0 0 12px;">Password akun KIDECO OIMS Anda baru saja berhasil direset melalui konfirmasi email.</p>
            <p style="margin:0; font-size:12px; color:#6b7280;">Jika Anda tidak melakukan perubahan ini, segera hubungi Super Administrator.</p>
          </div>
        </div>
      </div>
    `,
  });
}
